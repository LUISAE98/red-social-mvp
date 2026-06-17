"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { User } from "firebase/auth";
import type { Comment, CommentReply, Post } from "@/lib/posts/types";
import { searchPosts } from "@/lib/posts/searchPosts";
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

const MIN_POST_SEARCH_LENGTH = 2;
const SEARCH_POSTS_PAGE_SIZE = 20;

type SearchPostsResultsProps = {
  fontStack: string;
  search: string;
  currentUser: User | null;
  onNavigate: (href: string) => void;
};

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: unknown;
};

function getStartOfDayMs(dateValue: string): number | null {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T00:00:00`);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function getEndOfDayMs(dateValue: string): number | null {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T23:59:59.999`);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

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

export default function SearchPostsResults({
  fontStack,
  search,
  currentUser,
}: SearchPostsResultsProps) {
  const userId = currentUser?.uid ?? null;

  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [mobileRefreshEnabled, setMobileRefreshEnabled] = useState(false);

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [draftFromDate, setDraftFromDate] = useState("");
  const [draftToDate, setDraftToDate] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtersPanelRef = useRef<HTMLDivElement | null>(null);

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
    function handleClickOutside(event: MouseEvent) {
      if (!filtersPanelRef.current) return;
      if (!filtersPanelRef.current.contains(event.target as Node)) {
        setIsFiltersOpen(false);
      }
    }

    if (isFiltersOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFiltersOpen]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (normalizedSearch.length < MIN_POST_SEARCH_LENGTH) {
        setPosts([]);
        setLoading(false);
        setError(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const fromMs = getStartOfDayMs(fromDate);
        const toMs = getEndOfDayMs(toDate);

        const result = await searchPosts({
          search: normalizedSearch,
          pageSize: SEARCH_POSTS_PAGE_SIZE,
          fromDate: fromMs !== null ? new Date(fromMs) : null,
          toDate: toMs !== null ? new Date(toMs) : null,
          viewerId: userId,
        });

        if (!active) return;

        setPosts(
          result.posts
            .map((post) => normalizeSearchPost(post as PostWithFlags))
            .filter((post) => post.isDeleted !== true)
        );
      } catch (e: unknown) {
        if (!active) return;
        console.error("searchPosts error completo:", e);
        setError((e instanceof Error ? e.message : null) ?? "Error");
      } finally {
        if (active) setLoading(false);
      }
    }

    run();

    return () => {
      active = false;
    };
  }, [normalizedSearch, userId, fromDate, toDate, refreshNonce]);

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
      setError((e instanceof Error ? e.message : null) ?? "No se pudo actualizar el guardado.");
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

  function clearDateFilters() {
    setDraftFromDate("");
    setDraftToDate("");
    setFromDate("");
    setToDate("");
  }

  function applyDateFilters() {
    setFromDate(draftFromDate);
    setToDate(draftToDate);
    setIsFiltersOpen(false);
  }

  const filteredPosts = posts.filter((post) => post.isDeleted !== true);
  const hasResults = filteredPosts.length > 0;
  const visiblePosts = filteredPosts;

  const activeFilters = [
    ...(fromDate
      ? [
          {
            key: "fromDate",
            label: `Desde: ${fromDate}`,
            onRemove: () => {
              setDraftFromDate("");
              setFromDate("");
            },
          },
        ]
      : []),
    ...(toDate
      ? [
          {
            key: "toDate",
            label: `Hasta: ${toDate}`,
            onRemove: () => {
              setDraftToDate("");
              setToDate("");
            },
          },
        ]
      : []),
  ];

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

  const topBarStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
    position: "relative",
    marginBottom: -10,
    zIndex: 80,
  };

  const activeFiltersWrapStyle: CSSProperties = {
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "0 2px",
  };

  const activeFilterPillStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    padding: "5px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const activeFilterRemoveStyle: CSSProperties = {
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.72)",
    cursor: "pointer",
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
  };

  const filtersButtonStyle: CSSProperties = {
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(10,10,10,0.92)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12.5,
    fontFamily: fontStack,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
    transform: "translateY(-12px)",
    position: "relative",
    zIndex: 30,
  };

  const filtersPanelStyle: CSSProperties = {
    position: "absolute",
    top: 44,
    right: 0,
    width: 280,
    maxWidth: "calc(100vw - 24px)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(10,10,10,0.98)",
    boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
    padding: 12,
    display: "grid",
    gap: 12,
    zIndex: 20,
    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
  };

  const filterBlockStyle: CSSProperties = {
    display: "grid",
    gap: 8,
  };

  const filterBlockTitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.52)",
  };

  const dateFieldWrapStyle: CSSProperties = {
    display: "grid",
    gap: 6,
  };

  const dateLabelStyle: CSSProperties = {
    fontSize: 12,
    color: "rgba(255,255,255,0.74)",
    fontWeight: 600,
  };

  const dateInputStyle: CSSProperties = {
    width: "100%",
    minHeight: 38,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 13,
    fontFamily: fontStack,
    outline: "none",
  };

  const filterActionsRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    paddingTop: 4,
  };

  const filterActionSecondaryStyle: CSSProperties = {
    flex: 1,
    minHeight: 34,
    padding: "7px 10px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: fontStack,
  };

  const filterActionPrimaryStyle: CSSProperties = {
    ...filterActionSecondaryStyle,
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.20)",
  };

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "15px 16px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.45,
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
        <div>Buscando publicaciones...</div>
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
        <div>Escribe algo para buscar</div>
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
      <div style={topBarStyle} className="search-posts-topbar">
        <div style={activeFiltersWrapStyle}>
          {activeFilters.length > 0
            ? activeFilters.map((filter) => (
                <span key={filter.key} style={activeFilterPillStyle}>
                  {filter.label}
                  <button
                    type="button"
                    style={activeFilterRemoveStyle}
                    onClick={filter.onRemove}
                    aria-label={`Quitar filtro ${filter.label}`}
                  >
                    ×
                  </button>
                </span>
              ))
            : null}
        </div>

        <div ref={filtersPanelRef} className="search-posts-filters-anchor">
          <button
            type="button"
            style={filtersButtonStyle}
            onClick={() => setIsFiltersOpen((prev) => !prev)}
          >
            <span aria-hidden="true">🧮</span>
            Filtros
          </button>

          {isFiltersOpen && (
            <div style={filtersPanelStyle} className="search-posts-filters-panel">
              <div style={filterBlockStyle}>
                <p style={filterBlockTitleStyle}>Fecha</p>

                <div style={dateFieldWrapStyle}>
                  <label htmlFor="posts-filter-from" style={dateLabelStyle}>
                    Desde
                  </label>
                  <input
                    id="posts-filter-from"
                    type="date"
                    value={draftFromDate}
                    onChange={(e) => setDraftFromDate(e.target.value)}
                    style={dateInputStyle}
                    max={draftToDate || undefined}
                  />
                </div>

                <div style={dateFieldWrapStyle}>
                  <label htmlFor="posts-filter-to" style={dateLabelStyle}>
                    Hasta
                  </label>
                  <input
                    id="posts-filter-to"
                    type="date"
                    value={draftToDate}
                    onChange={(e) => setDraftToDate(e.target.value)}
                    style={dateInputStyle}
                    min={draftFromDate || undefined}
                  />
                </div>
              </div>

              <div style={filterActionsRowStyle}>
                <button
                  type="button"
                  style={filterActionSecondaryStyle}
                  onClick={clearDateFilters}
                >
                  Limpiar
                </button>

                <button
                  type="button"
                  style={filterActionPrimaryStyle}
                  onClick={applyDateFilters}
                >
                  Listo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!hasResults ? (
        <div style={emptyStyle}>No se encontraron coincidencias exactas.</div>
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

      <style jsx>{`
        .search-posts-filters-anchor {
          position: relative;
        }

        @media (max-width: 768px) {
          .search-posts-topbar {
            grid-template-columns: minmax(0, 1fr) auto !important;
            align-items: center !important;
            gap: 8px !important;
          }

          .search-posts-filters-anchor {
            width: auto;
          }

          .search-posts-filters-anchor button {
            width: auto;
            justify-content: center;
          }

          .search-posts-filters-panel {
            position: absolute !important;
            top: 40px !important;
            right: 0 !important;
            width: 280px !important;
            max-width: calc(100vw - 24px) !important;
            margin-top: 0 !important;
          }
        }
      `}</style>
      </section>
    </RefreshableArea>
  );
}
