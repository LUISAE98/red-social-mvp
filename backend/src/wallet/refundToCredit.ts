// Devolución de una EXPERIENCIA → SALDO A FAVOR del comprador. Lo llaman los callables de
// devolución (saludo/consejo, sesión exclusiva, tiempo contigo) al pedir el comprador su
// devolución. Es SÍNCRONO (además del trigger de respaldo en ledgerTriggers), para devolver
// el monto exacto acreditado y que la UI muestre el panel verde con la cifra.
//
// Solo acredita si el dinero se COBRÓ (había cargo capturado). El monto = lo que pagó el
// comprador (base + $3 + IVA), leído del paymentIntent. Todo idempotente por (sourceType,
// sourceId): el trigger y esta llamada no duplican.

import * as admin from "firebase-admin";
import { reverseEarning } from "./ledger";
import { issueBuyerCredit } from "./buyerCredit";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
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

  // Total que pagó el comprador, del paymentIntent (base + $3 + IVA).
  const piSnap = await db.collection("paymentIntents").doc(`${sourceType}__${sourceId}`).get();
  const total = num(piSnap.get("chargedAmount"));
  if (total <= 0) return 0;

  // Saldo a favor por el total pagado. Idempotente por (sourceType, sourceId).
  await issueBuyerCredit(buyerId, { amount: total, sourceType, sourceId });
  return total;
}
