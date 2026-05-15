import "dotenv/config";
import * as admin from "firebase-admin";

const READABLE_MEMBER_STATUSES = ["active", "subscribed", "muted"];
const BATCH_LIMIT = 400;

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

async function main() {
  initializeAdmin();

  const db = admin.firestore();
const postsSnap = await db
  .collection("posts")
  .where("isDeleted", "==", false)
  .get();

  let created = 0;
  let skipped = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const postDoc of postsSnap.docs) {
    const postData = postDoc.data();

    const groupId =
      typeof postData.groupId === "string" ? postData.groupId : null;

    if (!groupId) {
      skipped += 1;
      console.log(`SKIP ${postDoc.id} -> groupId inválido`);
      continue;
    }

    const membersSnap = await db
      .collection("groups")
      .doc(groupId)
      .collection("members")
      .where("status", "in", READABLE_MEMBER_STATUSES)
      .get();

    for (const memberDoc of membersSnap.docs) {
      const memberData = memberDoc.data();

      const uid =
        typeof memberData.userId === "string"
          ? memberData.userId
          : memberDoc.id;

      if (!uid) {
        skipped += 1;
        continue;
      }

      const feedRef = db
        .collection("users")
        .doc(uid)
        .collection("homeFeed")
        .doc(postDoc.id);

      batch.set(
        feedRef,
        {
          postId: postDoc.id,
          isVisible: true,
          createdAt:
            postData.createdAt instanceof admin.firestore.Timestamp
              ? postData.createdAt
              : admin.firestore.Timestamp.now(),
          postSnapshot: {
            ...postData,
          },
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      created += 1;
      batchCount += 1;

      if (batchCount >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    console.log(`OK ${postDoc.id} -> miembros: ${membersSnap.size}`);
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log("");
  console.log("Backfill HomeFeed terminado.");
  console.log(`Entradas creadas/actualizadas: ${created}`);
  console.log(`Saltados: ${skipped}`);
}

main().catch((error) => {
  console.error("Backfill falló:", error);
  process.exit(1);
});