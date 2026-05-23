"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import type { Comment, CommentReply, Post } from "@/lib/posts/types";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchPostComments,
  fetchPostFlameUsers,
  togglePostFlame,
  togglePostSave,
} from "@/lib/posts/post-service";
import PostCommentsPanel from "@/app/groups/[groupId]/components/posts/PostCommentsPanel";
import PostFlamesPanel, {
  type PostFlameUser,
} from "@/app/groups/[groupId]/components/posts/PostFlamesPanel";
import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";


export type PublicPostView = {
  id: string;
  text: string;

  authorId: string | null;
  authorName: string;
  authorUsername: string | null;
  authorAvatarUrl: string | null;

  groupId: string | null;
  groupName: string;
  groupAvatarUrl: string | null;

  createdAtMs: number | null;
  createdAtExactLabel: string | null;

  shareTitle: string | null;
  shareDescription: string | null;
  shareImageUrl: string | null;

  counts: {
    likes: number;
    comments: number;
    saves?: number;
  };

  postType?: Post["postType"];
  videoData?: Post["videoData"];
  playback?: Post["playback"];
  processing?: Post["processing"];

  media: Array<{
    type: "image" | "video";
    url: string;
    thumbnailUrl?: string | null;
    altText?: string | null;
    id?: string;
    index?: number;
    provider?: string | null;
    status?: string | null;
    uploadId?: string | null;
    assetId?: string | null;
    playbackId?: string | null;
    hlsUrl?: string | null;
    duration?: number | null;
  }>;
};

type PublicPostPageClientProps = {
  post: PublicPostView;
  postUrl: string;
};

function getInitials(name?: string | null): string {
  const cleanName = name?.trim();
  if (!cleanName) return "U";

  return cleanName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatRelativeFromMs(value: number | null): string {
  if (!value) return "Ahora mismo";

  const diffMs = Date.now() - value;
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 30) return "Ahora mismo";
  if (diffSeconds < 60) return `hace ${diffSeconds} segundos`;
  if (diffMinutes === 1) return "hace 1 minuto";
  if (diffMinutes < 60) return `hace ${diffMinutes} minutos`;
  if (diffHours === 1) return "hace 1 hora";
  if (diffHours < 24) return `hace ${diffHours} horas`;
  if (diffDays === 1) return "hace 1 día";
  if (diffDays < 7) return `hace ${diffDays} días`;
  if (diffWeeks === 1) return "hace 1 semana";
  if (diffWeeks < 5) return `hace ${diffWeeks} semanas`;
  if (diffMonths === 1) return "hace 1 mes";
  if (diffMonths < 12) return `hace ${diffMonths} meses`;
  if (diffYears === 1) return "hace 1 año";

  return `hace ${diffYears} años`;
}

function truncatePostText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;

  const sliced = text.slice(0, maxLength).trim();
  const lastSpace = sliced.lastIndexOf(" ");

  return `${sliced.slice(0, lastSpace > 40 ? lastSpace : sliced.length).trim()}...`;
}

export default function PublicPostPageClient({
  post,
  postUrl,
}: PublicPostPageClientProps) {
  const router = useRouter();

  const [currentUserId, setCurrentUserId] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );
  const [isMobile, setIsMobile] = useState(false);

  const [likesCount, setLikesCount] = useState(post.counts.likes);
  const [commentsCount, setCommentsCount] = useState(post.counts.comments);
  const [viewerHasFlamed, setViewerHasFlamed] = useState(false);
  const [flameBusy, setFlameBusy] = useState(false);
  const [savesCount, setSavesCount] = useState(post.counts.saves ?? 0);
  const [viewerHasSaved, setViewerHasSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [creatingComment, setCreatingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null
  );
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [flamesPanelOpen, setFlamesPanelOpen] = useState(false);
  const [flameUsers, setFlameUsers] = useState<PostFlameUser[]>([]);
  const [loadingFlameUsers, setLoadingFlameUsers] = useState(false);
  const [flameUsersError, setFlameUsersError] = useState<string | null>(null);

  const [selectedImage, setSelectedImage] = useState<{
    url: string;
    altText?: string | null;
  } | null>(null);

  const [showExactPostDate, setShowExactPostDate] = useState(false);
  const [postTextExpanded, setPostTextExpanded] = useState(false);
  const [relativeDateLabel, setRelativeDateLabel] = useState("");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setCurrentUserId(user?.uid ?? null);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(media.matches);

    update();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    setRelativeDateLabel(formatRelativeFromMs(post.createdAtMs));

    const timer = window.setInterval(() => {
      setRelativeDateLabel(formatRelativeFromMs(post.createdAtMs));
    }, 60000);

    return () => window.clearInterval(timer);
  }, [post.createdAtMs]);

  useEffect(() => {
    if (!inlineError) return;

    const timer = window.setTimeout(() => {
      setInlineError(null);
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [inlineError]);

  const entryHref = currentUserId ? "/" : "/login";
  const authorName = post.authorName || "Usuario";
  const groupName = post.groupName || "Comunidad";

  const authorHref = post.authorUsername
    ? `/u/${post.authorUsername}`
    : post.authorId
      ? `/u/${post.authorId}`
      : "/login";

  const groupHref = post.groupId ? `/groups/${post.groupId}` : "/";

  const imageMedia = useMemo(
    () => post.media.filter((item) => item.type === "image" && item.url),
    [post.media]
  );

  const videoMedia = useMemo(() => {
    const mediaVideos = post.media
      .filter((item) => item.type === "video")
      .map((item) => {
        const playbackUrl =
          typeof item.hlsUrl === "string" && item.hlsUrl.trim()
            ? item.hlsUrl.trim()
            : typeof item.url === "string" &&
                item.url.trim() &&
                !item.url.startsWith("mux://uploads/")
              ? item.url.trim()
              : null;

        const thumbnailUrl =
          typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim()
            ? item.thumbnailUrl.trim()
            : null;

        const status =
          typeof item.status === "string" && item.status.trim()
            ? item.status.trim()
            : null;

        const isReady =
          status === "ready" || Boolean(playbackUrl) || Boolean(item.hlsUrl);

        const isProcessing =
          status === "uploading" ||
          status === "processing" ||
          status === "pending" ||
          status === "created" ||
          (!isReady && status !== "error");

        return {
          ...item,
          playbackUrl,
          thumbnailUrl,
          status,
          isReady,
          isProcessing,
          isError: status === "error",
        };
      });

    if (mediaVideos.length > 0) {
      return mediaVideos;
    }

    const rootPlaybackUrl =
      typeof post.playback?.hlsUrl === "string" && post.playback.hlsUrl.trim()
        ? post.playback.hlsUrl.trim()
        : typeof post.playback?.url === "string" && post.playback.url.trim()
          ? post.playback.url.trim()
          : null;

    if (!rootPlaybackUrl && !post.videoData && !post.processing) {
      return [];
    }

    const rootThumbnailUrl =
      typeof post.playback?.thumbnailUrl === "string" &&
      post.playback.thumbnailUrl.trim()
        ? post.playback.thumbnailUrl.trim()
        : typeof post.videoData?.thumbnailUrl === "string" &&
            post.videoData.thumbnailUrl.trim()
          ? post.videoData.thumbnailUrl.trim()
          : null;

    const rootStatus =
      post.videoData?.status || post.processing?.status || null;

    return [
      {
        type: "video" as const,
        url: rootPlaybackUrl || rootThumbnailUrl || "",
        thumbnailUrl: rootThumbnailUrl,
        altText: "Video de la publicación",
        playbackId:
          post.playback?.playbackId || post.videoData?.playbackId || null,
        hlsUrl: post.playback?.hlsUrl || null,
        duration: post.playback?.duration || post.videoData?.duration || null,
        status: rootStatus,
        playbackUrl: rootPlaybackUrl,
        isReady:
          post.playback?.isReady === true ||
          rootStatus === "ready" ||
          Boolean(rootPlaybackUrl),
        isProcessing:
          rootStatus === "uploading" ||
          rootStatus === "processing" ||
          rootStatus === "pending" ||
          (!rootPlaybackUrl && rootStatus !== "error"),
        isError: rootStatus === "error",
      },
    ];
  }, [post.media, post.playback, post.processing, post.videoData]);

  const postForViewer: Post = {
    id: post.id,
    text: post.text,
    authorId: post.authorId || "",
    authorName: post.authorName,
    authorAvatarUrl: post.authorAvatarUrl,
    authorUsername: post.authorUsername,
    groupId: post.groupId || "",
    groupName: post.groupName,
    groupAvatarUrl: post.groupAvatarUrl,
    groupVisibility: "public",
    isDeleted: false,
    isLocked: false,
    isShareable: true,
    access: "free",
    accessModel: "free",
    media: post.media as Post["media"],
    counts: {
      likes: likesCount,
      comments: commentsCount,
      saves: savesCount,
    },
    viewerHasFlamed,
    viewerHasSaved,
    postType:
      post.postType ??
      (videoMedia.length > 0
        ? "video"
        : imageMedia.length > 0
          ? "image"
          : "text"),
    videoData: post.videoData ?? null,
    playback: post.playback ?? null,
    processing: post.processing ?? null,
  };

  function requireLogin(message: string) {
    setInlineError(message);
    router.push(`/login?next=${encodeURIComponent(`/p/${post.id}`)}`);
  }

  async function handleShare() {
    const shareTitle = post.shareTitle || "Publicación";
    const shareText =
      post.shareDescription || post.text || "Mira esta publicación.";

    if (navigator.share) {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: postUrl,
      });
      return;
    }

    await navigator.clipboard.writeText(postUrl);
    window.alert("Link copiado.");
  }

  async function handleToggleFlame() {
    if (!currentUserId) {
      requireLogin("Inicia sesión para dar flamita.");
      return;
    }

    if (flameBusy) return;

    try {
      setFlameBusy(true);
      setInlineError(null);

      const result = await togglePostFlame(post.id);
      setViewerHasFlamed(result.liked);
      setLikesCount(result.likes);
    } catch (e: any) {
      setInlineError(e?.message ?? "No se pudo actualizar la flamita.");
    } finally {
      setFlameBusy(false);
    }
  }
  async function handleToggleSave() {
    if (!currentUserId) {
      requireLogin("Inicia sesión para guardar publicaciones.");
      return;
    }

    if (saveBusy) return;

    try {
      setSaveBusy(true);
      setInlineError(null);

      const result = await togglePostSave(post.id);

      setViewerHasSaved(result.saved);
      setSavesCount((prev) => Math.max(0, prev + result.delta));
    } catch (e: any) {
      setInlineError(e?.message ?? "No se pudo actualizar el guardado.");
    } finally {
      setSaveBusy(false);
    }
  }
  async function handleOpenFlamesPanel() {
    if (!currentUserId) {
      requireLogin("Inicia sesión para ver quién dio flamita.");
      return;
    }

    try {
      setFlamesPanelOpen(true);
      setLoadingFlameUsers(true);
      setFlameUsersError(null);

      const users = await fetchPostFlameUsers(post.id);
      setFlameUsers(users);
    } catch (e: any) {
      setFlameUsersError(e?.message ?? "No se pudieron cargar las flamitas.");
    } finally {
      setLoadingFlameUsers(false);
    }
  }

  async function handleOpenCommentsPanel() {
    setCommentsPanelOpen(true);

    if (comments !== null) return;

    try {
      setLoadingComments(true);
      setInlineError(null);

      const nextComments = await fetchPostComments(post.id);
      setComments(nextComments);
    } catch (e: any) {
      setInlineError(e?.message ?? "No se pudieron cargar los comentarios.");
    } finally {
      setLoadingComments(false);
    }
  }

  async function syncPostCommentsCount() {
    const nextComments = await fetchPostComments(post.id);

    const repliesCounts = await Promise.all(
      nextComments.map(async (comment) => {
        try {
          const replies = await fetchCommentReplies({
            postId: post.id,
            commentId: comment.id,
          });

          return replies.length;
        } catch {
          return comment.counts?.replies ?? 0;
        }
      })
    );

    const total =
      nextComments.length +
      repliesCounts.reduce((sum, count) => sum + count, 0);

    setComments(nextComments);
    setCommentsCount(total);

    return nextComments;
  }

  async function handleCreateComment(): Promise<void> {
    if (!currentUserId) {
      requireLogin("Inicia sesión para comentar.");
      return;
    }

    const cleanText = commentText.trim();
    if (!cleanText || creatingComment) return;

    try {
      setCreatingComment(true);
      setInlineError(null);

      await createPostComment({
        postId: post.id,
        text: cleanText,
      });

      setCommentText("");
      await syncPostCommentsCount();
    } catch (e: any) {
      setInlineError(e?.message ?? "No se pudo comentar.");
    } finally {
      setCreatingComment(false);
    }
  }

  async function handleDeleteComment(commentId: string): Promise<void> {
    if (!currentUserId) {
      requireLogin("Inicia sesión para eliminar comentarios.");
      return;
    }

    try {
      setDeletingCommentId(commentId);
      await deletePostComment({
        postId: post.id,
        commentId,
      });
      await syncPostCommentsCount();
    } finally {
      setDeletingCommentId(null);
    }
  }

  async function handleLoadReplies(
    postId: string,
    commentId: string
  ): Promise<CommentReply[]> {
    return fetchCommentReplies({ postId, commentId });
  }

  async function handleCreateReply(
    postId: string,
    commentId: string,
    text: string
  ): Promise<CommentReply[]> {
    if (!currentUserId) {
      requireLogin("Inicia sesión para responder.");
      return [];
    }

    await createPostCommentReply({ postId, commentId, text });
    await syncPostCommentsCount();

    return fetchCommentReplies({ postId, commentId });
  }

  async function handleDeleteReply(
    postId: string,
    commentId: string,
    replyId: string
  ): Promise<CommentReply[]> {
    if (!currentUserId) {
      requireLogin("Inicia sesión para eliminar respuestas.");
      return [];
    }

    await deletePostCommentReply({ postId, commentId, replyId });
    await syncPostCommentsCount();

    return fetchCommentReplies({ postId, commentId });
  }

  async function handleLoadCommentsForCard(postId: string): Promise<Comment[]> {
  await handleOpenCommentsPanel();
  return comments ?? [];
}

async function handleCreateCommentForCard(
  postId: string,
  text: string
): Promise<Comment[]> {
  if (!currentUserId) {
    requireLogin("Inicia sesión para comentar.");
    return comments ?? [];
  }

  const cleanText = text.trim();
  if (!cleanText) return comments ?? [];

  await createPostComment({
    postId,
    text: cleanText,
  });

  return await syncPostCommentsCount();
}

async function handleDeleteCommentForCard(
  postId: string,
  commentId: string
): Promise<Comment[]> {
  await handleDeleteComment(commentId);
  return comments ?? [];
}

async function handleToggleFlameForCard(postId: string): Promise<void> {
  await handleToggleFlame();
}

async function handleToggleSaveForCard(postId: string): Promise<void> {
  await handleToggleSave();
}

  const commentsPanel = (
    <PostCommentsPanel
      open={commentsPanelOpen || selectedImage !== null}
      isMobile={selectedImage !== null ? false : isMobile}
      postId={post.id}
      comments={comments}
      loading={loadingComments}
      currentUserId={currentUserId}
      isOwner={currentUserId === post.authorId}
      isModerator={false}
      canCommentOnPosts={!!currentUserId}
      commentBlockedMessage="Inicia sesión para comentar."
      commentText={commentText}
      creatingComment={creatingComment}
      deletingCommentId={deletingCommentId}
      inlineError={inlineError}
      onCommentTextChange={setCommentText}
      onClose={() => setCommentsPanelOpen(false)}
      onCreateComment={handleCreateComment}
      onDeleteComment={handleDeleteComment}
      onLoadReplies={handleLoadReplies}
      onCreateReply={handleCreateReply}
      onDeleteReply={handleDeleteReply}
    />
  );

  return (
    <main className="relative z-10 min-h-screen bg-transparent text-white">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-0 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-0">
          <Link
            href="/"
            className="text-sm font-semibold text-neutral-300 transition hover:text-white"
          >
            Vibra
          </Link>

          <Link
            href={entryHref}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Login
          </Link>
        </div>

<div className="relative z-10">
<GroupPostCard
  post={postForViewer}
  canDelete={false}
  onLoadComments={handleLoadCommentsForCard}
  onCreateComment={handleCreateCommentForCard}
  onDeleteComment={handleDeleteCommentForCard}
  onLoadReplies={handleLoadReplies}
  onCreateReply={handleCreateReply}
  onDeleteReply={handleDeleteReply}
  onToggleFlame={handleToggleFlameForCard}
  onToggleSave={handleToggleSaveForCard}
  currentUserId={currentUserId}
  isOwner={currentUserId === post.authorId}
  isModerator={false}
  showGroupContext={true}
  canModerateGroupAuthor={false}
/>
</div>

{inlineError ? (
  <div className="mx-3 rounded-lg border border-red-400/25 bg-red-950/30 px-3 py-2 text-xs text-red-100 sm:mx-0">
    {inlineError}
  </div>
) : null}

        <div className="mx-3 rounded-xl border border-white/10 bg-neutral-900/80 p-4 text-center backdrop-blur-md sm:mx-0">
          <p className="text-sm text-neutral-300">
            Para comentar, reaccionar o ver más contenido, entra a Vibra.
          </p>

          <Link
            href={entryHref}
            className="mt-4 inline-flex rounded-lg bg-white px-5 py-2 text-sm font-bold text-neutral-950 transition hover:bg-neutral-200"
          >
            Entrar a Vibra
          </Link>
        </div>
      </section>

      <PostFlamesPanel
        open={flamesPanelOpen}
        loading={loadingFlameUsers}
        error={flameUsersError}
        users={flameUsers}
        onClose={() => setFlamesPanelOpen(false)}
      />
    </main>
  );
}