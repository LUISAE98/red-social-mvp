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

async function getOwnedGroupOrThrow(groupId: string, ownerUid: string) {
  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "El grupo no existe.");
  }

  const data = groupSnap.data() as any;
  if (data?.ownerId !== ownerUid) {
    throw new HttpsError(
      "permission-denied",
      "Solo el owner del grupo puede realizar esta acción."
    );
  }

  return groupRef;
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
  const role = String(memberData?.roleInGroup ?? memberData?.role ?? "member");

  if (role === "owner") {
    throw new HttpsError(
      "failed-precondition",
      "No se puede moderar al owner del grupo."
    );
  }

  return memberRef;
}

function getJoinRequestRef(groupId: string, targetUserId: string) {
  return db
    .collection("groups")
    .doc(groupId)
    .collection("joinRequests")
    .doc(targetUserId);
}

export const muteGroupMember = onCall(async (request) => {
  const ownerUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");
  const durationDays = normalizeDurationDays(request.data?.durationDays);

  if (ownerUid === targetUserId) {
    throw new HttpsError(
      "failed-precondition",
      "No puedes aplicarte mute a ti mismo."
    );
  }

  await getOwnedGroupOrThrow(groupId, ownerUid);
  const memberRef = await getMemberRefOrThrow(groupId, targetUserId);

  const mutedUntilDate = new Date(
    Date.now() + durationDays * 24 * 60 * 60 * 1000
  );

  await memberRef.set(
    {
      status: "muted",
      mutedUntil: Timestamp.fromDate(mutedUntilDate),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: ownerUid,
    },
    { merge: true }
  );

  return {
    ok: true,
    mutedUntil: mutedUntilDate.toISOString(),
  };
});

export const unmuteGroupMember = onCall(async (request) => {
  const ownerUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  await getOwnedGroupOrThrow(groupId, ownerUid);
  const memberRef = await getMemberRefOrThrow(groupId, targetUserId);

  await memberRef.set(
    {
      status: "active",
      mutedUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: ownerUid,
    },
    { merge: true }
  );

  return { ok: true };
});

export const banGroupMember = onCall(async (request) => {
  const ownerUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  if (ownerUid === targetUserId) {
    throw new HttpsError(
      "failed-precondition",
      "No puedes banearte a ti mismo."
    );
  }

  await getOwnedGroupOrThrow(groupId, ownerUid);
  const memberRef = await getMemberRefOrThrow(groupId, targetUserId);
  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);

  const batch = db.batch();

  batch.set(
    memberRef,
    {
      status: "banned",
      mutedUntil: null,
      bannedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: ownerUid,
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);

  await batch.commit();

  return { ok: true };
});

export const unbanGroupMember = onCall(async (request) => {
  const ownerUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  await getOwnedGroupOrThrow(groupId, ownerUid);
  const memberRef = await getMemberRefOrThrow(groupId, targetUserId);
  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);

  const batch = db.batch();

  batch.set(
    memberRef,
    {
      status: "active",
      mutedUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
      unbannedAt: FieldValue.serverTimestamp(),
      moderatedBy: ownerUid,
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);

  await batch.commit();

  return { ok: true };
});

export const removeGroupMember = onCall(async (request) => {
  const ownerUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  if (ownerUid === targetUserId) {
    throw new HttpsError(
      "failed-precondition",
      "No puedes expulsarte a ti mismo."
    );
  }

  await getOwnedGroupOrThrow(groupId, ownerUid);
  const memberRef = await getMemberRefOrThrow(groupId, targetUserId);
  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);

  const batch = db.batch();

  batch.set(
    memberRef,
    {
      status: "removed",
      mutedUntil: null,
      removedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: ownerUid,
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