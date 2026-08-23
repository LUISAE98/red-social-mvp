// SALDO A FAVOR del comprador (crédito por devoluciones; gastable en la app, NO
// retirable). Fuente de verdad: `users/{uid}/buyerCredit/current` (resumen con `balance`)
// + `users/{uid}/buyerCreditMovements/{id}` (movimientos). Solo el backend (Admin SDK)
// escribe; el cliente lo LEE (ver reglas `buyerCredit`).
//
// 💱 EL SALDO VIVE EN LA MONEDA DEL COMPRADOR, no en la de liquidación.
//
// Una devolución es una DEUDA con el comprador: tiene que valer exactamente lo que pagó,
// y guardarla en otra moneda la hacía encoger o crecer sola con el tipo de cambio. Además
// el saldo se combina con tarjeta para completar una compra, y con las dos cifras en la
// misma moneda esa resta es exacta: saldo + tarjeta = total, sin céntimos que aparecen.
//
// ⚠️ El riesgo de tipo de cambio pasa a Vibra, que es donde debe estar. Lo cubre el 2% de
// conversión ya cobrado en cada compra.
//
// Lo consumen: el flujo de DEVOLUCIÓN (rechazo/expiración de una experiencia → emite
// crédito) y el CHECKOUT (gastar saldo en una nueva compra). Ambas operaciones son
// idempotentes por (sourceType, sourceId).

import * as admin from "firebase-admin";
import { SETTLEMENT_CURRENCY } from "./ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function summaryRef(uid: string) {
  return db.collection("users").doc(uid).collection("buyerCredit").doc("current");
}
function movementsCol(uid: string) {
  return db.collection("users").doc(uid).collection("buyerCreditMovements");
}

function readBalance(data: FirebaseFirestore.DocumentData | undefined): number {
  const b = data?.balance;
  return typeof b === "number" && Number.isFinite(b) ? b : 0;
}

/**
 * Moneda del saldo. Los documentos anteriores al cambio no la traen y son de la época en
 * que todo se guardaba en la de liquidación, así que ese es el valor por defecto.
 */
function readCurrency(data: FirebaseFirestore.DocumentData | undefined): string {
  const c = data?.currency;
  return typeof c === "string" && c ? c.toUpperCase() : SETTLEMENT_CURRENCY;
}

/**
 * Convierte entre dos monedas con la tabla CONGELADA, la misma que fija los precios.
 *
 * Solo hace falta en el caso raro de que el saldo y la compra estén en monedas distintas
 * —el comprador cambió de país, o el saldo es anterior al cambio de denominación—. En el
 * caso normal las dos coinciden y no se convierte nada.
 *
 * ⚠️ Si la tabla no sirve, devuelve 0 en vez de inventar una tasa: es preferible no
 * aplicar saldo y cobrar la tarjeta entera a descontar una cantidad equivocada.
 */
async function convertirEntre(monto: number, desde: string, hacia: string): Promise<number> {
  if (!(monto > 0)) return 0;
  if (desde === hacia) return round2(monto);
  const snap = await db.doc("config/exchangeRates").get();
  const rates = (snap.data()?.rates ?? {}) as Record<string, number>;
  const porDesde = rates[desde];
  const porHacia = rates[hacia];
  if (!(porDesde > 0) || !(porHacia > 0)) return 0;
  return round2((monto / porDesde) * porHacia);
}
/**
 * Emite saldo a favor al comprador. Idempotente por (sourceType, sourceId): si ya se
 * emitió por esa devolución, NO duplica. Sin bono: el monto EXACTO que pagó, en SU moneda.
 *
 * ⚠️ Si el saldo existente está en otra moneda —el comprador cambió de país, o es de antes
 * del cambio de denominación— no se mezclan: se convierte lo NUEVO a la moneda del saldo
 * que ya hay. Sumar cifras de monedas distintas daría un número sin significado.
 */
export async function issueBuyerCredit(
  uid: string,
  params: { amount: number; sourceType: string; sourceId: string; currency?: string | null }
): Promise<void> {
  const amount = round2(params.amount);
  if (!uid || !(amount > 0)) return;
  const monedaEmitida = (params.currency ?? SETTLEMENT_CURRENCY).toUpperCase();
  const mRef = movementsCol(uid).doc(`issue__${params.sourceType}__${params.sourceId}`);
  const sRef = summaryRef(uid);
  await db.runTransaction(async (tx) => {
    const mSnap = await tx.get(mRef);
    if (mSnap.exists) return; // ya emitido → idempotente
    const sSnap = await tx.get(sRef);
    const saldoPrevio = readBalance(sSnap.data());
    // Con saldo a cero, la moneda del saldo pasa a ser la de esta devolución.
    const monedaSaldo = saldoPrevio > 0 ? readCurrency(sSnap.data()) : monedaEmitida;
    const aSumar =
      monedaSaldo === monedaEmitida
        ? amount
        : await convertirEntre(amount, monedaEmitida, monedaSaldo);
    if (!(aSumar > 0)) return;
    const next = round2(saldoPrevio + aSumar);
    tx.set(
      sRef,
      { balance: next, currency: monedaSaldo, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(mRef, {
      type: "issued",
      amount: aSumar,
      currency: monedaSaldo,
      // Lo emitido tal cual, antes de cualquier ajuste de moneda: es la evidencia de qué
      // se le devolvió y en qué moneda se le cobró.
      emitido: { amount, currency: monedaEmitida },
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Revierte un gasto de crédito (devuelve el saldo reservado). Se usa cuando el cobro de la
 * tarjeta por el RESTANTE falla, o cuando una reserva de tarjeta-nueva queda abandonada.
 * BORRA el movimiento `spend__...` para que un reintento con el mismo (sourceType,sourceId)
 * vuelva a reservar limpio. Idempotente: si no hay gasto, no hace nada. Devuelve lo devuelto.
 */
export async function revertBuyerCreditSpend(
  uid: string,
  params: { sourceType: string; sourceId: string }
): Promise<number> {
  if (!uid) return 0;
  const mRef = movementsCol(uid).doc(`spend__${params.sourceType}__${params.sourceId}`);
  const sRef = summaryRef(uid);
  return db.runTransaction(async (tx) => {
    const mSnap = await tx.get(mRef);
    if (!mSnap.exists) return 0; // nada que revertir
    const amount = round2((mSnap.data()?.amount as number) ?? 0);
    if (amount > 0) {
      const sSnap = await tx.get(sRef);
      const next = round2(readBalance(sSnap.data()) + amount);
      // ⚠️ Se CONSERVA la moneda del saldo. Aquí se forzaba la de liquidación, así que al
      // revertir una reserva —rechazar un reembolso, o un cobro fallido— el importe volvía
      // en pesos pero el documento pasaba a decir dólares. A partir de ahí todo lo que
      // tocara ese saldo lo leía en la moneda equivocada.
      const monedaSaldo = readCurrency(sSnap.data());
      tx.set(
        sRef,
        { balance: next, currency: monedaSaldo, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    tx.delete(mRef); // liberar la clave para un reintento fresco
    return amount;
  });
}

/**
 * Gasta saldo a favor en una compra. Idempotente por (sourceType, sourceId). Aplica
 * como máximo el saldo disponible (el caller cobra la diferencia con tarjeta).
 *
 * `amount` y `currency` vienen en la moneda en la que se le COBRA al comprador, y el
 * resultado sale en esa misma moneda. Así la resta de la pasarela —total menos saldo,
 * resto a la tarjeta— es exacta, sin conversiones intermedias que dejen céntimos sueltos.
 */
export async function spendBuyerCredit(
  uid: string,
  params: { amount: number; sourceType: string; sourceId: string; currency?: string | null }
): Promise<number> {
  const amount = round2(params.amount);
  if (!uid || !(amount > 0)) return 0;
  const monedaCompra = (params.currency ?? SETTLEMENT_CURRENCY).toUpperCase();
  const mRef = movementsCol(uid).doc(`spend__${params.sourceType}__${params.sourceId}`);
  const sRef = summaryRef(uid);
  return db.runTransaction(async (tx) => {
    const mSnap = await tx.get(mRef);
    if (mSnap.exists) {
      // Ya aplicado: se devuelve lo que se aplicó EN LA COMPRA, no lo descontado del saldo.
      const yaAplicado = mSnap.data()?.aplicado as { amount?: number } | undefined;
      return round2(yaAplicado?.amount ?? (mSnap.data()?.amount as number) ?? 0);
    }
    const sSnap = await tx.get(sRef);
    const prev = readBalance(sSnap.data());
    const monedaSaldo = readCurrency(sSnap.data());
    // El saldo disponible, expresado en la moneda de ESTA compra.
    const disponibleEnCompra =
      monedaSaldo === monedaCompra ? prev : await convertirEntre(prev, monedaSaldo, monedaCompra);
    const applied = round2(Math.min(amount, disponibleEnCompra));
    if (applied <= 0) return 0;
    // Lo que se descuenta del saldo, en la moneda del saldo.
    const descontado =
      monedaSaldo === monedaCompra ? applied : await convertirEntre(applied, monedaCompra, monedaSaldo);
    tx.set(
      sRef,
      { balance: Math.max(0, round2(prev - descontado)), currency: monedaSaldo, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(mRef, {
      type: "spent",
      amount: descontado,
      currency: monedaSaldo,
      // Lo aplicado en la compra, en la moneda que vio el comprador.
      aplicado: { amount: applied, currency: monedaCompra },
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return applied;
  });
}
