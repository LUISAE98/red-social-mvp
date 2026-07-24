//GroupPostFeed.tsx

"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { collection, doc, getDoc, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { auth, db, functions } from "@/lib/firebase";
import type {
  Comment,
  CommentMention,
  CommentReply,
  Post,
  PostPremium,
} from "@/lib/posts/types";
import {
  createMediaPost,
  createPostComment,
  createPostCommentReply,
  createTextPost,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchCommentRepliesAdmin,
  fetchGroupPostsPage,
  fetchGroupPublicPostsPage,
  fetchPostComments,
  fetchPostCommentsAdmin,
  softDeletePost,
  toggleGroupPostPin,
  togglePostFlame,
  togglePostSave,
  toggleProfilePostPin,
  type GroupPostsPageCursor,
} from "@/lib/posts/post-service";
import GroupPostCard from "./GroupPostCard";
import GroupPostComposer from "./GroupPostComposer";
import PostsMediaSubnav, { MEDIA_TAB_ORDER, type MediaTabKey } from "./PostsMediaSubnav";
import MediaGallery, { clearMediaGalleryCache, type GalleryTile } from "./MediaGallery";
import LiveComposerModal from "@/app/components/LiveComposer/LiveComposerModal";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import { uploadPostImages } from "@/lib/posts/image-upload";
import { httpsCallable } from "firebase/functions";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";


type InteractionBlockedReason = "login" | "join" | "restricted" | null;

type CreateMuxDirectUploadResponse = {
  provider: "mux";
  uploadId: string;
  uploadUrl: string;
  postId: string;
  mediaId: string;
  status: string;
};

type GroupPostsFeedProps = {
  groupId: string;
  groupVisibility?: "public" | "private" | "hidden" | null;
  isOwner?: boolean;
  isModerator?: boolean;
  viewerIsMember?: boolean;
  canCreatePosts?: boolean;
  canCommentOnPosts?: boolean;
  postBlockedReason?: InteractionBlockedReason;
  commentBlockedReason?: InteractionBlockedReason;
  publicPremiumOnly?: boolean;
  broadcastLiveOnly?: boolean;
  readOnly?: boolean;
  /** Búsqueda dentro de la comunidad: filtra los posts por texto. */
  searchQuery?: string;
  /** Reporta la sub-pestaña de media activa (para que el padre oculte el rail
   *  de recomendaciones en Fotos/Videos/En vivo). */
  onMediaTabChange?: (tab: MediaTabKey) => void;
  /** Contenido que va al inicio del panel "Publicaciones", debajo del sub-subnav
   *  y dentro del slide (ej. banner de donaciones y de sesiones). Se oculta en
   *  las pestañas de galería. */
  feedLeadingContent?: ReactNode;
};

// Búsqueda dentro de la comunidad: normaliza y matchea por texto del post.
function normalizeGroupSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function groupPostMatchesQuery(post: Post, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = normalizeGroupSearch(typeof post.text === "string" ? post.text : "");
  return tokens.every((token) => hay.includes(token));
}
const GROUP_SEARCH_MAX_AUTO_PAGES = 12;

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;

type PostWithAuthorState = Post & {
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: unknown;
  forcedGroupId?: string | null;
};

async function getGroupMemberMeta(
  groupId: string,
  userId: string,
): Promise<{ status: MemberStatus; mutedUntil: unknown }> {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      return { status: null, mutedUntil: null };
    }

    const data = memberSnap.data() as { status?: string; mutedUntil?: unknown };
    const rawStatus = data?.status;

    let status: MemberStatus = "active";

    if (rawStatus === "banned") {
      status = "banned";
    } else if (rawStatus === "muted") {
      status = "muted";
    } else if (
      rawStatus === "removed" ||
      rawStatus === "kicked" ||
      rawStatus === "expelled"
    ) {
      status = "removed";
    }

    return {
      status,
      mutedUntil: data?.mutedUntil ?? null,
    };
  } catch {
    return { status: null, mutedUntil: null };
  }
}

async function attachAuthorMemberState(
  groupId: string,
  posts: Post[],
): Promise<PostWithAuthorState[]> {
  if (!posts.length) return posts as PostWithAuthorState[];

  const uniqueAuthorIds = Array.from(
    new Set(
      posts
        .map((post) => post.authorId)
        .filter(
          (authorId): authorId is string =>
            typeof authorId === "string" && authorId.trim().length > 0,
        ),
    ),
  );

  const authorStatusEntries = await Promise.all(
    uniqueAuthorIds.map(async (authorId) => {
      const meta = await getGroupMemberMeta(groupId, authorId);
      return [authorId, meta] as const;
    }),
  );

  const authorStatusMap = new Map<
    string,
    { status: MemberStatus; mutedUntil: unknown }
  >(authorStatusEntries);

  return posts.map((post) => {
    const authorMeta = authorStatusMap.get(post.authorId) ?? {
      status: null,
      mutedUntil: null,
    };

    return {
      ...post,
      forcedGroupId: groupId,
      authorMemberStatus: authorMeta.status,
      authorMutedUntil: authorMeta.mutedUntil,
    };
  });
}

function normalizeFeedPost(post: PostWithAuthorState): PostWithAuthorState {
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

    isPinnedInGroup: post.isPinnedInGroup ?? false,
    groupPinnedAt: post.groupPinnedAt ?? null,
    groupPinnedBy: post.groupPinnedBy ?? null,

    isPinnedOnProfile: post.isPinnedOnProfile ?? false,
    profilePinnedAt: post.profilePinnedAt ?? null,
    profilePinnedBy: post.profilePinnedBy ?? null,
  };
}

function buildOptimisticTextPost(params: {
  postId: string;
  groupId: string;
  text: string;
}): PostWithAuthorState {
  const currentUser = auth.currentUser;
  return normalizeFeedPost({
    id: params.postId,
    text: params.text,
    authorId: currentUser?.uid ?? "",
    authorName: currentUser?.displayName ?? undefined,
    authorAvatarUrl: currentUser?.photoURL ?? null,
    authorUsername: null,
    groupId: params.groupId,
    contextType: "group",
    isDeleted: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    deletedAt: null,
    postType: "text",
    access: "free",
    accessModel: "free",
    accessScope: "group",
    requiresPayment: false,
    requiresSubscription: false,
    oneTimePrice: null,
    currency: null,
    media: [],
    counts: { comments: 0, likes: 0, saves: 0 },
    viewerHasFlamed: false,
    viewerHasSaved: false,
    isPinnedInGroup: false,
    authorMemberStatus: "active",
    authorMutedUntil: null,
    forcedGroupId: params.groupId,
  });
}

function isVideoPostStillProcessing(post: PostWithAuthorState): boolean {
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

function buildPostBlockedMessage(reason: InteractionBlockedReason): string {
  if (reason === "login") {
    return "Inicia sesión para publicar en esta comunidad.";
  }

  if (reason === "join") {
    return "Debes unirte a esta comunidad para publicar.";
  }

  if (reason === "restricted") {
    return "No puedes publicar en esta comunidad por la configuración actual o por tu estado dentro de la comunidad.";
  }

  return "No puedes publicar en esta comunidad en este momento.";
}

function buildCommentBlockedMessage(reason: InteractionBlockedReason): string {
  if (reason === "login") {
    return "Inicia sesión para comentar";
  }

  if (reason === "join") {
    return "Únete para comentar";
  }

  // restricted / default → leyenda corta.
  return "No puedes comentar en esta comunidad";
}
const GROUP_FEED_PAGE_SIZE = 10;
const GROUP_FEED_CACHE_TTL_MS = 1000 * 60 * 5;
const VIDEO_PROCESSING_POLL_MS = 1000 * 15;
const VIDEO_PROCESSING_MAX_POLLS = 20;
const VIDEO_MAX_DURATION_SECONDS = 60 * 30;

type GroupFeedCacheEntry = {
  posts: PostWithAuthorState[];
  cursor: GroupPostsPageCursor | null;
  hasMore: boolean;
  updatedAt: number;
};

const groupFeedMemoryCache = new Map<string, GroupFeedCacheEntry>();

function getGroupFeedCacheKey(params: {
  groupId: string;
  currentUid: string | null;
}): string {
  return ["group-feed", params.groupId, params.currentUid ?? "guest"].join(":");
}

function sortGroupFeedPosts(
  posts: PostWithAuthorState[],
): PostWithAuthorState[] {
  return [...posts].sort((a, b) => {
    const aPinned = a.isPinnedInGroup === true;
    const bPinned = b.isPinnedInGroup === true;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    const aPinnedAt = a.groupPinnedAt?.toMillis?.() ?? 0;
    const bPinnedAt = b.groupPinnedAt?.toMillis?.() ?? 0;

    if (aPinned && bPinned && aPinnedAt !== bPinnedAt) {
      return bPinnedAt - aPinnedAt;
    }

    const aCreatedAt = a.createdAt?.toMillis?.() ?? 0;
    const bCreatedAt = b.createdAt?.toMillis?.() ?? 0;

    return bCreatedAt - aCreatedAt;
  });
}

function mergeUniquePosts(
  currentPosts: PostWithAuthorState[],
  nextPosts: PostWithAuthorState[],
): PostWithAuthorState[] {
  const map = new Map<string, PostWithAuthorState>();

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

  return sortGroupFeedPosts(Array.from(map.values()));
}

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(video.duration);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la duración del video."));
    };

    video.src = objectUrl;
  });
}

function uploadVideoFileToMux(params: {
  uploadUrl: string;
  file: File;
  onProgress: (progress: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      params.onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`Mux upload falló con status ${xhr.status}.`));
    };

    xhr.onerror = () => {
      reject(new Error("Error de red al subir el video a Mux."));
    };

    xhr.open("PUT", params.uploadUrl);
    xhr.setRequestHeader("Content-Type", params.file.type || "video/mp4");
    xhr.send(params.file);
  });
}

export default function GroupPostsFeed({
  groupId,
  groupVisibility = null,
  isOwner = false,
  isModerator = false,
  viewerIsMember = false,
  canCreatePosts = false,
  canCommentOnPosts = false,
  postBlockedReason = null,
  commentBlockedReason = null,
  publicPremiumOnly = false,
  broadcastLiveOnly = false,
  readOnly = false,
  searchQuery = "",
  onMediaTabChange,
  feedLeadingContent = null,
}: GroupPostsFeedProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [broadcastLive, setBroadcastLive] = useState<Post | null>(null);
  const [posts, setPosts] = useState<PostWithAuthorState[]>([]);
  const [deletedPosts, setDeletedPosts] = useState<PostWithAuthorState[]>([]);
  // Sub-subnav de media (Publicaciones/Fotos/Videos/En vivo) + lightbox de galería.
  const [mediaTab, setMediaTab] = useState<MediaTabKey>("feed");
  const [lightboxTile, setLightboxTile] = useState<GalleryTile | null>(null);
  // Posts desbloqueados (comprados) en esta sesión desde la galería.
  const [unlockedPostIds, setUnlockedPostIds] = useState<Set<string>>(() => new Set());
  // Pestaña previa para la dirección del slide (mismo patrón que Wallet).
  const prevMediaTabRef = useRef<MediaTabKey>("feed");
  useEffect(() => {
    prevMediaTabRef.current = mediaTab;
  }, [mediaTab]);
  const [error, setError] = useState<string | null>(null);
  const { toast: feedToast, showToast: showFeedToast } = useVibraToast();
  useEffect(() => { if (error) showFeedToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isLiveModalOpen, setIsLiveModalOpen] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(
    null,
  );
  const [videoUploadStatus, setVideoUploadStatus] = useState<string | null>(
    null,
  );
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pageCursor, setPageCursor] = useState<GroupPostsPageCursor | null>(
    null,
  );
  const [currentUid, setCurrentUid] = useState<string | null>(
    auth.currentUser?.uid ?? null,
  );
  const infiniteScrollTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const pageCursorRef = useRef<GroupPostsPageCursor | null>(null);
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
      getGroupFeedCacheKey({
        groupId,
        currentUid,
      }),
    [groupId, currentUid],
  );

  const syncPostsState = useCallback(
    (updater: (prev: PostWithAuthorState[]) => PostWithAuthorState[]) => {
      setPosts((prev) => {
        const next = updater(prev);

        if (groupId) {
          groupFeedMemoryCache.set(cacheKey, {
            posts: next,
            cursor: pageCursorRef.current,
            hasMore: hasMoreRef.current,
            updatedAt: Date.now(),
          });
        }

        return next;
      });
    },
    [cacheKey, groupId],
  );

  useEffect(() => {
    return registerPostFeedCacheListener({
      removePost: (postId) => {
        syncPostsState((prev) => prev.filter((post) => post.id !== postId));
      },
      patchPost: (postId, patch) => {
        syncPostsState((prev) =>
          sortGroupFeedPosts(
            prev
              .map((post) =>
                post.id === postId
                  ? normalizeFeedPost({
                      ...post,
                      ...patch,
                      counts: {
                        ...post.counts,
                        ...patch.counts,
                      },
                    } as PostWithAuthorState)
                  : post,
              )
              .filter((post) => post.isDeleted !== true),
          ),
        );
      },
      clear: () => {
        groupFeedMemoryCache.delete(cacheKey);
        setPosts([]);
        setPageCursor(null);
        setHasMore(false);
        pageCursorRef.current = null;
        hasMoreRef.current = false;
      },
    });
  }, [cacheKey, syncPostsState]);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setCurrentUid(user?.uid ?? null);
    });

    return () => unsub();
  }, []);

  // Admin-only: subscribe to deleted posts for this group
  useEffect(() => {
    if (!readOnly) return;
    const q = query(
      collection(db, "posts"),
      where("groupId", "==", groupId),
      where("isDeleted", "==", true),
      orderBy("createdAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setDeletedPosts(
        snap.docs.map((d) =>
          normalizeFeedPost({ ...(d.data() as Post), id: d.id } as PostWithAuthorState),
        ),
      );
    }, () => {});
    return () => unsub();
  }, [readOnly, groupId]);

  // Subscribe to the group document to detect broadcast lives.
  // When activeLivePostId is set on this group and the post originates from a different
  // community, it means a live is being broadcast here from elsewhere.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "groups", groupId), (snap) => {
      if (!snap.exists()) {
        setBroadcastLive(null);
        return;
      }
      const activeLivePostId = snap.data().activeLivePostId as string | undefined;
      if (!activeLivePostId) {
        setBroadcastLive(null);
        return;
      }
      getDoc(doc(db, "posts", activeLivePostId))
        .then((postSnap) => {
          if (!postSnap.exists()) {
            setBroadcastLive(null);
            return;
          }
          const post = { id: postSnap.id, ...postSnap.data() } as Post;
          // Only show as broadcast live if the post is native to a DIFFERENT community.
          // Native lives from this same community already appear in the regular feed.
          if (post.groupId !== groupId) {
            setBroadcastLive(post);
          } else {
            setBroadcastLive(null);
          }
        })
        .catch((err) => {
          console.error("[broadcastLive] getDoc error:", err.code, err.message);
          setBroadcastLive(null);
        });
    }, (err) => {
      console.error("[broadcastLive] group snapshot error:", err.code, err.message);
      setBroadcastLive(null);
    });
    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!composerError) return;

    const timer = window.setTimeout(() => {
      setComposerError(null);
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [composerError]);

  const loadPostsPage = useCallback(
    async (mode: "initial" | "more" | "refresh" = "initial") => {
      if (!groupId) {
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

      const requestId = feedRequestIdRef.current + 1;
      feedRequestIdRef.current = requestId;

      try {
        setError(null);

        const result = await loadFeedWithRetry(
          async () => {
            const pageResult = await (publicPremiumOnly
              ? fetchGroupPublicPostsPage
              : fetchGroupPostsPage)({
              groupId,
              viewerUid: currentUid,
              pageSize: GROUP_FEED_PAGE_SIZE,
              cursor: mode === "more" ? pageCursorRef.current : null,
            });

            const hydratedPosts = await attachAuthorMemberState(
              groupId,
              pageResult.posts,
            );

            return {
              ...pageResult,
              posts: hydratedPosts,
            };
          },
          { timeoutMs: mode === "more" ? 15000 : 12000 },
        );

        if (feedRequestIdRef.current !== requestId) {
          return;
        }

        const normalizedPosts = result.posts
          .map(normalizeFeedPost)
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
              : sortGroupFeedPosts(normalizedPosts);

          groupFeedMemoryCache.set(cacheKey, {
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

        setError(
          (e instanceof Error ? e.message : null) ??
            "No se pudieron cargar las publicaciones. Intenta de nuevo.",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheKey, groupId, currentUid],
  );

  const loadPosts = useCallback(async () => {
    await loadPostsPage("refresh");
  }, [loadPostsPage]);

  const handleGroupPullRefresh = useCallback(async () => {
    clearMediaGalleryCache();
    await loadPostsPage("refresh");

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 901px)").matches
    ) {

    }
  }, [loadPostsPage]);

  const handleGroupMemberBlockComplete = useCallback(async () => {
    groupFeedMemoryCache.delete(cacheKey);
    setPageCursor(null);
    setHasMore(false);
    pageCursorRef.current = null;
    hasMoreRef.current = false;

    await loadPostsPage("refresh");
  }, [cacheKey, loadPostsPage]);

  useEffect(() => {
    if (broadcastLiveOnly) {
      setLoadingInitial(false);
      return;
    }

    let active = true;

    async function run() {
      const cached = groupFeedMemoryCache.get(cacheKey);
      const cacheIsFresh =
        !!cached && Date.now() - cached.updatedAt <= GROUP_FEED_CACHE_TTL_MS;

      const cacheHasProcessingVideos =
        cached?.posts.some(isVideoPostStillProcessing) === true;

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
  }, [groupId, currentUid, cacheKey, loadPostsPage, broadcastLiveOnly]);

  // ── Búsqueda dentro de la comunidad ───────────────────────────────────────
  const groupSearchTokens = useMemo(
    () => normalizeGroupSearch(searchQuery.trim()).split(/\s+/).filter(Boolean),
    [searchQuery]
  );
  const groupSearchActive = groupSearchTokens.length > 0;
  const groupSearchKey = groupSearchTokens.join(" ");

  const groupSearchVisibleCount = useMemo(
    () =>
      groupSearchActive
        ? posts.filter((post) => groupPostMatchesQuery(post, groupSearchTokens)).length
        : posts.length,
    [groupSearchActive, posts, groupSearchTokens]
  );

  const groupSearchAutoPagesRef = useRef(0);
  useEffect(() => {
    groupSearchAutoPagesRef.current = 0;
  }, [groupSearchKey]);
  useEffect(() => {
    if (!groupSearchActive) return;
    if (!hasMore || loadingMore || loadingInitial) return;
    if (groupSearchAutoPagesRef.current >= GROUP_SEARCH_MAX_AUTO_PAGES) return;
    groupSearchAutoPagesRef.current += 1;
    void loadPostsPage("more");
  }, [
    groupSearchActive,
    groupSearchKey,
    hasMore,
    loadingMore,
    loadingInitial,
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
    if (!groupId) return;
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
          VIDEO_PROCESSING_POLL_MS,
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

            const freshPost = normalizeFeedPost({
              ...(postSnap.data() as Post),
              id: postSnap.id,
              forcedGroupId: groupId,
            } as PostWithAuthorState);

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
                      authorMemberStatus: post.authorMemberStatus,
                      authorMutedUntil: post.authorMutedUntil,
                      forcedGroupId: post.forcedGroupId ?? groupId,
                    }
                  : post,
              );
            });

            if (isDone) {
              delete videoProcessingPollsRef.current[postId];
            }
          } catch {
            // Se ignora para no romper el feed por una lectura fallida temporal.
          }
        }),
      );

      if (!cancelled && shouldContinuePolling) {
        timeoutId = window.setTimeout(
          refreshProcessingVideos,
          VIDEO_PROCESSING_POLL_MS,
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
  }, [groupId, processingVideoPostIdsKey, syncPostsState]);

  useEffect(() => {
    if (!groupId) return;
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
      },
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [
    groupId,
    hasMore,
    loadingInitial,
    infiniteScrollTriggerIndex,
    loadPostsPage,
    // Reobservar el target al volver del panel de galería (remonta el subárbol).
    mediaTab,
  ]);

  function redirectToLogin() {
    const nextPath = buildCurrentPathWithSearch(
      pathname || `/groups/${groupId}`,
      searchParams,
    );

    router.push(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  function guardCreatePost(): boolean {
    if (canCreatePosts) {
      return true;
    }

    const message = buildPostBlockedMessage(postBlockedReason);

    if (postBlockedReason === "login") {
      setComposerError(message);
      redirectToLogin();
      return false;
    }

    setComposerError(message);
    return false;
  }

  function guardCreateComment(): boolean {
    if (canCommentOnPosts) {
      return true;
    }

    const message = buildCommentBlockedMessage(commentBlockedReason);

    if (commentBlockedReason === "login") {
      setError(message);
      redirectToLogin();
      return false;
    }

    setError(message);
    return false;
  }

  async function handleCreatePost(payload: {
    text: string;
    imageFiles?: File[];
    videoFiles?: File[];
    mediaItems?: Array<{
      type: "image" | "video";
      file: File;
      coverFile?: File | null;
    }>;
    premium?: PostPremium | null;
  }) {

    if (!guardCreatePost()) return;

    try {
      setError(null);
      setComposerError(null);
      setVideoUploadProgress(null);
      setVideoUploadStatus(null);

      const cleanText = payload.text.trim();

      type OrderedComposerMediaItem = {
        type: "image" | "video";
        file: File;
        coverFile?: File | null;
      };

      const orderedMediaItems: OrderedComposerMediaItem[] =
        Array.isArray(payload.mediaItems) && payload.mediaItems.length > 0
          ? payload.mediaItems
          : [
              ...(payload.imageFiles ?? []).map<OrderedComposerMediaItem>((file) => ({
                type: "image",
                file,
                coverFile: null,
              })),
              ...(payload.videoFiles ?? []).map<OrderedComposerMediaItem>((file) => ({
                type: "video",
                file,
                coverFile: null,
              })),
            ];

      const imageItems = orderedMediaItems
        .map((item, mediaIndex) => ({ ...item, mediaIndex }))
        .filter((item) => item.type === "image");

      const videoItems = orderedMediaItems
        .map((item, mediaIndex) => ({ ...item, mediaIndex }))
        .filter((item) => item.type === "video");

      if (videoItems.length > 3) {
        setComposerError("Puedes agregar máximo 3 videos por publicación.");
        return;
      }

      if (videoItems.length > 0) {
        setVideoUploadProgress(0);
        setVideoUploadStatus("Validando videos...");

        for (const videoItem of videoItems) {
          const duration = await getVideoDuration(videoItem.file);

          if (duration > VIDEO_MAX_DURATION_SECONDS) {
            setVideoUploadProgress(null);
            setVideoUploadStatus(null);
            setComposerError("Cada video no puede durar más de 30 minutos.");
            return;
          }
        }
      }

      const uploadedImages =
        imageItems.length > 0
          ? (
              await uploadPostImages({
                groupId,
                files: imageItems.map((item) => item.file),
              })
            ).map((media, index) => ({
              ...media,
              index: imageItems[index]?.mediaIndex ?? index,
            }))
          : [];

      const videoCoverItems = videoItems.filter(
        (item) => item.coverFile instanceof File,
      );

const uploadedVideoCovers =
  videoCoverItems.length > 0
    ? (setVideoUploadStatus("Subiendo portadas de videos..."),
      await uploadPostImages({
        groupId,
        files: videoCoverItems.map((item) => item.coverFile as File),
      })).map((media, index) => ({
        mediaIndex: videoCoverItems[index]?.mediaIndex ?? index,
        thumbnailUrl: media.thumbnailUrl ?? media.url,
        thumbnailPath: media.thumbnailPath ?? media.path ?? null,
      }))
    : [];

      const videoCoversByMediaIndex = new Map(
        uploadedVideoCovers.map((cover) => [cover.mediaIndex, cover]),
      );

      if (videoItems.length > 0) {
        setVideoUploadStatus("Preparando subida de videos...");

        const callable = httpsCallable<
          {
            groupId: string;
            postId?: string;
            mediaIndex?: number;
          },
          CreateMuxDirectUploadResponse
        >(functions, "createMuxDirectUpload");

        const muxUploads: Array<{
          uploadUrl: string;
          uploadId: string;
          postId: string;
          mediaId: string;
          file: File;
          mediaIndex: number;
          thumbnailUrl: string | null;
          thumbnailPath: string | null;
        }> = [];

        let sharedPostId: string | null = null;

        for (const videoItem of videoItems) {
          const uploadResult = await callable({
            groupId,
            postId: sharedPostId ?? undefined,
            mediaIndex: videoItem.mediaIndex,
          });

          const uploadData = uploadResult.data as CreateMuxDirectUploadResponse;

          if (!sharedPostId) {
            sharedPostId = uploadData.postId;
          }

          const cover =
            videoCoversByMediaIndex.get(videoItem.mediaIndex) ?? null;

          muxUploads.push({
            uploadUrl: uploadData.uploadUrl,
            uploadId: uploadData.uploadId,
            postId: uploadData.postId,
            mediaId: uploadData.mediaId,
            file: videoItem.file,
            mediaIndex: videoItem.mediaIndex,
            thumbnailUrl: cover?.thumbnailUrl ?? null,
            thumbnailPath: cover?.thumbnailPath ?? null,
          });
        }

        if (!sharedPostId) {
          throw new Error("No se pudo preparar la publicación de video.");
        }

        setVideoUploadStatus("Creando publicación con media...");

        const videoUploadsPayload = muxUploads.map((upload) => ({
          uploadId: upload.uploadId,
          mediaId: upload.mediaId,
          mediaIndex: upload.mediaIndex,
          thumbnailUrl: upload.thumbnailUrl,
          thumbnailPath: upload.thumbnailPath,
        }));

        await createMediaPost({
          groupId,
          postId: sharedPostId,
          text: cleanText,
          imageMedia: uploadedImages,
          videoUploads: videoUploadsPayload,
          premium: payload.premium ?? null,
        });

        for (let index = 0; index < muxUploads.length; index += 1) {
          const upload = muxUploads[index];

          setVideoUploadStatus(
            `Subiendo video ${index + 1} de ${muxUploads.length} a Mux...`,
          );

          await uploadVideoFileToMux({
            uploadUrl: upload.uploadUrl,
            file: upload.file,
            onProgress: setVideoUploadProgress,
          });
        }

        setVideoUploadStatus(
          "Videos subidos. Mux los está procesando; aparecerán listos en unos momentos.",
        );
      } else if (uploadedImages.length > 0) {
        await createMediaPost({
          groupId,
          text: cleanText,
          imageMedia: uploadedImages,
          videoUploads: [],
          premium: null,
        });
      } else {
        // Insertar post optimista inmediatamente — el usuario lo ve al instante
        const tempId = `__opt_${Date.now()}`;
        setPosts((prev) => [
          buildOptimisticTextPost({ postId: tempId, groupId, text: cleanText }),
          ...prev,
        ]);
        let realPostId: string;
        try {
          realPostId = await createTextPost({ groupId, text: cleanText });
        } catch (e) {
          // Rollback: quitar el post optimista si la creación falla
          setPosts((prev) => prev.filter((p) => p.id !== tempId));
          throw e;
        }
        // Reemplazar ID temporal con el ID real de Firestore
        setPosts((prev) =>
          prev.map((p) =>
            p.id === tempId
              ? buildOptimisticTextPost({ postId: realPostId, groupId, text: cleanText })
              : p,
          ),
        );
      }

      void loadPosts();

      window.setTimeout(() => {
        setVideoUploadProgress(null);
        setVideoUploadStatus(null);
      }, 2500);
    } catch (e: unknown) {
      setComposerError((e instanceof Error ? e.message : null) ?? "No se pudo publicar.");
      setVideoUploadStatus(null);
      setVideoUploadProgress(null);
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

  async function handleToggleGroupPin(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await toggleGroupPostPin(postId);

      patchPostInAllFeedCaches(postId, {
        isPinnedInGroup: result.isPinnedInGroup,
        groupPinnedAt: result.isPinnedInGroup ? null : null,
        groupPinnedBy: result.isPinnedInGroup ? currentUid : null,
      });

      await loadPosts();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "No se pudo fijar o desfijar la publicación.");
      throw e;
    }
  }
  async function handleToggleProfilePin(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await toggleProfilePostPin(postId);

      patchPostInAllFeedCaches(postId, {
        isPinnedOnProfile: result.isPinnedOnProfile,
        profilePinnedAt: result.isPinnedOnProfile ? null : null,
        profilePinnedBy: result.isPinnedOnProfile ? currentUid : null,
      });

      await loadPosts();
    } catch (e: unknown) {
      setError(
        (e instanceof Error ? e.message : null) ??
          "No se pudo fijar o desfijar la publicación en tu perfil.",
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

  async function handleLoadCommentsAdmin(postId: string): Promise<Comment[]> {
    try {
      return await fetchPostCommentsAdmin(postId);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "No se pudieron cargar los comentarios.");
      throw e;
    }
  }

  async function syncPostCommentsCount(postId: string) {
    const comments = await fetchPostComments(postId);

    const total = comments.reduce(
      (sum, c) => sum + 1 + (c.counts?.replies ?? 0),
      0,
    );

    syncPostsState((prev) =>
      prev.map((post) =>
        post.id === postId
          ? { ...post, counts: { ...post.counts, comments: total } }
          : post,
      ),
    );

    return comments;
  }

  async function handleCreateComment(
    postId: string,
    text: string,
    mentions?: CommentMention[],
  ): Promise<Comment[]> {
    if (!guardCreateComment()) {
      throw new Error(buildCommentBlockedMessage(commentBlockedReason));
    }

    try {
      setError(null);
      await createPostComment({ postId, text, mentions });

      return await syncPostCommentsCount(postId);
    } catch (e: unknown) {
      throw e;
    }
  }

  async function handleDeleteComment(
    postId: string,
    commentId: string,
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
    commentId: string,
  ): Promise<CommentReply[]> {
    try {
      setError(null);
      return await fetchCommentReplies({ postId, commentId });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "No se pudieron cargar las respuestas.");
      throw e;
    }
  }

  async function handleLoadRepliesAdmin(
    postId: string,
    commentId: string,
  ): Promise<CommentReply[]> {
    try {
      return await fetchCommentRepliesAdmin({ postId, commentId });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? "No se pudieron cargar las respuestas.");
      throw e;
    }
  }

  async function handleCreateReply(
    postId: string,
    commentId: string,
    text: string,
    mentions?: CommentMention[],
  ): Promise<CommentReply[]> {
    if (!guardCreateComment()) {
      throw new Error(buildCommentBlockedMessage(commentBlockedReason));
    }

    try {
      setError(null);
      await createPostCommentReply({ postId, commentId, text, mentions });

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
    replyId: string,
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
  maxWidth: "100%",
  minWidth: 0,
  display: "grid",
  gap: 0,
  overflowX: "hidden",
  boxSizing: "border-box",
  overflowAnchor: "none",
};

  const headerStyle: CSSProperties = {
    display: "grid",
    gap: 3,
    minWidth: 0,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: "clamp(15px, 4vw, 18px)",
    fontWeight: 500,
    lineHeight: 1.08,
    letterSpacing: "-0.02em",
    color: "#fff",
    wordBreak: "break-word",
  };

  const subtitleStyle: CSSProperties = {
    margin: 0,
    fontSize: "clamp(11px, 3.2vw, 11.5px)",
    fontWeight: 300,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.35,
    wordBreak: "break-word",
  };

  const noticeStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: "9px 10px",
    fontSize: 12,
    fontWeight: 300,
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.82)",
    overflowWrap: "anywhere",
  };

  const composerErrorStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1px solid rgba(255,90,90,0.24)",
    background: "rgba(120,18,18,0.28)",
    color: "#ffdada",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  };

  const interactionHintStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.025)",
    color: "rgba(255,255,255,0.82)",
    padding: "12px 14px",
    fontSize: 12.5,
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  };

  const cardShellStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "visible",
    boxSizing: "border-box",
  };

  const postShellStyle: CSSProperties = {
    ...cardShellStyle,
    paddingBottom: 12,
  };

  // Sub-subnav de media: solo en el feed real de miembros (no en preview público,
  // admin, broadcast-only ni durante una búsqueda).
  const showMediaTabs =
    !readOnly && !broadcastLiveOnly && !groupSearchActive && (viewerIsMember || isOwner);
  const effectiveMediaTab: MediaTabKey = showMediaTabs ? mediaTab : "feed";

  const canDeleteLightboxPost = lightboxTile
    ? isOwner || isModerator || currentUid === lightboxTile.post.authorId
    : false;

  const prevMediaTab = prevMediaTabRef.current;
  const mediaSlideDir =
    prevMediaTab === effectiveMediaTab
      ? 0
      : MEDIA_TAB_ORDER[effectiveMediaTab] > MEDIA_TAB_ORDER[prevMediaTab]
        ? 1
        : -1;

  // Reporta al padre (page.tsx) la sub-pestaña activa para ocultar el rail de
  // recomendaciones cuando se está en Fotos/Videos/En vivo.
  useEffect(() => {
    onMediaTabChange?.(effectiveMediaTab);
  }, [effectiveMediaTab, onMediaTabChange]);

  return (
    <RefreshableArea onRefresh={handleGroupPullRefresh}>
      <section style={shellStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Publicaciones</h2>
        <p style={subtitleStyle}>Feed de la comunidad.</p>
      </div>

      {canCreatePosts ? (
        <div style={cardShellStyle}>
          <GroupPostComposer
            onSubmit={handleCreatePost}
            onLiveClick={isOwner ? () => setIsLiveModalOpen(true) : undefined}
            groupVisibility={groupVisibility}
            isOwner={isOwner}
          />

          <LiveComposerModal
            open={isLiveModalOpen}
            onClose={() => setIsLiveModalOpen(false)}
            onSuccess={() => void loadPosts()}
            contextType="group"
            groupId={groupId}
            groupVisibility={groupVisibility}
          />

          {videoUploadStatus ? (
            <div
              style={{
                marginTop: 10,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(15, 23, 42, 0.72)",
                padding: 12,
                color: "rgba(255,255,255,0.84)",
                fontSize: 13,
              }}
            >
              <div style={{ marginBottom: 8 }}>{videoUploadStatus}</div>

              {videoUploadProgress !== null ? (
                <div
                  style={{
                    height: 8,
                    width: "100%",
                    overflow: "hidden",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.1)",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${videoUploadProgress}%`,
                      borderRadius: 999,
                      background: "rgba(96,165,250,0.95)",
                      transition: "width 160ms ease",
                    }}
                  />
                </div>
              ) : null}

              {videoUploadProgress !== null ? (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {videoUploadProgress}%
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : postBlockedReason !== null ? (
        <div style={interactionHintStyle}>
          {buildPostBlockedMessage(postBlockedReason)}
        </div>
      ) : null}

      {composerError && <div style={composerErrorStyle}>{composerError}</div>}

      <VibraToast toast={feedToast} />

      {showMediaTabs && (
        <PostsMediaSubnav active={mediaTab} onChange={setMediaTab} />
      )}

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
          source={{ type: "group", groupId }}
          kind={effectiveMediaTab}
          viewerUid={currentUid}
          viewerHasMembership={viewerIsMember || isOwner}
          unlockedPostIds={unlockedPostIds}
          onOpenTile={(tile) => {
            const openUrl = tile.mediaUrl ?? tile.post.media?.[0]?.url ?? null;
            // Los tiles de live (transmisión/VOD) y los bloqueados siempre abren:
            // el card resuelve el VOD, el modal en vivo o el flujo de desbloqueo.
            if (!tile.isLive && !tile.isLocked && !openUrl) return;
            setLightboxTile(tile);
          }}
        />
      ) : (
      <>

      {feedLeadingContent}

      {loadingInitial && (
        <div style={noticeStyle}>Cargando publicaciones...</div>
      )}

      {/* Live broadcasting into this community from another context */}
      {broadcastLive && (
        <div style={postShellStyle}>
          <GroupPostCard
            post={broadcastLive}
            groupId={groupId}
            canDelete={false}
            onLoadComments={readOnly ? handleLoadCommentsAdmin : handleLoadComments}
            onCreateComment={readOnly ? async () => [] : handleCreateComment}
            onDeleteComment={readOnly ? async () => [] : handleDeleteComment}
            onLoadReplies={readOnly ? handleLoadRepliesAdmin : handleLoadReplies}
            onCreateReply={readOnly ? async () => [] : handleCreateReply}
            onDeleteReply={readOnly ? async () => [] : handleDeleteReply}
            onToggleFlame={readOnly ? undefined : handleToggleFlame}
            onToggleSave={readOnly ? undefined : handleToggleSave}
            canCommentOnPosts={readOnly ? false : canCommentOnPosts}
            commentBlockedReason={readOnly ? null : commentBlockedReason}
            currentUserId={currentUid}
            isOwner={false}
            isModerator={false}
            viewerIsMember={viewerIsMember}
          />
        </div>
      )}

      {!groupSearchActive && !broadcastLiveOnly && !loadingInitial && posts.length === 0 && deletedPosts.length === 0 && !broadcastLive && (
        <div style={noticeStyle}>
          Todavía no hay publicaciones en esta comunidad.
        </div>
      )}

      {groupSearchActive &&
        !loadingInitial &&
        !loadingMore &&
        !hasMore &&
        groupSearchVisibleCount === 0 && (
          <div style={noticeStyle}>No se encontraron publicaciones.</div>
        )}

      {(() => {
        const baseList = readOnly
          ? [...posts, ...deletedPosts].sort(
              (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
            )
          : posts;
        const feedList = groupSearchActive
          ? baseList.filter((post) => groupPostMatchesQuery(post, groupSearchTokens))
          : baseList;
        return feedList.map((post, index) => {
        const canDeletePost =
          isOwner || isModerator || currentUid === post.authorId;

        const shouldAttachInfiniteScrollTarget =
          !groupSearchActive && hasMore && index === infiniteScrollTriggerIndex;

        return (
          <div key={post.id} style={postShellStyle}>
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
              groupId={groupId}
              canDelete={readOnly ? false : canDeletePost}
              onDelete={readOnly ? undefined : (canDeletePost ? handleDeletePost : undefined)}
              onLoadComments={readOnly ? handleLoadCommentsAdmin : handleLoadComments}
              onCreateComment={readOnly ? async () => [] : handleCreateComment}
              onDeleteComment={readOnly ? async () => [] : handleDeleteComment}
              onLoadReplies={readOnly ? handleLoadRepliesAdmin : handleLoadReplies}
              onCreateReply={readOnly ? async () => [] : handleCreateReply}
              onDeleteReply={readOnly ? async () => [] : handleDeleteReply}
              onToggleFlame={readOnly ? undefined : handleToggleFlame}
              onToggleSave={readOnly ? undefined : handleToggleSave}
              onToggleGroupPin={readOnly ? undefined : handleToggleGroupPin}
              onToggleProfilePin={readOnly ? undefined : handleToggleProfilePin}
              currentUserId={currentUid}
              isOwner={readOnly ? false : isOwner}
              isModerator={readOnly ? false : isModerator}
              viewerIsMember={viewerIsMember}
              showGroupContext={false}
              canModerateGroupAuthor={readOnly ? false : (isOwner || isModerator)}
              canUseGroupMemberBlock={readOnly ? false : (!isOwner && viewerIsMember)}
              onModerationComplete={readOnly ? undefined : loadPosts}
              onGroupMemberBlockComplete={readOnly ? undefined : handleGroupMemberBlockComplete}
              canCommentOnPosts={readOnly ? false : canCommentOnPosts}
              commentBlockedReason={readOnly ? null : commentBlockedReason}
              showDeletedBanner={readOnly && post.isDeleted === true}
            />
          </div>
        );
        });
      })()}

      {loadingMore && (
        <div style={noticeStyle}>Cargando más publicaciones...</div>
      )}

      {!groupSearchActive && !loadingInitial && !loadingMore && posts.length > 0 && !hasMore && (
        <div style={noticeStyle}>
          Ya viste todas las publicaciones disponibles.
        </div>
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
            groupId={groupId}
            canDelete={readOnly ? false : canDeleteLightboxPost}
            onDelete={
              readOnly ? undefined : canDeleteLightboxPost ? handleDeletePost : undefined
            }
            onLoadComments={readOnly ? handleLoadCommentsAdmin : handleLoadComments}
            onCreateComment={readOnly ? async () => [] : handleCreateComment}
            onDeleteComment={readOnly ? async () => [] : handleDeleteComment}
            onLoadReplies={readOnly ? handleLoadRepliesAdmin : handleLoadReplies}
            onCreateReply={readOnly ? async () => [] : handleCreateReply}
            onDeleteReply={readOnly ? async () => [] : handleDeleteReply}
            onToggleFlame={readOnly ? undefined : handleToggleFlame}
            onToggleSave={readOnly ? undefined : handleToggleSave}
            onToggleGroupPin={readOnly ? undefined : handleToggleGroupPin}
            onToggleProfilePin={readOnly ? undefined : handleToggleProfilePin}
            currentUserId={currentUid}
            isOwner={readOnly ? false : isOwner}
            isModerator={readOnly ? false : isModerator}
            viewerIsMember={viewerIsMember}
            showGroupContext={false}
            canModerateGroupAuthor={readOnly ? false : isOwner || isModerator}
            canUseGroupMemberBlock={readOnly ? false : !isOwner && viewerIsMember}
            onModerationComplete={readOnly ? undefined : loadPosts}
            onGroupMemberBlockComplete={
              readOnly ? undefined : handleGroupMemberBlockComplete
            }
            canCommentOnPosts={readOnly ? false : canCommentOnPosts}
            commentBlockedReason={readOnly ? null : commentBlockedReason}
            autoOpenMediaUrl={
              lightboxTile.mediaUrl ?? lightboxTile.post.media?.[0]?.url ?? null
            }
            autoOpenLive={lightboxTile.isLiveNow}
            autoOpenVod={lightboxTile.isLive && !lightboxTile.isLiveNow}
            autoOpenUnlock={lightboxTile.isLocked}
            forceUnlocked={lightboxTile.isPremiumUnlocked}
            onPostUnlocked={(id) =>
              setUnlockedPostIds((prev) => new Set(prev).add(id))
            }
            onViewerClosed={() => setLightboxTile(null)}
          />
        </div>
      )}
      </section>
    </RefreshableArea>
  );
}
