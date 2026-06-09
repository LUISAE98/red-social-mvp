/**
 * Sincroniza users/{uid}/groupMemberships/{groupId} con el estado real
 * de groups/{groupId}/members/{uid} para todos los grupos.
 *
 * Itera sobre groups → members, escribe directamente el groupMemberships
 * correspondiente. No usa collectionGroup (no necesita índice especial).
 *
 * Uso:
 *   npx tsx scripts/backfill-sync-group-memberships.ts
 *
 * Para un solo grupo:
 *   GROUP_ID=abc123 npx tsx scripts/backfill-sync-group-memberships.ts
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

/** Campos de suscripción que se sincronizan del member doc al groupMemberships */
function buildMembershipPatch(
  memberData: admin.firestore.DocumentData
): Record<string, unknown> {
  const pick = (key: string) =>
    key in memberData ? memberData[key] : admin.firestore.FieldValue.delete();

  return {
    status: memberData.status ?? "active",
    accessType: memberData.accessType ?? "standard",
    requiresSubscription: memberData.requiresSubscription === true,
    subscriptionActive: memberData.subscriptionActive === true,
    legacyComplimentary: memberData.legacyComplimentary === true,
    transitionPendingAction: memberData.transitionPendingAction === true,
    transitionDirection: pick("transitionDirection"),
    transitionResolvedAt: pick("transitionResolvedAt"),
    removedDueToSubscriptionTransition:
      memberData.removedDueToSubscriptionTransition === true,
    removedReason: pick("removedReason"),
    removedAt: pick("removedAt"),
    removedBy: pick("removedBy"),
    subscriptionEndedAt: pick("subscriptionEndedAt"),
    subscriptionEndedBy: pick("subscriptionEndedBy"),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function processGroup(
  db: admin.firestore.Firestore,
  groupDoc: admin.firestore.DocumentSnapshot
): Promise<{ synced: number; errors: number }> {
  const groupId = groupDoc.id;

  const membersSnap = await db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .get();

  if (membersSnap.empty) return { synced: 0, errors: 0 };

  // Filtrar miembros que tengan userId válido
  const validMembers = membersSnap.docs.filter((d) => {
    const uid = d.data()?.userId;
    return typeof uid === "string" && uid.trim().length > 0;
  });

  let synced = 0;
  let errors = 0;

  for (const memberChunk of chunks(validMembers, MAX_BATCH)) {
    try {
      const batch = db.batch();
      for (const memberDoc of memberChunk) {
        const memberData = memberDoc.data();
        const uid = (memberData.userId as string).trim();
        const membershipRef = db
          .collection("users")
          .doc(uid)
          .collection("groupMemberships")
          .doc(groupId);

        batch.set(membershipRef, buildMembershipPatch(memberData), { merge: true });
      }
      await batch.commit();
      synced += memberChunk.length;
    } catch (err) {
      errors += 1;
      console.error(`  ERR batch [${groupId}]`, err);
    }
  }

  return { synced, errors };
}

async function main() {
  initializeAdmin();
  const db = admin.firestore();

  const targetGroupId = process.env.GROUP_ID?.trim() ?? null;

  let groupDocs: admin.firestore.DocumentSnapshot[];

  if (targetGroupId) {
    const snap = await db.collection("groups").doc(targetGroupId).get();
    if (!snap.exists) {
      console.error(`Grupo no encontrado: ${targetGroupId}`);
      process.exit(1);
    }
    groupDocs = [snap];
    console.log(`Apuntando al grupo: ${targetGroupId}`);
  } else {
    const snap = await db.collection("groups").get();
    groupDocs = snap.docs;
    console.log(`Grupos encontrados: ${groupDocs.length}`);
  }

  let totalSynced = 0;
  let totalErrors = 0;

  for (const groupDoc of groupDocs) {
    const name = groupDoc.data()?.name ?? groupDoc.id;
    process.stdout.write(`  [${groupDoc.id}] ${name} ... `);
    try {
      const { synced, errors } = await processGroup(db, groupDoc);
      totalSynced += synced;
      totalErrors += errors;
      console.log(`synced=${synced} errors=${errors}`);
    } catch (err) {
      totalErrors += 1;
      console.log("FALLÓ");
      console.error(err);
    }
  }

  console.log("");
  console.log(`Membresías sincronizadas: ${totalSynced}`);
  console.log(`Errores                 : ${totalErrors}`);
}

main().catch((err) => {
  console.error("Script falló:", err);
  process.exit(1);
});
