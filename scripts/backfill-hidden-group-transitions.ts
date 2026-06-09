/**
 * Elimina documentos stale en users/{uid}/hiddenGroupTransitions/{groupId}
 * para usuarios que ya tienen membresía activa en ese grupo.
 *
 * Un documento es "stale" cuando el usuario ya tiene:
 *   - status: "active" | "subscribed" | "muted"
 *   - o subscriptionActive: true
 * en su groupMemberships doc, pero el hiddenGroupTransitions doc sigue ahí.
 *
 * Uso:
 *   npx tsx scripts/backfill-hidden-group-transitions.ts
 */

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

function isActiveMember(data: admin.firestore.DocumentData): boolean {
  const status =
    typeof data.status === "string" ? data.status.trim().toLowerCase() : "";

  if (status === "active" || status === "subscribed" || status === "muted") {
    return true;
  }

  if (data.subscriptionActive === true) {
    return true;
  }

  return false;
}

async function main() {
  initializeAdmin();
  const db = admin.firestore();

  // Collection group query para obtener todos los hiddenGroupTransitions de todos los usuarios
  const transitionsSnap = await db
    .collectionGroup("hiddenGroupTransitions")
    .get();

  console.log(`hiddenGroupTransitions encontrados: ${transitionsSnap.docs.length}`);
  console.log("");

  let deleted = 0;
  let kept = 0;
  let noMembership = 0;
  let failed = 0;

  for (const transDoc of transitionsSnap.docs) {
    try {
      // Path: users/{uid}/hiddenGroupTransitions/{groupId}
      const pathParts = transDoc.ref.path.split("/");
      const uid = pathParts[1];
      const groupId = pathParts[3];

      if (!uid || !groupId) {
        console.log(`SKIP ${transDoc.ref.path} → path inesperado`);
        kept += 1;
        continue;
      }

      const membershipSnap = await db
        .collection("users")
        .doc(uid)
        .collection("groupMemberships")
        .doc(groupId)
        .get();

      if (!membershipSnap.exists) {
        // No tiene membresía — el recordatorio puede ser válido
        noMembership += 1;
        console.log(`KEEP ${transDoc.ref.path} → sin membresía activa`);
        continue;
      }

      const membershipData = membershipSnap.data() ?? {};

      if (isActiveMember(membershipData)) {
        await transDoc.ref.delete();
        deleted += 1;
        console.log(`DEL  ${transDoc.ref.path} → ya tiene membresía activa`);
      } else {
        kept += 1;
        console.log(`KEEP ${transDoc.ref.path} → membresía no activa, recordatorio válido`);
      }
    } catch (err) {
      failed += 1;
      console.error(`ERR  ${transDoc.ref.path}`, err);
    }
  }

  console.log("");
  console.log(`Eliminados    : ${deleted}`);
  console.log(`Conservados   : ${kept}`);
  console.log(`Sin membresía : ${noMembership}`);
  console.log(`Errores       : ${failed}`);
}

main().catch((err) => {
  console.error("Script falló:", err);
  process.exit(1);
});
