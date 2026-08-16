//ProfilePostFeed.tsx
"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnlockedPostIds } from "@/lib/posts/useUnlockedPostIds";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { doc, getDoc, Timestamp } from "firebase/firestore";

import type { Comment, CommentImage, CommentMention, CommentReply, Post } from "@/lib/posts/types";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchPostComments,
  fetchUserProfilePostsPage,
  softDeletePost,
  togglePostFlame,
  togglePostSave,
  toggleProfilePostPin,
  type UserProfilePostsPageCursor,
} from "@/lib/posts/post-service";

import { db } from "@/lib/firebase";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import { PostSkeletonList } from "@/app/components/PostSkeleton/PostSkeleton";
import PostReveal from "@/app/components/PostSkeleton/PostReveal";
import PostsMediaSubnav, { MEDIA_TAB_ORDER, type MediaTabKey } from "@/app/groups/[groupId]/components/posts/PostsMediaSubnav";
import MediaGallery, { type GalleryTile } from "@/app/groups/[groupId]/components/posts/MediaGallery";
import { useMediaSlideReservedHeight } from "@/app/groups/[groupId]/components/posts/useMediaSlideReservedHeight";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import {
  buildRandomRecommendationSlots,
  getFeedRailSeed,
} from "@/app/components/GroupRecommendations/recommendation-engine";
import DonationFeedBanner from "@/app/components/DonationFeedBanner/DonationFeedBanner";
import { loadFeedWithRetry, isFeedLoadTimeout } from "@/lib/posts/feed-load-helpers";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import {
  PROFILE_FEED_CACHE_TTL_MS, PROFILE_FEED_PAGE_SIZE, SEARCH_MAX_AUTO_PAGES,
  VIDEO_PROCESSING_MAX_POLLS, VIDEO_PROCESSING_POLL_MS,
  attachModerationFlags, filterBannedGroupPosts, getProfileFeedCacheKey,
  isVideoPostStillProcessing, mergeUniquePosts, normalizeForSearch,
  normalizeProfileFeedPost, postMatchesQuery, profileFeedMemoryCache,
  sortProfileFeedPosts,
  type PostWithFlags, type ProfilePostsFeedProps,
} from "./ProfilePostsFeed.helpers";

export default function ProfilePostsFeed({
  profileUid,
  viewerUid,
  isOwner,
  showPosts = true,
  profileRestricted = false,
  commentsEnabled = true,
  searchQuery = "",
  donation,
  donationCreatorName,
  donationProfilePhoto,
  donationProfileHandle,
  donationViewerOpen,
  onDonate,
  onDonationClose,
  onDonationPay,
}: ProfilePostsFeedProps) {
  const t = useTranslations("common");
  const tProfile = useTranslations("profile");
  const tFeed = useTranslations("feed");
  const tPosts = useTranslations("posts");
  // El servicio de donación solo es visible para VISITANTES si el perfil NO está
  // restringido (regla de producto). El dueño siempre ve su propio banner.
  const showDonationBanner =
    donation?.mode === "general" && donation?.enabled === true && donation?.visible !== false &&
    (isOwner || !profileRestricted);

  // Synchronous cache snapshot — used for lazy state initializers to avoid
  // skeleton flash on re-navigation. Must be computed before any useState.
  const _initCacheKey = getProfileFeedCacheKey({
    profileUid,
    viewerUid,
    isOwner,
    showPosts,
    profileRestricted,
  });
  const _initCacheSnap = (() => {
    const cached = profileFeedMemoryCache.get(_initCacheKey);
    if (!cached || Date.now() - cached.updatedAt > PROFILE_FEED_CACHE_TTL_MS) return null;
    // Same processing-video guard the effect uses
    const hasProcessing = cached.posts.some(isVideoPostStillProcessing);
    if (hasProcessing) return null;
    return cached;
  })();

  const [posts, setPosts] = useState<PostWithFlags[]>(
    () => _initCacheSnap ? _initCacheSnap.posts.filter((p) => !p.isDeleted) : []
  );
  // Sub-subnav de media (Publicaciones/Fotos/Videos/En vivo) + lightbox de galería.
  const [mediaTab, setMediaTab] = useState<MediaTabKey>("feed");
  const [lightboxTile, setLightboxTile] = useState<GalleryTile | null>(null);
  // Desbloqueos de esta sesión (reflejo instantáneo) ∪ postAccess real del viewer
  // (persistente en cualquier dispositivo) — unificados para feed y galerías.
  const [sessionUnlockedIds, setSessionUnlockedIds] = useState<Set<string>>(() => new Set());
  const remoteUnlockedIds = useUnlockedPostIds(viewerUid);
  const unlockedPostIds = useMemo(
    () => new Set<string>([...remoteUnlockedIds, ...sessionUnlockedIds]),
    [remoteUnlockedIds, sessionUnlockedIds],
  );
  // Pestaña previa para la dirección del slide (mismo patrón que Wallet/Perfil).
  const prevMediaTabRef = useRef<MediaTabKey>("feed");
  useEffect(() => {
    prevMediaTabRef.current = mediaTab;
  }, [mediaTab]);
  const [error, setError] = useState<string | null>(null);
  const { toast: feedToast, showToast: showFeedToast } = useVibraToast();
  useEffect(() => { if (error) showFeedToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loadingInitial, setLoadingInitial] = useState<boolean>(() => !_initCacheSnap);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState<boolean>(() => _initCacheSnap?.hasMore ?? false);
  const [pageCursor, setPageCursor] =
    useState<UserProfilePostsPageCursor | null>(() => _initCacheSnap?.cursor ?? null);
  const [isMobile, setIsMobile] = useState(false);
  const [isEmbed, setIsEmbed] = useState(false);
  useEffect(() => {
    try { setIsEmbed(window.self !== window.top); } catch { setIsEmbed(true); }
  }, []);
  const infiniteScrollTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef<boolean>(_initCacheSnap?.hasMore ?? false);
  const pageCursorRef = useRef<UserProfilePostsPageCursor | null>(_initCacheSnap?.cursor ?? null);
  // True when states were already initialized from cache — skip first effect run
  const _cacheInitializedRef = useRef(!!_initCacheSnap);
  const videoProcessingPollsRef = useRef<Record<string, number>>({});
  const feedRequestIdRef = useRef(0);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    pageCursorRef.current = pageCursor;
  }, [pageCursor]);

const cacheKey = useMemo(
  () =>
    getProfileFeedCacheKey({
      profileUid,
      viewerUid,
      isOwner,
      showPosts,
      profileRestricted,
    }),
  [profileUid, viewerUid, isOwner, showPosts, profileRestricted]
);

  const syncPostsState = useCallback(
    (updater: (prev: PostWithFlags[]) => PostWithFlags[]) => {
      setPosts((prev) => {
        const next = updater(prev);

        if (profileUid) {
          profileFeedMemoryCache.set(cacheKey, {
            posts: next,
            cursor: pageCursorRef.current,
            hasMore: hasMoreRef.current,
            updatedAt: Date.now(),
          });
        }

        return next;
      });
    },
    [cacheKey, profileUid]
  );

  useEffect(() => {
    return registerPostFeedCacheListener({
      removePost: (postId) => {
        syncPostsState((prev) => prev.filter((post) => post.id !== postId));
      },
      patchPost: (postId, patch) => {
        syncPostsState((prev) =>
          sortProfileFeedPosts(
            prev
              .map((post) =>
                post.id === postId
                  ? normalizeProfileFeedPost({
                      ...post,
                      ...patch,
                      counts: {
                        ...post.counts,
                        ...patch.counts,
                      },
                    } as PostWithFlags)
                  : post
              )
              .filter((post) => post.isDeleted !== true)
          )
        );
      },
      clear: () => {
        profileFeedMemoryCache.delete(cacheKey);
        setPosts([]);
        setPageCursor(null);
        setHasMore(false);
        pageCursorRef.current = null;
        hasMoreRef.current = false;
      },
    });
  }, [cacheKey, syncPostsState]);

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

  const loadPostsPage = useCallback(
    async (mode: "initial" | "more" | "refresh" = "initial") => {
      if (!profileUid) {
        setPosts([]);
        setPageCursor(null);
        setHasMore(false);
        setLoadingInitial(false);
        setLoadingMore(false);
        return;
      }

      if ((!showPosts || profileRestricted) && !isOwner) {
        setPosts([]);
        setPageCursor(null);
        setHasMore(false);
        setError(null);
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

      const requestId = feedRequestIdRef.current + 1;
      feedRequestIdRef.current = requestId;

      try {
        setError(null);

        const result = await loadFeedWithRetry(
          async () => {
            const pageResult = await fetchUserProfilePostsPage({
              profileUid,
              viewerUid,
              pageSize: PROFILE_FEED_PAGE_SIZE,
              cursor: mode === "more" ? pageCursorRef.current : null,
            });

            const visiblePosts = await filterBannedGroupPosts(
              pageResult.posts,
              viewerUid
            );

            const hydratedPosts = await attachModerationFlags(
              visiblePosts,
              viewerUid
            );

            return {
              ...pageResult,
              posts: hydratedPosts,
            };
          },
          { timeoutMs: mode === "more" ? 15000 : 12000 }
        );

        if (feedRequestIdRef.current !== requestId) {
          return;
        }

        const normalizedPosts = result.posts
          .map(normalizeProfileFeedPost)
          .filter((post) => post.isDeleted !== true);

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
              : sortProfileFeedPosts(normalizedPosts);

          profileFeedMemoryCache.set(cacheKey, {
            posts: nextPosts,
            cursor: nextCursor,
            hasMore: nextHasMore,
            updatedAt: Date.now(),
          });

          return nextPosts;
        });
      } catch (e: unknown) {
        if (feedRequestIdRef.current !== requestId) {
          return;
        }

        // Corte por tiempo: no es un error del usuario ni tiene acción posible.
        // Se silencia (ver isFeedLoadTimeout).
        if (isFeedLoadTimeout(e)) {
          setError(null);
        } else {
          setError(
            (e instanceof Error ? e.message : null) ??
              tProfile("loadPostsError")
          );
        }
      } finally {
        if (mode === "more") {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        } else {
          setLoadingInitial(false);
        }
      }
    },
    [cacheKey, profileUid, viewerUid, showPosts, profileRestricted, isOwner]
  );

  const loadPosts = useCallback(async () => {
    await loadPostsPage("refresh");
  }, [loadPostsPage]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!profileUid) {
        if (active) {
          setPosts([]);
          setPageCursor(null);
          setHasMore(false);
          setLoadingInitial(false);
        }
        return;
      }

      if ((!showPosts || profileRestricted) && !isOwner) {
        if (active) {
          setPosts([]);
          setPageCursor(null);
          setHasMore(false);
          setLoadingInitial(false);
          setError(null);
        }
        return;
      }

      const cached = profileFeedMemoryCache.get(cacheKey);
      const cacheIsFresh =
        !!cached && Date.now() - cached.updatedAt <= PROFILE_FEED_CACHE_TTL_MS;

      const cacheHasProcessingVideos =
        cached?.posts.some(isVideoPostStillProcessing) === true;

      // States already hydrated via lazy initializer — skip redundant setState calls
      if (_cacheInitializedRef.current && cacheIsFresh && !cacheHasProcessingVideos) {
        _cacheInitializedRef.current = false;
        // Refs already set at declaration — nothing more to do
        return;
      }
      _cacheInitializedRef.current = false;

      if (cacheIsFresh && !cacheHasProcessingVideos) {
        setPosts(cached.posts.filter((post) => post.isDeleted !== true));
        setPageCursor(cached.cursor);
        setHasMore(cached.hasMore);
        pageCursorRef.current = cached.cursor;
        hasMoreRef.current = cached.hasMore;
        setLoadingInitial(false);
        return;
      }

      if (active) {
        await loadPostsPage("initial");
      }
    }

    run();

    return () => {
      active = false;
    };
 }, [
  profileUid,
  viewerUid,
  showPosts,
  profileRestricted,
  isOwner,
  cacheKey,
  loadPostsPage,
]);

  // ── Búsqueda dentro del perfil ────────────────────────────────────────────
  const searchTokens = useMemo(
    () => normalizeForSearch(searchQuery.trim()).split(/\s+/).filter(Boolean),
    [searchQuery]
  );
  const searchActive = searchTokens.length > 0;
  const searchKey = searchTokens.join(" ");

  const renderPosts = useMemo(
    () =>
      searchActive ? posts.filter((post) => postMatchesQuery(post, searchTokens)) : posts,
    [posts, searchActive, searchTokens]
  );

  // Al buscar, auto-cargamos páginas (con tope) para que el filtro cubra más
  // publicaciones, no solo las ya visibles.
  const searchAutoPagesRef = useRef(0);
  useEffect(() => {
    searchAutoPagesRef.current = 0;
  }, [searchKey]);
  useEffect(() => {
    if (!searchActive) return;
    if (!hasMore || loadingMore || loadingInitial) return;
    if (searchAutoPagesRef.current >= SEARCH_MAX_AUTO_PAGES) return;
    searchAutoPagesRef.current += 1;
    void loadPostsPage("more");
  }, [searchActive, searchKey, hasMore, loadingMore, loadingInitial, loadPostsPage]);

  const infiniteScrollTriggerIndex = useMemo(() => {
    if (renderPosts.length <= 5) return renderPosts.length - 1;
    return Math.max(0, renderPosts.length - 5);
  }, [renderPosts.length]);


  const processingVideoPostIdsKey = useMemo(() => {
    return posts
      .filter(isVideoPostStillProcessing)
      .map((post) => post.id)
      .filter((postId): postId is string => Boolean(postId))
      .sort()
      .join("|");
  }, [posts]);

  useEffect(() => {
    if (!profileUid) return;
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

            const freshPost = normalizeProfileFeedPost({
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
  }, [profileUid, processingVideoPostIdsKey, syncPostsState]);

  useEffect(() => {
    if (!profileUid) return;
    if (!hasMore) return;
    if (loadingInitial) return;
    if (!showPosts && !isOwner) return;

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
  profileUid,
  hasMore,
  loadingInitial,
  showPosts,
  profileRestricted,
  isOwner,
  infiniteScrollTriggerIndex,
  loadPostsPage,
  // Reobservar el target al volver del panel de galería (se remonta el subárbol).
  mediaTab,
]);

  async function handleToggleFlame(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await togglePostFlame(postId);

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
  
async function handleToggleProfilePin(postId: string): Promise<void> {
  if (!isOwner) {
    throw new Error(tProfile("pinOwnProfileOnly"));
  }

  try {
    setError(null);

    const result = await toggleProfilePostPin(postId);
    const profilePinnedAt = result.isPinnedOnProfile ? Timestamp.now() : null;
    const profilePinnedBy = result.isPinnedOnProfile ? viewerUid : null;

    patchPostInAllFeedCaches(postId, {
      isPinnedOnProfile: result.isPinnedOnProfile,
      profilePinnedAt,
      profilePinnedBy,
    });
  } catch (e: unknown) {
    setError(
      (e instanceof Error ? e.message : null) ?? tProfile("pinError")
    );
    throw e;
  }
}

  async function handleToggleSave(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await togglePostSave(postId);
      let nextSaves = 0;

      syncPostsState((prev) => {
        const targetPost = prev.find((post) => post.id === postId);
        const currentSaves = targetPost?.counts?.saves ?? 0;
        nextSaves = Math.max(0, currentSaves + result.delta);
        return prev;
      });

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
      setError((e instanceof Error ? e.message : null) ?? t("generalError"));
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? t("generalError"));
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
      return await syncPostCommentsCount(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? t("generalError"));
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
      setError((e instanceof Error ? e.message : null) ?? t("generalError"));
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
      setError((e instanceof Error ? e.message : null) ?? tPosts("errorCreateReply"));
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
  marginInlineStart: "auto",
  marginInlineEnd: "auto",
  marginTop: 0,
  marginBottom: 18,
  paddingTop: 0,
  overflowX: "hidden",
};

  const headerStyle: CSSProperties = useMemo(
    () => ({
      display: "grid",
      gap: 4,
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      paddingInlineStart: isMobile ? 8 : 0,
      paddingInlineEnd: isMobile ? 8 : 0,
      boxSizing: "border-box",
    }),
    [isMobile]
  );

  const noticeStyle: CSSProperties = useMemo(
    () => ({
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      boxSizing: "border-box",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.03)",
      padding: "12px 14px",
      fontSize: 13,
      fontWeight: 300,
      lineHeight: 1.45,
      color: "rgba(255,255,255,0.82)",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      marginInlineStart: 0,
      marginInlineEnd: 0,
    }),
    []
  );

  const reservedStyle: CSSProperties = useMemo(
    () => ({
      ...noticeStyle,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.05)",
      padding: "18px 16px",
      textAlign: "center",
      fontSize: 14,
      fontWeight: 500,
      color: "#fff",
    }),
    [noticeStyle]
  );

  const titleStyle: CSSProperties = {
    margin: 0,
    maxWidth: "100%",
    minWidth: 0,
    fontSize: "clamp(16px, 2vw, 18px)",
    fontWeight: 600,
    lineHeight: 1.1,
    color: "#fff",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const subtitleStyle: CSSProperties = {
    margin: 0,
    maxWidth: "100%",
    minWidth: 0,
    fontSize: 12,
    color: "rgba(255,255,255,0.60)",
    lineHeight: 1.4,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const postItemStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  const endOfFeedStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    textAlign: "center",
    padding: "4px 14px",
    marginTop: 22,
    marginBottom: 28,
    fontSize: 13,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.5)",
  };

  const recommendationWrapperStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  // Semilla estable durante la sesión: al cargar más posts los slots ya mostrados
  // no se recalculan, así el rail no salta de altura.
  const railSeed = useMemo(() => getFeedRailSeed(), []);

  const recommendationSlots = useMemo(() => {
    if (!viewerUid || posts.length === 0) {
      return new Set<number>();
    }
    return buildRandomRecommendationSlots(posts.length, railSeed);
  }, [viewerUid, posts.length, railSeed]);

  // Orden de cada rail dentro del feed, para que no repita contenido.
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

  // Reserva de altura (galería más alta) para que el slide no salte de altura.
  // Se llama ANTES del early return de abajo para no romper el orden de hooks.
  const { contentRef: mediaSlideRef, minHeight: mediaSlideMinHeight } =
    useMediaSlideReservedHeight(!searchActive && !isEmbed && mediaTab !== "feed");

  if ((!showPosts || profileRestricted) && !isOwner) {
    return (
      <section style={shellStyle}>
        <div style={reservedStyle}>{tProfile("profileReservedLabel")}</div>
      </section>
    );
  }

  // Sub-subnav de media: fuera de búsqueda y de contextos embed.
  const showMediaTabs = !searchActive && !isEmbed;
  const effectiveMediaTab: MediaTabKey = showMediaTabs ? mediaTab : "feed";
  const canDeleteLightboxPost = lightboxTile
    ? viewerUid === lightboxTile.post.authorId
    : false;

  const prevMediaTab = prevMediaTabRef.current;
  const mediaSlideDir =
    prevMediaTab === effectiveMediaTab
      ? 0
      : MEDIA_TAB_ORDER[effectiveMediaTab] > MEDIA_TAB_ORDER[prevMediaTab]
        ? 1
        : -1;

  return (
    <section style={shellStyle}>
      <VibraToast toast={feedToast} />

      {showMediaTabs && (
        <PostsMediaSubnav active={mediaTab} onChange={setMediaTab} />
      )}

      <div style={{ overflow: "hidden", width: "100%", minWidth: 0, minHeight: mediaSlideMinHeight }}>
      <motion.div
        ref={mediaSlideRef}
        key={effectiveMediaTab}
        initial={{ x: mediaSlideDir > 0 ? "100%" : mediaSlideDir < 0 ? "-100%" : 0 }}
        animate={{ x: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.9 }}
        style={{ width: "100%", minWidth: 0 }}
      >

      {effectiveMediaTab !== "feed" ? (
        <MediaGallery
          source={{ type: "profile", profileUid }}
          kind={effectiveMediaTab}
          viewerUid={viewerUid}
          unlockedPostIds={unlockedPostIds}
          onOpenTile={(tile) => {
            const openUrl = tile.mediaUrl ?? tile.post.media?.[0]?.url ?? null;
            // Los tiles de live (transmisión/VOD) y los bloqueados siempre abren:
            // el card resuelve el VOD, el modal en vivo o el flujo de desbloqueo.
            // El contenido de pago YA desbloqueado también abre sin URL: la trae
            // el card desde el subdocumento protegido (ver useProtectedPlayback).
            if (!tile.isLive && !tile.isLocked && !tile.isPremiumUnlocked && !openUrl) return;
            setLightboxTile(tile);
          }}
        />
      ) : (
      <>

      {/* Donaciones: parte del panel de Publicaciones, debajo del sub-subnav. */}
      {showDonationBanner && (
        <div style={postItemStyle} data-cover-donation-banner="true">
          <DonationFeedBanner
            message={donation?.message ?? null}
            playbackId={donation?.playbackId ?? null}
            creatorName={donationCreatorName ?? null}
            profilePhoto={donationProfilePhoto ?? null}
            profileHandle={donationProfileHandle ?? null}
            donationMode={donation?.mode ?? null}
            expanded={donationViewerOpen}
            onClick={onDonate}
            onClose={onDonationClose}
            onDonate={onDonationPay}
            suggestedAmounts={donation?.suggestedAmounts ?? null}
            currency={donation?.currency ?? null}
            creatorId={profileUid}
            buyerId={viewerUid}
          />
        </div>
      )}

      {loadingInitial && renderPosts.length === 0 && <PostSkeletonList count={4} />}

      {!loadingInitial && !searchActive && posts.length === 0 && viewerUid && !isEmbed && (
        <div style={recommendationWrapperStyle}>
          <GroupRecommendationsRail
            currentUserId={viewerUid}
            context="profile"
            suppressOnboarding
          />
        </div>
      )}

      {!loadingInitial && !searchActive && posts.length === 0 && !viewerUid && (
        <div style={noticeStyle}>
          {tProfile("noPostsVisible")}
        </div>
      )}

      {/* Búsqueda sin coincidencias (cuando ya terminó de auto-cargar). */}
      {searchActive &&
        !loadingInitial &&
        !loadingMore &&
        !hasMore &&
        renderPosts.length === 0 && (
          <div style={noticeStyle}>{t("noExactMatches")}</div>
        )}

      {renderPosts.map((post, index) => {
        const canDeletePost =
          viewerUid === post.authorId || post.canModerateGroupAuthor === true;

        const shouldRenderRecommendations =
          !searchActive && recommendationSlots.has(index + 1);
        const shouldAttachInfiniteScrollTarget =
          !searchActive && hasMore && index === infiniteScrollTriggerIndex;

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

            <PostReveal>
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
              onToggleProfilePin={isOwner ? handleToggleProfilePin : undefined}
              currentUserId={viewerUid}
              isOwner={isOwner && viewerUid === post.authorId}
              isModerator={post.canModerateGroupAuthor === true}
              showGroupContext={true}
              canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              onModerationComplete={loadPosts}
              canCommentOnPosts={!post.groupId ? (isOwner || commentsEnabled) : undefined}
              forceUnlocked={unlockedPostIds.has(post.id)}
              onPostUnlocked={(id) =>
                setSessionUnlockedIds((prev) => new Set(prev).add(id))
              }
            />
            </PostReveal>

            {shouldRenderRecommendations && viewerUid && !isEmbed && (
              <div style={recommendationWrapperStyle}>
                <GroupRecommendationsRail
                  currentUserId={viewerUid}
                  context="profile"
                  suppressOnboarding
                  railIndex={recommendationSlotIndex.get(index + 1) ?? 0}
                />
              </div>
            )}
          </div>
        );
      })}

      {loadingMore && <PostSkeletonList count={2} />}

      {!searchActive &&
        !loadingInitial &&
        posts.length > 0 &&
        !hasInlineRecommendation &&
        viewerUid &&
        !isEmbed && (
          <div style={recommendationWrapperStyle}>
            <GroupRecommendationsRail
              currentUserId={viewerUid}
              context="profile"
              suppressOnboarding
            />
          </div>
        )}

      {!searchActive && !loadingInitial && !loadingMore && posts.length > 0 && !hasMore && (
        <div style={endOfFeedStyle}>{tProfile("allPostsLoaded")}</div>
      )}

      </>
      )}

      </motion.div>
      </div>

      {/* Lightbox de galería: tarjeta headless (0×0) que solo abre el visor. */}
      {lightboxTile && (
        <div
          aria-hidden="true"
          style={{ position: "fixed", insetInlineStart: 0, top: 0, width: 0, height: 0, overflow: "hidden" }}
        >
          <GroupPostCard
            post={lightboxTile.post}
            canDelete={canDeleteLightboxPost}
            onDelete={canDeleteLightboxPost ? handleDeletePost : undefined}
            onLoadComments={handleLoadComments}
            onCreateComment={handleCreateComment}
            onDeleteComment={handleDeleteComment}
            onLoadReplies={handleLoadReplies}
            onCreateReply={handleCreateReply}
            onDeleteReply={handleDeleteReply}
            onToggleFlame={handleToggleFlame}
            onToggleSave={handleToggleSave}
            onToggleProfilePin={isOwner ? handleToggleProfilePin : undefined}
            currentUserId={viewerUid}
            isOwner={isOwner && viewerUid === lightboxTile.post.authorId}
            showGroupContext={true}
            canCommentOnPosts={
              !lightboxTile.post.groupId ? isOwner || commentsEnabled : undefined
            }
            autoOpenMediaUrl={
              lightboxTile.mediaUrl ?? lightboxTile.post.media?.[0]?.url ?? null
            }
            autoOpenLive={lightboxTile.isLiveNow}
            // Un VOD bloqueado NO abre el visor: va al flujo de compra
            // (`autoOpenUnlock`), igual que una foto o un video de pago.
            autoOpenVod={lightboxTile.isLive && !lightboxTile.isLiveNow && !lightboxTile.isLocked}
            autoOpenUnlock={lightboxTile.isLocked}
            forceUnlocked={lightboxTile.isPremiumUnlocked}
            onPostUnlocked={(id) =>
              setSessionUnlockedIds((prev) => new Set(prev).add(id))
            }
            onViewerClosed={() => setLightboxTile(null)}
          />
        </div>
      )}
    </section>
  );
}