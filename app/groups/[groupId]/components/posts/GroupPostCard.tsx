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
import { createPortal } from "react-dom";
import type { Comment, Post } from "@/lib/posts/types";
import {
  banGroupMember,
  muteGroupMember,
  removeGroupMember,
  unbanGroupMember,
  unmuteGroupMember,
} from "@/lib/groups/groupModeration";

type GroupPostCardProps = {
  post: Post & {
    authorMemberStatus?: "active" | "muted" | "banned" | "removed" | null;
    authorMutedUntil?: any;
    forcedGroupId?: string | null;
  };
  canDelete?: boolean;
  onDelete?: (postId: string) => Promise<void>;
  onLoadComments: (postId: string) => Promise<Comment[]>;
  onCreateComment: (postId: string, text: string) => Promise<Comment[]>;
  onDeleteComment: (postId: string, commentId: string) => Promise<Comment[]>;
  currentUserId?: string | null;
  isOwner?: boolean;
  showGroupContext?: boolean;
  canModerateGroupAuthor?: boolean;
  onModerationComplete?: () => Promise<void> | void;
};

type ModerationAction =
  | "mute"
  | "unmute"
  | "ban"
  | "unban"
  | "remove"
  | "delete_post";

type MenuPosition = {
  top: number;
  left: number;
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
  entity: { authorId?: string | null } & Record<string, unknown>
) {
  const authorId = typeof entity.authorId === "string" ? entity.authorId : "";

  const authorName =
    typeof entity.authorName === "string" && entity.authorName.trim().length > 0
      ? entity.authorName.trim()
      : typeof entity.displayName === "string" &&
          entity.displayName.trim().length > 0
        ? entity.displayName.trim()
        : typeof entity.name === "string" && entity.name.trim().length > 0
          ? entity.name.trim()
          : authorId || "Usuario";

  const avatarUrl =
    typeof entity.authorAvatarUrl === "string" &&
    entity.authorAvatarUrl.trim().length > 0
      ? entity.authorAvatarUrl.trim()
      : typeof entity.avatarUrl === "string" && entity.avatarUrl.trim().length > 0
        ? entity.avatarUrl.trim()
        : typeof entity.photoURL === "string" && entity.photoURL.trim().length > 0
          ? entity.photoURL.trim()
          : null;

  const username =
    typeof entity.authorUsername === "string" &&
    entity.authorUsername.trim().length > 0
      ? entity.authorUsername.trim()
      : typeof entity.username === "string" && entity.username.trim().length > 0
        ? entity.username.trim()
        : null;

  const profileHref = username ? `/u/${username}` : `/u/${authorId}`;

  return {
    authorId,
    authorName,
    avatarUrl,
    profileHref,
    initials: getInitials(authorName),
  };
}

function getGroupInfo(entity: Record<string, unknown>) {
  const forcedGroupId =
    typeof entity.forcedGroupId === "string" && entity.forcedGroupId.trim().length > 0
      ? entity.forcedGroupId.trim()
      : null;

  const rawGroupId =
    typeof entity.groupId === "string" && entity.groupId.trim().length > 0
      ? entity.groupId.trim()
      : null;

  const groupId = forcedGroupId || rawGroupId;

  const groupName =
    typeof entity.groupName === "string" && entity.groupName.trim().length > 0
      ? entity.groupName.trim()
      : null;

  const groupAvatarUrl =
    typeof entity.groupAvatarUrl === "string" &&
    entity.groupAvatarUrl.trim().length > 0
      ? entity.groupAvatarUrl.trim()
      : null;

  const rawVisibility =
    typeof entity.groupVisibility === "string"
      ? entity.groupVisibility.trim().toLowerCase()
      : "";

  const visibility =
    rawVisibility === "public" || rawVisibility === "private" || rawVisibility === "hidden"
      ? rawVisibility
      : null;

  const href = groupId ? `/groups/${groupId}` : null;

  return {
    groupId,
    groupName,
    groupAvatarUrl,
    visibility,
    href,
    initials: getInitials(groupName || "Comunidad"),
  };
}

function getCommunityVisibilityLabel(visibility: string | null) {
  switch (visibility) {
    case "public":
      return "Comunidad pública";
    case "private":
      return "Comunidad privada";
    case "hidden":
      return "Comunidad oculta";
    default:
      return "Comunidad";
  }
}

function resolveEffectiveMemberStatus(rawStatus: unknown, mutedUntil: any) {
  const status =
    typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";

  if (status === "banned") return "banned";
  if (status === "removed" || status === "kicked" || status === "expelled") {
    return "removed";
  }

  if (status === "muted") {
    if (mutedUntil?.toDate instanceof Function) {
      const until = mutedUntil.toDate();
      if (until instanceof Date && until.getTime() <= Date.now()) {
        return "active";
      }
    }
    return "muted";
  }

  return "active";
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

function buildActionLabel(action: ModerationAction) {
  if (action === "mute") return "Mutear";
  if (action === "unmute") return "Quitar mute";
  if (action === "ban") return "Banear";
  if (action === "unban") return "Quitar ban";
  if (action === "remove") return "Expulsar del grupo";
  return "Eliminar publicación";
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
  showGroupContext = false,
  canModerateGroupAuthor = false,
  onModerationComplete,
}: GroupPostCardProps) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [creatingComment, setCreatingComment] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [muteModalOpen, setMuteModalOpen] = useState(false);
  const [muteDays, setMuteDays] = useState("7");
  const [inlineActionError, setInlineActionError] = useState<string | null>(null);

  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

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
    if (!inlineActionError) return;

    const timer = window.setTimeout(() => {
      setInlineActionError(null);
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [inlineActionError]);

  useEffect(() => {
    if (!menuOpen) return;

    function updateMenuPosition() {
      const button = menuButtonRef.current;
      if (!button) {
        setMenuPosition(null);
        return;
      }

      const rect = button.getBoundingClientRect();
      const panelWidth = isMobile ? 180 : 200;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const estimatedPanelHeight = 230;
      const gap = 8;

      let left = rect.right - panelWidth;
      if (left < 8) left = 8;
      if (left + panelWidth > viewportWidth - 8) {
        left = viewportWidth - panelWidth - 8;
      }

      let top = rect.bottom + gap;
      if (top + estimatedPanelHeight > viewportHeight - 8) {
        top = Math.max(8, rect.top - estimatedPanelHeight - gap);
      }

      setMenuPosition({ top, left });
    }

    updateMenuPosition();

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen, isMobile]);

  useEffect(() => {
    if (!menuOpen && !muteModalOpen) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;

      const clickedInsidePanel =
        !!menuPanelRef.current && menuPanelRef.current.contains(target);
      const clickedButton =
        !!menuButtonRef.current && menuButtonRef.current.contains(target);

      if (!clickedInsidePanel && !clickedButton && !muteModalOpen) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setMuteModalOpen(false);
        setMuteDays("7");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen, muteModalOpen]);

  const postAuthor = useMemo(
    () =>
      getAuthorInfo(
        post as unknown as { authorId?: string | null } & Record<string, unknown>
      ),
    [post]
  );

  const groupInfo = useMemo(
    () => getGroupInfo(post as unknown as Record<string, unknown>),
    [post]
  );

  const effectiveAuthorStatus = useMemo(() => {
    return resolveEffectiveMemberStatus(
      (post as any)?.authorMemberStatus ?? (post as any)?.memberStatus ?? null,
      (post as any)?.authorMutedUntil ?? null
    );
  }, [post]);

  const authorStatusBadge = useMemo(() => {
    if (effectiveAuthorStatus === "banned") {
      return {
        text: "Baneado",
        border: "1px solid rgba(255,70,70,0.34)",
        background: "rgba(255,70,70,0.14)",
        color: "#ff8a8a",
      };
    }

    if (effectiveAuthorStatus === "muted") {
      return {
        text: "Muteado",
        border: "1px solid rgba(245,166,35,0.34)",
        background: "rgba(245,166,35,0.14)",
        color: "#ffd48a",
      };
    }

    if (effectiveAuthorStatus === "removed") {
      return {
        text: "Expulsado",
        border: "1px solid rgba(255,70,70,0.34)",
        background: "rgba(255,70,70,0.14)",
        color: "#ff8a8a",
      };
    }

    return null;
  }, [effectiveAuthorStatus]);

  const shouldShowGroupContext =
    showGroupContext && (!!groupInfo.groupId || !!groupInfo.groupName);

  const canModerateAuthor =
    canModerateGroupAuthor &&
    !!groupInfo.groupId &&
    !!postAuthor.authorId &&
    !!currentUserId &&
    postAuthor.authorId !== currentUserId;

  const availableActions = useMemo(() => {
    const actions: ModerationAction[] = [];

    if (canModerateAuthor) {
      if (effectiveAuthorStatus === "banned") {
        actions.push("unban");
      } else if (effectiveAuthorStatus === "muted") {
        actions.push("unmute", "ban", "remove");
      } else if (effectiveAuthorStatus === "removed") {
      } else {
        actions.push("mute", "ban", "remove");
      }
    }

    if (canDelete && onDelete) {
      actions.push("delete_post");
    }

    return actions;
  }, [canModerateAuthor, effectiveAuthorStatus, canDelete, onDelete]);

  async function refreshAfterModeration() {
    await onModerationComplete?.();
  }

  async function handleLoadComments() {
    try {
      setLoadingComments(true);
      setInlineActionError(null);
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
      setInlineActionError(null);
      const nextComments = await onCreateComment(post.id, commentText.trim());
      setComments(nextComments);
      setCommentText("");
    } catch (e: any) {
      const message = e?.message ?? "No se pudo comentar.";
      setInlineActionError(message);
    } finally {
      setCreatingComment(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || deleting) return;

    try {
      setDeleting(true);
      await onDelete(post.id);
      setMenuOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  async function runModerationAction(action: Exclude<ModerationAction, "mute" | "delete_post">) {
    if (!groupInfo.groupId || !postAuthor.authorId || moderationBusy) return;

    try {
      setModerationBusy(true);

      if (action === "unmute") {
        await unmuteGroupMember(groupInfo.groupId, postAuthor.authorId);
      } else if (action === "ban") {
        await banGroupMember(groupInfo.groupId, postAuthor.authorId);
      } else if (action === "unban") {
        await unbanGroupMember(groupInfo.groupId, postAuthor.authorId);
      } else if (action === "remove") {
        await removeGroupMember(groupInfo.groupId, postAuthor.authorId);
      }

      setMenuOpen(false);
      await refreshAfterModeration();
    } finally {
      setModerationBusy(false);
    }
  }

  async function handleConfirmMute() {
    if (!groupInfo.groupId || !postAuthor.authorId || moderationBusy) return;

    const durationDays = Number(muteDays);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      return;
    }

    try {
      setModerationBusy(true);
      await muteGroupMember(groupInfo.groupId, postAuthor.authorId, durationDays);
      setMuteModalOpen(false);
      setMenuOpen(false);
      setMuteDays("7");
      await refreshAfterModeration();
    } finally {
      setModerationBusy(false);
    }
  }

  async function handleModerationAction(action: ModerationAction) {
    if (action === "delete_post") {
      await handleDelete();
      return;
    }

    if (action === "mute") {
      setMuteDays("7");
      setMuteModalOpen(true);
      setMenuOpen(false);
      return;
    }

    await runModerationAction(action);
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
    maxWidth: "100%",
    wordBreak: "break-word",
    flexShrink: 0,
  };

  const statusBadgeStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 20,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };

  const communityWrapStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: isMobile ? 5 : 6,
    minWidth: 0,
    maxWidth: "100%",
    flex: "0 1 auto",
    color: "rgba(255,255,255,0.52)",
    fontSize: 10.5,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    verticalAlign: "middle",
    overflow: "hidden",
    whiteSpace: "nowrap",
  };

  const communityNameBaseStyle: CSSProperties = {
    color: "rgba(255,255,255,0.64)",
    textDecoration: "none",
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    minWidth: 0,
    flex: "1 1 auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: "block",
  };

  const communityMetaTextStyle: CSSProperties = {
    color: "rgba(255,255,255,0.46)",
    fontSize: 10.25,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    flexShrink: 0,
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

  const menuButtonStyle: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: menuOpen ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.84)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    flexShrink: 0,
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
  };

  const menuPanelStyle: CSSProperties = {
    position: "fixed",
    minWidth: isMobile ? 180 : 200,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(12,12,12,0.96)",
    boxShadow: "0 14px 34px rgba(0,0,0,0.34)",
    backdropFilter: "blur(12px)",
    padding: 6,
    zIndex: 99999,
    display: "grid",
    gap: 4,
  };

  const menuItemStyle: CSSProperties = {
    width: "100%",
    minHeight: 34,
    padding: "8px 10px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "#fff",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: fontStack,
    textAlign: "left",
    cursor: "pointer",
  };

  const dangerMenuItemStyle: CSSProperties = {
    ...menuItemStyle,
    color: "#ff8a8a",
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

  const modalBackdropStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.62)",
    display: "grid",
    placeItems: "center",
    padding: 16,
    zIndex: 100000,
  };

  const modalCardStyle: CSSProperties = {
    width: "min(420px, 92vw)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(12,12,12,0.98)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    padding: 16,
    display: "grid",
    gap: 12,
    color: "#fff",
  };

  const modalTitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.15,
  };

  const modalTextStyle: CSSProperties = {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.76)",
  };

  const modalInputStyle: CSSProperties = {
    width: "100%",
    height: 42,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    padding: "0 12px",
    outline: "none",
    fontSize: 13,
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  const inlineErrorStyle: CSSProperties = {
    marginTop: 8,
    borderRadius: 10,
    border: "1px solid rgba(255,90,90,0.24)",
    background: "rgba(120,18,18,0.28)",
    color: "#ffdada",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.4,
  };

  const shouldShowActionsMenu = availableActions.length > 0;

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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "nowrap",
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <Link href={postAuthor.profileHref} style={authorLinkStyle}>
                {postAuthor.authorName}
              </Link>

              {authorStatusBadge && (
                <span
                  style={{
                    ...statusBadgeStyle,
                    border: authorStatusBadge.border,
                    background: authorStatusBadge.background,
                    color: authorStatusBadge.color,
                  }}
                >
                  {authorStatusBadge.text}
                </span>
              )}

              {shouldShowGroupContext && (
                <div style={communityWrapStyle}>
                  {!isMobile && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 1,
                        height: 12,
                        background: "rgba(255,255,255,0.12)",
                        flexShrink: 0,
                        marginRight: 2,
                      }}
                    />
                  )}

                  {groupInfo.href ? (
                    <Link
                      href={groupInfo.href}
                      style={{
                        display: "inline-flex",
                        textDecoration: "none",
                        flexShrink: 0,
                      }}
                    >
                      <Avatar
                        name={groupInfo.groupName || "Comunidad"}
                        avatarUrl={groupInfo.groupAvatarUrl}
                        size={isMobile ? 15 : 16}
                      />
                    </Link>
                  ) : (
                    <Avatar
                      name={groupInfo.groupName || "Comunidad"}
                      avatarUrl={groupInfo.groupAvatarUrl}
                      size={isMobile ? 15 : 16}
                    />
                  )}

                  {groupInfo.href ? (
                    <Link href={groupInfo.href} style={communityNameBaseStyle}>
                      {groupInfo.groupName || "Comunidad"}
                    </Link>
                  ) : (
                    <span style={communityNameBaseStyle}>
                      {groupInfo.groupName || "Comunidad"}
                    </span>
                  )}

                  <span
                    aria-hidden="true"
                    style={{
                      color: "rgba(255,255,255,0.26)",
                      flexShrink: 0,
                    }}
                  >
                    •
                  </span>

                  <span style={communityMetaTextStyle}>
                    {getCommunityVisibilityLabel(groupInfo.visibility)}
                  </span>
                </div>
              )}
            </div>

            <div style={{ ...metaStyle, marginTop: 4 }}>
              {formatDate(post.createdAt)}
            </div>
          </div>
        </div>

        {shouldShowActionsMenu && (
          <div
            style={{
              position: "relative",
              flexShrink: 0,
            }}
          >
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Abrir acciones de la publicación"
              style={menuButtonStyle}
              disabled={deleting || moderationBusy}
            >
              ⋮
            </button>
          </div>
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
                comment as unknown as { authorId?: string | null } & Record<string, unknown>
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

        {inlineActionError && (
          <div style={inlineErrorStyle}>{inlineActionError}</div>
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

      {menuOpen &&
        menuPosition &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuPanelRef}
            style={{
              ...menuPanelStyle,
              top: menuPosition.top,
              left: menuPosition.left,
            }}
            role="menu"
          >
            {availableActions.map((action) => {
              const isDanger =
                action === "ban" ||
                action === "remove" ||
                action === "delete_post";

              const isBusy = moderationBusy || deleting;

              return (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  disabled={isBusy}
                  onClick={() => handleModerationAction(action)}
                  style={
                    isBusy
                      ? {
                          ...menuItemStyle,
                          color: "rgba(255,255,255,0.40)",
                          cursor: "not-allowed",
                        }
                      : isDanger
                        ? dangerMenuItemStyle
                        : menuItemStyle
                  }
                >
                  {isBusy ? "Procesando..." : buildActionLabel(action)}
                </button>
              );
            })}
          </div>,
          document.body
        )}

      {muteModalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={modalBackdropStyle}
            onClick={() => !moderationBusy && setMuteModalOpen(false)}
          >
            <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
              <h3 style={modalTitleStyle}>Mutear integrante</h3>
              <p style={modalTextStyle}>
                Elige durante cuántos días quieres mutear a{" "}
                <strong>{postAuthor.authorName}</strong>.
              </p>

              <input
                type="number"
                min={1}
                max={365}
                value={muteDays}
                onChange={(e) => setMuteDays(e.target.value)}
                style={modalInputStyle}
                placeholder="Ej. 7"
                disabled={moderationBusy}
              />

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => setMuteModalOpen(false)}
                  disabled={moderationBusy}
                  style={disabledButtonStyle}
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleConfirmMute}
                  disabled={
                    moderationBusy ||
                    !Number.isInteger(Number(muteDays)) ||
                    Number(muteDays) < 1 ||
                    Number(muteDays) > 365
                  }
                  style={
                    moderationBusy ||
                    !Number.isInteger(Number(muteDays)) ||
                    Number(muteDays) < 1 ||
                    Number(muteDays) > 365
                      ? disabledButtonStyle
                      : primaryButtonStyle
                  }
                >
                  {moderationBusy ? "Aplicando..." : "Aplicar mute"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </article>
  );
}