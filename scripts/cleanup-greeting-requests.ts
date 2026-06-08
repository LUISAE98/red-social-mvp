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

const BATCH_SIZE = 400;

async function deleteCollection(
  db: admin.firestore.Firestore,
  collectionPath: string
): Promise<number> {
  const colRef = db.collection(collectionPath);
  let total = 0;

  while (true) {
    const snap = await colRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    total += snap.size;
    console.log(`  [${collectionPath}] ${total} eliminados...`);
  }

  return total;
}

async function deleteByQuery(
  db: admin.firestore.Firestore,
  query: admin.firestore.Query,
  label: string
): Promise<number> {
  let total = 0;

  while (true) {
    const snap = await query.limit(BATCH_SIZE).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    total += snap.size;
    console.log(`  [${label}] ${total} eliminados...`);
  }

  return total;
}

async function main() {
  initializeAdmin();
  const db = admin.firestore();

  console.log("==============================================");
  console.log(" Limpieza de solicitudes de servicios");
  console.log("==============================================\n");

  console.log("1. Eliminando greetingRequests (saludos/consejos)...");
  const greetingCount = await deleteCollection(db, "greetingRequests");
  console.log(`   ✓ ${greetingCount} documentos eliminados\n`);

  console.log("2. Eliminando muxUploads de saludos/consejos...");
  const muxQuery = db
    .collection("muxUploads")
    .where("contextType", "==", "greeting");
  const muxCount = await deleteByQuery(db, muxQuery, "muxUploads/greeting");
  console.log(`   ✓ ${muxCount} documentos eliminados\n`);

  console.log("3. Eliminando meetGreetRequests (meet & greet)...");
  const meetGreetCount = await deleteCollection(db, "meetGreetRequests");
  console.log(`   ✓ ${meetGreetCount} documentos eliminados\n`);

  console.log("4. Eliminando exclusiveSessionRequests (sesión exclusiva)...");
  const exclusiveCount = await deleteCollection(db, "exclusiveSessionRequests");
  console.log(`   ✓ ${exclusiveCount} documentos eliminados\n`);

  console.log("==============================================");
  console.log(" Listo.");
  console.log(`   greetingRequests         : ${greetingCount} docs`);
  console.log(`   muxUploads (greeting)    : ${muxCount} docs`);
  console.log(`   meetGreetRequests        : ${meetGreetCount} docs`);
  console.log(`   exclusiveSessionRequests : ${exclusiveCount} docs`);
  console.log("==============================================");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
