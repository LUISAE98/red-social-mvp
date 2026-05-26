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

async function addPostToUserHomeFeed(params: {
  uid: string;
  postId: string;
  postData: Record<string, any>;
}) {
  const { uid, postId, postData } = params;

  const groupId =
    typeof postData.groupId === "string" && postData.groupId.trim().length > 0
      ? postData.groupId.trim()
      : null;

  await db
    .collection("users")
    .doc(uid)
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
      .where("status", "in", ["active", "subscribed", "muted"])
      .get();

    const memberIds = membersSnap.docs
      .map((memberDoc) => {
        const uid =
          typeof memberDoc.data().userId === "string" &&
          memberDoc.data().userId.trim()
            ? memberDoc.data().userId.trim()
            : memberDoc.id;

        return uid;
      })
      .filter(Boolean);

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
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
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

    const status =
      typeof membership.status === "string"
        ? membership.status
        : "active";

    if (!["active", "subscribed", "muted"].includes(status)) {
      return;
    }

    const groupId = event.params.groupId;
    const userId = event.params.userId;

    logger.info("onHomeFeedMembershipCreated", {
      groupId,
      userId,
    });

    const postsSnap = await db
      .collection("posts")
      .where("groupId", "==", groupId)
      .where("isDeleted", "==", false)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const writes = postsSnap.docs.map((postDoc) => {
      return addPostToUserHomeFeed({
        uid: userId,
        postId: postDoc.id,
        postData: postDoc.data(),
      });
    });

    await Promise.all(writes);
  }
);

export const onHomeFeedMembershipDeleted = onDocumentDeleted(
  {
    document: "groups/{groupId}/members/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const groupId = event.params.groupId;
    const userId = event.params.userId;

    logger.info("onHomeFeedMembershipDeleted", {
      groupId,
      userId,
    });

    const feedSnap = await db
      .collection("users")
      .doc(userId)
      .collection("homeFeed")
      .where("postSnapshot.groupId", "==", groupId)
      .get();

    const writes = feedSnap.docs.map((docSnap) =>
      docSnap.ref.delete()
    );

    await Promise.all(writes);
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

    const beforeStatus =
      typeof beforeData.status === "string"
        ? beforeData.status
        : "active";

    const afterStatus =
      typeof afterData.status === "string"
        ? afterData.status
        : "active";

    const readableStatuses = [
      "active",
      "subscribed",
      "muted",
    ];

    const wasReadable =
      readableStatuses.includes(beforeStatus);

    const isReadable =
      readableStatuses.includes(afterStatus);

    const groupId = event.params.groupId;
    const userId = event.params.userId;

    logger.info("onHomeFeedMemberStatusChanged", {
      groupId,
      userId,
      beforeStatus,
      afterStatus,
    });

    if (!wasReadable && isReadable) {
      const postsSnap = await db
        .collection("posts")
        .where("groupId", "==", groupId)
        .where("isDeleted", "==", false)
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();

      const writes = postsSnap.docs.map((postDoc) => {
        return addPostToUserHomeFeed({
          uid: userId,
          postId: postDoc.id,
          postData: postDoc.data(),
        });
      });

      await Promise.all(writes);

      return;
    }

    if (wasReadable && !isReadable) {
      const feedSnap = await db
        .collection("users")
        .doc(userId)
        .collection("homeFeed")
        .where("postSnapshot.groupId", "==", groupId)
        .get();

      const writes = feedSnap.docs.map((docSnap) =>
        docSnap.ref.delete()
      );

      await Promise.all(writes);
    }
  }
);