import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

type CanonicalGroupRole = "owner" | "mod" | "member";
type CanonicalMemberStatus = "active" | "muted" | "banned" | "removed";

function normalizeRole(raw: unknown): CanonicalGroupRole {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (value === "owner") return "owner";
  if (value === "mod" || value === "moderator") return "mod";
  return "member";
}

function normalizeStatus(raw: unknown): CanonicalMemberStatus {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (value === "muted") return "muted";
  if (value === "banned") return "banned";
  if (value === "removed" || value === "kicked" || value === "expelled") {
    return "removed";
  }
  return "active";
}

function buildUserMembershipSummaryFields(params: {
  groupId: string;
  userId: string;
  groupData: Record<string, unknown>;
}) {
  const groupName =
    typeof params.groupData?.name === "string" ? params.groupData.name : null;
  const groupDescription =
    typeof params.groupData?.description === "string"
      ? params.groupData.description
      : null;
  const groupImageUrl =
    typeof params.groupData?.imageUrl === "string"
      ? params.groupData.imageUrl
      : null;
  const groupAvatarUrl =
    typeof params.groupData?.avatarUrl === "string"
      ? params.groupData.avatarUrl
      : null;
  const groupCoverUrl =
    typeof params.groupData?.coverUrl === "string"
      ? params.groupData.coverUrl
      : null;
  const groupOwnerId =
    typeof params.groupData?.ownerId === "string"
      ? params.groupData.ownerId
      : null;
  const groupVisibility =
    typeof params.groupData?.visibility === "string"
      ? params.groupData.visibility
      : null;
  const groupDiscoverable =
    typeof params.groupData?.discoverable === "boolean"
      ? params.groupData.discoverable
      : null;
  const groupIsActive =
    typeof params.groupData?.isActive === "boolean"
      ? params.groupData.isActive
      : null;
  const groupCategory =
    typeof params.groupData?.category === "string"
      ? params.groupData.category
      : null;

  return {
    groupId: params.groupId,
    userId: params.userId,

    roleInGroup: "member",
    role: "member",
    status: "active",

    accessType: "standard",
    requiresSubscription: false,
    subscriptionActive: false,

    groupName,
    groupDescription,
    groupImageUrl,
    groupAvatarUrl,
    groupCoverUrl,
    groupOwnerId,
    groupVisibility,
    groupDiscoverable,
    groupIsActive,
    groupCategory,

    name: groupName,
    description: groupDescription,
    imageUrl: groupImageUrl,
    avatarUrl: groupAvatarUrl,
    coverUrl: groupCoverUrl,
    ownerId: groupOwnerId,
    visibility: groupVisibility,
    discoverable: groupDiscoverable,
    isActive: groupIsActive,
    category: groupCategory,

    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function getActorContextOrThrow(groupId: string, actorUid: string) {
  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Comunidad no existe.");
  }

  const groupData = groupSnap.data() as Record<string, unknown>;
  const ownerId = typeof groupData?.ownerId === "string" ? groupData.ownerId : "";

  if (ownerId === actorUid) {
    return {
      actorUid,
      actorRole: "owner" as CanonicalGroupRole,
      ownerId,
      groupRef,
      groupData,
    };
  }

  const actorMemberRef = groupRef.collection("members").doc(actorUid);
  const actorMemberSnap = await actorMemberRef.get();

  if (!actorMemberSnap.exists) {
    throw new HttpsError("permission-denied", "No perteneces a esta comunidad.");
  }

  const actorData = actorMemberSnap.data() as Record<string, unknown>;
  const actorRole = normalizeRole(actorData?.roleInGroup ?? actorData?.role);
  const actorStatus = normalizeStatus(actorData?.status);

  if (actorStatus === "banned" || actorStatus === "removed") {
    throw new HttpsError(
      "permission-denied",
      "No tienes permisos para realizar esta acción."
    );
  }

  if (actorRole !== "mod") {
    throw new HttpsError(
      "permission-denied",
      "Solo el owner o un moderador pueden gestionar solicitudes."
    );
  }

  return {
    actorUid,
    actorRole,
    ownerId,
    groupRef,
    groupData,
  };
}

/**
 * APPROVE JOIN REQUEST
 * - Owner o moderador
 * - Crea member
 * - Borra joinRequest
 */
export const approveJoinRequest = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const { groupId, userId } = request.data ?? {};
  if (!groupId || !userId) {
    throw new HttpsError("invalid-argument", "groupId y userId son requeridos.");
  }

  const { groupRef, groupData } = await getActorContextOrThrow(
    groupId,
    callerUid
  );

  const joinRequestRef = groupRef.collection("joinRequests").doc(userId);
  const memberRef = groupRef.collection("members").doc(userId);
  const userMembershipRef = db
    .collection("users")
    .doc(userId)
    .collection("groupMemberships")
    .doc(groupId);
  const userJoinRequestRef = db
    .collection("users")
    .doc(userId)
    .collection("joinRequestsSent")
    .doc(groupId);

  await db.runTransaction(async (tx) => {
    const joinSnap = await tx.get(joinRequestRef);
    if (!joinSnap.exists) {
      throw new HttpsError("not-found", "Solicitud no existe.");
    }

    const joinData = joinSnap.data() as Record<string, unknown>;
    if (joinData?.status !== "pending") {
      throw new HttpsError("failed-precondition", "Solicitud ya procesada.");
    }

    tx.set(
      memberRef,
      {
        userId,
        roleInGroup: "member",
        role: "member",
        status: "active",
        mutedUntil: null,
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: callerUid,
      },
      { merge: true }
    );
    tx.set(
      userMembershipRef,
      {
        ...buildUserMembershipSummaryFields({
          groupId,
          userId,
          groupData,
        }),
        joinedAt: FieldValue.serverTimestamp(),
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: callerUid,
      },
      { merge: true }
    );

    tx.delete(userJoinRequestRef);
    tx.delete(joinRequestRef);
  });

  return { success: true };
});

/**
 * REJECT JOIN REQUEST
 * - Owner o moderador
 * - Borra joinRequest
 */
export const rejectJoinRequest = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const { groupId, userId } = request.data ?? {};
  if (!groupId || !userId) {
    throw new HttpsError("invalid-argument", "groupId y userId son requeridos.");
  }

  const { groupRef } = await getActorContextOrThrow(groupId, callerUid);

  const joinRequestRef = groupRef.collection("joinRequests").doc(userId);
  const userJoinRequestRef = db
    .collection("users")
    .doc(userId)
    .collection("joinRequestsSent")
    .doc(groupId);

  await db.runTransaction(async (tx) => {
    const joinSnap = await tx.get(joinRequestRef);
    if (!joinSnap.exists) {
      throw new HttpsError("not-found", "Solicitud no existe.");
    }

    const joinData = joinSnap.data() as Record<string, unknown>;
    if (joinData?.status !== "pending") {
      throw new HttpsError("failed-precondition", "Solicitud ya procesada.");
    }
    tx.delete(userJoinRequestRef);
    tx.delete(joinRequestRef);
  });

  return { success: true };
});