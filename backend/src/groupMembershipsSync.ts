import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const REGION = "us-central1";
const MAX_BATCH = 500;

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export const onGroupMembershipMetaUpdated = onDocumentUpdated(
  {
    document: "groups/{groupId}",
    region: REGION,
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) return;

    const groupId = event.params.groupId;

    const visibilityChanged = beforeData.visibility !== afterData.visibility;
    const nameChanged = beforeData.name !== afterData.name;
    const avatarChanged = beforeData.avatarUrl !== afterData.avatarUrl;
    const coverChanged = beforeData.coverUrl !== afterData.coverUrl;
    const isActiveChanged = beforeData.isActive !== afterData.isActive;
    const discoverableChanged = beforeData.discoverable !== afterData.discoverable;

    if (
      !visibilityChanged &&
      !nameChanged &&
      !avatarChanged &&
      !coverChanged &&
      !isActiveChanged &&
      !discoverableChanged
    ) {
      return;
    }

    logger.info("syncing groupMemberships after group meta update", {
      groupId,
      visibilityChanged,
      nameChanged,
      avatarChanged,
      coverChanged,
      isActiveChanged,
      discoverableChanged,
    });

    const membersSnap = await db
      .collection("groups")
      .doc(groupId)
      .collection("members")
      .get();

    if (membersSnap.empty) return;

    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (visibilityChanged) {
      const v = afterData.visibility ?? null;
      patch.visibility = v;
      patch.groupVisibility = v;
    }
    if (nameChanged) {
      const n = afterData.name ?? null;
      patch.name = n;
      patch.groupName = n;
    }
    if (avatarChanged) {
      const a = afterData.avatarUrl ?? null;
      patch.avatarUrl = a;
      patch.groupAvatarUrl = a;
    }
    if (coverChanged) {
      const c = afterData.coverUrl ?? null;
      patch.coverUrl = c;
      patch.groupCoverUrl = c;
    }
    if (isActiveChanged) {
      const ia = afterData.isActive ?? null;
      patch.isActive = ia;
      patch.groupIsActive = ia;
    }
    if (discoverableChanged) {
      const d = afterData.discoverable ?? null;
      patch.discoverable = d;
      patch.groupDiscoverable = d;
    }

    const memberDocs = membersSnap.docs.filter((memberDoc) => {
      const data = memberDoc.data();
      return typeof data.userId === "string" && data.userId.trim().length > 0;
    });

    const chunks = splitIntoChunks(memberDocs, MAX_BATCH);

    for (const chunk of chunks) {
      const batch = db.batch();
      for (const memberDoc of chunk) {
        const userId = (memberDoc.data().userId as string).trim();
        const membershipRef = db
          .collection("users")
          .doc(userId)
          .collection("groupMemberships")
          .doc(groupId);
        batch.set(membershipRef, patch, { merge: true });
      }
      await batch.commit();
    }

    logger.info("groupMemberships sync complete", {
      groupId,
      updatedCount: memberDocs.length,
    });
  }
);
