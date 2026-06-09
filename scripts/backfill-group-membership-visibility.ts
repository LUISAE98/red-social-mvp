/**
 * Sincroniza visibility (y otros metadatos) de cada grupo hacia los documentos
 * users/{uid}/groupMemberships/{groupId} de todos sus miembros.
 *
 * Uso:
 *   npx tsx scripts/backfill-group-membership-visibility.ts
 *
 * Para apuntar solo a un grupo específico:
 *   GROUP_ID=abc123 npx tsx scripts/backfill-group-membership-visibility.ts
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

const MAX_BATCH = 500;

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

async function syncGroupMemberships(
  db: admin.firestore.Firestore,
  groupId: string,
  groupData: admin.firestore.DocumentData
): Promise<number> {
  const membersSnap = await db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .get();

  if (membersSnap.empty) return 0;

  const patch = {
    visibility: groupData.visibility ?? null,
    groupVisibility: groupData.visibility ?? null,
    name: groupData.name ?? null,
    groupName: groupData.name ?? null,
    avatarUrl: groupData.avatarUrl ?? null,
    groupAvatarUrl: groupData.avatarUrl ?? null,
    coverUrl: groupData.coverUrl ?? null,
    groupCoverUrl: groupData.coverUrl ?? null,
    isActive: groupData.isActive ?? null,
    groupIsActive: groupData.isActive ?? null,
    discoverable: groupData.discoverable ?? null,
    groupDiscoverable: groupData.discoverable ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const memberDocs = membersSnap.docs.filter((d) => {
    const data = d.data();
    return typeof data.userId === "string" && data.userId.trim().length > 0;
  });

  for (const chunk of chunks(memberDocs, MAX_BATCH)) {
    const batch = db.batch();
    for (const memberDoc of chunk) {
      const userId = (memberDoc.data().userId as string).trim();
      const ref = db
        .collection("users")
        .doc(userId)
        .collection("groupMemberships")
        .doc(groupId);
      batch.set(ref, patch, { merge: true });
    }
    await batch.commit();
  }

  return memberDocs.length;
}

async function main() {
  initializeAdmin();
  const db = admin.firestore();

  const targetGroupId = process.env.GROUP_ID?.trim() ?? null;

  let groupsSnap: admin.firestore.QuerySnapshot;

  if (targetGroupId) {
    const single = await db.collection("groups").doc(targetGroupId).get();
    if (!single.exists) {
      console.error(`Grupo no encontrado: ${targetGroupId}`);
      process.exit(1);
    }
    groupsSnap = { docs: [single] } as unknown as admin.firestore.QuerySnapshot;
    console.log(`Apuntando al grupo: ${targetGroupId}`);
  } else {
    groupsSnap = await db.collection("groups").get();
    console.log(`Grupos encontrados: ${groupsSnap.docs.length}`);
  }

  let totalGroups = 0;
  let totalMemberships = 0;
  let failed = 0;

  for (const groupDoc of groupsSnap.docs) {
    try {
      const data = groupDoc.data();
      const name = typeof data.name === "string" ? data.name : groupDoc.id;
      const count = await syncGroupMemberships(db, groupDoc.id, data);
      totalMemberships += count;
      totalGroups += 1;
      console.log(`OK  [${groupDoc.id}] ${name} → ${count} membresías actualizadas`);
    } catch (err) {
      failed += 1;
      console.error(`ERR [${groupDoc.id}]`, err);
    }
  }

  console.log("");
  console.log(`Grupos procesados : ${totalGroups}`);
  console.log(`Membresías updated: ${totalMemberships}`);
  console.log(`Errores           : ${failed}`);
}

main().catch((err) => {
  console.error("Script falló:", err);
  process.exit(1);
});
