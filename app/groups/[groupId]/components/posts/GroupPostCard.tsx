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
import type { Comment, CommentReply, Post, PostLiveData } from "@/lib/posts/types";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import LiveInlinePlayer from "@/app/components/LiveInlinePlayer/LiveInlinePlayer";
import LiveViewerModal from "@/app/components/LiveViewerModal/LiveViewerModal";
import LiveCreatorPanel from "@/app/components/LiveChat/LiveCreatorPanel";
import PostFlamesPanel, { type PostFlameUser } from "./PostFlamesPanel";
import LiveComposerModal from "@/app/components/LiveComposer/LiveComposerModal";
import LiveStreamSetup from "@/app/components/LiveStreamSetup/LiveStreamSetup";
import PostCommentsPanel from "./PostCommentsPanel";
import GroupPostComposer, { type GroupPostComposerSubmitPayload } from "./GroupPostComposer";
import PostImageViewer from "./PostImageViewer";
import PostPaymentPanel from "./PostPaymentPanel";
import { usePostTempUnlock } from "@/lib/posts/usePostTempUnlock";
import { fetchPostFlameUsers, updatePost } from "@/lib/posts/post-service";
import { uploadPostImage } from "@/lib/posts/image-upload";
import PostShareButton from "@/components/ui/PostShareButton";
import PostSaveButton from "@/components/ui/PostSaveButton";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import VibraCommentIcon from "@/app/components/VibraServiceIcons/VibraCommentIcon";
import {
  banGroupMember,
  muteGroupMember,
  removeGroupMember,
  unbanGroupMember,
  unmuteGroupMember,
} from "@/lib/groups/groupModeration";
import { useSocialRelationship } from "@/lib/social/useSocialRelationship";
import { useGroupMemberBlocks } from "@/lib/groups/useGroupMemberBlocks";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import StoryRingAvatar from "@/app/components/Stories/StoryRingAvatar";
import {
  resolvePostPremiumState,
  type PostPremiumStateResult,
} from "@/lib/posts/post-premium-state";
import type { PostAccess } from "@/lib/posts/post-access-types";

type InteractionBlockedReason = "login" | "join" | "restricted" | null;

type GroupPostCardProps = {
  post: Post & {
    authorMemberStatus?: "active" | "muted" | "banned" | "removed" | null;
    authorMutedUntil?: any;
    forcedGroupId?: string | null;
  };
  groupId?: string | null;
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
  viewerIsMember?: boolean;
  showGroupContext?: boolean;
  canModerateGroupAuthor?: boolean;
  canUseGroupMemberBlock?: boolean;
  onModerationComplete?: () => Promise<void> | void;
  onGroupMemberBlockComplete?: () => Promise<void> | void;
  canCommentOnPosts?: boolean;
  commentBlockedReason?: InteractionBlockedReason;
};

type ModerationAction =
  | "edit_post"
  | "mute"
  | "unmute"
  | "ban"
  | "unban"
  | "remove"
  | "pin_group_post"
  | "unpin_group_post"
  | "pin_profile_post"
  | "unpin_profile_post"
  | "block_user"
  | "unblock_user"
  | "block_in_group"
  | "unblock_in_group"
  | "delete_post";

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
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

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

function formatScheduledLiveDate(
  value?: { toDate?: () => Date } | null,
): string {
  const date = getDateFromTimestamp(value);
  if (!date) return "Fecha por confirmar";

  try {
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    const timePart = new Intl.DateTimeFormat("es-MX", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);

    if (isToday) return `Hoy a las ${timePart}`;

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow =
      date.getFullYear() === tomorrow.getFullYear() &&
      date.getMonth() === tomorrow.getMonth() &&
      date.getDate() === tomorrow.getDate();

    if (isTomorrow) return `Mañana a las ${timePart}`;

    const datePart = new Intl.DateTimeFormat("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(date);

    return `${datePart.charAt(0).toUpperCase()}${datePart.slice(1)} a las ${timePart}`;
  } catch {
    return "Fecha por confirmar";
  }
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

function PremiumPostPanel({
  state,
  onOpenPayment,
  overlay = false,
}: {
  state: PostPremiumStateResult;
  onOpenPayment?: () => void;
  overlay?: boolean;
}) {
  const isUnlocked = !state.isBlocked;

  let statusText: string | null = null;
  if (state.state === "unlocked_author") statusText = "Esta publicación te pertenece";
  else if (state.hasAccessByMembership) statusText = "Acceso incluido por tu membresía";
  else if (state.hasAccessBySubscription) statusText = "Acceso incluido por tu suscripción";
  else if (state.hasAccessByPurchase) statusText = "Ya tienes acceso a este contenido";

  return (
    <div
      style={{
        ...(overlay ? {} : { marginTop: 10 }),
        border: "1px solid rgba(168,85,255,0.32)",
        borderRadius: 12,
        background:
          "linear-gradient(160deg, rgba(79,70,255,0.26), rgba(168,85,255,0.22) 55%, rgba(139,92,246,0.18))",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: fontStack,
      }}
    >
      <span style={{ flexShrink: 0, marginLeft: 4 }}>
        <VibraNavigationIcon
          type={isUnlocked ? "premiumUnlocked" : "premiumLock"}
          size={28}
        />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#a855ff",
            lineHeight: 1.3,
            fontFamily: fontStack,
          }}
        >
          {isUnlocked ? "Contenido desbloqueado" : "Esta es una publicación premium"}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#fff",
            lineHeight: 1.4,
            marginTop: 2,
            fontFamily: fontStack,
          }}
        >
          {isUnlocked
            ? (statusText ?? "Tienes acceso a este contenido")
            : (state.panelMessage ?? "Desbloquea este contenido para verlo")}
        </div>
      </div>

      {state.isBlocked && (
        <button
          type="button"
          onClick={onOpenPayment}
          aria-label="Desbloquear contenido premium"
          style={{
            height: 30,
            padding: "0 10px",
            border: "none",
            borderRadius: 6,
            background: "linear-gradient(135deg, #4f46ff, #a855ff, #ff2fb3)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: fontStack,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            whiteSpace: "nowrap",
            marginRight: 4,
          }}
        >
          <VibraNavigationIcon type="premiumCrown" size={17} />
          Desbloquear Contenido
        </button>
      )}
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
  if (action === "edit_post") return "Editar publicación";
  if (action === "mute") return "Mutear";
  if (action === "unmute") return "Quitar mute";
  if (action === "ban") return "Banear";
  if (action === "unban") return "Quitar ban";
  if (action === "remove") return "Expulsar de la comunidad";
  if (action === "pin_group_post") return "Fijar en grupo";
  if (action === "unpin_group_post") return "Desfijar del grupo";
  if (action === "pin_profile_post") return "Fijar en mi perfil";
  if (action === "unpin_profile_post") return "Desfijar de mi perfil";
  if (action === "block_user") return "Bloquear de mi perfil";
  if (action === "unblock_user") return "Desbloquear de mi perfil";
  if (action === "block_in_group") return "Bloquear en este grupo";
  if (action === "unblock_in_group") return "Desbloquear en este grupo";
  return "Eliminar publicación";
}

export default function GroupPostCard({
  post,
  groupId = null,
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
  viewerIsMember = false,
  showGroupContext = false,
  canModerateGroupAuthor = false,
  canUseGroupMemberBlock = false,
  onModerationComplete,
  onGroupMemberBlockComplete,
  canCommentOnPosts = true,
  commentBlockedReason = null,
}: GroupPostCardProps) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [desktopVisibleCount, setDesktopVisibleCount] = useState(5);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [creatingComment, setCreatingComment] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [paymentPanelOpen, setPaymentPanelOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [liveEditOpen, setLiveEditOpen] = useState(false);
  const [liveSetupOpen, setLiveSetupOpen] = useState(false);
  const [liveViewerOpen, setLiveViewerOpen] = useState(false);
  const [liveCreatorOpen, setLiveCreatorOpen] = useState(false);
  const [isLivePortrait, setIsLivePortrait] = useState(false);
  const [localLiveData, setLocalLiveData] = useState<PostLiveData | null | undefined>(post.liveData);
  const [localText, setLocalText] = useState<string | null>(null);
  const [localMedia, setLocalMedia] = useState<import("@/lib/posts/types").PostMedia[] | null>(null);
  const { isTempUnlocked, unlock: applyTempUnlock } = usePostTempUnlock(post.id, currentUserId);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string | null>(null);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
const carouselShellRef = useRef<HTMLDivElement | null>(null);
const carouselTouchStartXRef = useRef<number | null>(null);
const carouselTouchStartYRef = useRef<number | null>(null);
const carouselTouchDeltaXRef = useRef(0);
const carouselTouchAxisRef = useRef<"x" | "y" | null>(null);
const [carouselDragOffsetX, setCarouselDragOffsetX] = useState(0);
const [carouselIsDragging, setCarouselIsDragging] = useState(false);
const [postTextExpanded, setPostTextExpanded] = useState(false);
const [optimisticViewerHasFlamed, setOptimisticViewerHasFlamed] = useState(
  post.viewerHasFlamed === true
);
const [optimisticLikesCount, setOptimisticLikesCount] = useState(
  post.counts?.likes ?? 0
);

const [optimisticViewerHasSaved, setOptimisticViewerHasSaved] = useState(
  post.viewerHasSaved === true
);
const [optimisticSavesCount, setOptimisticSavesCount] = useState(
  post.counts?.saves ?? 0
);

// Real-time listener for live status changes (driven by Mux webhooks)
useEffect(() => {
  if (post.postType !== "live" || !post.id) return;
  const currentStatus = localLiveData?.status ?? post.liveData?.status;
  if (currentStatus === "ended" || currentStatus === "cancelled") return;

  const unsubscribe = onSnapshot(
    doc(db, "posts", post.id),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const newLiveData = data?.liveData as PostLiveData | undefined;
      if (newLiveData) setLocalLiveData(newLiveData);
    },
    (err) => console.warn("[LiveCard] snapshot error", err)
  );
  return () => unsubscribe();
}, [post.id, post.postType]); // eslint-disable-line react-hooks/exhaustive-deps

useEffect(() => {
  flameServerStateRef.current = post.viewerHasFlamed === true;
  setOptimisticViewerHasFlamed(post.viewerHasFlamed === true);
  setOptimisticLikesCount(post.counts?.likes ?? 0);
}, [post.viewerHasFlamed, post.counts?.likes]);

useEffect(() => {
  saveServerStateRef.current = post.viewerHasSaved === true;
  setOptimisticViewerHasSaved(post.viewerHasSaved === true);
  setOptimisticSavesCount(post.counts?.saves ?? 0);
}, [post.viewerHasSaved, post.counts?.saves]);

  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const flameUsersCacheRef = useRef<Record<string, PostFlameUser[]>>({});
  const flameServerStateRef = useRef(post.viewerHasFlamed === true);
  const flamePendingRef = useRef<boolean | null>(null);
  const flameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveServerStateRef = useRef(post.viewerHasSaved === true);
  const savePendingRef = useRef<boolean | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const effectiveGroupId =
    typeof groupId === "string" && groupId.trim().length > 0
      ? groupId.trim()
      : groupInfo.groupId;

  const isOwnPost = !!currentUserId && postAuthor.authorId === currentUserId;

  const groupMemberBlockTargetUserId =
    canUseGroupMemberBlock &&
    !!effectiveGroupId &&
    !!currentUserId &&
    !!postAuthor.authorId &&
    !isOwnPost
      ? postAuthor.authorId
      : null;

  const {
    relationship: groupMemberBlockRelationship,
    loading: groupMemberBlockLoading,
    error: groupMemberBlockError,
    block: blockPostAuthorInGroup,
    unblock: unblockPostAuthorInGroup,
  } = useGroupMemberBlocks({
    groupId: effectiveGroupId,
    currentUserId,
    targetUserId: groupMemberBlockTargetUserId,
  });

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

  const isProfilePost =
    (post as unknown as { contextType?: string | null }).contextType === "profile";

  const socialTargetUserId =
    isProfilePost && !isOwnPost && postAuthor.authorId
      ? postAuthor.authorId
      : null;

  const {
    relationship: postAuthorRelationship,
    loading: socialRelationshipLoading,
    error: socialRelationshipError,
    block: blockPostAuthor,
    unblock: unblockPostAuthor,
  } = useSocialRelationship(currentUserId, socialTargetUserId);

  useEffect(() => {
    if (!socialRelationshipError) return;

    setInlineActionError(socialRelationshipError);
  }, [socialRelationshipError]);

  useEffect(() => {
    if (!groupMemberBlockError) return;

    setInlineActionError(groupMemberBlockError);
  }, [groupMemberBlockError]);

  const shouldShowSocialBlockAction =
    isProfilePost &&
    !!currentUserId &&
    !!postAuthor.authorId &&
    !isOwnPost &&
    !postAuthorRelationship.isBlockedBy;

  const shouldShowGroupMemberBlockAction =
    !isProfilePost &&
    canUseGroupMemberBlock &&
    !!effectiveGroupId &&
    !!currentUserId &&
    !!postAuthor.authorId &&
    !isOwnPost &&
    !groupMemberBlockRelationship.isBlockedBy;

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

    if (shouldShowSocialBlockAction) {
      actions.push(
        postAuthorRelationship.hasBlocked === true
          ? "unblock_user"
          : "block_user"
      );
    }

    if (shouldShowGroupMemberBlockAction) {
      actions.push(
        groupMemberBlockRelationship.hasBlocked === true
          ? "unblock_in_group"
          : "block_in_group"
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

    if (currentUserId && post.authorId === currentUserId) {
      actions.push("edit_post");
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
    shouldShowSocialBlockAction,
    postAuthorRelationship.hasBlocked,
    shouldShowGroupMemberBlockAction,
    groupMemberBlockRelationship.hasBlocked,
    canModerateAuthor,
    effectiveAuthorStatus,
    canDelete,
    onDelete,
  ]);


  function openMediaViewer(mediaUrl: string | null) {
    if (!mediaUrl) return;
    if (premiumState.isBlocked) return;

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
  if (!currentUserId) {
    return;
  }

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

function handleToggleFlame() {
  if (!currentUserId) {
    setInlineActionError("Inicia sesión para dar flamita.");
    return;
  }
  if (!onToggleFlame) return;

  const nextState = !optimisticViewerHasFlamed;
  flamePendingRef.current = nextState;
  setOptimisticViewerHasFlamed(nextState);
  setOptimisticLikesCount((c) => Math.max(0, c + (nextState ? 1 : -1)));
  setInlineActionError(null);

  if (flameDebounceRef.current !== null) clearTimeout(flameDebounceRef.current);

  flameDebounceRef.current = setTimeout(async () => {
    flameDebounceRef.current = null;
    const desired = flamePendingRef.current;
    flamePendingRef.current = null;
    if (desired === flameServerStateRef.current) return;

    setFlameBusy(true);
    try {
      await onToggleFlame(post.id);
      delete flameUsersCacheRef.current[post.id];
      flameServerStateRef.current = desired!;
    } catch (e: any) {
      setOptimisticViewerHasFlamed(flameServerStateRef.current);
      setOptimisticLikesCount(post.counts?.likes ?? 0);
      setInlineActionError(e?.message ?? "No se pudo actualizar la flamita.");
    } finally {
      setFlameBusy(false);
    }
  }, 400);
}

function handleToggleSave() {
  if (!currentUserId) {
    setInlineActionError("Inicia sesión para guardar publicaciones.");
    return;
  }
  if (!onToggleSave) return;

  const nextState = !optimisticViewerHasSaved;
  savePendingRef.current = nextState;
  setOptimisticViewerHasSaved(nextState);
  setOptimisticSavesCount((c) => Math.max(0, c + (nextState ? 1 : -1)));
  setInlineActionError(null);

  if (saveDebounceRef.current !== null) clearTimeout(saveDebounceRef.current);

  saveDebounceRef.current = setTimeout(async () => {
    saveDebounceRef.current = null;
    const desired = savePendingRef.current;
    savePendingRef.current = null;
    if (desired === saveServerStateRef.current) return;

    setSaveBusy(true);
    try {
      await onToggleSave(post.id);
      saveServerStateRef.current = desired!;
    } catch (e: any) {
      setOptimisticViewerHasSaved(saveServerStateRef.current);
      setOptimisticSavesCount(post.counts?.saves ?? 0);
      setInlineActionError(e?.message ?? "No se pudo actualizar el guardado.");
    } finally {
      setSaveBusy(false);
    }
  }, 400);
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

  function handleToggleCommentsDesktop() {
    if (commentsPanelOpen) {
      setCommentsPanelOpen(false);
      setDesktopVisibleCount(5);
    } else {
      void handleOpenCommentsPanel();
    }
  }

  async function handleCreateComment() {
    if (premiumState.isBlocked) {
      setInlineActionError(
        currentUserId
          ? "Desbloquea este contenido para poder comentar."
          : "Inicia sesión para poder comentar."
      );
      return;
    }
    if (!effectiveCanCommentOnPosts) {
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

  async function runModerationAction(
    action: "unmute" | "ban" | "unban" | "remove"
  ) {
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

    async function handleBlockPostAuthor() {
    if (socialRelationshipLoading) return;

    const confirmed = window.confirm(
      "¿Seguro que quieres bloquear a este usuario?"
    );

    if (!confirmed) return;

    try {
      setInlineActionError(null);
      setMenuOpen(false);
      await blockPostAuthor();
    } catch (e: any) {
      setInlineActionError(e?.message ?? "No se pudo bloquear este usuario.");
    }
  }

  async function handleUnblockPostAuthor() {
    if (socialRelationshipLoading) return;

    try {
      setInlineActionError(null);
      setMenuOpen(false);
      await unblockPostAuthor();
    } catch (e: any) {
      setInlineActionError(e?.message ?? "No se pudo desbloquear este usuario.");
    }
  }

  async function handleBlockPostAuthorInGroup() {
    if (groupMemberBlockLoading) return;

    const confirmed = window.confirm(
      "¿Seguro que quieres bloquear a este usuario en este grupo?"
    );

    if (!confirmed) return;

    try {
      setInlineActionError(null);
      setMenuOpen(false);
      setComments(null);
      await blockPostAuthorInGroup();
      await onGroupMemberBlockComplete?.();
    } catch (e: any) {
      setInlineActionError(
        e?.message ?? "No se pudo bloquear este usuario en este grupo."
      );
    }
  }

  async function handleUnblockPostAuthorInGroup() {
    if (groupMemberBlockLoading) return;

    try {
      setInlineActionError(null);
      setMenuOpen(false);
      setComments(null);
      await unblockPostAuthorInGroup();
      await onGroupMemberBlockComplete?.();
    } catch (e: any) {
      setInlineActionError(
        e?.message ?? "No se pudo desbloquear este usuario en este grupo."
      );
    }
  }

  async function handleEditSubmit(payload: GroupPostComposerSubmitPayload) {
    const { text, mediaItems = [], premium } = payload;

    const finalMedia: import("@/lib/posts/types").PostMedia[] = [];
    for (const item of mediaItems) {
      if (item.existingPostMedia) {
        finalMedia.push(item.existingPostMedia);
      } else if (item.file && item.file.size > 0 && item.type === "image") {
        const uploaded = await uploadPostImage({
          groupId: post.groupId ?? post.profileId ?? post.authorId,
          file: item.file,
        });
        finalMedia.push(uploaded);
      }
    }

    await updatePost({ postId: post.id, text, media: finalMedia, premium });
    setLocalText(text);
    setLocalMedia(finalMedia);
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

    if (action === "block_user") {
      await handleBlockPostAuthor();
      return;
    }

    if (action === "unblock_user") {
      await handleUnblockPostAuthor();
      return;
    }

    if (action === "block_in_group") {
      await handleBlockPostAuthorInGroup();
      return;
    }

    if (action === "unblock_in_group") {
      await handleUnblockPostAuthorInGroup();
      return;
    }

    if (action === "edit_post") {
      setMenuOpen(false);
      if (post.postType === "live") {
        setLiveEditOpen(true);
      } else {
        setEditModalOpen(true);
      }
      return;
    }

    if (action === "mute") {
      setMuteDays("7");
      setMuteModalOpen(true);
      setMenuOpen(false);
      return;
    }

    await runModerationAction(
      action as "unmute" | "ban" | "unban" | "remove",
    );
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
  position: "relative",
  overflow: "hidden",
  borderRadius: isMobile ? 0 : 12,

  border: "1px solid rgba(0, 0, 0, 1)",
  borderLeft: isMobile ? "none" : "1px solid rgba(0, 0, 0, 1)",
  borderRight: isMobile ? "none" : "1px solid rgba(0, 0, 0, 1)",

  background:
    "linear-gradient(135deg, rgb(0, 0, 0) 0%, rgb(2, 2, 4) 50%, rgb(0, 0, 0) 100%)",

  color: "#fff",
  padding: isMobile ? "14px 12px" : 12,
  boxSizing: "border-box",

  backdropFilter: "none",

  boxShadow: "0 14px 42px rgba(0, 0, 0, 0.74)",

  marginBottom: isMobile ? 0.2 : 0,
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
    lineHeight: 1.35,
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
  borderRadius: 0,
  border: "none",
  background: "transparent",
  color: "rgba(255,255,255,0.84)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
  fontSize: 18,
  lineHeight: 1,
  padding: 0,
  WebkitTapHighlightColor: "transparent",
};

  const menuPanelStyle: CSSProperties = {
    position: "fixed",
    minWidth: isMobile ? 180 : 200,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(12,12,12,0.96)",
    boxShadow: "0 14px 34px rgba(0,0,0,0.34)",
    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
    padding: 6,
    zIndex: 99999,
    display: "grid",
    gap: 4,
  };

  const menuItemStyle: CSSProperties = {
    width: "100%",
    minHeight: 34,
    padding: "8px 10px",
    borderRadius: 0,
    border: "none",
    borderTop: "none",
    background: "transparent",
    color: "#fff",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: fontStack,
    textAlign: "center",
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
    lineHeight: 1.35,
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
  width: 24,
  height: 24,
  border: "none",
  background: "transparent",
  padding: 0,
  display: "inline-grid",
  placeItems: "center",
  cursor: "pointer",
  opacity: 1,
  transform: optimisticViewerHasFlamed ? "scale(1.04)" : "scale(1)",
  transition: "transform 140ms ease",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const flameIconStyle: CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  lineHeight: 1,
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
  width: "100%",
  maxWidth: "100%",
  marginLeft: 0,
  marginRight: 0,
};

function getImageWrapStyle(mediaUrl: string): CSSProperties {
  const ratio = mediaAspectRatios[mediaUrl];

  return {
    position: "relative",
    width: "100%",
    maxWidth: "100%",
    aspectRatio: getResponsiveMediaAspectRatio(ratio),
    borderRadius: isMobile ? 0 : 12,
    overflow: "hidden",
    border: "none",
    background: "#000",
  };
}

const postImageStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 1,
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

function getResponsiveMediaAspectRatio(ratio?: number | null): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) {
    return isMobile ? "16 / 10" : "16 / 9";
  }

  if (!isMobile) {
    if (ratio >= 1.2) return "16 / 9";
    if (ratio <= 0.82) return "16 / 9";
    return "16 / 10";
  }

  if (ratio >= 1.2) {
    return "16 / 10";
  }

  if (ratio <= 0.82) {
    const minRatio = 0.58;
    const safeRatio = Math.max(ratio, minRatio);

    return `${safeRatio} / 1`;
  }

  return `${ratio} / 1`;
}
function shouldContainMedia(ratio?: number | null): boolean {
  return !isMobile && typeof ratio === "number" && ratio <= 0.82;
}

function shouldUseNarrowVerticalFrame(ratio?: number | null): boolean {
  return typeof ratio === "number" && Number.isFinite(ratio) && ratio <= 0.82;
}

function getContainedMediaScale(ratio?: number | null): number {
  return 1;
}

function getFeedMediaUrl(media: DisplayMediaItem): string {
  if (
    media.thumbnailUrl &&
    media.thumbnailUrl.trim().length > 0 &&
    !failedMediaUrls[media.thumbnailUrl]
  ) {
    return media.thumbnailUrl.trim();
  }

  return media.url;
}

function renderBlurredMediaBackdrop(
  sourceUrl: string | null | undefined,
  mediaType: "image" | "video" = "image"
) {
  if (isMobile || !sourceUrl) return null;

  const commonStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: "blur(28px) saturate(1.08)",
    transform: "scale(1.14)",
    opacity: 0.34,
    pointerEvents: "none",
    zIndex: 0,
  };

  if (mediaType === "video") {
    return (
      <video
        src={sourceUrl}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        style={commonStyle}
      />
    );
  }

  return (
    <img
      src={sourceUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={commonStyle}
    />
  );
}
  const shouldShowActionsMenu = availableActions.length > 0;
  const isPinned =
    post.isPinnedInGroup === true || post.isPinnedOnProfile === true;

  const activeLiveData = localLiveData ?? post.liveData;

  const isLiveActive = post.postType === "live" && activeLiveData?.status === "live";
  const liveName =
    activeLiveData?.createdFrom === "group"
      ? (groupInfo.groupName ?? postAuthor.authorName)
      : postAuthor.authorName;

  const liveVisibilityMode = activeLiveData?.visibilityMode ?? null;
  const liveAllowLoggedOut = activeLiveData?.allowLoggedOutViewers ?? true;

  const liveVisibilityBadge: { label: string; icon: "lock" | "globe" | "user" } | null =
    liveVisibilityMode === "members_only"
      ? { label: "Solo miembros", icon: "lock" }
      : liveVisibilityMode === "logged_in_only"
        ? { label: "Solo con cuenta", icon: "user" }
        : liveVisibilityMode === "everyone"
          ? { label: "Visible sin cuenta", icon: "globe" }
          : null;

  const liveAccessBlocked =
    post.postType === "live" && (
      (liveVisibilityMode === "members_only" && !isOwner && !viewerIsMember) ||
      (liveVisibilityMode === "logged_in_only" && !currentUserId)
    );

  const liveAccessCtaText =
    liveVisibilityMode === "members_only"
      ? (currentUserId ? "Únete a la comunidad para ver este live" : "Inicia sesión y únete para ver este live")
      : "Inicia sesión para ver este live";

  const premiumState = resolvePostPremiumState({
    post,
    currentUserId,
    viewerIsMember: isOwner || viewerIsMember,
    viewerAccess: isTempUnlocked ? ({ status: "active" } as PostAccess) : null,
  });

  const effectiveCanCommentOnPosts =
    premiumState.isPremium && !premiumState.isBlocked && !!currentUserId
      ? true
      : canCommentOnPosts;

  const commentBlockedMessage =
    premiumState.isBlocked && !currentUserId
      ? "Inicia sesión para poder comentar."
      : premiumState.isBlocked
      ? "Desbloquea este contenido para poder comentar."
      : !effectiveCanCommentOnPosts
      ? buildCommentBlockedMessage(commentBlockedReason)
      : null;

  const postTypeLabel = getPostTypeLabel(post);
  const postStatusLabel = getPostStatusLabel(post);
  const shouldShowMediaStatus = !!postTypeLabel || !!postStatusLabel;
  const mediaFromPost = Array.isArray(localMedia ?? post.media)
    ? (localMedia ?? post.media ?? [])
    : [];

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

      const thumbnailUrl =
        typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim()
          ? item.thumbnailUrl.trim()
          : null;

      return {
        type: "image" as const,
        url: item.url.trim(),
        thumbnailUrl,
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

  useEffect(() => {
  setActiveMediaIndex(0);
}, [post.id, displayMedia.length]);

function goToPreviousMedia() {
  setActiveMediaIndex((current) =>
    current <= 0 ? displayMedia.length - 1 : current - 1
  );
}

function goToNextMedia() {
  setActiveMediaIndex((current) =>
    current >= displayMedia.length - 1 ? 0 : current + 1
  );
}

useEffect(() => {
  if (!isMobile) return;

  const el = carouselShellRef.current;
  if (!el) return;

  const axisThreshold = 5;   // detect direction sooner — less blocking on vertical scroll
  const axisBias = 1.0;      // 45° split — forgiving for human diagonal swipes
  const swipeThreshold = 70;

  function resetGesture() {
    carouselTouchStartXRef.current = null;
    carouselTouchStartYRef.current = null;
    carouselTouchDeltaXRef.current = 0;
    carouselTouchAxisRef.current = null;

    setCarouselIsDragging(false);
    setCarouselDragOffsetX(0);

    document.body.style.overflow = "";
  }

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;

    carouselTouchStartXRef.current = touch.clientX;
    carouselTouchStartYRef.current = touch.clientY;
    carouselTouchDeltaXRef.current = 0;
    carouselTouchAxisRef.current = null;

    setCarouselIsDragging(false);
    setCarouselDragOffsetX(0);
  }

  function handleTouchMove(event: TouchEvent) {
    const startX = carouselTouchStartXRef.current;
    const startY = carouselTouchStartYRef.current;
    const touch = event.touches[0];

    if (startX === null || startY === null || !touch) return;

    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (carouselTouchAxisRef.current === null) {
      if (absX < axisThreshold && absY < axisThreshold) return;

      if (absX > absY * axisBias) {
        carouselTouchAxisRef.current = "x";
        document.body.style.overflow = "hidden";
      } else {
        carouselTouchAxisRef.current = "y";
      }
    }

    if (carouselTouchAxisRef.current === "y") {
      setCarouselIsDragging(false);
      setCarouselDragOffsetX(0);
      return;
    }

    event.preventDefault();

    carouselTouchDeltaXRef.current = deltaX;
    setCarouselIsDragging(true);
    setCarouselDragOffsetX(deltaX);
  }

  function handleTouchEnd() {
    const axis = carouselTouchAxisRef.current;
    const deltaX = carouselTouchDeltaXRef.current;

    resetGesture();

    if (axis !== "x") return;
    if (Math.abs(deltaX) < swipeThreshold) return;

    if (deltaX < 0) {
      goToNextMedia();
    } else {
      goToPreviousMedia();
    }
  }

  el.addEventListener("touchstart", handleTouchStart, { passive: true });
  el.addEventListener("touchmove", handleTouchMove, { passive: false });
  el.addEventListener("touchend", handleTouchEnd, { passive: true });
  el.addEventListener("touchcancel", resetGesture, { passive: true });

  return () => {
    el.removeEventListener("touchstart", handleTouchStart);
    el.removeEventListener("touchmove", handleTouchMove);
    el.removeEventListener("touchend", handleTouchEnd);
    el.removeEventListener("touchcancel", resetGesture);

    document.body.style.overflow = "";
  };
}, [isMobile, displayMedia.length, activeMediaIndex]);

function getMediaDotsTranslateX() {
  const total = displayMedia.length;
  const maxVisibleDots = 5;
  const dotStep = 12;

  if (total <= maxVisibleDots) return 0;

  const centerOffset = Math.floor(maxVisibleDots / 2) * dotStep;
  const desiredTranslate = centerOffset - activeMediaIndex * dotStep;
  const minTranslate = -((total - maxVisibleDots) * dotStep);

  return Math.max(minTranslate, Math.min(0, desiredTranslate));
}

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

  const videoOrientationRatio =
    videoThumbnailUrl && mediaAspectRatios[videoThumbnailUrl]
      ? mediaAspectRatios[videoThumbnailUrl]
      : videoAspectRatio;

  const shouldContainRootVideo = shouldContainMedia(videoOrientationRatio);
const rootVideoShellAspectRatio =
  isMobile && typeof videoOrientationRatio === "number" && videoOrientationRatio <= 0.82
    ? "9 / 16"
    : isMobile && videoThumbnailUrl && videoOrientationRatio == null
      ? "9 / 16"
      : getResponsiveMediaAspectRatio(videoOrientationRatio);
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

    const cleanPostText = typeof (localText ?? post.text) === "string"
      ? (localText ?? post.text).trim()
      : "";
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
          <StoryRingAvatar
            entityId={postAuthor.authorId}
            entityType="profile"
            currentUserId={currentUserId}
            photoURL={postAuthor.avatarUrl}
            displayName={postAuthor.authorName}
            size={38}
            onClick={() => { window.location.href = postAuthor.profileHref; }}
          />

          <div style={{ minWidth: 0, flex: 1, paddingTop: 3 }}>
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
    height: 13,
    background: "rgba(255, 255, 255, 0.65)",
    boxShadow:
      "0 0 10px rgba(255, 255, 255, 0.45), 0 0 18px rgba(255, 255, 255, 0.22)",
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
  marginTop: 0,
  display: "block",
  width: "fit-content",
  padding: 0,
  border: "none",
  background: "transparent",
  fontFamily: fontStack,
  cursor: "pointer",
  textAlign: "left",
  lineHeight: "15px",
  WebkitTapHighlightColor: "transparent",
}}
>
  {showExactPostDate
    ? formatExactDate(post.createdAt)
    : formatRelativeDate(post.createdAt)}
  {(post.editedAt ?? localText !== null) ? (
    <span style={{ opacity: 0.45, fontStyle: "italic", marginLeft: 2 }}>
      {" · Editado"}
    </span>
  ) : null}
</button>

          </div>
        </div>

        {(isPinned || shouldShowActionsMenu) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
            }}
          >
            {isPinned && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  color: "rgba(239,68,68,0.82)",
                  fontSize: 11,
                  fontStyle: "italic",
                  fontWeight: 400,
                  lineHeight: 1,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="12" x2="12" y1="17" y2="22" />
                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                </svg>
                <span>Fijado</span>
              </span>
            )}
            {shouldShowActionsMenu && (
              <div style={{ position: "relative" }}>
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
        )}
      </div>

{/* Premium content wrapper — applies visual frame for premium posts only */}
<div
  style={
    premiumState.isPremium
      ? {
          position: "relative",
          marginTop: 10,
          border: "2.6px solid #a855f7",
          borderRadius: 8,
          background:
            "linear-gradient(160deg, rgba(79,70,255,0.06), rgba(168,85,255,0.04) 55%, rgba(255,47,179,0.03))",
          boxShadow:
            "0 0 0 1px rgba(168,85,255,0.06), 0 4px 28px rgba(168,85,255,0.1)",
          padding: "12px 10px 12px",
        }
      : undefined
  }
>
  {premiumState.isPremium && (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 10,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: "linear-gradient(180deg, #a855f7 0%, #d946b8 100%)",
        borderBottomLeftRadius: 6,
        borderBottomRightRadius: 6,
        padding: "3px 8px 3px 6px",
        fontSize: 8.5,
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: "#fff",
        whiteSpace: "nowrap",
        fontFamily: fontStack,
        textTransform: "uppercase",
      }}
    >
      <VibraNavigationIcon type="premiumCrown" size={14} />
      Publicación Premium
    </div>
  )}

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

    {cleanPostText.length > 0 && post.postType !== "live" && (
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

{post.postType === "live" && (
  // Portrait solo aplica cuando el live está activo/reproduciéndose
  <div style={(isLiveActive && isLivePortrait) ? { display: "flex", justifyContent: "center", marginTop: 10 } : { marginTop: 10 }}>
    <div
      style={{
        width: (isLiveActive && isLivePortrait) ? "min(280px, 100%)" : "100%",
        borderRadius: 14,
        position: "relative",
        overflow: "hidden",
        border: isLiveActive ? "2.6px solid #ef4444" : "2.6px solid #a855f7",
        boxShadow: isLiveActive
          ? "0 0 0 1px rgba(239,68,68,0.06), 0 4px 28px rgba(239,68,68,0.18)"
          : "0 0 0 1px rgba(168,85,255,0.06), 0 4px 28px rgba(168,85,255,0.1)",
        background: "transparent",
      }}
    >
      {/* Badge EN VIVO / Finalizado / Programado */}
      <div
        style={{
          position: "absolute",
          ...(isLiveActive
            ? { bottom: 0, left: "50%", transform: "translateX(-50%)", borderTopLeftRadius: 8, borderTopRightRadius: 8 }
            : { top: 0, right: 10, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 }),
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: isLiveActive
            ? "#ef4444"
            : "linear-gradient(180deg, #a855f7 0%, #d946b8 100%)",
          padding: isLiveActive ? "5px 12px 5px 9px" : "3px 8px 3px 6px",
          fontSize: isLiveActive ? 11 : 8.5,
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: "#fff",
          whiteSpace: "nowrap",
          fontFamily: fontStack,
          textTransform: "uppercase",
          zIndex: 3,
        }}
      >
        <svg
          width={isLiveActive ? 13 : 11} height={isLiveActive ? 13 : 11} viewBox="0 0 22 22" fill="none"
          style={{ animation: isLiveActive ? "livePulseIcon 1.4s ease-in-out infinite" : undefined }}
        >
          <circle cx="11" cy="11" r="10" stroke="#fff" strokeWidth="1.4" fill="none" />
          <circle cx="11" cy="11" r="6" fill="#fff" />
        </svg>
        {isLiveActive ? "En vivo" : activeLiveData?.status === "ended" ? "Finalizado" : "Live Programado"}
      </div>

      {/* Botón "Abrir gestor" — overlay top-right, solo para el creador del live activo */}
      {currentUserId === post.authorId && isLiveActive && (
        <button
          type="button"
          onClick={() => setLiveCreatorOpen(true)}
          style={{
            position: "absolute", top: 10, right: 10, zIndex: 4,
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.55)",
            color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: fontStack,
            cursor: "pointer",
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Abrir gestor
        </button>
      )}

      {/* Área de media — player activo, finalizado, o programado */}
      {isLiveActive && activeLiveData?.playbackId ? (
        <LiveInlinePlayer
          playbackId={activeLiveData.playbackId}
          title={activeLiveData.title}
          coverUrl={activeLiveData.coverUrl}
          portrait={isLivePortrait}
          paused={liveViewerOpen}
          onClick={() => setLiveViewerOpen(true)}
          onOrientationDetected={(p) => setIsLivePortrait(p)}
        />
      ) : activeLiveData?.status === "ended" ? (
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            background: "rgba(0,0,0,0.7)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {activeLiveData.coverUrl && (
            <img
              src={activeLiveData.coverUrl}
              alt={activeLiveData.title ?? "Live finalizado"}
              draggable={false}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.2, filter: "grayscale(40%)" }}
            />
          )}
          <div style={{
            position: "relative", zIndex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", gap: 8, color: "rgba(255,255,255,0.55)",
            fontFamily: fontStack, textAlign: "center",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Transmisión finalizada</span>
          </div>
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 7",
            background:
              "radial-gradient(ellipse at center, rgba(180,180,195,0.18) 0%, rgba(110,110,130,0.10) 60%, rgba(70,70,90,0.06) 100%), linear-gradient(135deg, rgba(60,60,75,0.55) 0%, rgba(30,30,45,0.85) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {activeLiveData?.coverUrl && (
            <img
              src={activeLiveData.coverUrl}
              alt={activeLiveData.title ?? "Live programado"}
              draggable={false}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.45, filter: "grayscale(20%)" }}
            />
          )}
          <svg
            width="52" height="52" viewBox="0 0 22 22" fill="none"
            style={{ flexShrink: 0, position: "relative", zIndex: 1, animation: "livePulseIcon 2s ease-in-out infinite" }}
          >
            <circle cx="11" cy="11" r="10" stroke="#ef4444" strokeWidth="1.4" fill="none" />
            <circle cx="11" cy="11" r="6" fill="#ef4444" />
          </svg>
          <div style={{
            position: "absolute", top: 10, left: 10,
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "rgba(10,5,20,0.82)", border: "1px solid rgba(168,85,255,0.35)",
            borderRadius: 999, padding: "4px 10px 4px 8px",
            fontFamily: fontStack, fontSize: 11, fontWeight: 700,
            letterSpacing: "0.04em", color: "#d8b4fe", textTransform: "uppercase",
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            maxWidth: "calc(100% - 20px)",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%", background: "#a855f7",
              flexShrink: 0, boxShadow: "0 0 0 2px rgba(168,85,255,0.3)",
              animation: "livePulse 2s ease-in-out infinite",
            }} />
            Esperando inicio
          </div>
        </div>
      )}

    {/* Content area — hidden when live is active */}
    {!isLiveActive && (<div style={{ padding: "12px 14px 14px" }}>
      {/* Title */}
      {activeLiveData?.title && (
        <p
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#fff",
            fontFamily: fontStack,
            lineHeight: 1.3,
            marginBottom: 4,
          }}
        >
          {activeLiveData.title}
        </p>
      )}

      {/* Description */}
      {activeLiveData?.description && (
        <p
          style={{
            margin: 0,
            marginTop: 4,
            fontSize: 13,
            color: "rgba(255,255,255,0.58)",
            fontFamily: fontStack,
            lineHeight: 1.45,
          }}
        >
          {activeLiveData.description}
        </p>
      )}

      {/* Scheduled date row */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(168,85,255,0.8)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span
          style={{
            fontSize: 12,
            fontFamily: fontStack,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          {formatScheduledLiveDate(activeLiveData?.scheduledStartAt)}
        </span>
      </div>

      {/* Fila inferior: badge visibilidad + CTA acceso */}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        {liveVisibilityBadge && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.05)",
            padding: "3px 8px",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "rgba(255,255,255,0.45)",
            fontFamily: fontStack,
            textTransform: "uppercase",
          }}>
            {liveVisibilityBadge.icon === "lock" && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
            {liveVisibilityBadge.icon === "user" && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            )}
            {liveVisibilityBadge.icon === "globe" && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            )}
            {liveVisibilityBadge.label}
          </div>
        )}

        {/* Botón Configurar transmisión — solo visible para el dueño del live */}
        {isOwner && post.postType === "live" && (
          <button
            type="button"
            onClick={() => setLiveSetupOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid rgba(239,68,68,0.35)",
              background: activeLiveData?.liveStreamId
                ? "rgba(239,68,68,0.08)"
                : "rgba(239,68,68,0.14)",
              color: "#fca5a5",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: fontStack,
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="10" stroke="#ef4444" strokeWidth="1.4" fill="none" />
              <circle cx="11" cy="11" r="5" fill="#ef4444" />
            </svg>
            {activeLiveData?.liveStreamId ? "Ver configuración" : "Configurar transmisión"}
          </button>
        )}

        {liveAccessBlocked && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            borderRadius: 999,
            border: "1px solid rgba(239,68,68,0.25)",
            background: "rgba(239,68,68,0.08)",
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(239,68,68,0.8)",
            fontFamily: fontStack,
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            {liveAccessCtaText}
          </div>
        )}
      </div>

    </div>)}

    <style>{`
      @keyframes livePulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 0 2px rgba(168,85,255,0.3); }
        50% { opacity: 0.55; box-shadow: 0 0 0 4px rgba(168,85,255,0.12); }
      }
      @keyframes livePulseIcon {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.45; }
      }
    `}</style>
    </div>
  </div>
)}

{isVideoPost && !hasMediaGrid && (
  <div
style={{
  marginTop: 10,
  width: "100%",
  maxWidth: "100%",
  marginLeft: 0,
  marginRight: 0,
  borderRadius: isMobile ? 12 : 14,
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
          aspectRatio: rootVideoShellAspectRatio,
          overflow: "hidden",
          background: "#050505",
          ...(premiumState.isBlocked ? { filter: "blur(10px)", opacity: 0.72, pointerEvents: "none" } : {}),
        }}
      >
        {shouldContainRootVideo &&
          renderBlurredMediaBackdrop(
            videoThumbnailUrl || videoPlaybackUrl,
            videoThumbnailUrl ? "image" : "video"
          )}

{!shouldLoadFeedVideo && videoThumbnailUrl && (
  <img
    src={videoThumbnailUrl}
    alt="Vista previa del video"
    loading="lazy"
    draggable={false}
    style={{
      position: "relative",
      zIndex: 1,
      display: "block",
      width: "100%",
      height: "100%",
      objectFit: isMobile ? "contain" : shouldContainRootVideo ? "contain" : "cover",
      background: shouldContainRootVideo ? "transparent" : "#050505",
    }}
    onLoad={(event) => {
      const img = event.currentTarget;
      const ratio =
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? img.naturalWidth / img.naturalHeight
          : 1;

      setMediaAspectRatios((prev) => ({
        ...prev,
        [videoThumbnailUrl]: ratio,
      }));
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
      position: "absolute",
      inset: 0,
      zIndex: 1,
      display: videoMetadataLoaded ? "block" : "none",
      width: "100%",
      height: "100%",
      background: "transparent",
objectFit: isMobile ? "contain" : shouldContainRootVideo ? "contain" : "cover",
transform: `scale(${getContainedMediaScale(videoOrientationRatio)})`,
transformOrigin: "center center",
cursor: isMobile ? "pointer" : "default",
    }}
  />
)}

{!isMobile && (
  <div
    aria-hidden="true"
    style={{
      position: "absolute",
      inset: 0,
      zIndex: 3,
      display: "grid",
      placeItems: "center",
      pointerEvents: "none",
    }}
  >
    <span
      style={{
        width: 62,
        height: 62,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        background: "rgba(124,58,237,0.28)",
        border: "1px solid rgba(255,255,255,0.22)",
        color: "#fff",
        fontSize: 28,
        paddingLeft: 4,
        boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
      }}
    >
      ▶
    </span>
  </div>
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
        background: "rgba(124,58,237,0.28)",
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
const activeMedia =
  displayMedia[Math.min(activeMediaIndex, totalMedia - 1)] ?? displayMedia[0];

const activeMediaRatio = mediaAspectRatios[activeMedia.url];
const useNarrowActiveFrame = shouldUseNarrowVerticalFrame(activeMediaRatio);

const carouselShellAspectRatio = "16 / 10";

function getCarouselMediaFrameWidth(media: DisplayMediaItem) {
  const ratio = mediaAspectRatios[media.url];
  const useNarrowFrame = shouldUseNarrowVerticalFrame(ratio);

  if (!useNarrowFrame) return "100%";

  return "46%";
}

      function openMedia(media: DisplayMediaItem) {
        if (media.isPlaceholder) return;
        openMediaViewer(media.url);
      }

      function renderVideoOverlay(media: DisplayMediaItem, blocked = false) {
        if (media.type !== "video") return null;
        if (blocked) return null;

        const durationLabel = formatMediaDuration(media.duration);

        return (
          <>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 3,
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
                  background: "rgba(124,58,237,0.28)",
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
                  zIndex: 3,
                  minHeight: 20,
                  padding: "3px 7px",
                  borderRadius: 6,
                  background: "rgba(124,58,237,0.48)",
                  border: "1px solid rgba(255,255,255,0.18)",
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

const tileImageStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  width: "100%",
  height: "100%",
  display: "block",
  objectFit: "cover",
  touchAction: "pan-y",
};

function renderMediaContent(
  media: DisplayMediaItem,
  index: number,
  loading: "eager" | "lazy" = "lazy",
  forceMobileCover = false
) {
        if (media.isPlaceholder) {
          return renderVideoProcessingPlaceholder(media);
        }

const feedMediaUrl =
  media.url && !failedMediaUrls[media.url] ? media.url : getFeedMediaUrl(media);

const mediaRatio = mediaAspectRatios[media.url] ?? mediaAspectRatios[feedMediaUrl];
const shouldContainTile = shouldContainMedia(mediaRatio);
const mediaObjectFit = "cover";
const mediaScale = 1;
        if (media.type === "video" && !media.thumbnailUrl && media.playbackUrl) {
          return (
            <>
              {shouldContainTile && renderBlurredMediaBackdrop(media.playbackUrl, "video")}

              <video
                src={media.playbackUrl}
                muted
                playsInline
                preload="metadata"
                draggable={false}
                style={{
                  ...tileImageStyle,
objectFit: mediaObjectFit,
background: shouldContainTile ? "transparent" : "#050505",
transform: `scale(${mediaScale})`,
transformOrigin: "center center",
                }}
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  const ratio =
                    video.videoWidth > 0 && video.videoHeight > 0
                      ? video.videoWidth / video.videoHeight
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

              {renderVideoOverlay(media, premiumState.isBlocked)}
            </>
          );
        }

        return (
          <>
            {shouldContainTile && renderBlurredMediaBackdrop(feedMediaUrl, "image")}

            <img
              src={feedMediaUrl}
              alt={
                media.altText ||
                (media.type === "video"
                  ? `Video ${index + 1} de la publicación`
                  : `Imagen ${index + 1} de la publicación`)
              }
              loading={loading}
              draggable={false}
              style={{
                ...tileImageStyle,
objectFit: mediaObjectFit,
background: shouldContainTile ? "transparent" : "#050505",
transform: `scale(${mediaScale})`,
transformOrigin: "center center",
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
                  [feedMediaUrl]: true,
                }));
              }}
              onError={() => {
                setFailedMediaUrls((prev) => ({
                  ...prev,
                  [feedMediaUrl]: true,
                }));
              }}
            />

            {renderVideoOverlay(media)}
          </>
        );
      }

if (totalMedia === 1) {
  const first = displayMedia[0];

  const firstFeedUrl =
    first.url && !failedMediaUrls[first.url] ? first.url : getFeedMediaUrl(first);

  const firstRatio = mediaAspectRatios[first.url] ?? mediaAspectRatios[firstFeedUrl];
  const useNarrowFirstFrame = shouldUseNarrowVerticalFrame(firstRatio);
const firstMediaFrameWidth = isMobile
  ? "100%"
  : useNarrowFirstFrame
    ? "62%"
    : "100%";

const firstShellAspectRatio = isMobile
  ? getResponsiveMediaAspectRatio(firstRatio)
  : useNarrowFirstFrame
    ? "1 / 0.84"
    : "16 / 10";

  return (
    <div>
      <div
style={{
  position: "relative",
  width: "100%",
  aspectRatio: firstShellAspectRatio,
  borderRadius: 12,
  overflow: "hidden",
  background: "#000",
}}
      >
        <button
          type="button"
          onClick={() => openMedia(first)}
          aria-label={
            first.type === "video"
              ? "Reproducir video de la publicación"
              : "Abrir imagen de la publicación"
          }
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "50%",
            width: firstMediaFrameWidth,
            transform: "translateX(-50%)",
            border: "none",
            padding: 0,
            background: "#000",
            cursor: first.isPlaceholder ? "default" : "pointer",
            display: "block",
            overflow: "hidden",
            borderRadius: isMobile ? 12 : 12,
            WebkitTapHighlightColor: "transparent",
            ...(premiumState.isBlocked ? { filter: "blur(10px)", opacity: 0.72 } : {}),
          }}
        >
          {renderMediaContent(first, 0, "eager", true)}
        </button>

        {premiumState.isBlocked && first.type === "video" && (() => {
          const durationLabel = formatMediaDuration(first.duration);
          return (
            <>
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 5,
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
                    background: "rgba(124,58,237,0.28)",
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
                    zIndex: 5,
                    minHeight: 20,
                    padding: "3px 7px",
                    borderRadius: 6,
                    background: "rgba(124,58,237,0.48)",
                    border: "1px solid rgba(255,255,255,0.18)",
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
        })()}
      </div>
    </div>
  );
}

      return (
        <div>
   <div
  ref={carouselShellRef}
  style={{
    position: "relative",
    width: "100%",
    aspectRatio: carouselShellAspectRatio,
    borderRadius: 12,
    overflow: "hidden",
    background: "#000",
    touchAction: isMobile ? "pan-y" : "auto",
    overscrollBehavior: isMobile ? "contain" : "auto",
    clipPath: "inset(0 round 12px)",
    WebkitClipPath: "inset(0 round 12px)",
    transform: "translateZ(0)",
  }}
>
            <div
style={{
  position: "absolute",
  inset: 0,
  display: "flex",
  width: `${totalMedia * 100}%`,
  transform: `translateX(calc(-${activeMediaIndex * (100 / totalMedia)}% + ${carouselDragOffsetX}px))`,
  transition: carouselIsDragging
    ? "none"
    : "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)",
  willChange: "transform",
  ...(premiumState.isBlocked ? { filter: "blur(10px)", opacity: 0.72, clipPath: "inset(0)" } : {}),
}}
            >
              {displayMedia.map((media, index) => (
                <div
                  key={`${media.url}-${index}`}
style={{
  position: "relative",
  width: `${100 / totalMedia}%`,
  height: "100%",
  flex: `0 0 ${100 / totalMedia}%`,
  overflow: "hidden",
  background: "#000",
  touchAction: "pan-y",
}}
                >
                  <button
                    type="button"
                    onClick={() => openMedia(media)}
                    aria-label={
                      media.type === "video"
                        ? `Reproducir video ${index + 1} de ${totalMedia}`
                        : `Abrir imagen ${index + 1} de ${totalMedia}`
                    }
style={{
  position: "absolute",
  top: 0,
  bottom: 0,
  left: "50%",
  width: getCarouselMediaFrameWidth(media),
  transform: "translateX(-50%) translateZ(0)",
  border: "none",
  padding: 0,
  background: "#000",
  cursor: media.isPlaceholder ? "default" : "pointer",
  display: "block",
  overflow: "hidden",
  borderRadius: 12,
  clipPath: "inset(0 round 12px)",
  WebkitClipPath: "inset(0 round 12px)",
  WebkitTapHighlightColor: "transparent",
  isolation: "isolate",
  touchAction: "pan-y",
}}
                  >
                    {renderMediaContent(
                      media,
                      index,
                      Math.abs(index - activeMediaIndex) <= 1 ? "eager" : "lazy"
                    )}
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                goToPreviousMedia();
              }}
              aria-label="Ver archivo anterior"
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 10,
width: 30,
height: 30,
background: "rgba(0,0,0,0.48)",
display: isMobile ? "none" : "flex",
alignItems: "center",
justifyContent: "center",
fontSize: 22,
lineHeight: "30px",
padding: "0 0 2px 0",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              ‹
            </button>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                goToNextMedia();
              }}
              aria-label="Ver siguiente archivo"
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 10,
width: 30,
height: 30,
background: "rgba(0,0,0,0.48)",
display: isMobile ? "none" : "flex",
alignItems: "center",
justifyContent: "center",
fontSize: 22,
lineHeight: "30px",
padding: "0 0 2px 0",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              ›
            </button>

            {premiumState.isBlocked && activeMedia.type === "video" && (() => {
              const durationLabel = formatMediaDuration(activeMedia.duration);
              return (
                <>
                  <div
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 5,
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
                        background: "rgba(124,58,237,0.28)",
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
                        zIndex: 5,
                        minHeight: 20,
                        padding: "3px 7px",
                        borderRadius: 6,
                        background: "rgba(124,58,237,0.48)",
                        border: "1px solid rgba(255,255,255,0.18)",
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
            })()}
          </div>

          <div
            aria-label={`Archivo ${activeMediaIndex + 1} de ${totalMedia}`}
            style={{
              marginTop: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: totalMedia <= 5 ? totalMedia * 12 : 60,
                overflow: "hidden",
                display: "flex",
                justifyContent: "flex-start",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  transform: `translateX(${getMediaDotsTranslateX()}px)`,
                  transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                  willChange: "transform",
                }}
              >
                {displayMedia.map((_, dotIndex) => {
                  const isActive = dotIndex === activeMediaIndex;

                  return (
                    <button
                      key={dotIndex}
                      type="button"
                      onClick={() => setActiveMediaIndex(dotIndex)}
                      aria-label={`Ver archivo ${dotIndex + 1}`}
                      style={{
                        width: 12,
                        height: 12,
                        minWidth: 12,
                        borderRadius: 999,
                        border: "none",
                        padding: 0,
                        background: "transparent",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: isActive ? 7 : 5,
                          height: isActive ? 7 : 5,
                          borderRadius: 999,
                          background: isActive
                            ? "#7c3aed"
                            : "rgba(255,255,255,0.34)",
                          transition:
                            "width 160ms ease, height 160ms ease, background 160ms ease",
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      );
    })()}
  </div>
)}
{premiumState.isPremium && (
  <PremiumPostPanel
    state={premiumState}
    onOpenPayment={() => setPaymentPanelOpen(true)}
  />
)}
<PostPaymentPanel
  open={paymentPanelOpen}
  post={post}
  currentUserId={currentUserId}
  isMobile={isMobile}
  onPay={applyTempUnlock}
  onClose={() => setPaymentPanelOpen(false)}
/>
{editModalOpen && (
  <GroupPostComposer
    editPost={post}
    onEditClose={() => setEditModalOpen(false)}
    onSubmit={handleEditSubmit}
    contextType={post.contextType as "group" | "profile"}
    groupVisibility={post.groupVisibility}
    isOwner={isOwner}
  />
)}
{liveEditOpen && (
  <LiveComposerModal
    open={liveEditOpen}
    onClose={() => setLiveEditOpen(false)}
    editPost={post}
    onEdited={(newLiveData) => setLocalLiveData(newLiveData)}
    contextType={post.contextType as "group" | "profile"}
    groupId={post.groupId}
    profileId={post.profileId}
    groupVisibility={post.groupVisibility}
  />
)}
{liveSetupOpen && (
  <LiveStreamSetup
    open={liveSetupOpen}
    onClose={() => setLiveSetupOpen(false)}
    postId={post.id}
    liveStreamId={activeLiveData?.liveStreamId}
    onStreamCreated={(liveStreamId, playbackId) => {
      setLocalLiveData((prev) => ({
        ...(prev ?? post.liveData ?? {}),
        liveStreamId,
        playbackId: playbackId ?? null,
        ingestUrl: "rtmps://global-live.mux.com:443/app",
        streamProvider: "mux",
      }));
    }}
  />
)}
{liveViewerOpen && (
  <LiveViewerModal
    open={liveViewerOpen}
    onClose={() => setLiveViewerOpen(false)}
    post={{ ...post, liveData: activeLiveData ?? post.liveData }}
    onManage={currentUserId === post.authorId ? () => { setLiveViewerOpen(false); setLiveCreatorOpen(true); } : undefined}
    initialPortrait={isLivePortrait}
  />
)}
{liveCreatorOpen && (
  <LiveCreatorPanel
    open={liveCreatorOpen}
    onClose={() => setLiveCreatorOpen(false)}
    post={{ ...post, liveData: activeLiveData ?? post.liveData }}
  />
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
  aria-pressed={optimisticViewerHasFlamed}
  aria-label={
    optimisticViewerHasFlamed
      ? "Quitar flamita de la publicación"
      : "Dar flamita a la publicación"
  }
  style={flameButtonStyle}
>
  <span aria-hidden="true" style={flameIconStyle}>
    <VibraFlameIcon active={optimisticViewerHasFlamed} size={22} premium={post.premium?.enabled === true} />
  </span>
</button>

      <button
        type="button"
        onClick={handleOpenFlamesPanel}
        style={flameCountButtonStyle}
        aria-label="Ver usuarios que dieron flamita"
      >
       {optimisticLikesCount}
      </button>
    </div>

    <button
      type="button"
      onClick={isMobile ? handleOpenCommentsPanel : handleToggleCommentsDesktop}
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
<span aria-hidden="true">
  <VibraCommentIcon size={18} color="rgba(255,255,255,0.88)" />
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
  count={optimisticSavesCount}
  saved={optimisticViewerHasSaved}
  loading={false}
  disabled={false}
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
</div>

      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <style>{`
              @keyframes vbActionsMenuFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes vbActionsMenuScaleIn {
                from { opacity: 0; transform: scale(0.94); }
                to { opacity: 1; transform: scale(1); }
              }
              @keyframes vbActionsMenuSlideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
              }
            `}</style>

            {/* Backdrop */}
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 99990,
                background: "rgba(0,0,0,0.50)",
                animation: "vbActionsMenuFadeIn 0.18s ease",
              }}
              onClick={() => setMenuOpen(false)}
            />

            {isMobile ? (
              /* ── Mobile: bottom sheet ── */
              <div
                ref={menuPanelRef}
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
                  animation: "vbActionsMenuSlideUp 0.30s ease",
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

                {availableActions.map((action, index) => {
                  const isSocialAction = action === "block_user" || action === "unblock_user";
                  const isGroupMemberBlockAction = action === "block_in_group" || action === "unblock_in_group";
                  const isDanger =
                    action === "ban" || action === "remove" || action === "delete_post" ||
                    action === "block_user" || action === "block_in_group";
                  const isBusy =
                    moderationBusy || deleting || pinBusy ||
                    (isSocialAction && socialRelationshipLoading) ||
                    (isGroupMemberBlockAction && groupMemberBlockLoading);

                  return (
                    <button
                      key={action}
                      type="button"
                      role="menuitem"
                      disabled={isBusy}
                      onClick={() => handleModerationAction(action)}
                      style={{
                        ...menuItemStyle,
                        minHeight: 50,
                        fontSize: 14.5,
                        padding: "12px 16px",
                        borderTop: index > 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
                        ...(isBusy ? { color: "rgba(255,255,255,0.35)", cursor: "not-allowed" } : {}),
                        ...(isDanger && !isBusy ? { color: "#ff8a8a" } : {}),
                      }}
                    >
                      {isBusy ? "Procesando..." : buildActionLabel(action)}
                    </button>
                  );
                })}
              </div>
            ) : (
              /* ── Desktop: centered modal ── */
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
                  ref={menuPanelRef}
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
                    animation: "vbActionsMenuScaleIn 0.18s ease",
                  }}
                >
                  {availableActions.map((action, index) => {
                    const isSocialAction = action === "block_user" || action === "unblock_user";
                    const isGroupMemberBlockAction = action === "block_in_group" || action === "unblock_in_group";
                    const isDanger =
                      action === "ban" || action === "remove" || action === "delete_post" ||
                      action === "block_user" || action === "block_in_group";
                    const isBusy =
                      moderationBusy || deleting || pinBusy ||
                      (isSocialAction && socialRelationshipLoading) ||
                      (isGroupMemberBlockAction && groupMemberBlockLoading);

                    return (
                      <button
                        key={action}
                        type="button"
                        role="menuitem"
                        disabled={isBusy}
                        onClick={() => handleModerationAction(action)}
                        style={{
                          ...menuItemStyle,
                          minHeight: 42,
                          fontSize: 13.5,
                          padding: "10px 16px",
                          borderTop: index > 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
                          ...(isBusy ? { color: "rgba(255,255,255,0.35)", cursor: "not-allowed" } : {}),
                          ...(isDanger && !isBusy ? { color: "#ff8a8a" } : {}),
                        }}
                      >
                        {isBusy ? "Procesando..." : buildActionLabel(action)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>,
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
        {selectedMediaUrl === null && (
        <PostCommentsPanel
          open={commentsPanelOpen}
          isMobile={isMobile}
          postId={post.id}
          groupId={effectiveGroupId}
          comments={comments}
          loading={loadingComments}
          currentUserId={currentUserId}
          isOwner={isOwner}
          isModerator={isModerator}
          canCommentOnPosts={effectiveCanCommentOnPosts && !premiumState.isBlocked}
          commentBlockedMessage={commentBlockedMessage}
          commentText={commentText}
          creatingComment={creatingComment}
          deletingCommentId={deletingCommentId}
          inlineError={premiumState.isBlocked ? null : inlineActionError}
          canUseGroupMemberBlock={canUseGroupMemberBlock}
          canModerateGroupAuthor={canModerateGroupAuthor}
          isPostAuthor={!!currentUserId && currentUserId === postAuthor.authorId}
          visibleCount={isMobile ? undefined : desktopVisibleCount}
          hasMore={!isMobile && comments !== null && comments.length > desktopVisibleCount}
          onLoadMore={isMobile ? undefined : () => setDesktopVisibleCount((c) => c + 5)}
          onCloseDesktop={!isMobile ? handleToggleCommentsDesktop : undefined}
          onCommentTextChange={setCommentText}
          onClose={() => setCommentsPanelOpen(false)}
          onCreateComment={handleCreateComment}
          onDeleteComment={handleDeleteComment}
          onLoadReplies={onLoadReplies}
          onCreateReply={onCreateReply}
          onDeleteReply={onDeleteReply}
          onGroupMemberBlockComplete={async () => {
            setComments(null);
            await onGroupMemberBlockComplete?.();
          }}
          onModerationComplete={async () => {
            await onModerationComplete?.();
          }}
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
  likesCount={optimisticLikesCount}
  viewerHasFlamed={optimisticViewerHasFlamed}
  commentsCount={visibleCommentsTotal}
  flameBusy={flameBusy}
  commentsContent={
    <PostCommentsPanel
      open={selectedMediaUrl !== null}
      isMobile={false}
      postId={post.id}
      groupId={effectiveGroupId}
      comments={comments}
      loading={loadingComments}
      currentUserId={currentUserId}
      isOwner={isOwner}
      isModerator={isModerator}
      canCommentOnPosts={canCommentOnPosts && !premiumState.isBlocked}
      commentBlockedMessage={commentBlockedMessage}
      commentText={commentText}
      creatingComment={creatingComment}
      deletingCommentId={deletingCommentId}
      inlineError={premiumState.isBlocked ? null : inlineActionError}
      canUseGroupMemberBlock={canUseGroupMemberBlock}
      canModerateGroupAuthor={canModerateGroupAuthor}
      isPostAuthor={!!currentUserId && currentUserId === postAuthor.authorId}
      onCommentTextChange={setCommentText}
      onClose={() => setCommentsPanelOpen(false)}
      onCreateComment={handleCreateComment}
      onDeleteComment={handleDeleteComment}
      onLoadReplies={onLoadReplies}
      onCreateReply={onCreateReply}
      onDeleteReply={onDeleteReply}
      onGroupMemberBlockComplete={async () => {
        setComments(null);
        await onGroupMemberBlockComplete?.();
      }}
      onModerationComplete={async () => {
        await onModerationComplete?.();
      }}
    />
  }
  mobileSheetCommentsContent={
    <PostCommentsPanel
      open={selectedMediaUrl !== null}
      isMobile={false}
      inline={true}
      postId={post.id}
      groupId={effectiveGroupId}
      comments={comments}
      loading={loadingComments}
      currentUserId={currentUserId}
      isOwner={isOwner}
      isModerator={isModerator}
      canCommentOnPosts={canCommentOnPosts && !premiumState.isBlocked}
      commentBlockedMessage={commentBlockedMessage}
      commentText={commentText}
      creatingComment={creatingComment}
      deletingCommentId={deletingCommentId}
      inlineError={premiumState.isBlocked ? null : inlineActionError}
      canUseGroupMemberBlock={canUseGroupMemberBlock}
      canModerateGroupAuthor={canModerateGroupAuthor}
      isPostAuthor={!!currentUserId && currentUserId === postAuthor.authorId}
      onCommentTextChange={setCommentText}
      onClose={() => setCommentsPanelOpen(false)}
      onCreateComment={handleCreateComment}
      onDeleteComment={handleDeleteComment}
      onLoadReplies={onLoadReplies}
      onCreateReply={onCreateReply}
      onDeleteReply={onDeleteReply}
      onGroupMemberBlockComplete={async () => {
        setComments(null);
        await onGroupMemberBlockComplete?.();
      }}
      onModerationComplete={async () => {
        await onModerationComplete?.();
      }}
    />
  }
  onClose={closeMediaViewer}
  onToggleFlame={handleToggleFlame}
  onOpenFlames={handleOpenFlamesPanel}
  onOpenComments={() => {
    void handleOpenCommentsPanel();
  }}
  onToggleSave={handleToggleSave}
  isSaved={optimisticViewerHasSaved}
  saveBusy={saveBusy}
  savesCount={optimisticSavesCount}
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