import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { normalizeHandleForSearch } from "@/lib/profile/profileSearchIndex";
import {
  buildSearchPrefixes,
  normalizeSearchText,
  tokenizeSearchText,
} from "@/lib/search/normalize";

const MIN_PROFILE_SEARCH_QUERY_LENGTH = 2;
const MAX_PROFILE_RESULTS = 20;
const MAX_ARRAY_CONTAINS_ANY_VALUES = 10;

export type ProfileSearchResult = {
  uid: string;
  handle: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string | null;
  offerings?: Array<Record<string, any>> | Record<string, any>;
  donation?: Record<string, any>;
  monetization?: Record<string, any>;
  searchScore: number;
};

export type SearchProfilesOptions = {
  db: Firestore;
  rawQuery: string;
  currentUserId?: string | null;
  maxResults?: number;
};

export async function searchProfiles({
  db,
  rawQuery,
  currentUserId = null,
  maxResults = MAX_PROFILE_RESULTS,
}: SearchProfilesOptions): Promise<ProfileSearchResult[]> {
  const normalizedQuery = normalizeSearchText(rawQuery);
  const handleQuery = normalizeHandleForSearch(rawQuery);
  const normalizedMaxResults = normalizeMaxResults(maxResults);

  if (
    normalizedQuery.length < MIN_PROFILE_SEARCH_QUERY_LENGTH &&
    handleQuery.length < MIN_PROFILE_SEARCH_QUERY_LENGTH
  ) {
    return [];
  }

  const resultsByUid = new Map<string, ProfileSearchResult>();

  if (shouldRunExactHandleLookup(rawQuery, handleQuery)) {
    await addExactHandleMatch({
      db,
      handleQuery,
      currentUserId,
      resultsByUid,
    });
  }

  const prefixTerms = buildProfileQueryPrefixes(normalizedQuery, handleQuery);

  if (prefixTerms.length > 0) {
    const usersRef = collection(db, "users");

    const usersQuery = query(
      usersRef,
      where("search.isActive", "==", true),
      where("search.profileSearchable", "==", true),
      where(
        "search.prefixes",
        "array-contains-any",
        prefixTerms.slice(0, MAX_ARRAY_CONTAINS_ANY_VALUES)
      ),
      limit(Math.max(normalizedMaxResults * 2, MAX_PROFILE_RESULTS))
    );

    const snap = await getDocs(usersQuery);

    for (const userDoc of snap.docs) {
      const result = mapUserDocToProfileSearchResult(
        userDoc,
        normalizedQuery,
        handleQuery
      );

      if (!result) continue;
      if (currentUserId && result.uid === currentUserId) continue;

      upsertBestResult(resultsByUid, result);
    }
  }

  return Array.from(resultsByUid.values())
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, normalizedMaxResults);
}

function normalizeMaxResults(maxResults?: number): number {
  if (!Number.isFinite(maxResults)) return MAX_PROFILE_RESULTS;

  return Math.max(
    1,
    Math.min(Math.floor(maxResults ?? MAX_PROFILE_RESULTS), MAX_PROFILE_RESULTS)
  );
}

function shouldRunExactHandleLookup(rawQuery: string, handleQuery: string): boolean {
  if (handleQuery.length < MIN_PROFILE_SEARCH_QUERY_LENGTH) return false;

  const trimmed = rawQuery.trim();

  if (trimmed.startsWith("@")) return true;

  const hasWhitespace = /\s/.test(trimmed);
  const looksLikeHandle = /^[a-zA-Z0-9._-]+$/.test(trimmed);

  return !hasWhitespace && looksLikeHandle;
}

async function addExactHandleMatch({
  db,
  handleQuery,
  currentUserId,
  resultsByUid,
}: {
  db: Firestore;
  handleQuery: string;
  currentUserId?: string | null;
  resultsByUid: Map<string, ProfileSearchResult>;
}) {
  if (handleQuery.length < MIN_PROFILE_SEARCH_QUERY_LENGTH) return;

  const handleRef = doc(db, "handles", handleQuery);
  const handleSnap = await getDoc(handleRef);

  if (!handleSnap.exists()) return;

  const uid = handleSnap.data()?.uid;

  if (typeof uid !== "string" || !uid) return;
  if (currentUserId && uid === currentUserId) return;

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return;

  const result = mapUserDocDataToProfileSearchResult(
    uid,
    userSnap.data(),
    "",
    handleQuery,
    1000
  );

  if (!result) return;

  upsertBestResult(resultsByUid, result);
}

function buildProfileQueryPrefixes(
  normalizedQuery: string,
  handleQuery: string
): string[] {
  const normalizedTokens = tokenizeSearchText(normalizedQuery);

  const textPrefixes = buildSearchPrefixes(normalizedTokens, {
    minLength: MIN_PROFILE_SEARCH_QUERY_LENGTH,
    maxLength: 20,
    maxPrefixes: 8,
  });

  const terms = new Set<string>();

  if (handleQuery.length >= MIN_PROFILE_SEARCH_QUERY_LENGTH) {
    terms.add(handleQuery.slice(0, 20));
  }

  for (const token of normalizedTokens) {
    if (token.length >= MIN_PROFILE_SEARCH_QUERY_LENGTH) {
      terms.add(token.slice(0, 20));
    }
  }

  for (const prefix of textPrefixes) {
    if (prefix.length >= MIN_PROFILE_SEARCH_QUERY_LENGTH) {
      terms.add(prefix.slice(0, 20));
    }
  }

  return Array.from(terms).slice(0, MAX_ARRAY_CONTAINS_ANY_VALUES);
}

function mapUserDocToProfileSearchResult(
  userDoc: QueryDocumentSnapshot<DocumentData>,
  normalizedQuery: string,
  handleQuery: string
): ProfileSearchResult | null {
  return mapUserDocDataToProfileSearchResult(
    userDoc.id,
    userDoc.data(),
    normalizedQuery,
    handleQuery,
    0
  );
}

function mapUserDocDataToProfileSearchResult(
  uid: string,
  data: DocumentData,
  normalizedQuery: string,
  handleQuery: string,
  scoreBoost: number
): ProfileSearchResult | null {
  const handle = typeof data.handle === "string" ? data.handle : "";
  const displayName = typeof data.displayName === "string" ? data.displayName : "";

  if (!uid || !handle || !displayName) return null;

  const search = data.search && typeof data.search === "object" ? data.search : null;

  if (search?.isActive === false) return null;
  if (search?.profileSearchable === false) return null;

  const firstName = typeof data.firstName === "string" ? data.firstName : undefined;
  const lastName = typeof data.lastName === "string" ? data.lastName : undefined;

  return {
    uid,
    handle,
    displayName,
    firstName,
    lastName,
    photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
    offerings:
      Array.isArray(data.offerings) ||
      (typeof data.offerings === "object" && data.offerings !== null)
        ? (data.offerings as Array<Record<string, any>> | Record<string, any>)
        : undefined,
    donation:
      typeof data.donation === "object" && data.donation !== null
        ? (data.donation as Record<string, any>)
        : undefined,
    monetization:
      typeof data.monetization === "object" && data.monetization !== null
        ? (data.monetization as Record<string, any>)
        : undefined,
    searchScore:
      scoreBoost +
      calculateProfileSearchScore({
        data,
        normalizedQuery,
        handleQuery,
      }),
  };
}

function calculateProfileSearchScore({
  data,
  normalizedQuery,
  handleQuery,
}: {
  data: DocumentData;
  normalizedQuery: string;
  handleQuery: string;
}): number {
  const search = data.search && typeof data.search === "object" ? data.search : {};

  const handleNormalized =
    typeof search.handleNormalized === "string"
      ? search.handleNormalized
      : normalizeHandleForSearch(data.handle);

  const displayNameNormalized =
    typeof search.displayNameNormalized === "string"
      ? search.displayNameNormalized
      : normalizeSearchText(data.displayName);

  const firstNameNormalized =
    typeof search.firstNameNormalized === "string"
      ? search.firstNameNormalized
      : normalizeSearchText(data.firstName);

  const lastNameNormalized =
    typeof search.lastNameNormalized === "string"
      ? search.lastNameNormalized
      : normalizeSearchText(data.lastName);

  let score = 0;

  if (handleQuery && handleNormalized === handleQuery) score += 500;
  if (handleQuery && handleNormalized.startsWith(handleQuery)) score += 250;

  if (normalizedQuery && displayNameNormalized === normalizedQuery) score += 200;
  if (normalizedQuery && displayNameNormalized.startsWith(normalizedQuery)) {
    score += 150;
  }

  if (normalizedQuery && firstNameNormalized.startsWith(normalizedQuery)) {
    score += 100;
  }

  if (normalizedQuery && lastNameNormalized.startsWith(normalizedQuery)) {
    score += 90;
  }

  if (normalizedQuery && displayNameNormalized.includes(normalizedQuery)) {
    score += 60;
  }

  return score;
}

function upsertBestResult(
  resultsByUid: Map<string, ProfileSearchResult>,
  result: ProfileSearchResult
) {
  const existing = resultsByUid.get(result.uid);

  if (!existing || result.searchScore > existing.searchScore) {
    resultsByUid.set(result.uid, result);
  }
}