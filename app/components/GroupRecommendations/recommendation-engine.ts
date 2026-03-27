"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  GROUP_CATEGORY_OPTIONS,
  normalizeGroupCategory,
  normalizeGroupTags,
  type CanonicalGroupCategory,
  type Group,
} from "@/types/group";
import type {
  RecommendationFetchResult,
  RecommendationGroupCard,
  StoredRecommendationPreferences,
} from "./types";

const STORAGE_KEY_PREFIX = "red-social-mvp:group-recommendations:";
const RANDOM_SLOT_OPTIONS = [6, 10, 15] as const;
const MIN_ONBOARDING_CATEGORIES = 6;
const MAX_CATEGORY_QUERY_SIZE = 10;
const MAX_RECOMMENDATIONS = 18;
const MAX_TAGS_TRACKED = 40;
const RANDOM_GROUP_FETCH_LIMIT = 40;

function getStorageKey(uid: string) {
  return `${STORAGE_KEY_PREFIX}${uid}`;
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

function toRecommendationCard(
  groupId: string,
  data: Partial<Group>
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
    memberCount: null,
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

async function isUserMemberOfGroup(groupId: string, uid: string) {
  if (!uid) return false;

  try {
    const memberSnap = await getDoc(doc(db, "groups", groupId, "members", uid));
    return memberSnap.exists();
  } catch {
    return false;
  }
}

async function fetchGroupsByCategories(
  categories: CanonicalGroupCategory[],
  uid: string
): Promise<RecommendationGroupCard[]> {
  if (!uid || categories.length === 0) return [];

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

      const alreadyMember = await isUserMemberOfGroup(docSnap.id, uid);
      if (alreadyMember) continue;

      found.set(docSnap.id, card);
    }
  }

  return Array.from(found.values()).slice(0, MAX_RECOMMENDATIONS);
}

async function fetchRandomFallbackGroups(uid: string): Promise<RecommendationGroupCard[]> {
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

    const alreadyMember = await isUserMemberOfGroup(docSnap.id, uid);
    if (alreadyMember) continue;

    found.push(card);
  }

  return seededShuffle(found, `fallback:${uid}`).slice(0, MAX_RECOMMENDATIONS);
}

function buildCategoryAffinity(preferences: StoredRecommendationPreferences) {
  return uniqueCanonicalCategories([
    ...preferences.selectedCategories,
    ...preferences.joinedCategories,
  ]);
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

  const preferences = getStoredRecommendationPreferences(uid);
  const affinityCategories = buildCategoryAffinity(preferences);

  if (
    !preferences.onboardingCompleted ||
    preferences.selectedCategories.length < MIN_ONBOARDING_CATEGORIES
  ) {
    return {
      groups: [],
      reason: "onboarding_categories",
      selectedCategories: preferences.selectedCategories,
      onboardingCompleted: false,
    };
  }

  const groups = await fetchGroupsByCategories(affinityCategories, uid);

  if (groups.length > 0) {
    return {
      groups,
      reason:
        preferences.joinedCategories.length > 0
          ? "mixed_affinity"
          : "onboarding_categories",
      selectedCategories: preferences.selectedCategories,
      onboardingCompleted: true,
    };
  }

  const fallback = await fetchGroupsByCategories(
    preferences.selectedCategories,
    uid
  );

  if (fallback.length > 0) {
    return {
      groups: fallback,
      reason: "fallback_popular",
      selectedCategories: preferences.selectedCategories,
      onboardingCompleted: true,
    };
  }

  const randomFallback = await fetchRandomFallbackGroups(uid);

  return {
    groups: randomFallback,
    reason: "fallback_popular",
    selectedCategories: preferences.selectedCategories,
    onboardingCompleted: true,
  };
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