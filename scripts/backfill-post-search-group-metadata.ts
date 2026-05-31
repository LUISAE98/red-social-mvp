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

type GroupMetadata = {
  groupName: string | null;
  groupAvatarUrl: string | null;
  groupVisibility: "public" | "private" | "hidden" | null;
};

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function pickGroupVisibility(value: unknown): GroupMetadata["groupVisibility"] {
  if (value === "public" || value === "private" || value === "hidden") {
    return value;
  }

  return null;
}

function getGroupMetadata(data: FirebaseFirestore.DocumentData): GroupMetadata {
  return {
    groupName: pickString(data.name) ?? pickString(data.groupName),
    groupAvatarUrl:
      pickString(data.avatarUrl) ??
      pickString(data.imageUrl) ??
      pickString(data.photoURL) ??
      pickString(data.groupAvatarUrl),
    groupVisibility: pickGroupVisibility(data.visibility),
  };
}

function postAlreadyHasMetadata(
  postData: FirebaseFirestore.DocumentData,
  groupMetadata: GroupMetadata
): boolean {
  const search =
    postData.search && typeof postData.search === "object" ? postData.search : {};

  return (
    postData.groupName === groupMetadata.groupName &&
    postData.groupAvatarUrl === groupMetadata.groupAvatarUrl &&
    postData.groupVisibility === groupMetadata.groupVisibility &&
    search.groupName === groupMetadata.groupName &&
    search.groupAvatarUrl === groupMetadata.groupAvatarUrl &&
    search.groupVisibility === groupMetadata.groupVisibility
  );
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();
  const postsSnap = await db.collection("posts").get();
  const groupCache = new Map<string, GroupMetadata | null>();

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Posts encontrados: ${postsSnap.size}`);
  console.log("");

  for (const postDoc of postsSnap.docs) {
    try {
      const postData = postDoc.data();
      const groupId =
        typeof postData.groupId === "string" && postData.groupId.trim().length > 0
          ? postData.groupId.trim()
          : null;

      if (!groupId) {
        skipped += 1;
        console.log(`SKIPPED ${postDoc.ref.path} -> sin groupId`);
        continue;
      }

      let groupMetadata = groupCache.get(groupId);

      if (groupMetadata === undefined) {
        const groupSnap = await db.collection("groups").doc(groupId).get();

        if (!groupSnap.exists) {
          groupMetadata = null;
        } else {
          groupMetadata = getGroupMetadata(groupSnap.data() ?? {});
        }

        groupCache.set(groupId, groupMetadata);
      }

      if (!groupMetadata) {
        skipped += 1;
        console.log(`SKIPPED ${postDoc.ref.path} -> grupo no encontrado: ${groupId}`);
        continue;
      }

      if (postAlreadyHasMetadata(postData, groupMetadata)) {
        unchanged += 1;
        console.log(`OK ${postDoc.ref.path} -> ${groupMetadata.groupName ?? groupId}`);
        continue;
      }

      await postDoc.ref.set(
        {
          groupName: groupMetadata.groupName,
          groupAvatarUrl: groupMetadata.groupAvatarUrl,
          groupVisibility: groupMetadata.groupVisibility,
          search: {
            groupName: groupMetadata.groupName,
            groupAvatarUrl: groupMetadata.groupAvatarUrl,
            groupVisibility: groupMetadata.groupVisibility,
            updatedAt: postData.search?.updatedAt ?? postData.updatedAt ?? null,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      updated += 1;
      console.log(
        `UPDATED ${postDoc.ref.path} -> ${groupMetadata.groupName ?? groupId}`
      );
    } catch (error) {
      failed += 1;
      console.error(`FAILED ${postDoc.ref.path}`, error);
    }
  }

  console.log("");
  console.log("Backfill post search group metadata terminado.");
  console.log(`Actualizados: ${updated}`);
  console.log(`Sin cambios: ${unchanged}`);
  console.log(`Omitidos: ${skipped}`);
  console.log(`Fallidos: ${failed}`);
}

main().catch((error) => {
  console.error("Backfill post search group metadata falló:", error);
  process.exit(1);
});