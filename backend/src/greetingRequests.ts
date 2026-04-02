import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

type GreetingType = "saludo" | "consejo" | "mensaje";
type GreetingStatus = "pending" | "accepted" | "rejected";
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

  if (!status) return false;

  return status === "active";
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

    const groupId = assertString(request.data?.groupId, "groupId", 120);
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
    const source = (request.data?.source
      ? assertOneOf<GreetingSource>(request.data.source, "source", [
          "group",
          "profile",
        ])
      : "group") as GreetingSource;

    const groupRef = db.doc(`groups/${groupId}`);
    const memberRef = db.doc(`groups/${groupId}/members/${buyerId}`);

    const result = await db.runTransaction(async (tx) => {
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

      const requestRef = db.collection("greetingRequests").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();

      tx.set(requestRef, {
        groupId,
        creatorId,
        buyerId,
        type,
        toName,
        instructions,
        source,
        status: "pending" as GreetingStatus,
        createdAt: now,
        updatedAt: now,
      });

      return { requestId: requestRef.id, creatorId };
    });

    logger.info("createGreetingRequest created", {
      groupId,
      buyerId,
      type,
      source,
      requestId: result.requestId,
    });

    return {
      ok: true,
      requestId: result.requestId,
      creatorId: result.creatorId,
    };
  }
);

// 2) Responder solicitud (owner): accepted / rejected
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