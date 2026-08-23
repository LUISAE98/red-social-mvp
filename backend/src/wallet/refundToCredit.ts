// Devolución de una EXPERIENCIA → SALDO A FAVOR del comprador. Lo llaman los callables de
// devolución (saludo/consejo, sesión exclusiva, tiempo contigo) al pedir el comprador su
// devolución. Es SÍNCRONO (además del trigger de respaldo en ledgerTriggers), para devolver
// el monto exacto acreditado y que la UI muestre el panel verde con la cifra.
//
// Solo acredita si el dinero se COBRÓ (había cargo capturado). El monto = lo que pagó el
// comprador (base + cargo fijo + impuesto), leído del paymentIntent. Todo idempotente por (sourceType,
// sourceId): el trigger y esta llamada no duplican.

import * as admin from "firebase-admin";
import { SETTLEMENT_CURRENCY } from "./ledger";
import { reverseEarning, FIXED_SERVICE_FEE_USD } from "./ledger";
import { issueBuyerCredit } from "./buyerCredit";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Refleja en el espejo de compras (Entregados → "Todo") una experiencia DEVUELTA A LA
 * TARJETA: el creador la rechazó ANTES de que se cobrara (hold cancelado), así que NUNCA
 * hubo asiento en el ledger → no existe la compra. Aquí la creamos como `status: "refunded"`
 * + `refundDestination: "card"` para mostrar "· Devuelto a tu tarjeta" (no facturable). El
 * `refundedAmount` = lo que se habría cobrado (del paymentIntent). Idempotente por la clave.
 */
export async function mirrorCardReturnPurchase(params: {
  buyerId: string;
  creatorId: string;
  sourceType: string;
  sourceId: string;
  type: string;
  channelType: "profile" | "group";
  channelId: string | null;
  occurredAt?: unknown;
}): Promise<void> {
  const { buyerId, sourceType, sourceId } = params;
  if (!buyerId) return;
  // Montos del paymentIntent (base, IVA y total cobrado se estampan con chargeFields).
  const piSnap = await db.collection("paymentIntents").doc(`${sourceType}__${sourceId}`).get();
  const pi = piSnap.data() ?? {};
  const grossAmount = num(pi.grossAmount) || num(pi.baseAmount);
  const taxAmount = num(pi.taxAmount);
  const total = num(pi.chargedAmount) || round2(grossAmount + FIXED_SERVICE_FEE_USD + taxAmount);
  const currency =
    typeof pi.settlementCurrency === "string" ? pi.settlementCurrency : SETTLEMENT_CURRENCY;
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.doc(`users/${buyerId}/purchases/${sourceType}__${sourceId}`).set(
    {
      buyerId,
      creatorId: params.creatorId,
      type: params.type,
      status: "refunded",
      grossAmount,
      taxAmount,
      currency,
      sourceType,
      sourceId,
      channelType: params.channelType,
      channelId: params.channelId,
      liveId: null,
      postId: null,
      refundDestination: "card",
      refundedAmount: total,
      // 💵 Lo que de VERDAD se le cobró y en qué moneda. `refundedAmount` va en la moneda
      // de liquidación, y mostrarlo obliga a reconvertirlo: la interfaz lo pasaba otra vez
      // por la fórmula del comprador —2% y redondeo al paso— y enseñaba 825 MXN por una
      // devolución de 810.99. Con esto no hay nada que reconvertir.
      presentmentAmount: num(pi.presentmentAmount) || null,
      presentmentCurrency:
        typeof pi.presentmentCurrency === "string" ? pi.presentmentCurrency : null,
      occurredAt: params.occurredAt ?? now,
      createdAt: params.occurredAt ?? now,
      updatedAt: now,
    },
    { merge: true }
  );
}

/**
 * Revierte la ganancia del creador (como DEVOLUCIÓN) y emite el saldo a favor al comprador.
 * Devuelve el monto acreditado (MXN). Si no hubo cargo capturado, devuelve 0 (no acredita).
 */
export async function refundExperienceToCredit(params: {
  buyerId: string;
  creatorId: string;
  sourceType: string;
  sourceId: string;
}): Promise<number> {
  const { buyerId, creatorId, sourceType, sourceId } = params;

  // Para el creador cuenta como DEVOLUCIÓN (no como "perdido"). Idempotente.
  await reverseEarning(creatorId, sourceType, sourceId, { asRefund: true });

  // Total que pagó el comprador, del paymentIntent (base + cargo fijo + impuesto).
  const piSnap = await db.collection("paymentIntents").doc(`${sourceType}__${sourceId}`).get();
  const total = num(piSnap.get("chargedAmount"));
  if (total <= 0) return 0;

  // 💱 Se devuelve EXACTAMENTE lo que se le cobró, en SU moneda. `chargedAmount` va en la
  // de liquidación y, mostrado en pesos, nunca coincidía con el cargo: 47.82 USD salían
  // como 808.91 cuando el recibo decía 808.99, y al día siguiente como otra cifra distinta.
  const cobradoLocal = num(piSnap.get("presentmentAmount"));
  const monedaLocal = piSnap.get("presentmentCurrency");
  const emite =
    cobradoLocal > 0 && typeof monedaLocal === "string" && monedaLocal
      ? { amount: cobradoLocal, currency: monedaLocal }
      : { amount: total, currency: SETTLEMENT_CURRENCY };

  // Saldo a favor por el total pagado. Idempotente por (sourceType, sourceId).
  await issueBuyerCredit(buyerId, { amount: emite.amount, currency: emite.currency, sourceType, sourceId });

  // Marca el espejo de compras (Entregados → "Todo") como DEVUELTO A CRÉDITO, con el monto
  // acreditado, para mostrar "+$X · Devuelto en crédito" (no facturable). El doc del espejo
  // usa la misma clave determinista del ledger (`${sourceType}__${sourceId}`).
  await db.doc(`users/${buyerId}/purchases/${sourceType}__${sourceId}`).set(
    {
      refundDestination: "credit",
      refundedAmount: total,
      // 💵 Lo que de VERDAD se le cobró y en qué moneda, igual que en la devolución a
      // tarjeta. Sin esto la lista reconvertía `refundedAmount` —que va en la moneda de
      // liquidación— y enseñaba 825 por un crédito de 808.99.
      presentmentAmount: emite.currency === SETTLEMENT_CURRENCY ? null : emite.amount,
      presentmentCurrency: emite.currency === SETTLEMENT_CURRENCY ? null : emite.currency,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return total;
}
