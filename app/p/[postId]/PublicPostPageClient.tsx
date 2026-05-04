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
} from "@/lib/posts/post-service";
import PostCommentsPanel from "@/app/groups/[groupId]/components/posts/PostCommentsPanel";
import PostFlamesPanel, {
  type PostFlameUser,
} from "@/app/groups/[groupId]/components/posts/PostFlamesPanel";
import PostImageViewer from "@/app/groups/[groupId]/components/posts/PostImageViewer";

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
  };

  media: Array<{
    type: "image" | "video";
    url: string;
    thumbnailUrl?: string | null;
    altText?: string | null;
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
    media: post.media,
    counts: {
      likes: likesCount,
      comments: commentsCount,
    },
    viewerHasFlamed,
    postType: imageMedia.length > 0 ? "image" : "text",
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
    <main className="min-h-screen bg-neutral-950 text-white">
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

        <article className="overflow-hidden border-y border-white/10 bg-neutral-950 sm:rounded-xl sm:border sm:bg-neutral-900/70">
          <div className="flex items-start gap-3 p-3 sm:p-4">
            <Link href={authorHref} className="shrink-0">
              <div className="h-10 w-10 overflow-hidden rounded-full bg-neutral-800">
                {post.authorAvatarUrl ? (
                  <img
                    src={post.authorAvatarUrl}
                    alt={authorName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-bold text-neutral-200">
                    {getInitials(authorName)}
                  </div>
                )}
              </div>
            </Link>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <Link
                  href={authorHref}
                  className="truncate text-sm font-semibold text-white hover:underline"
                >
                  {authorName}
                </Link>

                <span className="h-3 w-px shrink-0 bg-white/10" />

                <Link
                  href={groupHref}
                  className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-neutral-300 hover:text-white"
                >
                  <span className="h-4 w-4 shrink-0 overflow-hidden rounded-full bg-neutral-800">
                    {post.groupAvatarUrl ? (
                      <img
                        src={post.groupAvatarUrl}
                        alt={groupName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-[8px] font-bold">
                        {getInitials(groupName)}
                      </span>
                    )}
                  </span>
                  <span className="truncate">{groupName}</span>
                </Link>
              </div>

              <button
                type="button"
                onClick={() => setShowExactPostDate((prev) => !prev)}
                className="mt-0.5 block max-w-full truncate border-0 bg-transparent p-0 text-left text-xs text-neutral-500"
                title={post.createdAtExactLabel || undefined}
              >
                {post.authorUsername ? `@${post.authorUsername}` : "@usuario"}
                {" · "}
                {showExactPostDate
                  ? post.createdAtExactLabel || "Fecha no disponible"
                  : relativeDateLabel || "Ahora mismo"}
              </button>
            </div>
          </div>

          {post.text ? (
            <div className="px-3 pb-4 text-[15px] leading-relaxed text-neutral-100 sm:px-4">
              <p className="whitespace-pre-wrap break-words">{post.text}</p>
            </div>
          ) : null}

          {imageMedia.length > 0 ? (
            <div
              className={
                imageMedia.length === 1
                  ? "grid w-full grid-cols-1 gap-0 bg-black"
                  : "grid w-full grid-cols-2 gap-0.5 bg-black"
              }
            >
              {imageMedia.map((item, index) => (
                <button
                  key={`${item.url}-${index}`}
                  type="button"
                  onClick={() => {
                    setSelectedImage({
                      url: item.url,
                      altText: item.altText || null,
                    });
                    void handleOpenCommentsPanel();
                  }}
                  className={
                    imageMedia.length === 1
                      ? "aspect-video w-full overflow-hidden bg-neutral-800"
                      : "aspect-square w-full overflow-hidden bg-neutral-800"
                  }
                >
                  <img
                    src={item.url}
                    alt={
                      item.altText ||
                      post.shareTitle ||
                      `Imagen ${index + 1} del post`
                    }
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-neutral-400 sm:px-4">
            <div className="flex items-center gap-4">
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleToggleFlame}
                  disabled={flameBusy}
                  className="grid h-6 w-6 place-items-center border-0 bg-transparent p-0 text-base"
                  aria-label="Dar flamita"
                >
                  <span className={viewerHasFlamed ? "" : "grayscale opacity-60"}>
                    🔥
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenFlamesPanel}
                  className="border-0 bg-transparent p-0 text-xs font-semibold text-neutral-400"
                  aria-label="Ver usuarios que dieron flamita"
                >
                  {likesCount}
                </button>
              </div>

              <button
                type="button"
                onClick={handleOpenCommentsPanel}
                className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-semibold text-neutral-400"
                aria-label="Abrir comentarios"
              >
                <span className="text-base">💬</span>
                <span>{commentsCount}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleShare}
              className="grid h-8 w-8 place-items-center rounded-lg text-lg transition hover:bg-white/10"
              aria-label="Compartir publicación"
              title="Compartir publicación"
            >
              📤
            </button>
          </div>

          {inlineError ? (
            <div className="mx-3 mb-3 rounded-lg border border-red-400/25 bg-red-950/30 px-3 py-2 text-xs text-red-100 sm:mx-4">
              {inlineError}
            </div>
          ) : null}

          {commentsPanelOpen && selectedImage === null ? (
            <div className="border-t border-white/10 px-3 py-3 sm:px-4">
              {commentsPanel}
            </div>
          ) : null}
        </article>

        <div className="mx-3 rounded-xl border border-white/10 bg-neutral-900 p-4 text-center sm:mx-0">
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

      <PostImageViewer
        open={selectedImage !== null}
        isMobile={isMobile}
        image={selectedImage}
        post={postForViewer}
        author={{
          authorName,
          avatarUrl: post.authorAvatarUrl,
          profileHref: authorHref,
        }}
        group={
          post.groupName || post.groupId
            ? {
                name: groupName,
                avatarUrl: post.groupAvatarUrl,
                href: post.groupId ? groupHref : null,
              }
            : null
        }
        authorStatusBadge={null}
        relativeDate={relativeDateLabel || "Ahora mismo"}
        exactDate={post.createdAtExactLabel || "Fecha no disponible"}
        likesCount={likesCount}
        commentsCount={commentsCount}
        viewerHasFlamed={viewerHasFlamed}
        flameBusy={flameBusy}
        commentsContent={commentsPanel}
        onClose={() => {
          setSelectedImage(null);
          setCommentsPanelOpen(false);
        }}
        onToggleFlame={handleToggleFlame}
        onOpenFlames={handleOpenFlamesPanel}
        onOpenComments={() => {
          void handleOpenCommentsPanel();
        }}
      />

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