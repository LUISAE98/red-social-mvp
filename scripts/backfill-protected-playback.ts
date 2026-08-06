// Blinda el playback de los posts de pago que YA existían.
//
// El trigger `onPostPlaybackProtection` (backend/src/protectedPlayback.ts) mueve
// las coordenadas reproducibles (playbackId / URL HLS) de un post de pago al
// subdocumento cerrado `posts/{postId}/protectedPlayback/current`. Ese trigger
// solo corre cuando el post se escribe, así que los posts publicados ANTES del
// deploy siguen exponiendo su playbackId en el documento público.
//
// Este script les da un toque (`playbackProtectionCheckedAt`) para que el
// trigger corra una vez sobre cada uno. La lógica de redacción NO se duplica
// aquí a propósito: vive en un solo lugar.
//
// Uso:  npx tsx scripts/backfill-protected-playback.ts [--dry]

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
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  initializeAdmin();

  const db = admin.firestore();

  // `requiresPayment == true` cubre tanto los posts premium como los boletos de
  // live y los VOD de pago (todos ponen esa bandera).
  const snap = await db.collection("posts").where("requiresPayment", "==", true).get();

  console.log(`Posts de pago encontrados: ${snap.size}${dryRun ? " (dry run)" : ""}`);
  console.log("");

  let touched = 0;
  let skipped = 0;
  let failed = 0;

  for (const postDoc of snap.docs) {
    const data = postDoc.data();

    if (data.isDeleted === true) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`DRY       ${postDoc.ref.path}`);
      touched += 1;
      continue;
    }

    try {
      await postDoc.ref.update({
        playbackProtectionCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      touched += 1;
      console.log(`TOUCHED   ${postDoc.ref.path}`);
    } catch (err) {
      failed += 1;
      console.error(`FAILED    ${postDoc.ref.path}`, err);
    }
  }

  console.log("");
  console.log(`Tocados: ${touched} · Omitidos (borrados): ${skipped} · Fallidos: ${failed}`);
  console.log(
    "El trigger onPostPlaybackProtection hace la redacción real; revisa los logs de Cloud Functions."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
