import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
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

async function main() {
  initializeAdmin();

  const db = admin.firestore();

  const postsSnap = await db
    .collection("posts")
    .where("isDeleted", "==", false)
    .get();

  let updated = 0;
  let skipped = 0;

  for (const postDoc of postsSnap.docs) {
    const data = postDoc.data();

    const groupId =
      typeof data.groupId === "string" && data.groupId.trim().length > 0
        ? data.groupId.trim()
        : null;

    const authorId =
      typeof data.authorId === "string" && data.authorId.trim().length > 0
        ? data.authorId.trim()
        : null;

    const contextType =
      typeof data.contextType === "string" && data.contextType.trim().length > 0
        ? data.contextType.trim()
        : null;

    if (!groupId || !authorId || contextType === "profile") {
      skipped += 1;
      continue;
    }

    const payload: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      contextType: "group",
      profileId: null,
      profileName: null,
      profileAvatarUrl: null,
      profileUsername: null,
      profileRestricted: null,
      accessScope: "group",
      updatedAt: data.updatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
    };

    if (data.search && typeof data.search === "object") {
      payload["search.contextType"] = "group";
      payload["search.groupId"] = groupId;
      payload["search.profileId"] = null;
      payload["search.authorId"] = authorId;
      payload["search.accessScope"] = "group";
      payload["search.isDeleted"] = false;
      payload["search.updatedAt"] = admin.firestore.FieldValue.serverTimestamp();
    }

    await postDoc.ref.set(payload, { merge: true });

    updated += 1;
    console.log(`OK ${postDoc.id} -> groupId=${groupId}`);
  }

  console.log("");
  console.log("Backfill terminado.");
  console.log(`Actualizados: ${updated}`);
  console.log(`Saltados: ${skipped}`);
}

main().catch((error) => {
  console.error("Backfill falló:", error);
  process.exit(1);
});