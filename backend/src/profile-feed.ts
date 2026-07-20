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

type PostData = Record<string, unknown>;
type GroupData = Record<string, unknown>;

const REGION = "us-central1";

function isValidString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeAccessModel(postData: PostData): string {
  if (typeof postData.accessModel === "string" && postData.accessModel.trim()) {
    return postData.accessModel.trim();
  }

  if (typeof postData.access === "string" && postData.access.trim()) {
    return postData.access.trim();
  }

  return "free";
}

function normalizeCreatedAt(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.now();
}


function normalizeGroupVisibility(value: unknown): "public" | "private" | "hidden" {
  if (value === "public" || value === "private" || value === "hidden") {
    return value;
  }

  return "private";
}

function isPostDeleted(postData: PostData): boolean {
  const searchData =
    postData.search && typeof postData.search === "object"
      ? (postData.search as Record<string, unknown>)
      : {} as Record<string, unknown>;

  return (
    postData.isDeleted === true ||
    searchData.isDeleted === true ||
    Boolean(postData.deletedAt)
  );
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

  const groupVisibility = normalizeGroupVisibility(
    groupData?.visibility ?? postData.groupVisibility
  );

  const accessModel = normalizeAccessModel(postData);

  return {
    postId,
    id: postId,
    authorId,
    groupId,

    ...postData,

    groupVisibility,
    groupIsActive: groupData?.isActive !== false,

    isDeleted: isPostDeleted(postData),
    isShareable: postData.isShareable !== false,
    access: typeof postData.access === "string" ? postData.access : accessModel,
    accessModel,
    accessScope:
      typeof postData.accessScope === "string" ? postData.accessScope : "group",
    requiresPayment: normalizeBoolean(
      postData.requiresPayment,
      accessModel !== "free"
    ),
    requiresSubscription: normalizeBoolean(postData.requiresSubscription, false),

    isPinnedOnProfile: postData.isPinnedOnProfile === true,
    profilePinnedAt: postData.profilePinnedAt ?? null,
    profilePinnedBy: postData.profilePinnedBy ?? null,

    text: typeof postData.text === "string" ? postData.text : "",
    media: Array.isArray(postData.media) ? postData.media : [],

    counts:
      postData.counts && typeof postData.counts === "object"
        ? (() => {
            const c = postData.counts as Record<string, unknown>;
            return {
              comments: typeof c.comments === "number" ? c.comments : 0,
              likes: typeof c.likes === "number" ? c.likes : 0,
              saves: typeof c.saves === "number" ? c.saves : 0,
            };
          })()
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

    postType: postData.postType ?? "text",
    liveData: postData.liveData ?? null,
    videoData: postData.videoData ?? null,
    scheduledData: postData.scheduledData ?? null,
    playback: postData.playback ?? null,
    processing: postData.processing ?? {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },

    shareTitle: postData.shareTitle ?? null,
    shareDescription: postData.shareDescription ?? null,
    shareImageUrl: postData.shareImageUrl ?? null,

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

  // Seguridad: NO materializar posts de comunidades OCULTAS en el profileFeed —
  // su copia denormalizada (nombre/avatar/texto) no debe exponerse a no-miembros.
  // Si el grupo pasó a oculto, elimina cualquier entrada previa.
  if (groupData?.visibility === "hidden") {
    await deleteProfileFeedEntry({ postId, authorId }).catch(() => {});
    return;
  }

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

if (!postData || isPostDeleted(postData)) {
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

if (isPostDeleted(afterData)) {
      if (afterAuthorId) {
        await deleteProfileFeedEntry({
          postId,
          authorId: afterAuthorId,
        });
      }

      return;
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
    const categoryChanged = beforeData.category !== afterData.category;
    const tagsChanged =
      JSON.stringify(beforeData.tags ?? null) !==
      JSON.stringify(afterData.tags ?? null);

    if (
      !visibilityChanged &&
      !activeChanged &&
      !avatarChanged &&
      !nameChanged &&
      !categoryChanged &&
      !tagsChanged
    ) {
      return;
    }

    logger.info("syncing profileFeed entries after group update", {
      groupId,
      visibilityChanged,
      activeChanged,
      avatarChanged,
      nameChanged,
      categoryChanged,
      tagsChanged,
    });

    const postsSnap = await db
      .collection("posts")
      .where("groupId", "==", groupId)
      .where("isDeleted", "==", false)
      .get();

    // Propaga cambios de categoría/tags a los campos denormalizados del post
    // (descubrimiento). Se guardan crudos; el cliente normaliza al comparar.
    if (categoryChanged || tagsChanged) {
      const denorm: Record<string, unknown> = {};
      if (categoryChanged) {
        denorm.groupCategory =
          typeof afterData.category === "string" && afterData.category
            ? afterData.category
            : null;
      }
      if (tagsChanged) {
        denorm.groupTags = Array.isArray(afterData.tags)
          ? afterData.tags.filter((t): t is string => typeof t === "string")
          : [];
      }

      let batch = db.batch();
      let batchCount = 0;
      for (const postDoc of postsSnap.docs) {
        batch.update(postDoc.ref, denorm);
        batchCount += 1;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
      if (batchCount > 0) await batch.commit();
    }

    if (visibilityChanged || activeChanged || avatarChanged || nameChanged) {
      const writes = postsSnap.docs.map((postDoc) =>
        upsertProfileFeedEntry({
          postId: postDoc.id,
          postData: postDoc.data(),
        })
      );

      await Promise.all(writes);
    }
  }
);