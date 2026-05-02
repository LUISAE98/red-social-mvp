"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react";
import type { Comment, CommentReply } from "@/lib/posts/types";
import { toggleCommentFlame } from "@/lib/posts/post-service";

type PostCommentThreadProps = {
  postId: string;
  comment: Comment;
  currentUserId?: string | null;
  isOwner?: boolean;
  isModerator?: boolean;
  canCommentOnPosts: boolean;
  deletingCommentId: string | null;
  onDeleteComment: (commentId: string) => Promise<void>;
  onLoadReplies: (postId: string, commentId: string) => Promise<CommentReply[]>;
  onCreateReply: (
    postId: string,
    commentId: string,
    text: string
  ) => Promise<CommentReply[]>;
  onDeleteReply: (
    postId: string,
    commentId: string,
    replyId: string
  ) => Promise<CommentReply[]>;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function getDateFromTimestamp(value?: { toDate?: () => Date } | null) {
  if (!value?.toDate) return null;

  try {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

function formatExactDate(value?: { toDate?: () => Date } | null) {
  const date = getDateFromTimestamp(value);

  if (!date) return "Fecha no disponible";

  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Fecha no disponible";
  }
}

function formatRelativeDate(value?: { toDate?: () => Date } | null) {
  const date = getDateFromTimestamp(value);

  if (!date) return "Ahora mismo";

  const diffMs = Date.now() - date.getTime();
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

function getAuthorInfo(entity: {
  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  authorUsername?: string | null;
}) {
  const authorId = entity.authorId || "";

  const authorName =
    typeof entity.authorName === "string" && entity.authorName.trim().length > 0
      ? entity.authorName.trim()
      : authorId || "Usuario";

  const avatarUrl =
    typeof entity.authorAvatarUrl === "string" &&
    entity.authorAvatarUrl.trim().length > 0
      ? entity.authorAvatarUrl.trim()
      : null;

  const username =
    typeof entity.authorUsername === "string" &&
    entity.authorUsername.trim().length > 0
      ? entity.authorUsername.trim()
      : null;

  return {
    authorId,
    authorName,
    avatarUrl,
    profileHref: username ? `/u/${username}` : `/u/${authorId}`,
  };
}

function Avatar({
  name,
  avatarUrl,
  size = 30,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#fff",
        fontSize: Math.max(10, Math.floor(size * 0.32)),
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

function AutoGrowTextarea({
  value,
  maxRows = 3,
  style,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style"> & {
  maxRows?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    el.style.height = "0px";

    const computed = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(computed.lineHeight || "20") || 20;
    const paddingTop = Number.parseFloat(computed.paddingTop || "0") || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom || "0") || 0;
    const borderTop = Number.parseFloat(computed.borderTopWidth || "0") || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth || "0") || 0;

    const maxHeight =
      lineHeight * maxRows + paddingTop + paddingBottom + borderTop + borderBottom;

    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxRows]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      rows={1}
      onInput={(event) => {
        resize();
        props.onInput?.(event);
      }}
      style={style}
    />
  );
}

export default function PostCommentThread({
  postId,
  comment,
  currentUserId = null,
  isOwner = false,
  isModerator = false,
  canCommentOnPosts,
  deletingCommentId,
  onDeleteComment,
  onLoadReplies,
  onCreateReply,
  onDeleteReply,
}: PostCommentThreadProps) {
  const [replies, setReplies] = useState<CommentReply[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyBoxOpen, setReplyBoxOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [creatingReply, setCreatingReply] = useState(false);
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [commentLiked, setCommentLiked] = useState(
  comment.viewerHasFlamed === true
);
const [commentLikes, setCommentLikes] = useState(comment.counts?.likes ?? 0);
const [localReplyCount, setLocalReplyCount] = useState(
  comment.counts?.replies ?? 0
);
const [commentFlameBusy, setCommentFlameBusy] = useState(false);
const [showExactCommentDate, setShowExactCommentDate] = useState(false);
const [exactReplyDates, setExactReplyDates] = useState<Record<string, boolean>>({});

  const author = getAuthorInfo(comment);
  const canDeleteComment =
    isOwner || isModerator || currentUserId === comment.authorId;

 const replyCount = localReplyCount;
  const hasRepliesToLoad = replyCount > 0;

  async function handleLoadReplies() {
    if (replies !== null || loadingReplies) return;

    try {
      setLoadingReplies(true);
      setInlineError(null);

      const nextReplies = await onLoadReplies(postId, comment.id);
      setReplies(nextReplies);
    } catch (e: any) {
      setInlineError(e?.message ?? "No se pudieron cargar las respuestas.");
    } finally {
      setLoadingReplies(false);
    }
  }

  async function handleCreateReply() {
    if (!canCommentOnPosts || creatingReply || replyText.trim().length === 0) {
      return;
    }

    try {
      setCreatingReply(true);
      setInlineError(null);

      const nextReplies = await onCreateReply(
        postId,
        comment.id,
        replyText.trim()
      );

      setReplies(nextReplies);
      setLocalReplyCount(nextReplies.length);
      setReplyText("");
      setReplyBoxOpen(false);
    } catch (e: any) {
      setInlineError(e?.message ?? "No se pudo responder.");
    } finally {
      setCreatingReply(false);
    }
  }

  async function handleDeleteReply(replyId: string) {
    if (deletingReplyId) return;

    try {
      setDeletingReplyId(replyId);
      setInlineError(null);

      const nextReplies = await onDeleteReply(postId, comment.id, replyId);
      setReplies(nextReplies);
      setLocalReplyCount(nextReplies.length);
    } catch (e: any) {
      setInlineError(e?.message ?? "No se pudo eliminar la respuesta.");
    } finally {
      setDeletingReplyId(null);
    }
  }

  async function handleToggleCommentFlame() {
  if (!currentUserId) {
    setInlineError("Inicia sesión para dar flamita.");
    return;
  }

  if (commentFlameBusy) return;

  try {
    setCommentFlameBusy(true);
    setInlineError(null);

    const result = await toggleCommentFlame({
      postId,
      commentId: comment.id,
    });

    setCommentLiked(result.liked);
    setCommentLikes(result.likes);
  } catch (e: any) {
    setInlineError(e?.message ?? "No se pudo actualizar la flamita.");
  } finally {
    setCommentFlameBusy(false);
  }
}

  const actionButtonStyle: CSSProperties = {
    border: "none",
    background: "transparent",
    padding: 0,
    color: "rgba(255,255,255,0.58)",
    fontSize: 11.5,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const dangerButtonStyle: CSSProperties = {
    ...actionButtonStyle,
    color: "#ff8a8a",
  };

  const disabledActionButtonStyle: CSSProperties = {
    ...actionButtonStyle,
    color: "rgba(255,255,255,0.36)",
    cursor: "not-allowed",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: 34,
    maxHeight: 84,
    padding: 0,
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    background: "transparent",
    color: "#fff",
    outline: "none",
    resize: "none",
    overflowY: "hidden",
    fontSize: 12.5,
    fontWeight: 300,
    lineHeight: "19px",
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  const subtleButtonStyle: CSSProperties = {
    minHeight: 28,
    padding: "5px 9px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.86)",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const primaryButtonStyle: CSSProperties = {
    ...subtleButtonStyle,
    background: "#fff",
    color: "#000",
  };

  const disabledButtonStyle: CSSProperties = {
    ...subtleButtonStyle,
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.44)",
    cursor: "not-allowed",
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <Link href={author.profileHref} style={{ flexShrink: 0 }}>
          <Avatar name={author.authorName} avatarUrl={author.avatarUrl} />
        </Link>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <Link
                  href={author.profileHref}
                  style={{
                    color: "#fff",
                    textDecoration: "none",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {author.authorName}
                </Link>

<button
  type="button"
  onClick={() => setShowExactCommentDate((prev) => !prev)}
  title={formatExactDate(comment.createdAt)}
  aria-label={
    showExactCommentDate
      ? "Mostrar fecha relativa del comentario"
      : "Mostrar fecha exacta del comentario"
  }
  style={{
    fontSize: 10.5,
    color: "rgba(255,255,255,0.44)",
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    fontFamily: fontStack,
    cursor: "pointer",
    lineHeight: 1.2,
    textAlign: "left",
    WebkitTapHighlightColor: "transparent",
  }}
>
  {showExactCommentDate
    ? formatExactDate(comment.createdAt)
    : formatRelativeDate(comment.createdAt)}
</button>
              </div>

              <div
                style={{
                  marginTop: 4,
                  fontSize: 12.5,
                  fontWeight: 300,
                  lineHeight: 1.55,
                  color: "rgba(255,255,255,0.9)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {comment.text}
              </div>
            </div>

<div
  style={{
    display: "inline-flex",
    alignItems: "center",
    gap: 1,
    flexShrink: 0,
  }}
>
  <button
    type="button"
    onClick={handleToggleCommentFlame}
    disabled={commentFlameBusy}
    aria-pressed={commentLiked}
    aria-label={
      commentLiked
        ? "Quitar flamita del comentario"
        : "Dar flamita al comentario"
    }
    style={{
      width: 22,
      height: 22,
      border: "none",
      background: "transparent",
      padding: 0,
      display: "inline-grid",
      placeItems: "center",
      cursor: commentFlameBusy ? "not-allowed" : "pointer",
      opacity: commentFlameBusy ? 0.62 : 1,
      WebkitTapHighlightColor: "transparent",
      flexShrink: 0,
    }}
  >
    <span
      aria-hidden="true"
      style={{
        fontSize: 15,
        lineHeight: 1,
        filter: commentLiked ? "none" : "grayscale(1)",
        opacity: commentLiked ? 1 : 0.52,
      }}
    >
      🔥
    </span>
  </button>

  <span
    aria-label={`${commentLikes} flamitas`}
    style={{
      minWidth: 8,
      color: "rgba(255,255,255,0.62)",
      fontSize: 11.5,
      fontWeight: 600,
      lineHeight: 1,
    }}
  >
    {commentLikes}
  </span>
</div>
          </div>

          <div
            style={{
              marginTop: 5,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            {hasRepliesToLoad && (
              <button
                type="button"
                onClick={handleLoadReplies}
                disabled={loadingReplies}
                style={
                  loadingReplies ? disabledActionButtonStyle : actionButtonStyle
                }
              >
                {loadingReplies
                  ? "Cargando..."
                  : replies === null
                    ? `Ver ${replyCount} respuestas`
                    : "Respuestas cargadas"}
              </button>
            )}

            {canCommentOnPosts && (
              <button
                type="button"
                onClick={() => setReplyBoxOpen((prev) => !prev)}
                style={actionButtonStyle}
              >
                Responder
              </button>
            )}

            {canDeleteComment && (
              <button
                type="button"
                onClick={() => onDeleteComment(comment.id)}
                disabled={deletingCommentId === comment.id}
                style={
                  deletingCommentId === comment.id
                    ? disabledActionButtonStyle
                    : dangerButtonStyle
                }
              >
                {deletingCommentId === comment.id ? "Eliminando..." : "Eliminar"}
              </button>
            )}
          </div>

          {replyBoxOpen && (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "flex-end",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <AutoGrowTextarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Escribe una respuesta..."
                  maxRows={3}
                  style={inputStyle}
                  disabled={!canCommentOnPosts}
                />
              </div>

              <button
                type="button"
                onClick={handleCreateReply}
                disabled={
                  !canCommentOnPosts ||
                  creatingReply ||
                  replyText.trim().length === 0
                }
                style={
                  !canCommentOnPosts ||
                  creatingReply ||
                  replyText.trim().length === 0
                    ? disabledButtonStyle
                    : primaryButtonStyle
                }
              >
                {creatingReply ? "Enviando..." : "Responder"}
              </button>
            </div>
          )}

          {inlineError && (
            <div
              style={{
                marginTop: 8,
                borderRadius: 10,
                border: "1px solid rgba(255,90,90,0.24)",
                background: "rgba(120,18,18,0.28)",
                color: "#ffdada",
                padding: "8px 10px",
                fontSize: 11.5,
                lineHeight: 1.4,
              }}
            >
              {inlineError}
            </div>
          )}

          {replies !== null && replies.length > 0 && (
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gap: 10,
              }}
            >
              {replies.map((reply) => {
                const replyAuthor = getAuthorInfo(reply);
                const canDeleteReply =
                  isOwner || isModerator || currentUserId === reply.authorId;

                return (
                  <div
                    key={reply.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 9,
                      paddingLeft: 4,
                    }}
                  >
                    <Link href={replyAuthor.profileHref} style={{ flexShrink: 0 }}>
                      <Avatar
                        name={replyAuthor.authorName}
                        avatarUrl={replyAuthor.avatarUrl}
                        size={26}
                      />
                    </Link>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <Link
                          href={replyAuthor.profileHref}
                          style={{
                            color: "#fff",
                            textDecoration: "none",
                            fontSize: 11.5,
                            fontWeight: 600,
                          }}
                        >
                          {replyAuthor.authorName}
                        </Link>

<button
  type="button"
  onClick={() =>
    setExactReplyDates((prev) => ({
      ...prev,
      [reply.id]: !prev[reply.id],
    }))
  }
  title={formatExactDate(reply.createdAt)}
  aria-label={
    exactReplyDates[reply.id]
      ? "Mostrar fecha relativa de la respuesta"
      : "Mostrar fecha exacta de la respuesta"
  }
  style={{
    fontSize: 10,
    color: "rgba(255,255,255,0.42)",
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    fontFamily: fontStack,
    cursor: "pointer",
    lineHeight: 1.2,
    textAlign: "left",
    WebkitTapHighlightColor: "transparent",
  }}
>
  {exactReplyDates[reply.id]
    ? formatExactDate(reply.createdAt)
    : formatRelativeDate(reply.createdAt)}
</button>
                      </div>

                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          fontWeight: 300,
                          lineHeight: 1.5,
                          color: "rgba(255,255,255,0.86)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {reply.text}
                      </div>

                      <div
                        style={{
                          marginTop: 5,
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        {canCommentOnPosts && (
                          <button
                            type="button"
                            onClick={() => {
                              setReplyBoxOpen(true);
                              setReplyText(`@${replyAuthor.authorName} `);
                            }}
                            style={actionButtonStyle}
                          >
                            Responder
                          </button>
                        )}

                        {canDeleteReply && (
                          <button
                            type="button"
                            onClick={() => handleDeleteReply(reply.id)}
                            disabled={deletingReplyId === reply.id}
                            style={
                              deletingReplyId === reply.id
                                ? disabledActionButtonStyle
                                : dangerButtonStyle
                            }
                          >
                            {deletingReplyId === reply.id
                              ? "Eliminando..."
                              : "Eliminar"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}