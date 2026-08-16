import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { notifySessionEvent } from "./notifications";
import { usersHaveBlockBetween } from "./social/blocks";
import { stripeSecretKey } from "./payments/stripe/stripeClient";
import { capturePaymentIntentForRef, cancelPaymentIntentForRef } from "./payments/stripe/holdCapture";
import { revertBuyerCreditSpend } from "./wallet/buyerCredit";
import { refundExperienceToCredit, mirrorCardReturnPurchase } from "./wallet/refundToCredit";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";
const EXCLUSIVE_SESSION_COLLECTION = "exclusiveSessionRequests";
const MEET_GREET_COLLECTION = "meetGreetRequests";
const MAX_RESCHEDULE_REQUESTS = 2;
const PREPARE_WINDOW_MINUTES = 10;
const JOIN_GRACE_MINUTES = 15;

type ServiceOfferingShape = {
  currency?: unknown;
  memberPrice?: unknown;
  publicPrice?: unknown;
  price?: unknown;
  durationMinutes?: unknown;
  meta?: {
    exclusiveSession?: { durationMinutes?: unknown };
    customClass?: { durationMinutes?: unknown };
  };
};

const ACTIVE_SCHEDULED_STATUSES: ExclusiveSessionStatus[] = [
  "scheduled",
  "ready_to_prepare",
  "in_preparation",
];

type ExclusiveSessionStatus =
  | "pending_creator_response"
  | "accepted_pending_schedule"
  | "scheduled"
  | "reschedule_requested"
  | "rejected"
  | "refund_requested"
  | "refund_review"
  | "ready_to_prepare"
  | "in_preparation"
  | "completed"
  | "session_incomplete"
  | "auto_rejected_no_show"
  | "cancelled";

type UserRole = "buyer" | "creator";
type RequestSource = "group" | "profile";

type TimestampLike = admin.firestore.Timestamp;

function requireAuth(uid?: string): string {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  return uid;
}

function asTrimmedString(value: unknown, fieldName: string, maxLength = 500): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} debe ser string.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} es obligatorio.`);
  }

  if (trimmed.length > maxLength) {
    throw new HttpsError(
      "invalid-argument",
      `El campo ${fieldName} supera el máximo permitido de ${maxLength} caracteres.`
    );
  }

  return trimmed;
}

function asOptionalTrimmedString(
  value: unknown,
  fieldName: string,
  maxLength = 500
): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} debe ser string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.length > maxLength) {
    throw new HttpsError(
      "invalid-argument",
      `El campo ${fieldName} supera el máximo permitido de ${maxLength} caracteres.`
    );
  }

  return trimmed;
}

function asIsoDateString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} debe ser string ISO.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} no es una fecha válida.`);
  }

  return value;
}

function toTimestamp(value: string): TimestampLike {
  return admin.firestore.Timestamp.fromDate(new Date(value));
}

function nowTs(): TimestampLike {
  return admin.firestore.Timestamp.now();
}

function asOptionalFiniteNumber(
  value: unknown,
  fieldName: string,
  options?: { min?: number; max?: number }
): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} debe ser numérico.`);
  }

  if (options?.min != null && value < options.min) {
    throw new HttpsError(
      "invalid-argument",
      `El campo ${fieldName} debe ser mayor o igual a ${options.min}.`
    );
  }

  if (options?.max != null && value > options.max) {
    throw new HttpsError(
      "invalid-argument",
      `El campo ${fieldName} debe ser menor o igual a ${options.max}.`
    );
  }

  return value;
}

function getPrepareWindowStart(scheduleAt: TimestampLike): TimestampLike {
  const scheduleDate = scheduleAt.toDate();
  const prepareDate = new Date(scheduleDate.getTime() - PREPARE_WINDOW_MINUTES * 60 * 1000);
  return admin.firestore.Timestamp.fromDate(prepareDate);
}

async function getGroupOrThrow(groupId: string) {
  const groupRef = db.collection("groups").doc(groupId);
  const snap = await groupRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "El grupo no existe.");
  }

  const data = snap.data() ?? {};
  return { ref: groupRef, data };
}

async function getProfileOrThrow(profileUserId: string) {
  const profileRef = db.collection("users").doc(profileUserId);
  const snap = await profileRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "El perfil no existe.");
  }

  const data = snap.data() ?? {};
  return { ref: profileRef, data };
}

function normalizeCurrency(value: unknown): "MXN" | "USD" | null {
  if (value === "MXN" || value === "USD") return value;
  return null;
}

function getExclusiveSessionOffering(groupData: FirebaseFirestore.DocumentData) {
  const offerings = Array.isArray(groupData.offerings) ? groupData.offerings : [];

  const offering = offerings.find(
    (item) =>
      item &&
      (item.type === "clase_personalizada" ||
        item.type === "custom_class" ||
        item.type === "exclusive_session")
  );

  return offering ?? null;
}

function getProfileExclusiveSessionOffering(
  userData: FirebaseFirestore.DocumentData
) {
  const offerings = Array.isArray(userData.offerings) ? userData.offerings : [];

  return (
    offerings.find(
      (item) =>
        item &&
        (item.type === "clase_personalizada" ||
          item.type === "custom_class" ||
          item.type === "exclusive_session") &&
        item.enabled === true &&
        (item.sourceScope === "profile" ||
          item.sourceScope === "both" ||
          !item.sourceScope)
    ) ?? null
  );
}

function assertProfileExclusiveSessionEnabled(
  userData: FirebaseFirestore.DocumentData
) {
  const offering = getProfileExclusiveSessionOffering(userData);

  if (!offering) {
    throw new HttpsError(
      "failed-precondition",
      "Este perfil no tiene activo el servicio de sesión exclusiva."
    );
  }

  return offering;
}

function assertExclusiveSessionEnabled(groupData: FirebaseFirestore.DocumentData) {
  const monetization = groupData.monetization ?? {};
  const legacyFlag =
    monetization.customClassEnabled === true ||
    monetization.exclusiveSessionEnabled === true;
  const offering = getExclusiveSessionOffering(groupData);

  const offeringEnabled =
    offering &&
    offering.enabled === true &&
    offering.visible !== false &&
    offering.visibility !== "hidden";

  if (!legacyFlag && !offeringEnabled) {
    throw new HttpsError(
      "failed-precondition",
      "Este grupo no tiene activo el servicio de sesión exclusiva."
    );
  }

  return offering;
}

async function assertExclusiveSessionEligibleMembership(groupId: string, uid: string) {
  const memberRef = db.collection("groups").doc(groupId).collection("members").doc(uid);
  const memberSnap = await memberRef.get();

  if (!memberSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Debes tener una membresía válida para solicitar esta sesión exclusiva."
    );
  }

  const memberData = memberSnap.data() ?? {};
  const status = memberData.status ?? null;
  const accessType = memberData.accessType ?? null;
  const legacyComplimentary = memberData.legacyComplimentary === true;

  const joinedStatuses = new Set(["active", "subscribed", "muted"]);
  const blockedStatuses = new Set(["banned", "removed", "kicked", "expelled"]);

  if (blockedStatuses.has(status)) {
    throw new HttpsError(
      "permission-denied",
      "Tu membresía no permite solicitar esta sesión exclusiva."
    );
  }

  const hasJoinedMembership = joinedStatuses.has(status);
  const hasLegacyAccess =
    accessType === "legacy_free" || legacyComplimentary === true;

  if (!hasJoinedMembership && !hasLegacyAccess) {
    throw new HttpsError(
      "permission-denied",
      "Debes tener una membresía válida para solicitar esta sesión exclusiva."
    );
  }

  return memberData;
}

async function getUserProfile(uid: string) {
  const userSnap = await db.collection("users").doc(uid).get();
  const data = userSnap.exists ? userSnap.data() ?? {} : {};

  return {
    displayName:
      data.displayName ??
      data.username ??
      data.handle ??
      data.name ??
      "Usuario",
    username: data.username ?? null,
    avatarUrl: data.photoURL ?? data.avatarUrl ?? null,
  };
}

async function getExclusiveSessionOrThrow(requestId: string) {
  const ref = db.collection(EXCLUSIVE_SESSION_COLLECTION).doc(requestId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "La solicitud de sesión exclusiva no existe.");
  }

  const data = snap.data() ?? {};
  return { ref, data };
}

function ensureBuyer(exclusiveSessionData: FirebaseFirestore.DocumentData, uid: string) {
  if (exclusiveSessionData.buyerId !== uid) {
    throw new HttpsError("permission-denied", "Solo el comprador puede hacer esta acción.");
  }
}

function ensureCreator(exclusiveSessionData: FirebaseFirestore.DocumentData, uid: string) {
  if (exclusiveSessionData.creatorId !== uid) {
    throw new HttpsError("permission-denied", "Solo el creador puede hacer esta acción.");
  }
}

function ensureStatusAllowed(
  currentStatus: ExclusiveSessionStatus,
  allowedStatuses: ExclusiveSessionStatus[],
  actionLabel: string
) {
  if (!allowedStatuses.includes(currentStatus)) {
    throw new HttpsError(
      "failed-precondition",
      `No se puede ${actionLabel} cuando la solicitud está en estado ${currentStatus}.`
    );
  }
}

function buildPreparationStatus(scheduleAt: TimestampLike): ExclusiveSessionStatus {
  const now = Date.now();
  const scheduleMs = scheduleAt.toDate().getTime();
  const prepareStartMs = scheduleMs - PREPARE_WINDOW_MINUTES * 60 * 1000;

  if (now >= prepareStartMs && now < scheduleMs) {
    return "ready_to_prepare";
  }

  return "scheduled";
}

function getNoShowRejectAt(scheduleAt: TimestampLike): TimestampLike {
  const scheduleDate = scheduleAt.toDate();
  const rejectDate = new Date(scheduleDate.getTime() + JOIN_GRACE_MINUTES * 60 * 1000);

  return admin.firestore.Timestamp.fromDate(rejectDate);
}

function getRequiredDurationMinutes(data: FirebaseFirestore.DocumentData): number {
  const directDuration = data.durationMinutes;

  if (
    typeof directDuration === "number" &&
    Number.isFinite(directDuration) &&
    directDuration > 0
  ) {
    return directDuration;
  }

  const snapshotDuration = data.serviceSnapshot?.durationMinutes;

  if (
    typeof snapshotDuration === "number" &&
    Number.isFinite(snapshotDuration) &&
    snapshotDuration > 0
  ) {
    return snapshotDuration;
  }

  throw new HttpsError(
    "failed-precondition",
    "No se puede validar la agenda porque este servicio no tiene duración configurada."
  );
}

function formatScheduleTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Mexico_City",
    }).format(date);
  } catch {
    return date.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

async function assertNoCreatorScheduleConflict(params: {
  creatorId: string;
  requestId: string;
  scheduledAt: TimestampLike;
  durationMinutes: number;
}) {
  const newStartMs = params.scheduledAt.toDate().getTime();
  const newEndMs = newStartMs + params.durationMinutes * 60 * 1000;

  const collectionsToCheck = [
    {
      name: EXCLUSIVE_SESSION_COLLECTION,
      currentRequestBelongsHere: true,
      conflictLabel: "otra sesión exclusiva",
    },
    {
      name: MEET_GREET_COLLECTION,
      currentRequestBelongsHere: false,
      conflictLabel: "una Tiempo contigo",
    },
  ];

  for (const collectionConfig of collectionsToCheck) {
    const snap = await db
      .collection(collectionConfig.name)
      .where("creatorId", "==", params.creatorId)
      .where("status", "in", ACTIVE_SCHEDULED_STATUSES)
      .limit(100)
      .get();

    for (const doc of snap.docs) {
      if (collectionConfig.currentRequestBelongsHere && doc.id === params.requestId) {
        continue;
      }

      const data = doc.data();
      const existingScheduledAt = data.scheduledAt as TimestampLike | null | undefined;

      if (!existingScheduledAt) continue;

      const existingDurationMinutes = getRequiredDurationMinutes(data);
      const existingStartDate = existingScheduledAt.toDate();
      const existingStartMs = existingStartDate.getTime();
      const existingEndDate = new Date(
        existingStartMs + existingDurationMinutes * 60 * 1000
      );
      const existingEndMs = existingEndDate.getTime();

      const hasConflict = newStartMs < existingEndMs && newEndMs > existingStartMs;

      if (hasConflict) {
        const startLabel = formatScheduleTime(existingStartDate);
        const endLabel = formatScheduleTime(existingEndDate);

        throw new HttpsError(
          "failed-precondition",
          `Ya tienes ${collectionConfig.conflictLabel} que inicia a las ${startLabel}, dura ${existingDurationMinutes} minutos y termina a las ${endLabel}. No puedes agendar otro evento dentro de ese horario.`
        );
      }
    }
  }
}

function isNoShowExpired(scheduledAt: TimestampLike): boolean {
  const rejectAtMs = scheduledAt.toDate().getTime() + JOIN_GRACE_MINUTES * 60 * 1000;
  return Date.now() >= rejectAtMs;
}

function getAutoRejectFields(data: FirebaseFirestore.DocumentData, now: TimestampLike) {
  // Se considera "presente" tanto haber abierto la preparación (preparing*At)
  // como haberse conectado realmente a LiveKit (*JoinedAt). Así, un participante
  // que ya está dentro de la sala nunca se marca como no-show aunque el otro
  // aún no haya pulsado "Prepararse".
  const creatorJoined = !!data.preparingCreatorAt || !!data.creatorJoinedAt;
  const buyerJoined = !!data.preparingBuyerAt || !!data.buyerJoinedAt;

  if (!creatorJoined && !buyerJoined) {
    return {
      status: "auto_rejected_no_show" as ExclusiveSessionStatus,
      autoRejectedAt: now,
      autoRejectReason: "both_no_show_after_15_minutes",
      noShowRole: "both",
      rejectionReason:
        "La sesión exclusiva fue rechazada automáticamente porque nadie se conectó dentro de los 15 minutos posteriores a la hora agendada.",
      updatedAt: now,
    };
  }

  if (!creatorJoined) {
    return {
      status: "auto_rejected_no_show" as ExclusiveSessionStatus,
      autoRejectedAt: now,
      autoRejectReason: "creator_no_show_after_15_minutes",
      noShowRole: "creator",
      rejectionReason:
        "El creador no se conectó dentro de los 15 minutos posteriores a la hora agendada.",
      updatedAt: now,
    };
  }

  return {
    status: "rejected" as ExclusiveSessionStatus,
    rejectedAt: now,
    autoRejectedAt: now,
    autoRejectReason: "buyer_no_show_after_15_minutes",
    noShowRole: "buyer",
    rejectionReason:
      "El comprador no se conectó dentro de los 15 minutos posteriores a la hora agendada.",
    updatedAt: now,
  };
}

export const createExclusiveSessionRequest = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);

    const source = (request.data?.source === "profile" ? "profile" : "group") as RequestSource;

const groupId =
  source === "group"
    ? asTrimmedString(request.data?.groupId, "groupId", 120)
    : asOptionalTrimmedString(request.data?.groupId, "groupId", 120);

const profileUserId =
  source === "profile"
    ? asTrimmedString(request.data?.profileUserId, "profileUserId", 120)
    : asOptionalTrimmedString(request.data?.profileUserId, "profileUserId", 120);
    const buyerMessage = asOptionalTrimmedString(
      request.data?.buyerMessage,
      "buyerMessage",
      1000
    );
    // El precio NO se acepta del cliente: es autoritativo del servidor (offeringPrice).
    // Aceptarlo permitiría al comprador dictar cuánto paga por una sesión real.
    const durationMinutes = asOptionalFiniteNumber(
      request.data?.durationMinutes,
      "durationMinutes",
      { min: 1, max: 600 }
    );

    let creatorId: string | undefined;
let groupData: Awaited<ReturnType<typeof getGroupOrThrow>> | null = null;
let profileData: Awaited<ReturnType<typeof getProfileOrThrow>> | null = null;
let exclusiveSessionOffering: ServiceOfferingShape | null = null;

if (source === "profile") {
  if (!profileUserId) {
    throw new HttpsError("invalid-argument", "profileUserId es obligatorio.");
  }

  profileData = await getProfileOrThrow(profileUserId);
  exclusiveSessionOffering = assertProfileExclusiveSessionEnabled(profileData.data) as ServiceOfferingShape;
  creatorId = profileUserId;
  // Bloqueo de perfil: no se puede comprar el servicio si comprador y creador se
  // bloquearon (en cualquier sentido).
  if (await usersHaveBlockBetween(uid, creatorId)) {
    throw new HttpsError(
      "permission-denied",
      "No puedes solicitar este servicio a este perfil."
    );
  }
} else {
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId es obligatorio.");
  }

  groupData = await getGroupOrThrow(groupId);
  await assertExclusiveSessionEligibleMembership(groupId, uid);
  exclusiveSessionOffering = assertExclusiveSessionEnabled(groupData.data) as ServiceOfferingShape;
  creatorId = groupData.data.ownerId as string | undefined;

  if (!creatorId) {
    throw new HttpsError("failed-precondition", "La comunidad no tiene creador configurado.");
  }
}
    if (creatorId === uid) {
      throw new HttpsError(
        "failed-precondition",
        "El creador no puede comprarse a sí mismo una sesión exclusiva."
      );
    }

    const buyerProfile = await getUserProfile(uid);
    const creatorProfile = await getUserProfile(creatorId);

    const docRef = db.collection(EXCLUSIVE_SESSION_COLLECTION).doc();
    const offeringCurrency =
      normalizeCurrency(exclusiveSessionOffering?.currency) ??
      normalizeCurrency(groupData?.data?.monetization?.currency) ??
      "MXN";

    const offeringPrice =
      typeof exclusiveSessionOffering?.memberPrice === "number"
        ? exclusiveSessionOffering.memberPrice
        : typeof exclusiveSessionOffering?.publicPrice === "number"
          ? exclusiveSessionOffering.publicPrice
          : typeof exclusiveSessionOffering?.price === "number"
            ? exclusiveSessionOffering.price
            : null;

    const offeringDuration =
      typeof exclusiveSessionOffering?.durationMinutes === "number" &&
      Number.isFinite(exclusiveSessionOffering.durationMinutes)
        ? exclusiveSessionOffering.durationMinutes
        : typeof exclusiveSessionOffering?.meta?.exclusiveSession?.durationMinutes === "number" &&
            Number.isFinite(exclusiveSessionOffering.meta.exclusiveSession.durationMinutes)
          ? exclusiveSessionOffering.meta.exclusiveSession.durationMinutes
          : typeof exclusiveSessionOffering?.meta?.customClass?.durationMinutes === "number" &&
              Number.isFinite(exclusiveSessionOffering.meta.customClass.durationMinutes)
            ? exclusiveSessionOffering.meta.customClass.durationMinutes
            : null;

    // Precio SIEMPRE del servidor (ignora cualquier priceSnapshot del cliente).
    const resolvedPriceSnapshot = offeringPrice ?? null;
    const resolvedDurationMinutes = durationMinutes ?? offeringDuration ?? null;
        if (
      typeof resolvedDurationMinutes !== "number" ||
      !Number.isFinite(resolvedDurationMinutes) ||
      resolvedDurationMinutes <= 0
    ) {
      throw new HttpsError(
        "failed-precondition",
        "El servicio de sesión exclusiva necesita una duración válida para poder agendarse."
      );
    }
    const payload = {
      id: docRef.id,
      type: "digital_exclusive_session",
      flowVersion: 1,

      groupId: source === "group" ? groupId : null,
      groupName: source === "group" ? groupData?.data.name ?? null : null,
      profileUserId: source === "profile" ? profileUserId : null,
      profileDisplayName: source === "profile" ? creatorProfile.displayName : null,
      profileUsername: source === "profile" ? creatorProfile.username : null,
      source,
      requestSource: source,

      serviceSnapshot: {
        type: "exclusive_session",
        enabled: true,
        currency: offeringCurrency,
        price: resolvedPriceSnapshot,
        durationMinutes: resolvedDurationMinutes,
      },

      buyerId: uid,
      buyerDisplayName: buyerProfile.displayName,
      buyerUsername: buyerProfile.username,
      buyerAvatarUrl: buyerProfile.avatarUrl,

      creatorId,
      creatorDisplayName: creatorProfile.displayName,
      creatorUsername: creatorProfile.username,
      creatorAvatarUrl: creatorProfile.avatarUrl,

      status: "pending_creator_response" as ExclusiveSessionStatus,

      buyerMessage,
      rejectionReason: null,
      refundReason: null,
      refundRequestedAt: null,

      priceSnapshot: resolvedPriceSnapshot,
      currency: offeringCurrency,
      durationMinutes: resolvedDurationMinutes,

      acceptedAt: null,
      rejectedAt: null,

      scheduledAt: null,
      scheduledBy: null,
      scheduleProposedAt: null,
      creatorScheduleNote: null,
      creatorScheduleNoteUpdatedAt: null,
      noShowRejectAt: null,
      autoRejectedAt: null,
      autoRejectReason: null,
      noShowRole: null,
      scheduleHistory: [] as Array<{
        proposedAt: TimestampLike;
        proposedBy: string;
        startsAt: TimestampLike;
        note: string | null;
      }>,

      rescheduleRequestsUsed: 0,
      rescheduleRequestedAt: null,
      rescheduleHistory: [] as Array<{
        requestedAt: TimestampLike;
        requestedBy: string;
        reason: string | null;
        countAfterRequest: number;
      }>,

      preparingBuyerAt: null,
      preparingCreatorAt: null,
      preparationOpenedAt: null,

      // Pago real con Stripe (auth-hold). paymentStatus/createdAt/updatedAt los pone
      // reconcile al materializar (cuando el pago aprueba).
      paymentMode: "stripe",

      // Campos LiveKit — se populan cuando se crea/gestiona la sala de videollamada
      roomName: null,
      livekitRoomId: null,
      livekitEgressId: null,
      roomStatus: "scheduled",
      creatorJoinedAt: null,
      buyerJoinedAt: null,
      startedAt: null,
      endedAt: null,
      recordingStatus: "not_started",
      recordingUrl: null,
      recordingDurationSeconds: null,
    };

    // Pagar-luego-crear: la sesión NO se crea aquí. Exige precio > 0 y guarda la
    // compra (con el payload dentro) en un paymentIntent; la sesión se
    // materializa SOLO cuando el pago aprueba (ver reconcile.ts). Así, intentos
    // de pago fallidos/abandonados no dejan solicitudes huérfanas.
    if (
      typeof resolvedPriceSnapshot !== "number" ||
      resolvedPriceSnapshot <= 0
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Este servicio no tiene un precio configurado."
      );
    }

    const externalReference = `exclusiveSessionRequest__${docRef.id}`;
    await db.collection("paymentIntents").doc(externalReference).set({
      externalReference,
      serviceType: "exclusive_session",
      sourceType: "exclusiveSessionRequest",
      sourceId: docRef.id,
      buyerId: uid,
      creatorId,
      grossAmount: resolvedPriceSnapshot,
      currency: offeringCurrency,
      status: "awaiting_payment",
      pendingSession: payload,
      mpOrderId: null,
      mpPaymentId: null,
      createdAt: nowTs(),
      updatedAt: nowTs(),
    });

    logger.info("exclusive_session_intent_created", {
  requestId: docRef.id,
  groupId,
  profileUserId,
  source,
  buyerId: uid,
  creatorId,
});

    return {
      ok: true,
      requestId: docRef.id,
      status: payload.status,
      creatorId,
      priceSnapshot: resolvedPriceSnapshot,
      source,
      requestSource: source,
      groupId: source === "group" ? groupId : null,
      profileUserId: source === "profile" ? profileUserId : null,
    };
  }
);

export const acceptExclusiveSessionRequest = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const requestId = asTrimmedString(request.data?.requestId, "requestId", 120);

    const { ref, data } = await getExclusiveSessionOrThrow(requestId);
    ensureCreator(data, uid);
    ensureStatusAllowed(
      data.status as ExclusiveSessionStatus,
      ["pending_creator_response"],
      "aceptar la solicitud"
    );

    // Auth-hold: aceptar NO cobra (no hay cobro "al aceptar"). El cobro (captura) ocurre
    // cuando el creador AGENDA la sesión (proposeExclusiveSessionSchedule).
    await ref.update({
      status: "accepted_pending_schedule",
      acceptedAt: nowTs(),
      updatedAt: nowTs(),
    });

    logger.info("exclusive_session_request_accepted", {
      requestId,
      creatorId: uid,
      buyerId: data.buyerId,
    });

    return {
      ok: true,
      requestId,
      status: "accepted_pending_schedule",
    };
  }
);

export const rejectExclusiveSessionRequest = onCall(
  {
    region: REGION,
    cors: true,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const requestId = asTrimmedString(request.data?.requestId, "requestId", 120);
    const rejectionReason = asOptionalTrimmedString(
      request.data?.rejectionReason,
      "rejectionReason",
      1000
    );

    const { ref, data } = await getExclusiveSessionOrThrow(requestId);
    ensureCreator(data, uid);
    ensureStatusAllowed(
      data.status as ExclusiveSessionStatus,
      ["pending_creator_response", "accepted_pending_schedule", "reschedule_requested", "scheduled", "ready_to_prepare", "in_preparation"],
      "rechazar la solicitud"
    );

    // Auth-hold aún sin capturar (rechazo antes de aceptar): CANCELAR la retención
    // ($0 comisión). Si ya se había capturado (rechazo tras aceptar), el hold no existe;
    // el asiento del ledger SIGUE en pending: el rechazo por sí solo ya no revierte
    // (ver `reversedStatuses` en ledgerTriggers). Lo revierte el comprador al pedir
    // devolución (`refund_requested`), y entonces cuenta como devuelto, no como rechazado;
    // y la devolución del dinero al comprador es vía refund → crédito (B5).
    if ((data as { paymentStatus?: string }).paymentStatus === "authorized") {
      await cancelPaymentIntentForRef(`exclusiveSessionRequest__${requestId}`);
      // Saldo a favor usado en parte → se devuelve (el hold no se cobró).
      const buyerId = (data as { buyerId?: string }).buyerId;
      if (buyerId) {
        await revertBuyerCreditSpend(buyerId, { sourceType: "exclusiveSessionRequest", sourceId: requestId });
        // Reflejar en Entregados → "Todo" como "Devuelto a tu tarjeta" (nunca se cobró).
        const gid = (data as { groupId?: string | null }).groupId ?? null;
        await mirrorCardReturnPurchase({
          buyerId,
          creatorId: String(data.creatorId ?? ""),
          sourceType: "exclusiveSessionRequest",
          sourceId: requestId,
          type: "exclusive_session",
          channelType: gid ? "group" : "profile",
          channelId: gid,
        });
      }
    }

    await ref.update({
      status: "rejected",
      rejectionReason,
      rejectedAt: nowTs(),
      updatedAt: nowTs(),
    });

    logger.info("exclusive_session_request_rejected", {
      requestId,
      creatorId: uid,
      buyerId: data.buyerId,
    });

    return {
      ok: true,
      requestId,
      status: "rejected",
    };
  }
);

export const proposeExclusiveSessionSchedule = onCall(
  {
    region: REGION,
    cors: true,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const requestId = asTrimmedString(request.data?.requestId, "requestId", 120);
    const scheduledAtIso = asIsoDateString(request.data?.scheduledAt, "scheduledAt");
    const note = asOptionalTrimmedString(request.data?.note, "note", 1000) ?? null;
    const creatorTimezone = asOptionalTrimmedString(request.data?.creatorTimezone, "creatorTimezone", 100) ?? null;

    const { ref, data } = await getExclusiveSessionOrThrow(requestId);
    ensureCreator(data, uid);
    ensureStatusAllowed(
      data.status as ExclusiveSessionStatus,
      ["accepted_pending_schedule", "reschedule_requested", "scheduled", "ready_to_prepare", "in_preparation", "auto_rejected_no_show"],
      "proponer fecha"
    );

    const scheduledAt = toTimestamp(scheduledAtIso);
    const scheduleDate = scheduledAt.toDate();
    if (scheduleDate.getTime() <= Date.now()) {
      throw new HttpsError("failed-precondition", "La fecha propuesta debe ser futura.");
    }

      await assertNoCreatorScheduleConflict({
  creatorId: uid,
  requestId,
  scheduledAt,
  durationMinutes: getRequiredDurationMinutes(data),
});

    const nextStatus = buildPreparationStatus(scheduledAt);

    // Auth-hold: AGENDAR es el momento en que SE COBRA. Si el pago sigue retenido, se
    // captura ahora → el ledger registra el pending (se liberará al completar la sesión).
    // Idempotente: si ya se capturó (respaldo del día 5 o reagenda), no hace nada.
    const isHold = (data as { paymentStatus?: string }).paymentStatus === "authorized";
    if (isHold) {
      await capturePaymentIntentForRef(`exclusiveSessionRequest__${requestId}`);
    }

    await ref.update({
      status: nextStatus,
      // Captura → cobrado: dispara recordEarning (pending) vía onExclusiveSessionLedger.
      ...(isHold ? { paymentStatus: "paid", paidAt: nowTs() } : {}),
      scheduledAt,
      scheduledBy: uid,
      scheduleProposedAt: nowTs(),
      creatorTimezone: creatorTimezone,
      creatorScheduleNote: note ?? null,
      creatorScheduleNoteUpdatedAt: nowTs(),
      noShowRejectAt: getNoShowRejectAt(scheduledAt),
      autoRejectedAt: null,
      autoRejectReason: null,
      noShowRole: null,
      rejectionReason: null,
      // Reagenda = sesión fresca: limpiar preparación/conexión previas para que
      // el chequeo de no-show del nuevo horario no considere "presente" a nadie.
      preparingBuyerAt: null,
      preparingCreatorAt: null,
      preparationOpenedAt: null,
      creatorJoinedAt: null,
      buyerJoinedAt: null,
      startedAt: null,
      roomStatus: null,
      updatedAt: nowTs(),
      scheduleHistory: admin.firestore.FieldValue.arrayUnion({
        proposedAt: nowTs(),
        proposedBy: uid,
        startsAt: scheduledAt,
        note: note ?? null,
      }),
      rescheduleRequestedAt: null,
    });

    logger.info("exclusive_session_schedule_proposed", {
      requestId,
      creatorId: uid,
      buyerId: data.buyerId,
      scheduledAt: scheduleDate.toISOString(),
    });

    return {
      ok: true,
      requestId,
      status: nextStatus,
      scheduledAt: scheduleDate.toISOString(),
      prepareWindowStartsAt: getPrepareWindowStart(scheduledAt).toDate().toISOString(),
    };
  }
);

export const requestExclusiveSessionReschedule = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const requestId = asTrimmedString(request.data?.requestId, "requestId", 120);
    const reason = asOptionalTrimmedString(request.data?.reason, "reason", 1000);

    const { ref, data } = await getExclusiveSessionOrThrow(requestId);
    ensureBuyer(data, uid);
    ensureStatusAllowed(
      data.status as ExclusiveSessionStatus,
      ["scheduled", "ready_to_prepare", "auto_rejected_no_show"],
      "solicitar cambio de fecha"
    );

    const used = Number(data.rescheduleRequestsUsed ?? 0);
    if (used >= MAX_RESCHEDULE_REQUESTS) {
      throw new HttpsError(
        "failed-precondition",
        "Ya alcanzaste el máximo de solicitudes de cambio de fecha."
      );
    }

    await ref.update({
      status: "reschedule_requested",
      rescheduleRequestsUsed: used + 1,
      rescheduleRequestedAt: nowTs(),
      updatedAt: nowTs(),
      rescheduleHistory: admin.firestore.FieldValue.arrayUnion({
        requestedAt: nowTs(),
        requestedBy: uid,
        reason,
        countAfterRequest: used + 1,
      }),
    });

    logger.info("exclusive_session_reschedule_requested", {
      requestId,
      buyerId: uid,
      creatorId: data.creatorId,
      rescheduleRequestsUsed: used + 1,
    });

    return {
      ok: true,
      requestId,
      status: "reschedule_requested",
      rescheduleRequestsUsed: used + 1,
      maxRescheduleRequests: MAX_RESCHEDULE_REQUESTS,
    };
  }
);

export const declineExclusiveSessionReschedule = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const requestId = asTrimmedString(request.data?.requestId, "requestId", 120);

    const { ref, data } = await getExclusiveSessionOrThrow(requestId);
    ensureCreator(data, uid);
    ensureStatusAllowed(
      data.status as ExclusiveSessionStatus,
      ["reschedule_requested"],
      "declinar cambio de fecha"
    );

    const scheduledAt = data.scheduledAt as TimestampLike | null;
    const nextStatus: ExclusiveSessionStatus =
      scheduledAt ? buildPreparationStatus(scheduledAt) : "scheduled";

    await ref.update({
      status: nextStatus,
      rescheduleRequestedAt: null,
      updatedAt: nowTs(),
    });

    logger.info("exclusive_session_reschedule_declined", {
      requestId,
      creatorId: uid,
      buyerId: data.buyerId,
    });

    return { ok: true, requestId, status: nextStatus };
  }
);

export const requestExclusiveSessionRefund = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const requestId = asTrimmedString(request.data?.requestId, "requestId", 120);
    const refundReason = asOptionalTrimmedString(
      request.data?.refundReason,
      "refundReason",
      1000
    );

    const { ref, data } = await getExclusiveSessionOrThrow(requestId);
    ensureBuyer(data, uid);

    // No-show: si la sesión seguía agendada pero ya venció la tolerancia (el cron
    // que la auto-rechaza corre cada 5 min y aún no pasó), la auto-rechazamos aquí
    // mismo para poder procesar la devolución sin esperar. Mismo estado terminal
    // que produciría el cron (auto_rejected_no_show o rejected según el rol).
    const refundScheduledAt = data.scheduledAt as TimestampLike | null | undefined;
    if (
      ["scheduled", "ready_to_prepare", "in_preparation"].includes(
        data.status as ExclusiveSessionStatus
      ) &&
      refundScheduledAt &&
      isNoShowExpired(refundScheduledAt) &&
      !data.startedAt
    ) {
      const autoRejectFields = getAutoRejectFields(data, nowTs());
      await ref.update(autoRejectFields);
      data.status = autoRejectFields.status;
    }

    ensureStatusAllowed(
      data.status as ExclusiveSessionStatus,
      ["rejected", "auto_rejected_no_show"],
      "solicitar devolución"
    );

    await ref.update({
      status: "refund_requested",
      refundReason,
      refundRequestedAt: nowTs(),
      updatedAt: nowTs(),
    });

    // Devolución → SALDO A FAVOR (síncrono; el trigger es respaldo). Solo si hubo cargo.
    let credited = 0;
    if ((data as { paymentStatus?: string }).paymentStatus === "paid") {
      credited = await refundExperienceToCredit({
        buyerId: uid,
        creatorId: String(data.creatorId ?? ""),
        sourceType: "exclusiveSessionRequest",
        sourceId: requestId,
      });
    }

    logger.info("exclusive_session_refund_requested", {
      requestId,
      buyerId: uid,
      creatorId: data.creatorId,
      credited,
    });

    return {
      ok: true,
      requestId,
      status: "refund_requested",
      credited,
    };
  }
);

export const setExclusiveSessionPreparing = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const requestId = asTrimmedString(request.data?.requestId, "requestId", 120);
    const role = asTrimmedString(request.data?.role, "role", 20) as UserRole;

    if (role !== "buyer" && role !== "creator") {
      throw new HttpsError("invalid-argument", "El role debe ser buyer o creator.");
    }

    const { ref, data } = await getExclusiveSessionOrThrow(requestId);
    const status = data.status as ExclusiveSessionStatus;

    ensureStatusAllowed(
      status,
      ["scheduled", "ready_to_prepare", "in_preparation"],
      "abrir preparación"
    );

    const scheduledAt = data.scheduledAt as TimestampLike | null;
    if (!scheduledAt) {
      throw new HttpsError("failed-precondition", "La solicitud todavía no tiene fecha agendada.");
    }

    if (isNoShowExpired(scheduledAt) && !data.startedAt) {
      const now = nowTs();
      await ref.update(getAutoRejectFields(data, now));

      throw new HttpsError(
        "failed-precondition",
        "Esta sesión exclusiva fue rechazada automáticamente porque no se completó la conexión a tiempo."
      );
    }

    const now = Date.now();
    const startsAtMs = scheduledAt.toDate().getTime();
    const prepareStartMs = startsAtMs - PREPARE_WINDOW_MINUTES * 60 * 1000;

    if (now < prepareStartMs) {
      throw new HttpsError(
        "failed-precondition",
        "La preparación solo se habilita 10 minutos antes de la sesión exclusiva."
      );
    }

    if (role === "buyer") {
      ensureBuyer(data, uid);
    } else {
      ensureCreator(data, uid);
    }

    const updates: Record<string, unknown> = {
      status: "in_preparation",
      preparationOpenedAt: data.preparationOpenedAt ?? nowTs(),
      updatedAt: nowTs(),
    };

    if (role === "buyer") {
      updates.preparingBuyerAt = nowTs();
    } else {
      updates.preparingCreatorAt = nowTs();
    }

    await ref.update(updates);

    // "La otra parte está lista": al abrir preparación por primera vez, avisar
    // a la contraparte. Solo en la primera vez (evita repetir).
    const wasPreparing = role === "buyer" ? !!data.preparingBuyerAt : !!data.preparingCreatorAt;
    if (!wasPreparing) {
      const otherId = role === "buyer" ? data.creatorId : data.buyerId;
      try {
        await notifySessionEvent({
          action: "partner_ready",
          sessionId: requestId,
          sessionType: "exclusive_session",
          recipientIds: [typeof otherId === "string" ? otherId : null],
          actorUid: uid,
        });
      } catch (e) {
        logger.error("session partner_ready notify failed", {
          sessionId: requestId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    logger.info("exclusive_session_preparation_opened", {
      requestId,
      role,
      actorId: uid,
    });

    return {
      ok: true,
      requestId,
      status: "in_preparation",
      role,
    };
  }
);

export async function expireExclusiveSessionNoShowsHandler() {
  const now = nowTs();

  const [byRejectAtSnap, byScheduledAtSnap] = await Promise.all([
    db
      .collection(EXCLUSIVE_SESSION_COLLECTION)
      .where("status", "in", ACTIVE_SCHEDULED_STATUSES)
      .where("noShowRejectAt", "<=", now)
      .limit(100)
      .get(),

    db
      .collection(EXCLUSIVE_SESSION_COLLECTION)
      .where("status", "in", ACTIVE_SCHEDULED_STATUSES)
      .where("scheduledAt", "<=", now)
      .limit(100)
      .get(),
  ]);

  const docsById = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  byRejectAtSnap.docs.forEach((doc) => docsById.set(doc.id, doc));
  byScheduledAtSnap.docs.forEach((doc) => docsById.set(doc.id, doc));

  const batch = db.batch();
  let expiredCount = 0;
  const toNotify: Array<{
    action: "no_show" | "no_show_both";
    recipientIds: Array<string | null>;
    sessionId: string;
  }> = [];

  docsById.forEach((doc) => {
    const data = doc.data();
    const scheduledAt = data.scheduledAt as TimestampLike | null | undefined;

    if (!scheduledAt) return;
    if (!isNoShowExpired(scheduledAt)) return;
    // Presente = preparó ("Prepararse") o ya está conectado a LiveKit (*JoinedAt).
    const creatorPresent = data.preparingCreatorAt || data.creatorJoinedAt;
    const buyerPresent = data.preparingBuyerAt || data.buyerJoinedAt;
    if (creatorPresent && buyerPresent) return;
    if (data.startedAt) return;

    batch.update(doc.ref, {
      ...getAutoRejectFields(data, now),
      noShowRejectAt: data.noShowRejectAt ?? getNoShowRejectAt(scheduledAt),
    });

    expiredCount += 1;

    // Aviso de no-show al afectado (el que sí llegó); si nadie llegó, a ambos.
    const creatorId = typeof data.creatorId === "string" ? data.creatorId : null;
    const buyerId = typeof data.buyerId === "string" ? data.buyerId : null;
    if (!creatorPresent && !buyerPresent) {
      toNotify.push({ action: "no_show_both", recipientIds: [creatorId, buyerId], sessionId: doc.id });
    } else if (!creatorPresent) {
      toNotify.push({ action: "no_show", recipientIds: [buyerId], sessionId: doc.id });
    } else {
      toNotify.push({ action: "no_show", recipientIds: [creatorId], sessionId: doc.id });
    }
  });

  if (expiredCount > 0) {
    await batch.commit();
    for (const n of toNotify) {
      try {
        await notifySessionEvent({
          action: n.action,
          sessionId: n.sessionId,
          sessionType: "exclusive_session",
          recipientIds: n.recipientIds,
        });
      } catch (e) {
        logger.error("session no_show notify failed", {
          sessionId: n.sessionId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  logger.info("exclusive_session_no_shows_expired_handler", {
    expiredCount,
  });

  return expiredCount;
}

// Día en que se CAPTURA la retención (auth-hold) como respaldo si el creador aún no la
// cobró agendando la sesión. El hold de tarjeta expira ~7 días en Stripe, así que se
// captura al 6º día (el cron corre cada 6 h → margen). NO es la ventana de entrega (60
// días); es solo el respaldo interno.
export const HOLD_CAPTURE_DAYS = 6;
// (Legacy: algunos módulos aún importan este nombre; queda como alias del respaldo.)
export const SESSION_RESPONSE_DAYS = HOLD_CAPTURE_DAYS;

export async function autoExpirePendingExclusiveSessionRequestsHandler(): Promise<number> {
  // Respaldo del hold: captura cualquier retención aún "authorized" cercana a expirar,
  // SIN importar el status. NO cambia el status: el creador conserva su ventana para
  // agendar (entregar) o rechazar; esto solo ASEGURA el dinero. El cobro normal ocurre al
  // agendar (proposeExclusiveSessionSchedule). Si nunca se realiza, el comprador podrá
  // pedir devolución → saldo a favor (B5).
  const snap = await db
    .collection(EXCLUSIVE_SESSION_COLLECTION)
    .where("paymentStatus", "==", "authorized")
    .limit(500)
    .get();
  if (snap.empty) return 0;

  const cutoffMs = Date.now() - HOLD_CAPTURE_DAYS * 24 * 60 * 60 * 1000;
  const now = admin.firestore.Timestamp.now();
  let captured = 0;

  await Promise.all(
    snap.docs.map(async (doc) => {
      const createdMs = doc.get("createdAt")?.toMillis?.() ?? 0;
      if (createdMs > cutoffMs) return; // aún dentro de la ventana: no capturar todavía
      try {
        await capturePaymentIntentForRef(`exclusiveSessionRequest__${doc.id}`);
        await doc.ref.update({
          paymentStatus: "paid", // dispara recordEarning (pending) vía onExclusiveSessionLedger
          paidAt: now,
          holdCapturedAt: now,
          updatedAt: now,
        });
        captured++;
      } catch (e) {
        logger.error("exclusive_session_hold_capture_failed", {
          id: doc.id,
          err: e instanceof Error ? e.message : String(e),
        });
        await doc.ref.update({ holdCaptureFailedAt: now, updatedAt: now });
      }
    })
  );

  logger.info("exclusive_session_holds_captured", { captured, scanned: snap.size });
  return captured;
}

// Ventana de ENTREGA (60 días): una sesión YA COBRADA que el creador NUNCA llevó a agendar
// se marca RECHAZADA en automático (igual que un rechazo manual → el comprador puede pedir
// devolución → crédito). Las AGENDADAS que no se realizan ya las cubre el no-show; aquí solo
// caen las que quedaron sin fecha (pendiente de responder / de agendar / de reagenda).
export const DELIVERY_WINDOW_DAYS = 60;
const UNSCHEDULED_CAPTURED_STATUSES = [
  "pending_creator_response",
  "accepted_pending_schedule",
  "reschedule_requested",
];

export async function autoRejectUndeliveredExclusiveSessionRequestsHandler(): Promise<number> {
  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - DELIVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  );
  const snap = await db
    .collection(EXCLUSIVE_SESSION_COLLECTION)
    .where("paymentStatus", "==", "paid")
    .where("createdAt", "<=", cutoff)
    .limit(200)
    .get();
  if (snap.empty) return 0;

  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();
  let n = 0;
  snap.docs.forEach((doc) => {
    const status = String(doc.get("status") ?? "");
    if (!UNSCHEDULED_CAPTURED_STATUSES.includes(status)) return;
    batch.update(doc.ref, {
      status: "rejected" as ExclusiveSessionStatus,
      rejectionReason: "El creador no realizó la sesión dentro de los 60 días.",
      autoRejectedNoDeliveryAt: now,
      rejectedAt: now,
      updatedAt: now,
    });
    n++;
  });
  if (n > 0) await batch.commit();
  logger.info("auto_reject_undelivered_exclusive_sessions", { rejected: n, scanned: snap.size });
  return n;
}
