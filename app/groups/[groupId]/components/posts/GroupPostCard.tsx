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
import type { Comment, CommentReply, Post } from "@/lib/posts/types";
import PostFlamesPanel, { type PostFlameUser } from "./PostFlamesPanel";
import PostCommentsPanel from "./PostCommentsPanel";
import PostImageViewer from "./PostImageViewer";
import { fetchPostFlameUsers } from "@/lib/posts/post-service";
import {
  banGroupMember,
  muteGroupMember,
  removeGroupMember,
  unbanGroupMember,
  unmuteGroupMember,
} from "@/lib/groups/groupModeration";

type InteractionBlockedReason = "login" | "join" | "restricted" | null;

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
  onToggleFlame?: (postId: string) => Promise<void>;
  currentUserId?: string | null;
  isOwner?: boolean;
  isModerator?: boolean;
  showGroupContext?: boolean;
  canModerateGroupAuthor?: boolean;
  onModerationComplete?: () => Promise<void> | void;
  canCommentOnPosts?: boolean;
  commentBlockedReason?: InteractionBlockedReason;
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

function getPostTypeLabel(post: Post): string | null {
  if (post.postType === "video") return "Video";
  if (post.postType === "live") return "Live";
  if (post.postType === "scheduled_event") return "Evento";
  return null;
}

function getPostStatusLabel(post: Post): string | null {
  if (post.processing?.status === "uploading") return "Subiendo";
  if (post.processing?.status === "processing") return "Procesando";
  if (post.processing?.status === "ready") return "Listo";
  if (post.processing?.status === "error") return "Error";

  if (post.liveData?.status === "scheduled") return "Programado";
  if (post.liveData?.status === "upcoming") return "Próximo";
  if (post.liveData?.status === "live") return "En vivo";
  if (post.liveData?.status === "ended") return "Finalizado";

  if (post.videoData?.status === "processing") return "Procesando";
  if (post.videoData?.status === "ready") return "Disponible";
  if (post.videoData?.status === "error") return "Error";

  if (post.scheduledData?.status === "scheduled") return "Programado";
  if (post.scheduledData?.status === "completed") return "Completado";
  if (post.scheduledData?.status === "cancelled") return "Cancelado";

  return null;
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

function buildCommentBlockedMessage(reason: InteractionBlockedReason): string {
  if (reason === "login") {
    return "Inicia sesión para comentar en esta comunidad.";
  }

  if (reason === "join") {
    return "Debes unirte a esta comunidad para comentar.";
  }

  if (reason === "restricted") {
    return "No puedes comentar en esta comunidad por la configuración actual o por tu estado dentro de la comunidad.";
  }

  return "No puedes comentar en esta comunidad en este momento.";
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
  if (action === "remove") return "Expulsar de la comunidad";
  return "Eliminar publicación";
}

export default function GroupPostCard({
  post,
  canDelete = false,
  onDelete,
  onLoadComments,
  onCreateComment,
onDeleteComment,
onLoadReplies,
onCreateReply,
onDeleteReply,
onToggleFlame,
  currentUserId = null,
  isOwner = false,
  isModerator = false,
  showGroupContext = false,
  canModerateGroupAuthor = false,
  onModerationComplete,
  canCommentOnPosts = true,
  commentBlockedReason = null,
}: GroupPostCardProps) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
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
  const [flameBusy, setFlameBusy] = useState(false);
  const [flamesPanelOpen, setFlamesPanelOpen] = useState(false);
  const [flameUsers, setFlameUsers] = useState<PostFlameUser[]>([]);
  const [loadingFlameUsers, setLoadingFlameUsers] = useState(false);
  const [flameUsersError, setFlameUsersError] = useState<string | null>(null);
  const [failedMediaUrls, setFailedMediaUrls] = useState<Record<string, boolean>>({});
  const [loadedMediaUrls, setLoadedMediaUrls] = useState<Record<string, boolean>>({});
  const [mediaAspectRatios, setMediaAspectRatios] = useState<Record<string, number>>({});
  const [showExactPostDate, setShowExactPostDate] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{
  url: string;
  altText?: string | null;
} | null>(null);

  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const flameUsersCacheRef = useRef<Record<string, PostFlameUser[]>>({});

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

 async function handleOpenFlamesPanel() {
  const cachedUsers = flameUsersCacheRef.current[post.id];

  setFlamesPanelOpen(true);
  setFlameUsersError(null);

  if (cachedUsers) {
    setFlameUsers(cachedUsers);
    setLoadingFlameUsers(false);
    return;
  }

  try {
    setLoadingFlameUsers(true);

    const users = await fetchPostFlameUsers(post.id);

    flameUsersCacheRef.current[post.id] = users;
    setFlameUsers(users);
  } catch (e: any) {
    setFlameUsersError(e?.message ?? "No se pudieron cargar las flamitas.");
  } finally {
    setLoadingFlameUsers(false);
  }
}

  async function handleToggleFlame() {
    if (!currentUserId) {
      setInlineActionError("Inicia sesión para dar flamita.");
      return;
    }

    if (!onToggleFlame || flameBusy) return;

    try {
      setFlameBusy(true);
      setInlineActionError(null);
      await onToggleFlame(post.id);
      delete flameUsersCacheRef.current[post.id];
    } catch (e: any) {
      setInlineActionError(e?.message ?? "No se pudo actualizar la flamita.");
    } finally {
      setFlameBusy(false);
    }
  }

 async function handleOpenCommentsPanel() {
  setCommentsPanelOpen(true);

  if (comments !== null) {
    return;
  }

  try {
    setLoadingComments(true);
    setInlineActionError(null);

    const nextComments = await onLoadComments(post.id);
    setComments(nextComments);
  } catch (e: any) {
    setInlineActionError(e?.message ?? "No se pudieron cargar los comentarios.");
  } finally {
    setLoadingComments(false);
  }
}

  async function handleCreateComment() {
    if (!canCommentOnPosts) {
      setInlineActionError(buildCommentBlockedMessage(commentBlockedReason));
      return;
    }

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
  borderRadius: isMobile ? 0 : 12,
  border: isMobile ? "0" : "1px solid rgba(255,255,255,0.08)",
  borderBottom: isMobile
    ? "1px solid rgba(255,255,255,0.10)"
    : "1px solid rgba(255,255,255,0.08)",
  background: isMobile ? "transparent" : "rgba(255,255,255,0.022)",
  color: "#fff",
  padding: isMobile ? "14px 12px" : 12,
  boxSizing: "border-box",
  backdropFilter: isMobile ? "none" : "blur(10px)",
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

  const disabledTextareaStyle: CSSProperties = {
    ...inputStyle,
    color: "rgba(255,255,255,0.46)",
    cursor: "not-allowed",
  };

  const blockedHintStyle: CSSProperties = {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.58)",
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
const flameButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
    border: "none",
    background: "transparent",
    padding: 0,
    display: "inline-grid",
    placeItems: "center",
    cursor: flameBusy ? "not-allowed" : "pointer",
    opacity: flameBusy ? 0.65 : 1,
    WebkitTapHighlightColor: "transparent",
  };

  const flameIconStyle: CSSProperties = {
    display: "inline-block",
    fontSize: 16,
    lineHeight: 1,
    filter: post.viewerHasFlamed ? "none" : "grayscale(1)",
    opacity: post.viewerHasFlamed ? 1 : 0.52,
  };

    const flameCountButtonStyle: CSSProperties = {
    border: "none",
    background: "transparent",
    padding: 0,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    lineHeight: 1,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };

  const mediaStatusStyle: CSSProperties = {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  };

  const mediaBadgeStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 22,
    padding: "3px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.045)",
    color: "rgba(255,255,255,0.82)",
    fontSize: 10.5,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: "-0.01em",
  };

const imageGridStyle: CSSProperties = {
  marginTop: 12,
  display: "grid",
  gap: 8,
  width: isMobile ? "calc(100% + 24px)" : "100%",
  maxWidth: isMobile ? "calc(100% + 24px)" : "100%",
  marginLeft: isMobile ? -12 : 0,
  marginRight: isMobile ? -12 : 0,
};

function getImageWrapStyle(mediaUrl: string): CSSProperties {
  const ratio = mediaAspectRatios[mediaUrl];

  const aspectRatio =
    typeof ratio === "number"
      ? ratio >= 1.2
        ? isMobile
          ? "16 / 10"
          : "16 / 9"
: ratio <= 0.82
  ? isMobile
    ? "4 / 5"
    : "16 / 9"
          : "1 / 1"
      : isMobile
        ? "1 / 1"
        : "16 / 10";

  return {
    position: "relative",
    width: "100%",
    maxWidth: "100%",
    aspectRatio,
    borderRadius: isMobile ? 0 : 12,
    overflow: "hidden",
    border: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)",
    background: "#000",
  };
}

const postImageStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
  transition: "opacity 180ms ease",
};
  const shouldShowActionsMenu = availableActions.length > 0;
  const commentBlockedMessage = !canCommentOnPosts
    ? buildCommentBlockedMessage(commentBlockedReason)
    : null;

  const postTypeLabel = getPostTypeLabel(post);
  const postStatusLabel = getPostStatusLabel(post);
  const shouldShowMediaStatus = !!postTypeLabel || !!postStatusLabel;
    const imageMedia = Array.isArray(post.media)
    ? post.media.filter(
        (item) =>
          item.type === "image" &&
          typeof item.url === "string" &&
          item.url.trim().length > 0 &&
          !failedMediaUrls[item.url]
      )
    : [];

    const visibleCommentsTotal = useMemo(() => {
  if (comments !== null) {
    return comments.reduce((total, comment) => {
      return total + 1 + (comment.counts?.replies ?? 0);
    }, 0);
  }

  return post.counts?.comments ?? 0;
}, [comments, post.counts?.comments]);

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

            <button
  type="button"
  onClick={() => setShowExactPostDate((prev) => !prev)}
  title={formatExactDate(post.createdAt)}
  aria-label={
    showExactPostDate
      ? "Mostrar fecha relativa de la publicación"
      : "Mostrar fecha exacta de la publicación"
  }
style={{
  ...metaStyle,
  marginTop: 1,
  display: "block",
  width: "fit-content",
  padding: 0,
  border: "none",
  background: "transparent",
  fontFamily: fontStack,
  cursor: "pointer",
  textAlign: "left",
  lineHeight: 1.15,
  WebkitTapHighlightColor: "transparent",
}}
>
  {showExactPostDate
    ? formatExactDate(post.createdAt)
    : formatRelativeDate(post.createdAt)}
</button>

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

{(authorStatusBadge || post.text) && (
  <div style={bodyStyle}>
    {authorStatusBadge && (
      <span
        style={{
          ...statusBadgeStyle,
          minHeight: 18,
          padding: "2px 7px",
          fontSize: 10,
          fontWeight: 650,
          border: authorStatusBadge.border,
          background: authorStatusBadge.background,
          color: authorStatusBadge.color,
          marginRight: post.text ? 8 : 0,
          verticalAlign: "middle",
        }}
      >
        {authorStatusBadge.text}
      </span>
    )}

    {post.text}
  </div>
)}

{imageMedia.length > 0 && (
  <div style={imageGridStyle}>
    {imageMedia.map((media) => {
      const isLoaded = loadedMediaUrls[media.url] === true;

      return (
        <button
  key={media.url}
  type="button"
onClick={() => {
  setSelectedImage({
    url: media.url,
    altText: media.altText || null,
  });

  void handleOpenCommentsPanel();
}}
  aria-label="Abrir imagen de la publicación"
style={{
  ...getImageWrapStyle(media.url),
  padding: 0,
  cursor: "pointer",
  display: "block",
}}
>
          {!isLoaded && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(90deg, rgba(255,255,255,0.045), rgba(255,255,255,0.075), rgba(255,255,255,0.045))",
              }}
            />
          )}

          {!isMobile && mediaAspectRatios[media.url] <= 0.82 && (
  <img
    src={media.url}
    alt=""
    aria-hidden="true"
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      filter: "blur(22px)",
      transform: "scale(1.08)",
      opacity: 0.34,
    }}
  />
)}

          <img
            src={media.url}
            alt={media.altText || "Imagen de la publicación"}
            loading="lazy"
style={{
  ...postImageStyle,
  objectFit: !isMobile && mediaAspectRatios[media.url] <= 0.82 ? "contain" : "cover",
  opacity: isLoaded ? 1 : 0,
}}
onLoad={(event) => {
  const img = event.currentTarget;
  const ratio =
    img.naturalWidth > 0 && img.naturalHeight > 0
      ? img.naturalWidth / img.naturalHeight
      : 1;

  setMediaAspectRatios((prev) => ({
    ...prev,
    [media.url]: ratio,
  }));

  setLoadedMediaUrls((prev) => ({
    ...prev,
    [media.url]: true,
  }));
}}
            onError={() => {
              setFailedMediaUrls((prev) => ({
                ...prev,
                [media.url]: true,
              }));
            }}
          />
        </button>
      );
    })}
  </div>
)}

<div
  style={{
    marginTop: 12,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 14,
    width: "fit-content",
  }}
>
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 2,
    }}
  >
    <button
      type="button"
      onClick={handleToggleFlame}
      disabled={flameBusy}
      aria-pressed={post.viewerHasFlamed === true}
      aria-label={
        post.viewerHasFlamed
          ? "Quitar flamita de la publicación"
          : "Dar flamita a la publicación"
      }
      style={flameButtonStyle}
    >
      <span aria-hidden="true" style={flameIconStyle}>
        🔥
      </span>
    </button>

    <button
      type="button"
      onClick={handleOpenFlamesPanel}
      style={flameCountButtonStyle}
      aria-label="Ver usuarios que dieron flamita"
    >
      {post.counts?.likes ?? 0}
    </button>
  </div>

  <button
    type="button"
    onClick={handleOpenCommentsPanel}
    disabled={loadingComments}
    aria-label="Abrir comentarios"
    style={{
      border: "none",
      background: "transparent",
      padding: 0,
      color: "rgba(255,255,255,0.72)",
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 12.5,
      fontWeight: 600,
      fontFamily: fontStack,
      lineHeight: 1,
      cursor: loadingComments ? "not-allowed" : "pointer",
      opacity: loadingComments ? 0.62 : 1,
      WebkitTapHighlightColor: "transparent",
    }}
  >
    <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
      💬
    </span>
    <span>{visibleCommentsTotal}</span>
  </button>
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
        {commentsPanelOpen && selectedImage === null && (
        <PostCommentsPanel
          open={commentsPanelOpen}
          isMobile={isMobile}
          postId={post.id}
          comments={comments}
          loading={loadingComments}
          currentUserId={currentUserId}
          isOwner={isOwner}
          isModerator={isModerator}
          canCommentOnPosts={canCommentOnPosts}
          commentBlockedMessage={commentBlockedMessage}
          commentText={commentText}
          creatingComment={creatingComment}
          deletingCommentId={deletingCommentId}
          inlineError={inlineActionError}
          onCommentTextChange={setCommentText}
          onClose={() => setCommentsPanelOpen(false)}
          onCreateComment={handleCreateComment}
          onDeleteComment={handleDeleteComment}
          onLoadReplies={onLoadReplies}
          onCreateReply={onCreateReply}
          onDeleteReply={onDeleteReply}
        />
      )}

      <PostFlamesPanel
        open={flamesPanelOpen}
        loading={loadingFlameUsers}
        error={flameUsersError}
        users={flameUsers}
        onClose={() => setFlamesPanelOpen(false)}
      />
<PostImageViewer
  open={selectedImage !== null}
  isMobile={isMobile}
  image={selectedImage}
  post={post}
  author={{
    authorName: postAuthor.authorName,
    avatarUrl: postAuthor.avatarUrl,
    profileHref: postAuthor.profileHref,
  }}
  group={
    groupInfo.groupName || groupInfo.groupId
      ? {
          name: groupInfo.groupName || "Comunidad",
          avatarUrl: groupInfo.groupAvatarUrl,
          href: groupInfo.href,
        }
      : null
  }
  authorStatusBadge={authorStatusBadge}
  relativeDate={formatRelativeDate(post.createdAt)}
  exactDate={formatExactDate(post.createdAt)}
  likesCount={post.counts?.likes ?? 0}
  commentsCount={visibleCommentsTotal}
  viewerHasFlamed={post.viewerHasFlamed === true}
  flameBusy={flameBusy}
  commentsContent={
    <PostCommentsPanel
      open={selectedImage !== null}
      isMobile={false}
      postId={post.id}
      comments={comments}
      loading={loadingComments}
      currentUserId={currentUserId}
      isOwner={isOwner}
      isModerator={isModerator}
      canCommentOnPosts={canCommentOnPosts}
      commentBlockedMessage={commentBlockedMessage}
      commentText={commentText}
      creatingComment={creatingComment}
      deletingCommentId={deletingCommentId}
      inlineError={inlineActionError}
      onCommentTextChange={setCommentText}
      onClose={() => setCommentsPanelOpen(false)}
      onCreateComment={handleCreateComment}
      onDeleteComment={handleDeleteComment}
      onLoadReplies={onLoadReplies}
      onCreateReply={onCreateReply}
      onDeleteReply={onDeleteReply}
    />
  }
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
    </article>
  );
}