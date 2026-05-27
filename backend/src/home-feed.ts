//home-feed

import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";

import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";

initializeApp();

const db = getFirestore();

const READABLE_MEMBER_STATUSES = ["active", "subscribed", "muted"];

function isReadableMemberStatus(status: unknown): boolean {
  const cleanStatus =
    typeof status === "string" && status.trim().length > 0
      ? status.trim()
      : "active";

  return READABLE_MEMBER_STATUSES.includes(cleanStatus);
}

function getMembershipUid(params: {
  memberDocId: string;
  membershipData?: Record<string, any> | null;
}): string | null {
  const dataUserId =
    typeof params.membershipData?.userId === "string" &&
    params.membershipData.userId.trim().length > 0
      ? params.membershipData.userId.trim()
      : null;

  const docUserId =
    typeof params.memberDocId === "string" &&
    params.memberDocId.trim().length > 0
      ? params.memberDocId.trim()
      : null;

  return dataUserId || docUserId;
}

async function addPostToUserHomeFeed(params: {
  uid: string;
  postId: string;
  postData: Record<string, any>;
}) {
  const { uid, postId, postData } = params;

  const cleanUid = uid.trim();

  if (!cleanUid) {
    return;
  }

  const groupId =
    typeof postData.groupId === "string" && postData.groupId.trim().length > 0
      ? postData.groupId.trim()
      : null;

  await db
    .collection("users")
    .doc(cleanUid)
    .collection("homeFeed")
    .doc(postId)
    .set(
      {
        postId,
        groupId,
        isVisible: postData.isDeleted !== true,
        createdAt:
          postData.createdAt instanceof Timestamp
            ? postData.createdAt
            : Timestamp.now(),

        postSnapshot: {
          ...postData,
        },

        syncedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

async function syncLatestGroupPostsToUser(params: {
  groupId: string;
  uid: string;
}) {
  const { groupId, uid } = params;

  if (!groupId.trim() || !uid.trim()) {
    return;
  }

  const postsSnap = await db
    .collection("posts")
    .where("groupId", "==", groupId)
    .where("isDeleted", "==", false)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  const writes = postsSnap.docs.map((postDoc) =>
    addPostToUserHomeFeed({
      uid,
      postId: postDoc.id,
      postData: postDoc.data(),
    })
  );

  await Promise.all(writes);
}

async function deleteUserHomeFeedByGroup(params: {
  uid: string;
  groupId: string;
}) {
  const { uid, groupId } = params;

  if (!uid.trim() || !groupId.trim()) {
    return;
  }

  const feedSnap = await db
    .collection("users")
    .doc(uid)
    .collection("homeFeed")
    .where("groupId", "==", groupId)
    .get();

  const batches = [];

  for (let i = 0; i < feedSnap.docs.length; i += 450) {
    const batch = db.batch();

    feedSnap.docs.slice(i, i + 450).forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });

    batches.push(batch.commit());
  }

  await Promise.all(batches);
}

export const onHomeFeedPostCreated = onDocumentCreated(
  {
    document: "posts/{postId}",
    region: "us-central1",
  },
  async (event) => {
    const snapshot = event.data;

    if (!snapshot) {
      return;
    }

    const postId = snapshot.id;
    const postData = snapshot.data();

    if (!postData || postData.isDeleted === true) {
      return;
    }

    const groupId =
      typeof postData.groupId === "string" && postData.groupId.trim()
        ? postData.groupId.trim()
        : null;

    if (!groupId) {
      return;
    }

    const groupSnap = await db.collection("groups").doc(groupId).get();
    const groupData = groupSnap.exists ? groupSnap.data() ?? {} : {};

    const ownerId =
      typeof groupData.ownerId === "string" && groupData.ownerId.trim()
        ? groupData.ownerId.trim()
        : null;

    const authorId =
      typeof postData.authorId === "string" && postData.authorId.trim()
        ? postData.authorId.trim()
        : null;

    logger.info("onHomeFeedPostCreated", {
      postId,
      groupId,
      ownerId,
      authorId,
    });

    const membersSnap = await db
      .collection("groups")
      .doc(groupId)
      .collection("members")
      .where("status", "in", READABLE_MEMBER_STATUSES)
      .get();

    const memberIds = membersSnap.docs
      .map((memberDoc) =>
        getMembershipUid({
          memberDocId: memberDoc.id,
          membershipData: memberDoc.data(),
        })
      )
      .filter((uid): uid is string => Boolean(uid));

    const targetUserIds = Array.from(
      new Set([
        ...(ownerId ? [ownerId] : []),
        ...(authorId ? [authorId] : []),
        ...memberIds,
      ])
    );

    const writes = targetUserIds.map((uid) =>
      addPostToUserHomeFeed({
        uid,
        postId,
        postData,
      })
    );

    await Promise.all(writes);
  }
);

export const onHomeFeedPostUpdated = onDocumentUpdated(
  {
    document: "posts/{postId}",
    region: "us-central1",
  },
  async (event) => {
    const afterData = event.data?.after.data();

    if (!afterData) {
      return;
    }

    const postId = event.params.postId;

    const homeFeedSnap = await db
      .collectionGroup("homeFeed")
      .where("postId", "==", postId)
      .get();

    if (homeFeedSnap.empty) {
      return;
    }

    if (afterData.isDeleted === true) {
      logger.info("onHomeFeedPostUpdated deleting homeFeed copies", {
        postId,
        groupId:
          typeof afterData.groupId === "string"
            ? afterData.groupId
            : null,
        copies: homeFeedSnap.size,
      });

      const batches = [];

      for (let i = 0; i < homeFeedSnap.docs.length; i += 450) {
        const batch = db.batch();

        homeFeedSnap.docs.slice(i, i + 450).forEach((docSnap) => {
          batch.delete(docSnap.ref);
        });

        batches.push(batch.commit());
      }

      await Promise.all(batches);
      return;
    }

    logger.info("onHomeFeedPostUpdated syncing homeFeed snapshots", {
      postId,
      groupId:
        typeof afterData.groupId === "string"
          ? afterData.groupId
          : null,
      copies: homeFeedSnap.size,
    });

    const groupId =
      typeof afterData.groupId === "string" && afterData.groupId.trim().length > 0
        ? afterData.groupId.trim()
        : null;

    const batches = [];

    for (let i = 0; i < homeFeedSnap.docs.length; i += 450) {
      const batch = db.batch();

      homeFeedSnap.docs.slice(i, i + 450).forEach((docSnap) => {
        batch.set(
          docSnap.ref,
          {
            postId,
            groupId,
            isVisible: true,
            createdAt:
              afterData.createdAt instanceof Timestamp
                ? afterData.createdAt
                : Timestamp.now(),
            postSnapshot: {
              ...afterData,
            },
            syncedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      batches.push(batch.commit());
    }

    await Promise.all(batches);
  }
);

export const onHomeFeedMembershipCreated = onDocumentCreated(
  {
    document: "groups/{groupId}/members/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const snapshot = event.data;

    if (!snapshot) {
      return;
    }

    const membership = snapshot.data();

    if (!isReadableMemberStatus(membership.status)) {
      return;
    }

    const groupId = event.params.groupId;
    const userId = getMembershipUid({
      memberDocId: event.params.userId,
      membershipData: membership,
    });

    if (!userId) {
      return;
    }

    logger.info("onHomeFeedMembershipCreated", {
      groupId,
      userId,
    });

    await syncLatestGroupPostsToUser({
      groupId,
      uid: userId,
    });
  }
);

export const onHomeFeedMembershipDeleted = onDocumentDeleted(
  {
    document: "groups/{groupId}/members/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const membership = event.data?.data() ?? null;

    const groupId = event.params.groupId;
    const userId = getMembershipUid({
      memberDocId: event.params.userId,
      membershipData: membership,
    });

    if (!userId) {
      return;
    }

    logger.info("onHomeFeedMembershipDeleted", {
      groupId,
      userId,
    });

    await deleteUserHomeFeedByGroup({
      uid: userId,
      groupId,
    });
  }
);

export const onHomeFeedMemberStatusChanged = onDocumentUpdated(
  {
    document: "groups/{groupId}/members/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      return;
    }

    const wasReadable = isReadableMemberStatus(beforeData.status);
    const isReadable = isReadableMemberStatus(afterData.status);

    const groupId = event.params.groupId;
    const userId = getMembershipUid({
      memberDocId: event.params.userId,
      membershipData: afterData,
    });

    if (!userId) {
      return;
    }

    logger.info("onHomeFeedMemberStatusChanged", {
      groupId,
      userId,
      beforeStatus: beforeData.status,
      afterStatus: afterData.status,
    });

    if (!wasReadable && isReadable) {
      await syncLatestGroupPostsToUser({
        groupId,
        uid: userId,
      });

      return;
    }

    if (wasReadable && !isReadable) {
      await deleteUserHomeFeedByGroup({
        uid: userId,
        groupId,
      });
    }
  }
);