import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

type CanonicalGroupRole = "owner" | "mod" | "member";
type CanonicalMemberStatus = "active" | "muted" | "banned" | "removed";

function requireAuth(request: any) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  return uid as string;
}

function normalizeString(value: unknown, fieldName: string) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) {
    throw new HttpsError("invalid-argument", `${fieldName} es requerido.`);
  }
  return v;
}

function normalizeDurationDays(value: unknown) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new HttpsError(
      "invalid-argument",
      "durationDays debe ser un entero entre 1 y 365."
    );
  }
  return days;
}

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

async function getGroupOrThrow(groupId: string) {
  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "La comunidad no existe.");
  }

  const data = groupSnap.data() as any;

  return {
    groupRef,
    data,
    ownerId: typeof data?.ownerId === "string" ? data.ownerId : "",
  };
}

async function getMemberRefOrThrow(groupId: string, targetUserId: string) {
  const memberRef = db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .doc(targetUserId);

  const memberSnap = await memberRef.get();

  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "La membresía no existe.");
  }

  const memberData = memberSnap.data() as any;
  const role = normalizeRole(memberData?.roleInGroup ?? memberData?.role);

  if (role === "owner") {
    throw new HttpsError(
      "failed-precondition",
      "No se puede moderar al owner de la comunidad."
    );
  }

  return {
    memberRef,
    memberSnap,
    memberData,
    role,
    status: normalizeStatus(memberData?.status),
  };
}

async function getActorContextOrThrow(groupId: string, actorUid: string) {
  const { ownerId } = await getGroupOrThrow(groupId);

  if (ownerId === actorUid) {
    return {
      actorUid,
      actorRole: "owner" as CanonicalGroupRole,
      ownerId,
    };
  }

  const actorMemberRef = db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .doc(actorUid);

  const actorMemberSnap = await actorMemberRef.get();

  if (!actorMemberSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "No perteneces a esta comunidad."
    );
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
      "Solo el owner o un moderador pueden realizar esta acción."
    );
  }

  return {
    actorUid,
    actorRole,
    ownerId,
  };
}

function ensureActorCanModerateTarget(
  actorRole: CanonicalGroupRole,
  actorUid: string,
  targetUserId: string,
  targetRole: CanonicalGroupRole
) {
  if (actorUid === targetUserId) {
    throw new HttpsError(
      "failed-precondition",
      "No puedes aplicarte esta acción a ti mismo."
    );
  }

  if (targetRole === "owner") {
    throw new HttpsError(
      "failed-precondition",
      "No se puede moderar al owner del grupo."
    );
  }

  if (actorRole === "mod" && targetRole === "mod") {
    throw new HttpsError(
      "permission-denied",
      "Un moderador no puede administrar a otro moderador."
    );
  }
}

function ensureOwnerOnly(actorRole: CanonicalGroupRole) {
  if (actorRole !== "owner") {
    throw new HttpsError(
      "permission-denied",
      "Solo el owner del grupo puede realizar esta acción."
    );
  }
}

function getJoinRequestRef(groupId: string, targetUserId: string) {
  return db
    .collection("groups")
    .doc(groupId)
    .collection("joinRequests")
    .doc(targetUserId);
}

function buildRoleDowngradePatch(actorUid: string) {
  return {
    roleInGroup: "member",
    role: "member",
    roleUpdatedAt: FieldValue.serverTimestamp(),
    roleUpdatedBy: actorUid,
  };
}

export const promoteGroupMemberToAdmin = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  ensureOwnerOnly(actorRole);

  const { memberRef, role, status } = await getMemberRefOrThrow(groupId, targetUserId);

  if (role === "mod") {
    return { ok: true, roleInGroup: "mod" };
  }

  if (status !== "active") {
    throw new HttpsError(
      "failed-precondition",
      "Solo puedes promover miembros activos."
    );
  }

  await memberRef.set(
    {
      roleInGroup: "mod",
      role: "mod",
      updatedAt: FieldValue.serverTimestamp(),
      roleUpdatedAt: FieldValue.serverTimestamp(),
      roleUpdatedBy: actorUid,
    },
    { merge: true }
  );

  return { ok: true, roleInGroup: "mod" };
});

export const demoteGroupAdminToMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  ensureOwnerOnly(actorRole);

  const { memberRef, role } = await getMemberRefOrThrow(groupId, targetUserId);

  if (role !== "mod") {
    return { ok: true, roleInGroup: "member" };
  }

  await memberRef.set(
    {
      roleInGroup: "member",
      role: "member",
      updatedAt: FieldValue.serverTimestamp(),
      roleUpdatedAt: FieldValue.serverTimestamp(),
      roleUpdatedBy: actorUid,
    },
    { merge: true }
  );

  return { ok: true, roleInGroup: "member" };
});

export const muteGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");
  const durationDays = normalizeDurationDays(request.data?.durationDays);

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const mutedUntilDate = new Date(
    Date.now() + durationDays * 24 * 60 * 60 * 1000
  );

  await memberRef.set(
    {
      status: "muted",
      mutedUntil: Timestamp.fromDate(mutedUntilDate),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: actorUid,
      ...buildRoleDowngradePatch(actorUid),
    },
    { merge: true }
  );

  return {
    ok: true,
    mutedUntil: mutedUntilDate.toISOString(),
  };
});

export const unmuteGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  await memberRef.set(
    {
      status: "active",
      mutedUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: actorUid,
    },
    { merge: true }
  );

  return { ok: true };
});

export const banGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);
  const batch = db.batch();

  batch.set(
    memberRef,
    {
      status: "banned",
      mutedUntil: null,
      bannedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: actorUid,
      ...buildRoleDowngradePatch(actorUid),
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);

  await batch.commit();

  return { ok: true };
});

export const unbanGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);
  const batch = db.batch();

  batch.set(
    memberRef,
    {
      status: "active",
      mutedUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
      unbannedAt: FieldValue.serverTimestamp(),
      moderatedBy: actorUid,
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);

  await batch.commit();

  return { ok: true };
});

export const removeGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);
  const batch = db.batch();

  batch.set(
    memberRef,
    {
      status: "removed",
      mutedUntil: null,
      removedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: actorUid,
      ...buildRoleDowngradePatch(actorUid),
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);

  await batch.commit();

  return { ok: true };
});

export const cleanupExpiredGroupMutes = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
  },
  async () => {
    const now = Timestamp.now();
    let totalUpdated = 0;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    while (true) {
      let q = db
        .collectionGroup("members")
        .where("status", "==", "muted")
        .where("mutedUntil", "<=", now)
        .orderBy("mutedUntil")
        .limit(200);

      if (lastDoc) {
        q = q.startAfter(lastDoc);
      }

      const snap = await q.get();

      if (snap.empty) {
        break;
      }

      const batch = db.batch();

      snap.docs.forEach((docSnap) => {
        batch.set(
          docSnap.ref,
          {
            status: "active",
            mutedUntil: null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      await batch.commit();
      totalUpdated += snap.size;
      lastDoc = snap.docs[snap.docs.length - 1];

      if (snap.size < 200) {
        break;
      }
    }

    logger.info("cleanupExpiredGroupMutes completed", {
      totalUpdated,
    });
  }
);