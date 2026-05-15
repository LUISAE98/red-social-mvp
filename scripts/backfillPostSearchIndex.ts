import "dotenv/config";
import * as admin from "firebase-admin";

const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const MULTIPLE_SPACES_REGEX = /\s+/g;
const NON_SEARCH_CHARS_REGEX = /[^a-z0-9ñ\s_-]/g;

const POST_SEARCH_INDEX_VERSION = 1;
const BATCH_LIMIT = 400;

type GroupVisibility = "public" | "private" | "hidden";
type PostAccessScope = "group" | "profile";

function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase()
    .replace(NON_SEARCH_CHARS_REGEX, " ")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(MULTIPLE_SPACES_REGEX, " ")
    .trim();
}

function tokenizeSearchText(value: unknown): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  return Array.from(
    new Set(
      normalized
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  ).slice(0, 40);
}

function buildSearchPrefixes(tokens: string[]): string[] {
  const prefixes = new Set<string>();

  for (const rawToken of tokens) {
    const token = normalizeSearchText(rawToken);
    if (token.length < 2) continue;

    const upperLimit = Math.min(token.length, 20);

    for (let length = 2; length <= upperLimit; length += 1) {
      prefixes.add(token.slice(0, length));
      if (prefixes.size >= 120) return Array.from(prefixes);
    }
  }

  return Array.from(prefixes);
}

function normalizeVisibility(value: unknown): GroupVisibility | null {
  if (value === "public" || value === "private" || value === "hidden") {
    return value;
  }

  return null;
}

function normalizeAccessScope(value: unknown): PostAccessScope {
  if (value === "profile") return "profile";
  return "group";
}

async function resolveGroupVisibility(
  db: FirebaseFirestore.Firestore,
  groupId: string,
  currentPostGroupVisibility: unknown
): Promise<GroupVisibility | null> {
  const currentVisibility = normalizeVisibility(currentPostGroupVisibility);

  if (currentVisibility) {
    return currentVisibility;
  }

  const groupSnap = await db.collection("groups").doc(groupId).get();

  if (!groupSnap.exists) {
    return null;
  }

  return normalizeVisibility(groupSnap.data()?.visibility);
}

function buildPostSearchIndex(
  data: FirebaseFirestore.DocumentData,
  groupVisibility: GroupVisibility
) {
  const textNormalized = normalizeSearchText(data.text);
  const tokens = tokenizeSearchText(textNormalized);

  return {
    textNormalized,
    tokens,
    prefixes: buildSearchPrefixes(tokens),
    groupId: typeof data.groupId === "string" ? data.groupId : "",
    authorId: typeof data.authorId === "string" ? data.authorId : "",
    visibility: groupVisibility,
    accessScope: normalizeAccessScope(data.accessScope),
    isDeleted: data.isDeleted === true,
    createdAt: data.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: data.updatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
    version: POST_SEARCH_INDEX_VERSION,
  };
}

function initializeAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

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
  const postsSnap = await db.collection("posts").get();

  let updated = 0;
  let skipped = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const postDoc of postsSnap.docs) {
    const data = postDoc.data();

    if (typeof data.groupId !== "string" || typeof data.authorId !== "string") {
      skipped += 1;
      console.log(`SKIP ${postDoc.id} -> groupId/authorId inválido`);
      continue;
    }

    const groupVisibility = await resolveGroupVisibility(
      db,
      data.groupId,
      data.groupVisibility
    );

    if (!groupVisibility) {
      skipped += 1;
      console.log(`SKIP ${postDoc.id} -> grupo inexistente o visibility inválida`);
      continue;
    }

    const search = buildPostSearchIndex(data, groupVisibility);

    batch.set(
      postDoc.ref,
      {
        groupVisibility,
        isShareable: true,
        accessModel: "free",
        requiresPayment: false,
        requiresSubscription: false,
        search,
        updatedAt: data.updatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    updated += 1;
    batchCount += 1;

    console.log(`OK ${postDoc.id}`);

    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log("");
  console.log("Backfill terminado.");
  console.log(`Actualizados: ${updated}`);
  console.log(`Saltados: ${skipped}`);
}

main().catch((error) => {
  console.error("Backfill falló:", error);
  process.exit(1);
});