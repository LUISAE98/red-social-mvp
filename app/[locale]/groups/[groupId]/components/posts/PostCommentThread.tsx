"use client";

import Image from "next/image";
import { TextButton, IconButton } from "@/components/ui";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { intlLocale } from "@/i18n/locales";
import Link from "next/link";
import { Timestamp, doc, getDoc } from "firebase/firestore";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { Comment, CommentImage, CommentMention, CommentReply } from "@/lib/posts/types";
import {
  fetchOlderCommentReplies,
  toggleCommentFlame,
  updatePostComment,
  updatePostCommentReply,
} from "@/lib/posts/post-service";
import { CommentSkeletonList } from "@/app/components/PostSkeleton/CommentSkeleton";
import { uploadCommentImage } from "@/lib/posts/image-upload";
import MentionTextarea from "./mentions/MentionTextarea";
import { renderCommentText } from "./mentions/renderMentions";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { CommentAttachButton, CommentImageThumb } from "./CommentImageUI";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import VibraSendIcon from "@/app/components/VibraServiceIcons/VibraSendIcon";
import { useGroupMemberBlocks } from "@/lib/groups/useGroupMemberBlocks";
import { db } from "@/lib/firebase";
import { useSocialRelationship } from "@/lib/social/useSocialRelationship";
import {
  banGroupMember,
  muteGroupMember,
  removeGroupMember,
  unbanGroupMember,
  unmuteGroupMember,
} from "@/lib/groups/groupModeration";
import { useReport } from "@/lib/moderation/useReport";
import ReportModal from "@/app/components/ReportModal/ReportModal";
import { useTranslations, useLocale } from "next-intl";
import {
  Avatar, CommentActionsPortal, ReplyActionsPortal,
  fontStack, formatExactDate, formatRelativeDate, getAuthorInfo,
  type PostCommentThreadProps,
} from "./PostCommentThread.parts";

export default function PostCommentThread({
  postId,
  groupId = null,
  comment,
  currentUserId = null,
  isOwner = false,
  isModerator = false,
  canCommentOnPosts,
  canUseGroupMemberBlock = false,
  canModerateGroupAuthor = false,
  isPostAuthor = false,
  mentionsDisabled = false,
  deletingCommentId,
  onDeleteComment,
  onLoadReplies,
  onCreateReply,
  onDeleteReply,
  onGroupMemberBlockComplete,
  onModerationComplete,
  onOpenCommentImage,
  showAdminDetails = false,
  focusCommentId = null,
}: PostCommentThreadProps) {
  const tCommon = useTranslations("common");
  const tFeed = useTranslations("feed");
  const locale = useLocale();
  const tPosts = useTranslations("posts");
  const { reportTarget, openReport, closeReport } = useReport();
  const [replies, setReplies] = useState<CommentReply[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  /** Se apaga cuando una tanda del historial vuelve incompleta. */
  const [hasOlderReplies, setHasOlderReplies] = useState(true);
  const [loadingOlderReplies, setLoadingOlderReplies] = useState(false);
  const olderRepliesSentinelRef = useRef<HTMLDivElement | null>(null);
  const [replyBoxOpen, setReplyBoxOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyMentions, setReplyMentions] = useState<CommentMention[]>([]);
  const [replyImageFile, setReplyImageFile] = useState<File | null>(null);
  const [creatingReply, setCreatingReply] = useState(false);
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const { toast: threadToast, showToast: showThreadToast } = useVibraToast();
  /* El aviso sale como VibraToast, no como caja roja: ese estilo se retiró del
     catálogo y encima llegaba duplicado con el del feed. */
  useEffect(() => {
    if (!inlineError) return;
    showThreadToast(inlineError, "error");
    setInlineError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineError]);
  const [commentLiked, setCommentLiked] = useState(comment.viewerHasFlamed === true);
  const [commentLikes, setCommentLikes] = useState(comment.counts?.likes ?? 0);
  const [localReplyCount, setLocalReplyCount] = useState(comment.counts?.replies ?? 0);
  const [commentFlameBusy, setCommentFlameBusy] = useState(false);
  const [showExactCommentDate, setShowExactCommentDate] = useState(false);
  const [exactReplyDates, setExactReplyDates] = useState<Record<string, boolean>>({});

  // Deep-link de notificaciones: enfoque de este comentario.
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusState, setFocusState] = useState<"idle" | "hold" | "fade">("idle");
  const focusedRef = useRef(false);

  // Comment actions menu (⋯)
  const [commentMenuOpen, setCommentMenuOpen] = useState(false);
  // Reply actions menu (⋯) — tracks which reply's menu is open
  const [replyActionsMenuOpenId, setReplyActionsMenuOpenId] = useState<string | null>(null);
  // Bloquea el scroll del fondo mientras un menú ⋯ (de comentario o respuesta) está abierto.
  useBodyScrollLock(commentMenuOpen || replyActionsMenuOpenId !== null);

  const [editingComment, setEditingComment] = useState(false);
  const [editCommentText, setEditCommentText] = useState(comment.text);
  const [editCommentMentions, setEditCommentMentions] = useState<CommentMention[]>(
    comment.mentions ?? []
  );
  const [savingEditComment, setSavingEditComment] = useState(false);
  const [localCommentText, setLocalCommentText] = useState(comment.text);
  const [localCommentMentions, setLocalCommentMentions] = useState<CommentMention[]>(
    comment.mentions ?? []
  );
  const [localCommentEditedAt, setLocalCommentEditedAt] = useState(comment.editedAt ?? null);

  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editReplyTexts, setEditReplyTexts] = useState<Record<string, string>>({});
  const [editReplyMentions, setEditReplyMentions] = useState<Record<string, CommentMention[]>>({});
  const [savingEditReplyId, setSavingEditReplyId] = useState<string | null>(null);

  // Escape to close menus
  useEffect(() => {
    if (!commentMenuOpen) return;
    function handler(e: KeyboardEvent) { if (e.key === "Escape") setCommentMenuOpen(false); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [commentMenuOpen]);

  useEffect(() => {
    if (!replyActionsMenuOpenId) return;
    function handler(e: KeyboardEvent) { if (e.key === "Escape") setReplyActionsMenuOpenId(null); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [replyActionsMenuOpenId]);

  // Deep-link de notificaciones: si este comentario es el enfocado, hace scroll,
  // lo resalta unos segundos y auto-expande sus respuestas (por si la actividad
  // notificada fueron respuestas).
  // Al enfocar: resalta y mantiene el color (sin scroll automático).
  useEffect(() => {
    if (focusedRef.current) return;
    if (!focusCommentId || focusCommentId !== comment.id) return;
    focusedRef.current = true;
    if (replyCount > 0) void handleLoadReplies();
    setFocusState("hold");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCommentId, comment.id]);

  // El resaltado persiste hasta que el comentario entra en el viewport (el
  // usuario scrollea y lo ve); recién entonces se desvanece.
  useEffect(() => {
    if (focusState !== "hold") return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          // Un instante para que registre el color antes de desvanecer.
          setTimeout(() => setFocusState("fade"), 700);
        }
      },
      // Requiere que quede dentro del 80% central del viewport para contar
      // como "visto" (no un pixel asomando en el borde).
      { rootMargin: "-10% 0px -10% 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [focusState]);

  // Tras arrancar el fade, limpia el estado cuando termina la transición.
  useEffect(() => {
    if (focusState !== "fade") return;
    const t = setTimeout(() => setFocusState("idle"), 1200);
    return () => clearTimeout(t);
  }, [focusState]);

  const author = getAuthorInfo(comment, tCommon("user"));
  const isOwnComment = currentUserId === comment.authorId;
  const canDeleteComment = isOwner || isModerator || isPostAuthor || isOwnComment;
  const canEditOwnComment = isOwnComment;

  const replyCount = localReplyCount;
  const hasRepliesToLoad = replyCount > 0;

  // Dispara el historial de respuestas al asomarse su principio. El margen lo
  // adelanta un poco para que la tanda esté puesta antes de llegar.
  useEffect(() => {
    if (!hasOlderReplies || loadingOlderReplies) return;
    if (replies === null || replies.length === 0) return;

    const sentinel = olderRepliesSentinelRef.current;
    if (!sentinel) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void handleLoadOlderReplies();
      },
      { rootMargin: "200px 0px 0px 0px" }
    );
    io.observe(sentinel);
    return () => io.disconnect();
    // `handleLoadOlderReplies` se redefine en cada render; sus guardas internas
    // (`loadingOlderReplies`/`hasOlderReplies`) ya evitan la carga duplicada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOlderReplies, loadingOlderReplies, replies]);

  async function handleLoadReplies() {
    if (replies !== null || loadingReplies) return;

    try {
      setLoadingReplies(true);
      setInlineError(null);
      const nextReplies = await onLoadReplies(postId, comment.id);
      setReplies(nextReplies);
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? tFeed("loadRepliesError"));
    } finally {
      setLoadingReplies(false);
    }
  }

  /**
   * Trae la tanda ANTERIOR de respuestas al llegar arriba de la lista.
   *
   * Igual que los comentarios: la primera tanda son las 30 más recientes y el
   * historial se pide de verdad al servidor. Antes se quedaba en 30 y las demás
   * no había forma de verlas.
   */
  async function handleLoadOlderReplies() {
    if (loadingOlderReplies || !hasOlderReplies) return;

    const oldest = replies?.[0]?.createdAt;
    if (!oldest) {
      setHasOlderReplies(false);
      return;
    }

    try {
      setLoadingOlderReplies(true);
      const page = await fetchOlderCommentReplies({
        postId,
        commentId: comment.id,
        before: oldest,
      });

      setReplies((current) => {
        const existing = new Set((current ?? []).map((r) => r.id));
        const fresh = page.replies.filter((r) => !existing.has(r.id));
        return [...fresh, ...(current ?? [])];
      });
      setHasOlderReplies(page.hasMore);
    } catch {
      setInlineError(tFeed("loadRepliesError"));
    } finally {
      setLoadingOlderReplies(false);
    }
  }

  async function handleCreateReply() {
    if (!canCommentOnPosts || creatingReply) return;
    if (replyText.trim().length === 0 && !replyImageFile) return;

    try {
      setCreatingReply(true);
      setInlineError(null);
      let image: CommentImage | null = null;
      if (replyImageFile) {
        image = await uploadCommentImage({ postId, file: replyImageFile });
      }
      const nextReplies = await onCreateReply(
        postId,
        comment.id,
        replyText.trim(),
        replyMentions,
        image
      );
      setReplies(nextReplies);
      setLocalReplyCount(nextReplies.length);
      setReplyText("");
      setReplyMentions([]);
      setReplyImageFile(null);
      setReplyBoxOpen(false);
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? tPosts("errorCreateReply"));
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
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? tFeed("deleteReplyError"));
    } finally {
      setDeletingReplyId(null);
    }
  }

  function handleStartEditComment() {
    setEditingComment(true);
    setEditCommentText(localCommentText);
    setEditCommentMentions(localCommentMentions);
  }

  function handleCancelEditComment() {
    setEditingComment(false);
    setEditCommentText(localCommentText);
    setEditCommentMentions(localCommentMentions);
  }

  async function handleSaveEditComment() {
    const trimmed = editCommentText.trim();
    if (savingEditComment || !trimmed) return;

    try {
      setSavingEditComment(true);
      setInlineError(null);
      await updatePostComment({
        postId,
        commentId: comment.id,
        text: trimmed,
        mentions: editCommentMentions,
      });
      setLocalCommentText(trimmed);
      setLocalCommentMentions(editCommentMentions);
      setLocalCommentEditedAt(Timestamp.now());
      setEditingComment(false);
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? tPosts("errorSaveComment"));
    } finally {
      setSavingEditComment(false);
    }
  }

  function handleStartEditReply(replyId: string, currentText: string) {
    setEditingReplyId(replyId);
    setEditReplyTexts((prev) => ({ ...prev, [replyId]: currentText }));
    const existing = replies?.find((r) => r.id === replyId);
    setEditReplyMentions((prev) => ({ ...prev, [replyId]: existing?.mentions ?? [] }));
  }

  function handleCancelEditReply() {
    setEditingReplyId(null);
  }

  async function handleSaveEditReply(replyId: string) {
    const text = (editReplyTexts[replyId] ?? "").trim();
    if (savingEditReplyId || !text) return;

    const mentions = editReplyMentions[replyId] ?? [];

    try {
      setSavingEditReplyId(replyId);
      setInlineError(null);
      await updatePostCommentReply({ postId, commentId: comment.id, replyId, text, mentions });
      setReplies(
        (prev) =>
          prev?.map((r) =>
            r.id === replyId ? { ...r, text, mentions, editedAt: Timestamp.now() } : r
          ) ?? null,
      );
      setEditingReplyId(null);
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? tPosts("errorSaveReply"));
    } finally {
      setSavingEditReplyId(null);
    }
  }

  async function handleToggleCommentFlame() {
    if (!currentUserId) {
      setInlineError(tPosts("loginToFlame"));
      return;
    }

    if (commentFlameBusy) return;

    const previousLiked = commentLiked;
    const previousLikes = commentLikes;
    const nextLiked = !previousLiked;

    setCommentLiked(nextLiked);
    setCommentLikes((current) => Math.max(0, current + (nextLiked ? 1 : -1)));

    try {
      setCommentFlameBusy(true);
      setInlineError(null);
      const result = await toggleCommentFlame({ postId, commentId: comment.id });
      setCommentLiked(result.liked);
      setCommentLikes(result.likes);
    } catch (e: unknown) {
      setCommentLiked(previousLiked);
      setCommentLikes(previousLikes);
      setInlineError((e instanceof Error ? e.message : null) ?? tFeed("errorUpdateFlame"));
    } finally {
      setCommentFlameBusy(false);
    }
  }

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

  // Whether to show the comment ⋯ button
  const showCommentActionsMenu =
    !editingComment &&
    (canEditOwnComment ||
      canDeleteComment ||  // already includes isPostAuthor
      (canUseGroupMemberBlock && !!groupId && !!currentUserId && !isOwnComment) ||
      (canModerateGroupAuthor && !!groupId && !isOwnComment) ||
      (!isOwner && !isModerator && !!currentUserId && !isOwnComment));

  return (
    <div
      ref={rootRef}
      data-comment-id={comment.id}
      className={
        focusState === "hold"
          ? "notifCommentFocus"
          : focusState === "fade"
            ? "notifCommentFocus notifCommentFocusFade"
            : undefined
      }
      style={{ display: "grid", gap: 8 }}
    >
      {showAdminDetails && comment.isDeleted === true && (
        <div style={{
          background: "rgba(26,5,5,0.9)",
          border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 6,
          padding: "5px 10px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f87171" }}>{tPosts("commentDeleted")}</span>
            {comment.deletedAt && (
              <span style={{ fontSize: 10, color: "rgba(239,68,68,0.6)", marginInlineStart: 6 }}>
                {comment.deletedAt.toDate().toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" })}
              </span>
            )}
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Link href={author.profileHref} style={{ flexShrink: 0 }}>
          <Avatar name={author.authorName} avatarUrl={author.avatarUrl} />
        </Link>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                <Link
                  href={author.profileHref}
                  style={{ color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 500 }}
                >
                  {author.authorName}
                </Link>

                {comment.authorIsGroupMember === false && (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 500,
                      color: "rgba(255,255,255,0.36)",
                      letterSpacing: "0.02em",
                      border: "1px solid rgba(255,255,255,0.13)",
                      borderRadius: 4,
                      padding: "1px 5px",
                      whiteSpace: "nowrap",
                      lineHeight: 1.4,
                    }}
                  >
                    {tPosts("notSubscriber")}
                  </span>
                )}

              </div>

              {editingComment ? (
                <div style={{ marginTop: 4 }}>
                  <MentionTextarea
                    value={editCommentText}
                    onChange={setEditCommentText}
                    mentions={editCommentMentions}
                    onMentionsChange={setEditCommentMentions}
                    currentUserId={currentUserId}
                    mentionsDisabled={mentionsDisabled}
                    maxRows={6}
                    style={inputStyle}
                    disabled={savingEditComment}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={handleSaveEditComment}
                      disabled={savingEditComment || !editCommentText.trim()}
                      style={savingEditComment || !editCommentText.trim() ? disabledButtonStyle : primaryButtonStyle}
                    >
                      {savingEditComment ? tCommon("sending") : tCommon("save")}
                    </button>
                    <TextButton tone="mute" size="sm" style={{ fontFamily: fontStack }} onClick={handleCancelEditComment} disabled={savingEditComment}>
                      {tCommon("cancel")}
                    </TextButton>
                  </div>
                </div>
              ) : (
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
                  {renderCommentText(localCommentText, localCommentMentions)}
                </div>
              )}

              {comment.image && (
                <CommentImageThumb image={comment.image} onOpen={onOpenCommentImage} />
              )}

              {showAdminDetails && comment.editHistory && comment.editHistory.length > 0 && (
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(251,191,36,0.65)", letterSpacing: "0.05em" }}>
                    {tPosts("previousVersions")}
                  </div>
                  {comment.editHistory.map((entry, idx) => (
                    <div key={idx} style={{
                      padding: "5px 8px",
                      borderRadius: 6,
                      background: "rgba(251,191,36,0.05)",
                      border: "1px solid rgba(251,191,36,0.12)",
                    }}>
                      <div style={{ fontSize: 10, color: "rgba(251,191,36,0.5)", marginBottom: 3 }}>
                        {entry.editedAt?.toDate().toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 300, color: "rgba(255,255,255,0.5)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {entry.previousText}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Flame counter */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
              <IconButton label={commentLiked ? tPosts("removeFlame") : tPosts("addFlame")} size="sm" tone="bare" shape="square" style={{ placeItems: "center", transform: commentLiked ? "scale(1.04)" : "scale(1)" }} onClick={handleToggleCommentFlame} aria-pressed={commentLiked}>
                <span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", lineHeight: 1 }}>
                  <VibraFlameIcon active={commentLiked} size={18} />
                </span>
              </IconButton>
              <span
                aria-label={tPosts("flameCountLabel", { count: commentLikes })}
                style={{ minWidth: 8, color: "rgba(255,255,255,0.62)", fontSize: 11.5, fontWeight: 600, lineHeight: 1 }}
              >
                {commentLikes}
              </span>
            </div>
          </div>

          {/* Comment action row */}
          <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {hasRepliesToLoad && (
              <TextButton
                tone="mute"
                size="sm"
                onClick={handleLoadReplies}
                disabled={loadingReplies}
                style={{ fontFamily: fontStack }}
              >
                {/* Mientras cargan, el botón NO cambia a "Cargando…": quien
                    cuenta que vienen en camino es el skeleton que aparece
                    justo debajo, donde van a salir. El botón solo se apaga. */}
                {replies === null
                  ? tPosts("viewReplies", { count: replyCount })
                  : tPosts("repliesLoaded")}
              </TextButton>
            )}

            {canCommentOnPosts && (
              <TextButton tone="mute" size="sm" style={{ fontFamily: fontStack }} onClick={() => setReplyBoxOpen((prev) => !prev)}>
                {tPosts("reply")}
              </TextButton>
            )}

            {showCommentActionsMenu && (
              <TextButton tone="mute" size="sm" style={{ fontFamily: fontStack }} onClick={() => setCommentMenuOpen(true)} aria-label={tPosts("moreCommentOptions")}>
                {tPosts("moreOptions")}
              </TextButton>
            )}

            {/* La fecha cierra la fila de acciones, detrás de "Más opciones".
                Antes iba pegada al nombre, donde competía con él por el ancho y
                partía el renglón en cuanto el nombre era largo. Aquí abajo cabe
                sin empujar nada y sigue alternando entre "hace 3 h" y la fecha
                exacta al pulsarla. */}
            <TextButton tone="mute" size="sm" style={{ margin: 0, fontFamily: fontStack, textAlign: "start" }} onClick={() => setShowExactCommentDate((prev) => !prev)} title={formatExactDate(comment.createdAt, tCommon)} aria-label={ showExactCommentDate ? tPosts("showRelativeCommentDate") : tPosts("showExactCommentDate") }>
              {showExactCommentDate
                ? formatExactDate(comment.createdAt, tCommon)
                : formatRelativeDate(comment.createdAt, tCommon, intlLocale(locale))}
              {(localCommentEditedAt ?? comment.editedAt) ? (
                <span style={{ opacity: 0.45, fontStyle: "italic", marginInlineStart: 2 }}>
                  {" "}{tPosts("editedSuffix")}
                </span>
              ) : null}
            </TextButton>
          </div>

          {/* Reply box — botones (adjuntar + enviar) DENTRO del propio campo. */}
          {replyBoxOpen && (
            <div
              style={{
                marginTop: 8,
                borderRadius: 12,
                background: "rgba(255,255,255,0.06)",
                padding: "4px 6px 4px 12px",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, transform: "translateY(2px)" }}>
                <MentionTextarea
                  value={replyText}
                  onChange={setReplyText}
                  mentions={replyMentions}
                  onMentionsChange={setReplyMentions}
                  currentUserId={currentUserId}
                  mentionsDisabled={mentionsDisabled}
                  placeholder={tPosts("replyPlaceholder")}
                  maxRows={3}
                  style={{ ...inputStyle, borderBottom: "none", minHeight: 22 }}
                  disabled={!canCommentOnPosts}
                  // Enter envía, Mayús+Enter salta de línea. `handleCreateReply`
                  // ya se guarda sola de la respuesta vacía y del doble envío,
                  // así que no hace falta repetir la condición aquí.
                  onSubmit={() => { void handleCreateReply(); }}
                />
              </div>
              <CommentAttachButton
                file={replyImageFile}
                onSelect={setReplyImageFile}
                onClear={() => setReplyImageFile(null)}
                disabled={!canCommentOnPosts || creatingReply}
              />
              {(() => {
                const disabled =
                  !canCommentOnPosts ||
                  creatingReply ||
                  (replyText.trim().length === 0 && !replyImageFile);
                return (
                  <IconButton label={tPosts("reply")} size="sm" tone="bare" shape="square" style={{ transform: "translateY(-2px)" }} onClick={handleCreateReply} disabled={disabled}>
                    <VibraSendIcon size={21} />
                  </IconButton>
                );
              })()}
            </div>
          )}


          {/* Primera tanda de respuestas: el hueco va aquí abajo, que es donde
              van a aparecer, y no en la etiqueta del botón de arriba. */}
          {replies === null && loadingReplies && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <CommentSkeletonList count={2} />
            </div>
          )}

          {/* Replies */}
          {replies !== null && replies.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {/* Historial hacia atrás: el centinela va antes de la primera
                  respuesta, y el skeleton ocupa su sitio mientras llega la
                  tanda para que la lista no salte. */}
              <div ref={olderRepliesSentinelRef} aria-hidden style={{ height: 1 }} />
              {loadingOlderReplies && <CommentSkeletonList count={2} />}

              {replies.map((reply) => {
                const replyAuthor = getAuthorInfo(reply, tCommon("user"));
                const canDeleteReply = isOwner || isModerator || currentUserId === reply.authorId;
                const canEditReply = currentUserId === reply.authorId && editingReplyId !== reply.id;
                const canBlockReply =
                  canUseGroupMemberBlock &&
                  !!groupId &&
                  !!currentUserId &&
                  currentUserId !== reply.authorId &&
                  reply.viewerIsBlockedByAuthorInGroup !== true;
                const showReplyActionsMenu =
                  canEditReply ||
                  canDeleteReply ||
                  canBlockReply ||
                  (canModerateGroupAuthor && !!groupId && !!currentUserId && currentUserId !== reply.authorId) ||
                  (!isOwner && !isModerator && !!currentUserId && currentUserId !== reply.authorId);

                return (
                  <div key={reply.id} style={{ display: "grid", gap: 6 }}>
                    {showAdminDetails && reply.isDeleted === true && (
                      <div style={{
                        background: "rgba(26,5,5,0.9)",
                        border: "1px solid rgba(239,68,68,0.2)",
                        borderRadius: 6,
                        padding: "4px 9px",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginInlineStart: 4,
                      }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                        <div>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#f87171" }}>{tPosts("replyDeleted")}</span>
                          {reply.deletedAt && (
                            <span style={{ fontSize: 9.5, color: "rgba(239,68,68,0.6)", marginInlineStart: 6 }}>
                              {reply.deletedAt.toDate().toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 9, paddingInlineStart: 4 }}>
                    <Link href={replyAuthor.profileHref} style={{ flexShrink: 0 }}>
                      <Avatar name={replyAuthor.authorName} avatarUrl={replyAuthor.avatarUrl} size={26} />
                    </Link>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                        <Link
                          href={replyAuthor.profileHref}
                          style={{ color: "#fff", textDecoration: "none", fontSize: 11.5, fontWeight: 500 }}
                        >
                          {replyAuthor.authorName}
                        </Link>

                        {reply.authorIsGroupMember === false && (
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 500,
                              color: "rgba(255,255,255,0.36)",
                              letterSpacing: "0.02em",
                              border: "1px solid rgba(255,255,255,0.13)",
                              borderRadius: 4,
                              padding: "1px 5px",
                              whiteSpace: "nowrap",
                              lineHeight: 1.4,
                            }}
                          >
                            {tPosts("notSubscriber")}
                          </span>
                        )}

                      </div>

                      {editingReplyId === reply.id ? (
                        <div style={{ marginTop: 4 }}>
                          <MentionTextarea
                            value={editReplyTexts[reply.id] ?? reply.text}
                            onChange={(next) =>
                              setEditReplyTexts((prev) => ({ ...prev, [reply.id]: next }))
                            }
                            mentions={editReplyMentions[reply.id] ?? reply.mentions ?? []}
                            onMentionsChange={(next) =>
                              setEditReplyMentions((prev) => ({ ...prev, [reply.id]: next }))
                            }
                            currentUserId={currentUserId}
                            mentionsDisabled={mentionsDisabled}
                            maxRows={6}
                            style={inputStyle}
                            disabled={savingEditReplyId === reply.id}
                          />
                          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                            <button
                              type="button"
                              onClick={() => handleSaveEditReply(reply.id)}
                              disabled={
                                savingEditReplyId === reply.id ||
                                !(editReplyTexts[reply.id] ?? "").trim()
                              }
                              style={
                                savingEditReplyId === reply.id || !(editReplyTexts[reply.id] ?? "").trim()
                                  ? disabledButtonStyle
                                  : primaryButtonStyle
                              }
                            >
                              {savingEditReplyId === reply.id ? tCommon("sending") : tCommon("save")}
                            </button>
                            <TextButton tone="mute" size="sm" style={{ fontFamily: fontStack }} onClick={handleCancelEditReply} disabled={savingEditReplyId === reply.id}>
                              {tCommon("cancel")}
                            </TextButton>
                          </div>
                        </div>
                      ) : (
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
                          {renderCommentText(reply.text, reply.mentions)}
                        </div>
                      )}

                      {reply.image && (
                        <CommentImageThumb image={reply.image} onOpen={onOpenCommentImage} />
                      )}

                      {showAdminDetails && reply.editHistory && reply.editHistory.length > 0 && (
                        <div style={{ marginTop: 7, display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(251,191,36,0.65)", letterSpacing: "0.05em" }}>
                            {tPosts("previousVersions")}
                          </div>
                          {reply.editHistory.map((entry, idx) => (
                            <div key={idx} style={{
                              padding: "4px 7px",
                              borderRadius: 5,
                              background: "rgba(251,191,36,0.05)",
                              border: "1px solid rgba(251,191,36,0.12)",
                            }}>
                              <div style={{ fontSize: 9.5, color: "rgba(251,191,36,0.5)", marginBottom: 2 }}>
                                {entry.editedAt?.toDate().toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" })}
                              </div>
                              <div style={{ fontSize: 11.5, fontWeight: 300, color: "rgba(255,255,255,0.5)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {entry.previousText}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply action row */}
                      <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        {canCommentOnPosts && (
                          <TextButton tone="mute" size="sm" style={{ fontFamily: fontStack }} onClick={() => { setReplyBoxOpen(true); setReplyText(`@${replyAuthor.authorName} `); }}>
                            {tPosts("reply")}
                          </TextButton>
                        )}

                        {showReplyActionsMenu && !editingReplyId && (
                          <TextButton tone="mute" size="sm" style={{ fontFamily: fontStack }} onClick={() => setReplyActionsMenuOpenId(reply.id)} aria-label={tPosts("moreReplyOptions")}>
                            {tPosts("moreOptions")}
                          </TextButton>
                        )}

                        {/* Misma colocación que en el comentario. */}
                        <TextButton tone="mute" size="sm" style={{ margin: 0, fontFamily: fontStack, textAlign: "start" }} onClick={() => setExactReplyDates((prev) => ({ ...prev, [reply.id]: !prev[reply.id] }))} title={formatExactDate(reply.createdAt, tCommon)} aria-label={ exactReplyDates[reply.id] ? tPosts("showRelativeReplyDate") : tPosts("showExactReplyDate") }>
                          {exactReplyDates[reply.id]
                            ? formatExactDate(reply.createdAt, tCommon)
                            : formatRelativeDate(reply.createdAt, tCommon, intlLocale(locale))}
                          {reply.editedAt ? (
                            <span style={{ opacity: 0.45, fontStyle: "italic", marginInlineStart: 2 }}>
                              {" "}{tPosts("editedSuffix")}
                            </span>
                          ) : null}
                        </TextButton>
                      </div>
                    </div>

                    {/* Reply actions portal */}
                    {replyActionsMenuOpenId === reply.id && (
                      <ReplyActionsPortal
                        reply={reply}
                        groupId={groupId}
                        currentUserId={currentUserId}
                        isOwner={isOwner}
                        isModerator={isModerator}
                        canModerateGroupAuthor={canModerateGroupAuthor}
                        canUseGroupMemberBlock={canUseGroupMemberBlock}
                        editingReplyId={editingReplyId}
                        deletingReplyId={deletingReplyId}
                        onClose={() => setReplyActionsMenuOpenId(null)}
                        onStartEdit={() => handleStartEditReply(reply.id, reply.text)}
                        onDelete={() => handleDeleteReply(reply.id)}
                        onBlockComplete={onGroupMemberBlockComplete}
                        onModerationComplete={onModerationComplete}
                        onError={setInlineError}
                        onReport={() => openReport({
                          targetType: "comment_reply",
                          targetId: reply.id,
                          parentId: postId,
                          targetOwnerId: reply.authorId,
                        })}
                      />
                    )}
                  </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {reportTarget && <ReportModal target={reportTarget} onClose={closeReport} />}

      {/* Comment actions portal */}
      {commentMenuOpen && typeof document !== "undefined" && (
        <CommentActionsPortal
          comment={comment}
          groupId={groupId}
          currentUserId={currentUserId}
          isOwner={isOwner}
          isModerator={isModerator}
          isPostAuthor={isPostAuthor}
          canModerateGroupAuthor={canModerateGroupAuthor}
          canUseGroupMemberBlock={canUseGroupMemberBlock}
          editingComment={editingComment}
          deletingCommentId={deletingCommentId}
          onClose={() => setCommentMenuOpen(false)}
          onStartEdit={handleStartEditComment}
          onDelete={() => { void onDeleteComment(comment.id); }}
          onBlockComplete={onGroupMemberBlockComplete}
          onModerationComplete={onModerationComplete}
          onError={setInlineError}
          onReport={() => openReport({
            targetType: "comment",
            targetId: comment.id,
            parentId: postId,
            targetOwnerId: comment.authorId,
          })}
        />
      )}
      <VibraToast toast={threadToast} />
    </div>
  );
}
