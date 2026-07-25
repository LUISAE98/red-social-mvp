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
 * Materializa el documento de dominio a partir del payload guardado en el
 * paymentIntent (campo `pendingField`). Idempotente: si el doc ya existe (el
 * webhook y la respuesta síncrona compiten), no hace nada. Helper interno; el
 * despacho por servicio es explícito en applyApprovedPaymentToSource.
 */
async function materializeFromIntent(
  externalReference: string,
  targetCollection: string,
  sourceId: string,
  pendingField: string,
  meta: { mpOrderId?: string | null; mpPaymentId?: string | null }
): Promise<void> {
  const targetRef = db.doc(`${targetCollection}/${sourceId}`);
  const intentRef = db.collection("paymentIntents").doc(externalReference);

  await db.runTransaction(async (tx) => {
    const [targetSnap, intentSnap] = await Promise.all([
      tx.get(targetRef),
      tx.get(intentRef),
    ]);

    if (targetSnap.exists) return; // ya materializado (idempotente)

    const pending = intentSnap.exists
      ? (intentSnap.data()?.[pendingField] as Record<string, unknown> | undefined)
      : undefined;
    if (!pending || typeof pending !== "object") {
      logger.warn("reconcile: sin payload para materializar", {
        externalReference,
        pendingField,
      });
      return;
    }

    const now = FieldValue.serverTimestamp();
    tx.set(targetRef, {
      ...pending,
      paymentStatus: "paid",
      mpOrderId: meta.mpOrderId ?? null,
      mpPaymentId: meta.mpPaymentId ?? null,
      paidAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

/**
 * Aplica un pago APROBADO al documento de origen. Idempotente.
 *
 * Pagar-luego-crear: el documento de dominio NO existe hasta que el pago
 * aprueba; aquí se MATERIALIZA a partir del paymentIntent. El despacho es
 * EXPLÍCITO por servicio (cada uno con su colección y su campo pending), para
 * poder manejar diferencias por servicio sin una abstracción prematura.
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
    await materializeFromIntent(externalReference, "greetingRequests", sourceId, "pendingGreeting", meta);
    return;
  }

  if (sourceType === "exclusiveSessionRequest") {
    await materializeFromIntent(externalReference, "exclusiveSessionRequests", sourceId, "pendingSession", meta);
    return;
  }

  if (sourceType === "meetGreetRequest") {
    await materializeFromIntent(externalReference, "meetGreetRequests", sourceId, "pendingMeetGreet", meta);
    return;
  }

  if (sourceType === "postAccess") {
    // Desbloqueo de post premium / VOD: materializa postAccess/{buyerId}_{postId}
    // en "active" (dispara ledger + contador de desbloqueos).
    await materializeFromIntent(externalReference, "postAccess", sourceId, "pendingPostAccess", meta);
    return;
  }

  if (sourceType === "profileDonation") {
    // Donación a perfil: materializa profileDonations/{donationId} (paymentStatus
    // "paid" → dispara onProfileDonationLedger).
    await materializeFromIntent(externalReference, "profileDonations", sourceId, "pendingProfileDonation", meta);
    return;
  }

  logger.info("reconcile: sourceType no manejado aún", { sourceType, externalReference });
}
