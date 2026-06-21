//SavedPostsFeed.tsx
"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Comment, CommentReply, Post } from "@/lib/posts/types";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchPostComments,
  fetchSavedPostsPage,
  softDeletePost,
  togglePostFlame,
  togglePostSave,
  type SavedPostsPageCursor,
} from "@/lib/posts/post-service";

import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";

const SAVED_POSTS_PAGE_SIZE = 10;
const SAVED_POSTS_CACHE_TTL_MS = 5 * 60 * 1000;
const VIDEO_PROCESSING_POLL_MS = 15_000;
const VIDEO_PROCESSING_MAX_POLLS = 20;

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: unknown;
};

type SavedPostsCacheEntry = {
  posts: PostWithFlags[];
  cursor: SavedPostsPageCursor | null;
  hasMore: boolean;
  timestamp: number;
};

const savedPostsMemoryCache = new Map<string, SavedPostsCacheEntry>();

function mergeUniquePosts(currentPosts: PostWithFlags[], nextPosts: PostWithFlags[]) {
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

function normalizeSavedFeedPost(post: PostWithFlags): PostWithFlags {
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
    viewerHasSaved: post.viewerHasSaved ?? true,
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

export default function SavedPostsFeed() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );
  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [pageCursor, setPageCursor] = useState<SavedPostsPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");


  const loadingMoreRef = useRef(false);
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
  const videoProcessingPollsRef = useRef<Record<string, number>>({});
  const feedRequestIdRef = useRef(0);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setCurrentUserId(user?.uid ?? null);
    });

    return () => unsub();
  }, []);

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

const syncPostsState = useCallback(
  (
    updater:
      | PostWithFlags[]
      | ((currentPosts: PostWithFlags[]) => PostWithFlags[])
  ) => {
    setPosts((currentPosts) => {
      const nextPosts =
        typeof updater === "function" ? updater(currentPosts) : updater;

      if (currentUserId) {
        const cacheKey = currentUserId;
        const existingCache = savedPostsMemoryCache.get(cacheKey);

        savedPostsMemoryCache.set(cacheKey, {
          posts: nextPosts,
          cursor: existingCache?.cursor ?? pageCursor,
          hasMore: existingCache?.hasMore ?? hasMore,
          timestamp: Date.now(),
        });
      }

      return nextPosts;
    });
  },
  [currentUserId, hasMore, pageCursor]
);

  useEffect(() => {
    return registerPostFeedCacheListener({
      removePost: (postId) => {
        syncPostsState((prev) => prev.filter((post) => post.id !== postId));
      },
      patchPost: (postId, patch) => {
        syncPostsState((prev) =>
          prev
            .map((post) =>
              post.id === postId
                ? normalizeSavedFeedPost({
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
        );
      },
      clear: () => {
        if (currentUserId) {
          savedPostsMemoryCache.delete(currentUserId);
        }

        setPosts([]);
        setPageCursor(null);
        setHasMore(false);
      },
    });
  }, [currentUserId, syncPostsState]);

  const loadPostsPage = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (!currentUserId) {
        syncPostsState([]);
        setPageCursor(null);
        setHasMore(false);
        setLoadingInitial(false);
        setLoadingMore(false);
        return;
      }

      if (loadingMoreRef.current) return;

      const nextCursor = reset ? null : pageCursor;

      if (!reset && !hasMore) {
        return;
      }

      const requestId = feedRequestIdRef.current + 1;
      feedRequestIdRef.current = requestId;

      loadingMoreRef.current = true;

      if (reset) {
        setLoadingInitial(true);
      } else {
        setLoadingMore(true);
      }

      try {
        setError(null);

        const page = await loadFeedWithRetry(
          () =>
            fetchSavedPostsPage({
              userUid: currentUserId,
              pageSize: SAVED_POSTS_PAGE_SIZE,
              cursor: nextCursor,
            }),
          { timeoutMs: reset ? 20000 : 25000 }
        );

        if (feedRequestIdRef.current !== requestId) {
          return;
        }

        const normalizedPosts = page.posts
          .map(normalizeSavedFeedPost)
          .filter((post) => post.isDeleted !== true);

        syncPostsState((currentPosts) => {
          const nextPosts = reset
            ? normalizedPosts
            : mergeUniquePosts(currentPosts, normalizedPosts);

          savedPostsMemoryCache.set(currentUserId, {
            posts: nextPosts,
            cursor: page.cursor,
            hasMore: page.hasMore,
            timestamp: Date.now(),
          });

          return nextPosts;
        });

        setPageCursor(page.cursor);
        setHasMore(page.hasMore);
      } catch (e: unknown) {
        if (feedRequestIdRef.current !== requestId) {
          return;
        }

        setError(
          (e instanceof Error ? e.message : null) ??
            "No se pudieron cargar tus publicaciones guardadas. Intenta de nuevo."
        );
      } finally {
        loadingMoreRef.current = false;
        setLoadingInitial(false);
        setLoadingMore(false);
      }
    },
    [currentUserId, hasMore, pageCursor, syncPostsState]
  );

  const refreshPosts = useCallback(async () => {
    if (!currentUserId) return;

    savedPostsMemoryCache.delete(currentUserId);

    await loadPostsPage({ reset: true });
  }, [currentUserId, loadPostsPage]);

  const handleSavedPullRefresh = useCallback(async () => {
  await refreshPosts();
}, [refreshPosts]);

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

      const cache = savedPostsMemoryCache.get(currentUserId);
      const cacheIsFresh =
        cache && Date.now() - cache.timestamp < SAVED_POSTS_CACHE_TTL_MS;

      const cacheHasProcessingVideos =
        cache?.posts.some(isVideoPostStillProcessing) === true;

      if (cacheIsFresh && !cacheHasProcessingVideos) {
        setPosts(cache.posts.filter((post) => post.isDeleted !== true));
        setPageCursor(cache.cursor);
        setHasMore(cache.hasMore);
        setLoadingInitial(false);
        return;
      }

      await loadPostsPage({ reset: true });
    }

    run();

    return () => {
      active = false;
    };
  }, [currentUserId, loadPostsPage]);


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

            const freshPost = normalizeSavedFeedPost({
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
    const trigger = loadMoreTriggerRef.current;

    if (!trigger || !currentUserId || loadingInitial || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];

        if (firstEntry?.isIntersecting && !loadingMoreRef.current) {
          loadPostsPage({ reset: false });
        }
      },
      {
        root: null,
        rootMargin: "900px 0px",
        threshold: 0,
      }
    );
if (!trigger.isConnected) return;
    observer.observe(trigger);

    return () => observer.disconnect();
  }, [currentUserId, hasMore, loadingInitial, loadPostsPage]);

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
      let nextSaves = 0;

      syncPostsState((prev) =>
        prev
          .map((post) => {
            if (post.id !== postId) {
              return post;
            }

            const currentSaves = post.counts?.saves ?? 0;
            nextSaves = Math.max(0, currentSaves + result.delta);

            return {
              ...post,
              viewerHasSaved: result.saved,
              counts: {
                ...post.counts,
                saves: nextSaves,
              },
            };
          })
          .filter((post) => post.viewerHasSaved === true)
      );

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
      setError((e instanceof Error ? e.message : null) ?? "No se pudo eliminar la publicación.");
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "No se pudieron cargar los comentarios.");
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
      setError((e instanceof Error ? e.message : null) ?? "No se pudo crear el comentario.");
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
      setError((e instanceof Error ? e.message : null) ?? "No se pudo eliminar el comentario.");
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

  function handleSubmitSearch() {
    setActiveSearch(searchInput.trim().toLowerCase());
  }

  function handleClearSearch() {
    setSearchInput("");
    setActiveSearch("");
  }

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  minWidth: 0,
  display: "grid",
  gap: 12,
  marginLeft: "auto",
  marginRight: "auto",
  marginTop: 0,
  marginBottom: 18,
  paddingTop: 0,
  overflowX: "hidden",
};

  const headerStyle: CSSProperties = useMemo(
    () => ({
      display: "grid",
      gap: 6,
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      paddingLeft: isMobile ? 14 : 0,
      paddingRight: isMobile ? 14 : 0,
      boxSizing: "border-box",
    }),
    [isMobile]
  );

  const titleRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minWidth: 0,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    maxWidth: "100%",
    minWidth: 0,
    fontSize: "clamp(18px, 2.2vw, 20px)",
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
    lineHeight: 1.45,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
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

  const searchFormStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    paddingLeft: isMobile ? 14 : 0,
    paddingRight: isMobile ? 14 : 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
  };

  const searchInputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    padding: "0 14px",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const searchButtonStyle: CSSProperties = {
    width: 38,
    height: 38,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    flexShrink: 0,
    fontSize: 16,
  };

  const clearSearchButtonStyle: CSSProperties = {
    ...searchButtonStyle,
    fontSize: 14,
  };

  const postItemStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

const visiblePosts = useMemo(() => {
  return activeSearch
    ? posts.filter((post) => {
        const haystack = [
          post.text,
          post.authorName,
          post.authorUsername,
          post.groupName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(activeSearch);
      })
    : posts;
}, [activeSearch, posts]);

  if (!currentUserId) {
    return (
      <section style={shellStyle}>
        <div style={headerStyle}>
          <div style={titleRowStyle}>
            <h2 style={titleStyle}>Guardados</h2>
          </div>
          <p style={subtitleStyle}>Inicia sesión para ver tus publicaciones guardadas.</p>
        </div>

        <div style={noticeStyle}>Debes iniciar sesión para ver esta sección.</div>
      </section>
    );
  }

return (
  <RefreshableArea onRefresh={handleSavedPullRefresh}>
    <section style={shellStyle}>
      <div style={headerStyle}>
        <div style={titleRowStyle}>
          <h2 style={titleStyle}>Guardados</h2>
        </div>
      </div>

      <form
        style={searchFormStyle}
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmitSearch();
        }}
      >
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Buscar en guardados"
          style={searchInputStyle}
          aria-label="Buscar en guardados"
        />

        {activeSearch ? (
          <button
            type="button"
            onClick={handleClearSearch}
            style={clearSearchButtonStyle}
            aria-label="Limpiar búsqueda"
            title="Limpiar búsqueda"
          >
            ×
          </button>
        ) : null}

        <button
          type="submit"
          style={searchButtonStyle}
          aria-label="Buscar"
          title="Buscar"
        >
          🔎
        </button>
      </form>

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
            Cargando guardados...
          </span>
        </div>
      )}

      {!loadingInitial && posts.length === 0 && (
        <div style={noticeStyle}>Todavía no tienes publicaciones guardadas.</div>
      )}

      {!loadingInitial && posts.length > 0 && visiblePosts.length === 0 && (
        <div style={noticeStyle}>
          No se encontraron guardados para esta búsqueda.
        </div>
      )}

      {visiblePosts.map((post) => {
        const canDeletePost =
          currentUserId === post.authorId ||
          post.canModerateGroupAuthor === true;

        return (
          <div key={post.id} style={postItemStyle}>
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
              isModerator={post.canModerateGroupAuthor === true}
              showGroupContext={true}
              canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              onModerationComplete={refreshPosts}
            />
          </div>
        );
      })}

      <div ref={loadMoreTriggerRef} style={{ width: "100%", height: 1 }} />

      {loadingMore && (
        <div style={noticeStyle}>Cargando más publicaciones guardadas...</div>
      )}

      {!loadingInitial && !loadingMore && posts.length > 0 && !hasMore && (
        <div style={noticeStyle}>Ya viste todas tus publicaciones guardadas.</div>
      )}
    </section>
  </RefreshableArea>
  );
}