// SALDO A FAVOR del comprador (crédito por devoluciones; gastable en la app, NO
// retirable). Fuente de verdad: `users/{uid}/buyerCredit/current` (resumen con `balance`)
// + `users/{uid}/buyerCreditMovements/{id}` (movimientos). Solo el backend (Admin SDK)
// escribe; el cliente lo LEE (ver reglas `buyerCredit`). Todo en MXN canónico.
//
// Lo consumen: el flujo de DEVOLUCIÓN (rechazo/expiración de una experiencia → emite
// crédito) y el CHECKOUT (gastar saldo en una nueva compra). Ambas operaciones son
// idempotentes por (sourceType, sourceId).

import * as admin from "firebase-admin";

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
 * Emite saldo a favor al comprador. Idempotente por (sourceType, sourceId): si ya se
 * emitió por esa devolución, NO duplica. Sin bono (monto exacto). Todo en MXN.
 */
export async function issueBuyerCredit(
  uid: string,
  params: { amount: number; sourceType: string; sourceId: string }
): Promise<void> {
  const amount = round2(params.amount);
  if (!uid || !(amount > 0)) return;
  const mRef = movementsCol(uid).doc(`issue__${params.sourceType}__${params.sourceId}`);
  const sRef = summaryRef(uid);
  await db.runTransaction(async (tx) => {
    const mSnap = await tx.get(mRef);
    if (mSnap.exists) return; // ya emitido → idempotente
    const sSnap = await tx.get(sRef);
    const next = round2(readBalance(sSnap.data()) + amount);
    tx.set(
      sRef,
      { balance: next, currency: "MXN", updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(mRef, {
      type: "issued",
      amount,
      currency: "MXN",
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
      tx.set(
        sRef,
        { balance: next, currency: "MXN", updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    tx.delete(mRef); // liberar la clave para un reintento fresco
    return amount;
  });
}

/**
 * Gasta saldo a favor en una compra. Idempotente por (sourceType, sourceId). Aplica
 * como máximo el saldo disponible (el caller cobra la diferencia con tarjeta). Devuelve
 * el monto REALMENTE aplicado.
 */
export async function spendBuyerCredit(
  uid: string,
  params: { amount: number; sourceType: string; sourceId: string }
): Promise<number> {
  const amount = round2(params.amount);
  if (!uid || !(amount > 0)) return 0;
  const mRef = movementsCol(uid).doc(`spend__${params.sourceType}__${params.sourceId}`);
  const sRef = summaryRef(uid);
  return db.runTransaction(async (tx) => {
    const mSnap = await tx.get(mRef);
    if (mSnap.exists) return round2((mSnap.data()?.amount as number) ?? 0); // ya aplicado
    const sSnap = await tx.get(sRef);
    const prev = readBalance(sSnap.data());
    const applied = round2(Math.min(amount, prev));
    if (applied <= 0) return 0;
    tx.set(
      sRef,
      { balance: round2(prev - applied), currency: "MXN", updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(mRef, {
      type: "spent",
      amount: applied,
      currency: "MXN",
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return applied;
  });
}
