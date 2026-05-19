"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { auth, db, functions } from "@/lib/firebase";
import type { Comment, CommentReply, Post } from "@/lib/posts/types";
import {
  createImagePost,
  createPostComment,
  createPostCommentReply,
  createTextPost,
  createVideoPost,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchGroupPostsPage,
  fetchPostComments,
  softDeletePost,
  toggleGroupPostPin,
  togglePostFlame,
  togglePostSave,
  toggleProfilePostPin,
  type GroupPostsPageCursor,
} from "@/lib/posts/post-service";
import GroupPostCard from "./GroupPostCard";
import GroupPostComposer from "./GroupPostComposer";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import { uploadPostImages } from "@/lib/posts/image-upload";
import { httpsCallable } from "firebase/functions";

type InteractionBlockedReason = "login" | "join" | "restricted" | null;

type CreateMuxDirectUploadResponse = {
  provider: "mux";
  uploadId: string;
  uploadUrl: string;
  postId: string;
  status: string;
};

type GroupPostsFeedProps = {
  groupId: string;
  isOwner?: boolean;
  isModerator?: boolean;
  canCreatePosts?: boolean;
  canCommentOnPosts?: boolean;
  postBlockedReason?: InteractionBlockedReason;
  commentBlockedReason?: InteractionBlockedReason;
};

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;

type PostWithAuthorState = Post & {
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: any;
  forcedGroupId?: string | null;
};

async function getGroupMemberMeta(
  groupId: string,
  userId: string
): Promise<{ status: MemberStatus; mutedUntil: any | null }> {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      return { status: null, mutedUntil: null };
    }

    const data = memberSnap.data() as any;
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
  posts: Post[]
): Promise<PostWithAuthorState[]> {
  if (!posts.length) return posts as PostWithAuthorState[];

  const uniqueAuthorIds = Array.from(
    new Set(
      posts
        .map((post) => post.authorId)
        .filter(
          (authorId): authorId is string =>
            typeof authorId === "string" && authorId.trim().length > 0
        )
    )
  );

  const authorStatusEntries = await Promise.all(
    uniqueAuthorIds.map(async (authorId) => {
      const meta = await getGroupMemberMeta(groupId, authorId);
      return [authorId, meta] as const;
    })
  );

  const authorStatusMap = new Map<
    string,
    { status: MemberStatus; mutedUntil: any | null }
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
    return "Inicia sesión para comentar en esta comunidad.";
  }

  if (reason === "join") {
    return "Debes unirte a esta comunidad para comentar.";
  }

  if (reason === "restricted") {
    return "No puedes comentar en esta comunidad por la configuración actual o por tu estado dentro de la comunidad.";
  }

  return "No puedes comentar en esta comunidad en este momento.";
}
const GROUP_FEED_PAGE_SIZE = 10;
const GROUP_FEED_CACHE_TTL_MS = 1000 * 60 * 5;
const VIDEO_PROCESSING_POLL_MS = 1000 * 10;
const VIDEO_PROCESSING_MAX_POLLS = 24;

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

function sortGroupFeedPosts(posts: PostWithAuthorState[]): PostWithAuthorState[] {
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
  nextPosts: PostWithAuthorState[]
): PostWithAuthorState[] {
  const map = new Map<string, PostWithAuthorState>();

  currentPosts.forEach((post) => {
    if (post.id) map.set(post.id, post);
  });

  nextPosts.forEach((post) => {
    if (post.id) map.set(post.id, post);
  });

  return sortGroupFeedPosts(Array.from(map.values()));
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
  isOwner = false,
  isModerator = false,
  canCreatePosts = false,
  canCommentOnPosts = false,
  postBlockedReason = null,
  commentBlockedReason = null,
}: GroupPostsFeedProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [posts, setPosts] = useState<PostWithAuthorState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  const [videoUploadStatus, setVideoUploadStatus] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pageCursor, setPageCursor] = useState<GroupPostsPageCursor | null>(
    null
  );
  const [currentUid, setCurrentUid] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );

  const infiniteScrollTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const pageCursorRef = useRef<GroupPostsPageCursor | null>(null);
  const videoProcessingPollsRef = useRef<Record<string, number>>({});

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
    [groupId, currentUid]
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
    [cacheKey, groupId]
  );

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setCurrentUid(user?.uid ?? null);
    });

    return () => unsub();
  }, []);

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

      try {
        setError(null);

        const result = await fetchGroupPostsPage({
          groupId,
          viewerUid: currentUid,
          pageSize: GROUP_FEED_PAGE_SIZE,
          cursor: mode === "more" ? pageCursorRef.current : null,
        });

        const hydratedPosts = await attachAuthorMemberState(
          groupId,
          result.posts
        );

        const normalizedPosts = hydratedPosts.map(normalizeFeedPost);

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
      } catch (e: any) {
        setError(e?.message ?? "Error desconocido");
      } finally {
        if (mode === "more") {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        } else {
          setLoadingInitial(false);
        }
      }
    },
    [cacheKey, groupId, currentUid]
  );

  const loadPosts = useCallback(async () => {
    await loadPostsPage("refresh");
  }, [loadPostsPage]);

  useEffect(() => {
    let active = true;

    async function run() {
      const cached = groupFeedMemoryCache.get(cacheKey);
      const cacheIsFresh =
        !!cached && Date.now() - cached.updatedAt <= GROUP_FEED_CACHE_TTL_MS;

      if (cacheIsFresh) {
        setPosts(cached.posts);
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
  }, [groupId, currentUid, cacheKey, loadPostsPage]);

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

    async function refreshProcessingVideos() {
      await Promise.all(
        postIds.map(async (postId) => {
          const currentPollCount = videoProcessingPollsRef.current[postId] ?? 0;

          if (currentPollCount >= VIDEO_PROCESSING_MAX_POLLS) {
            return;
          }

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

            syncPostsState((prev) =>
              prev.map((post) =>
                post.id === postId
                  ? {
                      ...freshPost,
                      authorMemberStatus: post.authorMemberStatus,
                      authorMutedUntil: post.authorMutedUntil,
                      forcedGroupId: post.forcedGroupId ?? groupId,
                    }
                  : post
              )
            );

            if (isDone) {
              delete videoProcessingPollsRef.current[postId];
            }
          } catch {
            // Se ignora para no romper el feed por una lectura fallida temporal.
          }
        })
      );
    }

    void refreshProcessingVideos();

    const intervalId = window.setInterval(() => {
      void refreshProcessingVideos();
    }, VIDEO_PROCESSING_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
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
      }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [
    groupId,
    hasMore,
    loadingInitial,
    infiniteScrollTriggerIndex,
    loadPostsPage,
  ]);

  function redirectToLogin() {
    const nextPath = buildCurrentPathWithSearch(
      pathname || `/groups/${groupId}`,
      searchParams
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
    videoFile?: File | null;
  }) {
    if (!guardCreatePost()) return;

    try {
      setError(null);
      setComposerError(null);
      setVideoUploadProgress(null);
      setVideoUploadStatus(null);

      const cleanText = payload.text.trim();
      const imageFiles = payload.imageFiles ?? [];

      if (payload.videoFile) {
        setVideoUploadProgress(0);
        setVideoUploadStatus("Preparando subida de video...");

        const callable = httpsCallable<
          { groupId: string },
          CreateMuxDirectUploadResponse
        >(functions, "createMuxDirectUpload");

        const result = await callable({ groupId });
        const { uploadUrl, uploadId, postId } = result.data;

        setVideoUploadStatus("Creando publicación de video...");

        await createVideoPost({
          groupId,
          postId,
          uploadId,
          text: cleanText,
        });

        setVideoUploadStatus("Subiendo video a Mux...");

        await uploadVideoFileToMux({
          uploadUrl,
          file: payload.videoFile,
          onProgress: setVideoUploadProgress,
        });

        setVideoUploadStatus(
          "Video subido. Mux lo está procesando; aparecerá listo en unos momentos."
        );
      } else if (imageFiles.length > 0) {
        const uploadedImages = await uploadPostImages({
          groupId,
          files: imageFiles,
        });

        await createImagePost({
          groupId,
          text: cleanText,
          media: uploadedImages,
        });
      } else {
        await createTextPost({ groupId, text: cleanText });
      }

      await loadPosts();

      window.setTimeout(() => {
        setVideoUploadProgress(null);
        setVideoUploadStatus(null);
      }, 2500);
    } catch (e: any) {
      setComposerError(e?.message ?? "No se pudo publicar.");
      setVideoUploadStatus(null);
      setVideoUploadProgress(null);
    }
  }

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

    async function handleToggleGroupPin(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await toggleGroupPostPin(postId);

      syncPostsState((prev) =>
        sortGroupFeedPosts(
          prev.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  isPinnedInGroup: result.isPinnedInGroup,
                  groupPinnedAt: result.isPinnedInGroup
                    ? post.groupPinnedAt ?? null
                    : null,
                  groupPinnedBy: result.isPinnedInGroup
                    ? currentUid
                    : null,
                }
              : post
          )
        )
      );

      await loadPosts();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo fijar o desfijar la publicación.");
      throw e;
    }
  }
    async function handleToggleProfilePin(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await toggleProfilePostPin(postId);

      syncPostsState((prev) =>
        prev.map((post) =>
          post.id === postId
            ? {
                ...post,
                isPinnedOnProfile: result.isPinnedOnProfile,
                profilePinnedAt: result.isPinnedOnProfile
                  ? post.profilePinnedAt ?? null
                  : null,
                profilePinnedBy: result.isPinnedOnProfile ? currentUid : null,
              }
            : post
        )
      );

      await loadPosts();
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

      syncPostsState((prev) =>
        prev.map((post) => {
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
    if (!guardCreateComment()) {
      throw new Error(buildCommentBlockedMessage(commentBlockedReason));
    }

    try {
      setError(null);
      await createPostComment({ postId, text });

      return await syncPostCommentsCount(postId);
    } catch (e: any) {
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
    if (!guardCreateComment()) {
      throw new Error(buildCommentBlockedMessage(commentBlockedReason));
    }

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
    maxWidth: "100%",
    minWidth: 0,
    display: "grid",
    gap: 12,
    overflowX: "hidden",
    boxSizing: "border-box",
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
  };

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Publicaciones</h2>
        <p style={subtitleStyle}>Feed de la comunidad.</p>
      </div>

      {canCreatePosts ? (
        <div style={cardShellStyle}>
          <GroupPostComposer onSubmit={handleCreatePost} />

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
      ) : (
        <div style={interactionHintStyle}>
          {buildPostBlockedMessage(postBlockedReason)}
        </div>
      )}

      {!canCommentOnPosts && (
        <div style={interactionHintStyle}>
          {buildCommentBlockedMessage(commentBlockedReason)}
        </div>
      )}

      {composerError && <div style={composerErrorStyle}>{composerError}</div>}

      {error && <div style={noticeStyle}>{error}</div>}

      {loadingInitial && (
        <div style={noticeStyle}>Cargando publicaciones...</div>
      )}

      {!loadingInitial && posts.length === 0 && (
        <div style={noticeStyle}>
          Todavía no hay publicaciones en esta comunidad.
        </div>
      )}

      {posts.map((post, index) => {
        const canDeletePost =
          isOwner || isModerator || currentUid === post.authorId;

        const shouldAttachInfiniteScrollTarget =
          hasMore && index === infiniteScrollTriggerIndex;

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
              onToggleGroupPin={handleToggleGroupPin}
              onToggleProfilePin={handleToggleProfilePin}
              currentUserId={currentUid}
              isOwner={isOwner}
              isModerator={isModerator}
              showGroupContext={false}
              canModerateGroupAuthor={isOwner || isModerator}
              onModerationComplete={loadPosts}
              canCommentOnPosts={canCommentOnPosts}
              commentBlockedReason={commentBlockedReason}
            />
          </div>
        );
      })}

      {loadingMore && (
        <div style={noticeStyle}>Cargando más publicaciones...</div>
      )}

      {!loadingInitial && !loadingMore && posts.length > 0 && !hasMore && (
        <div style={noticeStyle}>Ya viste todas las publicaciones disponibles.</div>
      )}
    </section>
  );
}