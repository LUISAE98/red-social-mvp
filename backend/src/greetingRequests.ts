import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { createMuxClient, muxTokenId, muxTokenSecret } from "./mux";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

type GreetingType = "saludo" | "consejo";
type GreetingStatus = "pending" | "accepted" | "rejected" | "refund_requested";
type GreetingSource = "group" | "profile";

type GroupMonetizationShape = {
  greetingsEnabled?: boolean;
  adviceEnabled?: boolean;
  subscriptionsEnabled?: boolean;
  paidPostsEnabled?: boolean;
  paidLivesEnabled?: boolean;
  paidVodEnabled?: boolean;
  paidLiveCommentsEnabled?: boolean;
  customClassEnabled?: boolean;
  digitalMeetGreetEnabled?: boolean;
};

type GroupOfferingShape = {
  type?: string;
  enabled?: boolean;
  visible?: boolean;
  visibility?: string;
  displayOrder?: number | null;
  memberPrice?: number | null;
  publicPrice?: number | null;
  currency?: string | null;
  requiresApproval?: boolean;
  sourceScope?: string;
  meta?: unknown;
  price?: number | null;
};

type GroupShape = {
  ownerId?: string;
  greetingsEnabled?: boolean;
  monetization?: GroupMonetizationShape | null;
  offerings?: GroupOfferingShape[] | null;
};

type UserShape = {
  uid?: string;
  handle?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string | null;
  offerings?: GroupOfferingShape[] | null;
};

function assertString(value: unknown, field: string, maxLen = 300): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string`);
  }

  const v = value.trim();
  if (!v) {
    throw new HttpsError("invalid-argument", `${field} is required`);
  }

  if (v.length > maxLen) {
    throw new HttpsError(
      "invalid-argument",
      `${field} is too long (max ${maxLen})`
    );
  }

  return v;
}

function assertOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be one of: ${allowed.join(", ")}`
    );
  }

  return value as T;
}

function isEnabledOffering(
  offerings: GroupOfferingShape[] | null | undefined,
  type: GreetingType
): boolean {
  const arr = Array.isArray(offerings) ? offerings : [];
  return arr.some(
    (offering) => offering?.type === type && offering?.enabled === true
  );
}

function isGreetingServiceEnabled(group: GroupShape, type: GreetingType): boolean {
  const monetization = group?.monetization ?? null;
  const offerings = Array.isArray(group?.offerings) ? group.offerings : [];

  if (type === "saludo") {
    if (typeof monetization?.greetingsEnabled === "boolean") {
      return monetization.greetingsEnabled;
    }

    if (isEnabledOffering(offerings, "saludo")) {
      return true;
    }

    if (typeof group?.greetingsEnabled === "boolean") {
      return group.greetingsEnabled;
    }

    return false;
  }

  if (type === "consejo") {
    if (typeof monetization?.adviceEnabled === "boolean") {
      return monetization.adviceEnabled;
    }

    if (isEnabledOffering(offerings, "consejo")) {
      return true;
    }

    return false;
  }

  return false;
}

function isProfileGreetingServiceEnabled(user: UserShape, type: GreetingType): boolean {
  const offerings = Array.isArray(user?.offerings) ? user.offerings : [];

  return offerings.some((offering) => {
    if (offering?.type !== type) return false;
    if (offering?.enabled !== true) return false;

    const scope = offering?.sourceScope;
    return scope === "profile" || scope === "both" || !scope;
  });
}

function getOfferingPrice(offerings: GroupOfferingShape[] | null | undefined, type: GreetingType): number | null {
  const arr = Array.isArray(offerings) ? offerings : [];
  const offering = arr.find((o) => o?.type === type && o?.enabled === true);
  if (!offering) return null;
  if (typeof offering.memberPrice === "number" && offering.memberPrice > 0) return offering.memberPrice;
  if (typeof offering.publicPrice === "number" && offering.publicPrice > 0) return offering.publicPrice;
  if (typeof offering.price === "number" && offering.price > 0) return offering.price;
  return null;
}

function buildUserDisplayName(user: UserShape, fallbackUid: string): string {
  const displayName = user.displayName?.trim();
  if (displayName) return displayName;

  const fullName = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) return fullName;

  return `Usuario ${fallbackUid.slice(0, 6)}`;
}

function normalizeMemberStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return value || null;
}

function canBuyerRequestByMembership(
  memberData: FirebaseFirestore.DocumentData | undefined
) {
  if (!memberData) return false;

  const status = normalizeMemberStatus(memberData.status);
  const accessType = normalizeMemberStatus(memberData.accessType);
  const legacyComplimentary = memberData.legacyComplimentary === true;

  if (!status) return false;

  const joinedStatuses = new Set(["active", "subscribed", "muted"]);
  const blockedStatuses = new Set(["banned", "removed", "kicked", "expelled"]);

  if (blockedStatuses.has(status)) {
    return false;
  }

  const hasJoinedMembership = joinedStatuses.has(status);
  const hasLegacyAccess =
    accessType === "legacy_free" || legacyComplimentary === true;

  return hasJoinedMembership || hasLegacyAccess;
}

// 1) Crear solicitud de saludo/consejo
export const createGreetingRequest = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const buyerId = auth.uid;

    const rawSource = request.data?.source ?? "group";
const source = assertOneOf<GreetingSource>(rawSource, "source", [
  "group",
  "profile",
]);

const groupId =
  source === "group"
    ? assertString(request.data?.groupId, "groupId", 120)
    : typeof request.data?.groupId === "string" && request.data.groupId.trim()
      ? request.data.groupId.trim()
      : null;

const profileUserId =
  source === "profile"
    ? assertString(request.data?.profileUserId, "profileUserId", 120)
    : typeof request.data?.profileUserId === "string" &&
        request.data.profileUserId.trim()
      ? request.data.profileUserId.trim()
      : null;
    const type = assertOneOf<GreetingType>(request.data?.type, "type", [
      "saludo",
      "consejo",
    ]);
    const toName = assertString(request.data?.toName, "toName", 80);
    const instructions = assertString(
      request.data?.instructions,
      "instructions",
      1000
    );
    const allowCreatorStory = request.data?.allowCreatorStory === true;

    const result = await db.runTransaction(async (tx) => {
  const now = admin.firestore.FieldValue.serverTimestamp();
  // Pagar-luego-crear: el saludo NO se crea aquí. Pre-generamos su id y
  // guardamos la compra en un paymentIntent (con los datos del saludo dentro).
  // El saludo se materializa SOLO cuando el pago aprueba (ver reconcile.ts).
  // Así, intentos de pago fallidos/abandonados no dejan saludos huérfanos.
  const greetingId = db.collection("greetingRequests").doc().id;
  const externalReference = `greetingRequest__${greetingId}`;
  const intentRef = db.collection("paymentIntents").doc(externalReference);

  let creatorId: string;
  let priceSnapshot: number | null;
  let greetingBase: Record<string, unknown>;

  if (source === "profile") {
    if (!profileUserId) {
      throw new HttpsError("invalid-argument", "profileUserId is required.");
    }

    const profileSnap = await tx.get(db.doc(`users/${profileUserId}`));
    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }

    const profile = (profileSnap.data() ?? {}) as UserShape;
    creatorId = profileUserId;

    if (buyerId === creatorId) {
      throw new HttpsError(
        "failed-precondition",
        "Creator cannot request own service."
      );
    }

    if (!isProfileGreetingServiceEnabled(profile, type)) {
      throw new HttpsError(
        "failed-precondition",
        "This service is not enabled for this profile."
      );
    }

    priceSnapshot = getOfferingPrice(profile.offerings, type);
    greetingBase = {
      groupId: null,
      profileUserId,
      profileDisplayName: buildUserDisplayName(profile, profileUserId),
      profileUsername: profile.handle ?? null,
      creatorId,
      buyerId,
      type,
      toName,
      instructions,
      source,
      requestSource: "profile",
      status: "pending" as GreetingStatus,
      priceSnapshot,
      currency: "MXN",
      paymentMode: "mercadopago",
      allowCreatorStory,
    };
  } else {
    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId is required.");
    }

    const [groupSnap, memberSnap] = await Promise.all([
      tx.get(db.doc(`groups/${groupId}`)),
      tx.get(db.doc(`groups/${groupId}/members/${buyerId}`)),
    ]);

    if (!groupSnap.exists) {
      throw new HttpsError("not-found", "Group not found.");
    }

    const group = (groupSnap.data() ?? {}) as GroupShape;
    const ownerId = group?.ownerId;

    if (!ownerId) {
      throw new HttpsError("failed-precondition", "Group has no ownerId.");
    }

    if (buyerId === ownerId) {
      throw new HttpsError(
        "failed-precondition",
        "Owner cannot purchase own greeting."
      );
    }

    if (!memberSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "You must be a member of the group to request a greeting."
      );
    }

    if (!canBuyerRequestByMembership(memberSnap.data())) {
      throw new HttpsError(
        "permission-denied",
        "Your membership status does not allow requesting this service."
      );
    }

    if (!isGreetingServiceEnabled(group, type)) {
      throw new HttpsError(
        "failed-precondition",
        "This service is not enabled for this group."
      );
    }

    creatorId = ownerId;
    priceSnapshot = getOfferingPrice(group.offerings, type);
    greetingBase = {
      groupId,
      profileUserId: null,
      creatorId,
      buyerId,
      type,
      toName,
      instructions,
      source,
      requestSource: "group",
      status: "pending" as GreetingStatus,
      priceSnapshot,
      currency: "MXN",
      paymentMode: "mercadopago",
      allowCreatorStory,
    };
  }

  // El cobro exige un precio positivo (servicio monetizado).
  if (typeof priceSnapshot !== "number" || priceSnapshot <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Este servicio no tiene un precio configurado."
    );
  }

  tx.set(intentRef, {
    externalReference,
    serviceType: type === "consejo" ? "advice" : "greeting",
    sourceType: "greetingRequest",
    sourceId: greetingId,
    buyerId,
    creatorId,
    grossAmount: priceSnapshot,
    currency: "MXN",
    status: "awaiting_payment",
    // Datos del saludo a materializar cuando el pago apruebe.
    pendingGreeting: greetingBase,
    mpOrderId: null,
    mpPaymentId: null,
    createdAt: now,
    updatedAt: now,
  });

  return { requestId: greetingId, creatorId, priceSnapshot };
});

  logger.info("createGreetingRequest created", {
  groupId,
  profileUserId,
  buyerId,
  type,
  source,
  requestId: result.requestId,
});

    return {
      ok: true,
      requestId: result.requestId,
      creatorId: result.creatorId,
      priceSnapshot: result.priceSnapshot ?? null,
      source,
      requestSource: source,
      groupId,
      profileUserId,
    };
  }
);

// 2) Crear URL de subida directa a Mux para una solicitud de saludo/consejo
export const createGreetingMuxUpload = onCall(
  {
    region: "us-central1",
    cors: true,
    secrets: [muxTokenId, muxTokenSecret],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const actorId = auth.uid;
    const greetingRequestId = assertString(request.data?.greetingRequestId, "greetingRequestId", 200);

    const reqRef = db.doc(`greetingRequests/${greetingRequestId}`);
    const reqSnap = await reqRef.get();

    if (!reqSnap.exists) {
      throw new HttpsError("not-found", "Greeting request not found.");
    }

    const gr = reqSnap.data() as {
      creatorId?: string;
      status?: string;
      videoStatus?: string;
    };

    if (gr.creatorId !== actorId) {
      throw new HttpsError(
        "permission-denied",
        "Only the creator can upload video for this request."
      );
    }

    const allowedStatuses = ["pending", "accepted", "uploading"];
    if (!allowedStatuses.includes(gr.status ?? "")) {
      throw new HttpsError(
        "failed-precondition",
        `Request status "${gr.status}" does not allow video upload.`
      );
    }

    const mux = createMuxClient();

    let upload: Awaited<ReturnType<typeof mux.video.uploads.create>>;

    try {
      upload = await mux.video.uploads.create({
        cors_origin: "*",
        new_asset_settings: {
          playback_policy: ["public"],
          mp4_support: "standard",
          passthrough: JSON.stringify({
            contextType: "greeting",
            greetingRequestId,
            creatorId: actorId,
          }),
        },
      });
    } catch (error) {
      logger.error("createGreetingMuxUpload Mux upload creation failed", {
        greetingRequestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpsError("internal", "No se pudo crear la subida de video.");
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.collection("muxUploads").doc(upload.id).set({
      provider: "mux",
      uploadId: upload.id,
      uploadUrlCreated: true,
      contextType: "greeting",
      greetingRequestId,
      authorId: actorId,
      status: "waiting_for_upload",
      assetId: null,
      playbackId: null,
      createdAt: now,
      updatedAt: now,
    });

    await reqRef.update({
      videoStatus: "uploading",
      muxUploadId: upload.id,
      updatedAt: now,
    });

    logger.info("createGreetingMuxUpload created", {
      greetingRequestId,
      uploadId: upload.id,
      actorId,
    });

    return {
      uploadId: upload.id,
      uploadUrl: upload.url,
    };
  }
);

// 3) Responder solicitud (owner): accepted / rejected
export const respondGreetingRequest = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const actorId = auth.uid;

    const requestId = assertString(request.data?.requestId, "requestId", 200);
    const action = assertOneOf<"accept" | "reject">(
      request.data?.action,
      "action",
      ["accept", "reject"]
    );

    const reqRef = db.doc(`greetingRequests/${requestId}`);

    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) {
        throw new HttpsError("not-found", "Greeting request not found.");
      }

      const gr = reqSnap.data() as {
        creatorId?: string;
        status?: GreetingStatus | string;
      };

      if (gr.creatorId !== actorId) {
        throw new HttpsError(
          "permission-denied",
          "Only the creator can respond to this request."
        );
      }

      if (gr.status !== "pending") {
        throw new HttpsError("failed-precondition", "Request is not pending.");
      }

      const newStatus: GreetingStatus =
        action === "accept" ? "accepted" : "rejected";

      tx.update(reqRef, {
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        respondedAt: admin.firestore.FieldValue.serverTimestamp(),
        respondedBy: actorId,
        ...(newStatus === "accepted"
          ? { acceptedAt: admin.firestore.FieldValue.serverTimestamp() }
          : { rejectedAt: admin.firestore.FieldValue.serverTimestamp() }),
      });
    });

    logger.info("respondGreetingRequest updated", {
      requestId,
      actorId,
      action,
    });

    return { ok: true };
  }
);

// Días que tiene el creador para responder una solicitud de saludo/consejo antes
// de que se marque como RECHAZADA automáticamente. Debe coincidir con el frontend
// (GREETING_RESPONSE_DAYS en OwnerSidebarGreetings.parts).
export const GREETING_RESPONSE_DAYS = 90;

export async function autoExpirePendingGreetingRequestsHandler(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - GREETING_RESPONSE_DAYS);
  const cutoff = admin.firestore.Timestamp.fromDate(cutoffDate);

  const snap = await db
    .collection("greetingRequests")
    .where("status", "==", "pending")
    .where("createdAt", "<=", cutoff)
    .limit(200)
    .get();

  if (snap.empty) return 0;

  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();

  // Al expirar pasa a "rejected" (no a devolución directa): cae en Rechazados y
  // desde ahí el comprador decide si pedir devolución o intentarlo de nuevo.
  snap.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: "rejected" as GreetingStatus,
      rejectionReason: "El creador no respondió a tiempo la solicitud.",
      autoExpiredAt: now,
      rejectedAt: now,
      updatedAt: now,
    });
  });

  await batch.commit();

  logger.info("auto_expire_pending_greeting_requests", { expiredCount: snap.size });
  return snap.size;
}