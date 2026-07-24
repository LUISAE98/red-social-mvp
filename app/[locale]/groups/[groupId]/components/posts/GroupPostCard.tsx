//GroupPostCard.tsx

"use client";

import Image from "next/image";
import Hls from "hls.js";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslations, useLocale } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { createPortal } from "react-dom";
import type { Comment, CommentMention, CommentReply, Post, PostLiveData, PostPlayback } from "@/lib/posts/types";
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
import PremiumVideoTeaser from "./PremiumVideoTeaser";
import { VideoPlayIcon } from "@/app/components/VibraServiceIcons/VibraVideoIcons";
import { usePostTempUnlock } from "@/lib/posts/usePostTempUnlock";
import { checkLiveAccess } from "@/lib/liveAccess/live-access-service";
import { fetchPostFlameUsers, registerPostView, updatePost } from "@/lib/posts/post-service";
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
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import { resolvePostPremiumState } from "@/lib/posts/post-premium-state";
import type { PostAccess } from "@/lib/posts/post-access-types";
import { getOrCreateGuestId } from "@/lib/guest-id";
import { useReport } from "@/lib/moderation/useReport";
import ReportModal from "@/app/components/ReportModal/ReportModal";
import {
  type InteractionBlockedReason,
  type ModerationAction,
  formatExactDate,
  formatRelativeDate,
  formatScheduledLiveDate,
  formatMediaDuration,
  getAuthorInfo,
  getGroupInfo,
  getCommunityVisibilityLabel,
  resolveEffectiveMemberStatus,
  buildCommentBlockedMessage,
  truncatePostText,
  buildActionLabel,
  getMenuActionTexts,
  buildPremiumPreviewClips,
  fontStack,
} from "./GroupPostCard.utils";
import {
  PremiumPostPanel,
  LiveTicketPanel,
  Avatar,
  MediaGridVideoItem,
  type MediaGridVideoItemHandle,
} from "./GroupPostCard.components";

type GroupPostCardProps = {
  post: Post & {
    authorMemberStatus?: "active" | "muted" | "banned" | "removed" | null;
    authorMutedUntil?: unknown;
    forcedGroupId?: string | null;
  };
  groupId?: string | null;
  canDelete?: boolean;
  onDelete?: (postId: string) => Promise<void>;
  onLoadComments: (postId: string) => Promise<Comment[]>;
  onCreateComment: (
    postId: string,
    text: string,
    mentions?: CommentMention[]
  ) => Promise<Comment[]>;
  onDeleteComment: (postId: string, commentId: string) => Promise<Comment[]>;
  onLoadReplies: (postId: string, commentId: string) => Promise<CommentReply[]>;
  onCreateReply: (
    postId: string,
    commentId: string,
    text: string,
    mentions?: CommentMention[]
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
  showDeletedBanner?: boolean;
  /** Acción extra en la barra inferior, justo antes del botón de guardar. */
  beforeSaveAction?: ReactNode;
  /** Acción extra en el header, a la izquierda del menú de 3 puntos
   *  (lo usa el descubrimiento para el botón Seguir/Unirme). */
  beforeMenuAction?: ReactNode;
  /** Post sugerido (descubrimiento): habilita el menú de "no me interesa"
   *  (ocultar / reportar / bloquear al autor) aun en posts de comunidad. */
  suggestionMode?: boolean;
  /** Callback tras ocultar/reportar/bloquear un post sugerido: el padre lo
   *  remueve del feed y alimenta el algoritmo con la señal negativa. */
  onHidePost?: (reason: "hide" | "report" | "block") => void;
  /**
   * Modo "solo visor" para el lightbox de galerías: al montar, abre
   * automáticamente el visor de medios en esta URL. El cuerpo de la tarjeta se
   * oculta desde el padre (contenedor 0×0); solo se muestran los portales
   * (visor, menú, modales) que van a document.body.
   */
  autoOpenMediaUrl?: string | null;
  /** Como autoOpenMediaUrl pero abre el visor de la transmisión en vivo. */
  autoOpenLive?: boolean;
  /** Abre el VOD (grabación de una transmisión) usando la URL HLS interna del card. */
  autoOpenVod?: boolean;
  /** Abre el flujo de desbloqueo/compra (panel de pago premium o ticket de live/VOD). */
  autoOpenUnlock?: boolean;
  /** Se dispara al desbloquear (comprar) el post — para que la galería lo refleje. */
  onPostUnlocked?: (postId: string) => void;
  /** Trata el post como ya desbloqueado desde el montaje (la galería sabe que el
   *  viewer tiene acceso) — evita el race con la carga async de isTempUnlocked. */
  forceUnlocked?: boolean;
  /** Se dispara cuando el visor auto-abierto se cierra (para desmontar el lightbox). */
  onViewerClosed?: () => void;
  /** Deep-link de notificaciones: al montar abre el panel de comentarios. */
  autoOpenComments?: boolean;
  /** Deep-link de notificaciones: comentario a enfocar (scroll + resaltado). */
  focusCommentId?: string | null;
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
  showDeletedBanner = false,
  beforeSaveAction = null,
  beforeMenuAction = null,
  suggestionMode = false,
  onHidePost,
  autoOpenMediaUrl = null,
  autoOpenLive = false,
  autoOpenVod = false,
  autoOpenUnlock = false,
  onPostUnlocked,
  forceUnlocked = false,
  onViewerClosed,
  autoOpenComments = false,
  focusCommentId = null,
}: GroupPostCardProps) {
  const tCommon = useTranslations("common");
  const tFeed = useTranslations("feed");
  const tGroups = useTranslations("groups");
  const tPosts = useTranslations("posts");
  const locale = useLocale();
  const priceFmt = usePriceFormat();

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [desktopVisibleCount, setDesktopVisibleCount] = useState(5);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentMentions, setCommentMentions] = useState<CommentMention[]>([]);
  const [creatingComment, setCreatingComment] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { reportTarget, openReport, closeReport } = useReport();
  const [menuClosing, setMenuClosing] = useState(false);
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressMenuCloseRef = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const [menuActionPhase, setMenuActionPhase] = useState<"idle" | "loading" | "done">("idle");
  const [menuActionTexts, setMenuActionTexts] = useState<{ loading: string; done: string } | null>(null);
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
  const [, setLoadedMediaUrls] = useState<Record<string, boolean>>({});
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
  // URL HLS del VOD (se asigna en render); la usa el auto-open de galería.
  const liveVodUrlRef = useRef<string | null>(null);
  const [liveCreatorOpen, setLiveCreatorOpen] = useState(false);
  const [liveTicketShake, setLiveTicketShake] = useState(false);
  const [hasLiveTicketAccess, setHasLiveTicketAccess] = useState(false);

  useEffect(() => {
    if (!post.requiresPayment || !currentUserId) return;
    checkLiveAccess(post.id, currentUserId)
      .then(setHasLiveTicketAccess)
      .catch(() => {});
  }, [post.id, post.requiresPayment, currentUserId, liveViewerOpen]);

  const [isLivePortrait, setIsLivePortrait] = useState(false);
  const [localLiveData, setLocalLiveData] = useState<PostLiveData | null | undefined>(post.liveData);
  const [localPlayback, setLocalPlayback] = useState<PostPlayback | null>(post.playback ?? null);
  const [feedLiveStream, setFeedLiveStream] = useState<MediaStream | null>(null);

  // Auto-abrir el live cuando inicia si el viewer ya tiene acceso (ticket pagado o miembro con acceso gratis)
  const prevIsLiveActiveRef = useRef(false);
  useEffect(() => {
    const nowActive = post.postType === "live" && (localLiveData ?? post.liveData)?.status === "live";
    const wasActive = prevIsLiveActiveRef.current;
    prevIsLiveActiveRef.current = nowActive;
    if (!nowActive || wasActive || !post.requiresPayment || isOwnPost || isOwner) return;
    const mode = (localLiveData ?? post.liveData)?.paidAccessMode ?? "everyone_pays";
    const isMemberFree = mode === "members_free_non_members_pay" && viewerIsMember;
    if (hasLiveTicketAccess || isMemberFree) {
      setLiveViewerOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localLiveData?.status, hasLiveTicketAccess]);
  const [localText, setLocalText] = useState<string | null>(null);
  const [localMedia, setLocalMedia] = useState<import("@/lib/posts/types").PostMedia[] | null>(null);
  const { isTempUnlocked, unlock: applyTempUnlock } = usePostTempUnlock(post.id, currentUserId, post.authorId, post.oneTimePrice);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string | null>(null);
  const [viewerSourceRect, setViewerSourceRect] = useState<DOMRect | null>(null);
  const [viewerInitialVideoTime, setViewerInitialVideoTime] = useState(0);
  const viewerVideoTimeRef = useRef(0);
  const mediaCurrentTimesRef = useRef<Record<string, number>>({});
  const mediaVideoHandlesRef = useRef<Map<string, MediaGridVideoItemHandle>>(new Map());
  const [viewerExternalVideo, setViewerExternalVideo] = useState<HTMLVideoElement | null>(null);
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

// Real-time listener for live status changes (driven by Mux/CF webhooks)
useEffect(() => {
  if (post.postType !== "live" || !post.id) return;
  const currentStatus = localLiveData?.status ?? post.liveData?.status;
  // Stop subscription only when definitively done: cancelled, or ended+VOD ready
  if (currentStatus === "cancelled") return;
  const alreadyHasVod = !!(post.playback?.hlsUrl ?? ((localLiveData ?? post.liveData)?.vodStatus === "ready" ? (localLiveData ?? post.liveData)?.hlsUrl : null));
  if (currentStatus === "ended" && alreadyHasVod) return;

  const unsubscribe = onSnapshot(
    doc(db, "posts", post.id),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const newLiveData = data?.liveData as PostLiveData | undefined;
      if (newLiveData) setLocalLiveData(newLiveData);
      if (data?.playback) setLocalPlayback(data.playback as PostPlayback);
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

  const closeMenu = useCallback(() => {
    if (suppressMenuCloseRef.current) return;
    if (menuCloseTimerRef.current !== null) return;
    setMenuClosing(true);
    menuCloseTimerRef.current = setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
      menuCloseTimerRef.current = null;
    }, 360);
  }, []);
  const flameUsersCacheRef = useRef<Record<string, PostFlameUser[]>>({});
  const flameServerStateRef = useRef(post.viewerHasFlamed === true);
  const flamePendingRef = useRef<boolean | null>(null);
  const flameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveServerStateRef = useRef(post.viewerHasSaved === true);
  const savePendingRef = useRef<boolean | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const feedHlsRef = useRef<Hls | null>(null);
  const feedVideoShellRef = useRef<HTMLDivElement | null>(null);
  const premiumClipIndexRef = useRef<number>(0);
  const premiumClipsRef = useRef<Array<{ start: number; end: number }>>([]);

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
        closeMenu();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
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
      post.authorMemberStatus ?? null,
      post.authorMutedUntil ?? null
    );
  }, [post]);

  const authorStatusBadge = useMemo(() => {
    if (effectiveAuthorStatus === "banned") {
      return {
        text: tGroups("statusBanned"),
        border: "1px solid rgba(255,70,70,0.34)",
        background: "rgba(255,70,70,0.14)",
        color: "#ff8a8a",
      };
    }

    if (effectiveAuthorStatus === "muted") {
      return {
        text: tGroups("statusMuted"),
        border: "1px solid rgba(245,166,35,0.34)",
        background: "rgba(245,166,35,0.14)",
        color: "#ffd48a",
      };
    }

    if (effectiveAuthorStatus === "removed") {
      return {
        text: tGroups("statusRemoved"),
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

  // Un post de perfil se distingue por NO tener groupId (además del contextType,
  // que no siempre viaja en el objeto que arma el feed de perfil).
  const isProfilePost =
    (post as unknown as { contextType?: string | null }).contextType === "profile" ||
    !(post as unknown as { groupId?: string | null }).groupId;

  const socialTargetUserId =
    (isProfilePost || suggestionMode) && !isOwnPost && postAuthor.authorId
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
    (isProfilePost || suggestionMode) &&
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

    if (
      suggestionMode &&
      !!onHidePost &&
      !!currentUserId &&
      post.authorId !== currentUserId
    ) {
      actions.push("hide_post");
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
    suggestionMode,
    onHidePost,
    canDelete,
    onDelete,
  ]);


  function openMediaViewer(mediaUrl: string | null, rect?: DOMRect | null) {
    if (!mediaUrl) return;
    if (premiumState.isBlocked) return;

    setViewerSourceRect(rect ?? null);

    const rootVideo = videoRef.current;
    const isRootVideo = mediaUrl === videoPlaybackUrl || mediaUrl === videoThumbnailUrl;

    if (isRootVideo && rootVideo) {
      setViewerInitialVideoTime(rootVideo.currentTime);
      viewerVideoTimeRef.current = rootVideo.currentTime;
      rootVideo.pause();
      setViewerExternalVideo(null);
    } else {
      const handle = mediaVideoHandlesRef.current.get(mediaUrl);
      const videoEl = handle?.getVideoElement() ?? null;
      setViewerInitialVideoTime(0);
      viewerVideoTimeRef.current = 0;
      setViewerExternalVideo(videoEl);
    }

    setSelectedMediaUrl(mediaUrl);
    // Lee el viewport en vivo: el auto-open del lightbox puede correr antes de que
    // el estado `isMobile` se estabilice (arranca en false). En móvil NO se
    // auto-abre el panel de comentarios de escritorio sobre el visor. Usa 900px
    // (mismo breakpoint móvil que el layout y las galerías); con 640px, los
    // dispositivos/viewports de 641–900px caían en "escritorio" y sí lo abrían.
    const isMobileNow =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches;
    if (!isMobileNow) void handleOpenCommentsPanel();

    // Vista única del viewer para videos/VODs (no cuenta fotos).
    const postHasVideo =
      post.postType === "live" ||
      post.liveData != null ||
      (Array.isArray(post.media) && post.media.some((m) => m.type === "video"));
    if (postHasVideo) void registerPostView(post.id);
  }

  function closeMediaViewer() {
    // Move grid video back to its feed slot BEFORE React state updates unmount the viewer slot
    if (selectedMediaUrl && viewerExternalVideo) {
      const handle = mediaVideoHandlesRef.current.get(selectedMediaUrl);
      const feedSlot = handle?.getFeedSlot();
      if (feedSlot && viewerExternalVideo) {
        viewerExternalVideo.style.objectFit = "cover";
        feedSlot.appendChild(viewerExternalVideo);
      }
    }

    setViewerExternalVideo(null);

    // Root video: restore viewer position
    const resumeTime = viewerVideoTimeRef.current;
    const isRootVideo = selectedMediaUrl === videoPlaybackUrl || selectedMediaUrl === videoThumbnailUrl;
    if (resumeTime > 0 && isRootVideo && videoRef.current) {
      videoRef.current.currentTime = resumeTime;
    }

    viewerVideoTimeRef.current = 0;
    setSelectedMediaUrl(null);
    setCommentsPanelOpen(false);
    // Modo lightbox de galería: avisa al padre para desmontar la tarjeta headless.
    if (onViewerClosed) window.setTimeout(() => onViewerClosed(), 280);
  }

  // Lightbox de galerías: al montar en modo headless, abre el visor solo.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (autoOpenUnlock) {
      // Flujo de desbloqueo/compra: panel de pago (premium) o ticket vía live viewer.
      autoOpenedRef.current = true;
      if (post.premium?.enabled === true) setPaymentPanelOpen(true);
      else setLiveViewerOpen(true);
    } else if (autoOpenLive) {
      // Transmisión en curso → modal de live.
      autoOpenedRef.current = true;
      setLiveViewerOpen(true);
    } else if (autoOpenVod) {
      // VOD → visor de medios con la URL HLS del VOD (igual que el feed).
      autoOpenedRef.current = true;
      const vodUrl = liveVodUrlRef.current ?? autoOpenMediaUrl;
      // Si no hay grabación reproducible o el contenido está bloqueado (de pago
      // sin comprar — flujo de ticket pendiente), se desmonta el lightbox.
      if (vodUrl && !premiumState.isBlocked) openMediaViewer(vodUrl, null);
      else onViewerClosed?.();
    } else if (autoOpenMediaUrl) {
      autoOpenedRef.current = true;
      if (!premiumState.isBlocked) openMediaViewer(autoOpenMediaUrl, null);
      else onViewerClosed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenMediaUrl, autoOpenLive, autoOpenVod, autoOpenUnlock]);

  // Deep-link de notificaciones: al montar, abre el panel de comentarios.
  const autoOpenedCommentsRef = useRef(false);
  useEffect(() => {
    if (autoOpenedCommentsRef.current) return;
    if (!autoOpenComments) return;
    autoOpenedCommentsRef.current = true;
    void handleOpenCommentsPanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenComments]);

  // Deep-link: asegura que el comentario enfocado quede dentro del slice visible
  // de escritorio (los comentarios se cargan enteros; solo hay que revelarlo).
  useEffect(() => {
    if (!focusCommentId || comments === null) return;
    const idx = comments.findIndex((c) => c.id === focusCommentId);
    if (idx >= 0) {
      setDesktopVisibleCount((c) => Math.max(c, comments.length - idx));
    }
  }, [focusCommentId, comments]);

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
  } catch (e: unknown) {
    setFlameUsersError((e instanceof Error ? e.message : null) ?? tFeed("errorLoadFlames"));
  } finally {
    setLoadingFlameUsers(false);
  }
}

function handleToggleFlame() {
  if (!currentUserId) {
    setInlineActionError(tCommon("loginToLike"));
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
    } catch (e: unknown) {
      setOptimisticViewerHasFlamed(flameServerStateRef.current);
      setOptimisticLikesCount(post.counts?.likes ?? 0);
      setInlineActionError((e instanceof Error ? e.message : null) ?? tFeed("errorUpdateFlame"));
    } finally {
      setFlameBusy(false);
    }
  }, 400);
}

function handleToggleSave() {
  if (!currentUserId) {
    setInlineActionError(tCommon("loginToSave"));
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
    } catch (e: unknown) {
      setOptimisticViewerHasSaved(saveServerStateRef.current);
      setOptimisticSavesCount(post.counts?.saves ?? 0);
      setInlineActionError((e instanceof Error ? e.message : null) ?? tFeed("errorUpdateSave"));
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
  } catch (e: unknown) {
    const rawMsg: string = (e instanceof Error ? e.message : null) ?? "";
    if (rawMsg.toLowerCase().includes("permission")) {
      setInlineActionError(
        !currentUserId
          ? tCommon("loginToComment")
          : tFeed("membersOnlyComments")
      );
    } else {
      setInlineActionError(rawMsg || tFeed("errorLoadComments"));
    }
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

  // En posts de comunidad oculta la etiquetación con @ se deshabilita por
  // completo (no exponer perfiles/comunidades desde un contexto oculto).
  const mentionsDisabled = post.groupVisibility === "hidden";

  async function handleCreateComment() {
    if (premiumState.isBlocked) {
      setInlineActionError(
        currentUserId
          ? tFeed("unlockToComment")
          : tCommon("loginToComment")
      );
      return;
    }
    if (!effectiveCanCommentOnPosts) {
      setInlineActionError(buildCommentBlockedMessage(commentBlockedReason, isProfilePost));
      return;
    }

    if (creatingComment || commentText.trim().length === 0) return;

    try {
      setCreatingComment(true);
      setInlineActionError(null);
      const nextComments = await onCreateComment(
        post.id,
        commentText.trim(),
        mentionsDisabled ? [] : commentMentions
      );
      setComments(nextComments);
      setCommentText("");
      setCommentMentions([]);
    } catch (e: unknown) {
      const message = (e instanceof Error ? e.message : null) ?? tFeed("errorComment");
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
      closeMenu();
    } catch (e: unknown) {
      setInlineActionError(
        (e instanceof Error ? e.message : null) ??
          (scope === "group"
            ? tPosts("pinGroupError")
            : tPosts("pinProfileError"))
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
      closeMenu();
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

      closeMenu();
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
      closeMenu();
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
      closeMenu();
      await blockPostAuthor();
      // Descubrimiento: además del bloqueo (Firestore, cross-device), alimenta la
      // señal negativa local y remueve el post sugerido al instante.
      onHidePost?.("block");
    } catch (e: unknown) {
      setInlineActionError((e instanceof Error ? e.message : null) ?? tCommon("errorBlockProfile"));
    }
  }

  async function handleUnblockPostAuthor() {
    if (socialRelationshipLoading) return;

    try {
      setInlineActionError(null);
      closeMenu();
      await unblockPostAuthor();
    } catch (e: unknown) {
      setInlineActionError((e instanceof Error ? e.message : null) ?? tCommon("errorUnblockProfile"));
    }
  }

  async function handleBlockPostAuthorInGroup() {
    if (groupMemberBlockLoading) return;

    const confirmed = window.confirm(
      tGroups("confirmBlockInGroup")
    );

    if (!confirmed) return;

    try {
      setInlineActionError(null);
      closeMenu();
      setComments(null);
      await blockPostAuthorInGroup();
      await onGroupMemberBlockComplete?.();
    } catch (e: unknown) {
      setInlineActionError(
        (e instanceof Error ? e.message : null) ?? tGroups("errorBlockInGroup")
      );
    }
  }

  async function handleUnblockPostAuthorInGroup() {
    if (groupMemberBlockLoading) return;

    try {
      setInlineActionError(null);
      closeMenu();
      setComments(null);
      await unblockPostAuthorInGroup();
      await onGroupMemberBlockComplete?.();
    } catch (e: unknown) {
      setInlineActionError(
        (e instanceof Error ? e.message : null) ?? tGroups("errorUnblockInGroup")
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

  function startExitAnimation(afterMs = 460) {
    const el = cardRef.current;
    if (!el) {
      if (onDelete) onDelete(post.id).catch(() => {});
      return;
    }
    // Animar el wrapper (que incluye el paddingBottom de espaciado) para que
    // el collapse sea limpio y no quede un gap residual al eliminar el nodo.
    const target = el.parentElement ?? el;
    const h = target.getBoundingClientRect().height;
    target.style.height = `${h}px`;
    target.style.overflow = "hidden";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        target.style.transition =
          "height 400ms cubic-bezier(0.4,0,0.2,1) 40ms";
        target.style.height = "0px";
        el.style.transition = "opacity 260ms ease";
        el.style.opacity = "0";
      });
    });
    setTimeout(() => {
      if (onDelete) onDelete(post.id).catch(() => {});
    }, afterMs);
  }

  async function handleModerationAction(action: ModerationAction) {
    if (action === "edit_post") {
      closeMenu();
      // El modal de edición vive por debajo del viewer; si el menú se abrió
      // desde el viewer, hay que cerrarlo para que el editor sea visible.
      if (selectedMediaUrl !== null) closeMediaViewer();
      if (post.postType === "live") {
        setLiveEditOpen(true);
      } else {
        setEditModalOpen(true);
      }
      return;
    }

    if (action === "mute") {
      setMuteDays("7");
      if (selectedMediaUrl !== null) closeMediaViewer();
      setMuteModalOpen(true);
      closeMenu();
      return;
    }

    if (action === "hide_post") {
      closeMenu();
      onHidePost?.("hide");
      return;
    }

    if (action === "block_user") { await handleBlockPostAuthor(); return; }
    if (action === "unblock_user") { await handleUnblockPostAuthor(); return; }
    if (action === "block_in_group") { await handleBlockPostAuthorInGroup(); return; }
    if (action === "unblock_in_group") { await handleUnblockPostAuthorInGroup(); return; }

    const texts = getMenuActionTexts(action);
    if (!texts) return;

    suppressMenuCloseRef.current = true;
    setMenuActionTexts(texts);
    setMenuActionPhase("loading");

    // For delete: use optimistic UI — show the animation first, then actually
    // remove the post. This prevents the component from unmounting mid-animation
    // (onDelete removes the post from parent state, which would unmount this component).
    if (action === "delete_post") {
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 380));
        setMenuActionPhase("done");
        await new Promise<void>((resolve) => setTimeout(resolve, 1300));
      } finally {
        suppressMenuCloseRef.current = false;
        setMenuActionPhase("idle");
        setMenuActionTexts(null);
        closeMenu();
        startExitAnimation();
      }
      return;
    }

    try {
      if (action === "pin_group_post" || action === "unpin_group_post") {
        await handleTogglePin("group");
      } else if (action === "pin_profile_post" || action === "unpin_profile_post") {
        await handleTogglePin("profile");
      } else {
        await runModerationAction(action as "unmute" | "ban" | "unban" | "remove");
      }
      setMenuActionPhase("done");
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    } catch {
      // on error close immediately
    } finally {
      suppressMenuCloseRef.current = false;
      setMenuActionPhase("idle");
      setMenuActionTexts(null);
      closeMenu();
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

const imageGridStyle: CSSProperties = {
  marginTop: 12,
  display: "grid",
  gap: 8,
  width: "100%",
  maxWidth: "100%",
  marginLeft: 0,
  marginRight: 0,
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

function getContainedMediaScale(): number {
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
    <Image
      src={sourceUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      fill
      style={{ objectFit: "cover", filter: "blur(28px) saturate(1.08)", transform: "scale(1.14)", opacity: 0.34, pointerEvents: "none", zIndex: 0 }}
    />
  );
}
  const shouldShowActionsMenu = availableActions.length > 0;
  const isPinned =
    post.isPinnedInGroup === true || post.isPinnedOnProfile === true;

  const activeLiveData = localLiveData ?? post.liveData;

  const viewerGuestId = !currentUserId && typeof window !== "undefined" ? getOrCreateGuestId() : "";
  const isViewerBanned = !!(
    activeLiveData?.bannedUsers?.length &&
    (
      (currentUserId && activeLiveData.bannedUsers.includes(currentUserId)) ||
      (!currentUserId && viewerGuestId && activeLiveData.bannedUsers.includes(viewerGuestId))
    )
  );

  // VOD URL: Mux saves it in post.playback after stream ends; CF reuses liveData.hlsUrl when vodStatus=ready
  const effectivePlayback = localPlayback ?? post.playback;
  const liveVodUrl = activeLiveData?.status === "ended"
    ? (effectivePlayback?.hlsUrl ?? (activeLiveData?.vodStatus === "ready" ? (activeLiveData?.hlsUrl ?? null) : null))
    : null;
  liveVodUrlRef.current = liveVodUrl;
  const isCFLive = activeLiveData?.streamProvider === "cloudflare";
  // CF streams: VOD visible as soon as URL is ready. Mux: requires creator confirmation.
  const liveVodReady = !!liveVodUrl && (
    isCFLive
      ? true
      : activeLiveData?.vodSettingsConfirmed === true && !activeLiveData?.vodHidden
  );

  const isLiveActive = post.postType === "live" && activeLiveData?.status === "live";
  const livePaidAccessMode = activeLiveData?.paidAccessMode ?? "everyone_pays";
  // Miembros con acceso gratis: mode members_free_non_members_pay y el viewer es miembro (o dueño)
  const memberHasFreeAccess =
    post.requiresPayment === true &&
    livePaidAccessMode === "members_free_non_members_pay" &&
    (viewerIsMember || isOwner) &&
    !isOwnPost;
  const isLiveBlockedByTicket =
    isLiveActive &&
    post.requiresPayment === true &&
    !(isOwnPost || isOwner) &&
    !hasLiveTicketAccess &&
    !memberHasFreeAccess;
  const isLivePlayer = isLiveActive && !isLiveBlockedByTicket;
  const liveVisibilityMode = activeLiveData?.visibilityMode ?? null;

  const liveVisibilityBadge: { label: string; icon: "lock" | "globe" | "user" } | null =
    liveVisibilityMode === "members_only"
      ? { label: tPosts("visibilityMembersOnly"), icon: "lock" }
      : liveVisibilityMode === "logged_in_only"
        ? { label: tPosts("visibilityRegistered"), icon: "user" }
        : liveVisibilityMode === "everyone"
          ? { label: tPosts("visibilityPublic"), icon: "globe" }
          : null;

  const liveAccessBlocked =
    post.postType === "live" && (
      (liveVisibilityMode === "members_only" && !isOwner && !viewerIsMember) ||
      (liveVisibilityMode === "logged_in_only" && !currentUserId)
    );

  const liveAccessCtaText =
    liveVisibilityMode === "members_only"
      ? (currentUserId ? tFeed("joinToWatchLive") : tCommon("loginAndJoinToWatchLive"))
      : tCommon("loginToWatchLive");

  const premiumState = resolvePostPremiumState(
    {
      post,
      currentUserId,
      viewerIsMember: isOwner || viewerIsMember,
      viewerAccess:
        isTempUnlocked || forceUnlocked ? ({ status: "active" } as PostAccess) : null,
    },
    // Precio en la moneda del viewer (mismo hook que el resto de la UI).
    (price, currency) =>
      typeof price === "number" && price > 0
        ? priceFmt.format(price, { baseCurrency: currency })
        : null
  );

  // Comentar en un post premium exige lo MISMO que en cualquier otro
  // (`canCommentOnPosts`: miembro/owner + comentarios abiertos) Y además tener
  // acceso al contenido premium (no estar bloqueado). Antes se forzaba `true`
  // en premium desbloqueado, ignorando la restricción de comentarios y
  // desalineándose de las reglas (que sí exigen ambos gates) → "insufficient
  // permissions". Así queda estable e igual para todo tipo de post.
  const effectiveCanCommentOnPosts =
    canCommentOnPosts && !premiumState.isBlocked;

  const commentBlockedMessage =
    premiumState.isBlocked && !currentUserId
      ? tCommon("loginToComment")
      : premiumState.isBlocked
      ? tFeed("unlockToComment")
      : !effectiveCanCommentOnPosts
      ? buildCommentBlockedMessage(commentBlockedReason, isProfilePost)
      : null;

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
          altText: item.altText ?? tPosts("videoProcessing"),
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
        altText: item.altText ?? tPosts("videoAlt"),
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
// eslint-disable-next-line react-hooks/exhaustive-deps
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
              altText: tPosts("videoAlt"),
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
    post.postType !== "live" &&
    (post.postType === "video" || post.videoData != null || mediaVideoItems.length > 0);

  const hasReadyMediaVideos = mediaVideoItems.some(
    (item) => item.status === "ready" || Boolean(item.hlsUrl)
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

  // Set up HLS.js (required for Chrome — HLS .m3u8 is not natively supported).
  // Safari supports HLS natively via <video src>, so we skip hls.js there.
  // Runs when the video shell is in viewport range (shouldLoadFeedVideo = true).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoPlaybackUrl || !shouldLoadFeedVideo) return;

    // Destroy any previous instance
    feedHlsRef.current?.destroy();
    feedHlsRef.current = null;
    video.muted = true;

    const isHls = videoPlaybackUrl.includes(".m3u8");

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, startLevel: -1, maxBufferLength: 30 });
      feedHlsRef.current = hls;
      hls.loadSource(videoPlaybackUrl);
      hls.attachMedia(video);
    } else {
      // Safari native HLS or direct MP4
      video.src = videoPlaybackUrl;
    }

    return () => {
      feedHlsRef.current?.destroy();
      feedHlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [videoPlaybackUrl, shouldLoadFeedVideo]);

  // Autoplay muted: play when ≥50% visible, pause otherwise.
  // Re-runs after metadata loads (videoMetadataLoaded) so the observer reads the correct
  // intersection once the element switches from display:none to display:block.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoPlaybackUrl || !shouldLoadFeedVideo || !videoMetadataLoaded || selectedMediaUrl) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= 0.5) {
          video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: [0, 0.5] }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [videoPlaybackUrl, shouldLoadFeedVideo, videoMetadataLoaded, selectedMediaUrl]);

  // Premium preview clips: when blocked, cycle through short segments instead of playing the full video.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !premiumState.isBlocked || !videoMetadataLoaded || !shouldLoadFeedVideo) return;

    function handleTimeUpdate() {
      const clips = premiumClipsRef.current;
      if (clips.length === 0) return;
      const currentClip = clips[premiumClipIndexRef.current];
      if (!currentClip) return;
      if (video!.currentTime >= currentClip.end) {
        const nextIndex = (premiumClipIndexRef.current + 1) % clips.length;
        premiumClipIndexRef.current = nextIndex;
        video!.currentTime = clips[nextIndex]!.start;
      }
    }

    function handleEnded() {
      const clips = premiumClipsRef.current;
      if (clips.length === 0) return;
      premiumClipIndexRef.current = 0;
      video!.currentTime = clips[0]!.start;
      video!.play().catch(() => undefined);
    }

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("ended", handleEnded);
    };
  }, [premiumState.isBlocked, videoMetadataLoaded, videoPlaybackUrl, shouldLoadFeedVideo]);

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
    <article ref={cardRef} style={cardStyle}>
      {showDeletedBanner && post.isDeleted === true && (
        <div
          style={{
            background: "#1a0505",
            borderBottom: "1px solid rgba(239, 68, 68, 0.25)",
            margin: isMobile ? "-14px -12px 12px" : "-12px -12px 10px",
            padding: "6px 14px",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f87171" }}>Post eliminado</span>
            {post.deletedAt && (
              <span style={{ fontSize: 10, color: "rgba(239,68,68,0.65)", marginLeft: 6 }}>
                {post.deletedAt.toDate().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            )}
          </div>
        </div>
      )}
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
          <LiveRingAvatar
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
                    {tGroups(getCommunityVisibilityLabel(groupInfo.visibility))}
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
      ? tPosts("showRelativeDateLabel")
      : tPosts("showExactDateLabel")
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
    ? formatExactDate(post.liveData?.startedAt ?? post.createdAt, locale)
    : formatRelativeDate(post.liveData?.startedAt ?? post.createdAt, locale)}
  {(post.editedAt ?? localText !== null) ? (
    <span style={{ opacity: 0.45, fontStyle: "italic", marginLeft: 2 }}>
      {" · Editado"}
    </span>
  ) : null}
</button>

          </div>
        </div>

        {(isPinned || shouldShowActionsMenu || beforeMenuAction) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
            }}
          >
            {beforeMenuAction}
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
                <span>{tFeed("pinned")}</span>
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
                  aria-label={tPosts("openPostActions")}
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
      {tFeed("premiumPost")}
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

    {cleanPostText.length > 0 && (post.postType !== "live" || liveVodReady) && (
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
            {postTextExpanded ? `- ${tCommon("seeLess")}` : `+ ${tCommon("seeMore")}`}
          </button>
        )}
      </span>
    )}
  </div>
)}

{post.postType === "live" && (
  liveVodReady ? (
    // VOD listo: render as plain video post — no live chrome, no badge, no panel buttons
    <div style={{ marginTop: 10, position: "relative" }}>
      {/* Botón estadísticas — solo visible para el creador */}
      {currentUserId === post.authorId && (
        <button
          type="button"
          onClick={() => setLiveCreatorOpen(true)}
          style={{
            position: "absolute", top: 8, left: 8, zIndex: 10,
            height: 32, padding: "0 14px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg, #a855f7 0%, #d946b8 100%)",
            color: "#fff", fontWeight: 600, fontSize: 12,
            fontFamily: fontStack, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          {tFeed("openPanelStats")}
        </button>
      )}
      {premiumState.isBlocked ? (
        <div style={{
          position: "relative", width: "100%", aspectRatio: "16 / 9",
          background: "#000", borderRadius: 12, overflow: "hidden",
        }}>
          {/* Clips playing under blur — same visual as before */}
          <div style={{
            position: "absolute", inset: 0,
            filter: "blur(10px)", opacity: 0.72,
          }}>
            <PremiumVideoTeaser
              hlsUrl={liveVodUrl}
              thumbnailUrl={activeLiveData?.coverUrl ?? null}
            />
          </div>
          {/* Play icon — not affected by blur */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute", inset: 0, zIndex: 5,
              display: "grid", placeItems: "center", pointerEvents: "none",
            }}
          >
            <VideoPlayIcon size={50} color="#fff" />
          </div>
          {/* Duration badge */}
          {formatMediaDuration(post.playback?.duration ?? post.videoData?.duration) && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute", right: 8, bottom: 8, zIndex: 5,
                minHeight: 20, padding: "3px 7px", borderRadius: 6,
                background: "rgba(0,0,0,0.52)",
                backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
                color: "#fff", fontSize: 11, fontWeight: 700,
                lineHeight: 1, letterSpacing: "-0.01em",
              }}
            >
              {formatMediaDuration(post.playback?.duration ?? post.videoData?.duration)}
            </span>
          )}
        </div>
      ) : (
        <LiveInlinePlayer
          postId={post.id}
          hlsUrl={liveVodUrl!}
          title={activeLiveData?.title}
          coverUrl={activeLiveData?.coverUrl}
          portrait={isLivePortrait}
          isVod
          paused={liveViewerOpen || liveCreatorOpen}
          streamProvider={activeLiveData?.streamProvider ?? "mux"}
          onClick={() => openMediaViewer(liveVodUrl)}
          onOrientationDetected={(p) => { if (!liveCreatorOpen) setIsLivePortrait(p); }}
        />
      )}
    </div>
  ) : (
  // Portrait solo aplica cuando el live está activo/reproduciéndose
  <div style={(isLivePlayer && isLivePortrait) ? { display: "flex", justifyContent: "center", marginTop: 10 } : { marginTop: 10 }}>
    <div
      style={{
        width: (isLivePlayer && isLivePortrait) ? "min(280px, 100%)" : "100%",
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
          ...(isLivePlayer
            ? { bottom: 0, left: "50%", transform: "translateX(-50%)", borderTopLeftRadius: 8, borderTopRightRadius: 8 }
            : { top: 0, right: 10, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 }),
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: isLiveActive
            ? "#ef4444"
            : "linear-gradient(180deg, #a855f7 0%, #d946b8 100%)",
          padding: isLivePlayer ? "5px 12px 5px 9px" : "3px 8px 3px 6px",
          fontSize: isLivePlayer ? 11 : 8.5,
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
          width={isLivePlayer ? 15 : 12} height={isLivePlayer ? 15 : 12} viewBox="0 0 22 22" fill="none"
          style={{ animation: isLiveActive ? "livePulseIcon 1.4s ease-in-out infinite" : undefined }}
        >
          <circle cx="11" cy="11" r="10" stroke="#fff" strokeWidth="1.4" fill="none" />
          <circle cx="11" cy="11" r="6" fill="#fff" />
        </svg>
        {isLiveActive ? tGroups("liveLabel") : activeLiveData?.status === "ended" ? tPosts("liveStatusEnded") : tPosts("liveStatusScheduled")}
      </div>

      {/* Botón "Abrir panel" — solo para el creador cuando el live ya terminó */}
      {currentUserId === post.authorId && activeLiveData?.status === "ended" && (
        <button
          type="button"
          onClick={() => setLiveCreatorOpen(true)}
          style={{
            position: "absolute", top: 8, left: 8, zIndex: 4,
            height: 36, padding: "0 18px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg, #a855f7 0%, #d946b8 100%)", color: "#fff", fontWeight: 600,
            fontSize: 13, fontFamily: fontStack, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          {tFeed("openPanelStats")}
        </button>
      )}

      {/* Botón "Abrir centro de control" — overlay top-center, solo para el creador del live activo */}
      {currentUserId === post.authorId && isLivePlayer && (
        <button
          type="button"
          onClick={() => setLiveCreatorOpen(true)}
          style={{
            position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 4,
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 12px", borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.55)",
            color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: fontStack,
            cursor: "pointer", whiteSpace: "nowrap",
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
          </svg>
          {tFeed("openControlCenter")}
        </button>
      )}

      {/* Área de media — player activo, finalizado, o programado */}
      {isLivePlayer && (activeLiveData?.playbackId || activeLiveData?.hlsUrl) ? (
        <div style={{ position: "relative" }}>
          <LiveInlinePlayer
            postId={post.id}
            playbackId={activeLiveData.playbackId ?? undefined}
            hlsUrl={activeLiveData.hlsUrl ?? undefined}
            title={activeLiveData.title}
            coverUrl={activeLiveData.coverUrl}
            portrait={isLivePortrait}
            paused={liveViewerOpen || liveCreatorOpen || isViewerBanned}
            streamProvider={activeLiveData.streamProvider ?? undefined}
            broadcastMode={activeLiveData.broadcastMode ?? undefined}
            activeSuper={activeLiveData.activeSuper ?? null}
            isViewerOpen={liveViewerOpen}
            onStreamReady={(s) => setFeedLiveStream(s)}
            onClick={() => {
              if (currentUserId === post.authorId) { setLiveCreatorOpen(true); return; }
              if (isViewerBanned) return;
              setLiveViewerOpen(true);
            }}
            onOrientationDetected={(p) => {
              // Don't change portrait while the creator panel is open — it would
              // switch layout branches and unmount LiveDirectBroadcast mid-broadcast.
              if (!liveCreatorOpen) setIsLivePortrait(p);
            }}
          />
          {isViewerBanned && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 2,
              background: "rgba(0,0,0,0.82)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 10,
              pointerEvents: "none",
            }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
                stroke="rgba(239,68,68,0.8)" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: "rgba(255,255,255,0.7)",
                textAlign: "center", padding: "0 20px",
              }}>
                {tFeed("bannedFromLive")}
              </span>
            </div>
          )}
        </div>
      ) : activeLiveData?.status === "ended" ? (
        liveVodReady ? (
          premiumState.isBlocked ? (
            // Blocked by premium: show blurred cover — PremiumPostPanel handles unlock UI
            <div style={{
              position: "relative", width: "100%", aspectRatio: "16 / 9",
              background: "#000", borderRadius: 12, overflow: "hidden",
            }}>
              {activeLiveData?.coverUrl && (
                <Image
                  src={activeLiveData.coverUrl}
                  alt={activeLiveData.title ?? ""}
                  fill
                  style={{ objectFit: "cover", opacity: 0.25, filter: "blur(8px)" }}
                />
              )}
            </div>
          ) : (
            <LiveInlinePlayer
              postId={post.id}
              hlsUrl={liveVodUrl!}
              title={activeLiveData?.title}
              coverUrl={activeLiveData?.coverUrl}
              portrait={isLivePortrait}
              isVod
              paused={liveViewerOpen || liveCreatorOpen}
              streamProvider="mux"
              onClick={() => setLiveViewerOpen(true)}
              onOrientationDetected={(p) => { if (!liveCreatorOpen) setIsLivePortrait(p); }}
            />
          )
        ) : (
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 7",
              background: "rgba(0,0,0,0.7)",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {activeLiveData?.coverUrl && (
              <Image
                src={activeLiveData.coverUrl}
                alt={activeLiveData.title ?? "Live"}
                fill
                style={{ objectFit: "cover", opacity: 0.15, filter: "grayscale(40%)" }}
              />
            )}
            <div style={{
              position: "relative", zIndex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", gap: 8, color: "rgba(255,255,255,0.45)",
              fontFamily: fontStack, textAlign: "center",
            }}>
              {/* CF streams: no VOD management — simple ended state */}
              {!isCFLive && activeLiveData?.vodSettingsConfirmed && activeLiveData?.vodHidden ? (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{tFeed("creatorNoVideoUpload")}</span>
                </>
              ) : !isCFLive && !activeLiveData?.vodSettingsConfirmed ? (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"
                    style={{ animation: "vbMenuSpinner 1s linear infinite" }}>
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="rgba(255,255,255,0.55)" />
                  </svg>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{tFeed("creatorVideoNotUploaded")}</span>
                </>
              ) : activeLiveData?.vodStatus === "processing" ? (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"
                    style={{ animation: "vbMenuSpinner 1s linear infinite" }}>
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="rgba(255,255,255,0.55)" />
                  </svg>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{tFeed("preparingRecording")}</span>
                </>
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="10 15 15 12 10 9 10 15" />
                  </svg>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{tFeed("liveEnded")}</span>
                </>
              )}
            </div>
          </div>
        )
      ) : (
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 7",
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <Image
            src={activeLiveData?.coverUrl ?? "/live.webp"}
            alt={activeLiveData?.title ?? "Live programado"}
            fill
            style={{
              objectFit: "cover",
              opacity: activeLiveData?.coverUrl ? 0.45 : 0.65,
              filter: activeLiveData?.coverUrl ? "grayscale(20%)" : "none",
            }}
          />
          {post.requiresPayment === true && !(isOwnPost || isOwner) && !hasLiveTicketAccess && !memberHasFreeAccess ? (
            <svg
              width="82" height="82" viewBox="0 0 24 24" aria-hidden="true"
              onClick={() => {
                if (liveTicketShake) return;
                setLiveTicketShake(true);
                setTimeout(() => setLiveTicketShake(false), 600);
              }}
              style={{
                flexShrink: 0, position: "relative", zIndex: 1, cursor: "pointer",
                animation: liveTicketShake
                  ? "liveTicketShake 0.6s ease"
                  : "livePulseIcon 2s ease-in-out infinite",
              }}
            >
              <path d="M7.8 10.8V7.6Q7.8 3.4 12 3.4Q16.2 3.4 16.2 7.6V10.8H14.4V7.6Q14.4 5.4 12 5.4Q9.6 5.4 9.6 7.6V10.8H7.8Z" fill="rgba(255,255,255,0.65)" />
              <path fillRule="evenodd" clipRule="evenodd" d="M6.6 10.2H17.4Q18.8 10.2 18.8 11.6V19Q18.8 20.4 17.4 20.4H6.6Q5.2 20.4 5.2 19V11.6Q5.2 10.2 6.6 10.2ZM12 14.1Q11.1 14.1 11.1 15Q11.1 15.9 12 15.9Q12.9 15.9 12.9 15Q12.9 14.1 12 14.1Z" fill="rgba(255,255,255,0.65)" />
            </svg>
          ) : (
            <>
              {!isMobile && (
                <svg
                  width="52" height="52" viewBox="0 0 22 22" fill="none"
                  style={{ flexShrink: 0, position: "relative", zIndex: 1, animation: "livePulseIcon 2s ease-in-out infinite" }}
                >
                  <circle cx="11" cy="11" r="10" stroke="#ef4444" strokeWidth="1.4" fill="none" />
                  <circle cx="11" cy="11" r="6" fill="#ef4444" />
                </svg>
              )}
              {(isOwner || isOwnPost) && post.postType === "live" && (
                <div style={{ position: "absolute", top: isMobile ? "62%" : "calc(50% + 38px)", left: "50%", transform: isMobile ? "translate(-50%, -50%)" : "translateX(-50%)", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  {(activeLiveData?.liveStreamId || activeLiveData?.broadcastMode) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setLiveCreatorOpen(true)}
                        style={{
                          height: 36,
                          padding: "0 18px",
                          borderRadius: 10,
                          border: "none",
                          background: "#a855f7",
                          color: "#fff",
                          fontWeight: 600,
                          fontSize: 13,
                          fontFamily: fontStack,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tFeed("openPanelToStart")}
                      </button>
                      {activeLiveData?.broadcastMode === "rtmp" && activeLiveData?.liveStreamId && (
                        <button
                          type="button"
                          onClick={() => setLiveSetupOpen(true)}
                          style={{
                            width: "100%",
                            height: 36,
                            padding: "0 18px",
                            borderRadius: 10,
                            border: "none",
                            background: "#60a5fa",
                            color: "#fff",
                            fontWeight: 600,
                            fontSize: 13,
                            fontFamily: fontStack,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {tFeed("viewStreamKey")}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLiveSetupOpen(true)}
                      style={{
                        height: 36,
                        padding: "0 18px",
                        borderRadius: 10,
                        border: "none",
                        background: "#ef4444",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 13,
                        fontFamily: fontStack,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tFeed("startStream")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          <div style={{
            position: "absolute", top: 10, left: 10,
            display: "inline-flex", alignItems: "center", gap: 6,
            background: isLiveBlockedByTicket ? "rgba(20,5,5,0.88)" : "rgba(10,5,20,0.82)",
            border: isLiveBlockedByTicket ? "1px solid rgba(239,68,68,0.45)" : "1px solid rgba(168,85,255,0.35)",
            borderRadius: 999, padding: "4px 10px 4px 8px",
            fontFamily: fontStack, fontSize: 11, fontWeight: 700,
            letterSpacing: "0.04em",
            color: isLiveBlockedByTicket ? "#fca5a5" : "#d8b4fe",
            textTransform: "uppercase",
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            maxWidth: "calc(100% - 20px)",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: isLiveBlockedByTicket ? "#ef4444" : "#a855f7",
              flexShrink: 0,
              boxShadow: isLiveBlockedByTicket ? "0 0 0 2px rgba(239,68,68,0.3)" : "0 0 0 2px rgba(168,85,255,0.3)",
              animation: "livePulse 2s ease-in-out infinite",
            }} />
            {isLiveBlockedByTicket ? tFeed("streamStarted") : tFeed("waitingStart")}
          </div>

          {/* Ticket overlay — parte inferior de la portada */}
          {post.requiresPayment === true && !liveAccessBlocked && (
            <LiveTicketPanel
              ticketPrice={post.oneTimePrice ?? activeLiveData?.ticketPrice ?? null}
              currency={post.currency ?? activeLiveData?.currency ?? null}
              isAuthor={isOwnPost || isOwner}
              onBuyTicket={() => setLiveViewerOpen(true)}
              overlay
              highlighted={liveTicketShake}
              paid={hasLiveTicketAccess}
              memberFree={memberHasFreeAccess}
            />
          )}
        </div>
      )}

    {/* Content area — hidden when live player is visible */}
    {(!isLiveActive || isLiveBlockedByTicket) && (<div style={{ padding: "12px 14px 14px" }}>
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
          {formatScheduledLiveDate(activeLiveData?.scheduledStartAt, {
            locale,
            tbd: tFeed("scheduledTBD"),
            todayAt: (time) => tFeed("scheduledToday", { time }),
            tomorrowAt: (time) => tFeed("scheduledTomorrow", { time }),
            dateAt: (date, time) => tFeed("scheduledDateAt", { date, time }),
          })}
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
      @keyframes vbMenuSpinner {
        to { transform: rotate(360deg); }
      }
      @keyframes liveTicketShake {
        0%   { transform: translateX(0); }
        15%  { transform: translateX(-7px) rotate(-3deg); }
        30%  { transform: translateX(7px) rotate(3deg); }
        45%  { transform: translateX(-5px) rotate(-2deg); }
        60%  { transform: translateX(5px) rotate(2deg); }
        75%  { transform: translateX(-3px); }
        90%  { transform: translateX(3px); }
        100% { transform: translateX(0); }
      }
      @keyframes liveTicketPop {
        0%   { transform: translateX(-50%) scale(1); }
        30%  { transform: translateX(-50%) scale(1.04); }
        60%  { transform: translateX(-50%) scale(1.02); }
        100% { transform: translateX(-50%) scale(1); }
      }
    `}</style>
    </div>

    {/* Badge "Ticket pagado" — debajo del player cuando el live está activo y el viewer ya pagó */}
    {isLivePlayer && post.requiresPayment === true && !(isOwnPost || isOwner) && hasLiveTicketAccess && (
      <div style={{
        marginTop: 8,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 12px",
        borderRadius: 10,
        border: "1px solid rgba(239,68,68,0.35)",
        background: "rgba(20,5,5,0.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        fontFamily: fontStack,
      }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M15 5v2" /><path d="M15 11v2" /><path d="M15 17v2" />
          <path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z" />
        </svg>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#fca5a5", fontFamily: fontStack }}>
            {tFeed("ticketPaid")}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontFamily: fontStack, marginTop: 1 }}>
            {tFeed("canWatchLive")}
          </div>
        </div>
        <span style={{
          marginLeft: "auto", width: 7, height: 7, borderRadius: "50%",
          background: "#ef4444", flexShrink: 0,
          boxShadow: "0 0 0 2px rgba(239,68,68,0.3)",
          animation: "livePulse 2s ease-in-out infinite",
        }} />
      </div>
    )}
  </div>
  )
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
  <Image
    src={videoThumbnailUrl}
    alt={tPosts("videoPreviewAlt")}
    draggable={false}
    fill
    style={{
      zIndex: 1,
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
    ref={(el) => {
      videoRef.current = el;
      if (el) el.muted = true;
    }}
    muted
    controls={!isMobile}
    playsInline
    poster={videoThumbnailUrl ?? undefined}
    onClick={(e) => {
      if (isMobile) {
        openMediaViewer(videoThumbnailUrl || videoPlaybackUrl, e.currentTarget.getBoundingClientRect());
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

      if (premiumState.isBlocked && video.duration > 0) {
        const clips = buildPremiumPreviewClips(video.duration);
        premiumClipsRef.current = clips;
        premiumClipIndexRef.current = 0;
        if (clips[0]) video.currentTime = clips[0].start;
      }
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
transform: `scale(${getContainedMediaScale()})`,
transformOrigin: "center center",
cursor: isMobile ? "pointer" : "default",
    }}
  />
)}


{isMobile && (
  <button
    type="button"
    onClick={() => openMediaViewer(videoThumbnailUrl || videoPlaybackUrl)}
    aria-label={tPosts("playVideo")}
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
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="rgba(255,255,255,0.78)" width="104" height="104" style={{ marginLeft: 5, filter: "drop-shadow(0 1px 5px rgba(0,0,0,0.4))" }}>
      <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
    </svg>
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
            {isVideoError ? tPosts("videoProcessingError") : tPosts("videoProcessing")}
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

const carouselShellAspectRatio = "16 / 10";

function getCarouselMediaFrameWidth(media: DisplayMediaItem) {
  const ratio = mediaAspectRatios[media.url];
  const useNarrowFrame = shouldUseNarrowVerticalFrame(ratio);

  if (!useNarrowFrame) return "100%";

  return "46%";
}

      function openMedia(media: DisplayMediaItem, el?: HTMLElement | null) {
        if (media.isPlaceholder) return;
        openMediaViewer(media.url, el?.getBoundingClientRect());
      }

      function renderVideoOverlay(media: DisplayMediaItem, blocked = false) {
        if (media.type !== "video") return null;
        if (blocked) return null;

        const durationLabel = formatMediaDuration(media.duration);
        if (!durationLabel) return null;

        return (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              zIndex: 3,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.01em",
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
              pointerEvents: "none",
            }}
          >
            {durationLabel}
          </span>
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
              <Image
                src={coverUrl}
                alt=""
                fill
                style={{ objectFit: "cover", opacity: 0.78, filter: "saturate(0.92)" }}
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
                {tFeed("preparingVideo")}
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
  index: number
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
        if (media.type === "video" && media.playbackUrl) {
          return (
            <>
              {shouldContainTile && media.thumbnailUrl && renderBlurredMediaBackdrop(media.thumbnailUrl, "image")}

              <MediaGridVideoItem
                ref={(handle) => {
                  if (handle) mediaVideoHandlesRef.current.set(media.url, handle);
                  else mediaVideoHandlesRef.current.delete(media.url);
                }}
                hlsUrl={media.hlsUrl}
                playbackUrl={media.playbackUrl}
                thumbnailUrl={media.thumbnailUrl}
                duration={media.duration}
                tileStyle={{
                  ...tileImageStyle,
                  objectFit: mediaObjectFit as CSSProperties["objectFit"],
                  background: shouldContainTile ? "transparent" : "#050505",
                  transform: `scale(${mediaScale})`,
                  transformOrigin: "center center",
                }}
                onRatioLoaded={(ratio) => {
                  setMediaAspectRatios((prev) => ({
                    ...prev,
                    [media.url]: ratio,
                  }));
                  setLoadedMediaUrls((prev) => ({
                    ...prev,
                    [media.url]: true,
                  }));
                }}
                onLoadError={() => {
                  setFailedMediaUrls((prev) => ({
                    ...prev,
                    [media.url]: true,
                  }));
                }}
                onTimeUpdate={(t) => {
                  mediaCurrentTimesRef.current[media.url] = t;
                }}
              />
            </>
          );
        }

        return (
          <>
            {shouldContainTile && renderBlurredMediaBackdrop(feedMediaUrl, "image")}

            <Image
              src={feedMediaUrl}
              alt={
                media.altText ||
                (media.type === "video"
                  ? `Video ${index + 1} de la publicación`
                  : `Imagen ${index + 1} de la publicación`)
              }
              draggable={false}
              fill
              style={{
                zIndex: 1,
                objectFit: mediaObjectFit,
                background: shouldContainTile ? "transparent" : "#050505",
                transform: `scale(${mediaScale})`,
                transformOrigin: "center center",
                touchAction: "pan-y",
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
          onClick={(e) => openMedia(first, e.currentTarget)}
          aria-label={
            first.type === "video"
              ? tPosts("playPostVideo")
              : tPosts("openPostImage")
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
          {renderMediaContent(first, 0)}
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
                <VideoPlayIcon size={50} color="#fff" />
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
                    background: "rgba(0,0,0,0.52)",
                    backdropFilter: "blur(4px)",
                    WebkitBackdropFilter: "blur(4px)",
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
                    onClick={(e) => openMedia(media, e.currentTarget)}
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
                      index
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
background: "transparent",
border: "none",
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
background: "transparent",
border: "none",
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
                    <VideoPlayIcon size={50} color="#fff" />
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
                        background: "rgba(0,0,0,0.52)",
                        backdropFilter: "blur(4px)",
                        WebkitBackdropFilter: "blur(4px)",
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
{isMobile && premiumState.isBlocked && (isVideoPost || hasMediaGrid || liveVodReady) && (
  <button
    type="button"
    onClick={() => setPaymentPanelOpen(true)}
    aria-label={tFeed("unlockPremiumContent")}
    style={{
      width: "100%",
      height: 42,
      border: "none",
      borderRadius: 10,
      background: "linear-gradient(135deg, #4f46ff, #a855ff, #ff2fb3)",
      color: "#fff",
      fontSize: 11,
      fontWeight: 600,
      fontFamily: fontStack,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      marginTop: 10,
      WebkitTapHighlightColor: "transparent",
    }}
  >
    <VibraNavigationIcon type="premiumCrown" size={17} />
    {tFeed("unlockPremiumFor", { price: priceFmt.format(post.oneTimePrice ?? 0, { baseCurrency: post.currency ?? "MXN", code: true }) })}
  </button>
)}
{premiumState.isPremium && (
  <PremiumPostPanel
    state={premiumState}
    onOpenPayment={() => setPaymentPanelOpen(true)}
    oneTimePrice={post.oneTimePrice}
    currency={post.currency}
    isMobile={isMobile}
  />
)}
<PostPaymentPanel
  open={paymentPanelOpen}
  post={post}
  currentUserId={currentUserId}
  isMobile={isMobile}
  onPay={() => {
    void applyTempUnlock();
    onPostUnlocked?.(post.id);
  }}
  onClose={() => {
    setPaymentPanelOpen(false);
    if (onViewerClosed) window.setTimeout(() => onViewerClosed(), 200);
  }}
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
<LiveStreamSetup
  open={liveSetupOpen}
  onClose={() => setLiveSetupOpen(false)}
  postId={post.id}
  liveStreamId={activeLiveData?.liveStreamId}
  broadcastMode={activeLiveData?.broadcastMode ?? null}
  onStreamCreated={(liveStreamId, playbackId) => {
    setLocalLiveData((prev) => ({
      ...(prev ?? post.liveData ?? {}),
      liveStreamId,
      playbackId: playbackId ?? null,
      ingestUrl: "rtmps://global-live.mux.com:443/app",
      streamProvider: "mux",
    }));
  }}
  onOpenCreatorPanel={() => { setLiveSetupOpen(false); setLiveCreatorOpen(true); }}
/>
{liveViewerOpen && (
  <LiveViewerModal
    open={liveViewerOpen}
    onClose={() => {
      setLiveViewerOpen(false);
      if (onViewerClosed) window.setTimeout(() => onViewerClosed(), 200);
    }}
    post={{ ...post, liveData: activeLiveData ?? post.liveData }}
    onManage={currentUserId === post.authorId ? () => { setLiveViewerOpen(false); setLiveCreatorOpen(true); } : undefined}
    initialPortrait={isLivePortrait}
    initialStream={feedLiveStream}
  />
)}
{liveCreatorOpen && (
  <LiveCreatorPanel
    open={liveCreatorOpen}
    onClose={() => setLiveCreatorOpen(false)}
    post={{ ...post, liveData: activeLiveData ?? post.liveData }}
    portrait={isLivePortrait}
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
{beforeSaveAction}

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
              @keyframes vbActionsMenuFadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
              }
              @keyframes vbActionsMenuScaleIn {
                from { opacity: 0; transform: scale(0.92); }
                to { opacity: 1; transform: scale(1); }
              }
              @keyframes vbActionsMenuScaleOut {
                from { opacity: 1; transform: scale(1); }
                to { opacity: 0; transform: scale(0.92); }
              }
              @keyframes vbMenuSpinner {
                to { transform: rotate(360deg); }
              }
              @keyframes vbMenuFeedbackIn {
                from { opacity: 0; transform: scale(0.94); }
                to { opacity: 1; transform: scale(1); }
              }
              @keyframes vbMenuDoneIn {
                from { transform: scale(0.3); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
              }
            `}</style>

            {/* Backdrop */}
            <div
              style={{
                position: "fixed",
                inset: 0,
                // Sobre el viewer de medios cuando se abre desde sus 3 puntos.
                zIndex: selectedMediaUrl !== null ? 2147483646 : 99990,
                background: "rgba(0,0,0,0.50)",
                animation: menuClosing
                  ? "vbActionsMenuFadeOut 0.15s ease forwards"
                  : "vbActionsMenuFadeIn 0.18s ease",
              }}
              onClick={() => closeMenu()}
            />

            {/* Panel centrado — igual en mobile y desktop */}
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: selectedMediaUrl !== null ? 2147483647 : 99991,
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
                  width: "min(280px, 88vw)",
                  background: "rgba(8,9,11,0.985)",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  padding: 0,
                  display: "grid",
                  gap: 0,
                  overflow: "hidden",
                  boxShadow: "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
                  backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                  animation: menuClosing
                    ? "vbActionsMenuScaleOut 0.15s ease forwards"
                    : "vbActionsMenuScaleIn 0.18s ease",
                }}
              >
                {menuActionPhase !== "idle" ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "20px 24px",
                      gap: 14,
                      minHeight: 96,
                      animation: "vbMenuFeedbackIn 0.2s ease",
                    }}
                  >
                    <span
                      key={menuActionPhase}
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.88)",
                        letterSpacing: "-0.01em",
                        lineHeight: 1.2,
                        animation: "vbMenuFeedbackIn 0.18s ease",
                      }}
                    >
                      {menuActionPhase === "loading" ? menuActionTexts?.loading : menuActionTexts?.done}
                    </span>

                    {menuActionPhase === "loading" ? (
                      <div className="vibraPullRefreshSpinner refreshing" style={{ width: 28, height: 28 }} />
                    ) : (
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 28 28"
                        fill="none"
                        style={{ animation: "vbMenuDoneIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards" }}
                      >
                        <circle cx="14" cy="14" r="14" fill="#22c55e" />
                        <path
                          d="M8 14l4.5 4.5 7.5-8"
                          stroke="#fff"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                ) : (
                  <>
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
                            minHeight: 46,
                            fontSize: 14,
                            padding: "11px 16px",
                            borderTop: index > 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
                            ...(isBusy ? { color: "rgba(255,255,255,0.35)", cursor: "not-allowed" } : {}),
                            ...(isDanger && !isBusy ? { color: "#ff8a8a" } : {}),
                          }}
                        >
                          {isBusy ? tFeed("processing") : buildActionLabel(action)}
                        </button>
                      );
                    })}
                    {currentUserId && post.authorId !== currentUserId && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          closeMenu();
                          // ReportModal vive por debajo del viewer; si venimos
                          // desde el viewer, cerrarlo para que sea visible.
                          if (selectedMediaUrl !== null) closeMediaViewer();
                          openReport({
                            targetType: "post",
                            targetId: post.id,
                            targetOwnerId: post.authorId,
                          });
                        }}
                        style={{
                          ...menuItemStyle,
                          minHeight: 46,
                          fontSize: 14,
                          padding: "11px 16px",
                          borderTop: availableActions.length > 0
                            ? "1px solid rgba(255,255,255,0.08)"
                            : "none",
                          color: "#fff",
                        }}
                      >
                        Reportar publicación
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
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
                  {tCommon("cancel")}
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
  externalVideoElement={viewerExternalVideo}
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
  relativeDate={formatRelativeDate(post.liveData?.startedAt ?? post.createdAt, locale)}
  exactDate={formatExactDate(post.liveData?.startedAt ?? post.createdAt, locale)}
  likesCount={optimisticLikesCount}
  viewerHasFlamed={optimisticViewerHasFlamed}
  commentsCount={visibleCommentsTotal}
  flameBusy={flameBusy}
  sourceRect={viewerSourceRect}
  initialVideoTime={viewerInitialVideoTime}
  onVideoClose={(time) => { viewerVideoTimeRef.current = time; }}
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
      canCommentOnPosts={effectiveCanCommentOnPosts}
      commentBlockedMessage={commentBlockedMessage}
      commentText={commentText}
      commentMentions={commentMentions}
      mentionsDisabled={mentionsDisabled}
      creatingComment={creatingComment}
      deletingCommentId={deletingCommentId}
      inlineError={premiumState.isBlocked ? null : inlineActionError}
      canUseGroupMemberBlock={canUseGroupMemberBlock}
      canModerateGroupAuthor={canModerateGroupAuthor}
      isPostAuthor={!!currentUserId && currentUserId === postAuthor.authorId}
      onCommentTextChange={setCommentText}
      onCommentMentionsChange={setCommentMentions}
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
      canCommentOnPosts={effectiveCanCommentOnPosts}
      commentBlockedMessage={commentBlockedMessage}
      commentText={commentText}
      commentMentions={commentMentions}
      mentionsDisabled={mentionsDisabled}
      creatingComment={creatingComment}
      deletingCommentId={deletingCommentId}
      inlineError={premiumState.isBlocked ? null : inlineActionError}
      canUseGroupMemberBlock={canUseGroupMemberBlock}
      canModerateGroupAuthor={canModerateGroupAuthor}
      isPostAuthor={!!currentUserId && currentUserId === postAuthor.authorId}
      onCommentTextChange={setCommentText}
      onCommentMentionsChange={setCommentMentions}
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
  showActionsMenu={shouldShowActionsMenu}
  onOpenActionsMenu={() => setMenuOpen(true)}
/>
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
  canCommentOnPosts={effectiveCanCommentOnPosts}
  commentBlockedMessage={commentBlockedMessage}
  commentText={commentText}
  commentMentions={commentMentions}
  mentionsDisabled={mentionsDisabled}
  creatingComment={creatingComment}
  deletingCommentId={deletingCommentId}
  inlineError={premiumState.isBlocked ? null : inlineActionError}
  canUseGroupMemberBlock={canUseGroupMemberBlock}
  canModerateGroupAuthor={canModerateGroupAuthor}
  isPostAuthor={!!currentUserId && currentUserId === postAuthor.authorId}
  focusCommentId={focusCommentId}
  visibleCount={isMobile ? undefined : desktopVisibleCount}
  hasMore={!isMobile && comments !== null && comments.length > desktopVisibleCount}
  onLoadMore={isMobile ? undefined : () => setDesktopVisibleCount((c) => c + 5)}
  onCloseDesktop={!isMobile ? handleToggleCommentsDesktop : undefined}
  onCommentTextChange={setCommentText}
  onCommentMentionsChange={setCommentMentions}
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
  showAdminDetails={showDeletedBanner}
/>
  {reportTarget && (
    <ReportModal
      target={reportTarget}
      onClose={closeReport}
      onReported={
        suggestionMode && reportTarget.targetType === "post"
          ? () => onHidePost?.("report")
          : undefined
      }
    />
  )}

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