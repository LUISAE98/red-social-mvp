import "dotenv/config";
import * as admin from "firebase-admin";

type PostData = FirebaseFirestore.DocumentData;
type GroupData = FirebaseFirestore.DocumentData | null;

function initializeAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en .env.local"
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

function isValidString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeAccessModel(data: PostData): "free" | "paid" {
  if (data.accessModel === "paid" || data.access === "paid") {
    return "paid";
  }

  return "free";
}

function normalizeTimestamp(value: unknown) {
  return value instanceof admin.firestore.Timestamp
    ? value
    : admin.firestore.FieldValue.serverTimestamp();
}

function buildProfileFeedPayload(params: {
  postId: string;
  postData: PostData;
  groupData: GroupData;
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

  const accessModel = normalizeAccessModel(postData);

  const groupVisibility =
    groupData?.visibility === "private" || groupData?.visibility === "hidden"
      ? groupData.visibility
      : "public";

  return {
    postId,
    authorId,
    groupId,

    groupVisibility,
    groupIsActive: groupData?.isActive !== false,

    isDeleted: postData.isDeleted === true,
    isShareable: postData.isShareable !== false,
    accessModel,
    requiresPayment:
      typeof postData.requiresPayment === "boolean"
        ? postData.requiresPayment
        : accessModel === "paid",
    requiresSubscription:
      typeof postData.requiresSubscription === "boolean"
        ? postData.requiresSubscription
        : false,

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

    createdAt: normalizeTimestamp(postData.createdAt),
    updatedAt: normalizeTimestamp(postData.updatedAt),

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

    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();

  const postsSnap = await db
    .collection("posts")
    .where("isDeleted", "==", false)
    .get();

  const groupCache = new Map<string, GroupData>();

  let updated = 0;
  let skipped = 0;

  for (const postDoc of postsSnap.docs) {
    const postId = postDoc.id;
    const postData = postDoc.data();

    const authorId = isValidString(postData.authorId)
      ? postData.authorId.trim()
      : null;

    const groupId = isValidString(postData.groupId)
      ? postData.groupId.trim()
      : null;

    if (!authorId || !groupId) {
      skipped += 1;
      console.log(`SKIP ${postId} -> authorId/groupId inválido`);
      continue;
    }

    let groupData = groupCache.get(groupId);

    if (groupData === undefined) {
      const groupSnap = await db.collection("groups").doc(groupId).get();
      groupData = groupSnap.exists ? groupSnap.data() ?? null : null;
      groupCache.set(groupId, groupData);
    }

    const payload = buildProfileFeedPayload({
      postId,
      postData,
      groupData,
    });

    if (!payload) {
      skipped += 1;
      console.log(`SKIP ${postId} -> payload inválido`);
      continue;
    }

    await db
      .collection("users")
      .doc(authorId)
      .collection("profileFeed")
      .doc(postId)
      .set(payload, { merge: true });

    updated += 1;
    console.log(`OK ${postId} -> users/${authorId}/profileFeed/${postId}`);
  }

  console.log("");
  console.log("Backfill Profile Feed terminado.");
  console.log(`Actualizados: ${updated}`);
  console.log(`Saltados: ${skipped}`);
}

main().catch((error) => {
  console.error("Backfill Profile Feed falló:", error);
  process.exit(1);
});