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

const STORAGE_KEY_PREFIX = "red-social-mvp:group-recommendations:";
const RANDOM_SLOT_OPTIONS = [6, 10, 15] as const;
const MIN_ONBOARDING_CATEGORIES = 1; // J: any selection is enough to start recommendations
const MAX_CATEGORY_QUERY_SIZE = 10;
const MAX_RECOMMENDATIONS = 18;
const MAX_TAGS_TRACKED = 40;
const RANDOM_GROUP_FETCH_LIMIT = 40;
const RECOMMENDATION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SHOWN_GROUPS_KEY_PREFIX = "red-social-mvp:shown-groups:";
const SHOWN_GROUPS_MAX = 100;
const SHOWN_GROUPS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MIN_FRESH_RESULTS = 4; // don't filter shown groups if we'd be left with fewer than this
// I: persist results to localStorage so page reloads skip Firestore until TTL expires
const PERSISTED_RESULT_KEY_PREFIX = "red-social-mvp:rec-result:";
const PERSISTED_RESULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// In-memory result cache — shared across all Rail instances in the same tab
// ---------------------------------------------------------------------------
type CachedResult = { result: RecommendationFetchResult; cachedAt: number };
const resultCache = new Map<string, CachedResult>();
type InvalidationListener = () => void;
const invalidationListeners = new Set<InvalidationListener>();

export function getCachedResult(uid: string): RecommendationFetchResult | null {
  const entry = resultCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > RECOMMENDATION_CACHE_TTL_MS) {
    resultCache.delete(uid);
    return null;
  }
  return entry.result;
}

function setCachedResult(uid: string, result: RecommendationFetchResult) {
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

function getStorageKey(uid: string) {
  return `${STORAGE_KEY_PREFIX}${uid}`;
}

// ---------------------------------------------------------------------------
// I: persisted result cache — survives page reloads, TTL 30 minutes
// ---------------------------------------------------------------------------
type PersistedResultEntry = { result: RecommendationFetchResult; savedAt: number };

function getPersistedResultKey(uid: string) {
  return `${PERSISTED_RESULT_KEY_PREFIX}${uid}`;
}

function getPersistedResult(uid: string): RecommendationFetchResult | null {
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

function persistResult(uid: string, result: RecommendationFetchResult): void {
  if (typeof window === "undefined") return;
  try {
    const entry: PersistedResultEntry = { result, savedAt: Date.now() };
    window.localStorage.setItem(getPersistedResultKey(uid), JSON.stringify(entry));
  } catch {}
}

// ---------------------------------------------------------------------------
// G: shown-groups tracking — prevents the same cards from repeating each visit
// ---------------------------------------------------------------------------
type ShownEntry = { id: string; shownAt: number };

function getShownGroupsKey(uid: string) {
  return `${SHOWN_GROUPS_KEY_PREFIX}${uid}`;
}

function getShownGroupIds(uid: string): Set<string> {
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

function markGroupsAsShown(uid: string, ids: string[]): void {
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

function emptyPreferences(): StoredRecommendationPreferences {
  return {
    selectedCategories: [],
    joinedCategories: [],
    joinedTags: [],
    onboardingCompleted: false,
    updatedAt: 0,
  };
}

function uniqueCanonicalCategories(
  values: CanonicalGroupCategory[]
): CanonicalGroupCategory[] {
  return Array.from(new Set(values)).filter((value) =>
    GROUP_CATEGORY_OPTIONS.some((option) => option.value === value)
  );
}

function uniqueTags(values: string[]): string[] {
  return Array.from(new Set(normalizeGroupTags(values))).slice(0, MAX_TAGS_TRACKED);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (!items.length) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeRecommendationMonetization(
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

function toRecommendationCard(
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
const FIRESTORE_PREFS_PATH = (uid: string) =>
  doc(db, "users", uid, "preferences", "recommendations");

async function loadPreferencesFromFirestore(
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

function syncPreferencesToFirestore(
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

async function fetchUserMembershipGroupIds(uid: string): Promise<Set<string>> {
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

async function fetchGroupsByCategories(
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

async function fetchGroupsByTags(
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
async function fetchBlockedByProfileIds(uid: string): Promise<string[]> {
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
async function fetchBlockedProfileIds(uid: string): Promise<string[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "blockedUsers"));
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

// E: fetch IDs of profiles the user follows (capped to avoid excess reads)
async function fetchFollowedProfileIds(uid: string): Promise<string[]> {
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
async function fetchGroupsByOwnerIds(
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
async function fetchGroupsByFollowedMembers(
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

async function fetchRandomFallbackGroups(
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
const SHOWN_PROFILES_KEY_PREFIX = "red-social-mvp:shown-profiles:";
const SHOWN_PROFILES_MAX = 60;
const MAX_PROFILE_RECOMMENDATIONS = 6;

function getShownProfilesKey(uid: string) {
  return `${SHOWN_PROFILES_KEY_PREFIX}${uid}`;
}

function getShownProfileIds(uid: string): Set<string> {
  if (!uid || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(getShownProfilesKey(uid));
    if (!raw) return new Set();
    const entries = JSON.parse(raw) as ShownEntry[];
    const cutoff = Date.now() - SHOWN_GROUPS_TTL_MS;
    return new Set(entries.filter((e) => e.shownAt > cutoff).map((e) => e.id));
  } catch {
    return new Set();
  }
}

function markProfilesAsShown(uid: string, ids: string[]): void {
  if (!uid || ids.length === 0 || typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(getShownProfilesKey(uid));
    const existing: ShownEntry[] = raw ? (JSON.parse(raw) as ShownEntry[]) : [];
    const cutoff = Date.now() - SHOWN_GROUPS_TTL_MS;
    const fresh = existing.filter((e) => e.shownAt > cutoff && !ids.includes(e.id));
    const newEntries: ShownEntry[] = ids.map((id) => ({ id, shownAt: Date.now() }));
    const merged = [...newEntries, ...fresh].slice(0, SHOWN_PROFILES_MAX);
    window.localStorage.setItem(getShownProfilesKey(uid), JSON.stringify(merged));
  } catch {}
}

function toProfileCard(
  uid: string,
  data: Record<string, unknown>
): RecommendationProfileCard | null {
  const displayName =
    typeof data.displayName === "string" ? data.displayName.trim() : null;
  if (!displayName) return null;
  if (data.isActive === false) return null;

  const handle =
    typeof data.handle === "string"
      ? data.handle
      : typeof data.username === "string"
        ? data.username
        : null;
  if (!handle) return null;

  const monetization = data.monetization as Record<string, unknown> | null | undefined;
  const hasActiveServices = !!(
    monetization?.greetingsEnabled === true ||
    monetization?.adviceEnabled === true ||
    monetization?.customClassEnabled === true ||
    monetization?.digitalMeetGreetEnabled === true
  );

  return {
    uid,
    displayName,
    handle,
    avatarUrl:
      typeof data.avatarUrl === "string"
        ? data.avatarUrl
        : typeof data.photoURL === "string"
          ? data.photoURL
          : null,
    coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : null,
    followersCount:
      typeof data.followersCount === "number" ? data.followersCount : 0,
    hasActiveServices,
  };
}

type ProfileScored = { card: RecommendationProfileCard; score: number };

// Signal A (+5 con servicios, +2 sin): dueños de grupos en mis categorías de interés
async function fetchProfilesByGroupOwnership(
  categories: CanonicalGroupCategory[],
  excludeUids: Set<string>
): Promise<ProfileScored[]> {
  if (categories.length === 0) return [];

  const ownerIds = new Set<string>();
  for (const chunk of chunkArray(categories.slice(0, MAX_CATEGORY_QUERY_SIZE), MAX_CATEGORY_QUERY_SIZE)) {
    try {
      const q = query(
        collection(db, "groups"),
        where("category", "in", chunk),
        where("isActive", "==", true),
        limit(20)
      );
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        const ownerId = docSnap.data().ownerId as string | undefined;
        if (ownerId && !excludeUids.has(ownerId)) ownerIds.add(ownerId);
      }
    } catch {}
  }

  if (ownerIds.size === 0) return [];

  const result: ProfileScored[] = [];
  for (const chunk of chunkArray(Array.from(ownerIds), 10)) {
    try {
      const snap = await getDocs(
        query(collection(db, "users"), where("__name__", "in", chunk))
      );
      for (const docSnap of snap.docs) {
        if (excludeUids.has(docSnap.id)) continue;
        const card = toProfileCard(docSnap.id, docSnap.data() as Record<string, unknown>);
        if (!card) continue;
        result.push({ card, score: card.hasActiveServices ? 5 : 2 });
      }
    } catch {}
  }

  return result;
}

// Signal A2 (+6 con servicios, +3 sin): perfiles cuyos intereses declarados
// coinciden con mis categorías. Es la señal de categoría más directa: recomienda
// creadores afines aunque todavía no hayan creado una comunidad.
async function fetchProfilesByInterests(
  categories: CanonicalGroupCategory[],
  excludeUids: Set<string>
): Promise<ProfileScored[]> {
  if (categories.length === 0) return [];

  const result: ProfileScored[] = [];
  const seen = new Set<string>();

  // array-contains-any acepta hasta 10 valores por consulta
  for (const chunk of chunkArray(categories, 10)) {
    try {
      const snap = await getDocs(
        query(
          collection(db, "users"),
          where("interests", "array-contains-any", chunk),
          limit(20)
        )
      );
      for (const docSnap of snap.docs) {
        if (excludeUids.has(docSnap.id) || seen.has(docSnap.id)) continue;
        const card = toProfileCard(
          docSnap.id,
          docSnap.data() as Record<string, unknown>
        );
        if (!card) continue;
        seen.add(docSnap.id);
        result.push({ card, score: card.hasActiveServices ? 6 : 3 });
      }
    } catch {}
  }

  return result;
}

// Signal B (+4 con servicios, +1 sin): co-miembros activos en mis comunidades
async function fetchProfilesFromCoMembers(
  myGroupIds: Set<string>,
  excludeUids: Set<string>
): Promise<ProfileScored[]> {
  if (myGroupIds.size === 0) return [];

  const memberUids = new Set<string>();
  for (const groupId of Array.from(myGroupIds).slice(0, 3)) {
    try {
      const snap = await getDocs(
        query(collection(db, "groups", groupId, "members"), limit(20))
      );
      for (const docSnap of snap.docs) {
        const uid = (docSnap.data().userId as string) || docSnap.id;
        if (uid && !excludeUids.has(uid)) memberUids.add(uid);
      }
    } catch {}
  }

  if (memberUids.size === 0) return [];

  const result: ProfileScored[] = [];
  for (const chunk of chunkArray(Array.from(memberUids).slice(0, 20), 10)) {
    try {
      const snap = await getDocs(
        query(collection(db, "users"), where("__name__", "in", chunk))
      );
      for (const docSnap of snap.docs) {
        if (excludeUids.has(docSnap.id)) continue;
        const card = toProfileCard(docSnap.id, docSnap.data() as Record<string, unknown>);
        if (!card) continue;
        result.push({ card, score: card.hasActiveServices ? 4 : 1 });
      }
    } catch {}
  }

  return result;
}

// Signal C (+3): creadores activos generales con cualquier servicio habilitado
async function fetchActiveCreators(
  excludeUids: Set<string>
): Promise<ProfileScored[]> {
  const serviceFields = [
    "monetization.greetingsEnabled",
    "monetization.adviceEnabled",
    "monetization.customClassEnabled",
    "monetization.digitalMeetGreetEnabled",
  ];

  const found = new Map<string, RecommendationProfileCard>();

  await Promise.all(
    serviceFields.map(async (field) => {
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where(field, "==", true), limit(10))
        );
        for (const docSnap of snap.docs) {
          if (excludeUids.has(docSnap.id) || found.has(docSnap.id)) continue;
          const card = toProfileCard(docSnap.id, docSnap.data() as Record<string, unknown>);
          if (card) found.set(docSnap.id, card);
        }
      } catch {}
    })
  );

  return Array.from(found.values()).map((card) => ({ card, score: 3 }));
}

// Signal D (+2 con servicios, +1 sin): amigos de amigos
async function fetchFriendsOfFriends(
  followedIds: string[],
  excludeUids: Set<string>
): Promise<ProfileScored[]> {
  if (followedIds.length === 0) return [];

  const fofUids = new Set<string>();
  for (const followedId of followedIds.slice(0, 5)) {
    try {
      const snap = await getDocs(
        query(collection(db, "users", followedId, "following"), limit(10))
      );
      for (const docSnap of snap.docs) {
        if (!excludeUids.has(docSnap.id)) fofUids.add(docSnap.id);
      }
    } catch {}
  }

  if (fofUids.size === 0) return [];

  const result: ProfileScored[] = [];
  for (const chunk of chunkArray(Array.from(fofUids).slice(0, 20), 10)) {
    try {
      const snap = await getDocs(
        query(collection(db, "users"), where("__name__", "in", chunk))
      );
      for (const docSnap of snap.docs) {
        if (excludeUids.has(docSnap.id)) continue;
        const card = toProfileCard(docSnap.id, docSnap.data() as Record<string, unknown>);
        if (card) result.push({ card, score: card.hasActiveServices ? 2 : 1 });
      }
    } catch {}
  }

  return result;
}

export async function fetchRecommendedProfilesForUser(
  uid: string,
  options?: { skipMarkShown?: boolean }
): Promise<RecommendationProfileCard[]> {
  if (!uid) return [];

  const preferences = getStoredRecommendationPreferences(uid);
  const categories = uniqueCanonicalCategories([
    ...preferences.joinedCategories,
    ...preferences.selectedCategories,
  ]);

  const [memberGroupIds, followedProfileIds, blockedByIds] = await Promise.all([
    fetchUserMembershipGroupIds(uid),
    fetchFollowedProfileIds(uid),
    fetchBlockedByProfileIds(uid),
  ]);

  const excludeUids = new Set<string>([uid, ...followedProfileIds, ...blockedByIds]);

  const [
    interestCreators,
    categoryCreators,
    coMemberProfiles,
    generalCreators,
    fofProfiles,
  ] = await Promise.all([
    categories.length > 0
      ? fetchProfilesByInterests(categories, excludeUids)
      : Promise.resolve([] as ProfileScored[]),
    categories.length > 0
      ? fetchProfilesByGroupOwnership(categories, excludeUids)
      : Promise.resolve([] as ProfileScored[]),
    memberGroupIds.size > 0
      ? fetchProfilesFromCoMembers(memberGroupIds, excludeUids)
      : Promise.resolve([] as ProfileScored[]),
    fetchActiveCreators(excludeUids),
    followedProfileIds.length > 0
      ? fetchFriendsOfFriends(followedProfileIds, excludeUids)
      : Promise.resolve([] as ProfileScored[]),
  ]);

  const scored = new Map<string, { card: RecommendationProfileCard; score: number }>();
  for (const { card, score } of [
    ...interestCreators,
    ...categoryCreators,
    ...coMemberProfiles,
    ...generalCreators,
    ...fofProfiles,
  ]) {
    const existing = scored.get(card.uid);
    scored.set(card.uid, { card, score: (existing?.score ?? 0) + score });
  }

  const ranked = Array.from(scored.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.card.followersCount - a.card.followersCount;
    })
    .map(({ card }) => card);

  const shownIds = getShownProfileIds(uid);
  const fresh = ranked.filter((p) => !shownIds.has(p.uid));
  const final = (fresh.length >= 2 ? fresh : ranked).slice(0, MAX_PROFILE_RECOMMENDATIONS);

  if (final.length > 0 && !options?.skipMarkShown) {
    markProfilesAsShown(uid, final.map((p) => p.uid));
  }

  return final;
}

function buildCategorySignals(preferences: StoredRecommendationPreferences) {
  return {
    // Behavioral (stronger): categories inferred from groups the user actually joined
    joinedCategories: preferences.joinedCategories,
    // Declared (weaker): categories chosen manually during onboarding
    selectedCategories: preferences.selectedCategories,
    // Full union used as a coverage query when the above return nothing
    allCategories: uniqueCanonicalCategories([
      ...preferences.joinedCategories,
      ...preferences.selectedCategories,
    ]),
  };
}

export async function fetchRecommendedGroupsForUser(
  uid: string
): Promise<RecommendationFetchResult> {
  if (!uid) {
    return {
      groups: [],
      reason: "onboarding_categories",
      selectedCategories: [],
      onboardingCompleted: false,
    };
  }

  const cached = getCachedResult(uid);
  if (cached) return cached;

  // I: hit localStorage before touching Firestore — survives page reloads up to 30 min
  const persisted = getPersistedResult(uid);
  if (persisted) {
    setCachedResult(uid, persisted);
    return persisted;
  }

  let preferences = getStoredRecommendationPreferences(uid);

  // If localStorage shows no completed onboarding, consult Firestore as a
  // cross-device fallback. Se leen DOS fuentes en paralelo:
  //   - preferences/recommendations: escrito best-effort desde el cliente.
  //   - users/{uid}.interests: escrito de forma AUTORITATIVA por el Cloud
  //     Function updateProfileInterests. Es la señal garantizada cross-device,
  //     así que si existe basta para dar el onboarding por completado, aunque la
  //     escritura best-effort de preferences haya fallado en el otro dispositivo.
  if (!preferences.onboardingCompleted) {
    const [remote, interests] = await Promise.all([
      loadPreferencesFromFirestore(uid),
      fetchProfileInterests(uid),
    ]);

    const completedRemotely =
      (remote && remote.onboardingCompleted) ||
      interests.length >= MIN_ONBOARDING_CATEGORIES;

    if (completedRemotely) {
      const merged: StoredRecommendationPreferences = {
        selectedCategories: uniqueCanonicalCategories([
          ...(remote?.selectedCategories ?? []),
          ...interests,
        ]),
        joinedCategories: uniqueCanonicalCategories(remote?.joinedCategories ?? []),
        joinedTags: uniqueTags(remote?.joinedTags ?? []),
        onboardingCompleted: true,
        updatedAt: remote?.updatedAt ?? Date.now(),
      };
      // Sync back to localStorage so future reads are instant
      window.localStorage.setItem(getStorageKey(uid), JSON.stringify(merged));
      // Si la señal autoritativa (interests) existía pero el doc best-effort no,
      // re-sincroniza preferences para dejar ambas fuentes consistentes.
      if (!remote || !remote.onboardingCompleted) {
        syncPreferencesToFirestore(uid, merged);
      }
      preferences = merged;
    }
  }

  if (
    !preferences.onboardingCompleted ||
    preferences.selectedCategories.length < MIN_ONBOARDING_CATEGORIES
  ) {
    const onboardingResult: RecommendationFetchResult = {
      groups: [],
      reason: "onboarding_categories",
      selectedCategories: preferences.selectedCategories,
      onboardingCompleted: false,
    };
    setCachedResult(uid, onboardingResult);
    return onboardingResult;
  }

  const signals = buildCategorySignals(preferences);

  // Fetch membership IDs and followed profile IDs in parallel (both needed for scoring)
  const [memberGroupIds, followedProfileIds] = await Promise.all([
    fetchUserMembershipGroupIds(uid),
    fetchFollowedProfileIds(uid),
  ]);

  // C + D + E + H: run all signal queries in parallel
  //   joinedCategories:      behavioral — categories from groups you actually joined  (+3)
  //   joinedTags:            behavioral — tags from groups you joined                 (+2)
  //   followedOwnerGroups:   social    — groups created by profiles you follow        (+2)
  //   followedMemberGroups:  social    — groups where followed profiles are members   (+1)
  //   allCategories:         declared  — full coverage including onboarding picks     (+1)
  const [joinedCatGroups, tagGroups, followedOwnerGroups, followedMemberGroups, allCatGroups] =
    await Promise.all([
      signals.joinedCategories.length > 0
        ? fetchGroupsByCategories(signals.joinedCategories, memberGroupIds)
        : Promise.resolve([] as RecommendationGroupCard[]),
      preferences.joinedTags.length > 0
        ? fetchGroupsByTags(preferences.joinedTags, memberGroupIds)
        : Promise.resolve([] as RecommendationGroupCard[]),
      followedProfileIds.length > 0
        ? fetchGroupsByOwnerIds(followedProfileIds, memberGroupIds)
        : Promise.resolve([] as RecommendationGroupCard[]),
      followedProfileIds.length > 0
        ? fetchGroupsByFollowedMembers(followedProfileIds, memberGroupIds)
        : Promise.resolve([] as RecommendationGroupCard[]),
      fetchGroupsByCategories(signals.allCategories, memberGroupIds),
    ]);

  // Score and merge — scores are cumulative across signal types
  //   Joined category match:      +3 pts  (behavioral, strongest)
  //   Tag match:                  +2 pts  (behavioral)
  //   Followed-profile owner:     +2 pts  (social — they built it)
  //   Followed-profile member:    +1 pt   (social — they're in it)
  //   Declared-only category:     +1 pt   (stated preference only)
  const scored = new Map<string, { card: RecommendationGroupCard; score: number }>();

  for (const g of joinedCatGroups) {
    scored.set(g.id, { card: g, score: (scored.get(g.id)?.score ?? 0) + 3 });
  }
  for (const g of tagGroups) {
    scored.set(g.id, { card: g, score: (scored.get(g.id)?.score ?? 0) + 2 });
  }
  for (const g of followedOwnerGroups) {
    scored.set(g.id, { card: g, score: (scored.get(g.id)?.score ?? 0) + 2 });
  }
  for (const g of followedMemberGroups) {
    scored.set(g.id, { card: g, score: (scored.get(g.id)?.score ?? 0) + 1 });
  }
  for (const g of allCatGroups) {
    if (!scored.has(g.id)) {
      scored.set(g.id, { card: g, score: 1 });
    }
  }

  // F: primary sort by relevance score, secondary by memberCount (popularity tiebreaker)
  const allRanked = Array.from(scored.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.card.memberCount ?? 0) - (a.card.memberCount ?? 0);
    })
    .map(({ card }) => card);

  // G: filter out groups already shown in previous sessions
  const shownIds = getShownGroupIds(uid);
  const freshRanked = allRanked.filter((g) => !shownIds.has(g.id));

  // Only apply the shown-filter if it leaves enough results
  const ranked =
    freshRanked.length >= MIN_FRESH_RESULTS ? freshRanked : allRanked;

  const finalSlice = ranked.slice(0, MAX_RECOMMENDATIONS);

  if (finalSlice.length > 0) {
    // G: mark these groups as shown so they rotate out next session
    markGroupsAsShown(uid, finalSlice.map((g) => g.id));

    const hasBehavioralSignals =
      preferences.joinedCategories.length > 0 ||
      preferences.joinedTags.length > 0 ||
      followedProfileIds.length > 0;
    const result: RecommendationFetchResult = {
      groups: finalSlice,
      reason: hasBehavioralSignals ? "mixed_affinity" : "onboarding_categories",
      selectedCategories: preferences.selectedCategories,
      onboardingCompleted: true,
    };
    persistResult(uid, result); // I: persist so next page load skips Firestore
    setCachedResult(uid, result);
    return result;
  }

  // Final fallback: random discoverable groups
  const randomFallback = await fetchRandomFallbackGroups(uid, memberGroupIds);
  const result: RecommendationFetchResult = {
    groups: randomFallback,
    reason: "fallback_popular",
    selectedCategories: preferences.selectedCategories,
    onboardingCompleted: true,
  };
  persistResult(uid, result); // I: persist fallback too
  setCachedResult(uid, result);
  return result;
}

// Semilla de posicionamiento de los rails en el feed.
// Es ESTABLE durante toda la sesión del navegador: así, al cargar más posts, los
// slots ya mostrados no se recalculan (el recorrido es determinista y solo se
// agregan slots nuevos más abajo), y el rail deja de "saltar" de altura.
// Cambia entre sesiones para que no caiga siempre en la misma altura.
const FEED_RAIL_SEED_KEY = "vibra-feed-rail-seed";

export function getFeedRailSeed(): number {
  if (typeof window === "undefined") return 1;
  try {
    let raw = window.sessionStorage.getItem(FEED_RAIL_SEED_KEY);
    if (!raw) {
      raw = String(Math.floor(Math.random() * 233280) + 1);
      window.sessionStorage.setItem(FEED_RAIL_SEED_KEY, raw);
    }
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

export function buildRandomRecommendationSlots(
  totalPosts: number,
  seed = Date.now()
) {
  const slots = new Set<number>();
  let cursor = 0;
  let localSeed = seed;

  while (cursor < totalPosts) {
    const optionIndex = Math.abs(localSeed) % RANDOM_SLOT_OPTIONS.length;
    const jump = RANDOM_SLOT_OPTIONS[optionIndex];
    cursor += jump;

    if (cursor < totalPosts) {
      slots.add(cursor);
    }

    localSeed = Math.floor((localSeed * 9301 + 49297) % 233280);
  }

  return slots;
}

export const recommendationEngineConstants = {
  MIN_ONBOARDING_CATEGORIES,
  RANDOM_SLOT_OPTIONS,
};

// ===========================================================================
// Discovery feed (Fase 1, opción B) — posts públicos de comunidades públicas y
// perfiles que el usuario AÚN NO SIGUE, rankeados por afinidad de categoría.
//
// Señales (baratas, sin leer la colección `posts` por documentId → evita el
// límite de cuota de las reglas `allow list`):
//   - intereses declarados del perfil / onboarding  (+3)
//   - categorías de comunidades a las que se unió    (+3, conductual)
//   - categorías de posts a los que dio like         (+2, vía flame denormalizado)
// Candidatos: posts de comunidades públicas top y de perfiles afines no seguidos.
// Score = afinidad·3 + frescura·2 + engagement(log)·0.6.
// ===========================================================================

type DiscoveryPost = Post;

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const MAX_DISCOVERY_POSTS = 8;
const DISCOVERY_TOP_CATEGORIES = 4;
const DISCOVERY_COMMUNITY_POST_LIMIT = 24;
const DISCOVERY_PROFILES = 5;
const DISCOVERY_MAX_PER_AUTHOR = 1;
const DISCOVERY_MAX_PER_CATEGORY = 3;
const DISCOVERY_POSTS_PER_PROFILE = 2;
const DISCOVERY_LIKED_FLAMES_SCANNED = 50;
const SHOWN_DISCOVERY_KEY_PREFIX = "red-social-mvp:shown-discovery:";
const SHOWN_DISCOVERY_MAX = 200;

type DiscoveryCacheEntry = { posts: DiscoveryPost[]; cachedAt: number };
const discoveryCache = new Map<string, DiscoveryCacheEntry>();

export function invalidateDiscoveryCache(uid: string): void {
  discoveryCache.delete(uid);
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object") {
    const v = value as { toMillis?: () => number; seconds?: number };
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  return 0;
}

function getShownDiscoveryIds(uid: string): Set<string> {
  if (!uid || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(`${SHOWN_DISCOVERY_KEY_PREFIX}${uid}`);
    if (!raw) return new Set();
    const entries = JSON.parse(raw) as { id: string; shownAt: number }[];
    const cutoff = Date.now() - SHOWN_GROUPS_TTL_MS;
    return new Set(entries.filter((e) => e.shownAt > cutoff).map((e) => e.id));
  } catch {
    return new Set();
  }
}

function markDiscoveryShown(uid: string, ids: string[]): void {
  if (!uid || ids.length === 0 || typeof window === "undefined") return;
  try {
    const key = `${SHOWN_DISCOVERY_KEY_PREFIX}${uid}`;
    const raw = window.localStorage.getItem(key);
    const existing = raw
      ? (JSON.parse(raw) as { id: string; shownAt: number }[])
      : [];
    const cutoff = Date.now() - SHOWN_GROUPS_TTL_MS;
    const fresh = existing.filter(
      (e) => e.shownAt > cutoff && !ids.includes(e.id)
    );
    const now = Date.now();
    const merged = [
      ...ids.map((id) => ({ id, shownAt: now })),
      ...fresh,
    ].slice(0, SHOWN_DISCOVERY_MAX);
    window.localStorage.setItem(key, JSON.stringify(merged));
  } catch {}
}

// Categorías de los posts a los que el usuario dio like (vía el campo
// `groupCategory` denormalizado en users/{uid}/postFlames). Subcolección propia:
// lectura barata y siempre permitida, sin tocar la colección `posts`.
async function fetchLikedCategoryWeights(
  uid: string
): Promise<Map<CanonicalGroupCategory, number>> {
  const weights = new Map<CanonicalGroupCategory, number>();
  try {
    const snap = await getDocs(
      query(
        collection(db, "users", uid, "postFlames"),
        orderBy("createdAt", "desc"),
        limit(DISCOVERY_LIKED_FLAMES_SCANNED)
      )
    );
    const now = Date.now();
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as {
        groupCategory?: unknown;
        createdAt?: unknown;
      };
      const category = normalizeGroupCategory(data.groupCategory);
      if (!category) continue;
      // Decaimiento temporal: un like de hoy pesa 1, se enfría en días.
      const weight = timeDecayWeight(now - toMillis(data.createdAt));
      if (weight <= 0) continue;
      weights.set(category, (weights.get(category) ?? 0) + weight);
    }
  } catch {
    return weights;
  }

  for (const [category, weight] of weights) {
    weights.set(category, Math.min(weight, 12));
  }
  return weights;
}

async function buildDiscoveryTasteVector(
  uid: string,
  preferences: StoredRecommendationPreferences
): Promise<Map<CanonicalGroupCategory, number>> {
  const taste = new Map<CanonicalGroupCategory, number>();
  const add = (categories: CanonicalGroupCategory[], weight: number) => {
    for (const category of categories) {
      taste.set(category, (taste.get(category) ?? 0) + weight);
    }
  };

  // Señales FIJAS (ancla estable): no decaen.
  add(uniqueCanonicalCategories(preferences.selectedCategories), 3);
  add(uniqueCanonicalCategories(preferences.joinedCategories), 3);

  // Señal de LIKE con decaimiento temporal: un like de hoy pesa 2 y se enfría
  // en días (vida media 2 días, nulo a los 5).
  for (const [category, weight] of await fetchLikedCategoryWeights(uid)) {
    taste.set(category, (taste.get(category) ?? 0) + weight * 2);
  }

  // Señales de comportamiento locales (guardar 2.5, comentar 2, ver 0.3), ya
  // decaídas y ponderadas. Guardar/comentar son intención fuerte; ver, débil.
  for (const [category, weight] of getBehaviorCategoryWeights(uid)) {
    taste.set(category, (taste.get(category) ?? 0) + weight);
  }

  // Señales NEGATIVAS (ocultar/reportar/bloquear): penalización suave y decaída.
  // No baja de 0 para no invertir un interés declarado; solo lo atenúa.
  for (const [category, penalty] of getSuppressedCategoryWeights(uid)) {
    const current = taste.get(category);
    if (current === undefined) continue;
    taste.set(category, Math.max(0, current - penalty));
  }

  return taste;
}

// Bonus por coincidencia de tags (opción A): refina el match DENTRO de una
// categoría amplia. Ej. en "instituciones", una iglesia (tag `iglesia`) le gana
// a una alcaldía para un usuario con tags religiosos, sin revolverlas.
function tagOverlapBonus(
  post: DiscoveryPost,
  userTagInterests: Set<string>
): number {
  if (userTagInterests.size === 0) return 0;
  const tags = normalizeGroupTags(post.groupTags);
  if (tags.length === 0) return 0;
  let overlap = 0;
  for (const tag of tags) {
    if (userTagInterests.has(tag)) overlap += 1;
  }
  return Math.min(overlap, 3) * 1.5; // hasta +4.5
}

// Bonus por coincidencia de palabras clave del texto (A): "contenido similar"
// sin embeddings. Reusa el tokenizado del texto que ya existe. Señal suave.
function keywordOverlapBonus(
  post: DiscoveryPost,
  userKeywords: Set<string>
): number {
  if (userKeywords.size === 0) return 0;
  const tokens = extractContentKeywords(post.text);
  if (tokens.length === 0) return 0;

  let matches = 0;
  for (const token of tokens) {
    if (userKeywords.has(token)) matches += 1;
  }
  return Math.min(matches, 5) * 0.4; // hasta +2
}

// Gate de calidad (#4): descarta posts vacíos o de muy bajo esfuerzo para que
// lo sugerido sea lo bueno de la categoría, no el primer relleno.
function isDiscoveryWorthy(post: DiscoveryPost): boolean {
  if (post.isDeleted === true) return false;
  const hasMedia = Array.isArray(post.media) && post.media.length > 0;
  const textLength =
    typeof post.text === "string" ? post.text.trim().length : 0;
  const counts = post.counts ?? {};
  const engagement =
    (counts.likes ?? 0) + (counts.comments ?? 0) + (counts.saves ?? 0);
  // Debe tener media, texto con sustancia, o algo de engagement.
  if (!hasMedia && textLength < 15 && engagement < 1) return false;
  return true;
}

function scoreDiscoveryPost(post: DiscoveryPost, categoryAffinity: number): number {
  const ageDays = Math.max(
    0,
    (Date.now() - toMillis(post.createdAt)) / (1000 * 60 * 60 * 24)
  );
  const recency = Math.max(0, 1 - ageDays / 30); // 0..1, decae en ~30 días
  const counts = post.counts ?? {};
  const engagementRaw =
    (counts.likes ?? 0) + 2 * (counts.comments ?? 0) + (counts.saves ?? 0);

  // #D Trending: engagement por DÍA de vida (velocidad), no el total histórico.
  // Un post con 100 likes en 1 día gana a uno con 500 en 60 días.
  const velocity = engagementRaw / Math.max(ageDays, 0.5);
  const trending = Math.log1p(velocity);

  return categoryAffinity * 3 + recency * 2 + trending * 0.8;
}

// Intereses declarados del perfil, leídos de Firestore (users/{uid}.interests).
// Autoritativo y cross-device: no depende de localStorage.
async function fetchProfileInterests(
  uid: string
): Promise<CanonicalGroupCategory[]> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const raw = (snap.data() as { interests?: unknown } | undefined)?.interests;
    const list = Array.isArray(raw) ? raw : [];
    const cats = list
      .map((v) => normalizeGroupCategory(v))
      .filter((c): c is CanonicalGroupCategory => !!c);
    return uniqueCanonicalCategories(cats);
  } catch {
    return [];
  }
}

/**
 * Preferencias combinadas (localStorage + Firestore prefs + intereses del
 * perfil) → señal robusta y cross-device. Reutilizable por posts e historias.
 */
export async function getMergedDiscoveryPreferences(
  uid: string
): Promise<StoredRecommendationPreferences> {
  const localPrefs = getStoredRecommendationPreferences(uid);
  const [remotePrefs, interests] = await Promise.all([
    loadPreferencesFromFirestore(uid),
    fetchProfileInterests(uid),
  ]);

  return {
    selectedCategories: uniqueCanonicalCategories([
      ...localPrefs.selectedCategories,
      ...(remotePrefs?.selectedCategories ?? []),
      ...interests,
    ]),
    joinedCategories: uniqueCanonicalCategories([
      ...localPrefs.joinedCategories,
      ...(remotePrefs?.joinedCategories ?? []),
    ]),
    joinedTags: uniqueTags([
      ...localPrefs.joinedTags,
      ...(remotePrefs?.joinedTags ?? []),
    ]),
    onboardingCompleted:
      localPrefs.onboardingCompleted || !!remotePrefs?.onboardingCompleted,
    updatedAt: Date.now(),
  };
}

/**
 * Vector de gustos por categoría del usuario (mismas señales que el
 * descubrimiento de posts). Lo usan las historias para rankear por afinidad.
 */
export async function getUserTasteVector(
  uid: string
): Promise<Map<CanonicalGroupCategory, number>> {
  if (!uid) return new Map();
  const preferences = await getMergedDiscoveryPreferences(uid);
  return buildDiscoveryTasteVector(uid, preferences);
}

/**
 * Devuelve posts de descubrimiento para inyectar en el Home: públicos, de
 * comunidades públicas y perfiles que el usuario aún no sigue, rankeados por
 * afinidad. Cacheado en memoria (TTL corto) y con anti-repetición por sesión.
 */
export async function fetchDiscoveryPostsForUser(
  uid: string
): Promise<DiscoveryPost[]> {
  if (!uid) return [];

  const cached = discoveryCache.get(uid);
  if (cached && Date.now() - cached.cachedAt < DISCOVERY_CACHE_TTL_MS) {
    return cached.posts;
  }

  const [
    preferences,
    memberGroupIds,
    followedProfileIds,
    blockedByIds,
    blockedIds,
  ] = await Promise.all([
    getMergedDiscoveryPreferences(uid),
    fetchUserMembershipGroupIds(uid),
    fetchFollowedProfileIds(uid),
    fetchBlockedByProfileIds(uid),
    fetchBlockedProfileIds(uid),
  ]);

  // Señales negativas locales (ocultar/reportar/bloquear): instantáneas y sin red.
  const suppressedAuthorIds = getSuppressedAuthorIds(uid);
  const hiddenPostIds = getHiddenPostIds(uid);

  // Tags de interés (C): comunidades a las que te uniste + tags de lo que
  // likeas/guardas/ves. Todo normalizado igual que los del post. Se restan los
  // tags suprimidos (ocultar/reportar/bloquear) para bajar contenido relacionado.
  const suppressedTags = getSuppressedTags(uid);
  const userTagInterests = new Set<string>(
    [
      ...normalizeGroupTags(preferences.joinedTags),
      ...getEngagementTagWeights(uid).keys(),
    ].filter((tag) => !suppressedTags.has(tag))
  );
  // Palabras de interés (A): del texto de lo que likeas/guardas/ves.
  const userKeywords = getKeywordInterests(uid);

  const taste = await buildDiscoveryTasteVector(uid, preferences);

  const topCategories = Array.from(taste.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, DISCOVERY_TOP_CATEGORIES)
    .map(([category]) => category);

  if (topCategories.length === 0) {
    discoveryCache.set(uid, { posts: [], cachedAt: Date.now() });
    return [];
  }

  const excludeAuthors = new Set<string>([
    uid,
    ...followedProfileIds,
    ...blockedByIds,
    ...blockedIds,
    ...suppressedAuthorIds,
  ]);

  // Candidatos (Fase 2):
  //   - Comunidades públicas: 1 sola query por categoría (`groupCategory` denormalizado)
  //   - Perfiles afines (no seguidos): sus posts públicos recientes
  const [communityPosts, profileScored] = await Promise.all([
    fetchPublicPostsByCategories({
      categories: topCategories,
      viewerUid: uid,
      excludeGroupIds: memberGroupIds,
      pageSize: DISCOVERY_COMMUNITY_POST_LIMIT,
    }),
    fetchProfilesByInterests(topCategories, excludeAuthors),
  ]);

  const topProfiles = profileScored
    .slice(0, DISCOVERY_PROFILES)
    .map((entry) => entry.card);

  const profilePostGroups = await Promise.all(
    topProfiles.map(async (profile) => {
      try {
        const page = await fetchUserProfilePostsPage({
          profileUid: profile.uid,
          viewerUid: uid,
          pageSize: DISCOVERY_POSTS_PER_PROFILE,
        });
        // Afinidad base media: vinieron de un match de interés declarado.
        return page.posts.map((post) => ({ post, affinity: 2 }));
      } catch {
        return [] as { post: DiscoveryPost; affinity: number }[];
      }
    })
  );

  const communityCandidates = communityPosts.map((post) => {
    const category = normalizeGroupCategory(post.groupCategory);
    const affinity = category ? taste.get(category) ?? 0 : 0;
    return { post, affinity };
  });

  const shownIds = getShownDiscoveryIds(uid);
  const seenIds = getSeenPostIds(uid);
  const seen = new Set<string>();
  const scoredFresh: { post: DiscoveryPost; score: number }[] = [];
  const scoredStale: { post: DiscoveryPost; score: number }[] = [];

  for (const { post, affinity } of [
    ...communityCandidates,
    ...profilePostGroups.flat(),
  ]) {
    if (!post || !post.id) continue;
    if (seen.has(post.id)) continue;
    if (hiddenPostIds.has(post.id)) continue; // ocultado/reportado por el usuario
    if (post.authorId && excludeAuthors.has(post.authorId)) continue;
    if (!isDiscoveryWorthy(post)) continue; // #4 gate de calidad
    seen.add(post.id);
    const score =
      scoreDiscoveryPost(post, affinity) +
      tagOverlapBonus(post, userTagInterests) +
      keywordOverlapBonus(post, userKeywords);
    // Anti-repetición SUAVE: preferimos frescos, pero si hay pocos reusamos los
    // ya mostrados/vistos (evita que un pool chico se vacíe por 14 días).
    if (shownIds.has(post.id) || seenIds.has(post.id)) {
      scoredStale.push({ post, score });
    } else {
      scoredFresh.push({ post, score });
    }
  }

  const scored =
    scoredFresh.length >= MIN_FRESH_RESULTS
      ? scoredFresh
      : [...scoredFresh, ...scoredStale];

  const rankedScored = scored.sort((a, b) => b.score - a.score);

  // #3 Diversidad: intercala evitando saturar por autor/categoría (máx 1 por
  // autor, 3 por categoría). Si los topes dejan corto, se rellena sin topes.
  const perAuthor = new Map<string, number>();
  const perCategory = new Map<string, number>();
  const picked: DiscoveryPost[] = [];
  const pickedIds = new Set<string>();

  for (const { post } of rankedScored) {
    if (picked.length >= MAX_DISCOVERY_POSTS) break;
    const author = post.authorId ?? "";
    const category = normalizeGroupCategory(post.groupCategory) ?? "_none";
    if ((perAuthor.get(author) ?? 0) >= DISCOVERY_MAX_PER_AUTHOR) continue;
    if ((perCategory.get(category) ?? 0) >= DISCOVERY_MAX_PER_CATEGORY) continue;
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    picked.push(post);
    pickedIds.add(post.id);
  }

  if (picked.length < MAX_DISCOVERY_POSTS) {
    for (const { post } of rankedScored) {
      if (picked.length >= MAX_DISCOVERY_POSTS) break;
      if (pickedIds.has(post.id)) continue;
      picked.push(post);
      pickedIds.add(post.id);
    }
  }

  if (picked.length > 0) {
    markDiscoveryShown(uid, picked.map((post) => post.id));
  }

  discoveryCache.set(uid, { posts: picked, cachedAt: Date.now() });
  return picked;
}