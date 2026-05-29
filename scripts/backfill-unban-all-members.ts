import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_LIMIT = 450;

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

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getGroupIdFromMemberPath(path: string): string | null {
  const parts = path.split("/");
  const groupsIndex = parts.indexOf("groups");
  return groupsIndex >= 0 ? pickString(parts[groupsIndex + 1]) : null;
}

function getUserIdFromMemberPath(path: string): string | null {
  const parts = path.split("/");
  const membersIndex = parts.indexOf("members");
  return membersIndex >= 0 ? pickString(parts[membersIndex + 1]) : null;
}

function getUserIdFromUserMembershipPath(path: string): string | null {
  const parts = path.split("/");
  const usersIndex = parts.indexOf("users");
  return usersIndex >= 0 ? pickString(parts[usersIndex + 1]) : null;
}

function getGroupIdFromUserMembershipPath(path: string): string | null {
  const parts = path.split("/");
  const groupMembershipsIndex = parts.indexOf("groupMemberships");

  return groupMembershipsIndex >= 0
    ? pickString(parts[groupMembershipsIndex + 1])
    : null;
}

async function flushBatch(
  db: FirebaseFirestore.Firestore,
  currentBatch: FirebaseFirestore.WriteBatch,
  operationCount: number
): Promise<FirebaseFirestore.WriteBatch> {
  if (operationCount <= 0) return currentBatch;

  if (DRY_RUN) {
    console.log(`[DRY_RUN] Se simularían ${operationCount} escrituras.`);
    return db.batch();
  }

  await currentBatch.commit();
  console.log(`Commit aplicado con ${operationCount} escrituras.`);
  return db.batch();
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();

  let batch = db.batch();
  let operationCount = 0;

  let scannedGroupMembers = 0;
  let scannedUserMemberships = 0;
  let updatedGroupMembers = 0;
  let updatedUserMemberships = 0;
  let skipped = 0;

  console.log("");
  console.log("Backfill unban all members");
  console.log(`Modo: ${DRY_RUN ? "DRY_RUN" : "WRITE"}`);
  console.log("");

  console.log("Leyendo collectionGroup('members') sin índice...");
  const groupMembersSnap = await db.collectionGroup("members").get();

  scannedGroupMembers = groupMembersSnap.size;

  const bannedGroupMembers = groupMembersSnap.docs.filter(
    (doc) => doc.data().status === "banned"
  );

  console.log(`members escaneados: ${scannedGroupMembers}`);
  console.log(`members con status banned: ${bannedGroupMembers.length}`);
  console.log("");

  for (const memberDoc of bannedGroupMembers) {
    const groupId = getGroupIdFromMemberPath(memberDoc.ref.path);
    const userId = getUserIdFromMemberPath(memberDoc.ref.path);

    if (!groupId || !userId) {
      skipped += 1;
      console.log(`SKIP ${memberDoc.ref.path} -> no pude leer groupId/userId`);
      continue;
    }

    const userMembershipRef = db
      .collection("users")
      .doc(userId)
      .collection("groupMemberships")
      .doc(groupId);

    const patch = {
      status: "active",
      mutedUntil: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      unbannedAt: admin.firestore.FieldValue.serverTimestamp(),
      moderatedBy: "system_backfill_unban_all_members",
    };

    batch.set(memberDoc.ref, patch, { merge: true });
    batch.set(userMembershipRef, patch, { merge: true });

    operationCount += 2;
    updatedGroupMembers += 1;
    updatedUserMemberships += 1;

    console.log(`OK ${memberDoc.ref.path} -> active`);

    if (operationCount >= BATCH_LIMIT) {
      batch = await flushBatch(db, batch, operationCount);
      operationCount = 0;
    }
  }

  console.log("");
  console.log("Leyendo collectionGroup('groupMemberships') sin índice...");
  const userMembershipsSnap = await db.collectionGroup("groupMemberships").get();

  scannedUserMemberships = userMembershipsSnap.size;

  const bannedUserMemberships = userMembershipsSnap.docs.filter(
    (doc) => doc.data().status === "banned"
  );

  console.log(`groupMemberships escaneados: ${scannedUserMemberships}`);
  console.log(
    `groupMemberships con status banned: ${bannedUserMemberships.length}`
  );
  console.log("");

  for (const userMembershipDoc of bannedUserMemberships) {
    const userId = getUserIdFromUserMembershipPath(userMembershipDoc.ref.path);
    const groupId = getGroupIdFromUserMembershipPath(
      userMembershipDoc.ref.path
    );

    if (!groupId || !userId) {
      skipped += 1;
      console.log(
        `SKIP ${userMembershipDoc.ref.path} -> no pude leer userId/groupId`
      );
      continue;
    }

    const groupMemberRef = db
      .collection("groups")
      .doc(groupId)
      .collection("members")
      .doc(userId);

    const patch = {
      status: "active",
      mutedUntil: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      unbannedAt: admin.firestore.FieldValue.serverTimestamp(),
      moderatedBy: "system_backfill_unban_all_members",
    };

    batch.set(userMembershipDoc.ref, patch, { merge: true });
    batch.set(groupMemberRef, patch, { merge: true });

    operationCount += 2;
    updatedUserMemberships += 1;
    updatedGroupMembers += 1;

    console.log(`OK ${userMembershipDoc.ref.path} -> active`);

    if (operationCount >= BATCH_LIMIT) {
      batch = await flushBatch(db, batch, operationCount);
      operationCount = 0;
    }
  }

  await flushBatch(db, batch, operationCount);

  console.log("");
  console.log("Backfill terminado.");
  console.log(`members escaneados: ${scannedGroupMembers}`);
  console.log(`groupMemberships escaneados: ${scannedUserMemberships}`);
  console.log(`members actualizados/simulados: ${updatedGroupMembers}`);
  console.log(
    `groupMemberships actualizados/simulados: ${updatedUserMemberships}`
  );
  console.log(`Saltados: ${skipped}`);
  console.log("");
}

main().catch((error) => {
  console.error("Backfill unban all members falló:", error);
  process.exit(1);
});