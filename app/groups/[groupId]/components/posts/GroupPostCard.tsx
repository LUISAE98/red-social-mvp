"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react";
import type { Comment, Post } from "@/lib/posts/types";

type GroupPostCardProps = {
  post: Post;
  canDelete?: boolean;
  onDelete?: (postId: string) => Promise<void>;
  onLoadComments: (postId: string) => Promise<Comment[]>;
  onCreateComment: (postId: string, text: string) => Promise<Comment[]>;
  onDeleteComment: (postId: string, commentId: string) => Promise<Comment[]>;
  currentUserId?: string | null;
  isOwner?: boolean;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function formatDate(value?: { toDate?: () => Date } | null) {
  if (!value?.toDate) return "Ahora mismo";

  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value.toDate());
  } catch {
    return "Fecha no disponible";
  }
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function getAuthorInfo(
  entity: { authorId?: string | null } & Record<string, unknown>,
) {
  const authorId = typeof entity.authorId === "string" ? entity.authorId : "";

  const authorName =
    typeof entity.authorName === "string" && entity.authorName.trim().length > 0
      ? entity.authorName.trim()
      : typeof entity.displayName === "string" && entity.displayName.trim().length > 0
        ? entity.displayName.trim()
        : typeof entity.name === "string" && entity.name.trim().length > 0
          ? entity.name.trim()
          : authorId || "Usuario";

  const avatarUrl =
    typeof entity.authorAvatarUrl === "string" && entity.authorAvatarUrl.trim().length > 0
      ? entity.authorAvatarUrl.trim()
      : typeof entity.avatarUrl === "string" && entity.avatarUrl.trim().length > 0
        ? entity.avatarUrl.trim()
        : typeof entity.photoURL === "string" && entity.photoURL.trim().length > 0
          ? entity.photoURL.trim()
          : null;

  const username =
    typeof entity.authorUsername === "string" && entity.authorUsername.trim().length > 0
      ? entity.authorUsername.trim()
      : typeof entity.username === "string" && entity.username.trim().length > 0
        ? entity.username.trim()
        : null;

  const profileHref = username ? `/perfil/${username}` : `/perfil/${authorId}`;

  return {
    authorId,
    authorName,
    avatarUrl,
    profileHref,
    initials: getInitials(authorName),
  };
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
    const borderTop = Number.parseFloat(computed.borderTopWidth || "0") || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth || "0") || 0;
    const paddingTop = Number.parseFloat(computed.paddingTop || "0") || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom || "0") || 0;

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

function Avatar({
  name,
  avatarUrl,
  size = 38,
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
        fontSize: Math.max(11, Math.floor(size * 0.32)),
        fontWeight: 500,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function GroupPostCard({
  post,
  canDelete = false,
  onDelete,
  onLoadComments,
  onCreateComment,
  onDeleteComment,
  currentUserId = null,
  isOwner = false,
}: GroupPostCardProps) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [creatingComment, setCreatingComment] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const postAuthor = useMemo(
    () => getAuthorInfo(post as unknown as { authorId?: string | null } & Record<string, unknown>),
    [post],
  );

  async function handleLoadComments() {
    try {
      setLoadingComments(true);
      const nextComments = await onLoadComments(post.id);
      setComments(nextComments);
    } finally {
      setLoadingComments(false);
    }
  }

  async function handleCreateComment() {
    if (creatingComment || commentText.trim().length === 0) return;

    try {
      setCreatingComment(true);
      const nextComments = await onCreateComment(post.id, commentText.trim());
      setComments(nextComments);
      setCommentText("");
    } finally {
      setCreatingComment(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || deleting) return;

    try {
      setDeleting(true);
      await onDelete(post.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (deletingCommentId) return;

    try {
      setDeletingCommentId(commentId);
      const nextComments = await onDeleteComment(post.id, commentId);
      setComments(nextComments);
    } finally {
      setDeletingCommentId(null);
    }
  }

  const cardStyle: CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.022)",
    color: "#fff",
    padding: 12,
    boxSizing: "border-box",
    backdropFilter: "blur(10px)",
  };

  const metaStyle: CSSProperties = {
    fontSize: 10.5,
    color: "rgba(255,255,255,0.54)",
    lineHeight: 1.35,
    letterSpacing: "-0.01em",
  };

  const authorLinkStyle: CSSProperties = {
    display: "inline-block",
    color: "#fff",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
  };

  const bodyStyle: CSSProperties = {
    marginTop: 10,
    fontSize: 13.5,
    fontWeight: 300,
    lineHeight: 1.72,
    color: "rgba(255,255,255,0.94)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  const subtleButtonStyle: CSSProperties = {
    minHeight: 30,
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.86)",
    fontSize: 11.5,
    fontWeight: 500,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const primaryButtonStyle: CSSProperties = {
    ...subtleButtonStyle,
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.12)",
  };

  const disabledButtonStyle: CSSProperties = {
    ...subtleButtonStyle,
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.44)",
    cursor: "not-allowed",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: 38,
    maxHeight: 90,
    padding: "0",
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    background: "transparent",
    color: "#fff",
    outline: "none",
    resize: "none",
    overflowY: "hidden",
    fontSize: 13,
    fontWeight: 300,
    lineHeight: "20px",
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
  };

  return (
    <article style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            minWidth: 0,
            flex: 1,
          }}
        >
          <Link
            href={postAuthor.profileHref}
            style={{
              display: "inline-flex",
              flexShrink: 0,
            }}
          >
            <Avatar
              name={postAuthor.authorName}
              avatarUrl={postAuthor.avatarUrl}
              size={38}
            />
          </Link>

          <div style={{ minWidth: 0, flex: 1 }}>
            <Link href={postAuthor.profileHref} style={authorLinkStyle}>
              {postAuthor.authorName}
            </Link>

            <div style={{ ...metaStyle, marginTop: 3 }}>
              {formatDate(post.createdAt)}
            </div>
          </div>
        </div>

        {canDelete && onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            style={deleting ? disabledButtonStyle : subtleButtonStyle}
          >
            {deleting ? "Eliminando..." : "Eliminar"}
          </button>
        )}
      </div>

      <div style={bodyStyle}>{post.text}</div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: "rgba(255,255,255,0.86)",
              letterSpacing: "-0.01em",
            }}
          >
            Comentarios
          </div>

          <button
            type="button"
            onClick={handleLoadComments}
            disabled={loadingComments}
            style={loadingComments ? disabledButtonStyle : subtleButtonStyle}
          >
            {loadingComments ? "Cargando..." : "Ver comentarios"}
          </button>
        </div>

        {comments !== null && comments.length === 0 && (
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 300,
              color: "rgba(255,255,255,0.56)",
              lineHeight: 1.45,
            }}
          >
            Aún no hay comentarios.
          </p>
        )}

        {comments !== null && comments.length > 0 && (
          <div style={{ display: "grid", gap: 12 }}>
            {comments.map((comment) => {
              const canDeleteComment =
                isOwner || currentUserId === comment.authorId;

              const commentAuthor = getAuthorInfo(
                comment as unknown as { authorId?: string | null } & Record<string, unknown>,
              );

              return (
                <div
                  key={comment.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <Link
                      href={commentAuthor.profileHref}
                      style={{
                        display: "inline-flex",
                        flexShrink: 0,
                      }}
                    >
                      <Avatar
                        name={commentAuthor.authorName}
                        avatarUrl={commentAuthor.avatarUrl}
                        size={30}
                      />
                    </Link>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Link
                        href={commentAuthor.profileHref}
                        style={{
                          display: "inline-block",
                          color: "#fff",
                          textDecoration: "none",
                          fontSize: 12,
                          fontWeight: 500,
                          lineHeight: 1.15,
                          letterSpacing: "-0.02em",
                        }}
                      >
                        {commentAuthor.authorName}
                      </Link>

                      <div
                        style={{
                          marginTop: 5,
                          fontSize: 12.5,
                          fontWeight: 300,
                          lineHeight: 1.6,
                          color: "rgba(255,255,255,0.9)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {comment.text}
                      </div>
                    </div>
                  </div>

                  {canDeleteComment && (
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(comment.id)}
                      disabled={deletingCommentId === comment.id}
                      style={
                        deletingCommentId === comment.id
                          ? disabledButtonStyle
                          : subtleButtonStyle
                      }
                    >
                      {deletingCommentId === comment.id
                        ? "Eliminando..."
                        : "Eliminar"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <AutoGrowTextarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Escribe un comentario..."
              maxRows={3}
              style={inputStyle}
            />
          </div>

          <button
            type="button"
            onClick={handleCreateComment}
            disabled={creatingComment || commentText.trim().length === 0}
            style={
              creatingComment || commentText.trim().length === 0
                ? disabledButtonStyle
                : primaryButtonStyle
            }
          >
            {creatingComment ? "Comentando..." : "Comentar"}
          </button>
        </div>
      </div>
    </article>
  );
}
