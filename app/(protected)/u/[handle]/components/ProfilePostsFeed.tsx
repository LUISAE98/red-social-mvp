//ProfilePostFeed.tsx
"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, Timestamp } from "firebase/firestore";

import type { Comment, CommentReply, Post } from "@/lib/posts/types";
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
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import { buildRandomRecommendationSlots } from "@/app/components/GroupRecommendations/recommendation-engine";
import {
  clearSlowLoadTimer,
  createSlowLoadTimer,
  loadFeedWithRetry,
} from "@/lib/posts/feed-load-helpers";

type ProfilePostsFeedProps = {
  profileUid: string;
  viewerUid: string | null;
  isOwner: boolean;
  showPosts?: boolean;
  profileRestricted?: boolean;
};

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;
type GroupRole = "owner" | "mod" | "member" | null;

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: any;
};

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
  const cacheKey = `${groupId}:${userId}`;
  const cached = membershipMetaMemoryCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      const emptyMeta = { status: null, mutedUntil: null, role: null };
      membershipMetaMemoryCache.set(cacheKey, emptyMeta);
      return emptyMeta;
    }

    const data = memberSnap.data() as any;

    const meta = {
      status: normalizeStatus(data?.status),
      mutedUntil: data?.mutedUntil ?? null,
      role: normalizeRole(data?.roleInGroup ?? data?.role),
    };

    membershipMetaMemoryCache.set(cacheKey, meta);

    return meta;
  } catch {
    return { status: null, mutedUntil: null, role: null };
  }
}

async function getViewerCanModerateGroup(
  groupId: string,
  viewerUid: string
): Promise<boolean> {
  const cacheKey = `${groupId}:${viewerUid}`;
  const cached = viewerModerationMemoryCache.get(cacheKey);

  if (typeof cached === "boolean") {
    return cached;
  }

  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    if (!groupSnap.exists()) {
      viewerModerationMemoryCache.set(cacheKey, false);
      return false;
    }

    const groupData = groupSnap.data() as any;

    if (groupData?.ownerId === viewerUid) {
      viewerModerationMemoryCache.set(cacheKey, true);
      return true;
    }

    const viewerMeta = await getMembershipMetaForGroup(groupId, viewerUid);

    const canModerate =
      viewerMeta.role === "mod" &&
      viewerMeta.status !== "banned" &&
      viewerMeta.status !== "removed";

    viewerModerationMemoryCache.set(cacheKey, canModerate);

    return canModerate;
  } catch {
    return false;
  }
}

async function filterBannedGroupPosts(
  inputPosts: Post[],
  currentViewerUid: string | null
): Promise<Post[]> {
  if (!currentViewerUid || inputPosts.length === 0) {
    return inputPosts;
  }

  const uniqueGroupIds = Array.from(
    new Set(
      inputPosts
        .map((post) => post.groupId)
        .filter(
          (groupId): groupId is string =>
            typeof groupId === "string" && groupId.trim().length > 0
        )
    )
  );

  if (uniqueGroupIds.length === 0) {
    return inputPosts;
  }

  const membershipChecks = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const meta = await getMembershipMetaForGroup(groupId, currentViewerUid);
      return [groupId, meta.status === "banned"] as const;
    })
  );

  const bannedByGroupId = new Map<string, boolean>(membershipChecks);

  return inputPosts.filter((post) => {
    const groupId =
      typeof post.groupId === "string" && post.groupId.trim().length > 0
        ? post.groupId
        : null;

    if (!groupId) return true;
    return bannedByGroupId.get(groupId) !== true;
  });
}

async function attachModerationFlags(
  posts: Post[],
  currentViewerUid: string | null
): Promise<PostWithFlags[]> {
  if (!currentViewerUid || posts.length === 0) {
    return posts as PostWithFlags[];
  }

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

  if (uniqueGroupIds.length === 0) {
    return posts as PostWithFlags[];
  }

  const moderationEntries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const canModerate = await getViewerCanModerateGroup(groupId, currentViewerUid);
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

function normalizeProfileFeedPost(post: PostWithFlags): PostWithFlags {
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
  baseId: string,
  posts: Array<{ id?: string; createdAt?: any }>
): number {
  const raw = [
    baseId,
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

const PROFILE_FEED_PAGE_SIZE = 10;
const PROFILE_FEED_CACHE_TTL_MS = 1000 * 60 * 5;
const VIDEO_PROCESSING_POLL_MS = 15_000;
const VIDEO_PROCESSING_MAX_POLLS = 20;

type ProfileFeedCacheEntry = {
  posts: PostWithFlags[];
  cursor: UserProfilePostsPageCursor | null;
  hasMore: boolean;
  updatedAt: number;
};

const profileFeedMemoryCache = new Map<string, ProfileFeedCacheEntry>();
const membershipMetaMemoryCache = new Map<
  string,
  {
    status: MemberStatus;
    mutedUntil: any | null;
    role: GroupRole;
  }
>();

const viewerModerationMemoryCache = new Map<string, boolean>();

function getProfileFeedCacheKey(params: {
  profileUid: string;
  viewerUid: string | null;
  isOwner: boolean;
  showPosts: boolean;
  profileRestricted: boolean;
}): string {
  return [
    "profile-feed",
    params.profileUid,
    params.viewerUid ?? "guest",
    params.isOwner ? "owner" : "viewer",
    params.showPosts ? "show" : "hidden",
    params.profileRestricted ? "restricted" : "open",
  ].join(":");
}


function sortProfileFeedPosts(posts: PostWithFlags[]): PostWithFlags[] {
  return [...posts].sort((a, b) => {
    const aPinned = a.isPinnedOnProfile === true;
    const bPinned = b.isPinnedOnProfile === true;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    const aPinnedAt = a.profilePinnedAt?.toMillis?.() ?? 0;
    const bPinnedAt = b.profilePinnedAt?.toMillis?.() ?? 0;

    if (aPinned && bPinned && aPinnedAt !== bPinnedAt) {
      return bPinnedAt - aPinnedAt;
    }

    const aCreatedAt = a.createdAt?.toMillis?.() ?? 0;
    const bCreatedAt = b.createdAt?.toMillis?.() ?? 0;

    return bCreatedAt - aCreatedAt;
  });
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

  return sortProfileFeedPosts(Array.from(map.values()));
}

export default function ProfilePostsFeed({
  profileUid,
  viewerUid,
  isOwner,
  showPosts = true,
  profileRestricted = false,
}: ProfilePostsFeedProps) {
  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pageCursor, setPageCursor] =
    useState<UserProfilePostsPageCursor | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isTakingTooLong, setIsTakingTooLong] = useState(false);

  const infiniteScrollTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const pageCursorRef = useRef<UserProfilePostsPageCursor | null>(null);
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
        setIsTakingTooLong(false);
        return;
      }

      if ((!showPosts || profileRestricted) && !isOwner) {
        setPosts([]);
        setPageCursor(null);
        setHasMore(false);
        setError(null);
        setLoadingInitial(false);
        setLoadingMore(false);
        setIsTakingTooLong(false);
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

      let slowLoadTimer: ReturnType<typeof setTimeout> | null = null;

      setIsTakingTooLong(false);

      slowLoadTimer = createSlowLoadTimer(() => {
        if (feedRequestIdRef.current === requestId) {
          setIsTakingTooLong(true);
        }
      }, 7000);

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
          {
            timeoutMs: mode === "more" ? 15000 : 12000,
            retries: 1,
            retryDelayMs: 900,
          }
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
      } catch (e: any) {
        if (feedRequestIdRef.current !== requestId) {
          return;
        }

        setError(
          e?.message ??
            "No se pudieron cargar las publicaciones. Intenta de nuevo."
        );
      } finally {
        clearSlowLoadTimer(slowLoadTimer);

        if (feedRequestIdRef.current === requestId) {
          setIsTakingTooLong(false);
        }

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
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar la flamita.");
      throw e;
    }
  }
  
async function handleToggleProfilePin(postId: string): Promise<void> {
  if (!isOwner) {
    throw new Error("Solo puedes fijar publicaciones en tu propio perfil.");
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
  } catch (e: any) {
    setError(
      e?.message ?? "No se pudo fijar o desfijar la publicación en tu perfil."
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
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el guardado.");
      throw e;
    }
  }

  async function handleDeletePost(postId: string) {
    try {
      setError(null);
      await softDeletePost(postId);

      removePostFromAllFeedCaches(postId);
    } catch (e: any) {
      setError(e?.message ?? "Error desconocido");
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: any) {
      setError(e?.message ?? "Error desconocido");
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
      setError(e?.message ?? "Error desconocido");
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
      setError(e?.message ?? "Error desconocido");
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

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  minWidth: 0,
  display: "grid",
  gap: 6,
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
      gap: 4,
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      paddingLeft: isMobile ? 8 : 0,
      paddingRight: isMobile ? 8 : 0,
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
      marginLeft: 0,
      marginRight: 0,
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

  const recommendationWrapperStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  const recommendationSlots = useMemo(() => {
    if (!viewerUid || posts.length === 0) {
      return new Set<number>();
    }

    const seed = buildStableFeedSeed(`${profileUid}:${viewerUid}`, posts);
    return buildRandomRecommendationSlots(posts.length, seed);
  }, [profileUid, viewerUid, posts]);

  const hasInlineRecommendation = useMemo(() => {
    return recommendationSlots.size > 0;
  }, [recommendationSlots]);

  if ((!showPosts || profileRestricted) && !isOwner) {
    return (
      <section style={shellStyle}>
        <div style={reservedStyle}>Perfil reservado</div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Publicaciones</h2>
        <p style={subtitleStyle}>
          Feed del perfil ordenado por antigüedad inversa.
        </p>
      </div>

      {error && <div style={noticeStyle}>{error}</div>}

      {isTakingTooLong && (
        <button
          type="button"
          onClick={() => void loadPostsPage("refresh")}
          style={{
            ...noticeStyle,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          Esto está tardando más de lo normal. Toca aquí para reintentar.
        </button>
      )}

      {loadingInitial && <div style={noticeStyle}>Cargando publicaciones...</div>}

      {!loadingInitial && posts.length === 0 && viewerUid && (
        <div style={recommendationWrapperStyle}>
          <GroupRecommendationsRail
            currentUserId={viewerUid}
            context="profile"
          />
        </div>
      )}

      {!loadingInitial && posts.length === 0 && !viewerUid && (
        <div style={noticeStyle}>
          Todavía no hay publicaciones visibles en este perfil.
        </div>
      )}

      {posts.map((post, index) => {
        const canDeletePost =
          viewerUid === post.authorId || post.canModerateGroupAuthor === true;

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
              onToggleProfilePin={isOwner ? handleToggleProfilePin : undefined}
              currentUserId={viewerUid}
              isOwner={false}
              isModerator={post.canModerateGroupAuthor === true}
              showGroupContext={true}
              canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              onModerationComplete={loadPosts}
            />

            {shouldRenderRecommendations && viewerUid && (
              <div style={recommendationWrapperStyle}>
                <GroupRecommendationsRail
                  currentUserId={viewerUid}
                  context="profile"
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

      {!loadingInitial &&
        posts.length > 0 &&
        !hasInlineRecommendation &&
        viewerUid && (
          <div style={recommendationWrapperStyle}>
            <GroupRecommendationsRail
              currentUserId={viewerUid}
              context="profile"
            />
          </div>
        )}
    </section>
  );
}