"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import type { Comment, CommentReply } from "@/lib/posts/types";
import PostCommentThread from "./PostCommentThread";

type PostCommentsPanelProps = {
  open: boolean;
  isMobile: boolean;
  /** Render content directly in flow (no animation wrapper, no portal). Used inside the mobile sheet. */
  inline?: boolean;
  postId: string;
  groupId?: string | null;
  comments: Comment[] | null;
  loading: boolean;
  currentUserId?: string | null;
  isOwner?: boolean;
  isModerator?: boolean;
  canCommentOnPosts: boolean;
  commentBlockedMessage: string | null;
  commentText: string;
  creatingComment: boolean;
  deletingCommentId: string | null;
  inlineError: string | null;
  canUseGroupMemberBlock?: boolean;
  canModerateGroupAuthor?: boolean;
  isPostAuthor?: boolean;
  /** Desktop only: how many comments to show (sliced from newest). */
  visibleCount?: number;
  /** Desktop only: whether there are older comments not yet shown. */
  hasMore?: boolean;
  /** Desktop only: callback to load 5 more older comments. */
  onLoadMore?: () => void;
  /** Desktop only: callback to close the panel (e.g. from heading click). */
  onCloseDesktop?: () => void;
  onCommentTextChange: (value: string) => void;
  onClose: () => void;
  onCreateComment: () => Promise<void>;
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
  onGroupMemberBlockComplete?: () => Promise<void> | void;
  onModerationComplete?: () => Promise<void> | void;
};

const fontStack =
  'inherit';

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

export default function PostCommentsPanel({
  open,
  isMobile,
  inline = false,
  postId,
  groupId = null,
  comments,
  loading,
  currentUserId = null,
  isOwner = false,
  isModerator = false,
  canCommentOnPosts,
  commentBlockedMessage,
  commentText,
  creatingComment,
  deletingCommentId,
  inlineError,
  canUseGroupMemberBlock = false,
  canModerateGroupAuthor = false,
  isPostAuthor = false,
  visibleCount,
  hasMore = false,
  onLoadMore,
  onCloseDesktop,
  onCommentTextChange,
  onClose,
  onCreateComment,
  onDeleteComment,
  onLoadReplies,
  onCreateReply,
  onDeleteReply,
  onGroupMemberBlockComplete,
  onModerationComplete,
}: PostCommentsPanelProps) {
  useEffect(() => {
    if (!open || !isMobile) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, isMobile, onClose]);

  // Mobile: don't render when closed
  if (!open && isMobile) return null;

  // Desktop: slice comments to show only the most recent N
  const displayedComments =
    !isMobile && visibleCount !== undefined && comments !== null
      ? comments.slice(Math.max(0, comments.length - visibleCount))
      : comments;

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: 12.5,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "-0.01em",
  };

  const closeButtonStyle: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
  };

  const listStyle: CSSProperties = {
    display: "grid",
    gap: 12,
    overflowY: isMobile ? "auto" : "visible",
    minHeight: 0,
    paddingRight: isMobile ? 2 : 0,
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: 38,
    maxHeight: 90,
    padding: 0,
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
  };

  const disabledTextareaStyle: CSSProperties = {
    ...inputStyle,
    color: "rgba(255,255,255,0.46)",
    cursor: "not-allowed",
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
  };

  const disabledButtonStyle: CSSProperties = {
    ...subtleButtonStyle,
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.44)",
    cursor: "not-allowed",
  };

  const inlineErrorStyle: CSSProperties = {
    borderRadius: 10,
    border: "1px solid rgba(255,90,90,0.24)",
    background: "rgba(120,18,18,0.28)",
    color: "#ffdada",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.4,
  };

  // ── Desktop path ──────────────────────────────────────────────────────────
  if (!isMobile) {
    const desktopSection = (
      <div
        style={{
          marginTop: inline ? 0 : 14,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <section style={{ display: "grid", gap: 10 }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <h3
              style={{
                ...titleStyle,
                cursor: onCloseDesktop ? "pointer" : "default",
                userSelect: "none",
              }}
              onClick={onCloseDesktop}
            >
              Comentarios
            </h3>
          </div>

          {/* Comment list */}
          <div style={listStyle}>
            {loading && (
              <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.58)" }}>
                Cargando comentarios...
              </p>
            )}

            {!loading && comments !== null && comments.length === 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  padding: "28px 16px",
                  textAlign: "center",
                }}
              >
                <span style={{ fontSize: 26, lineHeight: 1 }}>💬</span>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#fff" }}>
                  Sé el primero en comentar
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.52)", lineHeight: 1.4 }}>
                  Todavía no hay comentarios en esta publicación.
                </p>
              </div>
            )}

            {!loading &&
              displayedComments?.map((comment) => (
                <PostCommentThread
                  key={comment.id}
                  postId={postId}
                  groupId={groupId}
                  comment={comment}
                  currentUserId={currentUserId}
                  isOwner={isOwner}
                  isModerator={isModerator}
                  canCommentOnPosts={canCommentOnPosts}
                  canUseGroupMemberBlock={canUseGroupMemberBlock}
                  canModerateGroupAuthor={canModerateGroupAuthor}
                  isPostAuthor={isPostAuthor}
                  deletingCommentId={deletingCommentId}
                  onDeleteComment={onDeleteComment}
                  onLoadReplies={onLoadReplies}
                  onCreateReply={onCreateReply}
                  onDeleteReply={onDeleteReply}
                  onGroupMemberBlockComplete={onGroupMemberBlockComplete}
                  onModerationComplete={onModerationComplete}
                />
              ))}

            {/* Load more (older comments) */}
            {!loading && hasMore && onLoadMore && (
              <button
                type="button"
                onClick={onLoadMore}
                style={{
                  alignSelf: "start",
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "rgba(255,255,255,0.52)",
                  fontSize: 11.5,
                  fontWeight: 500,
                  fontFamily: fontStack,
                  cursor: "pointer",
                  letterSpacing: "-0.01em",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                Ver más comentarios
              </button>
            )}
          </div>

          {/* Composer */}
          <div style={{ display: "grid", gap: 8 }}>
            {inlineError && <div style={inlineErrorStyle}>{inlineError}</div>}

            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <AutoGrowTextarea
                  value={commentText}
                  onChange={(e) => onCommentTextChange(e.target.value)}
                  placeholder={
                    canCommentOnPosts
                      ? "Escribe un comentario..."
                      : groupId
                        ? "Comentarios bloqueados en esta comunidad"
                        : "Solo el dueño puede comentar en este perfil"
                  }
                  maxRows={3}
                  style={canCommentOnPosts ? inputStyle : disabledTextareaStyle}
                  disabled={!canCommentOnPosts}
                />

                {!canCommentOnPosts && commentBlockedMessage && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11.5,
                      lineHeight: 1.45,
                      color: "rgba(255,255,255,0.58)",
                    }}
                  >
                    {commentBlockedMessage}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onCreateComment}
                disabled={
                  !canCommentOnPosts ||
                  creatingComment ||
                  commentText.trim().length === 0
                }
                style={
                  !canCommentOnPosts ||
                  creatingComment ||
                  commentText.trim().length === 0
                    ? disabledButtonStyle
                    : primaryButtonStyle
                }
              >
                {creatingComment ? "Comentando..." : "Comentar"}
              </button>
            </div>
          </div>
        </section>
      </div>
    );

    if (inline) return desktopSection;

    return (
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 0.32s ease",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          {desktopSection}
        </div>
      </div>
    );
  }

  // ── Mobile path (portal bottom-sheet) ────────────────────────────────────
  const content = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99990,
        background: "rgba(0,0,0,0.58)",
        display: "flex",
        alignItems: "flex-end",
      }}
      onClick={onClose}
    >
      <section
        style={{
          width: "100%",
          maxHeight: "82dvh",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          border: "1px solid rgba(255,255,255,0.10)",
          borderBottom: "none",
          background: "rgba(12,12,12,0.98)",
          boxShadow: "0 -18px 50px rgba(0,0,0,0.45)",
          padding: "10px 12px 12px",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 10,
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <h3 style={titleStyle}>Comentarios</h3>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar comentarios"
            style={closeButtonStyle}
          >
            ×
          </button>
        </div>

        <div style={listStyle}>
          {loading && (
            <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.58)" }}>
              Cargando comentarios...
            </p>
          )}

          {!loading && comments !== null && comments.length === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "28px 16px",
                textAlign: "center",
              }}
            >
              <span style={{ fontSize: 26, lineHeight: 1 }}>💬</span>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#fff" }}>
                Sé el primero en comentar
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.52)", lineHeight: 1.4 }}>
                Todavía no hay comentarios en esta publicación.
              </p>
            </div>
          )}

          {!loading &&
            comments?.map((comment) => (
              <PostCommentThread
                key={comment.id}
                postId={postId}
                groupId={groupId}
                comment={comment}
                currentUserId={currentUserId}
                isOwner={isOwner}
                isModerator={isModerator}
                canCommentOnPosts={canCommentOnPosts}
                canUseGroupMemberBlock={canUseGroupMemberBlock}
                deletingCommentId={deletingCommentId}
                onDeleteComment={onDeleteComment}
                onLoadReplies={onLoadReplies}
                onCreateReply={onCreateReply}
                onDeleteReply={onDeleteReply}
                onGroupMemberBlockComplete={onGroupMemberBlockComplete}
              />
            ))}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {inlineError && <div style={inlineErrorStyle}>{inlineError}</div>}

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
                onChange={(e) => onCommentTextChange(e.target.value)}
                placeholder={
                  canCommentOnPosts
                    ? "Escribe un comentario..."
                    : "Comentarios bloqueados en esta comunidad"
                }
                maxRows={3}
                style={canCommentOnPosts ? inputStyle : disabledTextareaStyle}
                disabled={!canCommentOnPosts}
              />

              {!canCommentOnPosts && commentBlockedMessage && (
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 11.5,
                    lineHeight: 1.45,
                    color: "rgba(255,255,255,0.58)",
                  }}
                >
                  {commentBlockedMessage}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onCreateComment}
              disabled={
                !canCommentOnPosts ||
                creatingComment ||
                commentText.trim().length === 0
              }
              style={
                !canCommentOnPosts ||
                creatingComment ||
                commentText.trim().length === 0
                  ? disabledButtonStyle
                  : primaryButtonStyle
              }
            >
              {creatingComment ? "Comentando..." : "Comentar"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(content, document.body);
  }

  return content;
}
