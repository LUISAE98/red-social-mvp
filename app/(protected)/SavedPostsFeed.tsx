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

const SAVED_POSTS_PAGE_SIZE = 10;
const SAVED_POSTS_CACHE_TTL_MS = 5 * 60 * 1000;

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;
type GroupRole = "owner" | "mod" | "member" | null;

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: any;
};

type SavedPostsCacheEntry = {
  posts: PostWithFlags[];
  cursor: SavedPostsPageCursor | null;
  hasMore: boolean;
  timestamp: number;
};

const savedPostsMemoryCache = new Map<string, SavedPostsCacheEntry>();

function mergeUniquePosts(currentPosts: PostWithFlags[], nextPosts: PostWithFlags[]) {
  return Array.from(
    new Map([...currentPosts, ...nextPosts].map((post) => [post.id, post])).values()
  );
}

function normalizeRole(raw: unknown): GroupRole {
  if (raw === "owner") return "owner";
  if (raw === "mod") return "mod";
  if (raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

function normalizeStatus(raw: unknown): MemberStatus {
  if (raw === "banned") return "banned";
  if (raw === "muted") return "muted";
  if (raw === "removed" || raw === "kicked" || raw === "expelled") {
    return "removed";
  }
  if (raw === "active") return "active";
  return "active";
}

async function getMembershipMetaForGroup(
  groupId: string,
  userId: string
): Promise<{
  status: MemberStatus;
  mutedUntil: any | null;
  role: GroupRole;
}> {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      return { status: null, mutedUntil: null, role: null };
    }

    const data = memberSnap.data() as any;

    return {
      status: normalizeStatus(data?.status),
      mutedUntil: data?.mutedUntil ?? null,
      role: normalizeRole(data?.roleInGroup ?? data?.role),
    };
  } catch {
    return { status: null, mutedUntil: null, role: null };
  }
}

async function getViewerCanModerateGroup(
  groupId: string,
  currentUserId: string
): Promise<boolean> {
  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    if (!groupSnap.exists()) return false;

    const groupData = groupSnap.data() as any;
    if (groupData?.ownerId === currentUserId) {
      return true;
    }

    const viewerMeta = await getMembershipMetaForGroup(groupId, currentUserId);

    return (
      viewerMeta.role === "mod" &&
      viewerMeta.status !== "banned" &&
      viewerMeta.status !== "removed"
    );
  } catch {
    return false;
  }
}

async function attachModerationFlags(
  posts: Post[],
  currentUserId: string
): Promise<PostWithFlags[]> {
  if (!posts.length) return posts as PostWithFlags[];

  const uniqueGroupIds = Array.from(
    new Set(
      posts
        .map((post) => post.groupId)
        .filter(
          (groupId): groupId is string =>
            typeof groupId === "string" && groupId.trim().length > 0
        )
    )
  );

  const moderationEntries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const canModerate = await getViewerCanModerateGroup(groupId, currentUserId);
      return [groupId, canModerate] as const;
    })
  );

  const moderationMap = new Map<string, boolean>(moderationEntries);

  const authorPairs = Array.from(
    new Set(
      posts
        .filter(
          (post) =>
            typeof post.groupId === "string" &&
            post.groupId.trim().length > 0 &&
            typeof post.authorId === "string" &&
            post.authorId.trim().length > 0
        )
        .map((post) => `${post.groupId}__${post.authorId}`)
    )
  );

  const authorEntries = await Promise.all(
    authorPairs.map(async (pairKey) => {
      const separatorIndex = pairKey.indexOf("__");
      const groupId = pairKey.slice(0, separatorIndex);
      const authorId = pairKey.slice(separatorIndex + 2);
      const meta = await getMembershipMetaForGroup(groupId, authorId);
      return [pairKey, meta] as const;
    })
  );

  const authorMap = new Map<
    string,
    { status: MemberStatus; mutedUntil: any | null; role: GroupRole }
  >(authorEntries);

  return posts.map((post) => {
    const groupId =
      typeof post.groupId === "string" && post.groupId.trim().length > 0
        ? post.groupId
        : null;

    const authorId =
      typeof post.authorId === "string" && post.authorId.trim().length > 0
        ? post.authorId
        : null;

    const authorMeta =
      groupId && authorId ? authorMap.get(`${groupId}__${authorId}`) : null;

    return {
      ...post,
      canModerateGroupAuthor: !!groupId && moderationMap.get(groupId) === true,
      authorMemberStatus: authorMeta?.status ?? null,
      authorMutedUntil: authorMeta?.mutedUntil ?? null,
    };
  });
}

function normalizeSavedFeedPost(post: PostWithFlags): PostWithFlags {
  return {
    ...post,
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

  const loadPostsPage = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (!currentUserId) {
        syncPostsState([]);
        setPageCursor(null);
        setHasMore(false);
        return;
      }

      if (loadingMoreRef.current) return;

      const nextCursor = reset ? null : pageCursor;

      if (!reset && !hasMore) {
        return;
      }

      loadingMoreRef.current = true;

      if (reset) {
        setLoadingInitial(true);
      } else {
        setLoadingMore(true);
      }

      try {
        setError(null);

        const page = await fetchSavedPostsPage({
          userUid: currentUserId,
          pageSize: SAVED_POSTS_PAGE_SIZE,
          cursor: nextCursor,
        });

        const hydratedPosts = await attachModerationFlags(page.posts, currentUserId);
        const normalizedPosts = hydratedPosts.map(normalizeSavedFeedPost);

        setPosts((currentPosts) => {
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
      } catch (e: any) {
        setError(e?.message ?? "No se pudieron cargar tus publicaciones guardadas.");
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

      if (cacheIsFresh) {
        setPosts(cache.posts);
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

    observer.observe(trigger);

    return () => observer.disconnect();
  }, [currentUserId, hasMore, loadingInitial, loadPostsPage]);

  async function handleToggleFlame(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await togglePostFlame(postId);

      syncPostsState((prev) =>
        prev.map((post) =>
          post.id === postId
            ? {
                ...post,
                viewerHasFlamed: result.liked,
                counts: {
                  ...post.counts,
                  likes: result.likes,
                },
              }
            : post
        )
      );
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar la flamita.");
      throw e;
    }
  }

  async function handleToggleSave(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await togglePostSave(postId);

      syncPostsState((prev) =>
        prev
          .map((post) => {
            if (post.id !== postId) {
              return post;
            }

            const currentSaves = post.counts?.saves ?? 0;
            const nextSaves = Math.max(0, currentSaves + result.delta);

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
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el guardado.");
      throw e;
    }
  }

  async function handleDeletePost(postId: string) {
    try {
      setError(null);
      await softDeletePost(postId);

      syncPostsState((prev) => prev.filter((post) => post.id !== postId));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar la publicación.");
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar los comentarios.");
      throw e;
    }
  }

  async function syncPostCommentsCount(postId: string) {
    const comments = await fetchPostComments(postId);

    const repliesCounts = await Promise.all(
      comments.map(async (comment) => {
        try {
          const replies = await fetchCommentReplies({
            postId,
            commentId: comment.id,
          });

          return replies.length;
        } catch {
          return comment.counts?.replies ?? 0;
        }
      })
    );

    const total =
      comments.length + repliesCounts.reduce((sum, count) => sum + count, 0);

    syncPostsState((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              counts: {
                ...post.counts,
                comments: total,
              },
            }
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
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear el comentario.");
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
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar el comentario.");
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
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar las respuestas.");
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
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear la respuesta.");
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
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar la respuesta.");
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
    maxWidth: "100%",
    minWidth: 0,
    display: "grid",
    gap: 12,
    marginBottom: 18,
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

  const visiblePosts = activeSearch
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
    <section style={shellStyle}>
      <div style={headerStyle}>
        <div style={titleRowStyle}>
          <h2 style={titleStyle}>Guardados</h2>
        </div>

        <p style={subtitleStyle}>Publicaciones que guardaste con 🔖.</p>
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

      {loadingInitial && (
        <div style={noticeStyle}>Cargando publicaciones guardadas...</div>
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
  );
}