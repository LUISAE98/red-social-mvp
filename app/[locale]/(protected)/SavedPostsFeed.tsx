//SavedPostsFeed.tsx
"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnlockedPostIds } from "@/lib/posts/useUnlockedPostIds";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Comment, CommentImage, CommentMention, CommentReply, Post } from "@/lib/posts/types";
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
import { PostSkeletonList } from "@/app/components/PostSkeleton/PostSkeleton";
import PostReveal from "@/app/components/PostSkeleton/PostReveal";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import { motion } from "framer-motion";
import PostsMediaSubnav, { MEDIA_TAB_ORDER, type MediaTabKey } from "@/app/groups/[groupId]/components/posts/PostsMediaSubnav";
import MediaGallery, { clearMediaGalleryCache, type GalleryTile } from "@/app/groups/[groupId]/components/posts/MediaGallery";
import {
  SAVED_POSTS_CACHE_TTL_MS,
  SAVED_POSTS_PAGE_SIZE,
  VIDEO_PROCESSING_MAX_POLLS,
  VIDEO_PROCESSING_POLL_MS,
  isVideoPostStillProcessing,
  mergeUniquePosts,
  normalizeSavedFeedPost,
  savedPostsMemoryCache,
  type PostWithFlags,
} from "./SavedPostsFeed.helpers";

export default function SavedPostsFeed() {
  const tSaved = useTranslations("saved");
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );
  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [pageCursor, setPageCursor] = useState<SavedPostsPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast: feedToast, showToast: showFeedToast } = useVibraToast();
  useEffect(() => { if (error) showFeedToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  // Sub-subnav de media (Publicaciones/Fotos/Videos/En vivo) + lightbox de galería.
  const [mediaTab, setMediaTab] = useState<MediaTabKey>("feed");
  const [lightboxTile, setLightboxTile] = useState<GalleryTile | null>(null);
  // Desbloqueos de esta sesión (reflejo instantáneo) ∪ postAccess real del viewer
  // (persistente en cualquier dispositivo) — unificados para feed y galerías.
  const [sessionUnlockedIds, setSessionUnlockedIds] = useState<Set<string>>(() => new Set());
  const remoteUnlockedIds = useUnlockedPostIds(currentUserId);
  const unlockedPostIds = useMemo(
    () => new Set<string>([...remoteUnlockedIds, ...sessionUnlockedIds]),
    [remoteUnlockedIds, sessionUnlockedIds],
  );
  // Pestaña previa, para la dirección del slide (mismo patrón que perfil/comunidad).
  const prevMediaTabRef = useRef<MediaTabKey>("feed");
  useEffect(() => {
    prevMediaTabRef.current = mediaTab;
  }, [mediaTab]);


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
            tSaved("loadError")
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
  clearMediaGalleryCache();
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
      setError((e instanceof Error ? e.message : null) ?? tSaved("flameError"));
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
      setError((e instanceof Error ? e.message : null) ?? tSaved("saveError"));
      throw e;
    }
  }

  async function handleDeletePost(postId: string) {
    try {
      setError(null);
      await softDeletePost(postId);

      removePostFromAllFeedCaches(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tSaved("deletePostError"));
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tSaved("commentsError"));
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
      setError((e instanceof Error ? e.message : null) ?? tSaved("commentCreateError"));
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
      setError((e instanceof Error ? e.message : null) ?? tSaved("commentDeleteError"));
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
      setError((e instanceof Error ? e.message : null) ?? tSaved("repliesError"));
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
      setError((e instanceof Error ? e.message : null) ?? tSaved("replyCreateError"));
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
      setError((e instanceof Error ? e.message : null) ?? tSaved("replyDeleteError"));
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

  // Cabecera fija (título + subnav): se queda pegada justo debajo del header del
  // layout mientras el contenido scrollea por detrás. Va FUERA del <section>
  // porque su `overflowX: hidden` convierte al section en contenedor de scroll y
  // rompería el `position: sticky`. El offset replica la convención del layout:
  // en móvil, bajo el backdrop opaco (safe-area + 56px); en escritorio, la misma
  // altura que usa `.sidebarCol` (safe-area + 90px). Fondo negro sólido para
  // tapar el contenido y que NO se vea por detrás del título/subnav.
  const stickyHeadStyle: CSSProperties = {
    position: "sticky",
    top: isMobile
      ? "calc(env(safe-area-inset-top, 0px) + 56px)"
      : "calc(env(safe-area-inset-top, 0px) + 90px)",
    zIndex: 3,
    width: "100%",
    maxWidth: 720,
    minWidth: 0,
    marginLeft: "auto",
    marginRight: "auto",
    boxSizing: "border-box",
    background: "#000",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingTop: 8,
  };

  // Tapa negra de la franja superior: en escritorio el header del layout es
  // transparente, así que sin esto el feed se vería subiendo por detrás del
  // header (por encima del subnav fijo). Se ancla al borde superior de la
  // cabecera fija y se extiende hacia arriba hasta el tope de la ventana,
  // cubriendo exactamente la altura del header (misma que usa el offset sticky).
  // En móvil NO se renderiza: el layout ya pinta ahí su backdrop negro opaco.
  const topCoverStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "100%",
    height: "calc(env(safe-area-inset-top, 0px) + 90px)",
    background: "#000",
    pointerEvents: "none",
  };

  // Desvanecido bajo el subnav: el contenido que sube se difumina (negro →
  // transparente) antes de quedar totalmente oculto por la cabecera. Se ancla al
  // borde inferior de la cabecera fija y se traslada hacia abajo para solaparse
  // con el inicio del contenido.
  const stickyFadeStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    transform: "translateY(100%)",
    height: 20,
    background: "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0) 100%)",
    pointerEvents: "none",
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

  // Estilo de campo/placeholder canónico de Vibra (vibra_style.md → "Textarea"):
  // fondo rgba(255,255,255,0.06), sin borde, radio 12, fontSize 13, fontFamily
  // inherit. El color del placeholder lo deja el navegador por defecto.
  // Estilo de campo/placeholder canónico de Vibra (vibra_style.md → "Textarea").
  // La lupa va DENTRO (izquierda) → paddingLeft deja espacio para ella; el
  // paddingRight se amplía en el render cuando aparece el botón × de limpiar.
  const searchInputStyle: CSSProperties = {
    width: "100%",
    minWidth: 0,
    height: 38,
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    paddingLeft: 12,
    paddingRight: 38,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
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
            <h2 style={titleStyle}>{tSaved("title")}</h2>
          </div>
          <p style={subtitleStyle}>{tSaved("loginToView")}</p>
        </div>

        <div style={noticeStyle}>{tSaved("loginRequired")}</div>
      </section>
    );
  }

  // Sub-subnav de media: se oculta al buscar (igual que perfil/comunidad).
  const showMediaTabs = !activeSearch;
  const effectiveMediaTab: MediaTabKey = showMediaTabs ? mediaTab : "feed";
  const canDeleteLightboxPost = lightboxTile
    ? currentUserId === lightboxTile.post.authorId
    : false;
  const prevMediaTab = prevMediaTabRef.current;
  const mediaSlideDir =
    prevMediaTab === effectiveMediaTab
      ? 0
      : MEDIA_TAB_ORDER[effectiveMediaTab] > MEDIA_TAB_ORDER[prevMediaTab]
        ? 1
        : -1;

return (
  <RefreshableArea onRefresh={handleSavedPullRefresh}>
    {/* Cabecera fija: título + subnav se quedan pegados bajo el header del
        layout; el contenido se desvanece al pasar por debajo. Fuera del
        <section> a propósito (su overflowX:hidden rompería el sticky). */}
    <div style={stickyHeadStyle}>
      {!isMobile && <div aria-hidden="true" style={topCoverStyle} />}

      <div style={headerStyle}>
        <div style={titleRowStyle}>
          <h2 style={titleStyle}>{tSaved("title")}</h2>
        </div>
      </div>

      {showMediaTabs && (
        <PostsMediaSubnav active={mediaTab} onChange={setMediaTab} />
      )}

      <div aria-hidden="true" style={stickyFadeStyle} />
    </div>

    <section style={shellStyle}>
      <VibraToast toast={feedToast} />

      <div style={{ overflow: "hidden", width: "100%", minWidth: 0 }}>
      <motion.div
        key={effectiveMediaTab}
        initial={{ x: mediaSlideDir > 0 ? "100%" : mediaSlideDir < 0 ? "-100%" : 0 }}
        animate={{ x: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.9 }}
        style={{ width: "100%", minWidth: 0 }}
      >

      {effectiveMediaTab !== "feed" ? (
        <MediaGallery
          source={{ type: "saved", userUid: currentUserId }}
          kind={effectiveMediaTab}
          viewerUid={currentUserId}
          unlockedPostIds={unlockedPostIds}
          onOpenTile={(tile) => {
            const openUrl = tile.mediaUrl ?? tile.post.media?.[0]?.url ?? null;
            // Los tiles de live y los bloqueados siempre abren (el card resuelve el
            // VOD, el modal en vivo o el flujo de desbloqueo).
            if (!tile.isLive && !tile.isLocked && !openUrl) return;
            setLightboxTile(tile);
          }}
        />
      ) : (
      <>

      <form
        style={searchFormStyle}
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmitSearch();
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={tSaved("searchPlaceholder")}
            style={{ ...searchInputStyle, paddingRight: activeSearch ? 62 : 38 }}
            aria-label={tSaved("searchPlaceholder")}
          />

          {/* Limpiar (×): a la izquierda de la lupa, solo con búsqueda activa. */}
          {activeSearch ? (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label={tSaved("clearSearch")}
              title={tSaved("clearSearch")}
              style={{
                position: "absolute",
                right: 36,
                top: "50%",
                transform: "translateY(-50%)",
                width: 24,
                height: 24,
                border: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.55)",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                fontSize: 18,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          ) : null}

          {/* Lupa: dispara la búsqueda (submit). Con Enter o clic. Siempre visible. */}
          <button
            type="submit"
            aria-label={tSaved("search")}
            title={tSaved("search")}
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              width: 26,
              height: 26,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              padding: 0,
            }}
          >
            <VibraNavigationIcon type="search" size={18} strokeWidth={2.2} />
          </button>
        </div>
      </form>

      {loadingInitial && posts.length === 0 && <PostSkeletonList count={4} />}

      {!loadingInitial && posts.length === 0 && (
        <div style={noticeStyle}>{tSaved("empty")}</div>
      )}

      {!loadingInitial && posts.length > 0 && visiblePosts.length === 0 && (
        <div style={noticeStyle}>
          {tSaved("noSearchResults")}
        </div>
      )}

      {visiblePosts.map((post) => {
        const canDeletePost =
          currentUserId === post.authorId ||
          post.canModerateGroupAuthor === true;

        return (
          <div key={post.id} style={postItemStyle}>
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
              currentUserId={currentUserId}
              isOwner={false}
              isModerator={post.canModerateGroupAuthor === true}
              showGroupContext={true}
              canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              onModerationComplete={refreshPosts}
              forceUnlocked={unlockedPostIds.has(post.id)}
              onPostUnlocked={(id) =>
                setSessionUnlockedIds((prev) => new Set(prev).add(id))
              }
            />
            </PostReveal>
          </div>
        );
      })}

      <div ref={loadMoreTriggerRef} style={{ width: "100%", height: 1 }} />

      {loadingMore && <PostSkeletonList count={2} />}

      {!loadingInitial && !loadingMore && posts.length > 0 && !hasMore && (
        <div style={endOfFeedStyle}>{tSaved("allLoaded")}</div>
      )}

      </>
      )}

      </motion.div>
      </div>

      {/* Lightbox de galería: tarjeta headless (0×0) que solo abre el visor. */}
      {lightboxTile && (
        <div
          aria-hidden="true"
          style={{ position: "fixed", left: 0, top: 0, width: 0, height: 0, overflow: "hidden" }}
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
            currentUserId={currentUserId}
            isOwner={false}
            showGroupContext={true}
            onModerationComplete={refreshPosts}
            autoOpenMediaUrl={
              lightboxTile.mediaUrl ?? lightboxTile.post.media?.[0]?.url ?? null
            }
            autoOpenLive={lightboxTile.isLiveNow}
            autoOpenVod={lightboxTile.isLive && !lightboxTile.isLiveNow}
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
  </RefreshableArea>
  );
}