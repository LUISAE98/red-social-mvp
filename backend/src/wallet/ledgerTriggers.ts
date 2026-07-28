/**
 * Triggers de Firestore que alimentan el libro mayor de wallet (Fase 2).
 *
 * Cada trigger observa la colección donde un servicio registra su "pagar"
 * (simulado hoy, real cuando exista Mercado Pago) y llama a los helpers de
 * `./ledger` en el momento correcto. Son idempotentes (el helper usa un id
 * determinista por venta), así que reintentos/duplicados no doblan ganancias.
 *
 * Cobertura (10 de 11 servicios; falta #2 donaciones en perfil, sin pago aún):
 *  - #1 supercomentarios + #3 donaciones en live → posts/{id}/superComments
 *  - #4 ticket de acceso a live               → liveAccess/{liveId}/users/{uid}
 *  - #5 post premium + #11 VOD                → postAccess/{accessId}
 *  - #10 suscripción                          → groups/{groupId}/members/{uid}
 *  - #6 saludos + #7 consejos                 → greetingRequests/{id}
 *  - #8 sesiones exclusivas                   → exclusiveSessionRequests/{id}
 *  - #9 sesiones en vivo                      → meetGreetRequests/{id}
 */

import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  recordEarning,
  settleEarning,
  reverseEarning,
  type LedgerServiceType,
} from "./ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
/** Canal de la venta: si hay groupId → comunidad; si no → perfil. */
function channelFromGroupId(groupId: string | null): {
  channelType: "profile" | "group";
  channelId: string | null;
} {
  return groupId
    ? { channelType: "group", channelId: groupId }
    : { channelType: "profile", channelId: null };
}

// ───────────────────────────── Grupo A (ganan al pagar) ─────────────────────

/** #1 supercomentarios + #3 donaciones en live (superComment sin texto). */
export const onSuperCommentLedger = onDocumentCreated(
  { document: "posts/{postId}/superComments/{scId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (data.status !== "paid") return;

    const gross = num(data.amount);
    if (gross <= 0) return;

    const { postId, scId } = event.params;
    const postSnap = await db.collection("posts").doc(postId).get();
    const authorId = str(postSnap.get("authorId"));
    if (!authorId) return;

    const hasText = str(data.text) !== null;
    // Live si el post es una transmisión (tiene liveData). Un supercomment sin
    // texto (donación) siempre ocurre en un live; uno con texto puede ser en
    // un post normal, así que revisamos liveData.
    const isLive = postSnap.get("liveData") != null;

    await recordEarning(authorId, {
      type: hasText ? "supercomment" : "live_donation",
      grossAmount: gross,
      taxCountry: str(data.taxCountry),
      taxAmount: num(data.taxAmount),
      sourceType: "superComment",
      sourceId: `${postId}_${scId}`,
      buyerId: str(data.userId) ?? str(data.guestId),
      earnedImmediately: true,
      occurredAt: data.createdAt,
      liveId: isLive ? postId : null,
      ...channelFromGroupId(str(postSnap.get("groupId"))),
    });
  }
);

/** #4 ticket de acceso a live. */
export const onLiveAccessLedger = onDocumentCreated(
  { document: "liveAccess/{liveId}/users/{userId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (data.status !== "paid") return;

    const gross = num(data.amount);
    const authorId = str(data.authorId);
    if (gross <= 0 || !authorId) return;

    await recordEarning(authorId, {
      type: "live_ticket",
      grossAmount: gross,
      taxCountry: str(data.taxCountry),
      taxAmount: num(data.taxAmount),
      sourceType: "liveAccess",
      sourceId: `${event.params.liveId}_${event.params.userId}`,
      buyerId: event.params.userId,
      earnedImmediately: true,
      occurredAt: data.createdAt,
      // El doc guarda el postId real del live; si no, el id del contenedor.
      liveId: str(data.postId) ?? event.params.liveId,
      ...channelFromGroupId(str(data.groupId)),
    });
  }
);

/** #5 post premium + #11 VOD (mismo postAccess; se distingue leyendo el post). */
export const onPostAccessLedger = onDocumentWritten(
  { document: "postAccess/{accessId}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data() as Record<string, unknown>;
    if (data.status !== "active") return;

    // Solo al entrar en "active" (evita reprocesar en updates posteriores).
    const before = event.data?.before;
    if (before?.exists && before.data()?.status === "active") return;

    const postId = str(data.postId);
    if (!postId) return;

    const postSnap = await db.collection("posts").doc(postId).get();
    const postData = postSnap.exists ? (postSnap.data() as Record<string, unknown>) : null;

    // Creador: prefiere el del doc; si no, el autor del post.
    const creatorId = str(data.creatorId) ?? str(postData?.authorId);
    if (!creatorId) return;

    // Monto: prefiere el del doc; si no, el precio premium del post.
    let gross = num(data.price);
    if (gross <= 0 && postData) {
      const premium = postData.premium as { oneTimePrice?: unknown } | null | undefined;
      gross = num(premium?.oneTimePrice);
    }
    if (gross <= 0) {
      logger.warn("postAccess_ledger_skipped_no_price", { accessId: event.params.accessId, postId });
      return;
    }

    // VOD si el post es una transmisión (tiene liveData); si no, post premium.
    const isVod = postData?.liveData != null;

    // Canal: groupId denormalizado en el postAccess; si no, el del post.
    const groupId = str(data.groupId) ?? str(postData?.groupId);

    await recordEarning(creatorId, {
      type: isVod ? "vod_ticket" : "premium_post",
      grossAmount: gross,
      taxCountry: str(data.taxCountry),
      taxAmount: num(data.taxAmount),
      sourceType: "postAccess",
      sourceId: event.params.accessId,
      buyerId: str(data.buyerId),
      earnedImmediately: true,
      occurredAt: data.createdAt,
      // VOD = venta de la grabación de un live → atribuir al post del live.
      liveId: isVod ? postId : null,
      // Publicación de origen (para la pestaña Tickets: premium + VOD).
      postId,
      ...channelFromGroupId(groupId),
    });
  }
);

/**
 * #10 suscripción a grupo. Se observa el doc de membresía del USUARIO
 * (users/{uid}/groupMemberships/{groupId}) porque ese sí incluye `ownerId`
 * (el doc de groups/{}/members/{} no lo trae).
 */
export const onGroupSubscriptionLedger = onDocumentWritten(
  { document: "users/{uid}/groupMemberships/{groupId}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data() as Record<string, unknown>;

    const isActiveSub =
      data.accessType === "subscription" && data.subscriptionActive === true;
    if (!isActiveSub) return;

    // Suscripciones reales por MP (preapproval): el earning lo registra el webhook
    // `subscription_authorized_payment` por CADA cobro mensual. Aquí no se cuenta
    // (evita doble contabilidad). Solo el flujo simulado legacy pasa por este trigger.
    if (data.mpManaged === true) return;

    // Solo cuando la suscripción se activa (no en cada escritura del miembro).
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const wasActiveSub =
      before?.accessType === "subscription" && before?.subscriptionActive === true;
    if (wasActiveSub) return;

    const ownerId = str(data.ownerId);
    const gross = num(data.subscriptionPriceMonthly);
    if (!ownerId || gross <= 0) return;

    const { groupId, uid } = event.params;
    if (ownerId === uid) return; // el dueño no se paga a sí mismo

    await recordEarning(ownerId, {
      type: "subscription",
      grossAmount: gross,
      sourceType: "groupSubscription",
      sourceId: `${groupId}_${uid}`,
      buyerId: uid,
      earnedImmediately: true,
      occurredAt: data.subscribedAt ?? data.joinedAt ?? data.updatedAt,
      channelType: "group",
      channelId: groupId,
    });
  }
);

/**
 * Baja/churn de suscripción. Cancelar = `leaveGroup()` BORRA la membresía
 * (users/{uid}/groupMemberships/{groupId}). Si la que se borra era una
 * suscripción activa, registramos el evento para el dueño (para calcular bajas).
 */
export const onGroupSubscriptionChurn = onDocumentDeleted(
  { document: "users/{uid}/groupMemberships/{groupId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();

    const wasActiveSub =
      data.accessType === "subscription" && data.subscriptionActive === true;
    if (!wasActiveSub) return;

    const ownerId = str(data.ownerId);
    if (!ownerId) return;

    const { groupId, uid } = event.params;
    if (ownerId === uid) return;

    await db
      .collection("users")
      .doc(ownerId)
      .collection("subscriptionEvents")
      .doc(event.id) // idempotente ante reintentos del mismo evento
      .set({
        type: "cancel",
        groupId,
        subscriberId: uid,
        priceMonthly: num(data.subscriptionPriceMonthly),
        occurredAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  }
);

/** #2 donaciones en perfil (pago simulado). Canal = perfil. */
export const onProfileDonationLedger = onDocumentCreated(
  { document: "profileDonations/{donationId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();

    const paid =
      data.paymentStatus === "simulated_paid" || data.paymentStatus === "paid";
    if (!paid) return;

    const gross = num(data.amount);
    const creatorId = str(data.creatorId);
    const buyerId = str(data.buyerId);
    if (!creatorId || gross <= 0) return;
    if (buyerId === creatorId) return; // no se dona a sí mismo

    await recordEarning(creatorId, {
      type: "profile_donation",
      grossAmount: gross,
      taxCountry: str(data.taxCountry),
      taxAmount: num(data.taxAmount),
      sourceType: "profileDonation",
      sourceId: event.params.donationId,
      buyerId,
      earnedImmediately: true,
      occurredAt: data.createdAt,
      channelType: "profile",
      channelId: null,
    });
  }
);

// ─────────────── Grupo B (pendiente al pagar → ganado al entregar) ───────────

/**
 * Ciclo de vida común de servicios "request": pending al pagar → ganado al
 * entregar/concluir → revertido al rechazar/reembolsar.
 */
async function handleRequestLifecycle(params: {
  before: Record<string, unknown> | undefined;
  after: Record<string, unknown> | undefined;
  requestId: string;
  sourceType: string;
  resolveType: (data: Record<string, unknown>) => LedgerServiceType;
  deliveredStatuses: string[];
  reversedStatuses: string[];
}): Promise<void> {
  const { before, after } = params;
  if (!after) return; // borrado: ignorar

  const creatorId = str(after.creatorId);
  if (!creatorId) return;

  const beforeStatus = before ? String(before.status ?? "") : "";
  const afterStatus = String(after.status ?? "");

  // 1) Pagado → registrar pendiente. Con MP real el pago se confirma DESPUÉS de
  //    crear la solicitud (awaiting_payment → paid vía webhook), así que también
  //    disparamos en la transición a pagado, no solo al crear ya-pagado (legacy
  //    simulado). recordEarning es idempotente → nunca dobla la ganancia.
  const isPaid =
    after.paymentStatus === "simulated_paid" || after.paymentStatus === "paid";
  const wasPaid = before
    ? before.paymentStatus === "simulated_paid" || before.paymentStatus === "paid"
    : false;
  if (isPaid && !wasPaid) {
    const gross = num(after.priceSnapshot);
    if (gross > 0) {
      await recordEarning(creatorId, {
        type: params.resolveType(after),
        grossAmount: gross,
        taxCountry: str(after.taxCountry),
        taxAmount: num(after.taxAmount),
        sourceType: params.sourceType,
        sourceId: params.requestId,
        buyerId: str(after.buyerId),
        earnedImmediately: false,
        occurredAt: after.createdAt,
        ...channelFromGroupId(str(after.groupId)),
      });
    }
    return;
  }

  // 2) Entregado / concluido → liberar (pending → earned).
  if (
    params.deliveredStatuses.includes(afterStatus) &&
    !params.deliveredStatuses.includes(beforeStatus)
  ) {
    await settleEarning(creatorId, params.sourceType, params.requestId);
    return;
  }

  // 3) Rechazado / reembolsado → revertir.
  if (
    params.reversedStatuses.includes(afterStatus) &&
    !params.reversedStatuses.includes(beforeStatus)
  ) {
    await reverseEarning(creatorId, params.sourceType, params.requestId);
  }
}

/** #6 saludos + #7 consejos (misma colección; el tipo distingue). */
export const onGreetingLedger = onDocumentWritten(
  { document: "greetingRequests/{requestId}", region: REGION },
  async (event) => {
    await handleRequestLifecycle({
      before: event.data?.before?.data(),
      after: event.data?.after?.data(),
      requestId: event.params.requestId,
      sourceType: "greetingRequest",
      resolveType: (d) => (d.type === "consejo" ? "advice" : "greeting"),
      deliveredStatuses: ["delivered"],
      reversedStatuses: ["rejected", "refund_requested"],
    });
  }
);

/** #8 sesiones exclusivas. */
export const onExclusiveSessionLedger = onDocumentWritten(
  { document: "exclusiveSessionRequests/{requestId}", region: REGION },
  async (event) => {
    await handleRequestLifecycle({
      before: event.data?.before?.data(),
      after: event.data?.after?.data(),
      requestId: event.params.requestId,
      sourceType: "exclusiveSessionRequest",
      resolveType: () => "exclusive_session",
      deliveredStatuses: ["completed"],
      reversedStatuses: ["rejected", "refund_requested"],
    });
  }
);

/** #9 sesiones en vivo (meet & greet). */
export const onMeetGreetLedger = onDocumentWritten(
  { document: "meetGreetRequests/{requestId}", region: REGION },
  async (event) => {
    await handleRequestLifecycle({
      before: event.data?.before?.data(),
      after: event.data?.after?.data(),
      requestId: event.params.requestId,
      sourceType: "meetGreetRequest",
      resolveType: () => "live_session",
      deliveredStatuses: ["completed"],
      reversedStatuses: ["rejected", "refund_requested"],
    });
  }
);
