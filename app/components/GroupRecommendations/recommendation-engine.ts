"use client";

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
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

function seededShuffle<T>(items: T[], seedText: string): T[] {
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
  void setDoc(
    FIRESTORE_PREFS_PATH(uid),
    {
      selectedCategories: prefs.selectedCategories,
      joinedCategories: prefs.joinedCategories,
      joinedTags: prefs.joinedTags,
      onboardingCompleted: prefs.onboardingCompleted,
      updatedAt: prefs.updatedAt,
    },
    { merge: true }
  ).catch(() => {
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

  const [categoryCreators, coMemberProfiles, generalCreators, fofProfiles] =
    await Promise.all([
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

  // If localStorage shows no completed onboarding, try Firestore as cross-device fallback
  if (!preferences.onboardingCompleted) {
    const remote = await loadPreferencesFromFirestore(uid);
    if (remote && remote.onboardingCompleted) {
      // Sync back to localStorage so future reads are instant
      window.localStorage.setItem(getStorageKey(uid), JSON.stringify(remote));
      preferences = remote;
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