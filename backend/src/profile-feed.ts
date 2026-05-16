import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";

import { logger } from "firebase-functions";
import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";

const db = getFirestore();

type PostData = Record<string, any>;
type GroupData = Record<string, any>;

const REGION = "us-central1";

function isValidString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeAccessModel(postData: PostData): "free" | "paid" {
  if (postData.accessModel === "paid" || postData.access === "paid") {
    return "paid";
  }

  return "free";
}

function normalizeCreatedAt(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.now();
}

async function getGroupData(groupId: string): Promise<GroupData | null> {
  const groupSnap = await db.collection("groups").doc(groupId).get();

  if (!groupSnap.exists) {
    return null;
  }

  return groupSnap.data() ?? null;
}

function buildProfileFeedPayload(params: {
  postId: string;
  postData: PostData;
  groupData: GroupData | null;
}) {
  const { postId, postData, groupData } = params;

  const authorId = isValidString(postData.authorId)
    ? postData.authorId.trim()
    : null;

  const groupId = isValidString(postData.groupId)
    ? postData.groupId.trim()
    : null;

  if (!authorId || !groupId) {
    return null;
  }

  const groupVisibility =
    groupData?.visibility === "private" || groupData?.visibility === "hidden"
      ? groupData.visibility
      : "public";

  const accessModel = normalizeAccessModel(postData);

  return {
    postId,
    authorId,
    groupId,

    groupVisibility,
    groupIsActive: groupData?.isActive !== false,

    isDeleted: postData.isDeleted === true,
    isShareable: postData.isShareable !== false,
    accessModel,
    requiresPayment: normalizeBoolean(postData.requiresPayment, accessModel === "paid"),
    requiresSubscription: normalizeBoolean(postData.requiresSubscription, false),

    isPinnedOnProfile: postData.isPinnedOnProfile === true,
    profilePinnedAt: postData.profilePinnedAt ?? null,
    profilePinnedBy: postData.profilePinnedBy ?? null,

    text: typeof postData.text === "string" ? postData.text : "",
    media: Array.isArray(postData.media) ? postData.media : [],

    counts:
      postData.counts && typeof postData.counts === "object"
        ? postData.counts
        : {
            comments: 0,
            likes: 0,
            saves: 0,
          },

    createdAt: normalizeCreatedAt(postData.createdAt),
    updatedAt:
      postData.updatedAt instanceof Timestamp
        ? postData.updatedAt
        : FieldValue.serverTimestamp(),

    authorName: postData.authorName ?? null,
    authorUsername: postData.authorUsername ?? null,
    authorAvatarUrl: postData.authorAvatarUrl ?? null,

    groupName:
      typeof groupData?.name === "string"
        ? groupData.name
        : postData.groupName ?? null,

    groupAvatarUrl:
      typeof groupData?.avatarUrl === "string"
        ? groupData.avatarUrl
        : postData.groupAvatarUrl ?? null,

    syncedAt: FieldValue.serverTimestamp(),
  };
}

async function upsertProfileFeedEntry(params: {
  postId: string;
  postData: PostData;
}) {
  const { postId, postData } = params;

  const authorId = isValidString(postData.authorId)
    ? postData.authorId.trim()
    : null;

  const groupId = isValidString(postData.groupId)
    ? postData.groupId.trim()
    : null;

  if (!authorId || !groupId) {
    logger.warn("upsertProfileFeedEntry skipped: invalid authorId/groupId", {
      postId,
      authorId,
      groupId,
    });

    return;
  }

  const groupData = await getGroupData(groupId);

  const payload = buildProfileFeedPayload({
    postId,
    postData,
    groupData,
  });

  if (!payload) {
    logger.warn("upsertProfileFeedEntry skipped: invalid payload", {
      postId,
      authorId,
      groupId,
    });

    return;
  }

  await db
    .collection("users")
    .doc(authorId)
    .collection("profileFeed")
    .doc(postId)
    .set(payload, { merge: true });

  logger.info("profileFeed entry upserted", {
    postId,
    authorId,
    groupId,
  });
}

async function deleteProfileFeedEntry(params: {
  postId: string;
  authorId: string;
}) {
  const { postId, authorId } = params;

  await db
    .collection("users")
    .doc(authorId)
    .collection("profileFeed")
    .doc(postId)
    .delete();

  logger.info("profileFeed entry deleted", {
    postId,
    authorId,
  });
}

export const onProfileFeedPostCreated = onDocumentCreated(
  {
    document: "posts/{postId}",
    region: REGION,
  },
  async (event) => {
    const snapshot = event.data;

    if (!snapshot) {
      return;
    }

    const postId = event.params.postId;
    const postData = snapshot.data();

    if (!postData) {
      return;
    }

    await upsertProfileFeedEntry({
      postId,
      postData,
    });
  }
);

export const onProfileFeedPostUpdated = onDocumentUpdated(
  {
    document: "posts/{postId}",
    region: REGION,
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      return;
    }

    const postId = event.params.postId;

    const beforeAuthorId = isValidString(beforeData.authorId)
      ? beforeData.authorId.trim()
      : null;

    const afterAuthorId = isValidString(afterData.authorId)
      ? afterData.authorId.trim()
      : null;

    if (beforeAuthorId && afterAuthorId && beforeAuthorId !== afterAuthorId) {
      await deleteProfileFeedEntry({
        postId,
        authorId: beforeAuthorId,
      });
    }

    await upsertProfileFeedEntry({
      postId,
      postData: afterData,
    });
  }
);

export const onProfileFeedPostDeleted = onDocumentDeleted(
  {
    document: "posts/{postId}",
    region: REGION,
  },
  async (event) => {
    const snapshot = event.data;

    if (!snapshot) {
      return;
    }

    const postId = event.params.postId;
    const postData = snapshot.data();

    const authorId = isValidString(postData?.authorId)
      ? postData.authorId.trim()
      : null;

    if (!authorId) {
      return;
    }

    await deleteProfileFeedEntry({
      postId,
      authorId,
    });
  }
);

export const onProfileFeedGroupUpdated = onDocumentUpdated(
  {
    document: "groups/{groupId}",
    region: REGION,
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      return;
    }

    const groupId = event.params.groupId;

    const visibilityChanged = beforeData.visibility !== afterData.visibility;
    const activeChanged = beforeData.isActive !== afterData.isActive;
    const avatarChanged = beforeData.avatarUrl !== afterData.avatarUrl;
    const nameChanged = beforeData.name !== afterData.name;

    if (!visibilityChanged && !activeChanged && !avatarChanged && !nameChanged) {
      return;
    }

    logger.info("syncing profileFeed entries after group update", {
      groupId,
      visibilityChanged,
      activeChanged,
      avatarChanged,
      nameChanged,
    });

    const postsSnap = await db
      .collection("posts")
      .where("groupId", "==", groupId)
      .where("isDeleted", "==", false)
      .get();

    const writes = postsSnap.docs.map((postDoc) =>
      upsertProfileFeedEntry({
        postId: postDoc.id,
        postData: postDoc.data(),
      })
    );

    await Promise.all(writes);
  }
);