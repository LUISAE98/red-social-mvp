"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import type { Comment, CommentImage, CommentMention, CommentReply, Post, PostPremium } from "@/lib/posts/types";
import { useUnlockedPostIds } from "@/lib/posts/useUnlockedPostIds";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchPostComments,
  togglePostFlame,
  togglePostSave,
} from "@/lib/posts/post-service";
import PostFlamesPanel, {
  type PostFlameUser,
} from "@/app/groups/[groupId]/components/posts/PostFlamesPanel";
import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";

export type PublicPostView = {
  id: string;
  text: string;

  contextType: "group" | "profile";

  authorId: string | null;
  authorName: string;
  authorUsername: string | null;
  authorAvatarUrl: string | null;

  groupId: string | null;
  groupName: string | null;
  groupAvatarUrl: string | null;

  profileId: string | null;
  profileName: string | null;
  profileUsername: string | null;
  profileAvatarUrl: string | null;
  profileRestricted: boolean | null;

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

  premium: PostPremium | null;
  access: "free" | "paid";
  accessModel: "free" | "one_time_purchase";
  requiresPayment: boolean;
  requiresSubscription: boolean;
  oneTimePrice: number | null;
  currency: string | null;
  purchaseType: Post["purchaseType"];

  media: Array<{
    type: "image" | "video";
    url: string;
    thumbnailUrl?: string | null;
    thumbnailPath?: string | null;
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

export default function PublicPostPageClient({
  post,
}: PublicPostPageClientProps) {
  const router = useRouter();

  const [currentUserId, setCurrentUserId] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );
  // Desbloqueo premium persistente del viewer (cualquier dispositivo).
  const unlockedPostIds = useUnlockedPostIds(currentUserId);
  const [likesCount, setLikesCount] = useState(post.counts.likes);
  const [commentsCount, setCommentsCount] = useState(post.counts.comments);
  const [viewerHasFlamed, setViewerHasFlamed] = useState(false);
  const [flameBusy, setFlameBusy] = useState(false);
  const [savesCount, setSavesCount] = useState(post.counts.saves ?? 0);
  const [viewerHasSaved, setViewerHasSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [, setLoadingComments] = useState(false);
  const [, setDeletingCommentId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [flamesPanelOpen, setFlamesPanelOpen] = useState(false);
  const [flameUsers] = useState<PostFlameUser[]>([]);
  const [loadingFlameUsers] = useState(false);
  const [flameUsersError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setCurrentUserId(user?.uid ?? null);
    });

    return () => unsub();
  }, []);

  // Con sesión iniciada, esta página de "compartir" (pública, con muro de login)
  // no aplica: llevamos al usuario a la vista interna e interactiva del post.
  useEffect(() => {
    if (currentUserId) {
      router.replace(`/post/${post.id}`);
    }
  }, [currentUserId, post.id, router]);

  useEffect(() => {
    if (!inlineError) return;

    const timer = window.setTimeout(() => {
      setInlineError(null);
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [inlineError]);

  const entryHref = currentUserId ? "/" : "/login";

  const imageMedia = useMemo(
    () =>
      post.media.filter(
        (item) => item.type === "image" && item.url.trim().length > 0
      ),
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

    const rootStatus = post.videoData?.status || post.processing?.status || null;

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

    const isProfilePost = post.contextType === "profile";

  const postForViewer: Post = {
    id: post.id,
    text: post.text,

    contextType: post.contextType,

    authorId: post.authorId || "",
    authorName: post.authorName,
    authorAvatarUrl: post.authorAvatarUrl,
    authorUsername: post.authorUsername,

    groupId: isProfilePost ? null : post.groupId || "",
    groupName: isProfilePost ? null : post.groupName,
    groupAvatarUrl: isProfilePost ? null : post.groupAvatarUrl,
    groupVisibility: isProfilePost ? null : "public",

    profileId: isProfilePost ? post.profileId || post.authorId : null,
    profileName: isProfilePost ? post.profileName || post.authorName : null,
    profileAvatarUrl: isProfilePost
      ? post.profileAvatarUrl || post.authorAvatarUrl
      : null,
    profileUsername: isProfilePost
      ? post.profileUsername || post.authorUsername
      : null,
    profileRestricted: isProfilePost ? post.profileRestricted === true : null,

    isDeleted: false,
    isLocked: false,
    isShareable: true,

    premium: post.premium ?? null,
    access: post.access ?? "free",
    accessModel: post.accessModel ?? "free",
    accessScope: isProfilePost ? "profile" : "group",
    requiresPayment: post.requiresPayment ?? false,
    requiresSubscription: post.requiresSubscription ?? false,
    oneTimePrice: post.oneTimePrice ?? null,
    currency: post.currency ?? null,
    purchaseType: post.purchaseType ?? null,

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
    processing: post.processing ?? {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
  };

  function requireLogin(message: string) {
    setInlineError(message);
    router.push(`/login?next=${encodeURIComponent(`/p/${post.id}`)}`);
  }

  async function handleToggleFlame() {
    if (!currentUserId) {
      requireLogin("Inicia sesión para dar flamita.");
      return;
    }

    if (flameBusy) return;

    const previousViewerHasFlamed = viewerHasFlamed;
    const previousLikesCount = likesCount;
    const nextViewerHasFlamed = !previousViewerHasFlamed;

    setInlineError(null);
    setViewerHasFlamed(nextViewerHasFlamed);
    setLikesCount((current) =>
      Math.max(0, current + (nextViewerHasFlamed ? 1 : -1))
    );

    try {
      setFlameBusy(true);

      const result = await togglePostFlame(post.id);
      setViewerHasFlamed(result.liked);
      setLikesCount(result.likes);
    } catch (e: unknown) {
      setViewerHasFlamed(previousViewerHasFlamed);
      setLikesCount(previousLikesCount);
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudo actualizar la flamita.");
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

    const previousViewerHasSaved = viewerHasSaved;
    const previousSavesCount = savesCount;
    const nextViewerHasSaved = !previousViewerHasSaved;

    setInlineError(null);
    setViewerHasSaved(nextViewerHasSaved);
    setSavesCount((current) =>
      Math.max(0, current + (nextViewerHasSaved ? 1 : -1))
    );

    try {
      setSaveBusy(true);

      const result = await togglePostSave(post.id);
      setViewerHasSaved(result.saved);
      setSavesCount(Math.max(0, previousSavesCount + result.delta));
    } catch (e: unknown) {
      setViewerHasSaved(previousViewerHasSaved);
      setSavesCount(previousSavesCount);
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudo actualizar el guardado.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function syncPostCommentsCount() {
    const nextComments = await fetchPostComments(post.id);

    const total = nextComments.reduce(
      (sum, c) => sum + 1 + (c.counts?.replies ?? 0),
      0
    );

    setComments(nextComments);
    setCommentsCount(total);

    return nextComments;
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
    text: string,
    mentions?: CommentMention[],
    image?: CommentImage | null
  ): Promise<CommentReply[]> {
    if (!currentUserId) {
      requireLogin("Inicia sesión para responder.");
      return [];
    }

    await createPostCommentReply({ postId, commentId, text, mentions, image });
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
    try {
      setLoadingComments(true);
      setInlineError(null);

      const nextComments = await fetchPostComments(postId);

      setComments(nextComments);
      setCommentsCount((current) =>
        Math.max(
          current,
          nextComments.reduce(
            (total, comment) => total + 1 + (comment.counts?.replies ?? 0),
            0
          )
        )
      );

      return nextComments;
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudieron cargar los comentarios.");
      return comments ?? [];
    } finally {
      setLoadingComments(false);
    }
  }

  async function handleCreateCommentForCard(
    postId: string,
    text: string,
    mentions?: CommentMention[],
    image?: CommentImage | null
  ): Promise<Comment[]> {
    if (!currentUserId) {
      requireLogin("Inicia sesión para comentar.");
      return comments ?? [];
    }

    const cleanText = text.trim();
    if (!cleanText && !image) return comments ?? [];

    await createPostComment({
      postId,
      text: cleanText,
      mentions,
      image,
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

  async function handleToggleFlameForCard(): Promise<void> {
    await handleToggleFlame();
  }

  async function handleToggleSaveForCard(): Promise<void> {
    await handleToggleSave();
  }

  return (
    <main className="relative z-10 min-h-screen bg-transparent text-white">
            <section className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-0 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-0">
          <Link href="/" aria-label="Vibra" className="vibra-brand">
            Vibra
          </Link>

          {/* "Login" estaba en inglés en una página que por lo demás va toda en
              español, y con un recuadro de borde que no existe en ningún otro
              sitio del producto. Ahora es el mismo botón —y la misma palabra—
              que ve quien abre un perfil o una comunidad sin sesión. */}
          <Link href={entryHref} className="vibra-auth-cta">
            Iniciar sesión
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
            forceUnlocked={unlockedPostIds.has(post.id)}
            isOwner={currentUserId === post.authorId}
            isModerator={false}
            showGroupContext={!isProfilePost}
            canModerateGroupAuthor={false}
          />
        </div>

        {inlineError ? (
          <div className="mx-3 rounded-lg border border-red-400/25 bg-red-950/30 px-3 py-2 text-xs text-red-100 sm:mx-0">
            {inlineError}
          </div>
        ) : null}

        {/* Sin caja: ni contorno, ni fondo, ni desenfoque. Era una tarjeta
            dentro de otra tarjeta, y el recuadro competía con el de la propia
            publicación, que es lo que se vino a ver. El texto y el botón se
            sostienen solos sobre el fondo. */}
        <div className="mx-3 p-4 text-center sm:mx-0">
          <p className="text-sm text-neutral-300">
            Para comentar, reaccionar o ver más contenido, entra a Vibra.
          </p>

          <Link href={entryHref} className="vibra-auth-cta mt-4">
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
