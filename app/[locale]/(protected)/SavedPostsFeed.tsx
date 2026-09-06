//SavedPostsFeed.tsx
"use client";

import type { CSSProperties } from "react";
import { IconButton } from "@/components/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { PostSkeleton, PostSkeletonList } from "@/app/components/PostSkeleton/PostSkeleton";
import PostReveal from "@/app/components/PostSkeleton/PostReveal";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { loadFeedWithRetry, isFeedLoadTimeout } from "@/lib/posts/feed-load-helpers";
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
import { useScreenReady } from "@/lib/useScreenReady";
import {
  claveDeFeed,
  leerFeedPersistido,
  olvidarFeed,
  persistirFeed,
} from "@/lib/cache/feedPersistence";
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
  const tFeed = useTranslations("feed");
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

  // El aviso vive aquí y no en saved/page.tsx: esa es un envoltorio sin estado,
  // y quien sabe cuándo hay algo que enseñar es el feed.
  useScreenReady(!loadingInitial);
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

  // Medición de la cabecera para anclar el subnav fijo y la tapa negra:
  //  - `top`   = altura real del header del layout (posición absoluta del título
  //              en el documento = suma de lo que hay encima; es independiente
  //              del scroll porque el header es sticky y ocupa esa franja).
  //  - `left`/`width` = bordes horizontales de la columna del feed (<section>),
  //              para que la tapa negra fija cubra justo esa columna.
  const titleWrapRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const [headMetrics, setHeadMetrics] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Señal de "cambio de pestaña pendiente": al remontar la nueva pestaña llevamos
  // el scroll al punto donde el subnav queda fijo (no hasta el título).
  const pendingTabScrollRef = useRef(false);

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

  // Mide la cabecera (altura del header + bordes de la columna) y la recalcula
  // en resize / cambios de layout. `top` = pos. absoluta del título en el doc
  // (getBoundingClientRect().top + scrollY), estable frente al scroll.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const measure = () => {
      const sh = shellRef.current;
      if (!sh) return;
      const shRect = sh.getBoundingClientRect();

      // 🚨 SE MIDE EL ALTO DEL HEADER, NO LA POSICION DEL TITULO.
      //
      // Antes era `titulo.getBoundingClientRect().top + scrollY`. Esa cuenta
      // depende del scroll y del transform de RefreshableArea, que es el padre
      // del titulo: en cuanto el navegador devolvia un scroll intermedio —el
      // rebote de iOS, el arrastre de recargar, el momentum— salia un `top`
      // distinto, el subnav pegajoso cambiaba de sitio y la tapa negra de
      // altura. Ese ir y venir es el temblor que se reporto.
      //
      // El alto del header es estable: no lo mueve el scroll, y el header vive
      // fuera de RefreshableArea asi que ningun transform lo toca.
      const header = document.querySelector<HTMLElement>(".header");
      const altoHeader = header
        ? Math.round(header.getBoundingClientRect().height)
        : isMobile
          ? 56
          : 90;

      const next = {
        top: altoHeader,
        left: Math.round(shRect.left),
        width: Math.round(shRect.width),
      };
      // Evita re-render si no cambió (el ResizeObserver también dispara al crecer
      // el contenido, pero estos valores no dependen del alto).
      setHeadMetrics((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width
          ? prev
          : next
      );
    };

    measure();

    const ro = new ResizeObserver(measure);
    if (shellRef.current) ro.observe(shellRef.current);

    // El header decide el `top`, asi que es lo que hay que vigilar. El titulo
    // ya no entra: su alto no interviene y observarlo solo provocaba medidas
    // de mas mientras el feed crecia.
    const header = document.querySelector<HTMLElement>(".header");
    if (header) ro.observe(header);
    window.addEventListener("resize", measure);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isMobile, currentUserId, activeSearch]);

  // Cambio de pestaña del subnav: marca pendiente para reposicionar el scroll.
  const handleMediaTabChange = useCallback(
    (key: MediaTabKey) => {
      if (key === mediaTab) return;
      pendingTabScrollRef.current = true;
      setMediaTab(key);
    },
    [mediaTab]
  );

  // Al cambiar de pestaña, lleva el scroll al punto donde el subnav queda fijo
  // (umbral ≈ alto del bloque del título), NO hasta el título. El contenedor del
  // contenido tiene min-height: 100dvh, así que la página nunca colapsa al
  // remontar la nueva pestaña y el navegador nunca recorta el scroll al título;
  // aquí solo lo afinamos al umbral. Si el usuario estaba por encima del umbral
  // (viendo el título), no lo forzamos hacia abajo.
  useLayoutEffect(() => {
    if (!pendingTabScrollRef.current) return;
    pendingTabScrollRef.current = false;

    const tw = titleWrapRef.current;
    if (!tw) return;

    const threshold = tw.offsetHeight + 12; // +margen del título (10) y holgura
    if (window.scrollY > threshold) window.scrollTo(0, threshold);
  }, [mediaTab]);

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
        persistirFeed(claveDeFeed("guardados", cacheKey), nextPosts);
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
          olvidarFeed(claveDeFeed("guardados", currentUserId));
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
          persistirFeed(claveDeFeed("guardados", currentUserId), nextPosts);

          return nextPosts;
        });

        setPageCursor(page.cursor);
        setHasMore(page.hasMore);
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
              tSaved("loadError")
          );
        }
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
    olvidarFeed(claveDeFeed("guardados", currentUserId));

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

      // Nada en memoria: se mira el disco y se pinta con lo que haya. La
      // consulta sale igual detrás — es la que trae el cursor.
      const persistido = await leerFeedPersistido<PostWithFlags>(
        claveDeFeed("guardados", currentUserId),
        SAVED_POSTS_CACHE_TTL_MS,
        { descartarSi: isVideoPostStillProcessing }
      );

      if (persistido && persistido.length > 0) {
        setPosts(persistido);
        setLoadingInitial(false);
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
      setError((e instanceof Error ? e.message : null) ?? tFeed("errorUpdateFlame"));
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
      setError((e instanceof Error ? e.message : null) ?? tSaved("deletePostError"));
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? tFeed("errorLoadComments"));
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
      gap: 6,
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      paddingInlineStart: isMobile ? 14 : 0,
      paddingInlineEnd: isMobile ? 14 : 0,
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

  // Bloque del título: va en flujo normal y SE VA con el scroll (no fijo). Al
  // subir, entra en la franja del header y queda oculto por la tapa negra.
  const titleWrapStyle: CSSProperties = {
    width: "100%",
    maxWidth: 720,
    minWidth: 0,
    marginInlineStart: "auto",
    marginInlineEnd: "auto",
    boxSizing: "border-box",
    paddingTop: 8,
    marginBottom: 10,
  };

  // Subnav FIJO: es lo único que se queda pegado (sticky) justo debajo del
  // header del layout. Fondo negro sólido → el contenido que sube desaparece
  // SECO (sin difuminado) al pasar por debajo. `headMetrics.top` = altura real
  // del header (medida); si aún no se mide, cae al valor por breakpoint.
  // Va FUERA del <section> porque su `overflowX: hidden` rompería el sticky.
  const stickySubnavStyle: CSSProperties = {
    position: "sticky",
    top: headMetrics ? headMetrics.top : isMobile ? 56 : 90,
    zIndex: 3,
    width: "100%",
    maxWidth: 720,
    minWidth: 0,
    marginInlineStart: "auto",
    marginInlineEnd: "auto",
    boxSizing: "border-box",
    background: "#000",
  };

  // Tapa negra de la franja del header: fija al viewport, cubre exactamente la
  // altura del header (`headMetrics.top`) y el ancho de la columna del feed
  // (`left`/`width` medidos del <section>). Oculta el título y el contenido que
  // suben por detrás del header (transparente en escritorio). Debajo del header
  // del layout (z-index 80) y encima del feed.
  const topCoverStyle: CSSProperties | null = headMetrics
    ? {
        position: "fixed",
        top: 0,
        insetInlineStart: headMetrics.left,
        width: headMetrics.width,
        height: headMetrics.top,
        background: "#000",
        zIndex: 40,
        pointerEvents: "none",
      }
    : null;

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
    paddingInlineStart: isMobile ? 14 : 0,
    paddingInlineEnd: isMobile ? 14 : 0,
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
    paddingInlineStart: 12,
    paddingInlineEnd: 38,
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
            <h2 className="vibra-page-title">{tSaved("title")}</h2>
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
  <>
    {/* Tapa negra fija de la franja del header (cubre lo que sube por detrás del
        header). Fuera de RefreshableArea a propósito: su hijo tiene
        `will-change: transform`, que rompería el `position: fixed`. */}
    {topCoverStyle && <div aria-hidden="true" style={topCoverStyle} />}

  <RefreshableArea onRefresh={handleSavedPullRefresh}>
    {/* Título: en flujo normal → SE VA con el scroll. Fuera del <section>
        (su overflowX:hidden convertiría a la sección en scroller y rompería el
        sticky del subnav que va debajo). */}
    <div ref={titleWrapRef} style={titleWrapStyle}>
      <div style={headerStyle}>
        <div style={titleRowStyle}>
          <h2 className="vibra-page-title">{tSaved("title")}</h2>
        </div>
      </div>
    </div>

    {/* Subnav: ÚNICO elemento fijo. Se queda pegado bajo el header; el feed
        desaparece seco al pasar por detrás (fondo negro sólido). */}
    {showMediaTabs && (
      <div style={stickySubnavStyle}>
        <PostsMediaSubnav active={mediaTab} onChange={handleMediaTabChange} />
      </div>
    )}

    <section ref={shellRef} style={shellStyle}>
      <VibraToast toast={feedToast} />

      {/* min-height: var(--vb-alto-pantalla) → la página nunca colapsa al remontar la pestaña,
          así el scroll no se recorta hasta el título. */}
      <div style={{ overflow: "hidden", width: "100%", minWidth: 0, minHeight: "var(--vb-alto-pantalla)" }}>
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
            // VOD, el modal en vivo o el flujo de desbloqueo). El contenido de pago
            // ya desbloqueado también: su URL la trae el card desde el
            // subdocumento protegido (ver useProtectedPlayback).
            if (!tile.isLive && !tile.isLocked && !tile.isPremiumUnlocked && !openUrl) return;
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
            style={{ ...searchInputStyle, paddingInlineEnd: activeSearch ? 62 : 38 }}
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
                insetInlineEnd: 36,
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
          <IconButton label={tSaved("search")} size="sm" tone="bare" shape="square" style={{ position: "absolute", insetInlineEnd: 6, top: "50%", transform: "translateY(-50%)", placeItems: "center" }} type="submit">
            <VibraNavigationIcon type="search" size={18} strokeWidth={2.2} />
          </IconButton>
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
            <PostReveal skeleton={<PostSkeleton />}>
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
            currentUserId={currentUserId}
            isOwner={false}
            showGroupContext={true}
            onModerationComplete={refreshPosts}
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
  </RefreshableArea>
  </>
  );
}