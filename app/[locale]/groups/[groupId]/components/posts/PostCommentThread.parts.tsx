"use client";

// Tipos, helpers, hook useGroupMemberStatus y sub-componentes (Avatar, portales
// de acciones) de PostCommentThread, aislados a nivel de módulo.

import Image from "next/image";
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
import { toggleCommentFlame, updatePostComment, updatePostCommentReply } from "@/lib/posts/post-service";
import { uploadCommentImage } from "@/lib/posts/image-upload";
import MentionTextarea from "./mentions/MentionTextarea";
import { renderCommentText } from "./mentions/renderMentions";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { CommentAttachButton, CommentImageThumb } from "./CommentImageUI";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
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
import { useTranslations } from "next-intl";

export type PostCommentThreadProps = {
  postId: string;
  groupId?: string | null;
  comment: Comment;
  currentUserId?: string | null;
  isOwner?: boolean;
  isModerator?: boolean;
  canCommentOnPosts: boolean;
  canUseGroupMemberBlock?: boolean;
  canModerateGroupAuthor?: boolean;
  isPostAuthor?: boolean;
  /** true en posts de comunidad oculta: deshabilita la etiquetación con @. */
  mentionsDisabled?: boolean;
  deletingCommentId: string | null;
  onDeleteComment: (commentId: string) => Promise<void>;
  onLoadReplies: (postId: string, commentId: string) => Promise<CommentReply[]>;
  onCreateReply: (
    postId: string,
    commentId: string,
    text: string,
    mentions?: CommentMention[],
    image?: CommentImage | null
  ) => Promise<CommentReply[]>;
  onDeleteReply: (
    postId: string,
    commentId: string,
    replyId: string
  ) => Promise<CommentReply[]>;
  onGroupMemberBlockComplete?: () => Promise<void> | void;
  onModerationComplete?: () => Promise<void> | void;
  /** Abre el lightbox con la imagen de un comentario/respuesta (anima desde su miniatura). */
  onOpenCommentImage: (image: CommentImage, rect: DOMRect | null) => void;
  showAdminDetails?: boolean;
  /** Deep-link de notificaciones: si coincide con este comentario, se enfoca
   *  (scroll + resaltado) y se auto-expanden sus respuestas. */
  focusCommentId?: string | null;
};

export const fontStack =
  'inherit';

export const ACTIONS_MENU_STYLES = `
  @keyframes vbCmtMenuFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes vbCmtMenuScaleIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
  @keyframes vbCmtMenuSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
`;

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function getDateFromTimestamp(value?: { toDate?: () => Date } | null) {
  if (!value?.toDate) return null;

  try {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

export type TFunc = (key: string, params?: Record<string, number | string>) => string;

export function formatExactDate(value?: { toDate?: () => Date } | null, t?: TFunc, locale?: string) {
  const date = getDateFromTimestamp(value);
  const unavailable = t ? t("dateUnavailable") : "Fecha no disponible";

  if (!date) return unavailable;

  try {
    return new Intl.DateTimeFormat(locale ?? "es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return unavailable;
  }
}

export function formatRelativeDate(value?: { toDate?: () => Date } | null, t?: TFunc) {
  const date = getDateFromTimestamp(value);
  const now = t ? t("dateNow") : "Ahora mismo";

  if (!date) return now;

  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (!t) {
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

  if (diffSeconds < 30) return now;
  if (diffSeconds < 60) return t("dateSecondsAgo", { count: diffSeconds });
  if (diffMinutes < 60) return t("dateMinutesAgo", { count: diffMinutes });
  if (diffHours < 24) return t("dateHoursAgo", { count: diffHours });
  if (diffDays < 7) return t("dateDaysAgo", { count: diffDays });
  if (diffWeeks < 5) return t("dateWeeksAgo", { count: diffWeeks });
  if (diffMonths < 12) return t("dateMonthsAgo", { count: diffMonths });
  return t("dateYearsAgo", { count: diffYears });
}

export function getAuthorInfo(entity: {
  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  authorUsername?: string | null;
}, fallback?: string) {
  const authorId = entity.authorId || "";

  const authorName =
    typeof entity.authorName === "string" && entity.authorName.trim().length > 0
      ? entity.authorName.trim()
      : authorId || (fallback ?? "Usuario");

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

export function useGroupMemberStatus(
  groupId: string | null,
  userId: string | null,
  enabled: boolean,
): string | null {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !groupId || !userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(null);
      return;
    }

    void getDoc(doc(db, "groups", groupId, "members", userId))
      .then((snap) => {
        if (!snap.exists()) { setStatus(null); return; }
        const data = snap.data();
        const raw = typeof data?.status === "string" ? data.status.trim().toLowerCase() : "";
        const mutedUntil = data?.mutedUntil ?? null;

        if (raw === "banned") { setStatus("banned"); return; }
        if (["removed", "kicked", "expelled"].includes(raw)) { setStatus("removed"); return; }
        if (raw === "muted") {
          if (mutedUntil?.toDate instanceof Function) {
            const until = mutedUntil.toDate();
            setStatus(until instanceof Date && until.getTime() <= Date.now() ? "active" : "muted");
          } else {
            setStatus("muted");
          }
          return;
        }
        setStatus(raw === "active" || raw === "subscribed" ? "active" : null);
      })
      .catch(() => setStatus(null));
  }, [enabled, groupId, userId]);

  return status;
}

export function Avatar({
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
      <Image
        src={avatarUrl}
        alt={name}
        width={size} height={size}
        style={{
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

/** Shared portal panel for comment or reply actions (desktop + mobile). */
export function ActionsPortal({
  isMobile,
  onClose,
  children,
}: {
  isMobile: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <>
      <style>{ACTIONS_MENU_STYLES}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99990,
          background: "rgba(0,0,0,0.50)",
          animation: "vbCmtMenuFadeIn 0.18s ease",
        }}
        onClick={onClose}
      />

      {isMobile ? (
        /* Mobile: bottom sheet */
        <div
          role="menu"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 99991,
            background: "#111",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            border: "1px solid rgba(255,255,255,0.10)",
            borderBottom: "none",
            paddingTop: 12,
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
            display: "grid",
            gap: 0,
            overflow: "hidden",
            boxShadow: "0 -12px 40px rgba(0,0,0,0.50)",
            animation: "vbCmtMenuSlideUp 0.30s ease",
          }}
        >
          {/* Handle pill */}
          <div
            style={{
              width: 38,
              height: 4,
              borderRadius: 2,
              background: "rgba(255,255,255,0.18)",
              margin: "0 auto 12px",
            }}
          />
          {children}
        </div>
      ) : (
        /* Desktop: centered modal */
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99991,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            role="menu"
            style={{
              pointerEvents: "auto",
              width: "min(280px, 90vw)",
              background: "rgba(16,16,16,0.98)",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.10)",
              padding: 0,
              display: "grid",
              gap: 0,
              overflow: "hidden",
              boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
              backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
              animation: "vbCmtMenuScaleIn 0.18s ease",
            }}
          >
            {children}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

export function ActionMenuItem({
  index,
  danger,
  disabled,
  onClick,
  children,
}: {
  index: number;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "100%",
        minHeight: 46,
        padding: "10px 16px",
        border: "none",
        borderTop: index > 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
        borderRadius: 0,
        background: "transparent",
        color: disabled
          ? "rgba(255,255,255,0.35)"
          : danger
            ? "#ff8a8a"
            : "#fff",
        fontSize: 13.5,
        fontWeight: 500,
        fontFamily: fontStack,
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export const MUTE_MODAL_STYLES = {
  backdrop: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000 },
  card: { width: "min(420px, 92vw)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(16,16,16,0.98)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", padding: 24, display: "grid", gap: 16, color: "#fff" },
  title: { margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.35 },
  text: { margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "rgba(255,255,255,0.76)" },
  input: { width: "100%", height: 42, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, padding: "0 12px", boxSizing: "border-box" as const },
  row: { display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" as const },
  cancelBtn: { minHeight: 28, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.86)", fontSize: 11, fontWeight: 600, cursor: "pointer" },
  disabledBtn: { minHeight: 28, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.44)", fontSize: 11, fontWeight: 600, cursor: "not-allowed" as const },
  primaryBtn: { minHeight: 28, padding: "5px 9px", borderRadius: 8, border: "none", background: "#fff", color: "#000", fontSize: 11, fontWeight: 600, cursor: "pointer" },
};

/** Portal for a reply's actions — includes moderation, group block, and social block. */
export function ReplyActionsPortal({
  reply,
  groupId,
  currentUserId,
  isOwner,
  isModerator,
  canModerateGroupAuthor,
  canUseGroupMemberBlock,
  isMobile,
  editingReplyId,
  deletingReplyId,
  onClose,
  onStartEdit,
  onDelete,
  onBlockComplete,
  onModerationComplete,
  onError,
  onReport,
}: {
  reply: CommentReply;
  groupId: string | null;
  currentUserId: string | null;
  isOwner: boolean;
  isModerator: boolean;
  canModerateGroupAuthor: boolean;
  canUseGroupMemberBlock: boolean;
  isMobile: boolean;
  editingReplyId: string | null;
  deletingReplyId: string | null;
  onClose: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onBlockComplete?: () => Promise<void> | void;
  onModerationComplete?: () => Promise<void> | void;
  onError: (msg: string | null) => void;
  onReport?: () => void;
}) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  const isOwnReply = currentUserId === reply.authorId;
  const canDeleteReply = isOwner || isModerator || isOwnReply;
  const canEditReply = isOwnReply && editingReplyId !== reply.id;
  const canModerateMember = canModerateGroupAuthor && !!groupId && !!currentUserId && !isOwnReply;
  const canGroupBlock =
    !isOwner && !isModerator &&
    canUseGroupMemberBlock && !!groupId && !!currentUserId && !isOwnReply &&
    reply.viewerIsBlockedByAuthorInGroup !== true;
  const canSocialBlock = !isOwner && !isModerator && !!currentUserId && !!reply.authorId && !isOwnReply;

  const { relationship: groupBlockRel, loading: blockLoading, error: blockError, block, unblock } =
    useGroupMemberBlocks({ groupId, currentUserId, targetUserId: canGroupBlock ? reply.authorId : null });

  const { relationship: socialRel, loading: socialLoading, block: socialBlock, unblock: socialUnblock } =
    useSocialRelationship(currentUserId, canSocialBlock ? reply.authorId : null);

  const authorStatus = useGroupMemberStatus(groupId, canModerateMember ? reply.authorId : null, canModerateMember);

  const [moderationBusy, setModerationBusy] = useState(false);
  const [muteModalOpen, setMuteModalOpen] = useState(false);
  const [muteDays, setMuteDays] = useState("7");

  useEffect(() => {
    if (!blockError) return;
    onError(blockError);
  }, [blockError, onError]);

  async function handleBlockInGroup() {
    if (blockLoading) return;
    const confirmed = window.confirm(tGroups("confirmBlockInGroup"));
    if (!confirmed) return;
    try { onError(null); await block(); onClose(); await onBlockComplete?.(); }
    catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorBlockInGroup")); }
  }

  async function handleUnblockInGroup() {
    if (blockLoading) return;
    try { onError(null); await unblock(); onClose(); await onBlockComplete?.(); }
    catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorUnblockInGroup")); }
  }

  async function handleMuteConfirm() {
    const days = Number(muteDays);
    if (!Number.isInteger(days) || days < 1 || days > 365 || !groupId || moderationBusy) return;
    try {
      setModerationBusy(true);
      await muteGroupMember(groupId, reply.authorId, days);
      setMuteModalOpen(false);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorMuteUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleUnmute() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm(tGroups("confirmUnmuteUser"))) return;
    try {
      setModerationBusy(true);
      await unmuteGroupMember(groupId, reply.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorUnmuteUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleBan() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm(tGroups("confirmBanUser"))) return;
    try {
      setModerationBusy(true);
      await banGroupMember(groupId, reply.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorBanUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleUnban() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm(tGroups("confirmUnbanUser"))) return;
    try {
      setModerationBusy(true);
      await unbanGroupMember(groupId, reply.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorUnbanUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleRemove() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm(tGroups("confirmRemoveUser"))) return;
    try {
      setModerationBusy(true);
      await removeGroupMember(groupId, reply.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorRemoveUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleSocialBlock() {
    if (!window.confirm(tCommon("confirmBlockProfile"))) return;
    try { await socialBlock(); onClose(); }
    catch (e: unknown) { onError((e as Error)?.message ?? tCommon("errorBlockProfile")); }
  }

  async function handleSocialUnblock() {
    try { await socialUnblock(); onClose(); }
    catch (e: unknown) { onError((e as Error)?.message ?? tCommon("errorUnblockProfile")); }
  }

  const items: React.ReactNode[] = [];

  if (canEditReply) {
    items.push(
      <ActionMenuItem key="edit" index={items.length} onClick={() => { onStartEdit(); onClose(); }}>
        {tGroups("editReply")}
      </ActionMenuItem>,
    );
  }

  if (canDeleteReply) {
    items.push(
      <ActionMenuItem key="delete" index={items.length} danger disabled={deletingReplyId === reply.id}
        onClick={() => { onDelete(); onClose(); }}>
        {deletingReplyId === reply.id ? tGroups("deleting") : tGroups("deleteReply")}
      </ActionMenuItem>,
    );
  }

  if (canModerateMember && authorStatus !== "removed") {
    if (authorStatus === "muted") {
      items.push(<ActionMenuItem key="unmute" index={items.length} disabled={moderationBusy} onClick={handleUnmute}>{moderationBusy ? tGroups("processing") : tGroups("unmute")}</ActionMenuItem>);
      items.push(<ActionMenuItem key="ban" index={items.length} danger disabled={moderationBusy} onClick={handleBan}>{moderationBusy ? tGroups("processing") : tGroups("ban")}</ActionMenuItem>);
    } else if (authorStatus === "banned") {
      items.push(<ActionMenuItem key="unban" index={items.length} disabled={moderationBusy} onClick={handleUnban}>{moderationBusy ? tGroups("processing") : tGroups("unban")}</ActionMenuItem>);
    } else {
      items.push(<ActionMenuItem key="mute" index={items.length} disabled={moderationBusy} onClick={() => setMuteModalOpen(true)}>{tGroups("mute")}</ActionMenuItem>);
      items.push(<ActionMenuItem key="ban" index={items.length} danger disabled={moderationBusy} onClick={handleBan}>{moderationBusy ? tGroups("processing") : tGroups("ban")}</ActionMenuItem>);
      items.push(<ActionMenuItem key="remove" index={items.length} danger disabled={moderationBusy} onClick={handleRemove}>{moderationBusy ? tGroups("processing") : tGroups("remove")}</ActionMenuItem>);
    }
  }

  if (canGroupBlock && !groupBlockRel.isBlockedBy) {
    items.push(
      <ActionMenuItem key="group-block" index={items.length} disabled={blockLoading}
        onClick={groupBlockRel.hasBlocked ? handleUnblockInGroup : handleBlockInGroup}>
        {blockLoading ? tGroups("processing") : groupBlockRel.hasBlocked ? tGroups("unblockInGroup") : tGroups("blockInGroup")}
      </ActionMenuItem>,
    );
  }

  if (canSocialBlock && !socialRel.isBlockedBy) {
    items.push(
      <ActionMenuItem key="social-block" index={items.length} disabled={socialLoading}
        onClick={socialRel.hasBlocked ? handleSocialUnblock : handleSocialBlock}>
        {socialLoading ? tGroups("processing") : socialRel.hasBlocked ? tGroups("unblockProfile") : tGroups("blockProfile")}
      </ActionMenuItem>,
    );
  }

  if (onReport && currentUserId && currentUserId !== reply.authorId) {
    items.push(
      <ActionMenuItem key="report" index={items.length}
        onClick={() => { onClose(); onReport(); }}>
        {tGroups("reportReply")}
      </ActionMenuItem>,
    );
  }

  if (items.length === 0) return null;

  const daysNum = Number(muteDays);
  const muteValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 365;

  return (
    <>
      <ActionsPortal isMobile={isMobile} onClose={onClose}>
        {items}
      </ActionsPortal>

      {muteModalOpen && typeof document !== "undefined" && createPortal(
        <div style={MUTE_MODAL_STYLES.backdrop} onClick={() => !moderationBusy && setMuteModalOpen(false)}>
          <div style={{ ...MUTE_MODAL_STYLES.card, fontFamily: fontStack }} onClick={(e) => e.stopPropagation()}>
            <h3 style={MUTE_MODAL_STYLES.title}>{tGroups("muteModalTitle")}</h3>
            <p style={MUTE_MODAL_STYLES.text}>
              {tGroups("muteModalText", { name: reply.authorName ?? tGroups("muteModalThisUser") })}
            </p>
            <input type="number" min={1} max={365} value={muteDays} onChange={(e) => setMuteDays(e.target.value)}
              style={{ ...MUTE_MODAL_STYLES.input, fontFamily: fontStack }} placeholder={tGroups("muteModalPlaceholder")} disabled={moderationBusy} />
            <div style={MUTE_MODAL_STYLES.row}>
              <button type="button" onClick={() => setMuteModalOpen(false)} disabled={moderationBusy}
                style={{ ...MUTE_MODAL_STYLES.cancelBtn, fontFamily: fontStack }}>{tCommon("cancel")}</button>
              <button type="button" onClick={handleMuteConfirm} disabled={moderationBusy || !muteValid}
                style={{ ...(moderationBusy || !muteValid ? MUTE_MODAL_STYLES.disabledBtn : MUTE_MODAL_STYLES.primaryBtn), fontFamily: fontStack }}>
                {moderationBusy ? tGroups("muteModalApplying") : tGroups("muteModalApply")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Portal for a comment's actions — includes edit, delete, moderation, group block, social block. */
export function CommentActionsPortal({
  comment,
  groupId,
  currentUserId,
  isOwner,
  isModerator,
  isPostAuthor,
  canModerateGroupAuthor,
  canUseGroupMemberBlock,
  isMobile,
  editingComment,
  deletingCommentId,
  onClose,
  onStartEdit,
  onDelete,
  onBlockComplete,
  onModerationComplete,
  onError,
  onReport,
}: {
  comment: Comment;
  groupId: string | null;
  currentUserId: string | null;
  isOwner: boolean;
  isModerator: boolean;
  isPostAuthor: boolean;
  canModerateGroupAuthor: boolean;
  canUseGroupMemberBlock: boolean;
  isMobile: boolean;
  editingComment: boolean;
  deletingCommentId: string | null;
  onClose: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onBlockComplete?: () => Promise<void> | void;
  onModerationComplete?: () => Promise<void> | void;
  onError: (msg: string | null) => void;
  onReport?: () => void;
}) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  const isOwnComment = currentUserId === comment.authorId;
  const canEditOwnComment = isOwnComment;
  const canDeleteComment = isOwner || isModerator || isPostAuthor || isOwnComment;
  const canModerateMember = canModerateGroupAuthor && !!groupId && !!currentUserId && !isOwnComment;
  const canGroupBlock =
    !isOwner && !isModerator &&
    canUseGroupMemberBlock && !!groupId && !!currentUserId && !isOwnComment;
  const canSocialBlock = !isOwner && !isModerator && !!currentUserId && !!comment.authorId && !isOwnComment;

  const { relationship: groupBlockRel, loading: groupBlockLoading, error: groupBlockError, block: blockInGroup, unblock: unblockInGroup } =
    useGroupMemberBlocks({ groupId, currentUserId, targetUserId: canGroupBlock ? comment.authorId : null });

  const { relationship: socialRel, loading: socialLoading, block: socialBlock, unblock: socialUnblock } =
    useSocialRelationship(currentUserId, canSocialBlock ? comment.authorId : null);

  const authorStatus = useGroupMemberStatus(groupId, canModerateMember ? comment.authorId : null, canModerateMember);

  const [moderationBusy, setModerationBusy] = useState(false);
  const [muteModalOpen, setMuteModalOpen] = useState(false);
  const [muteDays, setMuteDays] = useState("7");

  useEffect(() => {
    if (!groupBlockError) return;
    onError(groupBlockError);
  }, [groupBlockError, onError]);

  async function handleBlockInGroup() {
    if (groupBlockLoading) return;
    const confirmed = window.confirm(tGroups("confirmBlockInGroup"));
    if (!confirmed) return;
    try { onError(null); await blockInGroup(); onClose(); await onBlockComplete?.(); }
    catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorBlockInGroup")); }
  }

  async function handleUnblockInGroup() {
    if (groupBlockLoading) return;
    try { onError(null); await unblockInGroup(); onClose(); await onBlockComplete?.(); }
    catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorUnblockInGroup")); }
  }

  async function handleMuteConfirm() {
    const days = Number(muteDays);
    if (!Number.isInteger(days) || days < 1 || days > 365 || !groupId || moderationBusy) return;
    try {
      setModerationBusy(true);
      await muteGroupMember(groupId, comment.authorId, days);
      setMuteModalOpen(false);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorMuteUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleUnmute() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm(tGroups("confirmUnmuteUser"))) return;
    try {
      setModerationBusy(true);
      await unmuteGroupMember(groupId, comment.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorUnmuteUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleBan() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm(tGroups("confirmBanUser"))) return;
    try {
      setModerationBusy(true);
      await banGroupMember(groupId, comment.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorBanUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleUnban() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm(tGroups("confirmUnbanUser"))) return;
    try {
      setModerationBusy(true);
      await unbanGroupMember(groupId, comment.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorUnbanUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleRemove() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm(tGroups("confirmRemoveUser"))) return;
    try {
      setModerationBusy(true);
      await removeGroupMember(groupId, comment.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? tGroups("errorRemoveUser")); }
    finally { setModerationBusy(false); }
  }

  async function handleSocialBlock() {
    if (!window.confirm(tCommon("confirmBlockProfile"))) return;
    try { await socialBlock(); onClose(); }
    catch (e: unknown) { onError((e as Error)?.message ?? tCommon("errorBlockProfile")); }
  }

  async function handleSocialUnblock() {
    try { await socialUnblock(); onClose(); }
    catch (e: unknown) { onError((e as Error)?.message ?? tCommon("errorUnblockProfile")); }
  }

  const items: React.ReactNode[] = [];

  if (canEditOwnComment && !editingComment) {
    items.push(
      <ActionMenuItem key="edit" index={items.length} onClick={() => { onStartEdit(); onClose(); }}>
        {tGroups("editComment")}
      </ActionMenuItem>,
    );
  }

  if (canDeleteComment) {
    items.push(
      <ActionMenuItem key="delete" index={items.length} danger disabled={deletingCommentId === comment.id}
        onClick={() => { onClose(); onDelete(); }}>
        {deletingCommentId === comment.id ? tGroups("deleting") : tGroups("deleteComment")}
      </ActionMenuItem>,
    );
  }

  if (canModerateMember && authorStatus !== "removed") {
    if (authorStatus === "muted") {
      items.push(<ActionMenuItem key="unmute" index={items.length} disabled={moderationBusy} onClick={handleUnmute}>{moderationBusy ? tGroups("processing") : tGroups("unmute")}</ActionMenuItem>);
      items.push(<ActionMenuItem key="ban" index={items.length} danger disabled={moderationBusy} onClick={handleBan}>{moderationBusy ? tGroups("processing") : tGroups("ban")}</ActionMenuItem>);
    } else if (authorStatus === "banned") {
      items.push(<ActionMenuItem key="unban" index={items.length} disabled={moderationBusy} onClick={handleUnban}>{moderationBusy ? tGroups("processing") : tGroups("unban")}</ActionMenuItem>);
    } else {
      items.push(<ActionMenuItem key="mute" index={items.length} disabled={moderationBusy} onClick={() => setMuteModalOpen(true)}>{tGroups("mute")}</ActionMenuItem>);
      items.push(<ActionMenuItem key="ban" index={items.length} danger disabled={moderationBusy} onClick={handleBan}>{moderationBusy ? tGroups("processing") : tGroups("ban")}</ActionMenuItem>);
      items.push(<ActionMenuItem key="remove" index={items.length} danger disabled={moderationBusy} onClick={handleRemove}>{moderationBusy ? tGroups("processing") : tGroups("remove")}</ActionMenuItem>);
    }
  }

  if (canGroupBlock && !groupBlockRel.isBlockedBy) {
    items.push(
      <ActionMenuItem key="group-block" index={items.length} danger={!groupBlockRel.hasBlocked} disabled={groupBlockLoading}
        onClick={groupBlockRel.hasBlocked ? handleUnblockInGroup : handleBlockInGroup}>
        {groupBlockLoading ? tGroups("processing") : groupBlockRel.hasBlocked ? tGroups("unblockInGroup") : tGroups("blockInGroup")}
      </ActionMenuItem>,
    );
  }

  if (canSocialBlock && !socialRel.isBlockedBy) {
    items.push(
      <ActionMenuItem key="social-block" index={items.length} disabled={socialLoading}
        onClick={socialRel.hasBlocked ? handleSocialUnblock : handleSocialBlock}>
        {socialLoading ? tGroups("processing") : socialRel.hasBlocked ? tGroups("unblockProfile") : tGroups("blockProfile")}
      </ActionMenuItem>,
    );
  }

  if (onReport && currentUserId && currentUserId !== comment.authorId) {
    items.push(
      <ActionMenuItem key="report" index={items.length}
        onClick={() => { onClose(); onReport(); }}>
        {tGroups("reportComment")}
      </ActionMenuItem>,
    );
  }

  if (items.length === 0) return null;

  const daysNum = Number(muteDays);
  const muteValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 365;

  return (
    <>
      <ActionsPortal isMobile={isMobile} onClose={onClose}>
        {items}
      </ActionsPortal>

      {muteModalOpen && typeof document !== "undefined" && createPortal(
        <div style={MUTE_MODAL_STYLES.backdrop} onClick={() => !moderationBusy && setMuteModalOpen(false)}>
          <div style={{ ...MUTE_MODAL_STYLES.card, fontFamily: fontStack }} onClick={(e) => e.stopPropagation()}>
            <h3 style={MUTE_MODAL_STYLES.title}>{tGroups("muteModalTitle")}</h3>
            <p style={MUTE_MODAL_STYLES.text}>
              {tGroups("muteModalText", { name: comment.authorName ?? tGroups("muteModalThisUser") })}
            </p>
            <input type="number" min={1} max={365} value={muteDays} onChange={(e) => setMuteDays(e.target.value)}
              style={{ ...MUTE_MODAL_STYLES.input, fontFamily: fontStack }} placeholder={tGroups("muteModalPlaceholder")} disabled={moderationBusy} />
            <div style={MUTE_MODAL_STYLES.row}>
              <button type="button" onClick={() => setMuteModalOpen(false)} disabled={moderationBusy}
                style={{ ...MUTE_MODAL_STYLES.cancelBtn, fontFamily: fontStack }}>{tCommon("cancel")}</button>
              <button type="button" onClick={handleMuteConfirm} disabled={moderationBusy || !muteValid}
                style={{ ...(moderationBusy || !muteValid ? MUTE_MODAL_STYLES.disabledBtn : MUTE_MODAL_STYLES.primaryBtn), fontFamily: fontStack }}>
                {moderationBusy ? tGroups("muteModalApplying") : tGroups("muteModalApply")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

