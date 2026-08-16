import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { notifyJoinRejected } from "./notifications";

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
      "Solo el creador o un moderador pueden gestionar solicitudes."
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

  // Se guarda fuera para poder contar el uso de la invitación después de que la
  // transacción confirme: el enlace vive en otro documento que esta transacción
  // no leyó.
  let inviteTokenDeLaSolicitud: string | null = null;

  await db.runTransaction(async (tx) => {
    const joinSnap = await tx.get(joinRequestRef);
    if (!joinSnap.exists) {
      throw new HttpsError("not-found", "Solicitud no existe.");
    }

    const joinData = joinSnap.data() as Record<string, unknown>;
    if (joinData?.status !== "pending") {
      throw new HttpsError("failed-precondition", "Solicitud ya procesada.");
    }
    inviteTokenDeLaSolicitud =
      typeof joinData.inviteToken === "string" ? joinData.inviteToken : null;

    // No reactivar a un usuario baneado (la solicitud pudo crearse antes del ban).
    // Lectura dentro de la transacción, antes de cualquier escritura.
    const memberSnap = await tx.get(memberRef);
    if (memberSnap.exists && memberSnap.data()?.status === "banned") {
      throw new HttpsError(
        "failed-precondition",
        "Este usuario está baneado de la comunidad. Quita el ban antes de aprobarlo."
      );
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

  // ⚠️ El uso de la invitación se cuenta AL ADMITIR, que es cuando la persona
  // entra de verdad.
  //
  // En una comunidad privada, usar el enlace solo crea una solicitud pendiente,
  // así que ahí no se contaba —correcto—, pero al aprobarla tampoco: el uso no
  // se contaba nunca y `maxUses` era decorativo. Un enlace de 10 admitía a
  // cuantos el creador aprobara.
  //
  // Va FUERA de la transacción a propósito: la invitación vive en otro documento
  // que la transacción no leyó, y meterla dentro obligaría a rehacer el flujo
  // entero. Si esto falla, la persona ya entró —que es lo que el creador quiso—
  // y solo queda el contador corto, no un acceso indebido.
  if (inviteTokenDeLaSolicitud) {
    await contarUsoDeInvitacion(inviteTokenDeLaSolicitud, userId).catch((error) => {
      logger.error("approveJoinRequest: no se pudo contar el uso de la invitación", {
        groupId,
        userId,
        error,
      });
    });
  }

  return { success: true };
});

/**
 * Suma un uso a la invitación y la desactiva si llegó a su tope.
 *
 * ⚠️ Si ya estaba agotada NO se rechaza a la persona: el creador la aprobó
 * explícitamente y esa decisión manda. Se cuenta igual y se desactiva el enlace
 * para que no siga trayendo gente. Es distinto del alta automática por
 * suscripción, donde nadie revisa y por eso ahí sí se reserva antes de cobrar.
 */
async function contarUsoDeInvitacion(token: string, uid: string): Promise<void> {
  const encontrada = await db
    .collectionGroup("inviteLinks")
    .where("token", "==", token)
    .limit(1)
    .get();

  if (encontrada.empty) return;
  const ref = encontrada.docs[0].ref;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const usados = typeof snap.get("usedCount") === "number" ? snap.get("usedCount") : 0;
    const max = typeof snap.get("maxUses") === "number" ? snap.get("maxUses") : null;
    const siguiente = usados + 1;

    tx.update(ref, {
      usedCount: siguiente,
      lastUsedAt: FieldValue.serverTimestamp(),
      lastUsedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
      ...(max !== null && siguiente >= max ? { isActive: false } : {}),
    });
  });
}

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

  // Avisar al solicitante que su solicitud fue rechazada (server-side).
  try {
    await notifyJoinRejected(groupId, userId);
  } catch (err: unknown) {
    logger.error("rejectJoinRequest notify failed", {
      groupId,
      userId,
      message: err instanceof Error ? err.message : "Error desconocido",
    });
  }

  return { success: true };
});