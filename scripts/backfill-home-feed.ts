import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";

type FeedSourceType = "group" | "profile";

function initializeAdmin() {
  if (admin.apps.length) return;

const projectId =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const clientEmail =
  process.env.FIREBASE_CLIENT_EMAIL ??
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

const privateKey = (
  process.env.FIREBASE_PRIVATE_KEY ??
  process.env.FIREBASE_ADMIN_PRIVATE_KEY
)?.replace(/\\n/g, "\n");

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

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getPostSourceType(postData: FirebaseFirestore.DocumentData): FeedSourceType {
  return postData.contextType === "profile" || pickString(postData.profileId)
    ? "profile"
    : "group";
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();

  const homeFeedSnap = await db.collectionGroup("homeFeed").get();

  let updated = 0;
  let skipped = 0;
  let missingPost = 0;

  console.log(`Entradas homeFeed encontradas: ${homeFeedSnap.size}`);
  console.log("");

  for (const feedDoc of homeFeedSnap.docs) {
    const feedData = feedDoc.data();

    const postId = pickString(feedData.postId) || feedDoc.id;

    if (!postId) {
      skipped += 1;
      console.log(`SKIP ${feedDoc.ref.path} -> sin postId`);
      continue;
    }

    const postSnap = await db.collection("posts").doc(postId).get();

    if (!postSnap.exists) {
      missingPost += 1;
      console.log(`MISSING ${feedDoc.ref.path} -> post no existe: ${postId}`);
      continue;
    }

    const postData = postSnap.data() ?? {};

    const sourceType = getPostSourceType(postData);
    const groupId = pickString(postData.groupId);
    const authorId = pickString(postData.authorId);
    const profileId = pickString(postData.profileId);

    await feedDoc.ref.set(
      {
        postId,
        groupId,
        authorId,
        profileId,
        sourceType,
        isVisible:
          postData.isDeleted !== true &&
          postData.search?.isDeleted !== true &&
          !postData.deletedAt,
        createdAt:
          postData.createdAt ?? feedData.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
        postSnapshot: {
          ...postData,
        },
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    updated += 1;
    console.log(`OK ${feedDoc.ref.path} -> ${postId} (${sourceType})`);
  }

  console.log("");
  console.log("Backfill homeFeed terminado.");
  console.log(`Actualizados: ${updated}`);
  console.log(`Saltados: ${skipped}`);
  console.log(`Posts faltantes: ${missingPost}`);
}

main().catch((error) => {
  console.error("Backfill homeFeed falló:", error);
  process.exit(1);
});