import "dotenv/config";
import * as admin from "firebase-admin";

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

function getPostCreatedAt(data: FirebaseFirestore.DocumentData) {
  return data.createdAt instanceof admin.firestore.Timestamp
    ? data.createdAt
    : admin.firestore.Timestamp.now();
}

async function getHomeFeedUserIdsForGroup(
  db: FirebaseFirestore.Firestore,
  groupId: string
): Promise<string[]> {
  const groupSnap = await db.collection("groups").doc(groupId).get();

  if (!groupSnap.exists) {
    return [];
  }

  const groupData = groupSnap.data() ?? {};
  const ownerId =
    typeof groupData.ownerId === "string" && groupData.ownerId.trim()
      ? groupData.ownerId.trim()
      : null;

  const membersSnap = await db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .where("status", "in", ["active", "subscribed", "muted"])
    .get();

  const memberIds = membersSnap.docs
    .map((memberDoc) => {
      const data = memberDoc.data();

      return typeof data.userId === "string" && data.userId.trim()
        ? data.userId.trim()
        : memberDoc.id;
    })
    .filter(Boolean);

  return Array.from(new Set([...(ownerId ? [ownerId] : []), ...memberIds]));
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();

  const postsSnap = await db
    .collection("posts")
    .where("isDeleted", "==", false)
    .orderBy("createdAt", "desc")
    .get();

  const groupUsersCache = new Map<string, Promise<string[]>>();

  let postsProcessed = 0;
  let feedEntriesWritten = 0;
  let skipped = 0;

  let batch = db.batch();
  let batchWrites = 0;

  async function commitBatchIfNeeded(force = false) {
    if (batchWrites === 0) return;
    if (!force && batchWrites < 400) return;

    await batch.commit();
    batch = db.batch();
    batchWrites = 0;
  }

  for (const postDoc of postsSnap.docs) {
    const postData = postDoc.data();

    if (postData.isDeleted === true) {
      skipped += 1;
      continue;
    }

    const groupId =
      typeof postData.groupId === "string" && postData.groupId.trim()
        ? postData.groupId.trim()
        : null;

    if (!groupId) {
      skipped += 1;
      continue;
    }

    if (!groupUsersCache.has(groupId)) {
      groupUsersCache.set(groupId, getHomeFeedUserIdsForGroup(db, groupId));
    }

    const userIds = await groupUsersCache.get(groupId);

    if (!userIds || userIds.length === 0) {
      skipped += 1;
      continue;
    }

    for (const uid of userIds) {
      const feedRef = db
        .collection("users")
        .doc(uid)
        .collection("homeFeed")
        .doc(postDoc.id);

      batch.set(
        feedRef,
        {
          postId: postDoc.id,
          groupId,
          isVisible: true,
          createdAt: getPostCreatedAt(postData),
          postSnapshot: {
            ...postData,
          },
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      batchWrites += 1;
      feedEntriesWritten += 1;

      await commitBatchIfNeeded();
    }

    postsProcessed += 1;
    console.log(`OK post ${postDoc.id} -> ${userIds.length} usuarios`);
  }

  await commitBatchIfNeeded(true);

  console.log("");
  console.log("Backfill homeFeed terminado.");
  console.log(`Posts procesados: ${postsProcessed}`);
  console.log(`Entradas homeFeed escritas: ${feedEntriesWritten}`);
  console.log(`Saltados: ${skipped}`);
}

main().catch((error) => {
  console.error("Backfill homeFeed falló:", error);
  process.exit(1);
});