import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

type MemberStatus = "active" | "muted" | "banned";
type GroupRole = "owner" | "mod" | "member";

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${label} es requerido.`);
  }

  return value.trim();
}

async function getValidatedContext(
  callerUid: string,
  groupId: string,
  targetUserId: string
) {
  const groupRef = db.collection("groups").doc(groupId);
  const memberRef = groupRef.collection("members").doc(targetUserId);
  const joinRequestRef = groupRef.collection("joinRequests").doc(targetUserId);

  const [groupSnap, memberSnap, joinReqSnap] = await Promise.all([
    groupRef.get(),
    memberRef.get(),
    joinRequestRef.get(),
  ]);

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Grupo no existe.");
  }

  const groupData = groupSnap.data() ?? {};

  if (groupData.ownerId !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "Solo el owner puede realizar esta acción."
    );
  }

  if (callerUid === targetUserId) {
    throw new HttpsError(
      "failed-precondition",
      "No puedes aplicarte esta acción a ti mismo."
    );
  }

  if (groupData.ownerId === targetUserId) {
    throw new HttpsError(
      "failed-precondition",
      "No puedes aplicar esta acción al owner."
    );
  }

  return {
    groupRef,
    memberRef,
    joinRequestRef,
    memberSnap,
    joinReqSnap,
  };
}

function normalizeRole(value: unknown): GroupRole {
  if (value === "owner") return "owner";
  if (value === "mod") return "mod";
  if (value === "moderator") return "mod";
  return "member";
}

function normalizeStatus(value: unknown): MemberStatus {
  if (value === "muted") return "muted";
  if (value === "banned") return "banned";
  return "active";
}

export const muteGroupMember = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const groupId = assertString(request.data?.groupId, "groupId");
  const targetUserId = assertString(request.data?.targetUserId, "targetUserId");

  const { memberRef, memberSnap } = await getValidatedContext(
    callerUid,
    groupId,
    targetUserId
  );

  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "El integrante no existe en el grupo.");
  }

  const memberData = memberSnap.data() ?? {};
  const currentStatus = normalizeStatus(memberData.status);

  if (currentStatus === "banned") {
    throw new HttpsError(
      "failed-precondition",
      "No puedes mutear a un usuario baneado."
    );
  }

  if (currentStatus === "muted") {
    return { success: true, status: "muted", alreadyApplied: true };
  }

  await memberRef.set(
    {
      status: "muted",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, status: "muted" };
});

export const unmuteGroupMember = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const groupId = assertString(request.data?.groupId, "groupId");
  const targetUserId = assertString(request.data?.targetUserId, "targetUserId");

  const { memberRef, memberSnap } = await getValidatedContext(
    callerUid,
    groupId,
    targetUserId
  );

  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "El integrante no existe en el grupo.");
  }

  const memberData = memberSnap.data() ?? {};
  const currentStatus = normalizeStatus(memberData.status);

  if (currentStatus === "banned") {
    throw new HttpsError(
      "failed-precondition",
      "No puedes desmutear a un usuario baneado."
    );
  }

  if (currentStatus === "active") {
    return { success: true, status: "active", alreadyApplied: true };
  }

  await memberRef.set(
    {
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, status: "active" };
});

export const banGroupMember = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const groupId = assertString(request.data?.groupId, "groupId");
  const targetUserId = assertString(request.data?.targetUserId, "targetUserId");

  const { memberRef, joinRequestRef, memberSnap, joinReqSnap } =
    await getValidatedContext(callerUid, groupId, targetUserId);

  const memberData = memberSnap.exists ? memberSnap.data() ?? {} : {};
  const currentStatus = normalizeStatus(memberData.status);

  if (currentStatus === "banned") {
    return { success: true, status: "banned", alreadyApplied: true };
  }

  const nextRole = normalizeRole(memberData.roleInGroup);
  const nextJoinedAt = memberSnap.exists ? memberData.joinedAt ?? null : null;

  await memberRef.set(
    {
      userId: targetUserId,
      roleInGroup: nextRole,
      status: "banned",
      joinedAt: nextJoinedAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (joinReqSnap.exists) {
    await joinRequestRef.delete();
  }

  return { success: true, status: "banned" };
});

export const unbanGroupMember = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const groupId = assertString(request.data?.groupId, "groupId");
  const targetUserId = assertString(request.data?.targetUserId, "targetUserId");

  const { memberRef, memberSnap } = await getValidatedContext(
    callerUid,
    groupId,
    targetUserId
  );

  if (!memberSnap.exists) {
    throw new HttpsError(
      "not-found",
      "No existe registro de ban para este usuario."
    );
  }

  const memberData = memberSnap.data() ?? {};
  const currentStatus = normalizeStatus(memberData.status);

  if (currentStatus !== "banned") {
    return { success: true, status: currentStatus, alreadyApplied: true };
  }

  await memberRef.set(
    {
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, status: "active" };
});

export const removeGroupMember = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const groupId = assertString(request.data?.groupId, "groupId");
  const targetUserId = assertString(request.data?.targetUserId, "targetUserId");

  const { memberRef, joinRequestRef, memberSnap, joinReqSnap } =
    await getValidatedContext(callerUid, groupId, targetUserId);

  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "El integrante no existe en el grupo.");
  }

  await memberRef.delete();

  if (joinReqSnap.exists) {
    await joinRequestRef.delete();
  }

  return { success: true, removed: true };
});