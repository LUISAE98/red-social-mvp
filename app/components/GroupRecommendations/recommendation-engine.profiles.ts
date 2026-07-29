// Recomendación de PERFILES — parte del motor de recomendaciones.
// Depende del núcleo (recommendation-engine.internal); re-exportado por el barrel.


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
import {
  chunkArray, seededShuffle, toRecommendationCard, normalizeRecommendationMonetization,
  fetchFollowedProfileIds, fetchBlockedProfileIds, fetchBlockedByProfileIds,
  fetchUserMembershipGroupIds, getStoredRecommendationPreferences,
  MAX_CATEGORY_QUERY_SIZE, SHOWN_GROUPS_TTL_MS, uniqueCanonicalCategories,
  type ShownEntry,
} from "./recommendation-engine.internal";

export const SHOWN_PROFILES_KEY_PREFIX = "red-social-mvp:shown-profiles:";
export const SHOWN_PROFILES_MAX = 60;
export const MAX_PROFILE_RECOMMENDATIONS = 6;

export function getShownProfilesKey(uid: string) {
  return `${SHOWN_PROFILES_KEY_PREFIX}${uid}`;
}

export function getShownProfileIds(uid: string): Set<string> {
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

export function markProfilesAsShown(uid: string, ids: string[]): void {
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

export function toProfileCard(
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

export type ProfileScored = { card: RecommendationProfileCard; score: number };

// Signal A (+5 con servicios, +2 sin): dueños de grupos en mis categorías de interés
export async function fetchProfilesByGroupOwnership(
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
export async function fetchProfilesByInterests(
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
export async function fetchProfilesFromCoMembers(
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
export async function fetchActiveCreators(
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
export async function fetchFriendsOfFriends(
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

