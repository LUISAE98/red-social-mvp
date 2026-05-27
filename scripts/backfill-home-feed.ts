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

function pickPostId(
  feedDoc: FirebaseFirestore.QueryDocumentSnapshot
): string {
  const data = feedDoc.data();

  if (typeof data.postId === "string" && data.postId.trim()) {
    return data.postId.trim();
  }

  return feedDoc.id;
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();

  const homeFeedSnap = await db.collectionGroup("homeFeed").get();

  let checked = 0;
  let deletedMissingPost = 0;
  let deletedSoftDeletedPost = 0;
  let refreshed = 0;
  let skipped = 0;

  let batch = db.batch();
  let batchOps = 0;

  async function commitBatchIfNeeded(force = false) {
    if (batchOps === 0) return;

    if (force || batchOps >= 450) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }

  for (const feedDoc of homeFeedSnap.docs) {
    checked += 1;

    const feedData = feedDoc.data();
    const postId = pickPostId(feedDoc);

    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();

    if (!postSnap.exists) {
      batch.delete(feedDoc.ref);
      batchOps += 1;
      deletedMissingPost += 1;
      await commitBatchIfNeeded();
      console.log(`DELETE ${feedDoc.ref.path} -> post no existe`);
      continue;
    }

    const postData = postSnap.data() ?? {};

    if (postData.isDeleted === true) {
      batch.delete(feedDoc.ref);
      batchOps += 1;
      deletedSoftDeletedPost += 1;
      await commitBatchIfNeeded();
      console.log(`DELETE ${feedDoc.ref.path} -> post eliminado`);
      continue;
    }

    const currentSnapshot = feedData.postSnapshot;

    if (
      !currentSnapshot ||
      currentSnapshot.isDeleted === true ||
      currentSnapshot.updatedAt !== postData.updatedAt
    ) {
      batch.set(
        feedDoc.ref,
        {
          postId,
          isVisible: true,
          groupId: postData.groupId ?? feedData.groupId ?? null,
          authorId: postData.authorId ?? feedData.authorId ?? null,
          createdAt: postData.createdAt ?? feedData.createdAt ?? null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          postSnapshot: {
            ...postData,
            id: postId,
          },
        },
        { merge: true }
      );

      batchOps += 1;
      refreshed += 1;
      await commitBatchIfNeeded();
      console.log(`REFRESH ${feedDoc.ref.path}`);
      continue;
    }

    skipped += 1;
  }

  await commitBatchIfNeeded(true);

  console.log("");
  console.log("Backfill homeFeed terminado.");
  console.log(`Revisados: ${checked}`);
  console.log(`Eliminados por post inexistente: ${deletedMissingPost}`);
  console.log(`Eliminados por post borrado: ${deletedSoftDeletedPost}`);
  console.log(`Snapshots actualizados: ${refreshed}`);
  console.log(`Saltados: ${skipped}`);
}

main().catch((error) => {
  console.error("Backfill falló:", error);
  process.exit(1);
});