// home-feed

import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";

import { logger } from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

const REGION = "us-central1";
const READABLE_MEMBER_STATUSES = ["active", "subscribed", "muted"];
const WRITE_BATCH_LIMIT = 450;

type PostData = Record<string, any>;
type FeedSourceType = "group" | "profile";

function isReadableMemberStatus(status: unknown): boolean {
  const cleanStatus =
    typeof status === "string" && status.trim().length > 0
      ? status.trim()
      : "active";

  return READABLE_MEMBER_STATUSES.includes(cleanStatus);
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeCreatedAt(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.now();
}

function getPostSourceType(postData: PostData): FeedSourceType {
  return postData.contextType === "profile" || pickString(postData.profileId)
    ? "profile"
    : "group";
}

function isPostDeleted(postData: PostData): boolean {
  const searchData =
    postData.search && typeof postData.search === "object"
      ? postData.search
      : {};

  return (
    postData.isDeleted === true ||
    searchData.isDeleted === true ||
    Boolean(postData.deletedAt)
  );
}

function isProfilePostVisibleToFollowers(postData: PostData): boolean {
  return (
    getPostSourceType(postData) === "profile" &&
    postData.profileRestricted !== true &&
    isPostDeleted(postData) !== true
  );
}

function getMembershipUid(params: {
  memberDocId: string;
  membershipData?: Record<string, any> | null;
}): string | null {
  const dataUserId = pickString(params.membershipData?.userId);
  const docUserId = pickString(params.memberDocId);

  return dataUserId || docUserId;
}

async function usersHaveBlockBetween(userA: string, userB: string): Promise<boolean> {
  if (!userA.trim() || !userB.trim() || userA === userB) {
    return false;
  }

  const [aBlockedB, bBlockedA] = await Promise.all([
    db.collection("users").doc(userA).collection("blockedUsers").doc(userB).get(),
    db.collection("users").doc(userB).collection("blockedUsers").doc(userA).get(),
  ]);

  return aBlockedB.exists || bBlockedA.exists;
}

async function commitBatches(
  refs: FirebaseFirestore.DocumentReference[],
  operation: "delete",
): Promise<void> {
  const commits = [];

  for (let i = 0; i < refs.length; i += WRITE_BATCH_LIMIT) {
    const batch = db.batch();

    refs.slice(i, i + WRITE_BATCH_LIMIT).forEach((ref) => {
      if (operation === "delete") {
        batch.delete(ref);
      }
    });

    commits.push(batch.commit());
  }

  await Promise.all(commits);
}

async function addPostToUserHomeFeed(params: {
  uid: string;
  postId: string;
  postData: PostData;
}) {
  const { uid, postId, postData } = params;

  const cleanUid = uid.trim();

  if (!cleanUid) {
    return;
  }

  const sourceType = getPostSourceType(postData);
  const groupId = pickString(postData.groupId);
  const authorId = pickString(postData.authorId);
  const profileId = pickString(postData.profileId);

  await db
    .collection("users")
    .doc(cleanUid)
    .collection("homeFeed")
    .doc(postId)
    .set(
      {
        postId,
        groupId,
        authorId,
        profileId,
        sourceType,
        isVisible: isPostDeleted(postData) !== true,
        createdAt: normalizeCreatedAt(postData.createdAt),

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

  await commitBatches(
    feedSnap.docs.map((docSnap) => docSnap.ref),
    "delete"
  );
}

async function deleteUserHomeFeedByAuthor(params: {
  uid: string;
  authorId: string;
}) {
  const { uid, authorId } = params;

  if (!uid.trim() || !authorId.trim()) {
    return;
  }

  const feedSnap = await db
    .collection("users")
    .doc(uid)
    .collection("homeFeed")
    .where("authorId", "==", authorId)
    .get();

  await commitBatches(
    feedSnap.docs.map((docSnap) => docSnap.ref),
    "delete"
  );
}

async function deleteUserProfileHomeFeedByAuthor(params: {
  uid: string;
  authorId: string;
}) {
  const { uid, authorId } = params;

  if (!uid.trim() || !authorId.trim()) {
    return;
  }

  const feedSnap = await db
    .collection("users")
    .doc(uid)
    .collection("homeFeed")
    .where("authorId", "==", authorId)
    .where("sourceType", "==", "profile")
    .get();

  await commitBatches(
    feedSnap.docs.map((docSnap) => docSnap.ref),
    "delete"
  );
}

async function distributeProfilePostToFollowers(params: {
  postId: string;
  postData: PostData;
}) {
  const { postId, postData } = params;

  const authorId = pickString(postData.authorId);
  const profileId = pickString(postData.profileId) || authorId;

  if (!authorId || !profileId || authorId !== profileId) {
    logger.warn("distributeProfilePostToFollowers skipped: invalid profile post", {
      postId,
      authorId,
      profileId,
    });

    return;
  }

  await addPostToUserHomeFeed({
    uid: authorId,
    postId,
    postData,
  });

  if (!isProfilePostVisibleToFollowers(postData)) {
    return;
  }

  const followersSnap = await db
    .collection("users")
    .doc(profileId)
    .collection("followers")
    .get();

  const followerIds = followersSnap.docs
    .map((followerDoc) => pickString(followerDoc.data().followerUserId) || pickString(followerDoc.id))
    .filter((uid): uid is string => Boolean(uid))
    .filter((uid) => uid !== profileId);

  const writes = followerIds.map(async (uid) => {
    const blocked = await usersHaveBlockBetween(uid, profileId);

    if (blocked) {
      return;
    }

    await addPostToUserHomeFeed({
      uid,
      postId,
      postData,
    });
  });

  await Promise.all(writes);
}

export const onHomeFeedPostCreated = onDocumentCreated(
  {
    document: "posts/{postId}",
    region: REGION,
  },
  async (event) => {
    const snapshot = event.data;

    if (!snapshot) {
      return;
    }

    const postId = snapshot.id;
    const postData = snapshot.data();

    if (!postData || isPostDeleted(postData)) {
      return;
    }

    const sourceType = getPostSourceType(postData);

    if (sourceType === "profile") {
      await distributeProfilePostToFollowers({
        postId,
        postData,
      });

      return;
    }

    const groupId = pickString(postData.groupId);

    if (!groupId) {
      return;
    }

    const groupSnap = await db.collection("groups").doc(groupId).get();
    const groupData = groupSnap.exists ? groupSnap.data() ?? {} : {};

    const ownerId = pickString(groupData.ownerId);
    const authorId = pickString(postData.authorId);

    logger.info("onHomeFeedPostCreated", {
      postId,
      groupId,
      ownerId,
      authorId,
      sourceType,
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
    region: REGION,
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

    if (isPostDeleted(afterData)) {
      logger.info("onHomeFeedPostUpdated deleting homeFeed copies", {
        postId,
        groupId: pickString(afterData.groupId),
        profileId: pickString(afterData.profileId),
        copies: homeFeedSnap.size,
      });

      await commitBatches(
        homeFeedSnap.docs.map((docSnap) => docSnap.ref),
        "delete"
      );

      return;
    }

    logger.info("onHomeFeedPostUpdated syncing homeFeed snapshots", {
      postId,
      groupId: pickString(afterData.groupId),
      profileId: pickString(afterData.profileId),
      copies: homeFeedSnap.size,
    });

    const sourceType = getPostSourceType(afterData);
    const groupId = pickString(afterData.groupId);
    const authorId = pickString(afterData.authorId);
    const profileId = pickString(afterData.profileId);

    const commits = [];

    for (let i = 0; i < homeFeedSnap.docs.length; i += WRITE_BATCH_LIMIT) {
      const batch = db.batch();

      homeFeedSnap.docs.slice(i, i + WRITE_BATCH_LIMIT).forEach((docSnap) => {
        batch.set(
          docSnap.ref,
          {
            postId,
            groupId,
            authorId,
            profileId,
            sourceType,
            isVisible: true,
            createdAt: normalizeCreatedAt(afterData.createdAt),
            postSnapshot: {
              ...afterData,
            },
            syncedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      commits.push(batch.commit());
    }

    await Promise.all(commits);
  }
);

export const onHomeFeedMembershipCreated = onDocumentCreated(
  {
    document: "groups/{groupId}/members/{userId}",
    region: REGION,
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
    region: REGION,
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
    region: REGION,
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

export const onHomeFeedFollowingDeleted = onDocumentDeleted(
  {
    document: "users/{userId}/following/{targetUserId}",
    region: REGION,
  },
  async (event) => {
    const userId = event.params.userId;
    const targetUserId = event.params.targetUserId;

    logger.info("onHomeFeedFollowingDeleted", {
      userId,
      targetUserId,
    });

    await deleteUserProfileHomeFeedByAuthor({
      uid: userId,
      authorId: targetUserId,
    });
  }
);

export const onHomeFeedBlockedUserCreated = onDocumentCreated(
  {
    document: "users/{userId}/blockedUsers/{blockedUserId}",
    region: REGION,
  },
  async (event) => {
    const userId = event.params.userId;
    const blockedUserId = event.params.blockedUserId;

    logger.info("onHomeFeedBlockedUserCreated", {
      userId,
      blockedUserId,
    });

    await Promise.all([
      deleteUserHomeFeedByAuthor({
        uid: userId,
        authorId: blockedUserId,
      }),
      deleteUserHomeFeedByAuthor({
        uid: blockedUserId,
        authorId: userId,
      }),
    ]);
  }
);