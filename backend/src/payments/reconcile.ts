// Reconciliación de pagos de Mercado Pago con los documentos de dominio.
//
// Lo comparten `payGreeting` (respuesta síncrona de la orden) y `mpWebhook`
// (confirmación asíncrona). Ambos caminos son IDEMPOTENTES: marcar dos veces el
// mismo pago no duplica nada. El webhook es la fuente de verdad durable; la
// respuesta síncrona solo adelanta la buena UX.
//
// Regla de oro: aquí SOLO se voltea la bandera de pago del documento de origen.
// La contabilidad (ledger) la sigue escribiendo el trigger `ledgerTriggers.ts`
// cuando `paymentStatus` pasa a "paid". Separación estricta.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

/** Estado de pago normalizado (independiente de las cadenas exactas de MP). */
export type MpNormalizedStatus =
  | "approved"
  | "pending"
  | "rejected"
  | "refunded"
  | "charged_back"
  | "unknown";

/**
 * Normaliza el estado de una Order de MP a nuestro modelo. Preferimos el estado
 * del pago; si no, el de la orden. En Orders API "processed"/"accredited" = ok.
 */
export function normalizeOrderPaymentStatus(
  orderStatus?: string,
  paymentStatus?: string
): MpNormalizedStatus {
  const s = (paymentStatus || orderStatus || "").toLowerCase();
  if (["processed", "approved", "accredited"].includes(s)) return "approved";
  if (["pending", "in_process", "action_required", "at_terminal"].includes(s)) {
    return "pending";
  }
  if (["rejected", "failed", "cancelled", "canceled", "expired"].includes(s)) {
    return "rejected";
  }
  if (s === "refunded") return "refunded";
  if (["charged_back", "chargeback"].includes(s)) return "charged_back";
  return "unknown";
}

/** Crea/actualiza el intento de pago (puente compra ↔ orden MP). Idempotente. */
export async function upsertPaymentIntentStatus(
  externalReference: string,
  fields: Record<string, unknown>
): Promise<void> {
  await db
    .collection("paymentIntents")
    .doc(externalReference)
    .set(
      { externalReference, ...fields, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
}

/**
 * Aplica un pago APROBADO al documento de origen (voltea su bandera de pago).
 * Idempotente y defensivo: solo actúa si el doc sigue en "awaiting_payment"
 * (no pisa un estado ya pagado/reembolsado). Por ahora solo saludos/consejos.
 */
export async function applyApprovedPaymentToSource(
  externalReference: string,
  meta: { mpOrderId?: string | null; mpPaymentId?: string | null }
): Promise<void> {
  const sep = externalReference.indexOf("__");
  if (sep < 0) {
    logger.warn("reconcile: external_reference sin separador", { externalReference });
    return;
  }
  const sourceType = externalReference.slice(0, sep);
  const sourceId = externalReference.slice(sep + 2);

  if (sourceType === "greetingRequest") {
    const ref = db.doc(`greetingRequests/${sourceId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const d = snap.data() ?? {};
      if (d.paymentStatus === "paid") return; // ya aplicado (idempotente)
      if (d.paymentStatus !== "awaiting_payment") return; // no pisar otros estados
      tx.update(ref, {
        paymentStatus: "paid",
        paymentMode: "mercadopago",
        mpOrderId: meta.mpOrderId ?? null,
        mpPaymentId: meta.mpPaymentId ?? null,
        paidAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return;
  }

  logger.info("reconcile: sourceType no manejado aún", { sourceType, externalReference });
}
