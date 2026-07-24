//HomePostsFeed.tsx
"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";

import type { Comment, CommentImage, CommentMention, CommentReply, Post } from "@/lib/posts/types";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchHomePostsPage,
  fetchPostComments,
  softDeletePost,
  togglePostFlame,
  togglePostSave,
  type HomePostsPageCursor,
} from "@/lib/posts/post-service";

import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import {
  buildRandomRecommendationSlots,
  fetchDiscoveryPostsForUser,
  getFeedRailSeed,
} from "@/app/components/GroupRecommendations/recommendation-engine";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import {
  recordPostImpression,
  recordPostSaveSignal,
  recordPostCommentSignal,
  recordPostLikeSignal,
  recordPostNotInterested,
  getHiddenPostIds,
} from "@/lib/discovery/viewSignal";
import { followUser } from "@/lib/social/social-service";
import { joinGroup } from "@/lib/groups/membership";

type HomePostsFeedProps = {
  currentUserId: string | null;
  refreshRef?: React.MutableRefObject<() => Promise<void>>;
};

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: "active" | "muted" | "banned" | "removed" | null;
  authorMutedUntil?: unknown;
};

function normalizeHomeFeedPost(post: PostWithFlags): PostWithFlags {
  return {
    ...post,
    isDeleted: post.isDeleted === true,
    postType: post.postType ?? "text",
    access: post.access ?? "free",
    accessModel: post.accessModel ?? "free",
    accessScope: post.accessScope ?? "group",
    requiresPayment: post.requiresPayment ?? false,
    requiresSubscription: post.requiresSubscription ?? false,
    oneTimePrice: post.oneTimePrice ?? null,
    currency: post.currency ?? null,
    purchaseType: post.purchaseType ?? null,
    media: Array.isArray(post.media) ? post.media : [],
    counts: {
      comments: post.counts?.comments ?? 0,
      likes: post.counts?.likes ?? 0,
      saves: post.counts?.saves ?? 0,
    },
    liveData: post.liveData ?? null,
    videoData: post.videoData ?? null,
    scheduledData: post.scheduledData ?? null,
    playback: post.playback ?? null,
    processing: post.processing ?? {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
  };
}

// Observa cuándo un post permanece visible el tiempo suficiente (dwell) y
// registra la impresión una sola vez. Señal de "visto" (Fase 3 descubrimiento).
const IMPRESSION_DWELL_MS = 900;

// Separador improbable en tags/texto para pasar el arreglo como prop estable.
const TAGS_PROP_SEP = "";

function PostImpressionObserver({
  uid,
  postId,
  category,
  tags,
  text,
  children,
}: {
  uid: string;
  postId?: string | null;
  category?: unknown;
  tags?: string;
  text?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    const el = ref.current;
    if (!el || !uid || typeof IntersectionObserver === "undefined") return;

    let timer: number | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (
          entry.isIntersecting &&
          entry.intersectionRatio >= 0.5 &&
          !firedRef.current
        ) {
          if (timer == null) {
            timer = window.setTimeout(() => {
              firedRef.current = true;
              recordPostImpression(uid, {
                postId,
                category,
                tags: tags ? tags.split(TAGS_PROP_SEP) : [],
                text,
              });
              observer.disconnect();
            }, IMPRESSION_DWELL_MS);
          }
        } else if (timer != null) {
          window.clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.5, 1] }
    );

    observer.observe(el);

    return () => {
      if (timer != null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [uid, postId, category, tags, text]);

  return <div ref={ref}>{children}</div>;
}

// CTA de descubrimiento: "Seguir" (si es perfil) o "Unirme" (si es comunidad).
// Se muestra arriba del post sugerido; el post en sí se ve como uno normal.
//
// El post SABE si el viewer ya sigue al autor / ya es miembro de la comunidad:
// consulta el estado real (following / members) y se oculta si ya está conectado
// (la ausencia del botón = "ya lo sigues"). La comunidad se detecta por la
// PRESENCIA de `groupId`, no por `contextType` (un post de comunidad con un
// `profileId` denormalizado se reclasifica como "profile" y perdía el botón).
function DiscoveryFollowJoinButton({
  post,
  currentUserId,
}: {
  post: PostWithFlags;
  currentUserId: string;
}) {
  const tFeed = useTranslations("feed");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  // null = aún no sabemos; true = ya sigue/es miembro; false = no conectado.
  const [connected, setConnected] = useState<boolean | null>(null);

  const isCommunity = !!post.groupId;
  const targetId = isCommunity
    ? post.groupId ?? null
    : post.profileId ?? post.authorId ?? null;

  const invalidTarget = !targetId || targetId === currentUserId;

  // Estado real de la relación: ¿ya sigue al autor / ya es miembro del grupo?
  useEffect(() => {
    if (invalidTarget || !targetId || !currentUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const ref = isCommunity
          ? doc(db, "groups", targetId, "members", currentUserId)
          : doc(db, "users", currentUserId, "following", targetId);
        const snap = await getDoc(ref);
        const isConnected = isCommunity
          ? snap.exists() &&
            ((snap.data() as { status?: string } | undefined)?.status ??
              "active") === "active"
          : snap.exists();
        if (!cancelled) setConnected(isConnected);
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invalidTarget, isCommunity, targetId, currentUserId]);

  if (invalidTarget || !targetId) return null;
  // Aún cargando el estado real → no mostramos nada (evita el flash de "Unirme"
  // en un post que en realidad ya sigues).
  if (connected === null && state === "idle") return null;

  // Ya sigue / ya es miembro al cargar → sin botón (el CTA solo tiene sentido en
  // recomendaciones que aún no sigues). El estado "done" (recién unido) se maneja
  // más abajo mostrando el texto morado.
  if (connected === true) return null;

  async function handleAction() {
    if (state !== "idle" || !targetId) return;
    setState("loading");
    try {
      if (isCommunity) {
        await joinGroup(targetId, currentUserId);
      } else {
        await followUser({ currentUserId, targetUserId: targetId });
      }
      setState("done");
    } catch {
      setState("idle");
    }
  }

  // Compacto para el header (izquierda del menú de 3 puntos): bajito y rosa.
  const baseStyle: React.CSSProperties = {
    flexShrink: 0,
    boxSizing: "border-box",
    padding: "5px 11px",
    borderRadius: 5,
    border: "none",
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // Recién unido / seguido → texto morado (Siguiendo / Unido), sin botón.
  if (state === "done") {
    return (
      <span
        style={{
          ...baseStyle,
          background: "transparent",
          color: "#a855ff",
          fontWeight: 700,
          cursor: "default",
        }}
      >
        {isCommunity ? tFeed("joinedCta") : tFeed("followingCta")}
      </span>
    );
  }

  // No conectado → CTA morado sólido (Unirme / Seguir).
  return (
    <button
      type="button"
      onClick={handleAction}
      disabled={state !== "idle"}
      style={{
        ...baseStyle,
        background: "#a855ff",
        color: "#fff",
        cursor: state === "idle" ? "pointer" : "default",
        opacity: state === "loading" ? 0.7 : 1,
      }}
    >
      {state === "loading"
        ? "…"
        : isCommunity
          ? tFeed("joinCta")
          : tFeed("followCta")}
    </button>
  );
}

function isVideoPostStillProcessing(post: PostWithFlags): boolean {
  if (post.postType !== "video") return false;
  if (!post.id) return false;

  const processingStatus = post.processing?.status;
  const videoStatus = post.videoData?.status;
  const playbackReady = post.playback?.isReady === true;

  if (processingStatus === "ready") return false;
  if (videoStatus === "ready") return false;
  if (playbackReady) return false;
  if (processingStatus === "error") return false;
  if (videoStatus === "error") return false;

  return true;
}

const HOME_FEED_PAGE_SIZE = 10;
const HOME_FEED_CACHE_TTL_MS = 1000 * 60 * 30;
const VIDEO_PROCESSING_POLL_MS = 15_000;
const VIDEO_PROCESSING_MAX_POLLS = 20;

type HomeFeedCacheEntry = {
  posts: PostWithFlags[];
  cursor: HomePostsPageCursor | null;
  hasMore: boolean;
  updatedAt: number;
};

const homeFeedMemoryCache = new Map<string, HomeFeedCacheEntry>();

function getHomeFeedCacheKey(currentUserId: string): string {
  return `home-feed:${currentUserId}`;
}

function mergeUniquePosts(
  currentPosts: PostWithFlags[],
  nextPosts: PostWithFlags[]
): PostWithFlags[] {
  const map = new Map<string, PostWithFlags>();

  currentPosts.forEach((post) => {
    if (post.id && post.isDeleted !== true) {
      map.set(post.id, post);
    }
  });

  nextPosts.forEach((post) => {
    if (post.id && post.isDeleted !== true) {
      map.set(post.id, post);
    }
  });

  return Array.from(map.values());
}

function peekFreshCache(uid: string | null): HomeFeedCacheEntry | null {
  if (!uid) return null;
  const cached = homeFeedMemoryCache.get(getHomeFeedCacheKey(uid));
  if (
    !cached ||
    Date.now() - cached.updatedAt > HOME_FEED_CACHE_TTL_MS ||
    cached.posts.some(isVideoPostStillProcessing) ||
    cached.posts.length === 0
  ) return null;
  return cached;
}

export default function HomePostsFeed({ currentUserId, refreshRef }: HomePostsFeedProps) {
  const t = useTranslations("common");
  const tFeed = useTranslations("feed");
  const tProfile = useTranslations("profile");
  const [posts, setPosts] = useState<PostWithFlags[]>(() => {
    const c = peekFreshCache(currentUserId);
    return c ? c.posts.filter((p) => p.isDeleted !== true) : [];
  });
  const [error, setError] = useState<string | null>(null);
  const { toast: feedToast, showToast: showFeedToast } = useVibraToast();
  useEffect(() => { if (error) showFeedToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [discoveryPosts, setDiscoveryPosts] = useState<PostWithFlags[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(() => !peekFreshCache(currentUserId));
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState<boolean>(() => peekFreshCache(currentUserId)?.hasMore ?? false);
  const [pageCursor, setPageCursor] = useState<HomePostsPageCursor | null>(() => peekFreshCache(currentUserId)?.cursor ?? null);
  const [, setIsMobile] = useState(false);
  const infiniteScrollTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(peekFreshCache(currentUserId)?.hasMore ?? false);
  const pageCursorRef = useRef<HomePostsPageCursor | null>(peekFreshCache(currentUserId)?.cursor ?? null);
  const videoProcessingPollsRef = useRef<Record<string, number>>({});
  const feedRequestIdRef = useRef(0);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    pageCursorRef.current = pageCursor;
  }, [pageCursor]);

  const syncPostsState = useCallback(
    (updater: (prev: PostWithFlags[]) => PostWithFlags[]) => {
      setPosts((prev) => {
        const next = updater(prev);

        if (currentUserId) {
          const cacheKey = getHomeFeedCacheKey(currentUserId);
          if (next.length > 0) {
            homeFeedMemoryCache.set(cacheKey, {
              posts: next,
              cursor: pageCursorRef.current,
              hasMore: hasMoreRef.current,
              updatedAt: Date.now(),
            });
          } else {
            homeFeedMemoryCache.delete(cacheKey);
          }
        }

        return next;
      });
    },
    [currentUserId]
  );

    useEffect(() => {
    return registerPostFeedCacheListener({
      removePost: (postId) => {
        syncPostsState((prev) => prev.filter((post) => post.id !== postId));
        setDiscoveryPosts((prev) => prev.filter((post) => post.id !== postId));
      },
      patchPost: (postId, patch) => {
        const applyPatch = (post: PostWithFlags): PostWithFlags =>
          post.id === postId
            ? normalizeHomeFeedPost({
                ...post,
                ...patch,
                counts: {
                  ...post.counts,
                  ...patch.counts,
                },
              } as PostWithFlags)
            : post;

        syncPostsState((prev) => prev.map(applyPatch));
        setDiscoveryPosts((prev) => prev.map(applyPatch));
      },
      clear: () => {
        if (currentUserId) {
          homeFeedMemoryCache.delete(getHomeFeedCacheKey(currentUserId));
        }

        setPosts([]);
        setDiscoveryPosts([]);
        setPageCursor(null);
        setHasMore(false);
        pageCursorRef.current = null;
        hasMoreRef.current = false;
      },
    });
  }, [currentUserId, syncPostsState]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 900px)");

    const sync = () => setIsMobile(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  // ─── Discovery feed: posts públicos afines de perfiles/comunidades no seguidos ───
  const discoveryLoadedRef = useRef(false);
  useEffect(() => {
    if (!currentUserId) {
      discoveryLoadedRef.current = false;
      setDiscoveryPosts([]);
      return;
    }
    if (discoveryLoadedRef.current) return;
    // Esperar a que termine la carga inicial, pero cargar descubrimiento aunque
    // el feed esté vacío (arranque en frío: se basa en intereses + búsquedas).
    if (loadingInitial) return;

    discoveryLoadedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const discovered = await fetchDiscoveryPostsForUser(currentUserId);
        if (cancelled) return;
        const normalized = discovered
          .filter((post) => !!post.id)
          .map((post) => normalizeHomeFeedPost(post as PostWithFlags));
        setDiscoveryPosts(normalized);
      } catch {
        /* silencioso: el descubrimiento es complementario */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, loadingInitial]);

  const loadPostsPage = useCallback(
    async (mode: "initial" | "more" | "refresh" = "initial") => {
      const requestId = feedRequestIdRef.current + 1;
      feedRequestIdRef.current = requestId;

      if (!currentUserId) {
        setPosts([]);
        setPageCursor(null);
        setHasMore(false);
        setLoadingInitial(false);
        setLoadingMore(false);
        return;
      }

      if (mode === "more") {
        if (loadingMoreRef.current || !hasMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoadingInitial(true);
      }

      try {
        setError(null);

        const result = await loadFeedWithRetry(
          () =>
            fetchHomePostsPage({
              userUid: currentUserId,
              pageSize: HOME_FEED_PAGE_SIZE,
              cursor: mode === "more" ? pageCursorRef.current : null,
            }),
          { timeoutMs: mode === "more" ? 15000 : 12000 }
        );

        if (feedRequestIdRef.current !== requestId) {
          return;
        }

        const hiddenIds = getHiddenPostIds(currentUserId);
        const normalizedPosts = result.posts
          .map((post) => normalizeHomeFeedPost(post as PostWithFlags))
          .filter((post) => post.isDeleted !== true && !hiddenIds.has(post.id));

        const nextCursor = result.cursor;
        const nextHasMore = result.hasMore;

        setPageCursor(nextCursor);
        setHasMore(nextHasMore);
        pageCursorRef.current = nextCursor;
        hasMoreRef.current = nextHasMore;

        setPosts((prev) => {
          const nextPosts =
            mode === "more"
              ? mergeUniquePosts(prev, normalizedPosts)
              : normalizedPosts;

          if (nextPosts.length > 0) {
            homeFeedMemoryCache.set(getHomeFeedCacheKey(currentUserId), {
              posts: nextPosts,
              cursor: nextCursor,
              hasMore: nextHasMore,
              updatedAt: Date.now(),
            });
          } else {
            homeFeedMemoryCache.delete(getHomeFeedCacheKey(currentUserId));
          }

          return nextPosts;
        });
      } catch (e: unknown) {
        if (feedRequestIdRef.current !== requestId) {
          return;
        }

        setError(
          (e instanceof Error ? e.message : null) ??
            tProfile("loadPostsError")
        );
      } finally {
        if (mode === "more") {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        } else {
          setLoadingInitial(false);
        }
      }
    },
    [currentUserId]
  );

  const loadPosts = useCallback(async () => {
    await loadPostsPage("refresh");
  }, [loadPostsPage]);

const handleHomePullRefresh = useCallback(async () => {
  await loadPostsPage("refresh");
}, [loadPostsPage]);

  useEffect(() => {
    if (refreshRef) {
      refreshRef.current = handleHomePullRefresh;
    }
  }, [refreshRef, handleHomePullRefresh]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!currentUserId) {
        if (active) {
          setPosts([]);
          setPageCursor(null);
          setHasMore(false);
          setLoadingInitial(false);
        }
        return;
      }

      const cacheKey = getHomeFeedCacheKey(currentUserId);
      const cached = homeFeedMemoryCache.get(cacheKey);
      const cacheIsFresh =
        !!cached && Date.now() - cached.updatedAt <= HOME_FEED_CACHE_TTL_MS;

      const cacheHasProcessingVideos =
        cached?.posts.some(isVideoPostStillProcessing) === true;

      if (
        cacheIsFresh &&
        !cacheHasProcessingVideos &&
        cached.posts.length > 0
      ) {
        setPosts(cached.posts.filter((post) => post.isDeleted !== true));
        setPageCursor(cached.cursor);
        setHasMore(cached.hasMore);
        pageCursorRef.current = cached.cursor;
        hasMoreRef.current = cached.hasMore;
        setLoadingInitial(false);
        return;
      }

      if (cached && cached.posts.length === 0) {
        homeFeedMemoryCache.delete(cacheKey);
      }

      if (active) {
        await loadPostsPage("initial");
      }
    }

    run();

    return () => {
      active = false;
    };
  }, [currentUserId, loadPostsPage]);

    useEffect(() => {
    if (!currentUserId) return;
    if (loadingInitial || loadingMore) return;
    if (posts.length > 0) return;
    if (!hasMore || !pageCursor) return;

    void loadPostsPage("more");
  }, [
    currentUserId,
    loadingInitial,
    loadingMore,
    posts.length,
    hasMore,
    pageCursor,
    loadPostsPage,
  ]);

  const infiniteScrollTriggerIndex = useMemo(() => {
    if (posts.length <= 5) return posts.length - 1;
    return Math.max(0, posts.length - 5);
  }, [posts.length]);


  const processingVideoPostIdsKey = useMemo(() => {
    return posts
      .filter(isVideoPostStillProcessing)
      .map((post) => post.id)
      .filter((postId): postId is string => Boolean(postId))
      .sort()
      .join("|");
  }, [posts]);

  useEffect(() => {
    if (!currentUserId) return;
    if (!processingVideoPostIdsKey) return;

    const postIds = processingVideoPostIdsKey.split("|").filter(Boolean);
    let cancelled = false;
    let timeoutId: number | null = null;

    async function refreshProcessingVideos() {
      if (cancelled) return;

      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        timeoutId = window.setTimeout(
          refreshProcessingVideos,
          VIDEO_PROCESSING_POLL_MS
        );
        return;
      }

      let shouldContinuePolling = false;

      await Promise.all(
        postIds.map(async (postId) => {
          const currentPollCount = videoProcessingPollsRef.current[postId] ?? 0;

          if (currentPollCount >= VIDEO_PROCESSING_MAX_POLLS) {
            return;
          }

          shouldContinuePolling = true;
          videoProcessingPollsRef.current[postId] = currentPollCount + 1;

          try {
            const postSnap = await getDoc(doc(db, "posts", postId));

            if (cancelled || !postSnap.exists()) return;

            const freshPost = normalizeHomeFeedPost({
              ...(postSnap.data() as Post),
              id: postSnap.id,
            } as PostWithFlags);

            const isDone =
              freshPost.processing?.status === "ready" ||
              freshPost.videoData?.status === "ready" ||
              freshPost.playback?.isReady === true ||
              freshPost.processing?.status === "error" ||
              freshPost.videoData?.status === "error";

            syncPostsState((prev) => {
              if (freshPost.isDeleted === true) {
                return prev.filter((post) => post.id !== postId);
              }

              return prev.map((post) =>
                post.id === postId
                  ? {
                      ...freshPost,
                      canModerateGroupAuthor: post.canModerateGroupAuthor,
                      authorMemberStatus: post.authorMemberStatus,
                      authorMutedUntil: post.authorMutedUntil,
                      viewerHasFlamed: post.viewerHasFlamed,
                      viewerHasSaved: post.viewerHasSaved,
                    }
                  : post
              );
            });

            if (isDone) {
              delete videoProcessingPollsRef.current[postId];
            }
          } catch {
            // Se ignora para no romper el feed por una lectura fallida temporal.
          }
        })
      );

      if (!cancelled && shouldContinuePolling) {
        timeoutId = window.setTimeout(
          refreshProcessingVideos,
          VIDEO_PROCESSING_POLL_MS
        );
      }
    }

    void refreshProcessingVideos();

    return () => {
      cancelled = true;

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [currentUserId, processingVideoPostIdsKey, syncPostsState]);

  useEffect(() => {
    if (!currentUserId) return;
    if (!hasMore) return;
    if (loadingInitial) return;

    const target = infiniteScrollTargetRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        void loadPostsPage("more");
      },
      {
        root: null,
        rootMargin: "240px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [
    currentUserId,
    hasMore,
    loadingInitial,
    infiniteScrollTriggerIndex,
    loadPostsPage,
  ]);

  async function handleToggleFlame(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await togglePostFlame(postId);

      // Señal de descubrimiento: like aporta tags + palabras de esa categoría.
      if (result.liked && currentUserId) {
        const likedPost =
          posts.find((post) => post.id === postId) ??
          discoveryPosts.find((post) => post.id === postId);
        recordPostLikeSignal(currentUserId, {
          tags: likedPost?.groupTags,
          text: likedPost?.text,
        });
      }

      patchPostInAllFeedCaches(postId, {
        viewerHasFlamed: result.liked,
        counts: {
          likes: result.likes,
        } as Post["counts"],
      });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tFeed("errorUpdateFlame"));
      throw e;
    }
  }

  async function handleToggleSave(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await togglePostSave(postId);

      const targetPost =
        posts.find((post) => post.id === postId) ??
        discoveryPosts.find((post) => post.id === postId);
      const currentSaves = targetPost?.counts?.saves ?? 0;
      const nextSaves = Math.max(0, currentSaves + result.delta);

      // Señal de descubrimiento: guardar es intención fuerte (categoría+tags+texto).
      if (result.saved && currentUserId) {
        recordPostSaveSignal(currentUserId, {
          category: targetPost?.groupCategory,
          tags: targetPost?.groupTags,
          text: targetPost?.text,
        });
      }

      patchPostInAllFeedCaches(postId, {
        viewerHasSaved: result.saved,
        counts: {
          saves: nextSaves,
        } as Post["counts"],
      });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tFeed("errorUpdateSave"));
      throw e;
    }
  }

  async function handleDeletePost(postId: string) {
    try {
      setError(null);
      await softDeletePost(postId);

      removePostFromAllFeedCaches(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? t("unknownError"));
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? t("unknownError"));
      throw e;
    }
  }

  async function syncPostCommentsCount(postId: string) {
    const comments = await fetchPostComments(postId);

    const total = comments.reduce(
      (sum, c) => sum + 1 + (c.counts?.replies ?? 0),
      0
    );

    syncPostsState((prev) =>
      prev.map((post) =>
        post.id === postId
          ? { ...post, counts: { ...post.counts, comments: total } }
          : post
      )
    );

    return comments;
  }

  async function handleCreateComment(
    postId: string,
    text: string,
    mentions?: CommentMention[],
    image?: CommentImage | null
  ): Promise<Comment[]> {
    try {
      setError(null);
      await createPostComment({ postId, text, mentions, image });

      // Señal de descubrimiento: comentar es intención fuerte (categoría+tags+texto).
      if (currentUserId) {
        const targetPost =
          posts.find((post) => post.id === postId) ??
          discoveryPosts.find((post) => post.id === postId);
        recordPostCommentSignal(currentUserId, {
          category: targetPost?.groupCategory,
          tags: targetPost?.groupTags,
          text: targetPost?.text,
        });
      }

      return await syncPostCommentsCount(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? t("unknownError"));
      throw e;
    }
  }

  async function handleDeleteComment(
    postId: string,
    commentId: string
  ): Promise<Comment[]> {
    try {
      setError(null);
      await deletePostComment({ postId, commentId });
      return await syncPostCommentsCount(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? t("unknownError"));
      throw e;
    }
  }

  async function handleLoadReplies(
    postId: string,
    commentId: string
  ): Promise<CommentReply[]> {
    try {
      setError(null);
      return await fetchCommentReplies({ postId, commentId });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tFeed("loadRepliesError"));
      throw e;
    }
  }

  async function handleCreateReply(
    postId: string,
    commentId: string,
    text: string,
    mentions?: CommentMention[],
    image?: CommentImage | null
  ): Promise<CommentReply[]> {
    try {
      setError(null);
      await createPostCommentReply({ postId, commentId, text, mentions, image });

      await syncPostCommentsCount(postId);

      return await fetchCommentReplies({ postId, commentId });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tFeed("createReplyError"));
      throw e;
    }
  }

  async function handleDeleteReply(
    postId: string,
    commentId: string,
    replyId: string
  ): Promise<CommentReply[]> {
    try {
      setError(null);
      await deletePostCommentReply({ postId, commentId, replyId });

      await syncPostCommentsCount(postId);

      return await fetchCommentReplies({ postId, commentId });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tFeed("deleteReplyError"));
      throw e;
    }
  }

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  minWidth: 0,
  display: "grid",
  gap: 12,
  marginLeft: "auto",
  marginRight: "auto",
  marginBottom: 18,
  overflowX: "hidden",
};

  const noticeStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.82)",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const postItemStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  const recommendationWrapperStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  // Semilla estable durante toda la sesión. Antes se derivaba de TODOS los posts,
  // así que al cargar más el seed cambiaba y los rails saltaban de altura. Con un
  // seed fijo, el recorrido es determinista: los slots ya mostrados se quedan y
  // solo se agregan nuevos más abajo.
  const railSeed = useMemo(() => getFeedRailSeed(), []);

  const recommendationSlots = useMemo(() => {
    if (!currentUserId || posts.length === 0) {
      return new Set<number>();
    }
    return buildRandomRecommendationSlots(posts.length, railSeed);
  }, [currentUserId, posts.length, railSeed]);

  // Orden de cada rail dentro del feed (0, 1, 2…), para que cada aparición
  // muestre contenido distinto.
  const recommendationSlotIndex = useMemo(() => {
    const map = new Map<number, number>();
    Array.from(recommendationSlots)
      .sort((a, b) => a - b)
      .forEach((pos, i) => map.set(pos, i));
    return map;
  }, [recommendationSlots]);

  const hasInlineRecommendation = useMemo(() => {
    return recommendationSlots.size > 0;
  }, [recommendationSlots]);

  // Slots donde inyectar posts de descubrimiento (uno cada ~4 posts), evitando
  // chocar con los rails de recomendación y los posts ya presentes en el feed.
  const discoverySlotMap = useMemo(() => {
    const map = new Map<number, PostWithFlags>();
    if (discoveryPosts.length === 0 || posts.length === 0) return map;

    const existingIds = new Set(posts.map((post) => post.id));
    const available = discoveryPosts.filter((post) => !existingIds.has(post.id));
    if (available.length === 0) return map;

    let cursor = 0;
    for (let i = 0; i < posts.length && cursor < available.length; i += 1) {
      const position = i + 1;
      // Primer sugerido tras 2 posts, luego cada 3 (evitando choque con rails).
      if (
        position >= 2 &&
        (position - 2) % 3 === 0 &&
        !recommendationSlots.has(position)
      ) {
        map.set(i, available[cursor]);
        cursor += 1;
      }
    }
    // Feed corto: si no se colocó ninguno, poner uno tras el último post.
    if (cursor === 0) {
      map.set(posts.length - 1, available[0]);
    }
    return map;
  }, [discoveryPosts, posts, recommendationSlots]);

  // Ocultar / reportar / bloquear un post lo remueve del feed al instante (de
  // ambas listas: base y descubrimiento) y alimenta el algoritmo con la señal
  // negativa (categoría/autor). El bloqueo además persiste en Firestore
  // (cross-device) por su propio flujo.
  const handleHidePost = useCallback(
    (post: PostWithFlags, reason: "hide" | "report" | "block") => {
      if (!currentUserId) return;
      recordPostNotInterested(currentUserId, {
        postId: post.id,
        authorId: post.authorId,
        category: post.groupCategory,
        tags: post.groupTags,
        reason,
      });
      setDiscoveryPosts((prev) => prev.filter((p) => p.id !== post.id));
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    },
    [currentUserId]
  );

  // Tarjeta de descubrimiento "Sugerido para ti" (post normal + CTA arriba).
  // Se reutiliza en los slots del feed y en el arranque en frío (feed vacío).
  const renderDiscoveryCard = (disc: PostWithFlags, uid: string) => (
    <div key={disc.id} style={{ ...postItemStyle, marginTop: 12 }}>
      <PostImpressionObserver
        uid={uid}
        postId={disc.id}
        category={disc.groupCategory}
        tags={(disc.groupTags ?? []).join(TAGS_PROP_SEP)}
        text={disc.text ?? ""}
      >
        <GroupPostCard
          post={disc}
          canDelete={false}
          onLoadComments={handleLoadComments}
          onCreateComment={handleCreateComment}
          onDeleteComment={handleDeleteComment}
          onLoadReplies={handleLoadReplies}
          onCreateReply={handleCreateReply}
          onDeleteReply={handleDeleteReply}
          onToggleFlame={handleToggleFlame}
          onToggleSave={handleToggleSave}
          currentUserId={uid}
          isOwner={false}
          viewerIsMember={false}
          isModerator={false}
          showGroupContext={true}
          canModerateGroupAuthor={false}
          suggestionMode={true}
          onHidePost={(reason) => handleHidePost(disc, reason)}
          beforeMenuAction={
            <DiscoveryFollowJoinButton post={disc} currentUserId={uid} />
          }
        />
      </PostImpressionObserver>
    </div>
  );

  if (!currentUserId) {
    return (
      <section style={shellStyle}>
        <div style={noticeStyle}>
          {tFeed("loginToViewFeed")}
        </div>
      </section>
    );
  }

return (
  <section style={shellStyle}>
    <VibraToast toast={feedToast} />

    {/* Selector de intereses: UNA sola vez, al inicio del feed. Si el onboarding
        ya está completo (guardado en la cuenta), no renderiza nada. */}
    <div style={recommendationWrapperStyle}>
      <GroupRecommendationsRail
        currentUserId={currentUserId}
        context="home"
        onboardingOnly
      />
    </div>

    {loadingInitial && posts.length === 0 && (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          minHeight: "50vh",
        }}
      >
        <div className="vibraPullRefreshSpinner refreshing" style={{ width: 32, height: 32 }} />
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.32)", letterSpacing: "0.01em" }}>
          {tProfile("postsLoading")}
        </span>
      </div>
    )}

    {/* Arranque en frío: feed base vacío. Si hay señales (intereses/búsquedas),
        mostramos descubrimiento; si no, solo el rail. Nunca contenido genérico. */}
    {!loadingInitial &&
      posts.length === 0 &&
      discoveryPosts.map((disc) => renderDiscoveryCard(disc, currentUserId))}

    {!loadingInitial && posts.length === 0 && (
      <div style={recommendationWrapperStyle}>
        <GroupRecommendationsRail
          currentUserId={currentUserId}
          context="home"
          suppressOnboarding
        />
      </div>
    )}

    {posts.map((post, index) => {
      const canDeletePost =
        currentUserId === post.authorId ||
        post.canModerateGroupAuthor === true;

      const shouldRenderRecommendations = recommendationSlots.has(index + 1);
      const discoveryForSlot = discoverySlotMap.get(index);
      const shouldAttachInfiniteScrollTarget =
        hasMore && index === infiniteScrollTriggerIndex;

      return (
        <div key={post.id} style={postItemStyle}>
          {shouldAttachInfiniteScrollTarget ? (
            <div
              ref={infiniteScrollTargetRef}
              aria-hidden="true"
              style={{
                width: "100%",
                height: 1,
                pointerEvents: "none",
              }}
            />
          ) : null}

          <PostImpressionObserver
            uid={currentUserId}
            postId={post.id}
            category={post.groupCategory}
            tags={(post.groupTags ?? []).join(TAGS_PROP_SEP)}
            text={post.text ?? ""}
          >
            <GroupPostCard
              post={post}
              canDelete={canDeletePost}
              onDelete={canDeletePost ? handleDeletePost : undefined}
              onLoadComments={handleLoadComments}
              onCreateComment={handleCreateComment}
              onDeleteComment={handleDeleteComment}
              onLoadReplies={handleLoadReplies}
              onCreateReply={handleCreateReply}
              onDeleteReply={handleDeleteReply}
              onToggleFlame={handleToggleFlame}
              onToggleSave={handleToggleSave}
              currentUserId={currentUserId}
              isOwner={false}
              viewerIsMember={post.contextType === "group"}
              isModerator={post.canModerateGroupAuthor === true}
              showGroupContext={true}
              canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              onModerationComplete={loadPosts}
              suggestionMode={post.authorId !== currentUserId}
              onHidePost={(reason) => handleHidePost(post, reason)}
            />
          </PostImpressionObserver>

          {shouldRenderRecommendations && (
            <div style={recommendationWrapperStyle}>
              <GroupRecommendationsRail
                currentUserId={currentUserId}
                context="home"
                suppressOnboarding
                railIndex={recommendationSlotIndex.get(index + 1) ?? 0}
              />
            </div>
          )}

          {discoveryForSlot && renderDiscoveryCard(discoveryForSlot, currentUserId)}
        </div>
      );
    })}

    {loadingMore && (
      <div style={noticeStyle}>{tProfile("postsLoadingMore")}</div>
    )}

    {!loadingInitial && !loadingMore && posts.length > 0 && !hasMore && (
      <div style={noticeStyle}>{tProfile("allPostsLoaded")}</div>
    )}

    {!loadingInitial && posts.length > 0 && !hasInlineRecommendation && (
      <div style={recommendationWrapperStyle}>
        <GroupRecommendationsRail
          currentUserId={currentUserId}
          context="home"
          suppressOnboarding
        />
      </div>
    )}
  </section>
);
}
