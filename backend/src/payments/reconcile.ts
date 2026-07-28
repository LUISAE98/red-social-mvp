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

/**
 * Parte un `external_reference` con forma `{sourceType}__{sourceId}` por el
 * PRIMER "__". Devuelve null si no trae separador. Puro (testeable sin Firestore).
 */
export function parseExternalReference(
  externalReference: string
): { sourceType: string; sourceId: string } | null {
  const sep = externalReference.indexOf("__");
  if (sep < 0) return null;
  return {
    sourceType: externalReference.slice(0, sep),
    sourceId: externalReference.slice(sep + 2),
  };
}

/**
 * Parte un id compuesto `{head}_{tail}` por el PRIMER "_". Lo usan liveAccess,
 * liveDonation y superComment, cuyo `sourceId` embebe dos ids. null si no hay "_".
 */
export function splitCompoundId(
  id: string
): { head: string; tail: string } | null {
  const sep = id.indexOf("_");
  if (sep < 0) return null;
  return { head: id.slice(0, sep), tail: id.slice(sep + 1) };
}

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

    const intentData = intentSnap.exists ? intentSnap.data() : undefined;
    const pending = intentData?.[pendingField] as Record<string, unknown> | undefined;
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
      // 🧾 IVA — Copiamos el desglose fiscal del intent al doc de dominio para que el
      // trigger del ledger lo registre y el creador vea "IVA cobrado (va al SAT)". El
      // IVA NO es del creador; su ganancia sigue calculándose sobre la base (amount).
      taxCountry: (intentData?.taxCountry as string | null) ?? null,
      taxAmount: typeof intentData?.taxAmount === "number" ? intentData.taxAmount : 0,
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
  const parsed = parseExternalReference(externalReference);
  if (!parsed) {
    logger.warn("reconcile: external_reference sin separador", { externalReference });
    return;
  }
  const { sourceType, sourceId } = parsed;

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

  if (sourceType === "liveAccess") {
    // Ticket de en vivo: sourceId = `${liveId}_${userId}`. Materializa el doc
    // anidado liveAccess/{liveId}/users/{userId} (status "paid" → dispara ledger).
    const split = splitCompoundId(sourceId);
    if (!split) {
      logger.warn("reconcile: liveAccess sourceId sin separador", { externalReference });
      return;
    }
    const liveId = split.head;
    const userId = split.tail;
    await materializeFromIntent(externalReference, `liveAccess/${liveId}/users`, userId, "pendingLiveAccess", meta);
    return;
  }

  if (sourceType === "liveDonation") {
    // Donación en vivo: sourceId = `${postId}_${donationId}`. Materializa el super-
    // comentario posts/{postId}/superComments/{donationId} (status "paid" → dispara
    // onSuperCommentLedger con earning live_donation, y lo muestra en el chat del live).
    const split = splitCompoundId(sourceId);
    if (!split) {
      logger.warn("reconcile: liveDonation sourceId sin separador", { externalReference });
      return;
    }
    const postId = split.head;
    const donationId = split.tail;
    await materializeFromIntent(externalReference, `posts/${postId}/superComments`, donationId, "pendingLiveDonation", meta);
    return;
  }

  if (sourceType === "superComment") {
    // Supercomentario en vivo: sourceId = `${postId}_${scId}`. Materializa el super-
    // comentario posts/{postId}/superComments/{scId} (status "paid" → dispara
    // onSuperCommentLedger con earning `supercomment`, y lo muestra en el chat del live).
    const split = splitCompoundId(sourceId);
    if (!split) {
      logger.warn("reconcile: superComment sourceId sin separador", { externalReference });
      return;
    }
    const postId = split.head;
    const scId = split.tail;
    await materializeFromIntent(externalReference, `posts/${postId}/superComments`, scId, "pendingSuperComment", meta);
    return;
  }

  logger.info("reconcile: sourceType no manejado aún", { sourceType, externalReference });
}
