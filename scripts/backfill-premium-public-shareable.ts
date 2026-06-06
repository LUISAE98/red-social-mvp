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

  // Posts con premium.enabled == true y premium.accessMode == "public"
  const snap = await db
    .collection("posts")
    .where("premium.enabled", "==", true)
    .where("premium.accessMode", "==", "public")
    .get();

  console.log(`Posts premium públicos encontrados: ${snap.size}`);
  console.log("");

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const postDoc of snap.docs) {
    const data = postDoc.data();

    if (data.isShareable === true) {
      unchanged += 1;
      console.log(`OK        ${postDoc.ref.path} -> ya tiene isShareable: true`);
      continue;
    }

    try {
      await postDoc.ref.update({ isShareable: true });
      updated += 1;
      console.log(`UPDATED   ${postDoc.ref.path} -> isShareable: ${data.isShareable ?? "(ausente)"} → true`);
    } catch (err) {
      failed += 1;
      console.error(`FAILED    ${postDoc.ref.path}`, err);
    }
  }

  console.log("");
  console.log("─────────────────────────────────");
  console.log(`Actualizados : ${updated}`);
  console.log(`Sin cambio   : ${unchanged}`);
  console.log(`Fallidos     : ${failed}`);
  console.log(`Total        : ${snap.size}`);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
