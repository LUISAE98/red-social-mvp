"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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

  // Mobile animation state
  const [shouldRender, setShouldRender] = useState(open);
  const [panelOffsetY, setPanelOffsetY] = useState(() =>
    isMobile && open ? 0 : typeof window === "undefined" ? 900 : window.innerHeight,
  );
  const [isPanelDragging, setIsPanelDragging] = useState(false);

  const dragStartYRef = useRef(0);
  const dragStartOffsetYRef = useRef(0);
  const panelCloseOffsetRef = useRef(
    typeof window === "undefined" ? 900 : window.innerHeight,
  );

  useEffect(() => {
    if (!isMobile) return;
    if (open) {
      setShouldRender(true);
      setIsPanelDragging(false);
      setPanelOffsetY(panelCloseOffsetRef.current);
      const frameOne = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setPanelOffsetY(0);
        });
      });
      return () => window.cancelAnimationFrame(frameOne);
    }
    setIsPanelDragging(false);
    setPanelOffsetY(panelCloseOffsetRef.current);
    const timer = window.setTimeout(() => setShouldRender(false), 260);
    return () => window.clearTimeout(timer);
  }, [open, isMobile]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open, isMobile]);

  const PANEL_CLOSE_THRESHOLD = 130;

  function applyPanelOffset(raw: number): number {
    if (raw >= 0) return Math.min(panelCloseOffsetRef.current, raw);
    return raw * 0.2; // rubber band: resistencia al subir
  }

  function handlePanelPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    dragStartYRef.current = event.clientY;
    dragStartOffsetYRef.current = panelOffsetY;
    setIsPanelDragging(true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  }

  function handlePanelPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!isPanelDragging) return;
    const deltaY = event.clientY - dragStartYRef.current;
    setPanelOffsetY(applyPanelOffset(dragStartOffsetYRef.current + deltaY));
  }

  function handlePanelPointerUp() {
    if (!isPanelDragging) return;
    setIsPanelDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      setPanelOffsetY(panelCloseOffsetRef.current);
      onClose();
      return;
    }
    setPanelOffsetY(0);
  }

  // Mobile: don't render when closed (after exit animation)
  if (!shouldRender && isMobile) return null;

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
      role="dialog"
      aria-modal="true"
      aria-label="Comentarios"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 999999,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
        background: "rgba(0,0,0,0.52)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        fontFamily: fontStack,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <style>{`
        .vibra-comments-mobile-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .vibra-comments-mobile-scroll::-webkit-scrollbar-track { background: transparent; }
        .vibra-comments-mobile-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.18);
          border-radius: 999px;
        }
      `}</style>

      {/*
        Panel outer: auto-height, entry/exit y close drag.
        El background llena el hueco entre section y composer cuando hay rubber band.
        El composer vive aquí, fuera del section-wrapper, para no ser arrastrado hacia arriba.
      */}
      <div
        style={{
          width: "100%",
          maxHeight: "calc(100vh - 72px)",
          display: "flex",
          flexDirection: "column",
          background: "rgba(8,9,11,0.96)",
          transform: open
            ? `translateY(${Math.max(0, panelOffsetY)}px)`
            : "translateY(100%)",
          transition: isPanelDragging
            ? "none"
            : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {/* Section wrapper: solo aplica el rubber band hacia arriba */}
        <div
          style={{
            transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
            transition: isPanelDragging
              ? "none"
              : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <section
            style={{
              maxHeight: "calc(100vh - 140px)",
              borderRadius: "22px 22px 0 0",
              background: "rgba(8,9,11,0.96)",
              boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
              color: "#fff",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header — drag zone */}
            <header
              onPointerDown={handlePanelPointerDown}
              onPointerMove={handlePanelPointerMove}
              onPointerUp={handlePanelPointerUp}
              onPointerCancel={handlePanelPointerUp}
              style={{
                height: 56,
                display: "grid",
                gridTemplateColumns: "72px 1fr 72px",
                alignItems: "center",
                padding: "0 12px",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                flexShrink: 0,
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              <div aria-hidden="true" />

              <h3
                style={{
                  margin: 0,
                  textAlign: "center",
                  fontSize: 17,
                  fontWeight: 500,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                  color: "#fff",
                }}
              >
                Comentarios
              </h3>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar comentarios"
                style={{
                  width: 40,
                  height: 40,
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.86)",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 32,
                  fontWeight: 300,
                  lineHeight: 1,
                  justifySelf: "end",
                }}
              >
                ×
              </button>
            </header>

            {/* Comments list */}
            <div
              className="vibra-comments-mobile-scroll"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "12px 14px 8px",
                display: "grid",
                gap: 12,
                alignContent: "start",
                minHeight: 0,
              }}
            >
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
          </section>
        </div>

        {/* Composer — fuera del section-wrapper, no sube con el rubber band */}
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid rgba(255,255,255,0.07)",
            padding: "10px 14px 14px",
            display: "grid",
            gap: 8,
          }}
        >
          {inlineError && <div style={inlineErrorStyle}>{inlineError}</div>}

          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
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
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(content, document.body);
  }

  return content;
}
