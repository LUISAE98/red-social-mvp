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

  await db
    .collection("users")
    .doc(uid)
    .collection("homeFeed")
    .doc(postId)
    .set({
      postId,
      isVisible: true,
      createdAt:
        postData.createdAt instanceof Timestamp
          ? postData.createdAt
          : Timestamp.now(),

      postSnapshot: {
        ...postData,
      },

      syncedAt: FieldValue.serverTimestamp(),
    });
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

    if (!postData) {
      return;
    }

    if (postData.isDeleted === true) {
      return;
    }

    const groupId =
      typeof postData.groupId === "string"
        ? postData.groupId
        : null;

    if (!groupId) {
      return;
    }

    logger.info("onHomeFeedPostCreated", {
      postId,
      groupId,
    });

    const membersSnap = await db
      .collection("groups")
      .doc(groupId)
      .collection("members")
      .where("status", "in", ["active", "subscribed", "muted"])
      .get();

    const writes = membersSnap.docs.map((memberDoc) => {
      const uid =
        typeof memberDoc.data().userId === "string"
          ? memberDoc.data().userId
          : memberDoc.id;

      return addPostToUserHomeFeed({
        uid,
        postId,
        postData,
      });
    });

    await Promise.all(writes);
  }
);

export const onHomeFeedPostDeleted = onDocumentUpdated(
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

    if (
      beforeData.isDeleted === true ||
      afterData.isDeleted !== true
    ) {
      return;
    }

    const postId = event.params.postId;

    logger.info("onHomeFeedPostDeleted", {
      postId,
      groupId:
        typeof afterData.groupId === "string"
          ? afterData.groupId
          : null,
    });

    const homeFeedSnap = await db
      .collectionGroup("homeFeed")
      .where("postId", "==", postId)
      .get();

    const writes = homeFeedSnap.docs.map((docSnap) =>
      docSnap.ref.delete()
    );

    await Promise.all(writes);
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