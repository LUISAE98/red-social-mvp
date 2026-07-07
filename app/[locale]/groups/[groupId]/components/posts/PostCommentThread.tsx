"use client";

import Image from "next/image";
import Link from "next/link";
import { Timestamp, doc, getDoc } from "firebase/firestore";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import type { Comment, CommentReply } from "@/lib/posts/types";
import { toggleCommentFlame, updatePostComment, updatePostCommentReply } from "@/lib/posts/post-service";
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

type PostCommentThreadProps = {
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
  onGroupMemberBlockComplete?: () => Promise<void> | void;
  onModerationComplete?: () => Promise<void> | void;
  showAdminDetails?: boolean;
};

const fontStack =
  'inherit';

const ACTIONS_MENU_STYLES = `
  @keyframes vbCmtMenuFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes vbCmtMenuScaleIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
  @keyframes vbCmtMenuSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
`;

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

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function renderWithLinks(text: string) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) =>
    URL_REGEX.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "#a855f7", textDecoration: "none" }}
      >
        {part}
      </a>
    ) : (
      part
    )
  );
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

function useGroupMemberStatus(
  groupId: string | null,
  userId: string | null,
  enabled: boolean,
): string | null {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !groupId || !userId) {
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

/** Shared portal panel for comment or reply actions (desktop + mobile). */
function ActionsPortal({
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

function ActionMenuItem({
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

const MUTE_MODAL_STYLES = {
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
function ReplyActionsPortal({
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
    const confirmed = window.confirm("¿Seguro que quieres bloquear a este usuario en este grupo?");
    if (!confirmed) return;
    try { onError(null); await block(); onClose(); await onBlockComplete?.(); }
    catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo bloquear en este grupo."); }
  }

  async function handleUnblockInGroup() {
    if (blockLoading) return;
    try { onError(null); await unblock(); onClose(); await onBlockComplete?.(); }
    catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo desbloquear en este grupo."); }
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
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo mutear al usuario."); }
    finally { setModerationBusy(false); }
  }

  async function handleUnmute() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm("¿Quitar el mute a este usuario?")) return;
    try {
      setModerationBusy(true);
      await unmuteGroupMember(groupId, reply.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo quitar el mute."); }
    finally { setModerationBusy(false); }
  }

  async function handleBan() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm("¿Seguro que quieres banear a este usuario de la comunidad?")) return;
    try {
      setModerationBusy(true);
      await banGroupMember(groupId, reply.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo banear al usuario."); }
    finally { setModerationBusy(false); }
  }

  async function handleUnban() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm("¿Quitar el ban a este usuario?")) return;
    try {
      setModerationBusy(true);
      await unbanGroupMember(groupId, reply.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo quitar el ban."); }
    finally { setModerationBusy(false); }
  }

  async function handleRemove() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm("¿Seguro que quieres expulsar a este usuario de la comunidad?")) return;
    try {
      setModerationBusy(true);
      await removeGroupMember(groupId, reply.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo expulsar al usuario."); }
    finally { setModerationBusy(false); }
  }

  async function handleSocialBlock() {
    if (!window.confirm("¿Seguro que quieres bloquear el perfil de este usuario?")) return;
    try { await socialBlock(); onClose(); }
    catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo bloquear el perfil."); }
  }

  async function handleSocialUnblock() {
    try { await socialUnblock(); onClose(); }
    catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo desbloquear el perfil."); }
  }

  const items: React.ReactNode[] = [];

  if (canEditReply) {
    items.push(
      <ActionMenuItem key="edit" index={items.length} onClick={() => { onStartEdit(); onClose(); }}>
        Editar respuesta
      </ActionMenuItem>,
    );
  }

  if (canDeleteReply) {
    items.push(
      <ActionMenuItem key="delete" index={items.length} danger disabled={deletingReplyId === reply.id}
        onClick={() => { onDelete(); onClose(); }}>
        {deletingReplyId === reply.id ? "Eliminando..." : "Eliminar respuesta"}
      </ActionMenuItem>,
    );
  }

  if (canModerateMember && authorStatus !== "removed") {
    if (authorStatus === "muted") {
      items.push(<ActionMenuItem key="unmute" index={items.length} disabled={moderationBusy} onClick={handleUnmute}>{moderationBusy ? "Procesando..." : "Quitar mute"}</ActionMenuItem>);
      items.push(<ActionMenuItem key="ban" index={items.length} danger disabled={moderationBusy} onClick={handleBan}>{moderationBusy ? "Procesando..." : "Banear"}</ActionMenuItem>);
    } else if (authorStatus === "banned") {
      items.push(<ActionMenuItem key="unban" index={items.length} disabled={moderationBusy} onClick={handleUnban}>{moderationBusy ? "Procesando..." : "Quitar ban"}</ActionMenuItem>);
    } else {
      items.push(<ActionMenuItem key="mute" index={items.length} disabled={moderationBusy} onClick={() => setMuteModalOpen(true)}>Mutear</ActionMenuItem>);
      items.push(<ActionMenuItem key="ban" index={items.length} danger disabled={moderationBusy} onClick={handleBan}>{moderationBusy ? "Procesando..." : "Banear"}</ActionMenuItem>);
      items.push(<ActionMenuItem key="remove" index={items.length} danger disabled={moderationBusy} onClick={handleRemove}>{moderationBusy ? "Procesando..." : "Expulsar"}</ActionMenuItem>);
    }
  }

  if (canGroupBlock && !groupBlockRel.isBlockedBy) {
    items.push(
      <ActionMenuItem key="group-block" index={items.length} disabled={blockLoading}
        onClick={groupBlockRel.hasBlocked ? handleUnblockInGroup : handleBlockInGroup}>
        {blockLoading ? "Procesando..." : groupBlockRel.hasBlocked ? "Desbloquear en este grupo" : "Bloquear en este grupo"}
      </ActionMenuItem>,
    );
  }

  if (canSocialBlock && !socialRel.isBlockedBy) {
    items.push(
      <ActionMenuItem key="social-block" index={items.length} disabled={socialLoading}
        onClick={socialRel.hasBlocked ? handleSocialUnblock : handleSocialBlock}>
        {socialLoading ? "Procesando..." : socialRel.hasBlocked ? "Desbloquear de mi perfil" : "Bloquear de mi perfil"}
      </ActionMenuItem>,
    );
  }

  if (onReport && currentUserId && currentUserId !== reply.authorId) {
    items.push(
      <ActionMenuItem key="report" index={items.length}
        onClick={() => { onClose(); onReport(); }}>
        Reportar respuesta
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
            <h3 style={MUTE_MODAL_STYLES.title}>Mutear integrante</h3>
            <p style={MUTE_MODAL_STYLES.text}>
              Elige durante cuántos días quieres mutear a{" "}
              <strong>{reply.authorName ?? "este usuario"}</strong>.
            </p>
            <input type="number" min={1} max={365} value={muteDays} onChange={(e) => setMuteDays(e.target.value)}
              style={{ ...MUTE_MODAL_STYLES.input, fontFamily: fontStack }} placeholder="Ej. 7" disabled={moderationBusy} />
            <div style={MUTE_MODAL_STYLES.row}>
              <button type="button" onClick={() => setMuteModalOpen(false)} disabled={moderationBusy}
                style={{ ...MUTE_MODAL_STYLES.cancelBtn, fontFamily: fontStack }}>Cancelar</button>
              <button type="button" onClick={handleMuteConfirm} disabled={moderationBusy || !muteValid}
                style={{ ...(moderationBusy || !muteValid ? MUTE_MODAL_STYLES.disabledBtn : MUTE_MODAL_STYLES.primaryBtn), fontFamily: fontStack }}>
                {moderationBusy ? "Aplicando..." : "Aplicar mute"}
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
function CommentActionsPortal({
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
    const confirmed = window.confirm("¿Seguro que quieres bloquear a este usuario en este grupo?");
    if (!confirmed) return;
    try { onError(null); await blockInGroup(); onClose(); await onBlockComplete?.(); }
    catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo bloquear en este grupo."); }
  }

  async function handleUnblockInGroup() {
    if (groupBlockLoading) return;
    try { onError(null); await unblockInGroup(); onClose(); await onBlockComplete?.(); }
    catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo desbloquear en este grupo."); }
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
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo mutear al usuario."); }
    finally { setModerationBusy(false); }
  }

  async function handleUnmute() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm("¿Quitar el mute a este usuario?")) return;
    try {
      setModerationBusy(true);
      await unmuteGroupMember(groupId, comment.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo quitar el mute."); }
    finally { setModerationBusy(false); }
  }

  async function handleBan() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm("¿Seguro que quieres banear a este usuario de la comunidad?")) return;
    try {
      setModerationBusy(true);
      await banGroupMember(groupId, comment.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo banear al usuario."); }
    finally { setModerationBusy(false); }
  }

  async function handleUnban() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm("¿Quitar el ban a este usuario?")) return;
    try {
      setModerationBusy(true);
      await unbanGroupMember(groupId, comment.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo quitar el ban."); }
    finally { setModerationBusy(false); }
  }

  async function handleRemove() {
    if (!groupId || moderationBusy) return;
    if (!window.confirm("¿Seguro que quieres expulsar a este usuario de la comunidad?")) return;
    try {
      setModerationBusy(true);
      await removeGroupMember(groupId, comment.authorId);
      onClose();
      await onModerationComplete?.();
    } catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo expulsar al usuario."); }
    finally { setModerationBusy(false); }
  }

  async function handleSocialBlock() {
    if (!window.confirm("¿Seguro que quieres bloquear el perfil de este usuario?")) return;
    try { await socialBlock(); onClose(); }
    catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo bloquear el perfil."); }
  }

  async function handleSocialUnblock() {
    try { await socialUnblock(); onClose(); }
    catch (e: unknown) { onError((e as Error)?.message ?? "No se pudo desbloquear el perfil."); }
  }

  const items: React.ReactNode[] = [];

  if (canEditOwnComment && !editingComment) {
    items.push(
      <ActionMenuItem key="edit" index={items.length} onClick={() => { onStartEdit(); onClose(); }}>
        Editar comentario
      </ActionMenuItem>,
    );
  }

  if (canDeleteComment) {
    items.push(
      <ActionMenuItem key="delete" index={items.length} danger disabled={deletingCommentId === comment.id}
        onClick={() => { onClose(); onDelete(); }}>
        {deletingCommentId === comment.id ? "Eliminando..." : "Eliminar comentario"}
      </ActionMenuItem>,
    );
  }

  if (canModerateMember && authorStatus !== "removed") {
    if (authorStatus === "muted") {
      items.push(<ActionMenuItem key="unmute" index={items.length} disabled={moderationBusy} onClick={handleUnmute}>{moderationBusy ? "Procesando..." : "Quitar mute"}</ActionMenuItem>);
      items.push(<ActionMenuItem key="ban" index={items.length} danger disabled={moderationBusy} onClick={handleBan}>{moderationBusy ? "Procesando..." : "Banear"}</ActionMenuItem>);
    } else if (authorStatus === "banned") {
      items.push(<ActionMenuItem key="unban" index={items.length} disabled={moderationBusy} onClick={handleUnban}>{moderationBusy ? "Procesando..." : "Quitar ban"}</ActionMenuItem>);
    } else {
      items.push(<ActionMenuItem key="mute" index={items.length} disabled={moderationBusy} onClick={() => setMuteModalOpen(true)}>Mutear</ActionMenuItem>);
      items.push(<ActionMenuItem key="ban" index={items.length} danger disabled={moderationBusy} onClick={handleBan}>{moderationBusy ? "Procesando..." : "Banear"}</ActionMenuItem>);
      items.push(<ActionMenuItem key="remove" index={items.length} danger disabled={moderationBusy} onClick={handleRemove}>{moderationBusy ? "Procesando..." : "Expulsar"}</ActionMenuItem>);
    }
  }

  if (canGroupBlock && !groupBlockRel.isBlockedBy) {
    items.push(
      <ActionMenuItem key="group-block" index={items.length} danger={!groupBlockRel.hasBlocked} disabled={groupBlockLoading}
        onClick={groupBlockRel.hasBlocked ? handleUnblockInGroup : handleBlockInGroup}>
        {groupBlockLoading ? "Procesando..." : groupBlockRel.hasBlocked ? "Desbloquear en este grupo" : "Bloquear en este grupo"}
      </ActionMenuItem>,
    );
  }

  if (canSocialBlock && !socialRel.isBlockedBy) {
    items.push(
      <ActionMenuItem key="social-block" index={items.length} disabled={socialLoading}
        onClick={socialRel.hasBlocked ? handleSocialUnblock : handleSocialBlock}>
        {socialLoading ? "Procesando..." : socialRel.hasBlocked ? "Desbloquear de mi perfil" : "Bloquear de mi perfil"}
      </ActionMenuItem>,
    );
  }

  if (onReport && currentUserId && currentUserId !== comment.authorId) {
    items.push(
      <ActionMenuItem key="report" index={items.length}
        onClick={() => { onClose(); onReport(); }}>
        Reportar comentario
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
            <h3 style={MUTE_MODAL_STYLES.title}>Mutear integrante</h3>
            <p style={MUTE_MODAL_STYLES.text}>
              Elige durante cuántos días quieres mutear a{" "}
              <strong>{comment.authorName ?? "este usuario"}</strong>.
            </p>
            <input type="number" min={1} max={365} value={muteDays} onChange={(e) => setMuteDays(e.target.value)}
              style={{ ...MUTE_MODAL_STYLES.input, fontFamily: fontStack }} placeholder="Ej. 7" disabled={moderationBusy} />
            <div style={MUTE_MODAL_STYLES.row}>
              <button type="button" onClick={() => setMuteModalOpen(false)} disabled={moderationBusy}
                style={{ ...MUTE_MODAL_STYLES.cancelBtn, fontFamily: fontStack }}>Cancelar</button>
              <button type="button" onClick={handleMuteConfirm} disabled={moderationBusy || !muteValid}
                style={{ ...(moderationBusy || !muteValid ? MUTE_MODAL_STYLES.disabledBtn : MUTE_MODAL_STYLES.primaryBtn), fontFamily: fontStack }}>
                {moderationBusy ? "Aplicando..." : "Aplicar mute"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

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
  deletingCommentId,
  onDeleteComment,
  onLoadReplies,
  onCreateReply,
  onDeleteReply,
  onGroupMemberBlockComplete,
  onModerationComplete,
  showAdminDetails = false,
}: PostCommentThreadProps) {
  const { reportTarget, openReport, closeReport } = useReport();
  const [replies, setReplies] = useState<CommentReply[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyBoxOpen, setReplyBoxOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [creatingReply, setCreatingReply] = useState(false);
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [commentLiked, setCommentLiked] = useState(comment.viewerHasFlamed === true);
  const [commentLikes, setCommentLikes] = useState(comment.counts?.likes ?? 0);
  const [localReplyCount, setLocalReplyCount] = useState(comment.counts?.replies ?? 0);
  const [commentFlameBusy, setCommentFlameBusy] = useState(false);
  const [showExactCommentDate, setShowExactCommentDate] = useState(false);
  const [exactReplyDates, setExactReplyDates] = useState<Record<string, boolean>>({});

  // Comment actions menu (⋯)
  const [commentMenuOpen, setCommentMenuOpen] = useState(false);
  // Reply actions menu (⋯) — tracks which reply's menu is open
  const [replyActionsMenuOpenId, setReplyActionsMenuOpenId] = useState<string | null>(null);

  const [editingComment, setEditingComment] = useState(false);
  const [editCommentText, setEditCommentText] = useState(comment.text);
  const [savingEditComment, setSavingEditComment] = useState(false);
  const [localCommentText, setLocalCommentText] = useState(comment.text);
  const [localCommentEditedAt, setLocalCommentEditedAt] = useState(comment.editedAt ?? null);

  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editReplyTexts, setEditReplyTexts] = useState<Record<string, string>>({});
  const [savingEditReplyId, setSavingEditReplyId] = useState<string | null>(null);

  // Detect mobile for portal layout
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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

  const author = getAuthorInfo(comment);
  const isOwnComment = currentUserId === comment.authorId;
  const canDeleteComment = isOwner || isModerator || isPostAuthor || isOwnComment;
  const canEditOwnComment = isOwnComment;

  const replyCount = localReplyCount;
  const hasRepliesToLoad = replyCount > 0;

  async function handleLoadReplies() {
    if (replies !== null || loadingReplies) return;

    try {
      setLoadingReplies(true);
      setInlineError(null);
      const nextReplies = await onLoadReplies(postId, comment.id);
      setReplies(nextReplies);
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudieron cargar las respuestas.");
    } finally {
      setLoadingReplies(false);
    }
  }

  async function handleCreateReply() {
    if (!canCommentOnPosts || creatingReply || replyText.trim().length === 0) return;

    try {
      setCreatingReply(true);
      setInlineError(null);
      const nextReplies = await onCreateReply(postId, comment.id, replyText.trim());
      setReplies(nextReplies);
      setLocalReplyCount(nextReplies.length);
      setReplyText("");
      setReplyBoxOpen(false);
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudo responder.");
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
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudo eliminar la respuesta.");
    } finally {
      setDeletingReplyId(null);
    }
  }

  function handleStartEditComment() {
    setEditingComment(true);
    setEditCommentText(localCommentText);
  }

  function handleCancelEditComment() {
    setEditingComment(false);
    setEditCommentText(localCommentText);
  }

  async function handleSaveEditComment() {
    const trimmed = editCommentText.trim();
    if (savingEditComment || !trimmed) return;

    try {
      setSavingEditComment(true);
      setInlineError(null);
      await updatePostComment({ postId, commentId: comment.id, text: trimmed });
      setLocalCommentText(trimmed);
      setLocalCommentEditedAt(Timestamp.now());
      setEditingComment(false);
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudo guardar el comentario.");
    } finally {
      setSavingEditComment(false);
    }
  }

  function handleStartEditReply(replyId: string, currentText: string) {
    setEditingReplyId(replyId);
    setEditReplyTexts((prev) => ({ ...prev, [replyId]: currentText }));
  }

  function handleCancelEditReply() {
    setEditingReplyId(null);
  }

  async function handleSaveEditReply(replyId: string) {
    const text = (editReplyTexts[replyId] ?? "").trim();
    if (savingEditReplyId || !text) return;

    try {
      setSavingEditReplyId(replyId);
      setInlineError(null);
      await updatePostCommentReply({ postId, commentId: comment.id, replyId, text });
      setReplies(
        (prev) =>
          prev?.map((r) => r.id === replyId ? { ...r, text, editedAt: Timestamp.now() } : r) ?? null,
      );
      setEditingReplyId(null);
    } catch (e: unknown) {
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudo guardar la respuesta.");
    } finally {
      setSavingEditReplyId(null);
    }
  }

  async function handleToggleCommentFlame() {
    if (!currentUserId) {
      setInlineError("Inicia sesión para dar flamita.");
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
      setInlineError((e instanceof Error ? e.message : null) ?? "No se pudo actualizar la flamita.");
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

  // Whether to show the comment ⋯ button
  const showCommentActionsMenu =
    !editingComment &&
    (canEditOwnComment ||
      canDeleteComment ||  // already includes isPostAuthor
      (canUseGroupMemberBlock && !!groupId && !!currentUserId && !isOwnComment) ||
      (canModerateGroupAuthor && !!groupId && !isOwnComment) ||
      (!isOwner && !isModerator && !!currentUserId && !isOwnComment));

  return (
    <div style={{ display: "grid", gap: 8 }}>
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
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f87171" }}>Comentario eliminado</span>
            {comment.deletedAt && (
              <span style={{ fontSize: 10, color: "rgba(239,68,68,0.6)", marginLeft: 6 }}>
                {comment.deletedAt.toDate().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
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
                  style={{ color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 600 }}
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
                    No es suscriptor
                  </span>
                )}

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
                  {(localCommentEditedAt ?? comment.editedAt) ? (
                    <span style={{ opacity: 0.45, fontStyle: "italic", marginLeft: 2 }}>
                      {" · Editado"}
                    </span>
                  ) : null}
                </button>
              </div>

              {editingComment ? (
                <div style={{ marginTop: 4 }}>
                  <AutoGrowTextarea
                    value={editCommentText}
                    onChange={(e) => setEditCommentText(e.target.value)}
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
                      {savingEditComment ? "Guardando..." : "Guardar"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEditComment}
                      disabled={savingEditComment}
                      style={actionButtonStyle}
                    >
                      Cancelar
                    </button>
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
                  {renderWithLinks(localCommentText)}
                </div>
              )}

              {showAdminDetails && comment.editHistory && comment.editHistory.length > 0 && (
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(251,191,36,0.65)", letterSpacing: "0.05em" }}>
                    VERSIONES ANTERIORES
                  </div>
                  {comment.editHistory.map((entry, idx) => (
                    <div key={idx} style={{
                      padding: "5px 8px",
                      borderRadius: 6,
                      background: "rgba(251,191,36,0.05)",
                      border: "1px solid rgba(251,191,36,0.12)",
                    }}>
                      <div style={{ fontSize: 10, color: "rgba(251,191,36,0.5)", marginBottom: 3 }}>
                        {entry.editedAt?.toDate().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
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
              <button
                type="button"
                onClick={handleToggleCommentFlame}
                aria-pressed={commentLiked}
                aria-label={commentLiked ? "Quitar flamita del comentario" : "Dar flamita al comentario"}
                style={{
                  width: 22,
                  height: 22,
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  display: "inline-grid",
                  placeItems: "center",
                  cursor: "pointer",
                  transform: commentLiked ? "scale(1.04)" : "scale(1)",
                  transition: "transform 140ms ease",
                  WebkitTapHighlightColor: "transparent",
                  flexShrink: 0,
                }}
              >
                <span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", lineHeight: 1 }}>
                  <VibraFlameIcon active={commentLiked} size={18} />
                </span>
              </button>
              <span
                aria-label={`${commentLikes} flamitas`}
                style={{ minWidth: 8, color: "rgba(255,255,255,0.62)", fontSize: 11.5, fontWeight: 600, lineHeight: 1 }}
              >
                {commentLikes}
              </span>
            </div>
          </div>

          {/* Comment action row */}
          <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {hasRepliesToLoad && (
              <button
                type="button"
                onClick={handleLoadReplies}
                disabled={loadingReplies}
                style={loadingReplies ? disabledActionButtonStyle : actionButtonStyle}
              >
                {loadingReplies
                  ? "Cargando..."
                  : replies === null
                    ? replyCount === 1 ? "Ver 1 respuesta" : `Ver ${replyCount} respuestas`
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

            {showCommentActionsMenu && (
              <button
                type="button"
                onClick={() => setCommentMenuOpen(true)}
                aria-label="Más acciones del comentario"
                style={actionButtonStyle}
              >
                Más opciones
              </button>
            )}
          </div>

          {/* Reply box */}
          {replyBoxOpen && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "flex-end", gap: 8 }}>
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
                disabled={!canCommentOnPosts || creatingReply || replyText.trim().length === 0}
                style={
                  !canCommentOnPosts || creatingReply || replyText.trim().length === 0
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

          {/* Replies */}
          {replies !== null && replies.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {replies.map((reply) => {
                const replyAuthor = getAuthorInfo(reply);
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
                        marginLeft: 4,
                      }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                        <div>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#f87171" }}>Respuesta eliminada</span>
                          {reply.deletedAt && (
                            <span style={{ fontSize: 9.5, color: "rgba(239,68,68,0.6)", marginLeft: 6 }}>
                              {reply.deletedAt.toDate().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 9, paddingLeft: 4 }}>
                    <Link href={replyAuthor.profileHref} style={{ flexShrink: 0 }}>
                      <Avatar name={replyAuthor.authorName} avatarUrl={replyAuthor.avatarUrl} size={26} />
                    </Link>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                        <Link
                          href={replyAuthor.profileHref}
                          style={{ color: "#fff", textDecoration: "none", fontSize: 11.5, fontWeight: 600 }}
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
                            No es suscriptor
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => setExactReplyDates((prev) => ({ ...prev, [reply.id]: !prev[reply.id] }))}
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
                          {reply.editedAt ? (
                            <span style={{ opacity: 0.45, fontStyle: "italic", marginLeft: 2 }}>
                              {" · Editado"}
                            </span>
                          ) : null}
                        </button>
                      </div>

                      {editingReplyId === reply.id ? (
                        <div style={{ marginTop: 4 }}>
                          <AutoGrowTextarea
                            value={editReplyTexts[reply.id] ?? reply.text}
                            onChange={(e) =>
                              setEditReplyTexts((prev) => ({ ...prev, [reply.id]: e.target.value }))
                            }
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
                              {savingEditReplyId === reply.id ? "Guardando..." : "Guardar"}
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEditReply}
                              disabled={savingEditReplyId === reply.id}
                              style={actionButtonStyle}
                            >
                              Cancelar
                            </button>
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
                          {renderWithLinks(reply.text)}
                        </div>
                      )}

                      {showAdminDetails && reply.editHistory && reply.editHistory.length > 0 && (
                        <div style={{ marginTop: 7, display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(251,191,36,0.65)", letterSpacing: "0.05em" }}>
                            VERSIONES ANTERIORES
                          </div>
                          {reply.editHistory.map((entry, idx) => (
                            <div key={idx} style={{
                              padding: "4px 7px",
                              borderRadius: 5,
                              background: "rgba(251,191,36,0.05)",
                              border: "1px solid rgba(251,191,36,0.12)",
                            }}>
                              <div style={{ fontSize: 9.5, color: "rgba(251,191,36,0.5)", marginBottom: 2 }}>
                                {entry.editedAt?.toDate().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                              </div>
                              <div style={{ fontSize: 11.5, fontWeight: 300, color: "rgba(255,255,255,0.5)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {entry.previousText}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply action row */}
                      <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 12 }}>
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

                        {showReplyActionsMenu && !editingReplyId && (
                          <button
                            type="button"
                            onClick={() => setReplyActionsMenuOpenId(reply.id)}
                            aria-label="Más acciones de la respuesta"
                            style={actionButtonStyle}
                          >
                            Más opciones
                          </button>
                        )}
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
                        isMobile={isMobile}
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
          isMobile={isMobile}
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
    </div>
  );
}
