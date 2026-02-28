import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

/**
 * APPROVE JOIN REQUEST
 * - Solo owner
 * - Crea member
 * - BORRA joinRequest (para que el usuario pueda re-solicitar si luego se sale)
 */
export const approveJoinRequest = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Debes estar autenticado.");

  const { groupId, userId } = request.data ?? {};
  if (!groupId || !userId) throw new HttpsError("invalid-argument", "groupId y userId son requeridos.");

  const groupRef = db.collection("groups").doc(groupId);
  const joinRequestRef = groupRef.collection("joinRequests").doc(userId);
  const memberRef = groupRef.collection("members").doc(userId);

  await db.runTransaction(async (tx) => {
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists) throw new HttpsError("not-found", "Grupo no existe.");

    const groupData = groupSnap.data();
    if (groupData?.ownerId !== callerUid) {
      throw new HttpsError("permission-denied", "Solo el owner puede aprobar.");
    }

    const joinSnap = await tx.get(joinRequestRef);
    if (!joinSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");

    const joinData = joinSnap.data();
    if (joinData?.status !== "pending") {
      throw new HttpsError("failed-precondition", "Solicitud ya procesada.");
    }

    // Crear membership
    tx.set(memberRef, {
      userId,
      roleInGroup: "member",
      status: "active",
      joinedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // ✅ BORRAR joinRequest (MVP limpio: permite re-solicitar si luego se sale)
    tx.delete(joinRequestRef);
  });

  return { success: true };
});

/**
 * REJECT JOIN REQUEST
 * - Solo owner
 * - BORRA joinRequest (para permitir reintentos)
 *   (si quieres historial, luego lo mandamos a auditLogs en H3)
 */
export const rejectJoinRequest = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Debes estar autenticado.");

  const { groupId, userId } = request.data ?? {};
  if (!groupId || !userId) throw new HttpsError("invalid-argument", "groupId y userId son requeridos.");

  const groupRef = db.collection("groups").doc(groupId);
  const joinRequestRef = groupRef.collection("joinRequests").doc(userId);

  await db.runTransaction(async (tx) => {
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists) throw new HttpsError("not-found", "Grupo no existe.");

    const groupData = groupSnap.data();
    if (groupData?.ownerId !== callerUid) {
      throw new HttpsError("permission-denied", "Solo el owner puede rechazar.");
    }

    const joinSnap = await tx.get(joinRequestRef);
    if (!joinSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");

    const joinData = joinSnap.data();
    if (joinData?.status !== "pending") {
      throw new HttpsError("failed-precondition", "Solicitud ya procesada.");
    }

    // ✅ BORRAR joinRequest (permite volver a solicitar)
    tx.delete(joinRequestRef);
  });

  return { success: true };
});