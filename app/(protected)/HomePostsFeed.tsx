//HomePostsFeed.tsx
"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";

import type { Comment, CommentReply, Post } from "@/lib/posts/types";
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
import { buildRandomRecommendationSlots } from "@/app/components/GroupRecommendations/recommendation-engine";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";

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

function buildStableFeedSeed(
  currentUserId: string,
  posts: Array<{ id?: string; createdAt?: { toMillis: () => number } | null }>
): number {
  const raw = [
    currentUserId,
    ...posts.map((post, index) => {
      const createdAtValue =
        typeof post?.createdAt?.toMillis === "function"
          ? String(post.createdAt.toMillis())
          : typeof post?.createdAt === "number"
          ? String(post.createdAt)
          : typeof post?.createdAt === "string"
          ? post.createdAt
          : String(index);

      return `${post.id ?? index}-${createdAtValue}`;
    }),
  ].join("|");

  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }

  return hash || 1;
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
export default function HomePostsFeed({ currentUserId, refreshRef }: HomePostsFeedProps) {
  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pageCursor, setPageCursor] = useState<HomePostsPageCursor | null>(null);
  const [, setIsMobile] = useState(false);
  const infiniteScrollTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const pageCursorRef = useRef<HomePostsPageCursor | null>(null);
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
      },
      patchPost: (postId, patch) => {
        syncPostsState((prev) =>
          prev.map((post) =>
            post.id === postId
              ? normalizeHomeFeedPost({
                  ...post,
                  ...patch,
                  counts: {
                    ...post.counts,
                    ...patch.counts,
                  },
                } as PostWithFlags)
              : post
          )
        );
      },
      clear: () => {
        if (currentUserId) {
          homeFeedMemoryCache.delete(getHomeFeedCacheKey(currentUserId));
        }

        setPosts([]);
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

        const normalizedPosts = result.posts
          .map((post) => normalizeHomeFeedPost(post as PostWithFlags))
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
            "No se pudieron cargar las publicaciones. Intenta de nuevo."
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

      patchPostInAllFeedCaches(postId, {
        viewerHasFlamed: result.liked,
        counts: {
          likes: result.likes,
        } as Post["counts"],
      });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "No se pudo actualizar la flamita.");
      throw e;
    }
  }

  async function handleToggleSave(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await togglePostSave(postId);

      const targetPost = posts.find((post) => post.id === postId);
      const currentSaves = targetPost?.counts?.saves ?? 0;
      const nextSaves = Math.max(0, currentSaves + result.delta);

      patchPostInAllFeedCaches(postId, {
        viewerHasSaved: result.saved,
        counts: {
          saves: nextSaves,
        } as Post["counts"],
      });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "No se pudo actualizar el guardado.");
      throw e;
    }
  }

  async function handleDeletePost(postId: string) {
    try {
      setError(null);
      await softDeletePost(postId);

      removePostFromAllFeedCaches(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "Error desconocido");
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "Error desconocido");
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
    text: string
  ): Promise<Comment[]> {
    try {
      setError(null);
      await createPostComment({ postId, text });
      return await syncPostCommentsCount(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "Error desconocido");
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
      setError((e instanceof Error ? e.message : null) ?? "Error desconocido");
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
      setError((e instanceof Error ? e.message : null) ?? "No se pudieron cargar las respuestas.");
      throw e;
    }
  }

  async function handleCreateReply(
    postId: string,
    commentId: string,
    text: string
  ): Promise<CommentReply[]> {
    try {
      setError(null);
      await createPostCommentReply({ postId, commentId, text });

      await syncPostCommentsCount(postId);

      return await fetchCommentReplies({ postId, commentId });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "No se pudo crear la respuesta.");
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
      setError((e instanceof Error ? e.message : null) ?? "No se pudo eliminar la respuesta.");
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

  const recommendationSlots = useMemo(() => {
    if (!currentUserId || posts.length === 0) {
      return new Set<number>();
    }

    const seed = buildStableFeedSeed(currentUserId, posts);
    return buildRandomRecommendationSlots(posts.length, seed);
  }, [currentUserId, posts]);

  const hasInlineRecommendation = useMemo(() => {
    return recommendationSlots.size > 0;
  }, [recommendationSlots]);

  if (!currentUserId) {
    return (
      <section style={shellStyle}>
        <div style={noticeStyle}>
          Inicia sesión para ver publicaciones de tus comunidades.
        </div>
      </section>
    );
  }

return (
  <section style={shellStyle}>
    {error && <div style={noticeStyle}>{error}</div>}

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
          Cargando publicaciones...
        </span>
      </div>
    )}

    {!loadingInitial && posts.length === 0 && (
      <div style={recommendationWrapperStyle}>
        <GroupRecommendationsRail
          currentUserId={currentUserId}
          context="home"
        />
      </div>
    )}

    {posts.map((post, index) => {
      const canDeletePost =
        currentUserId === post.authorId ||
        post.canModerateGroupAuthor === true;

      const shouldRenderRecommendations = recommendationSlots.has(index + 1);
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
          />

          {shouldRenderRecommendations && (
            <div style={recommendationWrapperStyle}>
              <GroupRecommendationsRail
                currentUserId={currentUserId}
                context="home"
              />
            </div>
          )}
        </div>
      );
    })}

    {loadingMore && (
      <div style={noticeStyle}>Cargando más publicaciones...</div>
    )}

    {!loadingInitial && !loadingMore && posts.length > 0 && !hasMore && (
      <div style={noticeStyle}>Ya viste todas las publicaciones disponibles.</div>
    )}

    {!loadingInitial && posts.length > 0 && !hasInlineRecommendation && (
      <div style={recommendationWrapperStyle}>
        <GroupRecommendationsRail
          currentUserId={currentUserId}
          context="home"
        />
      </div>
    )}
  </section>
);
}
