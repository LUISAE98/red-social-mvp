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

async function getActorContextOrThrow(groupId: string, actorUid: string) {
  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Grupo no existe.");
  }

  const groupData = groupSnap.data() as any;
  const ownerId = typeof groupData?.ownerId === "string" ? groupData.ownerId : "";

  if (ownerId === actorUid) {
    return {
      actorUid,
      actorRole: "owner" as CanonicalGroupRole,
      ownerId,
      groupRef,
    };
  }

  const actorMemberRef = groupRef.collection("members").doc(actorUid);
  const actorMemberSnap = await actorMemberRef.get();

  if (!actorMemberSnap.exists) {
    throw new HttpsError("permission-denied", "No perteneces a este grupo.");
  }

  const actorData = actorMemberSnap.data() as any;
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

  const { groupRef } = await getActorContextOrThrow(groupId, callerUid);
  const joinRequestRef = groupRef.collection("joinRequests").doc(userId);
  const memberRef = groupRef.collection("members").doc(userId);

  await db.runTransaction(async (tx) => {
    const joinSnap = await tx.get(joinRequestRef);
    if (!joinSnap.exists) {
      throw new HttpsError("not-found", "Solicitud no existe.");
    }

    const joinData = joinSnap.data() as any;
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

  await db.runTransaction(async (tx) => {
    const joinSnap = await tx.get(joinRequestRef);
    if (!joinSnap.exists) {
      throw new HttpsError("not-found", "Solicitud no existe.");
    }

    const joinData = joinSnap.data() as any;
    if (joinData?.status !== "pending") {
      throw new HttpsError("failed-precondition", "Solicitud ya procesada.");
    }

    tx.delete(joinRequestRef);
  });

  return { success: true };
});