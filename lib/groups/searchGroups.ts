import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  buildSearchPrefixes,
  normalizeSearchText,
  tokenizeSearchText,
} from "@/lib/search/normalize";
import type { Group, GroupVisibility } from "@/types/group";

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 24;
const MAX_FIRESTORE_ARRAY_CONTAINS_ANY = 10;
const MAX_FIRESTORE_DISJUNCTIONS = 30;
const SEARCH_GROUPS_CACHE_TTL_MS = 30_000;

type SearchableVisibility = Extract<GroupVisibility, "public" | "private">;

export type SearchGroupsCursor = QueryDocumentSnapshot<DocumentData> | null;

export type SearchGroupsOptions = {
  term: string;
  pageSize?: number;
  cursor?: SearchGroupsCursor;

  /**
   * El buscador público solo debe listar public/private.
   * hidden queda fuera salvo flujos específicos por invitación.
   */
  visibility?: SearchableVisibility[];
};

export type SearchGroupsResult = {
  groups: Group[];
  cursor: SearchGroupsCursor;
  hasMore: boolean;
};

type SearchGroupsCacheEntry = {
  expiresAt: number;
  result: SearchGroupsResult;
};

const searchGroupsCache = new Map<string, SearchGroupsCacheEntry>();

export async function searchGroups({
  term,
  pageSize = DEFAULT_PAGE_SIZE,
  cursor = null,
  visibility = ["public", "private"],
}: SearchGroupsOptions): Promise<SearchGroupsResult> {
  const safePageSize = clampPageSize(pageSize);
  const safeVisibility = normalizeSearchableVisibility(visibility);
  const normalizedTerm = normalizeSearchText(term);

  const cacheKey = getSearchGroupsCacheKey({
    normalizedTerm,
    pageSize: safePageSize,
    visibility: safeVisibility,
    cursor,
  });

  const cached = readSearchGroupsCache(cacheKey);

  if (cached) {
    return cached;
  }

  const searchPrefixes = buildGroupSearchPrefixes({
    normalizedTerm,
    visibilityCount: safeVisibility.length,
  });

  if (searchPrefixes.length === 0) {
    const result = await fetchDiscoverableGroupsPage({
      pageSize: safePageSize,
      cursor,
      visibility: safeVisibility,
    });

    writeSearchGroupsCache(cacheKey, result);
    return result;
  }

  const groupsRef = collection(db, "groups");

  const constraints: QueryConstraint[] = [
    ...buildBaseSearchConstraints(safeVisibility),
    where("search.prefixes", "array-contains-any", searchPrefixes),
    orderBy("search.updatedAt", "desc"),
    limit(safePageSize + 1),
  ];

  const q = cursor
    ? query(groupsRef, ...constraints, startAfter(cursor))
    : query(groupsRef, ...constraints);

  const snap = await getDocs(q);

  const result = mapSearchGroupsSnapshot({
    docs: snap.docs,
    pageSize: safePageSize,
    fallbackCursor: cursor,
  });

  writeSearchGroupsCache(cacheKey, result);

  return result;
}

export async function fetchDiscoverableGroupsPage({
  pageSize = DEFAULT_PAGE_SIZE,
  cursor = null,
  visibility = ["public", "private"],
}: {
  pageSize?: number;
  cursor?: SearchGroupsCursor;
  visibility?: SearchableVisibility[];
}): Promise<SearchGroupsResult> {
  const safePageSize = clampPageSize(pageSize);
  const safeVisibility = normalizeSearchableVisibility(visibility);

  const groupsRef = collection(db, "groups");

  const constraints: QueryConstraint[] = [
    ...buildBaseSearchConstraints(safeVisibility),
    orderBy("search.updatedAt", "desc"),
    limit(safePageSize + 1),
  ];

  const q = cursor
    ? query(groupsRef, ...constraints, startAfter(cursor))
    : query(groupsRef, ...constraints);

  const snap = await getDocs(q);

  return mapSearchGroupsSnapshot({
    docs: snap.docs,
    pageSize: safePageSize,
    fallbackCursor: cursor,
  });
}

/**
 * Fuente única de verdad para visibilidad pública de grupos.
 * No usar campos raíz aquí: la búsqueda depende únicamente de search.*.
 */
function buildBaseSearchConstraints(
  visibility: SearchableVisibility[]
): QueryConstraint[] {
  return [
    where("search.isActive", "==", true),
    where("search.discoverable", "==", true),
    where("search.visibility", "in", visibility),
  ];
}

function buildGroupSearchPrefixes({
  normalizedTerm,
  visibilityCount,
}: {
  normalizedTerm: string;
  visibilityCount: number;
}): string[] {
  const maxPrefixes = getMaxTokensForVisibility(visibilityCount);

  const tokens = tokenizeSearchText(normalizedTerm);

  return buildSearchPrefixes(tokens, {
    minLength: 2,
    maxLength: 20,
    maxPrefixes,
  }).slice(0, MAX_FIRESTORE_ARRAY_CONTAINS_ANY);
}

function mapSearchGroupsSnapshot({
  docs,
  pageSize,
  fallbackCursor,
}: {
  docs: QueryDocumentSnapshot<DocumentData>[];
  pageSize: number;
  fallbackCursor: SearchGroupsCursor;
}): SearchGroupsResult {
  const visibleDocs = docs.slice(0, pageSize);

  return {
    groups: visibleDocs.map(mapGroupDoc),
    cursor:
      visibleDocs.length > 0
        ? visibleDocs[visibleDocs.length - 1]
        : fallbackCursor,
    hasMore: docs.length > pageSize,
  };
}

function mapGroupDoc(docSnap: QueryDocumentSnapshot<DocumentData>): Group {
  return {
    id: docSnap.id,
    ...(docSnap.data() as Omit<Group, "id">),
  };
}

function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;

  return Math.max(1, Math.min(Math.floor(pageSize), MAX_PAGE_SIZE));
}

function normalizeSearchableVisibility(
  visibility: SearchableVisibility[]
): SearchableVisibility[] {
  const safeVisibility = Array.from(
    new Set(
      visibility.filter(
        (value): value is SearchableVisibility =>
          value === "public" || value === "private"
      )
    )
  );

  return safeVisibility.length > 0 ? safeVisibility : ["public", "private"];
}

function getMaxTokensForVisibility(visibilityCount: number): number {
  const safeVisibilityCount = Math.max(1, visibilityCount);

  return Math.min(
    MAX_FIRESTORE_ARRAY_CONTAINS_ANY,
    Math.floor(MAX_FIRESTORE_DISJUNCTIONS / safeVisibilityCount)
  );
}

function getSearchGroupsCacheKey({
  normalizedTerm,
  pageSize,
  visibility,
  cursor,
}: {
  normalizedTerm: string;
  pageSize: number;
  visibility: SearchableVisibility[];
  cursor: SearchGroupsCursor;
}): string | null {
  if (cursor) return null;

  return [
    "groups",
    normalizedTerm,
    pageSize,
    visibility.slice().sort().join(","),
  ].join(":");
}

function readSearchGroupsCache(cacheKey: string | null): SearchGroupsResult | null {
  if (!cacheKey) return null;

  const cached = searchGroupsCache.get(cacheKey);

  if (!cached || cached.expiresAt <= Date.now()) {
    searchGroupsCache.delete(cacheKey);
    return null;
  }

  return {
    groups: cached.result.groups,
    cursor: cached.result.cursor,
    hasMore: cached.result.hasMore,
  };
}

function writeSearchGroupsCache(
  cacheKey: string | null,
  result: SearchGroupsResult
) {
  if (!cacheKey) return;

  searchGroupsCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_GROUPS_CACHE_TTL_MS,
    result,
  });
}