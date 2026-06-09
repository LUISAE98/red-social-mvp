/**
 * Elimina documentos huérfanos en users/{uid}/groupMemberships/{groupId}
 * donde el doc groups/{groupId}/members/{uid} ya no existe.
 *
 * Antes del commit 46da555, leaveGroup solo borraba el doc del miembro
 * pero NO el groupMemberships. Este script limpia esos restos.
 *
 * Uso:
 *   npx tsx scripts/backfill-cleanup-orphan-memberships.ts
 *
 * Para un solo usuario:
 *   UID=abc123 npx tsx scripts/backfill-cleanup-orphan-memberships.ts
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

const MAX_BATCH = 400;

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

async function main() {
  initializeAdmin();
  const db = admin.firestore();

  const targetUid = process.env.UID?.trim() ?? null;

  let membershipDocs: admin.firestore.QueryDocumentSnapshot[];

  if (targetUid) {
    console.log(`Revisando solo el usuario: ${targetUid}`);
    const snap = await db
      .collection("users")
      .doc(targetUid)
      .collection("groupMemberships")
      .get();
    membershipDocs = snap.docs;
  } else {
    console.log("Buscando todos los groupMemberships via collectionGroup...");
    const snap = await db.collectionGroup("groupMemberships").get();
    membershipDocs = snap.docs;
  }

  console.log(`groupMemberships encontrados: ${membershipDocs.length}`);
  console.log("");

  // Agrupar por groupId para verificar existencia de members en lote
  // Estructura: orphans = array de refs a eliminar
  const toDelete: admin.firestore.DocumentReference[] = [];
  const toKeep: number[] = [];

  let checked = 0;
  const total = membershipDocs.length;

  for (const membershipDoc of membershipDocs) {
    checked++;

    // Path: users/{uid}/groupMemberships/{groupId}
    const pathParts = membershipDoc.ref.path.split("/");
    const uid = pathParts[1];
    const groupId = pathParts[3];

    if (!uid || !groupId) {
      console.log(`SKIP ${membershipDoc.ref.path} → path inesperado`);
      continue;
    }

    if (checked % 50 === 0) {
      process.stdout.write(`  Revisados: ${checked}/${total}...\r`);
    }

    const memberRef = db
      .collection("groups")
      .doc(groupId)
      .collection("members")
      .doc(uid);

    const memberSnap = await memberRef.get();

    if (!memberSnap.exists) {
      console.log(`ORPHAN ${membershipDoc.ref.path} → sin doc members/${uid}`);
      toDelete.push(membershipDoc.ref);
    } else {
      toKeep.push(1);
    }
  }

  console.log("");
  console.log(`Huérfanos encontrados: ${toDelete.length}`);
  console.log(`Con miembro activo   : ${toKeep.length}`);

  if (toDelete.length === 0) {
    console.log("Nada que limpiar.");
    return;
  }

  console.log("");
  console.log("Eliminando huérfanos en batches...");

  let deleted = 0;
  let errors = 0;

  for (const chunk of chunks(toDelete, MAX_BATCH)) {
    try {
      const batch = db.batch();
      for (const ref of chunk) {
        batch.delete(ref);
      }
      await batch.commit();
      deleted += chunk.length;
      console.log(`  Eliminados: ${deleted}/${toDelete.length}`);
    } catch (err) {
      errors += 1;
      console.error(`  ERR batch`, err);
    }
  }

  console.log("");
  console.log(`Eliminados: ${deleted}`);
  console.log(`Errores   : ${errors}`);
}

main().catch((err) => {
  console.error("Script falló:", err);
  process.exit(1);
});
