import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

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
  | "cancelled";

type UserRole = "buyer" | "creator";

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
      conflictLabel: "un Meet & Greet",
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
  const creatorJoined = !!data.preparingCreatorAt;
  const buyerJoined = !!data.preparingBuyerAt;

  if (!creatorJoined && !buyerJoined) {
    return {
      status: "rejected" as ExclusiveSessionStatus,
      rejectedAt: now,
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
      status: "rejected" as ExclusiveSessionStatus,
      rejectedAt: now,
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

    const groupId = asTrimmedString(request.data?.groupId, "groupId", 120);
    const buyerMessage = asOptionalTrimmedString(
      request.data?.buyerMessage,
      "buyerMessage",
      1000
    );
    const priceSnapshot = asOptionalFiniteNumber(
      request.data?.priceSnapshot,
      "priceSnapshot",
      { min: 0, max: 1000000 }
    );

    const durationMinutes = asOptionalFiniteNumber(
      request.data?.durationMinutes,
      "durationMinutes",
      { min: 1, max: 600 }
    );

    const groupData = await getGroupOrThrow(groupId);
    await assertExclusiveSessionEligibleMembership(groupId, uid);
    const exclusiveSessionOffering = assertExclusiveSessionEnabled(groupData.data);

    const creatorId = groupData.data.ownerId as string | undefined;
    if (!creatorId) {
      throw new HttpsError("failed-precondition", "El grupo no tiene owner configurado.");
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
      normalizeCurrency(groupData.data?.monetization?.currency) ??
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
      typeof exclusiveSessionOffering?.meta?.customClass?.durationMinutes === "number" &&
      Number.isFinite(exclusiveSessionOffering.meta.customClass.durationMinutes)
        ? exclusiveSessionOffering.meta.customClass.durationMinutes
        : null;

    const resolvedPriceSnapshot = priceSnapshot ?? offeringPrice ?? null;
    const resolvedDurationMinutes = durationMinutes ?? offeringDuration ?? null;
    const payload = {
      id: docRef.id,
      type: "digital_exclusive_session",
      flowVersion: 1,

      groupId,
      groupName: groupData.data.name ?? null,

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

      paymentMode: "simulated_no_real_payment",
      paymentStatus: "simulated_paid",

      createdAt: nowTs(),
      updatedAt: nowTs(),
    };

    await docRef.set(payload);

    logger.info("exclusive_session_request_created", {
      requestId: docRef.id,
      groupId,
      buyerId: uid,
      creatorId,
    });

    return {
      ok: true,
      requestId: docRef.id,
      status: payload.status,
      creatorId,
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
      ["pending_creator_response", "accepted_pending_schedule", "reschedule_requested"],
      "rechazar la solicitud"
    );

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
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const requestId = asTrimmedString(request.data?.requestId, "requestId", 120);
    const scheduledAtIso = asIsoDateString(request.data?.scheduledAt, "scheduledAt");
    const note = asOptionalTrimmedString(request.data?.note, "note", 1000) ?? null;

    const { ref, data } = await getExclusiveSessionOrThrow(requestId);
    ensureCreator(data, uid);
    ensureStatusAllowed(
      data.status as ExclusiveSessionStatus,
      ["accepted_pending_schedule", "reschedule_requested", "scheduled", "ready_to_prepare"],
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

    await ref.update({
      status: nextStatus,
      scheduledAt,
      scheduledBy: uid,
      scheduleProposedAt: nowTs(),
      creatorScheduleNote: note ?? null,
      creatorScheduleNoteUpdatedAt: nowTs(),
      noShowRejectAt: getNoShowRejectAt(scheduledAt),
      autoRejectedAt: null,
      autoRejectReason: null,
      noShowRole: null,
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
      ["scheduled", "ready_to_prepare"],
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
    ensureStatusAllowed(
      data.status as ExclusiveSessionStatus,
      ["rejected"],
      "solicitar devolución"
    );

    await ref.update({
      status: "refund_requested",
      refundReason,
      refundRequestedAt: nowTs(),
      updatedAt: nowTs(),
    });

    logger.info("exclusive_session_refund_requested", {
      requestId,
      buyerId: uid,
      creatorId: data.creatorId,
    });

    return {
      ok: true,
      requestId,
      status: "refund_requested",
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

    if (isNoShowExpired(scheduledAt)) {
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

  docsById.forEach((doc) => {
    const data = doc.data();
    const scheduledAt = data.scheduledAt as TimestampLike | null | undefined;

    if (!scheduledAt) return;
    if (!isNoShowExpired(scheduledAt)) return;
    if (data.preparingCreatorAt && data.preparingBuyerAt) return;

    batch.update(doc.ref, {
      ...getAutoRejectFields(data, now),
      noShowRejectAt: data.noShowRejectAt ?? getNoShowRejectAt(scheduledAt),
    });

    expiredCount += 1;
  });

  if (expiredCount > 0) {
    await batch.commit();
  }

  logger.info("exclusive_session_no_shows_expired_handler", {
    expiredCount,
  });

  return expiredCount;
}

export const expireExclusiveSessionNoShows = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    void uid;

    const expiredCount = await expireExclusiveSessionNoShowsHandler();

    return {
      ok: true,
      expiredCount,
    };
  }
);