import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";

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

async function main() {
  initializeAdmin();

  const db = admin.firestore();
  const usersSnap = await db.collection("users").get();

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  console.log(`Usuarios encontrados: ${usersSnap.size}`);
  console.log("");

  for (const userDoc of usersSnap.docs) {
    try {
      const followersSnap = await userDoc.ref.collection("followers").count().get();

      const realFollowersCount = followersSnap.data().count;
      const currentFollowersCount = userDoc.data().followersCount;

      if (currentFollowersCount === realFollowersCount) {
        unchanged += 1;
        console.log(`OK ${userDoc.ref.path} -> ${realFollowersCount} seguidores`);
        continue;
      }

      await userDoc.ref.set(
        {
          followersCount: realFollowersCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      updated += 1;
      console.log(
        `UPDATED ${userDoc.ref.path} -> ${currentFollowersCount ?? 0} a ${realFollowersCount}`
      );
    } catch (error) {
      failed += 1;
      console.error(`FAILED ${userDoc.ref.path}`, error);
    }
  }

  console.log("");
  console.log("Backfill followersCount terminado.");
  console.log(`Actualizados: ${updated}`);
  console.log(`Sin cambios: ${unchanged}`);
  console.log(`Fallidos: ${failed}`);
}

main().catch((error) => {
  console.error("Backfill followersCount falló:", error);
  process.exit(1);
});