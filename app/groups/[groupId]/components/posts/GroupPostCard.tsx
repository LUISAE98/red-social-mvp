//GroupPostCard.tsx

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
import PostShareButton from "@/components/ui/PostShareButton";
import PostSaveButton from "@/components/ui/PostSaveButton";
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
  onToggleSave?: (postId: string) => Promise<void>;
  onToggleGroupPin?: (postId: string) => Promise<void>;
  onToggleProfilePin?: (postId: string) => Promise<void>;
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
  | "pin_group_post"
  | "unpin_group_post"
  | "pin_profile_post"
  | "unpin_profile_post"
  | "delete_post";

type MenuPosition = {
  top: number;
  left: number;
};

type DisplayMediaItem = {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
  duration?: number | null;
  playbackUrl?: string | null;
  hlsUrl?: string | null;
  playbackId?: string | null;
  status?: string | null;
  isPlaceholder?: boolean;
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

function formatMediaDuration(seconds?: number | null): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
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

function truncatePostText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;

  const sliced = text.slice(0, maxLength).trim();
  const lastSpace = sliced.lastIndexOf(" ");

  return `${sliced.slice(0, lastSpace > 40 ? lastSpace : sliced.length).trim()}...`;
}

function buildActionLabel(action: ModerationAction) {
  if (action === "mute") return "Mutear";
  if (action === "unmute") return "Quitar mute";
  if (action === "ban") return "Banear";
  if (action === "unban") return "Quitar ban";
  if (action === "remove") return "Expulsar de la comunidad";
  if (action === "pin_group_post") return "Fijar en grupo";
  if (action === "unpin_group_post") return "Desfijar del grupo";
  if (action === "pin_profile_post") return "Fijar en mi perfil";
  if (action === "unpin_profile_post") return "Desfijar de mi perfil";
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
onToggleSave,
onToggleGroupPin,
onToggleProfilePin,
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
  const [saveBusy, setSaveBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [flamesPanelOpen, setFlamesPanelOpen] = useState(false);
  const [flameUsers, setFlameUsers] = useState<PostFlameUser[]>([]);
  const [loadingFlameUsers, setLoadingFlameUsers] = useState(false);
  const [flameUsersError, setFlameUsersError] = useState<string | null>(null);
  const [failedMediaUrls, setFailedMediaUrls] = useState<Record<string, boolean>>({});
  const [loadedMediaUrls, setLoadedMediaUrls] = useState<Record<string, boolean>>({});
  const [mediaAspectRatios, setMediaAspectRatios] = useState<Record<string, number>>({});
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const [videoMetadataLoaded, setVideoMetadataLoaded] = useState(false);
  const [shouldLoadFeedVideo, setShouldLoadFeedVideo] = useState(false);
  const [showExactPostDate, setShowExactPostDate] = useState(false);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string | null>(null);
const [postTextExpanded, setPostTextExpanded] = useState(false);


  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const flameUsersCacheRef = useRef<Record<string, PostFlameUser[]>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const feedVideoShellRef = useRef<HTMLDivElement | null>(null);

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
  function handleGlobalVideoPlay(event: Event) {
    const currentVideo = videoRef.current;

    if (!currentVideo) return;
    if (event.target === currentVideo) return;

    currentVideo.pause();
  }

  document.addEventListener("play", handleGlobalVideoPlay, true);

  return () => {
    document.removeEventListener("play", handleGlobalVideoPlay, true);
  };
}, []);

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

    if (isOwner && onToggleGroupPin) {
      actions.push(
        post.isPinnedInGroup === true ? "unpin_group_post" : "pin_group_post"
      );
    }

    if (currentUserId && post.authorId === currentUserId && onToggleProfilePin) {
      actions.push(
        post.isPinnedOnProfile === true
          ? "unpin_profile_post"
          : "pin_profile_post"
      );
    }

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
  }, [
    isOwner,
    onToggleGroupPin,
    currentUserId,
    post.authorId,
    post.isPinnedInGroup,
    post.isPinnedOnProfile,
    onToggleProfilePin,
    canModerateAuthor,
    effectiveAuthorStatus,
    canDelete,
    onDelete,
  ]);


  function openMediaViewer(mediaUrl: string | null) {
    if (!mediaUrl) return;

    videoRef.current?.pause();
    setSelectedMediaUrl(mediaUrl);
    void handleOpenCommentsPanel();
  }

  function closeMediaViewer() {
    setSelectedMediaUrl(null);
    setCommentsPanelOpen(false);
  }
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

    async function handleToggleSave() {
    if (!currentUserId) {
      setInlineActionError("Inicia sesión para guardar publicaciones.");
      return;
    }

    if (!onToggleSave || saveBusy) return;

    try {
      setSaveBusy(true);
      setInlineActionError(null);
      await onToggleSave(post.id);
    } catch (e: any) {
      setInlineActionError(e?.message ?? "No se pudo actualizar el guardado.");
    } finally {
      setSaveBusy(false);
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
  async function handleTogglePin(
    scope: "group" | "profile"
  ): Promise<void> {
    if (pinBusy) return;

    const handler =
      scope === "group" ? onToggleGroupPin : onToggleProfilePin;

    if (!handler) return;

    try {
      setPinBusy(true);
      setInlineActionError(null);
      await handler(post.id);
      setMenuOpen(false);
    } catch (e: any) {
      setInlineActionError(
        e?.message ??
          (scope === "group"
            ? "No se pudo actualizar el fijado del grupo."
            : "No se pudo actualizar el fijado del perfil.")
      );
    } finally {
      setPinBusy(false);
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

    if (action === "pin_group_post" || action === "unpin_group_post") {
      await handleTogglePin("group");
      return;
    }

    if (action === "pin_profile_post" || action === "unpin_profile_post") {
      await handleTogglePin("profile");
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


    const interactionRowStyle: CSSProperties = {
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
  };

  const leftInteractionGroupStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 14,
    minWidth: 0,
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
const videoSkeletonAspectRatio =
  typeof videoAspectRatio === "number"
    ? videoAspectRatio >= 1
      ? "16 / 9"
      : isMobile
        ? "4 / 5"
        : "9 / 16"
    : isMobile
      ? "16 / 10"
      : "16 / 9";

const videoSkeletonStyle: CSSProperties = {
  width: "100%",
  aspectRatio: videoSkeletonAspectRatio,
  background:
    "linear-gradient(90deg, rgba(255,255,255,0.045), rgba(255,255,255,0.085), rgba(255,255,255,0.045))",
  backgroundSize: "220% 100%",
  animation: "vibraVideoSkeleton 1.25s ease-in-out infinite",
};
  const shouldShowActionsMenu = availableActions.length > 0;
  const isPinned =
    post.isPinnedInGroup === true || post.isPinnedOnProfile === true;
  const commentBlockedMessage = !canCommentOnPosts
    ? buildCommentBlockedMessage(commentBlockedReason)
    : null;

  const postTypeLabel = getPostTypeLabel(post);
  const postStatusLabel = getPostStatusLabel(post);
  const shouldShowMediaStatus = !!postTypeLabel || !!postStatusLabel;
  const mediaFromPost = Array.isArray(post.media) ? post.media : [];

  const rootVideoPlaybackUrl =
    typeof post.playback?.hlsUrl === "string" && post.playback.hlsUrl.trim()
      ? post.playback.hlsUrl.trim()
      : typeof post.playback?.url === "string" && post.playback.url.trim()
        ? post.playback.url.trim()
        : null;

  const rootVideoThumbnailUrl =
    typeof post.playback?.thumbnailUrl === "string" &&
    post.playback.thumbnailUrl.trim()
      ? post.playback.thumbnailUrl.trim()
      : typeof post.videoData?.thumbnailUrl === "string" &&
          post.videoData.thumbnailUrl.trim()
        ? post.videoData.thumbnailUrl.trim()
        : null;

  const mediaVideoItems = mediaFromPost.filter((item) => item.type === "video");

const displayMedia = mediaFromPost
  .map<DisplayMediaItem | null>((item, index) => {
      if (item.type === "image") {
        if (
          typeof item.url !== "string" ||
          item.url.trim().length === 0 ||
          failedMediaUrls[item.url]
        ) {
          return null;
        }

        return {
          type: "image" as const,
          url: item.url.trim(),
          thumbnailUrl: item.thumbnailUrl ?? null,
          altText: item.altText ?? null,
          duration: null,
          playbackUrl: null,
          hlsUrl: null,
          playbackId: null,
          status: null,
        };
      }

      if (item.type === "video") {
        const playbackUrl =
          typeof item.hlsUrl === "string" && item.hlsUrl.trim()
            ? item.hlsUrl.trim()
            : typeof item.url === "string" &&
                item.url.trim() &&
                !item.url.startsWith("mux://uploads/")
              ? item.url.trim()
              : null;

        const thumbnailUrl =
          typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim()
            ? item.thumbnailUrl.trim()
            : null;

        const status =
          typeof item.status === "string" && item.status.trim().length > 0
            ? item.status.trim()
            : null;

        const shouldReserveVideoSlot =
          status === "uploading" ||
          status === "processing" ||
          status === "pending" ||
          status === "created" ||
          status === null;

        const isReadyVideo =
          status === "ready" ||
          Boolean(playbackUrl) ||
          Boolean(item.hlsUrl);

        const previewUrl = thumbnailUrl || playbackUrl || "";

        if (!isReadyVideo) {
          if (!shouldReserveVideoSlot && !thumbnailUrl) {
            return null;
          }

          return {
            type: "video" as const,
            url: previewUrl || `video-processing-placeholder-${post.id}-${index}`,
            thumbnailUrl,
            altText: item.altText ?? "Video preparándose",
            duration: item.duration ?? null,
            playbackUrl: null,
            hlsUrl: item.hlsUrl ?? null,
            playbackId: item.playbackId ?? null,
            status,
            isPlaceholder: true,
          };
        }

        if (!previewUrl || failedMediaUrls[previewUrl]) {
          return null;
        }

        return {
          type: "video" as const,
          url: previewUrl,
          thumbnailUrl,
          altText: item.altText ?? "Video de la publicación",
          duration: item.duration ?? null,
          playbackUrl,
          hlsUrl: item.hlsUrl ?? null,
          playbackId: item.playbackId ?? null,
          status,
          isPlaceholder: false,
        };
      }

      return null;
    })
.filter((item): item is DisplayMediaItem => item !== null);

  const hasMediaGrid = displayMedia.length > 0;

  const viewerMediaItems: DisplayMediaItem[] =
    displayMedia.length > 0
      ? displayMedia
      : rootVideoPlaybackUrl
        ? [
            {
              type: "video",
              url: rootVideoThumbnailUrl || rootVideoPlaybackUrl,
              thumbnailUrl: rootVideoThumbnailUrl,
              altText: "Video de la publicación",
              duration: post.videoData?.duration ?? null,
              playbackUrl: rootVideoPlaybackUrl,
              hlsUrl:
                typeof post.playback?.hlsUrl === "string" &&
                post.playback.hlsUrl.trim().length > 0
                  ? post.playback.hlsUrl.trim()
                  : null,
              playbackId:
                typeof post.playback?.playbackId === "string"
                  ? post.playback.playbackId
                  : typeof post.videoData?.playbackId === "string"
                    ? post.videoData.playbackId
                    : null,
              status: post.videoData?.status ?? post.processing?.status ?? null,
            },
          ]
        : [];

  const videoPlaybackUrl = rootVideoPlaybackUrl;

  const videoThumbnailUrl = rootVideoThumbnailUrl;

  const isVideoPost =
    post.postType === "video" || post.videoData != null || mediaVideoItems.length > 0;

  const hasReadyMediaVideos = mediaVideoItems.some(
    (item) => item.status === "ready" || Boolean(item.hlsUrl)
  );

  const hasProcessingMediaVideos = mediaVideoItems.some(
    (item) => item.status === "uploading" || item.status === "processing"
  );

  const hasErrorMediaVideos = mediaVideoItems.some((item) => item.status === "error");

  const isVideoReady =
    isVideoPost &&
    (
      hasReadyMediaVideos ||
      Boolean(rootVideoPlaybackUrl) ||
      post.processing?.status === "ready" ||
      post.videoData?.status === "ready" ||
      post.playback?.isReady === true
    );

  const isVideoProcessing =
    isVideoPost &&
    !isVideoReady &&
    !hasErrorMediaVideos &&
    (hasProcessingMediaVideos ||
      (post.processing?.status !== "error" && post.videoData?.status !== "error"));

  const isVideoError =
    isVideoPost &&
    !isVideoReady &&
    (hasErrorMediaVideos ||
      post.processing?.status === "error" ||
      post.videoData?.status === "error");
      useEffect(() => {
    setVideoMetadataLoaded(false);
    setShouldLoadFeedVideo(false);
  }, [videoPlaybackUrl]);

  useEffect(() => {
    if (!isVideoReady || !videoPlaybackUrl) return;

    const shell = feedVideoShellRef.current;

    if (!shell) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;

        if (entry.isIntersecting) {
          setShouldLoadFeedVideo(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "600px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(shell);

    return () => {
      observer.disconnect();
    };
  }, [isVideoReady, videoPlaybackUrl]);

      useEffect(() => {
    const video = videoRef.current;

    if (!video || isMobile || !videoPlaybackUrl) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;

        if (entry.intersectionRatio < 0.35) {
          video.pause();
        }
      },
      {
        threshold: [0, 0.35, 0.5, 0.75, 1],
      }
    );

    observer.observe(video);

    return () => {
      observer.disconnect();
    };
  }, [isMobile, videoPlaybackUrl]);

    const cleanPostText = typeof post.text === "string" ? post.text.trim() : "";
const feedPostTextLimit = hasMediaGrid ? 120 : 150;
const feedPostTextMaxLines = hasMediaGrid ? 3 : 5;

const cleanPostTextLines = cleanPostText.split(/\r?\n/);

const previewPostTextByLines = cleanPostTextLines
  .slice(0, feedPostTextMaxLines)
  .join("\n")
  .trim();

const previewPostText =
  previewPostTextByLines.length > feedPostTextLimit
    ? truncatePostText(previewPostTextByLines, feedPostTextLimit)
    : previewPostTextByLines;

const shouldClampFeedPostText =
  cleanPostTextLines.length > feedPostTextMaxLines ||
  cleanPostText.length > previewPostText.length;

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
            {isPinned && (
              <div
                style={{
                  marginTop: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 22,
                  padding: "3px 8px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.055)",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: 10.5,
                  fontWeight: 650,
                  lineHeight: 1,
                  letterSpacing: "-0.01em",
                  width: "fit-content",
                }}
              >
                <span aria-hidden="true">📌</span>
                <span>Fijado</span>
              </div>
            )}
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
              disabled={deleting || moderationBusy || pinBusy}
            >
              ⋮
            </button>
          </div>
        )}
      </div>

{(authorStatusBadge || cleanPostText.length > 0) && (
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
          marginRight: cleanPostText.length > 0 ? 8 : 0,
          verticalAlign: "middle",
        }}
      >
        {authorStatusBadge.text}
      </span>
    )}

    {cleanPostText.length > 0 && (
      <span>
{postTextExpanded || !shouldClampFeedPostText
  ? cleanPostText
  : previewPostText}

        {shouldClampFeedPostText && (
          <button
            type="button"
            onClick={() => setPostTextExpanded((prev) => !prev)}
            style={{
              marginLeft: 6,
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.72)",
              padding: 0,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: fontStack,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {postTextExpanded ? "- Ver menos" : "+ Ver más"}
          </button>
        )}
      </span>
    )}
  </div>
)}

{isVideoPost && !hasMediaGrid && (
  <div
    style={{
      marginTop: 10,
      width: isMobile ? "calc(100% + 24px)" : "100%",
      maxWidth: isMobile ? "calc(100% + 24px)" : "100%",
      marginLeft: isMobile ? -12 : 0,
      marginRight: isMobile ? -12 : 0,
      borderRadius: isMobile ? 0 : 14,
      border: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)",
      overflow: "hidden",
      background: "#050505",
    }}
  >
    {isVideoReady && videoPlaybackUrl ? (
      <div
        ref={feedVideoShellRef}
        style={{
          position: "relative",
          width: "100%",
          overflow: "hidden",
          background: "#050505",
        }}
      >
        {!isMobile && videoThumbnailUrl && videoAspectRatio !== null && videoAspectRatio < 1 && (
          <img
            src={videoThumbnailUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "blur(30px)",
              transform: "scale(1.12)",
              opacity: 0.24,
            }}
          />
        )}

{!shouldLoadFeedVideo && videoThumbnailUrl && (
  <img
    src={videoThumbnailUrl}
    alt="Vista previa del video"
    loading="lazy"
    draggable={false}
    style={{
      display: "block",
      width: "100%",
      height: "auto",
      maxHeight: isMobile ? "none" : 560,
      objectFit: "contain",
      background: "#050505",
    }}
  />
)}

{!shouldLoadFeedVideo && !videoThumbnailUrl && (
  <div aria-hidden="true" style={videoSkeletonStyle} />
)}

{shouldLoadFeedVideo && !videoMetadataLoaded && (
  <div aria-hidden="true" style={videoSkeletonStyle} />
)}

{shouldLoadFeedVideo && (
  <video
    ref={videoRef}
    src={videoPlaybackUrl}
    controls={!isMobile}
    playsInline
    preload="metadata"
    poster={videoThumbnailUrl ?? undefined}
    onClick={() => {
      if (isMobile) {
        openMediaViewer(videoThumbnailUrl || videoPlaybackUrl);
      }
    }}
    onPlay={(event) => {
      if (isMobile) {
        event.currentTarget.pause();
        openMediaViewer(videoThumbnailUrl || videoPlaybackUrl);
      }
    }}
    onLoadedMetadata={(event) => {
      const video = event.currentTarget;
      const ratio =
        video.videoWidth > 0 && video.videoHeight > 0
          ? video.videoWidth / video.videoHeight
          : null;

      setVideoAspectRatio(ratio);
      setVideoMetadataLoaded(true);
    }}
    style={{
      position: "relative",
      zIndex: 1,
      display: videoMetadataLoaded ? "block" : "none",
      width: "100%",
      height: "auto",
      maxHeight: isMobile ? "none" : 560,
      background: "transparent",
      objectFit: "contain",
      cursor: isMobile ? "pointer" : "default",
    }}
  />
)}

{isMobile && (
  <button
    type="button"
    onClick={() => openMediaViewer(videoThumbnailUrl || videoPlaybackUrl)}
    aria-label="Reproducir video"
    style={{
      position: "absolute",
      inset: 0,
      zIndex: 2,
      display: "grid",
      placeItems: "center",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      WebkitTapHighlightColor: "transparent",
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: 62,
        height: 62,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,0.48)",
        border: "1px solid rgba(255,255,255,0.22)",
        color: "#fff",
        fontSize: 28,
        paddingLeft: 4,
      }}
    >
      ▶
    </span>
  </button>
)}
      </div>
    ) : (
      <div
        style={{
          minHeight: isMobile ? 220 : 280,
          display: "grid",
          placeItems: "center",
          padding: 20,
          background:
            "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(2,6,23,0.98))",
          color: "rgba(255,255,255,0.82)",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 340 }}>
          <div
            style={{
              width: 52,
              height: 52,
              margin: "0 auto 12px",
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              background: isVideoError
                ? "rgba(239,68,68,0.16)"
                : "rgba(96,165,250,0.16)",
              color: isVideoError
                ? "rgba(252,165,165,0.95)"
                : "rgba(147,197,253,0.95)",
              fontSize: 24,
            }}
          >
            {isVideoError ? "!" : "🎥"}
          </div>

          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
            {isVideoError ? "No se pudo procesar el video" : "Video procesándose"}
          </div>

          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.62)",
            }}
          >
            {isVideoError
              ? post.processing?.errorMessage ||
                "Mux no pudo preparar este video. Puedes intentar subirlo nuevamente."
              : "Mux está preparando la reproducción. El video aparecerá automáticamente cuando esté listo."}
          </div>

          {isVideoError && (
            <button
              type="button"
              onClick={() => {
                window.scrollTo({
                  top: 0,
                  behavior: "smooth",
                });
              }}
              style={{
                marginTop: 14,
                minHeight: 36,
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: fontStack,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Subir otro video
            </button>
          )}
        </div>
      </div>
    )}
  </div>
)}

{hasMediaGrid && (
  <div style={imageGridStyle}>
    {(() => {
      const totalMedia = displayMedia.length;
      const first = displayMedia[0];
      const second = displayMedia[1] ?? null;
      const third = displayMedia[2] ?? null;
      const remainingCount = Math.max(0, totalMedia - 3);

      function openMedia(media: DisplayMediaItem) {
        if (media.isPlaceholder) return;
        openMediaViewer(media.url);
      }

      function renderVideoOverlay(media: DisplayMediaItem) {
        if (media.type !== "video") return null;

        const durationLabel = formatMediaDuration(media.duration);

        return (
          <>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(0,0,0,0.48)",
                  border: "1px solid rgba(255,255,255,0.22)",
                  color: "#fff",
                  fontSize: 23,
                  paddingLeft: 3,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
                }}
              >
                ▶
              </span>
            </div>

            {durationLabel && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: 8,
                  bottom: 8,
                  minHeight: 20,
                  padding: "3px 7px",
                  borderRadius: 6,
                  background: "rgba(0,0,0,0.72)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: "-0.01em",
                }}
              >
                {durationLabel}
              </span>
            )}
          </>
        );
      }

      function renderVideoProcessingPlaceholder(media?: DisplayMediaItem) {
        const coverUrl =
          typeof media?.thumbnailUrl === "string" && media.thumbnailUrl.trim().length > 0
            ? media.thumbnailUrl.trim()
            : typeof media?.url === "string" &&
                media.url.trim().length > 0 &&
                !media.url.startsWith("video-processing-placeholder-")
              ? media.url.trim()
              : null;

        return (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 14,
              boxSizing: "border-box",
              background:
                "linear-gradient(135deg, rgba(16,16,18,0.96), rgba(34,20,52,0.94))",
              overflow: "hidden",
            }}
          >
            {coverUrl && (
              <img
                src={coverUrl}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  opacity: 0.78,
                  filter: "saturate(0.92)",
                }}
              />
            )}

            {!coverUrl && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(135deg, rgba(126,58,242,0.20), rgba(191,128,255,0.16), rgba(126,58,242,0.22))",
                }}
              />
            )}

            <div
              style={{
                position: "absolute",
                inset: 0,
                background: coverUrl
                  ? "linear-gradient(180deg, rgba(0,0,0,0.22), rgba(0,0,0,0.54))"
                  : "linear-gradient(90deg, transparent, rgba(221,190,255,0.20), transparent)",
                backgroundSize: coverUrl ? undefined : "220% 100%",
                animation: coverUrl ? undefined : "vibraVideoSkeleton 1.25s ease-in-out infinite",
              }}
            />

            <div
              style={{
                position: "relative",
                zIndex: 1,
                display: "grid",
                placeItems: "center",
                gap: 9,
                textAlign: "center",
                color: "rgba(255,255,255,0.96)",
                textShadow: "0 2px 12px rgba(0,0,0,0.55)",
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: "3px solid rgba(255,255,255,0.28)",
                  borderTopColor: "#fff",
                  animation: "vibraVideoSpinner 0.85s linear infinite",
                  boxSizing: "border-box",
                }}
              />

              <div
                style={{
                  minHeight: 24,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "rgba(0,0,0,0.42)",
                  border: "1px solid rgba(255,255,255,0.16)",
                  fontSize: 11.5,
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: "-0.01em",
                }}
              >
                Preparando video
              </div>
            </div>
          </div>
        );
      }

      function renderMediaContent(
        media: DisplayMediaItem,
        index: number,
        loading: "eager" | "lazy" = "lazy"
      ) {
        if (media.isPlaceholder) {
          return renderVideoProcessingPlaceholder(media);
        }

        return (
          <>
            <img
              src={media.url}
              alt={
                media.altText ||
                (media.type === "video"
                  ? `Video ${index + 1} de la publicación`
                  : `Imagen ${index + 1} de la publicación`)
              }
              loading={loading}
              draggable={false}
              style={tileImageStyle}
              onError={() => {
                setFailedMediaUrls((prev) => ({
                  ...prev,
                  [media.url]: true,
                }));
              }}
            />

            {renderVideoOverlay(media)}

            {remainingCount > 0 && index === 2 && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.48)",
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  fontSize: 24,
                  fontWeight: 800,
                  lineHeight: 1,
                  textShadow: "0 2px 10px rgba(0,0,0,0.65)",
                }}
              >
                +{remainingCount}
              </div>
            )}
          </>
        );
      }

      const tileBaseStyle: CSSProperties = {
        position: "relative",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        border: "none",
        padding: 0,
        background: "#000",
        cursor: "pointer",
        display: "block",
        WebkitTapHighlightColor: "transparent",
      };

      const tileImageStyle: CSSProperties = {
        width: "100%",
        height: "100%",
        display: "block",
        objectFit: "cover",
      };

      if (totalMedia === 1) {
        const isLoaded = first.isPlaceholder ? true : loadedMediaUrls[first.url] === true;

        return (
          <button
            type="button"
            onClick={() => openMedia(first)}
            aria-label={
              first.type === "video"
                ? "Reproducir video de la publicación"
                : "Abrir imagen de la publicación"
            }
            style={{
              ...getImageWrapStyle(first.url),
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

            {first.type === "image" && !isMobile && mediaAspectRatios[first.url] <= 0.82 && (
              <img
                src={first.url}
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

            {first.isPlaceholder ? (
              renderVideoProcessingPlaceholder(first)
            ) : (
              <img
                src={first.url}
                alt={
                  first.altText ||
                  (first.type === "video"
                    ? "Video de la publicación"
                    : "Imagen de la publicación")
                }
                loading="lazy"
                draggable={false}
                style={{
                  ...postImageStyle,
                  objectFit:
                    first.type === "image" && !isMobile && mediaAspectRatios[first.url] <= 0.82
                      ? "contain"
                      : "cover",
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
                    [first.url]: ratio,
                  }));

                  setLoadedMediaUrls((prev) => ({
                    ...prev,
                    [first.url]: true,
                  }));
                }}
                onError={() => {
                  setFailedMediaUrls((prev) => ({
                    ...prev,
                    [first.url]: true,
                  }));
                }}
              />
            )}

            {!first.isPlaceholder && renderVideoOverlay(first)}
          </button>
        );
      }

      if (totalMedia === 2 && second) {
        return (
          <div
            style={{
              width: "100%",
              aspectRatio: isMobile ? "1 / 1" : "16 / 10",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 2,
              borderRadius: isMobile ? 0 : 12,
              overflow: "hidden",
              background: "#000",
            }}
          >
            {[first, second].map((media, index) => (
              <button
                key={`${media.type}-${media.url}-${index}`}
                type="button"
                onClick={() => openMedia(media)}
                aria-label={
                  media.type === "video"
                    ? `Reproducir video ${index + 1} de ${totalMedia}`
                    : `Abrir imagen ${index + 1} de ${totalMedia}`
                }
                style={tileBaseStyle}
              >
                {renderMediaContent(media, index, "eager")}
              </button>
            ))}
          </div>
        );
      }

      return (
        <div
          style={{
            width: "100%",
            aspectRatio: isMobile ? "1 / 1" : "16 / 10",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 2,
            borderRadius: isMobile ? 0 : 12,
            overflow: "hidden",
            background: "#000",
          }}
        >
          <button
            type="button"
            onClick={() => openMedia(first)}
            aria-label={
              first.type === "video"
                ? `Reproducir video 1 de ${totalMedia}`
                : `Abrir imagen 1 de ${totalMedia}`
            }
            style={{
              ...tileBaseStyle,
              gridRow: "1 / span 2",
            }}
          >
            {renderMediaContent(first, 0, "eager")}
          </button>

          {second && (
            <button
              type="button"
              onClick={() => openMedia(second)}
              aria-label={
                second.type === "video"
                  ? `Reproducir video 2 de ${totalMedia}`
                  : `Abrir imagen 2 de ${totalMedia}`
              }
              style={tileBaseStyle}
            >
              {renderMediaContent(second, 1, "eager")}
            </button>
          )}

          {third && (
            <button
              type="button"
              onClick={() => openMedia(third)}
              aria-label={
                third.type === "video"
                  ? `Reproducir video 3 de ${totalMedia}`
                  : `Abrir imagen 3 de ${totalMedia}`
              }
              style={tileBaseStyle}
            >
              {renderMediaContent(third, 2, "lazy")}
            </button>
          )}
        </div>
      );
    })()}
  </div>
)}
<div style={interactionRowStyle}>
  <div style={leftInteractionGroupStyle}>
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

  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 8,
      flexShrink: 0,
    }}
  >
    <PostSaveButton
      count={post.counts?.saves ?? 0}
      saved={post.viewerHasSaved === true}
      loading={saveBusy}
      disabled={saveBusy}
      onClick={handleToggleSave}
    />

    {post.isShareable === true && (
      <PostShareButton
        postId={post.id}
        title={post.shareTitle || "Publicación"}
        text={post.shareDescription || post.text || "Mira esta publicación."}
      />
    )}
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

              const isBusy = moderationBusy || deleting || pinBusy;

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
        {commentsPanelOpen && selectedMediaUrl === null && (
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
  open={selectedMediaUrl !== null}
  isMobile={isMobile}
  mediaItems={viewerMediaItems}
  initialMediaUrl={selectedMediaUrl}
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
      open={selectedMediaUrl !== null}
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
  onClose={closeMediaViewer}
  onToggleFlame={handleToggleFlame}
  onOpenFlames={handleOpenFlamesPanel}
  onOpenComments={() => {
    void handleOpenCommentsPanel();
  }}
/>
  <style>
  {`
    @keyframes vibraVideoSkeleton {
      0% {
        background-position: 120% 0;
      }
      100% {
        background-position: -120% 0;
      }
    }

    @keyframes vibraVideoSpinner {
      0% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(360deg);
      }
    }
  `}
</style>
    </article>
  );
}