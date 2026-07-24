import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { createMuxClient, muxTokenId, muxTokenSecret } from "./mux";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

type GreetingType = "saludo" | "consejo" | "mensaje";
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

  if (type === "mensaje") {
    return isEnabledOffering(offerings, "mensaje");
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

// 1) Crear solicitud de saludo/consejo/mensaje
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
      "mensaje",
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
  const requestRef = db.collection("greetingRequests").doc();

  if (source === "profile") {
    if (!profileUserId) {
      throw new HttpsError("invalid-argument", "profileUserId is required.");
    }

    const profileRef = db.doc(`users/${profileUserId}`);
    const profileSnap = await tx.get(profileRef);

    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }

    const profile = (profileSnap.data() ?? {}) as UserShape;
    const creatorId = profileUserId;

    if (buyerId === creatorId) {
      throw new HttpsError(
        "failed-precondition",
        "Creator cannot request own service."
      );
    }

    const serviceEnabled = isProfileGreetingServiceEnabled(profile, type);
    if (!serviceEnabled) {
      throw new HttpsError(
        "failed-precondition",
        "This service is not enabled for this profile."
      );
    }

    const profilePriceSnapshot = getOfferingPrice(profile.offerings, type);

    tx.set(requestRef, {
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
      priceSnapshot: profilePriceSnapshot,
      currency: "MXN",
      paymentMode: "mercadopago",
      paymentStatus: "awaiting_payment",
      allowCreatorStory,
      createdAt: now,
      updatedAt: now,
    });

    return { requestId: requestRef.id, creatorId };
  }

  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }

  const groupRef = db.doc(`groups/${groupId}`);
  const memberRef = db.doc(`groups/${groupId}/members/${buyerId}`);

  const [groupSnap, memberSnap] = await Promise.all([
    tx.get(groupRef),
    tx.get(memberRef),
  ]);

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Group not found.");
  }

  const group = (groupSnap.data() ?? {}) as GroupShape;
  const creatorId = group?.ownerId;

  if (!creatorId) {
    throw new HttpsError("failed-precondition", "Group has no ownerId.");
  }

  if (buyerId === creatorId) {
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

  const memberData = memberSnap.data();
  if (!canBuyerRequestByMembership(memberData)) {
    throw new HttpsError(
      "permission-denied",
      "Your membership status does not allow requesting this service."
    );
  }

  const serviceEnabled = isGreetingServiceEnabled(group, type);
  if (!serviceEnabled) {
    throw new HttpsError(
      "failed-precondition",
      "This service is not enabled for this group."
    );
  }

  const groupPriceSnapshot = getOfferingPrice(group.offerings, type);

  tx.set(requestRef, {
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
    priceSnapshot: groupPriceSnapshot,
    currency: "MXN",
    paymentMode: "mercadopago",
    paymentStatus: "awaiting_payment",
    allowCreatorStory,
    createdAt: now,
    updatedAt: now,
  });

  return { requestId: requestRef.id, creatorId };
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

export async function autoExpirePendingGreetingRequestsHandler(): Promise<number> {
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const cutoff = admin.firestore.Timestamp.fromDate(twoMonthsAgo);

  const snap = await db
    .collection("greetingRequests")
    .where("status", "==", "pending")
    .where("createdAt", "<=", cutoff)
    .limit(200)
    .get();

  if (snap.empty) return 0;

  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();

  snap.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: "refund_requested" as GreetingStatus,
      rejectionReason: "El creador no respondió la solicitud.",
      autoExpiredAt: now,
      updatedAt: now,
    });
  });

  await batch.commit();

  logger.info("auto_expire_pending_greeting_requests", { expiredCount: snap.size });
  return snap.size;
}