"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import type { User } from "firebase/auth";
import type { Comment, CommentReply, Post } from "@/lib/posts/types";
import { searchPosts } from "@/lib/posts/searchPosts";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchPostComments,
  softDeletePost,
  togglePostFlame,
  togglePostSave,
} from "@/lib/posts/post-service";

import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { useTranslations } from "next-intl";

const MIN_POST_SEARCH_LENGTH = 2;
const SEARCH_POSTS_PAGE_SIZE = 20;

// Filtro multi-select de posts. "all" = sin filtro.
export type PostsSearchFilter =
  | "all"
  | "live"
  | "vod"
  | "premium"
  | "free"
  | "video"
  | "scheduled";

type SearchPostsResultsProps = {
  fontStack: string;
  search: string;
  currentUser: User | null;
  onNavigate: (href: string) => void;
  // Post seleccionado desde el preview → se muestra primero en la lista.
  pinnedPostId?: string | null;
  filter?: PostsSearchFilter[];
  // Rango de fechas (YYYY-MM-DD). Vacío = sin filtro de fecha.
  fromDate?: string;
  toDate?: string;
};

// Detección del tipo de post para el filtro (mismo criterio que los badges).
function postMatchesFilter(post: Post, filters: PostsSearchFilter[]): boolean {
  const active = filters.filter((f) => f !== "all");
  if (active.length === 0) return true;

  const liveStatus = post.liveData?.status ?? null;
  const isLive = post.postType === "live" && liveStatus === "live";
  const isVod = post.postType === "live" && liveStatus === "ended";
  const isScheduled =
    post.postType === "scheduled_event" ||
    (post.postType === "live" &&
      (liveStatus === "scheduled" || liveStatus === "upcoming"));
  const isVideo = post.postType === "video";
  const isPremium =
    post.requiresPayment === true ||
    post.requiresSubscription === true ||
    post.accessModel === "one_time_purchase" ||
    post.access === "paid";

  const contentSel = active.filter(
    (f) => f === "live" || f === "vod" || f === "video" || f === "scheduled"
  );
  if (contentSel.length) {
    const ok =
      (contentSel.includes("live") && isLive) ||
      (contentSel.includes("vod") && isVod) ||
      (contentSel.includes("video") && isVideo) ||
      (contentSel.includes("scheduled") && isScheduled);
    if (!ok) return false;
  }

  // Acceso: premium / gratis (OR entre ellos si ambos están activos).
  const accessSel = active.filter((f) => f === "premium" || f === "free");
  if (accessSel.length) {
    const ok =
      (accessSel.includes("premium") && isPremium) ||
      (accessSel.includes("free") && !isPremium);
    if (!ok) return false;
  }

  return true;
}

function dayStartMs(value?: string): number | null {
  if (!value) return null;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function dayEndMs(value?: string): number | null {
  if (!value) return null;
  const ms = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: unknown;
};

function normalizeSearchPost(post: PostWithFlags): PostWithFlags {
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

// Cache module-level de resultados por búsqueda (+ filtros): sobrevive a
// desmontajes (cambios de pestaña) para no recargar. Se limpia al recargar la página.
const postsResultCache = new Map<string, PostWithFlags[]>();
function postsCacheKey(
  search: string,
  uid: string | null,
  from: string | undefined,
  to: string | undefined
): string {
  return `${search}::${uid ?? ""}::${from ?? ""}::${to ?? ""}`;
}

export default function SearchPostsResults({
  fontStack,
  search,
  currentUser,
  pinnedPostId,
  filter,
  fromDate,
  toDate,
}: SearchPostsResultsProps) {
  const tCommon = useTranslations("common");
  const tPosts = useTranslations("posts");
  const userId = currentUser?.uid ?? null;

  const [posts, setPosts] = useState<PostWithFlags[]>(
    () =>
      postsResultCache.get(
        postsCacheKey(search.trim().toLowerCase(), currentUser?.uid ?? null, fromDate, toDate)
      ) ?? []
  );
  const [pinnedPost, setPinnedPost] = useState<PostWithFlags | null>(null);
  const [loading, setLoading] = useState(() => {
    const key = postsCacheKey(search.trim().toLowerCase(), currentUser?.uid ?? null, fromDate, toDate);
    return search.trim().length >= MIN_POST_SEARCH_LENGTH && !postsResultCache.has(key);
  });
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [mobileRefreshEnabled, setMobileRefreshEnabled] = useState(false);

  const normalizedSearch = useMemo(() => search.trim().toLowerCase(), [search]);
    const handlePostsPullRefresh = useCallback(async () => {
    setRefreshNonce((prev) => prev + 1);
  }, []);

  const syncPostsState = useCallback(
    (updater: (prev: PostWithFlags[]) => PostWithFlags[]) => {
      setPosts((prev) => updater(prev));
    },
    []
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
                ? normalizeSearchPost({
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
        setPosts([]);
      },
    });
  }, [syncPostsState]);

    useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");

    const syncMobileRefresh = () => {
      setMobileRefreshEnabled(mediaQuery.matches);
    };

    syncMobileRefresh();

    mediaQuery.addEventListener("change", syncMobileRefresh);

    return () => {
      mediaQuery.removeEventListener("change", syncMobileRefresh);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function run() {
      if (normalizedSearch.length < MIN_POST_SEARCH_LENGTH) {
        setPosts([]);
        setLoading(false);
        setError(null);
        return;
      }

      const cacheKey = postsCacheKey(normalizedSearch, userId, fromDate, toDate);
      // Refresh manual (pull-to-refresh): invalida el cache de esta búsqueda.
      if (refreshNonce > 0) postsResultCache.delete(cacheKey);
      const cached = postsResultCache.get(cacheKey);
      if (cached) {
        setPosts(cached);
        setLoading(false);
        setError(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const fromMs = dayStartMs(fromDate);
        const toMs = dayEndMs(toDate);

        const result = await searchPosts({
          search: normalizedSearch,
          pageSize: SEARCH_POSTS_PAGE_SIZE,
          fromDate: fromMs !== null ? new Date(fromMs) : null,
          toDate: toMs !== null ? new Date(toMs) : null,
          viewerId: userId,
        });

        if (!active) return;

        const normalized = result.posts
          .map((post) => normalizeSearchPost(post as PostWithFlags))
          .filter((post) => post.isDeleted !== true);
        postsResultCache.set(cacheKey, normalized);
        setPosts(normalized);
      } catch (e: unknown) {
        if (!active) return;
        console.error("searchPosts error completo:", e);
        setError((e instanceof Error ? e.message : null) ?? tCommon("loadError"));
      } finally {
        if (active) setLoading(false);
      }
    }

    run();

    return () => {
      active = false;
    };
  }, [normalizedSearch, userId, fromDate, toDate, refreshNonce]);

  // Post seleccionado desde el preview: se trae por id y se muestra primero.
  useEffect(() => {
    let active = true;

    async function loadPinned() {
      if (!pinnedPostId) {
        setPinnedPost(null);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "posts", pinnedPostId));
        if (!active) return;
        if (!snap.exists()) {
          setPinnedPost(null);
          return;
        }
        const data = { id: snap.id, ...(snap.data() as object) } as PostWithFlags;
        if (data.isDeleted === true) {
          setPinnedPost(null);
          return;
        }
        setPinnedPost(normalizeSearchPost(data));
      } catch (e) {
        console.error("pinned post fetch error:", e);
        if (active) setPinnedPost(null);
      }
    }

    loadPinned();

    return () => {
      active = false;
    };
  }, [pinnedPostId, refreshNonce]);

  async function handleDeletePost(postId: string) {
    try {
      setError(null);
      await softDeletePost(postId);
      removePostFromAllFeedCaches(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tCommon("generalError"));
      throw e;
    }
  }

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
      setError((e instanceof Error ? e.message : null) ?? tPosts("errorFlame"));
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
      setError((e instanceof Error ? e.message : null) ?? tCommon("generalError"));
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    return await fetchPostComments(postId);
  }

  async function handleCreateComment(postId: string, text: string) {
    await createPostComment({ postId, text });

    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              counts: {
                ...post.counts,
                comments: (post.counts?.comments ?? 0) + 1,
              },
            }
          : post
      )
    );

    return await fetchPostComments(postId);
  }

  async function handleDeleteComment(postId: string, commentId: string) {
    await deletePostComment({ postId, commentId });
    const comments = await fetchPostComments(postId);

    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              counts: {
                ...post.counts,
                comments: Math.max(0, post.counts?.comments ?? 0),
              },
            }
          : post
      )
    );

    return comments;
  }

  async function handleLoadReplies(
    postId: string,
    commentId: string
  ): Promise<CommentReply[]> {
    return await fetchCommentReplies({ postId, commentId });
  }

  async function handleCreateReply(
    postId: string,
    commentId: string,
    text: string
  ): Promise<CommentReply[]> {
    await createPostCommentReply({ postId, commentId, text });

    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              counts: {
                ...post.counts,
                comments: (post.counts?.comments ?? 0) + 1,
              },
            }
          : post
      )
    );

    return await fetchCommentReplies({ postId, commentId });
  }

  async function handleDeleteReply(
    postId: string,
    commentId: string,
    replyId: string
  ): Promise<CommentReply[]> {
    await deletePostCommentReply({ postId, commentId, replyId });

    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              counts: {
                ...post.counts,
                comments: Math.max(0, (post.counts?.comments ?? 0) - 1),
              },
            }
          : post
      )
    );

    return await fetchCommentReplies({ postId, commentId });
  }

  const filteredPosts = posts.filter((post) => post.isDeleted !== true);
  // El post fijado (seleccionado en el preview) va primero y siempre visible,
  // sin importar el filtro; el resto se filtra por tipo.
  const base = pinnedPost
    ? filteredPosts.filter((p) => p.id !== pinnedPost.id)
    : filteredPosts;
  const matched = base.filter((p) => postMatchesFilter(p, filter ?? []));
  const visiblePosts = pinnedPost ? [pinnedPost, ...matched] : matched;
  const hasResults = visiblePosts.length > 0;

  const shellStyle: CSSProperties = {
    width: "100%",
    maxWidth: 720,
    minWidth: 0,
    display: "grid",
    gap: 6,
    marginLeft: "auto",
    marginRight: "auto",
    marginBottom: 18,
    marginTop: -16,
    overflowX: "hidden",
  };

  // Sin resultados: solo texto, centrado en la pantalla, sin contenedor.
  const noResultsStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    minHeight: "45vh",
    padding: "0 24px",
    color: "rgba(255,255,255,0.55)",
    fontSize: 15,
    lineHeight: 1.5,
  };

  const postItemStyle: CSSProperties = {
    width: "100%",
    maxWidth: 720,
    minWidth: 0,
    marginLeft: "auto",
    marginRight: "auto",
    overflowX: "hidden",
  };

  if (loading) {
    return (
      <RefreshableArea
        onRefresh={handlePostsPullRefresh}
        enabled={mobileRefreshEnabled}
        indicatorTop="calc(env(safe-area-inset-top) + 116px)"
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            minHeight: "40vh",
          }}
        >
          <div className="vibraPullRefreshSpinner refreshing" style={{ width: 32, height: 32 }} />
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.32)", letterSpacing: "0.01em" }}>
            {tCommon("searchingPosts")}
          </span>
        </div>
      </RefreshableArea>
    );
  }

  if (error) {
    return (
      <RefreshableArea
        onRefresh={handlePostsPullRefresh}
        enabled={mobileRefreshEnabled}
        indicatorTop="calc(env(safe-area-inset-top) + 116px)"
      >
        <div>{error}</div>
      </RefreshableArea>
    );
  }

  if (!normalizedSearch) {
    return (
      <RefreshableArea
        onRefresh={handlePostsPullRefresh}
        enabled={mobileRefreshEnabled}
        indicatorTop="calc(env(safe-area-inset-top) + 116px)"
      >
        <div>{tCommon("writeToSearch")}</div>
      </RefreshableArea>
    );
  }

  return (
    <RefreshableArea
      onRefresh={handlePostsPullRefresh}
      enabled={mobileRefreshEnabled}
      indicatorTop="calc(env(safe-area-inset-top) + 116px)"
    >
      <section style={shellStyle}>

      {!hasResults ? (
        <div style={noResultsStyle}>{tCommon("noExactMatches")}</div>
      ) : (
        visiblePosts.map((post) => {
          const canDelete = userId === post.authorId;

          return (
            <div key={post.id} style={postItemStyle}>
              <GroupPostCard
                post={post}
                canDelete={canDelete}
                onDelete={canDelete ? handleDeletePost : undefined}
                onLoadComments={handleLoadComments}
                onCreateComment={handleCreateComment}
                onDeleteComment={handleDeleteComment}
                onLoadReplies={handleLoadReplies}
                onCreateReply={handleCreateReply}
                onDeleteReply={handleDeleteReply}
                onToggleFlame={handleToggleFlame}
                onToggleSave={handleToggleSave}
                currentUserId={userId}
                isOwner={false}
                isModerator={false}
                showGroupContext={true}
                canModerateGroupAuthor={false}
              />
            </div>
          );
        })
      )}

      </section>
    </RefreshableArea>
  );
}
