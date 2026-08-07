"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { isDisplayCurrency } from "@/lib/currency/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import { Button } from "@/components/ui";
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Post } from "@/lib/posts/types";

const LiveViewerModal = dynamic(
  () => import("@/app/components/LiveViewerModal/LiveViewerModal"),
  { ssr: false }
);
import { joinGroup } from "@/lib/groups/membership";
import { requestToJoin } from "@/lib/groups/joinRequests";
import { followUser } from "@/lib/social/social-service";
import {
  GROUP_CATEGORY_LABELS,
  GROUP_CATEGORY_OPTIONS,
  normalizeGroupCategory,
  type CanonicalGroupCategory,
  type Group,
} from "@/types/group";
import {
  completeRecommendationsOnboarding,
  fetchRecommendedGroupsForUser,
  fetchRecommendedProfilesForUser,
  getCachedResult,
  invalidateRecommendationCache,
  onRecommendationCacheInvalidated,
  recommendationEngineConstants,
  seededShuffle,
  trackGroupRecommendationSignalFromGroup,
  getUserTasteVector,
} from "./recommendation-engine";
import { updateProfileInterests } from "@/lib/profile/updateProfileInterests";
import type {
  RailItem,
  RecommendationFetchResult,
  RecommendationGroupCard,
  RecommendationJoinState,
  RecommendationProfileCard,
  RecommendationRailContext,
} from "./types";
export * from "./GroupRecommendationsRail.parts";
import {
  CATEGORY_IMAGE, CelebrationBurst, GroupCategoryPill, INTEREST_GRID_GAP,
  INTEREST_GRID_MIN_COL, INTEREST_SLIDE_VARIANTS, RAIL_CARD_W, RAIL_GAP,
  RAIL_PER_PAGE, celebTimings, fontStack, peekProfiles, profileCache,
  railTextButtonStyle, resolveJoinState, resolveSubscriptionEnabled,
  type Props, type LiveRec, type LiveActionState, type RailCard,
} from "./GroupRecommendationsRail.parts";
import {
  GroupCard, LiveRecommendationCard, ProfileCard, SkeletonRail,
} from "./GroupRecommendationsRail.cards";

export default function GroupRecommendationsRail({
  currentUserId,
  onCreateGroup,
  className,
  onboardingOnly = false,
  suppressOnboarding = false,
  railIndex = 0,
}: Props) {
  const router = useRouter();
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");
  const [selectedCategories, setSelectedCategories] = useState<
    CanonicalGroupCategory[]
  >([]);
  const [result, setResult] = useState<RecommendationFetchResult | null>(() => getCachedResult(currentUserId));
  const [loading, setLoading] = useState<boolean>(() => !getCachedResult(currentUserId));
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Paginación del selector: dos renglones completos por página (columnas × 2),
  // según cuántas columnas quepan realmente en el grid.
  const [interestsPage, setInterestsPage] = useState(0);
  const [interestsDirection, setInterestsDirection] = useState(1);
  const [interestsGridEl, setInterestsGridEl] = useState<HTMLDivElement | null>(null);
  const [interestsColumns, setInterestsColumns] = useState(4);
  const [interestsContainerWidth, setInterestsContainerWidth] = useState(0);
  // Animación final: al confirmar, los contenedores elegidos hacen pop y todo
  // el panel (incluido el título) se "consume".
  const [celebrating, setCelebrating] = useState(false);
  // Carrusel de recomendaciones. En desktop se pagina (sin scroll) mostrando
  // solo las cards completas que quepan; en celular se mantiene el scroll.
  const [railPage, setRailPage] = useState(0);
  const [railDirection, setRailDirection] = useState(1);
  const [isDesktopRail, setIsDesktopRail] = useState(false);
  const [joinStates, setJoinStates] = useState<
    Record<string, RecommendationJoinState>
  >({});
  const [joinLoadingByGroup, setJoinLoadingByGroup] = useState<
    Record<string, boolean>
  >({});
  const [profileCards, setProfileCards] = useState<RecommendationProfileCard[]>(() => peekProfiles(currentUserId) ?? []);
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});
  const [followLoadingByProfile, setFollowLoadingByProfile] = useState<
    Record<string, boolean>
  >({});

  // Live recommendations
  const [liveRecs, setLiveRecs] = useState<LiveRec[]>([]);
  const [viewingPost, setViewingPost] = useState<Post | null>(null);
  const [liveActionStates, setLiveActionStates] = useState<Record<string, LiveActionState>>({});
  const [liveActionLoading, setLiveActionLoading] = useState<Record<string, boolean>>({});
  const followingIdsRef = useRef<Set<string>>(new Set());
  const memberGroupIdsRef = useRef<Set<string>>(new Set());

  const minCategories = recommendationEngineConstants.MIN_ONBOARDING_CATEGORIES;

  const loadRecommendations = useCallback(async () => {
    if (!currentUserId) {
      setResult(null);
      setJoinStates({});
      setSelectedCategories([]);
      setProfileCards([]);
      setFollowStates({});
      setLoading(false);
      setError(null);
      return;
    }

    if (!getCachedResult(currentUserId)) setLoading(true);
    setError(null);

    try {
      const [next, profiles] = await Promise.all([
        fetchRecommendedGroupsForUser(currentUserId),
        fetchRecommendedProfilesForUser(currentUserId).catch(() => [] as RecommendationProfileCard[]),
      ]);
      setResult(next);
      setSelectedCategories(next.selectedCategories);
      profileCache.set(currentUserId, { profiles, cachedAt: Date.now() });
      setProfileCards(profiles);
      setFollowStates(Object.fromEntries(profiles.map((p) => [p.uid, false])));

      if (next.groups.length > 0) {
        const entries = await Promise.all(
          next.groups.map(async (group) => {
            const state = await resolveJoinState(
              group.id,
              currentUserId,
              group.visibility
            );
            return [group.id, state] as const;
          })
        );

        setJoinStates(Object.fromEntries(entries));
      } else {
        setJoinStates({});
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tGroups("recsLoadError")
      );
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  // Ref that always points to the latest loadRecommendations — used in the
  // cache-invalidation subscription so we don't need to re-register on every render
  const loadRecommendationsRef = useRef(loadRecommendations);
  loadRecommendationsRef.current = loadRecommendations;

  // When any Rail instance invalidates the shared cache, all instances re-fetch
  useEffect(() => {
    return onRecommendationCacheInvalidated(() => {
      void loadRecommendationsRef.current();
    });
  }, []);

  // Suscripción en tiempo real a lives públicos activos no seguidos/miembros
  useEffect(() => {
    if (!currentUserId) return;
    let unsubLives: (() => void) | null = null;
    let cancelled = false;
    let snapGen = 0;

    async function init() {
      try {
        const [followSnap, memberSnap] = await Promise.all([
          getDocs(query(collection(db, "users", currentUserId, "following"), limit(100))),
          getDocs(collection(db, "users", currentUserId, "groupMemberships")),
        ]);
        if (cancelled) return;

        followingIdsRef.current = new Set(
          followSnap.docs.map((d) => (d.data().targetUserId as string) ?? d.id),
        );
        memberGroupIdsRef.current = new Set(
          memberSnap.docs
            .filter((d) => ["active", "subscribed"].includes(d.data().status as string))
            .map((d) => d.id),
        );
      } catch {
        // non-fatal
      }
      if (cancelled) return;

      // Vector de gustos (una vez por montaje) para rankear lives por afinidad.
      let taste: Map<CanonicalGroupCategory, number> = new Map();
      try {
        taste = await getUserTasteVector(currentUserId);
      } catch {
        // sin señales → ranking por populares
      }
      if (cancelled) return;

      const startedMs = (ld: Record<string, unknown>): number => {
        const s = ld.startedAt as
          | { toMillis?: () => number; seconds?: number }
          | null;
        if (s && typeof s.toMillis === "function") return s.toMillis();
        if (s && typeof s.seconds === "number") return s.seconds * 1000;
        return 0;
      };

      // Solo lives ABIERTOS (`allowLoggedOutViewers==true`, = visibilityMode "everyone").
      // Es el mismo criterio que el filtro cliente de abajo, PERO también es obligatorio en
      // la query: las reglas `list` deniegan la consulta COMPLETA si un solo doc del
      // resultado no pasa `guestAllowedForLive` (un live restringido para un viewer anónimo).
      // Filtrando aquí, el result-set nunca incluye restringidos → la query nunca es negada.
      const q = query(
        collection(db, "posts"),
        where("liveData.status", "==", "live"),
        where("liveData.allowLoggedOutViewers", "==", true),
        limit(40),
      );

      unsubLives = onSnapshot(q, async (snap) => {
        if (cancelled) return;
        const myGen = ++snapGen;

        const filtered = snap.docs
          .map((d): Record<string, unknown> => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .filter((post) => {
            const ld = post.liveData as Record<string, unknown> | null;
            if (!ld || ld.visibilityMode !== "everyone") return false;
            // Solo EN CURSO: debe haber iniciado (startedAt) y no haber terminado
            // (endedAt). Excluye programados/"upcoming" y terminados aunque el
            // status haya quedado en "live".
            if (!ld.startedAt || ld.endedAt) return false;
            // Transmisiones directas (browser): exige heartbeat reciente para no
            // mostrar lives huérfanos que el cleanup aún no haya cerrado.
            if (ld.broadcastMode === "direct") {
              const hb = ld.heartbeatAt as
                | { toMillis?: () => number; seconds?: number }
                | null;
              const hbMs =
                hb && typeof hb.toMillis === "function"
                  ? hb.toMillis()
                  : hb && typeof hb.seconds === "number"
                    ? hb.seconds * 1000
                    : 0;
              if (!hbMs || Date.now() - hbMs > 120000) return false;
            }
            if (post.authorId === currentUserId) return false;
            const gid = post.groupId as string | undefined;
            if (!gid && followingIdsRef.current.has(post.authorId as string)) return false;
            if (gid && memberGroupIdsRef.current.has(gid)) return false;
            return true;
          });

        if (filtered.length === 0) { setLiveRecs([]); return; }

        const authorIds = [...new Set(
          filtered.filter((p) => !p.groupId).map((p) => p.authorId as string),
        )];
        const gids = [...new Set(
          filtered.filter((p) => !!p.groupId).map((p) => p.groupId as string),
        )];

        const [authorDocs, groupDocs] = await Promise.all([
          authorIds.length > 0
            ? getDocs(query(collection(db, "users"), where(documentId(), "in", authorIds.slice(0, 30))))
            : Promise.resolve({ docs: [] as typeof snap.docs }),
          gids.length > 0
            ? getDocs(query(collection(db, "groups"), where(documentId(), "in", gids.slice(0, 30))))
            : Promise.resolve({ docs: [] as typeof snap.docs }),
        ]);
        if (cancelled || myGen !== snapGen) return;

        const userMap = new Map(authorDocs.docs.map((d) => [d.id, d.data()]));
        const groupMap = new Map(groupDocs.docs.map((d) => [d.id, d.data()]));

        const recs: LiveRec[] = filtered.map((post) => {
          const ld = post.liveData as Record<string, unknown>;
          const gid = post.groupId as string | undefined;
          if (gid) {
            const g = (groupMap.get(gid) ?? {}) as Record<string, unknown>;
            const mon = (g.monetization ?? {}) as Record<string, unknown>;
            // Categoría del live = categoría de la comunidad.
            const gcat = normalizeGroupCategory(g.category);
            return {
              postId: post.id as string,
              authorId: post.authorId as string,
              groupId: gid,
              liveCoverUrl: (ld.coverUrl as string | null) ?? null,
              liveTitle: (ld.title as string | null) ?? null,
              displayName: (g.name as string) ?? tCommon("communityLabel"),
              avatarUrl: (g.avatarUrl as string | null) ?? null,
              coverUrl: (g.coverUrl as string | null) ?? null,
              groupVisibility: (g.visibility as string | null) ?? null,
              subscriptionEnabled: mon.subscriptionsEnabled === true || mon.isPaid === true,
              subscriptionPriceMonthly:
                typeof mon.subscriptionPriceMonthly === "number"
                  ? mon.subscriptionPriceMonthly
                  : typeof mon.priceMonthly === "number"
                  ? mon.priceMonthly
                  : null,
              categories: gcat ? [gcat] : [],
              startedAtMs: startedMs(ld),
            };
          } else {
            const u = (userMap.get(post.authorId as string) ?? {}) as Record<string, unknown>;
            // Categoría del live = intereses del creador.
            const ucats = Array.isArray(u.interests)
              ? (u.interests
                  .map((v) => normalizeGroupCategory(v))
                  .filter((c): c is CanonicalGroupCategory => !!c))
              : [];
            return {
              postId: post.id as string,
              authorId: post.authorId as string,
              groupId: null,
              liveCoverUrl: (ld.coverUrl as string | null) ?? null,
              liveTitle: (ld.title as string | null) ?? null,
              displayName: (u.displayName as string) ?? (u.username as string) ?? tCommon("user"),
              avatarUrl: (u.photoURL as string | null) ?? null,
              coverUrl: (u.coverPhotoURL as string | null) ?? null,
              handle: (u.handle as string | null) ?? null,
              categories: ucats,
              startedAtMs: startedMs(ld),
            };
          }
        });

        // Espectadores actuales de cada live (para rankear los "calientes").
        const withViewers = await Promise.all(
          recs.map(async (r) => {
            let viewers = 0;
            try {
              const c = await getCountFromServer(
                collection(db, "posts", r.postId, "liveViewers"),
              );
              viewers = c.data().count;
            } catch {
              // sin conteo → 0
            }
            return { ...r, viewers };
          }),
        );
        if (cancelled || myGen !== snapGen) return;

        // Ranking: afinidad de categoría + espectadores + recencia.
        // Frío total (sin señales) → por más espectadores (populares).
        const hasTaste = taste.size > 0;
        const nowMs = Date.now();
        const ranked = withViewers
          .map((r) => {
            let affinity = 0;
            for (const cat of r.categories ?? []) {
              affinity = Math.max(affinity, taste.get(cat) ?? 0);
            }
            const ageMin = r.startedAtMs ? (nowMs - r.startedAtMs) / 60000 : 999;
            const recency = Math.max(0, 1 - ageMin / 180); // decae en ~3h
            const popularity = Math.log1p(r.viewers ?? 0);
            const score = hasTaste
              ? affinity * 3 + popularity * 1.5 + recency * 1
              : popularity * 3 + recency * 1;
            return { r, score };
          })
          .sort((a, b) => b.score - a.score)
          .map((e) => e.r);

        setLiveRecs(ranked);
        setLiveActionStates((prev) => {
          const next = { ...prev };
          for (const r of ranked) if (!next[r.postId]) next[r.postId] = "none";
          return next;
        });
      });
    }

    void init();
    return () => {
      cancelled = true;
      if (unsubLives) unsubLives();
    };
  }, [currentUserId]);

  const toggleCategory = (category: CanonicalGroupCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
    );
  };

  const handleSaveOnboarding = async () => {
    if (!currentUserId) return;

    setSavingOnboarding(true);
    setError(null);

    try {
      completeRecommendationsOnboarding(currentUserId, selectedCategories);
      // Unificación: las mismas categorías se guardan como intereses del perfil
      // (uso interno: alimentan búsqueda por categoría y recomendaciones de perfiles).
      // Fire-and-forget: no debe bloquear el flujo de recomendaciones.
      void updateProfileInterests(selectedCategories).catch(() => {
        /* silencioso: las preferencias locales ya se guardaron */
      });
      // Invalidate shared cache so all Rail instances on this page pick up the new state
      invalidateRecommendationCache(currentUserId);
      // loadRecommendations will be triggered automatically by the invalidation listener
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tGroups("saveSelectionError")
      );
    } finally {
      setSavingOnboarding(false);
    }
  };

  // Confirmar: dispara la animación de "consumir" y, al terminar, guarda.
  const handleFinish = () => {
    if (
      savingOnboarding ||
      celebrating ||
      selectedCategories.length < minCategories
    ) {
      return;
    }
    setCelebrating(true);
    // Guarda al terminar la celebración: la duración depende de cuántas
    // categorías se eligieron, así que sale de celebTimings y no de un número fijo.
    window.setTimeout(
      () => {
        handleSaveOnboarding();
      },
      celebTimings(selectedCategories.length).total * 1000
    );
  };


  const handleJoin = async (group: RecommendationGroupCard) => {
    if (!currentUserId) return;

    setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: true }));
    setError(null);

    try {
      const isPaidSubscriptionPrivate =
        group.visibility === "private" && resolveSubscriptionEnabled(group);

      if (group.visibility === "public") {
        await joinGroup(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "joined" }));
      } else if (isPaidSubscriptionPrivate) {
        router.push(`/groups/${group.id}?service=suscripcion`);
        return;
      } else if (group.visibility === "private") {
        await requestToJoin(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "pending" }));
      }

      trackGroupRecommendationSignalFromGroup({
        uid: currentUserId,
        category: group.category,
        tags: group.tags,
      });

      // Invalidate cache so all Rail instances exclude this group on next fetch
      invalidateRecommendationCache(currentUserId);

      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : tGroups("actionError");

      if (message === "GROUP_REQUIRES_SUBSCRIPTION") {
        router.push(`/groups/${group.id}?service=suscripcion`);
        return;
      }

      setError(message);
    } finally {
      setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: false }));
    }
  };

  const handleOpenLiveViewer = async (postId: string) => {
    try {
      const snap = await getDoc(doc(db, "posts", postId));
      if (snap.exists()) setViewingPost({ id: snap.id, ...snap.data() } as Post);
    } catch { /* silencioso */ }
  };

  const handleLiveAction = async (rec: LiveRec) => {
    if (!currentUserId) return;
    setLiveActionLoading((prev) => ({ ...prev, [rec.postId]: true }));
    try {
      if (rec.groupId) {
        const isPaidPrivate = rec.groupVisibility === "private" && rec.subscriptionEnabled;
        if (isPaidPrivate) {
          router.push(`/groups/${rec.groupId}?service=suscripcion`);
          return;
        } else if (rec.groupVisibility === "public") {
          await joinGroup(rec.groupId, currentUserId);
          setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "joined" }));
        } else {
          await requestToJoin(rec.groupId, currentUserId);
          setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "pending" }));
        }
      } else {
        await followUser({ currentUserId, targetUserId: rec.authorId });
        setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "following" }));
        followingIdsRef.current.add(rec.authorId);
      }
    } catch { /* silencioso */ } finally {
      setLiveActionLoading((prev) => ({ ...prev, [rec.postId]: false }));
    }
  };

  const handleFollow = async (profile: RecommendationProfileCard) => {
    if (!currentUserId) return;
    setFollowLoadingByProfile((prev) => ({ ...prev, [profile.uid]: true }));
    setError(null);
    try {
      await followUser({ currentUserId, targetUserId: profile.uid });
      setFollowStates((prev) => ({ ...prev, [profile.uid]: true }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tGroups("followError")
      );
    } finally {
      setFollowLoadingByProfile((prev) => ({ ...prev, [profile.uid]: false }));
    }
  };

  const mergedRailItems = useMemo((): RailItem[] => {
    if (!result?.onboardingCompleted || result.groups.length === 0) return [];
    const items: RailItem[] = [];
    let profileIdx = 0;
    result.groups.forEach((group, i) => {
      items.push({ type: "group", data: group });
      if ((i + 1) % 3 === 0 && profileIdx < profileCards.length) {
        items.push({ type: "profile", data: profileCards[profileIdx++] });
      }
    });
    while (profileIdx < profileCards.length) {
      items.push({ type: "profile", data: profileCards[profileIdx++] });
    }
    return items;
  }, [result, profileCards]);

  // Todas las cards del rail en un solo orden (lives primero), para paginar.
  const allRailCards = useMemo<RailCard[]>(() => {
    const cards: RailCard[] = liveRecs.map((rec) => ({ kind: "live", rec }));
    if (!loading && result?.onboardingCompleted) {
      for (const item of mergedRailItems) {
        if (item.type === "group") cards.push({ kind: "group", group: item.data });
        else cards.push({ kind: "profile", profile: item.data });
      }
    }
    return cards;
  }, [liveRecs, loading, result, mergedRailItems]);

  // Cada aparición del rail en el feed muestra algo distinto: se rota la lista
  // para que empiece en otro punto; si aún no hay suficiente contenido para una
  // ventana distinta, se cambia el orden de las cards.
  const variantRailCards = useMemo(() => {
    if (railIndex <= 0 || allRailCards.length === 0) return allRailCards;
    if (allRailCards.length <= RAIL_PER_PAGE) {
      return seededShuffle(allRailCards, `rail-${railIndex}`);
    }
    const offset = (railIndex * RAIL_PER_PAGE) % allRailCards.length;
    return [...allRailCards.slice(offset), ...allRailCards.slice(0, offset)];
  }, [allRailCards, railIndex]);

  // Mide cuántas columnas caben en el grid para paginar en renglones completos.
  useEffect(() => {
    if (!interestsGridEl || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      const w = interestsGridEl.clientWidth;
      if (w <= 0) return;
      const cols = Math.max(
        1,
        Math.floor(
          (w + INTEREST_GRID_GAP) / (INTEREST_GRID_MIN_COL + INTEREST_GRID_GAP)
        )
      );
      setInterestsColumns(cols);
      setInterestsContainerWidth(w);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(interestsGridEl);
    return () => ro.disconnect();
  }, [interestsGridEl]);

  // El rail se pagina solo en laptop/desktop; en celular queda con scroll.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 901px)");
    const apply = () => setIsDesktopRail(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const showOnboarding = useMemo(() => {
    return !suppressOnboarding && !loading && result && !result.onboardingCompleted;
  }, [suppressOnboarding, loading, result]);

  // Paginación derivada del selector de categorías (dos renglones por página).
  const interestsPerPage = Math.max(1, interestsColumns * 2);
  const interestPageCount = Math.ceil(
    GROUP_CATEGORY_OPTIONS.length / interestsPerPage
  );
  const interestPage = Math.min(
    interestsPage,
    Math.max(0, interestPageCount - 1)
  );
  const interestPageOptions = GROUP_CATEGORY_OPTIONS.slice(
    interestPage * interestsPerPage,
    (interestPage + 1) * interestsPerPage
  );
  const isLastInterestPage = interestPage >= interestPageCount - 1;

  // Altura exacta del grid de la página actual (renglones × alto de tarjeta),
  // para animarla suave cuando la última página tiene menos renglones y así los
  // botones suben fluido en vez de saltar.
  const interestRows = Math.max(
    1,
    Math.ceil(interestPageOptions.length / interestsColumns)
  );
  const interestColWidth =
    interestsContainerWidth > 0
      ? (interestsContainerWidth - (interestsColumns - 1) * INTEREST_GRID_GAP) /
        interestsColumns
      : 0;
  const interestsGridHeight =
    interestColWidth > 0
      ? interestRows * interestColWidth + (interestRows - 1) * INTEREST_GRID_GAP
      : undefined;

  const selectedOptions = useMemo(
    () => GROUP_CATEGORY_OPTIONS.filter((o) => selectedCategories.includes(o.value)),
    [selectedCategories]
  );

  // El texto y los botones se van justo cuando empiezan a salir los avatares.
  const chromeFade = celebrating
    ? {
        delay: celebTimings(selectedOptions.length).outStart,
        duration: 0.55,
        ease: "easeOut" as const,
      }
    : { duration: 0.2 };

  // Paginación del rail en desktop: 3 por renglón.
  const railPerPage = RAIL_PER_PAGE;
  const railPageCount = Math.max(
    1,
    Math.ceil(variantRailCards.length / railPerPage)
  );
  const railPageClamped = Math.min(railPage, railPageCount - 1);
  const railPageCards = variantRailCards.slice(
    railPageClamped * railPerPage,
    (railPageClamped + 1) * railPerPage
  );

  // Precarga las imágenes de la página SIGUIENTE del rail, para que al avanzar
  // se vean de inmediato (portada + avatar de cada card).
  useEffect(() => {
    if (!isDesktopRail || typeof window === "undefined") return;
    const start = (railPageClamped + 1) * railPerPage;
    const next = variantRailCards.slice(start, start + railPerPage);
    for (const card of next) {
      const urls =
        card.kind === "live"
          ? [card.rec.liveCoverUrl, card.rec.coverUrl, card.rec.avatarUrl]
          : card.kind === "group"
            ? [card.group.coverUrl, card.group.avatarUrl]
            : [card.profile.coverUrl, card.profile.avatarUrl];
      for (const url of urls) {
        if (url) {
          const img = new window.Image();
          img.src = url;
        }
      }
    }
  }, [isDesktopRail, railPageClamped, railPerPage, variantRailCards]);

  // "Ver más": desliza a la izquierda y entran nuevas recomendaciones.
  const handleRailMore = () => {
    if (railPageClamped >= railPageCount - 1) return;
    setRailDirection(1);
    setRailPage(railPageClamped + 1);
  };

  // "Regresar": vuelve a las sugerencias anteriores (desliza al revés).
  const handleRailBack = () => {
    if (railPageClamped <= 0) return;
    setRailDirection(-1);
    setRailPage(railPageClamped - 1);
  };

  const renderRailCard = (card: RailCard) => {
    // Desktop: se encoge si hace falta para que quepan 3, pero nunca crece más
    // de RAIL_CARD_W. Celular: ancho fijo + snap (como antes).
    const wrapperStyle: React.CSSProperties = isDesktopRail
      ? { flex: "1 1 0", minWidth: 0, maxWidth: RAIL_CARD_W }
      : {
          minWidth: RAIL_CARD_W,
          maxWidth: RAIL_CARD_W,
          flexShrink: 0,
          scrollSnapAlign: "start",
        };

    if (card.kind === "live") {
      return (
        <div key={`live-${card.rec.postId}`} style={wrapperStyle}>
          <LiveRecommendationCard
            rec={card.rec}
            currentUserId={currentUserId}
            actionState={liveActionStates[card.rec.postId] ?? "none"}
            actionLoading={Boolean(liveActionLoading[card.rec.postId])}
            onOpenViewer={() => void handleOpenLiveViewer(card.rec.postId)}
            onAction={() => void handleLiveAction(card.rec)}
          />
        </div>
      );
    }
    if (card.kind === "group") {
      return (
        <div key={`group-${card.group.id}`} style={wrapperStyle}>
          <GroupCard
            group={card.group}
            joinState={joinStates[card.group.id] ?? "join"}
            loading={Boolean(joinLoadingByGroup[card.group.id])}
            onJoin={() => handleJoin(card.group)}
            currentUserId={currentUserId}
          />
        </div>
      );
    }
    return (
      <div key={`profile-${card.profile.uid}`} style={wrapperStyle}>
        <ProfileCard
          profile={card.profile}
          isFollowing={followStates[card.profile.uid] ?? false}
          loading={Boolean(followLoadingByProfile[card.profile.uid])}
          onFollow={() => handleFollow(card.profile)}
          currentUserId={currentUserId}
        />
      </div>
    );
  };

  // Precarga las imágenes de la página SIGUIENTE mientras se ven las actuales,
  // para que al deslizar ya estén cargadas (sin parpadeo). `window.Image` porque
  // aquí `Image` es el componente de next/image.
  useEffect(() => {
    if (!showOnboarding || typeof window === "undefined") return;
    const start = (interestPage + 1) * interestsPerPage;
    GROUP_CATEGORY_OPTIONS.slice(start, start + interestsPerPage).forEach((o) => {
      const src = CATEGORY_IMAGE[o.value];
      if (src) {
        const img = new window.Image();
        img.src = src;
      }
    });
  }, [showOnboarding, interestPage, interestsPerPage]);

  if (!currentUserId) {
    return null;
  }

  // Modo "solo selector": no renderiza nada salvo el selector de onboarding.
  // (Mientras carga o si el onboarding ya está completo, no muestra nada.)
  if (onboardingOnly && !showOnboarding) {
    return null;
  }

  return (
    <section
      className={className}
      style={{ width: "100%", color: "#fff" }}
    >
      {error ? (
        <div
          style={{
            marginBottom: 12,
            borderRadius: 12,
            background: "rgba(255, 80, 80, 0.12)",
            border: "1px solid rgba(255, 80, 80, 0.25)",
            padding: 12,
            fontSize: 13,
            fontFamily: fontStack,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? <SkeletonRail /> : null}

      {showOnboarding ? (
        <motion.div
          initial={false}
          style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 28, marginBottom: 28 }}
        >
          <style>{`
            .vibInterestsGradient {
              background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
              background-size: 220% 220%;
              -webkit-background-clip: text;
              background-clip: text;
              color: transparent;
              animation: vibInterestsFlow 4.5s ease-in-out infinite;
            }
            @keyframes vibInterestsFlow {
              0%, 100% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
            }
            .vibCatIcon { will-change: transform; }
            .vibCatCard:hover .vibCatIcon { transform: scale(1.08); }
          `}</style>
          <motion.div
            initial={false}
            animate={celebrating ? { opacity: 0, y: -6 } : { opacity: 1, y: 0 }}
            transition={chromeFade}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              textAlign: "center",
              fontFamily: fontStack,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#a855f7", letterSpacing: "0.01em" }}>
              {tGroups("interestsIntro")}
            </span>
            <span style={{ fontSize: 26.4, fontWeight: 665, lineHeight: 1.15, color: "#fff" }}>
              {tGroups("interestsTitlePre")}{" "}
              <span className="vibInterestsGradient" style={{ fontWeight: 740 }}>{tGroups("interestsTitleHighlight")}</span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.6)" }}>
              {tGroups("interestsSubtitle")}
            </span>
            <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.45)" }}>
              {tGroups("interestsFootnote")}
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(168,85,255,0.55)" }}>
              {tGroups("interestsMinHint")}
            </span>
          </motion.div>

          {celebrating ? (
            <CelebrationBurst
              categories={selectedOptions}
              width={interestsContainerWidth}
              height={interestsGridHeight ?? 300}
            />
          ) : (
            <motion.div
              ref={setInterestsGridEl}
              animate={{ height: interestsGridHeight ?? "auto" }}
              transition={{ height: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
              style={{ position: "relative", width: "100%", overflow: "hidden" }}
            >
              <AnimatePresence initial={false} custom={interestsDirection} mode="popLayout">
                <motion.div
                  key={interestPage}
                  custom={interestsDirection}
                  variants={INTEREST_SLIDE_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.4 },
                    opacity: { duration: 0.25 },
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(auto-fill, minmax(${INTEREST_GRID_MIN_COL}px, 1fr))`,
                    gap: INTEREST_GRID_GAP,
                    width: "100%",
                  }}
                >
                  {interestPageOptions.map((option) => (
                    <GroupCategoryPill
                      key={option.value}
                      label={option.label}
                      category={option.value}
                      selected={selectedCategories.includes(option.value)}
                      onToggle={() => toggleCategory(option.value)}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}

          <motion.div
            initial={false}
            animate={celebrating ? { opacity: 0, y: -6 } : { opacity: 1, y: 0 }}
            transition={chromeFade}
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: celebrating ? "none" : "auto",
            }}
          >
            {interestPage > 0 && (
              <button
                type="button"
                onClick={() => {
                  setInterestsDirection(-1);
                  setInterestsPage(interestPage - 1);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  color: "#a855f7",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: fontStack,
                }}
              >
                {tGroups("interestsGoBack")}
              </button>
            )}

            {isLastInterestPage ? (
              <button
                type="button"
                onClick={handleFinish}
                disabled={
                  savingOnboarding || selectedCategories.length < minCategories
                }
                style={{
                  marginLeft: "auto",
                  border: "none",
                  borderRadius: 10,
                  padding: "7px 32px",
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: "-0.01em",
                  color:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "rgba(255,255,255,0.6)"
                      : "#fff",
                  backgroundColor:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "rgba(255,255,255,0.16)"
                      : "transparent",
                  backgroundImage:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "none"
                      : "linear-gradient(100deg, #ff2fb3 0%, #a855f7 35%, #4f46ff 70%, #ff2fb3 100%)",
                  backgroundSize: "280% 280%",
                  backgroundPosition: "0% 50%",
                  boxShadow:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "none"
                      : "0 10px 28px rgba(168,85,255,0.22)",
                  cursor:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "default"
                      : "pointer",
                  overflow: "hidden",
                  fontFamily: fontStack,
                }}
              >
                {savingOnboarding ? tCommon("saving") : tCommon("continue")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setInterestsDirection(1);
                  setInterestsPage(interestPage + 1);
                }}
                style={{
                  marginLeft: "auto",
                  border: "none",
                  borderRadius: 10,
                  padding: "7px 32px",
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: "-0.01em",
                  color: "#fff",
                  backgroundColor: "transparent",
                  backgroundImage:
                    "linear-gradient(100deg, #ff2fb3 0%, #a855f7 35%, #4f46ff 70%, #ff2fb3 100%)",
                  backgroundSize: "280% 280%",
                  backgroundPosition: "0% 50%",
                  boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
                  cursor: "pointer",
                  overflow: "hidden",
                  fontFamily: fontStack,
                }}
              >
                {tCommon("next")}
              </button>
            )}
          </motion.div>
        </motion.div>
      ) : null}

      {(!loading && result?.onboardingCompleted && result.groups.length > 0) || liveRecs.length > 0 ? (
        <>
          <style>{`
            .vibraRecsRail {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            .vibraRecsRail::-webkit-scrollbar { display: none; }
          `}</style>

          {isDesktopRail ? (
            // Laptop: sin scroll. Solo las cards completas que quepan + "Ver más".
            <div style={{ width: "100%", overflow: "hidden" }}>
              <AnimatePresence initial={false} custom={railDirection} mode="popLayout">
                <motion.div
                  key={railPageClamped}
                  custom={railDirection}
                  variants={INTEREST_SLIDE_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.42 },
                    opacity: { duration: 0.25 },
                  }}
                  style={{
                    display: "flex",
                    gap: RAIL_GAP,
                    justifyContent: "center",
                    paddingBottom: 6,
                  }}
                >
                  {railPageCards.map(renderRailCard)}
                </motion.div>
              </AnimatePresence>

              {railPageCount > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    marginTop: 8,
                  }}
                >
                  {railPageClamped > 0 && (
                    <button
                      type="button"
                      onClick={handleRailBack}
                      style={railTextButtonStyle}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                      {tGroups("interestsGoBack")}
                    </button>
                  )}
                  {railPageClamped < railPageCount - 1 && (
                    <button
                      type="button"
                      onClick={handleRailMore}
                      style={{ ...railTextButtonStyle, marginLeft: "auto" }}
                    >
                      {tCommon("viewMore")}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Celular: se mantiene el scroll horizontal tal como está hoy.
            <div
              className="vibraRecsRail"
              style={{
                display: "flex",
                gap: RAIL_GAP,
                overflowX: "auto",
                scrollSnapType: "x mandatory",
                paddingBottom: 6,
                // Pequeño marco a los lados: el scrollPadding hace que el snap
                // respete el margen y la primera card no quede pegada al borde.
                paddingLeft: 14,
                paddingRight: 14,
                scrollPaddingLeft: 14,
                scrollPaddingRight: 14,
                willChange: "transform",
              }}
            >
              {variantRailCards.map(renderRailCard)}
            </div>
          )}
        </>
      ) : null}

      {viewingPost && (
        <LiveViewerModal
          open={!!viewingPost}
          onClose={() => setViewingPost(null)}
          post={viewingPost}
        />
      )}

      {!loading && result?.onboardingCompleted && result.groups.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "8px 0 2px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: "rgba(255,255,255,0.68)",
              fontFamily: fontStack,
            }}
          >
            {tGroups("noCommunitiesAvailable")}
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button
              variant="primary"
              style={{ padding: "10px 14px", fontFamily: fontStack }}
              onClick={() => {
                if (onCreateGroup) {
                  onCreateGroup();
                  return;
                }
                router.push("/groups/new");
              }}
            >
              {tGroups("createCommunityRailButton")}
            </Button>

            <button
              type="button"
              onClick={() => {
                setResult((prev) =>
                  prev
                    ? {
                        ...prev,
                        onboardingCompleted: false,
                      }
                    : prev
                );
              }}
              style={{
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 12,
                padding: "10px 14px",
                background: "transparent",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: fontStack,
              }}
            >
              {tGroups("changeCategories")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
