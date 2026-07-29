// Núcleo del motor de recomendaciones: cache, preferencias, utilidades y fetch de
// grupos/perfiles. Capa HOJA (no llama a la orquestación de grupos-reco ni a
// discovery). Extraído para que recommendation-engine.ts no supere las 1000
// líneas; recommendation-engine.ts re-exporta este módulo (barrel).

"use client";

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  GROUP_CATEGORY_OPTIONS,
  normalizeGroupCategory,
  normalizeGroupTags,
  type CanonicalGroupCategory,
  type Currency,
  type Group,
} from "@/types/group";
import type {
  RecommendationFetchResult,
  RecommendationGroupCard,
  RecommendationProfileCard,
  StoredRecommendationPreferences,
} from "./types";
import {
  fetchPublicPostsByCategories,
  fetchUserProfilePostsPage,
} from "@/lib/posts/post-service";
import type { Post } from "@/lib/posts/types";
import {
  getBehaviorCategoryWeights,
  getEngagementTagWeights,
  getKeywordInterests,
  getSeenPostIds,
  getHiddenPostIds,
  getSuppressedAuthorIds,
  getSuppressedCategoryWeights,
  getSuppressedTags,
  timeDecayWeight,
} from "@/lib/discovery/viewSignal";
import { extractContentKeywords } from "@/lib/search/normalize";
export const STORAGE_KEY_PREFIX = "red-social-mvp:group-recommendations:";
export const RANDOM_SLOT_OPTIONS = [6, 10, 15] as const;
export const MIN_ONBOARDING_CATEGORIES = 1; // J: any selection is enough to start recommendations
export const MAX_CATEGORY_QUERY_SIZE = 10;
export const MAX_RECOMMENDATIONS = 18;
export const MAX_TAGS_TRACKED = 40;
export const RANDOM_GROUP_FETCH_LIMIT = 40;
export const RECOMMENDATION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const SHOWN_GROUPS_KEY_PREFIX = "red-social-mvp:shown-groups:";
export const SHOWN_GROUPS_MAX = 100;
export const SHOWN_GROUPS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const MIN_FRESH_RESULTS = 4; // don't filter shown groups if we'd be left with fewer than this
// I: persist results to localStorage so page reloads skip Firestore until TTL expires
export const PERSISTED_RESULT_KEY_PREFIX = "red-social-mvp:rec-result:";
export const PERSISTED_RESULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// In-memory result cache — shared across all Rail instances in the same tab
// ---------------------------------------------------------------------------
export type CachedResult = { result: RecommendationFetchResult; cachedAt: number };
export const resultCache = new Map<string, CachedResult>();
export type InvalidationListener = () => void;
export const invalidationListeners = new Set<InvalidationListener>();

export function getCachedResult(uid: string): RecommendationFetchResult | null {
  const entry = resultCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > RECOMMENDATION_CACHE_TTL_MS) {
    resultCache.delete(uid);
    return null;
  }
  return entry.result;
}

export function setCachedResult(uid: string, result: RecommendationFetchResult) {
  resultCache.set(uid, { result, cachedAt: Date.now() });
}

export function invalidateRecommendationCache(uid: string) {
  resultCache.delete(uid);
  // I: also clear the persisted localStorage result so the next fetch hits Firestore fresh
  if (uid && typeof window !== "undefined") {
    try { window.localStorage.removeItem(getPersistedResultKey(uid)); } catch {}
  }
  invalidationListeners.forEach((fn) => fn());
}

export function onRecommendationCacheInvalidated(fn: InvalidationListener): () => void {
  invalidationListeners.add(fn);
  return () => invalidationListeners.delete(fn);
}

export function getStorageKey(uid: string) {
  return `${STORAGE_KEY_PREFIX}${uid}`;
}

// ---------------------------------------------------------------------------
// I: persisted result cache — survives page reloads, TTL 30 minutes
// ---------------------------------------------------------------------------
export type PersistedResultEntry = { result: RecommendationFetchResult; savedAt: number };

export function getPersistedResultKey(uid: string) {
  return `${PERSISTED_RESULT_KEY_PREFIX}${uid}`;
}

export function getPersistedResult(uid: string): RecommendationFetchResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getPersistedResultKey(uid));
    if (!raw) return null;
    const entry = JSON.parse(raw) as PersistedResultEntry;
    if (Date.now() - entry.savedAt > PERSISTED_RESULT_TTL_MS) {
      window.localStorage.removeItem(getPersistedResultKey(uid));
      return null;
    }
    return entry.result;
  } catch {
    return null;
  }
}

export function persistResult(uid: string, result: RecommendationFetchResult): void {
  if (typeof window === "undefined") return;
  try {
    const entry: PersistedResultEntry = { result, savedAt: Date.now() };
    window.localStorage.setItem(getPersistedResultKey(uid), JSON.stringify(entry));
  } catch {}
}

// ---------------------------------------------------------------------------
// G: shown-groups tracking — prevents the same cards from repeating each visit
// ---------------------------------------------------------------------------
export type ShownEntry = { id: string; shownAt: number };

export function getShownGroupsKey(uid: string) {
  return `${SHOWN_GROUPS_KEY_PREFIX}${uid}`;
}

export function getShownGroupIds(uid: string): Set<string> {
  if (!uid || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(getShownGroupsKey(uid));
    if (!raw) return new Set();
    const entries = JSON.parse(raw) as ShownEntry[];
    const cutoff = Date.now() - SHOWN_GROUPS_TTL_MS;
    return new Set(
      entries.filter((e) => e.shownAt > cutoff).map((e) => e.id)
    );
  } catch {
    return new Set();
  }
}

export function markGroupsAsShown(uid: string, ids: string[]): void {
  if (!uid || ids.length === 0 || typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(getShownGroupsKey(uid));
    const existing: ShownEntry[] = raw ? (JSON.parse(raw) as ShownEntry[]) : [];
    const cutoff = Date.now() - SHOWN_GROUPS_TTL_MS;
    const fresh = existing.filter((e) => e.shownAt > cutoff && !ids.includes(e.id));
    const newEntries: ShownEntry[] = ids.map((id) => ({ id, shownAt: Date.now() }));
    const merged = [...newEntries, ...fresh].slice(0, SHOWN_GROUPS_MAX);
    window.localStorage.setItem(getShownGroupsKey(uid), JSON.stringify(merged));
  } catch {}
}

export function emptyPreferences(): StoredRecommendationPreferences {
  return {
    selectedCategories: [],
    joinedCategories: [],
    joinedTags: [],
    onboardingCompleted: false,
    updatedAt: 0,
  };
}

export function uniqueCanonicalCategories(
  values: CanonicalGroupCategory[]
): CanonicalGroupCategory[] {
  return Array.from(new Set(values)).filter((value) =>
    GROUP_CATEGORY_OPTIONS.some((option) => option.value === value)
  );
}

export function uniqueTags(values: string[]): string[] {
  return Array.from(new Set(normalizeGroupTags(values))).slice(0, MAX_TAGS_TRACKED);
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (!items.length) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function normalizeRecommendationMonetization(
  monetization: Partial<Group["monetization"]> | null | undefined
): RecommendationGroupCard["monetization"] {
  if (!monetization) return null;

  const normalizeCurrency = (value: unknown): Currency | null => {
    return value === "MXN" || value === "USD" ? value : null;
  };

  const priceMonthly =
    typeof monetization.priceMonthly === "number" &&
    Number.isFinite(monetization.priceMonthly)
      ? monetization.priceMonthly
      : null;

  const subscriptionPriceMonthly =
    typeof monetization.subscriptionPriceMonthly === "number" &&
    Number.isFinite(monetization.subscriptionPriceMonthly)
      ? monetization.subscriptionPriceMonthly
      : null;

  return {
    isPaid:
      typeof monetization.isPaid === "boolean" ? monetization.isPaid : undefined,
    subscriptionsEnabled:
      typeof monetization.subscriptionsEnabled === "boolean"
        ? monetization.subscriptionsEnabled
        : undefined,
    priceMonthly,
    currency: normalizeCurrency(monetization.currency),
    subscriptionPriceMonthly,
    subscriptionCurrency: normalizeCurrency(monetization.subscriptionCurrency),
  };
}

export function toRecommendationCard(
  groupId: string,
  data: Partial<Group> & { memberCount?: number }
): RecommendationGroupCard | null {
  const category = normalizeGroupCategory(data.category);
  const tags = normalizeGroupTags(data.tags);

  if (!data.name || !data.visibility) return null;

  return {
    id: groupId,
    name: data.name,
    description: data.description ?? "",
    avatarUrl: data.avatarUrl ?? data.imageUrl ?? null,
    coverUrl: data.coverUrl ?? null,
    visibility: data.visibility,
    category,
    tags,
    memberCount: typeof data.memberCount === "number" ? data.memberCount : null,
    monetization: normalizeRecommendationMonetization(data.monetization),
  };
}

export function seededShuffle<T>(items: T[], seedText: string): T[] {
  const arr = [...items];

  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  if (seed === 0) seed = 1;

  for (let i = arr.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

export function getStoredRecommendationPreferences(
  uid: string
): StoredRecommendationPreferences {
  if (!uid || typeof window === "undefined") {
    return emptyPreferences();
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(uid));
    if (!raw) {
      return emptyPreferences();
    }

    const parsed = JSON.parse(raw) as Partial<StoredRecommendationPreferences>;

    return {
      selectedCategories: uniqueCanonicalCategories(
        Array.isArray(parsed.selectedCategories) ? parsed.selectedCategories : []
      ),
      joinedCategories: uniqueCanonicalCategories(
        Array.isArray(parsed.joinedCategories) ? parsed.joinedCategories : []
      ),
      joinedTags: uniqueTags(Array.isArray(parsed.joinedTags) ? parsed.joinedTags : []),
      onboardingCompleted: Boolean(parsed.onboardingCompleted),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return emptyPreferences();
  }
}

export function saveRecommendationPreferences(
  uid: string,
  partial: Partial<StoredRecommendationPreferences>
) {
  if (!uid || typeof window === "undefined") return;

  const current = getStoredRecommendationPreferences(uid);

  const next: StoredRecommendationPreferences = {
    selectedCategories: uniqueCanonicalCategories(
      partial.selectedCategories ?? current.selectedCategories
    ),
    joinedCategories: uniqueCanonicalCategories(
      partial.joinedCategories ?? current.joinedCategories
    ),
    joinedTags: uniqueTags(partial.joinedTags ?? current.joinedTags),
    onboardingCompleted:
      partial.onboardingCompleted ?? current.onboardingCompleted,
    updatedAt: Date.now(),
  };

  window.localStorage.setItem(getStorageKey(uid), JSON.stringify(next));

  // Fire-and-forget: keep Firestore in sync for cross-device persistence
  syncPreferencesToFirestore(uid, next);
}

export function completeRecommendationsOnboarding(
  uid: string,
  selectedCategories: CanonicalGroupCategory[]
) {
  if (!uid) {
    throw new Error("Necesitas iniciar sesión para guardar tus preferencias.");
  }

  const normalized = uniqueCanonicalCategories(selectedCategories);

  if (normalized.length < MIN_ONBOARDING_CATEGORIES) {
    throw new Error(`Debes seleccionar al menos ${MIN_ONBOARDING_CATEGORIES} categorías.`);
  }

  saveRecommendationPreferences(uid, {
    selectedCategories: normalized,
    onboardingCompleted: true,
  });
}

export function trackGroupRecommendationSignalFromGroup(input: {
  uid: string;
  category?: unknown;
  tags?: unknown;
}) {
  if (!input.uid) return;

  const current = getStoredRecommendationPreferences(input.uid);
  const canonical = normalizeGroupCategory(input.category);

  const joinedCategories = uniqueCanonicalCategories([
    ...current.joinedCategories,
    ...(canonical ? [canonical] : []),
  ]);

  const joinedTags = uniqueTags([
    ...current.joinedTags,
    ...normalizeGroupTags(input.tags),
  ]);

  saveRecommendationPreferences(input.uid, {
    joinedCategories,
    joinedTags,
  });
}

// ---------------------------------------------------------------------------
// Firestore persistence — cross-device sync for recommendation preferences
// ---------------------------------------------------------------------------
export const FIRESTORE_PREFS_PATH = (uid: string) =>
  doc(db, "users", uid, "preferences", "recommendations");

export async function loadPreferencesFromFirestore(
  uid: string
): Promise<StoredRecommendationPreferences | null> {
  try {
    const snap = await getDoc(FIRESTORE_PREFS_PATH(uid));
    if (!snap.exists()) return null;
    const data = snap.data() as Partial<StoredRecommendationPreferences>;
    return {
      selectedCategories: uniqueCanonicalCategories(
        Array.isArray(data.selectedCategories) ? data.selectedCategories : []
      ),
      joinedCategories: uniqueCanonicalCategories(
        Array.isArray(data.joinedCategories) ? data.joinedCategories : []
      ),
      joinedTags: uniqueTags(Array.isArray(data.joinedTags) ? data.joinedTags : []),
      onboardingCompleted: Boolean(data.onboardingCompleted),
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function syncPreferencesToFirestore(
  uid: string,
  prefs: StoredRecommendationPreferences
): void {
  if (!uid) return;
  // Espera a que Auth resuelva el token antes de escribir: sin esto, request.auth
  // puede llegar null al servidor (aunque auth.currentUser exista en el cliente),
  // la regla deniega la escritura y el onboarding NO persiste cross-device.
  void auth
    .authStateReady()
    .then(() =>
      setDoc(
        FIRESTORE_PREFS_PATH(uid),
        {
          selectedCategories: prefs.selectedCategories,
          joinedCategories: prefs.joinedCategories,
          joinedTags: prefs.joinedTags,
          onboardingCompleted: prefs.onboardingCompleted,
          updatedAt: prefs.updatedAt,
        },
        { merge: true }
      )
    )
    .catch(() => {
      // silent — localStorage is the source of truth for this session
    });
}

export async function fetchUserMembershipGroupIds(uid: string): Promise<Set<string>> {
  if (!uid) return new Set();

  try {
    const snap = await getDocs(
      collection(db, "users", uid, "groupMemberships")
    );

    return new Set(snap.docs.map((docSnap) => docSnap.id));
  } catch {
    return new Set();
  }
}

export async function fetchGroupsByCategories(
  categories: CanonicalGroupCategory[],
  memberGroupIds: Set<string>
): Promise<RecommendationGroupCard[]> {
if (categories.length === 0) return [];

  const chunks = chunkArray(
    uniqueCanonicalCategories(categories),
    MAX_CATEGORY_QUERY_SIZE
  );

  const found = new Map<string, RecommendationGroupCard>();

  for (const chunk of chunks) {
    const q = query(
      collection(db, "groups"),
      where("category", "in", chunk),
      where("visibility", "in", ["public", "private"]),
      where("isActive", "==", true),
      limit(24)
    );

    const snap = await getDocs(q);

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Partial<Group>;
      const card = toRecommendationCard(docSnap.id, data);

      if (!card) continue;
      if (data.discoverable === false) continue;

if (memberGroupIds.has(docSnap.id)) continue;

      found.set(docSnap.id, card);
    }
  }

  return Array.from(found.values()).slice(0, MAX_RECOMMENDATIONS);
}

export async function fetchGroupsByTags(
  tags: string[],
  memberGroupIds: Set<string>
): Promise<RecommendationGroupCard[]> {
  if (tags.length === 0) return [];

  // Firestore array-contains-any accepts up to 10 values
  const topTags = tags.slice(0, 10);

  try {
    // Cannot combine array-contains-any with 'in' on another field in Firestore,
    // so visibility is filtered in memory after the query.
    const q = query(
      collection(db, "groups"),
      where("tags", "array-contains-any", topTags),
      where("isActive", "==", true),
      limit(24)
    );

    const snap = await getDocs(q);
    const found: RecommendationGroupCard[] = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Partial<Group>;
      if (data.visibility !== "public" && data.visibility !== "private") continue;
      const card = toRecommendationCard(docSnap.id, data);
      if (!card) continue;
      if (data.discoverable === false) continue;
      if (memberGroupIds.has(docSnap.id)) continue;
      found.push(card);
    }

    return found;
  } catch {
    // Fails gracefully if the composite index doesn't exist yet;
    // category-based signals still work normally.
    return [];
  }
}

// Fetch UIDs of users who have blocked the current user (so we don't recommend them)
export async function fetchBlockedByProfileIds(uid: string): Promise<string[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "blockedByUsers"));
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

// Fetch UIDs the current user has blocked (so we don't recommend them either).
// El feed seguido ya los excluye vía Cloud Function; descubrimiento no lo hacía.
export async function fetchBlockedProfileIds(uid: string): Promise<string[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "blockedUsers"));
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

// E: fetch IDs of profiles the user follows (capped to avoid excess reads)
export async function fetchFollowedProfileIds(uid: string): Promise<string[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "users", uid, "following"), limit(20))
    );
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

// E: fetch groups created (owned) by a set of profile UIDs
export async function fetchGroupsByOwnerIds(
  ownerIds: string[],
  memberGroupIds: Set<string>
): Promise<RecommendationGroupCard[]> {
  if (ownerIds.length === 0) return [];

  // Firestore 'in' operator accepts up to 10 values — chunk if needed
  const chunks = chunkArray(ownerIds.slice(0, 20), 10);
  const found = new Map<string, RecommendationGroupCard>();

  for (const chunk of chunks) {
    try {
      const q = query(
        collection(db, "groups"),
        where("ownerId", "in", chunk),
        where("isActive", "==", true),
        limit(24)
      );
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        const data = docSnap.data() as Partial<Group> & { memberCount?: number };
        if (data.visibility !== "public" && data.visibility !== "private") continue;
        const card = toRecommendationCard(docSnap.id, data);
        if (!card) continue;
        if (data.discoverable === false) continue;
        if (memberGroupIds.has(docSnap.id)) continue;
        found.set(docSnap.id, card);
      }
    } catch {
      // graceful degradation if index is missing
    }
  }

  return Array.from(found.values());
}

// H: groups where followed profiles are members (social signal, weaker than ownership)
export async function fetchGroupsByFollowedMembers(
  followedIds: string[],
  memberGroupIds: Set<string>
): Promise<RecommendationGroupCard[]> {
  if (followedIds.length === 0) return [];

  // Cap to 10 per Firestore 'in' limit
  const topFollowed = followedIds.slice(0, 10);

  try {
    // collectionGroup queries ALL groups/{groupId}/members subcollections at once
    const q = query(
      collectionGroup(db, "members"),
      where("userId", "in", topFollowed),
      limit(30)
    );

    const snap = await getDocs(q);

    // Extract unique groupIds from the document path (parent of members subcollection)
    const rawIds = snap.docs.map((d) => d.ref.parent.parent?.id);
    const groupIds = Array.from(
      new Set(rawIds.filter((id): id is string => id != null && !memberGroupIds.has(id)))
    );

    if (groupIds.length === 0) return [];

    // Batch-fetch the group docs to build cards
    const found: RecommendationGroupCard[] = [];
    for (const chunk of chunkArray(groupIds, 10)) {
      try {
        const gq = query(
          collection(db, "groups"),
          where("__name__", "in", chunk),
          where("isActive", "==", true)
        );
        const gSnap = await getDocs(gq);
        for (const docSnap of gSnap.docs) {
          const data = docSnap.data() as Partial<Group> & { memberCount?: number };
          if (data.visibility !== "public" && data.visibility !== "private") continue;
          if (data.discoverable === false) continue;
          const card = toRecommendationCard(docSnap.id, data);
          if (card) found.push(card);
        }
      } catch {}
    }

    return found;
  } catch {
    // Graceful degradation if collection group index is missing
    return [];
  }
}

export async function fetchRandomFallbackGroups(
  uid: string,
  memberGroupIds: Set<string>
): Promise<RecommendationGroupCard[]> {
  if (!uid) return [];

  const q = query(
    collection(db, "groups"),
    where("visibility", "in", ["public", "private"]),
    where("isActive", "==", true),
    limit(RANDOM_GROUP_FETCH_LIMIT)
  );

  const snap = await getDocs(q);
  const found: RecommendationGroupCard[] = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Partial<Group>;
    const card = toRecommendationCard(docSnap.id, data);

    if (!card) continue;
    if (data.discoverable === false) continue;

if (memberGroupIds.has(docSnap.id)) continue;

    found.push(card);
  }

  return seededShuffle(found, `fallback:${uid}`).slice(0, MAX_RECOMMENDATIONS);
}

// ---------------------------------------------------------------------------
// Profile recommendation helpers
// ---------------------------------------------------------------------------
