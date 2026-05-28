import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
import * as admin from "firebase-admin";

const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 20;
const MAX_PREFIXES = 10;

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

function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  return Array.from(
    new Set(value.split(" ").map((token) => token.trim()).filter(Boolean))
  );
}

function buildSearchPrefixes(tokens: string[]): string[] {
  const prefixes: string[] = [];

  for (const token of tokens) {
    const maxLength = Math.min(token.length, MAX_PREFIX_LENGTH);

    for (let length = MIN_PREFIX_LENGTH; length <= maxLength; length += 1) {
      prefixes.push(token.slice(0, length));

      if (prefixes.length >= MAX_PREFIXES) {
        return Array.from(new Set(prefixes));
      }
    }
  }

  return Array.from(new Set(prefixes)).slice(0, MAX_PREFIXES);
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();

  const postsSnap = await db
    .collection("posts")
    .where("contextType", "==", "profile")
    .where("isDeleted", "==", false)
    .get();

  let updated = 0;
  let skipped = 0;

  for (const postDoc of postsSnap.docs) {
    const data = postDoc.data();

    const text = typeof data.text === "string" ? data.text : "";
    const normalizedText = normalizeSearchText(text);
    const tokens = tokenizeSearchText(normalizedText);
    const prefixes = buildSearchPrefixes(tokens);

    const authorId =
      typeof data.authorId === "string" && data.authorId.trim().length > 0
        ? data.authorId.trim()
        : null;

    const profileId =
      typeof data.profileId === "string" && data.profileId.trim().length > 0
        ? data.profileId.trim()
        : authorId;

    if (!authorId || !profileId || prefixes.length === 0) {
      skipped += 1;
      continue;
    }

    const profileRestricted = data.profileRestricted === true;

    const createdAt =
      data.search?.createdAt ??
      data.createdAt ??
      admin.firestore.FieldValue.serverTimestamp();

    const payload: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      contextType: "profile",
      groupId: null,
      groupVisibility: null,
      profileId,
      profileRestricted,
      accessScope: "profile",

      "search.textNormalized": normalizedText,
      "search.tokens": tokens,
      "search.prefixes": prefixes,
      "search.contextType": "profile",
      "search.groupId": null,
      "search.profileId": profileId,
      "search.authorId": authorId,
      "search.visibility": profileRestricted ? "private" : "public",
      "search.accessScope": "profile",
      "search.isDeleted": false,
      "search.createdAt": createdAt,
      "search.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      "search.version": 1,

      updatedAt: data.updatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
    };

    await postDoc.ref.set(payload, { merge: true });

    updated += 1;
    console.log(`OK ${postDoc.id} -> profileId=${profileId}`);
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