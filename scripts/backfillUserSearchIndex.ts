import "dotenv/config";
import * as admin from "firebase-admin";

const PROFILE_SEARCH_INDEX_VERSION = 1;
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 20;
const MAX_PROFILE_SEARCH_PREFIXES = 120;
const BATCH_SIZE = 400;

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
    .replace(/[^a-z0-9ñ\s_-]/g, " ")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
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
        .filter((token) => token.length >= MIN_PREFIX_LENGTH)
    )
  ).slice(0, 30);
}

function normalizeHandleForSearch(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX_PREFIX_LENGTH);
}

function uniqueLimited(values: string[], limit: number): string[] {
  const result = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();

    if (normalized.length < MIN_PREFIX_LENGTH) continue;

    result.add(normalized);

    if (result.size >= limit) break;
  }

  return Array.from(result);
}

function buildSearchPrefixes(
  tokens: string[],
  options?: {
    minLength?: number;
    maxLength?: number;
    maxPrefixes?: number;
  }
): string[] {
  const minLength = options?.minLength ?? MIN_PREFIX_LENGTH;
  const maxLength = options?.maxLength ?? 12;
  const maxPrefixes = options?.maxPrefixes ?? 80;

  const prefixes = new Set<string>();

  for (const rawToken of tokens) {
    const token = normalizeSearchText(rawToken);

    if (token.length < minLength) continue;

    const upperLimit = Math.min(token.length, maxLength);

    for (let length = minLength; length <= upperLimit; length += 1) {
      prefixes.add(token.slice(0, length));

      if (prefixes.size >= maxPrefixes) {
        return Array.from(prefixes);
      }
    }
  }

  return Array.from(prefixes);
}

function mergeSearchTokens(...groups: Array<string[] | undefined | null>): string[] {
  const tokens = new Set<string>();

  for (const group of groups) {
    if (!Array.isArray(group)) continue;

    for (const token of group) {
      const normalized = normalizeSearchText(token);

      if (normalized.length >= MIN_PREFIX_LENGTH) {
        tokens.add(normalized);
      }

      if (tokens.size >= 40) {
        return Array.from(tokens);
      }
    }
  }

  return Array.from(tokens);
}

function buildHandleSearchTokens(handleNormalized: string): string[] {
  if (!handleNormalized) return [];

  const collapsedHandle = handleNormalized.replace(/_/g, "");
  const splitHandleTokens = handleNormalized
    .split("_")
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_PREFIX_LENGTH);

  return uniqueLimited(
    [handleNormalized, collapsedHandle, ...splitHandleTokens],
    10
  );
}

function buildHandlePrefixes(handleNormalized: string): string[] {
  if (handleNormalized.length < MIN_PREFIX_LENGTH) return [];

  const prefixes = new Set<string>();
  const maxLength = Math.min(handleNormalized.length, MAX_PREFIX_LENGTH);

  for (let length = MIN_PREFIX_LENGTH; length <= maxLength; length += 1) {
    prefixes.add(handleNormalized.slice(0, length));
  }

  const collapsedHandle = handleNormalized.replace(/_/g, "");

  if (collapsedHandle.length >= MIN_PREFIX_LENGTH) {
    const collapsedMaxLength = Math.min(
      collapsedHandle.length,
      MAX_PREFIX_LENGTH
    );

    for (
      let length = MIN_PREFIX_LENGTH;
      length <= collapsedMaxLength;
      length += 1
    ) {
      prefixes.add(collapsedHandle.slice(0, length));
    }
  }

  return Array.from(prefixes);
}

function buildProfileSearchIndex(
  data: FirebaseFirestore.DocumentData,
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue
) {
  const handleNormalized = normalizeHandleForSearch(data.handle);
  const firstNameNormalized = normalizeSearchText(data.firstName);
  const lastNameNormalized = normalizeSearchText(data.lastName);

  const fallbackDisplayName = [data.firstName, data.lastName]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");

  const displayNameNormalized = normalizeSearchText(
    typeof data.displayName === "string" && data.displayName.trim()
      ? data.displayName
      : fallbackDisplayName
  );

  const nameNormalized = normalizeSearchText(
    [
      displayNameNormalized,
      firstNameNormalized,
      lastNameNormalized,
      handleNormalized,
    ].join(" ")
  );

  const tokens = mergeSearchTokens(
    buildHandleSearchTokens(handleNormalized),
    tokenizeSearchText(displayNameNormalized),
    tokenizeSearchText(firstNameNormalized),
    tokenizeSearchText(lastNameNormalized),
    tokenizeSearchText(nameNormalized)
  );

  const textPrefixes = buildSearchPrefixes(tokens, {
    minLength: MIN_PREFIX_LENGTH,
    maxLength: 15,
    maxPrefixes: 80,
  });

  const handlePrefixes = buildHandlePrefixes(handleNormalized);

  const prefixes = uniqueLimited(
    [...handlePrefixes, ...textPrefixes],
    MAX_PROFILE_SEARCH_PREFIXES
  );

  return {
    nameNormalized,
    displayNameNormalized,
    firstNameNormalized,
    lastNameNormalized,
    handleNormalized,
    tokens,
    prefixes,
    isActive: data.isActive !== false,
    profileSearchable: data.profileSearchable !== false,
    updatedAt,
    version: PROFILE_SEARCH_INDEX_VERSION,
  };
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();
  const usersSnap = await db.collection("users").get();

  let batch = db.batch();
  let pendingWrites = 0;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const userDoc of usersSnap.docs) {
    scanned += 1;

    const data = userDoc.data();

    if (!data.handle || !data.displayName) {
      skipped += 1;
      console.warn(`[SKIP] ${userDoc.id}: missing handle or displayName`);
      continue;
    }

    const now = admin.firestore.Timestamp.now();
    const search = buildProfileSearchIndex(data, now);

    batch.set(
      userDoc.ref,
      {
        search,
        updatedAt: now,
      },
      { merge: true }
    );

    pendingWrites += 1;
    updated += 1;

    console.log(`OK ${userDoc.id} -> ${data.handle ?? data.displayName}`);

    if (pendingWrites >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
      console.log(`[COMMIT] updated ${updated}/${scanned}`);
    }
  }

  if (pendingWrites > 0) {
    await batch.commit();
  }

  console.log("");
  console.log("Backfill terminado.");
  console.log(`Escaneados: ${scanned}`);
  console.log(`Actualizados: ${updated}`);
  console.log(`Saltados: ${skipped}`);
}

main().catch((error) => {
  console.error("Backfill falló:", error);
  process.exit(1);
});