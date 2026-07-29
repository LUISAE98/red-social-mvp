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
import {
  MAX_RECOMMENDATIONS,
  MIN_FRESH_RESULTS,
  MIN_ONBOARDING_CATEGORIES,
  RANDOM_SLOT_OPTIONS,
  SHOWN_GROUPS_TTL_MS,
  fetchBlockedByProfileIds,
  fetchBlockedProfileIds,
  fetchFollowedProfileIds,
  fetchGroupsByCategories,
  fetchGroupsByFollowedMembers,
  fetchGroupsByOwnerIds,
  fetchGroupsByTags,
  fetchRandomFallbackGroups,
  fetchUserMembershipGroupIds,
  getCachedResult,
  getPersistedResult,
  getShownGroupIds,
  getStorageKey,
  getStoredRecommendationPreferences,
  loadPreferencesFromFirestore,
  markGroupsAsShown,
  persistResult,
  setCachedResult,
  syncPreferencesToFirestore,
  uniqueCanonicalCategories,
  uniqueTags,
} from "./recommendation-engine.internal";
import { fetchProfilesByInterests } from "./recommendation-engine.profiles";

// Núcleo y recomendación de perfiles extraídos a sus propios módulos; se
// re-exportan (barrel) para no cambiar los consumidores.
export * from "./recommendation-engine.internal";
export * from "./recommendation-engine.profiles";

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