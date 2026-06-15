"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Post } from "@/lib/posts/types";
import PostPinchZoomImage from "./PostPinchZoomImage";
import PostSaveButton from "@/components/ui/PostSaveButton";
import PostShareButton from "@/components/ui/PostShareButton";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import VibraCommentIcon from "@/app/components/VibraServiceIcons/VibraCommentIcon";

type ImageMedia = {
  url: string;
  altText?: string | null;
};

export type ViewerMediaItem = {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
  duration?: number | null;
  playbackUrl?: string | null;
  hlsUrl?: string | null;
  playbackId?: string | null;
  status?: string | null;
};

type PostImageViewerProps = {
  open: boolean;
  isMobile: boolean;
  image?: ImageMedia | null;
  mediaItems?: ViewerMediaItem[];
  initialMediaUrl?: string | null;
  post: Post;
  author: {
    authorName: string;
    avatarUrl?: string | null;
    profileHref: string;
  };
  group?: {
    name: string;
    avatarUrl?: string | null;
    href?: string | null;
  } | null;
  authorStatusBadge?: {
    text: string;
    border: string;
    background: string;
    color: string;
  } | null;
  relativeDate: string;
  exactDate: string;
  likesCount: number;
  commentsCount: number;
  viewerHasFlamed?: boolean;
  flameBusy?: boolean;
  commentsContent?: ReactNode;
  mobileSheetCommentsContent?: ReactNode;
  onClose: () => void;
  onToggleFlame: () => void;
  onOpenComments: () => void;
  onOpenFlames?: () => void;
  onToggleSave?: () => void;
  isSaved?: boolean;
  saveBusy?: boolean;
  savesCount?: number;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function formatMediaDuration(seconds?: number | null): string {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getVideoSrc(media: ViewerMediaItem | null): string | null {
  if (!media || media.type !== "video") return null;

  if (typeof media.hlsUrl === "string" && media.hlsUrl.trim().length > 0) {
    return media.hlsUrl.trim();
  }

  if (
    typeof media.playbackUrl === "string" &&
    media.playbackUrl.trim().length > 0
  ) {
    return media.playbackUrl.trim();
  }

  if (
    typeof media.url === "string" &&
    media.url.trim().length > 0 &&
    !media.url.startsWith("mux://uploads/")
  ) {
    return media.url.trim();
  }

  return null;
}

function Avatar({
  name,
  avatarUrl,
  size = 36,
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
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.06)",
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
        border: "1px solid rgba(255,255,255,0.10)",
        color: "#fff",
        fontSize: Math.max(11, Math.floor(size * 0.32)),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function PostImageViewer({
  open,
  isMobile,
  image = null,
  mediaItems,
  initialMediaUrl = null,
  post,
  author,
  group = null,
  authorStatusBadge = null,
  relativeDate,
  exactDate,
  likesCount,
  commentsCount,
  viewerHasFlamed = false,
  flameBusy = false,
  commentsContent = null,
  mobileSheetCommentsContent = null,
  onClose,
  onToggleFlame,
  onOpenComments,
  onOpenFlames,
  onToggleSave,
  isSaved = false,
  saveBusy = false,
  savesCount = 0,
}: PostImageViewerProps) {
  const [mounted, setMounted] = useState(false);
  const [showExactDate, setShowExactDate] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [mobileCommentsOpen, setMobileCommentsOpen] = useState(false);
  const [mobileDragOffsetX, setMobileDragOffsetX] = useState(0);
  const [mobileDragOffsetY, setMobileDragOffsetY] = useState(0);
  const [mobileVerticalClosing, setMobileVerticalClosing] = useState(false);
  const [mobileSwipeAnimating, setMobileSwipeAnimating] = useState(false);
  const [mobileGestureAxis, setMobileGestureAxis] = useState<
    "horizontal" | "vertical" | null
  >(null);
  const [isCurrentImageZoomed, setIsCurrentImageZoomed] = useState(false);
  const [isCurrentImagePinching, setIsCurrentImagePinching] = useState(false);
  const [isCurrentVideoZoomed, setIsCurrentVideoZoomed] = useState(false);
  const [isCurrentVideoPinching, setIsCurrentVideoPinching] = useState(false);
  const [mobileVideoTrueFullscreen, setMobileVideoTrueFullscreen] =
    useState(false);
  const [desktopPostTextExpanded, setDesktopPostTextExpanded] = useState(false);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isLandscape, setIsLandscape] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [isTouchCapable, setIsTouchCapable] = useState(false);
  const [videoPlaybackRate, setVideoPlaybackRateState] = useState(1);
  const [desktopSpeedMenuOpen, setDesktopSpeedMenuOpen] = useState(false);
  const [mobileSpeedGestureActive, setMobileSpeedGestureActive] =
    useState(false);
  const [desktopControlsVisible, setDesktopControlsVisible] = useState(true);
  const [desktopFullscreenActive, setDesktopFullscreenActive] = useState(false);
  // 0 = peek (96px), 1 = mid (~50% screen), 2 = full (88dvh)
  const [mobileSheetSnap, setMobileSheetSnap] = useState<0 | 1 | 2>(0);
  const [mobileSheetShowComments, setMobileSheetShowComments] = useState(false);
  const [mobilePostTextExpanded, setMobilePostTextExpanded] = useState(false);
  const [postTextNeedsExpand, setPostTextNeedsExpand] = useState(false);
  const postTextPRef = useRef<HTMLParagraphElement | null>(null);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const desktopVideoShellRef = useRef<HTMLDivElement | null>(null);
  const chromeHideTimerRef = useRef<number | null>(null);
  const desktopControlsHideTimerRef = useRef<number | null>(null);
  const mobileSpeedHoldTimerRef = useRef<number | null>(null);
  const mobileSpeedHoldActiveRef = useRef(false);
  const mobileSpeedStartYRef = useRef<number | null>(null);
  const mobileSingleTapTimerRef = useRef<number | null>(null);
  const mobileLastVideoTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const mobileSheetDragStartYRef = useRef<number | null>(null);
  const mobileSheetBaseOffsetRef = useRef<number>(0);
  const mobileSheetRef = useRef<HTMLDivElement | null>(null);
  const mobileMediaClipRef = useRef<HTMLDivElement | null>(null);
  const mobileContentClipRef = useRef<HTMLDivElement | null>(null);
  const mediaAspectRatioRef = useRef<number | null>(null);
  const safeAreaTopRef = useRef<number>(0);

  useEffect(() => {
    setMounted(true);

    if (typeof window !== "undefined") {
      setIsTouchCapable(
        window.matchMedia?.("(pointer: coarse)")?.matches === true ||
          navigator.maxTouchPoints > 0,
      );
      const safeEl = document.createElement("div");
      safeEl.style.cssText = "position:fixed;height:env(safe-area-inset-top,0px);top:0;left:-9999px;pointer-events:none;visibility:hidden;";
      document.body.appendChild(safeEl);
      safeAreaTopRef.current = safeEl.offsetHeight;
      document.body.removeChild(safeEl);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const update = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const mediaList = useMemo<ViewerMediaItem[]>(() => {
    if (Array.isArray(mediaItems) && mediaItems.length > 0) {
      return mediaItems.filter((item) => {
        if (
          !item ||
          typeof item.url !== "string" ||
          item.url.trim().length === 0
        ) {
          return false;
        }

        if (item.type === "image") return true;
        if (item.type === "video")
          return Boolean(getVideoSrc(item) || item.thumbnailUrl);
        return false;
      });
    }

    const postMedia = Array.isArray(post.media)
      ? post.media
          .map<ViewerMediaItem | null>((item) => {
            if (item.type === "image") {
              if (
                typeof item.url !== "string" ||
                item.url.trim().length === 0
              ) {
                return null;
              }

              return {
                type: "image",
                url: item.url.trim(),
                thumbnailUrl: item.thumbnailUrl ?? null,
                altText: item.altText ?? null,
              };
            }

            if (item.type === "video") {
              const playbackUrl =
                typeof item.hlsUrl === "string" && item.hlsUrl.trim().length > 0
                  ? item.hlsUrl.trim()
                  : typeof item.url === "string" &&
                      item.url.trim().length > 0 &&
                      !item.url.startsWith("mux://uploads/")
                    ? item.url.trim()
                    : null;

              const thumbnailUrl =
                typeof item.thumbnailUrl === "string" &&
                item.thumbnailUrl.trim().length > 0
                  ? item.thumbnailUrl.trim()
                  : null;

              if (!playbackUrl && !thumbnailUrl) return null;

              return {
                type: "video",
                url: thumbnailUrl || playbackUrl || "",
                thumbnailUrl,
                altText: item.altText ?? "Video de la publicación",
                duration: item.duration ?? null,
                playbackUrl,
                hlsUrl: item.hlsUrl ?? null,
                playbackId: item.playbackId ?? null,
                status: item.status ?? null,
              };
            }

            return null;
          })
          .filter((item): item is ViewerMediaItem => item !== null)
      : [];

    if (postMedia.length > 0) return postMedia;

    return image
      ? [
          {
            type: "image",
            url: image.url,
            altText: image.altText ?? null,
          },
        ]
      : [];
  }, [image, mediaItems, post.media]);

const currentMedia = mediaList[currentMediaIndex] ?? mediaList[0] ?? null;
const currentMediaKey = currentMedia
  ? `${currentMedia.type}-${currentMedia.url}-${currentMediaIndex}`
  : "empty-media";

  // Keep ref in sync for imperative access in drag handlers
  useEffect(() => {
    mediaAspectRatioRef.current = mediaAspectRatio;
  }, [mediaAspectRatio]);

  // Reset aspect ratio when media changes
  useEffect(() => {
    setMediaAspectRatio(null);
  }, [currentMedia?.url]);

  // Load image natural dimensions to compute precise clip-path
  useEffect(() => {
    if (!currentMedia || currentMedia.type === "video" || !currentMedia.url) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setMediaAspectRatio(img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = currentMedia.url;
  }, [currentMedia?.url, currentMedia?.type]);

const previousMedia =
    mediaList.length > 1
      ? mediaList[
          currentMediaIndex <= 0 ? mediaList.length - 1 : currentMediaIndex - 1
        ]
      : null;
  const nextMedia =
    mediaList.length > 1
      ? mediaList[
          currentMediaIndex >= mediaList.length - 1 ? 0 : currentMediaIndex + 1
        ]
      : null;

  const totalMedia = mediaList.length;
  const canNavigateMedia = totalMedia > 1;
  const isCurrentVideo = currentMedia?.type === "video";
  const currentVideoSrc = getVideoSrc(currentMedia);
  const currentVideoPoster =
    currentMedia?.type === "video"
      ? (currentMedia.thumbnailUrl ?? undefined)
      : undefined;
  const useMobileLayout =
    isMobile ||
    (isTouchCapable &&
      typeof window !== "undefined" &&
      Math.min(window.innerWidth, window.innerHeight) <= 600);

  const cleanPostText = typeof post.text === "string" ? post.text.trim() : "";
  const shouldShowMobilePostText = cleanPostText.length > 0;
  const shouldShowDesktopPostText = cleanPostText.length > 0;
  const shouldClampDesktopPostText = cleanPostText.length > 160;

  // Resetear estado de texto al cambiar de post
  useEffect(() => {
    setMobilePostTextExpanded(false);
  }, [cleanPostText]);

  // Medir si el texto desborda una línea (solo cuando está colapsado)
  useLayoutEffect(() => {
    if (mobilePostTextExpanded) return;
    const p = postTextPRef.current;
    if (!p) return;
    // scrollHeight en el <p> devuelve su altura natural, ignorando maxHeight del padre
    setPostTextNeedsExpand(p.scrollHeight > 22);
  }, [cleanPostText, mobilePostTextExpanded, mounted, open]);

  const playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

  const clearChromeTimer = useCallback(() => {
    if (chromeHideTimerRef.current !== null) {
      window.clearTimeout(chromeHideTimerRef.current);
      chromeHideTimerRef.current = null;
    }
  }, []);

  const clearMobileSpeedHold = useCallback(() => {
    if (mobileSpeedHoldTimerRef.current !== null) {
      window.clearTimeout(mobileSpeedHoldTimerRef.current);
      mobileSpeedHoldTimerRef.current = null;
    }
  }, []);

  const clearDesktopControlsTimer = useCallback(() => {
    if (desktopControlsHideTimerRef.current !== null) {
      window.clearTimeout(desktopControlsHideTimerRef.current);
      desktopControlsHideTimerRef.current = null;
    }
  }, []);

  const scheduleDesktopControlsHide = useCallback(() => {
    if (!desktopFullscreenActive || !isCurrentVideo) return;

    clearDesktopControlsTimer();
    desktopControlsHideTimerRef.current = window.setTimeout(() => {
      setDesktopControlsVisible(false);
      setDesktopSpeedMenuOpen(false);
    }, 2800);
  }, [clearDesktopControlsTimer, desktopFullscreenActive, isCurrentVideo]);

  const revealDesktopControls = useCallback(() => {
    if (!desktopFullscreenActive) return;

    setDesktopControlsVisible(true);

    if (isCurrentVideo && videoPlaying) {
      scheduleDesktopControlsHide();
    }
  }, [desktopFullscreenActive, isCurrentVideo, scheduleDesktopControlsHide, videoPlaying]);

  const setVideoPlaybackRate = useCallback((rate: number) => {
    const safeRate = Number.isFinite(rate)
      ? Math.min(2, Math.max(0.25, rate))
      : 1;
    const video = videoRef.current;

    if (video && video.playbackRate !== safeRate) {
      video.playbackRate = safeRate;
    }

    setVideoPlaybackRateState((currentRate) =>
      currentRate === safeRate ? currentRate : safeRate,
    );
  }, []);

  const resetMobileVideoSpeed = useCallback(() => {
    clearMobileSpeedHold();
    mobileSpeedHoldActiveRef.current = false;
    mobileSpeedStartYRef.current = null;
    setMobileSpeedGestureActive(false);
    setVideoPlaybackRate(1);
  }, [clearMobileSpeedHold, setVideoPlaybackRate]);

  const startMobileVideoSpeedHold = useCallback(
    (clientY: number) => {
      if (!useMobileLayout || !isCurrentVideo) return;

      clearMobileSpeedHold();
      mobileSpeedHoldActiveRef.current = false;
      mobileSpeedStartYRef.current = clientY;

      mobileSpeedHoldTimerRef.current = window.setTimeout(() => {
        mobileSpeedHoldActiveRef.current = true;
        setMobileSpeedGestureActive(true);
        setVideoPlaybackRate(1.5);
        setMobileChromeVisible(true);
        clearChromeTimer();
      }, 320);
    },
    [
      clearChromeTimer,
      clearMobileSpeedHold,
      isCurrentVideo,
      setVideoPlaybackRate,
      useMobileLayout,
    ],
  );

  const updateMobileVideoSpeedHold = useCallback(
    (clientY: number) => {
      if (!useMobileLayout || !isCurrentVideo) return;

      const startY = mobileSpeedStartYRef.current;
      if (startY === null || !mobileSpeedHoldActiveRef.current) return;

      const deltaY = clientY - startY;
      setVideoPlaybackRate(deltaY > 42 ? 2 : 1.5);
    },
    [isCurrentVideo, setVideoPlaybackRate, useMobileLayout],
  );

  const scheduleChromeHide = useCallback(() => {
    if (!useMobileLayout || !isCurrentVideo) return;

    clearChromeTimer();
    chromeHideTimerRef.current = window.setTimeout(() => {
      setMobileChromeVisible(false);
    }, 2600);
  }, [clearChromeTimer, isCurrentVideo, useMobileLayout]);

  function goToPreviousMedia() {
    if (!canNavigateMedia) return;
    setCurrentMediaIndex((current) =>
      current <= 0 ? totalMedia - 1 : current - 1,
    );
  }

  function goToNextMedia() {
    if (!canNavigateMedia) return;
    setCurrentMediaIndex((current) =>
      current >= totalMedia - 1 ? 0 : current + 1,
    );
  }

  function clearMobileSingleTapTimer() {
    if (mobileSingleTapTimerRef.current !== null) {
      window.clearTimeout(mobileSingleTapTimerRef.current);
      mobileSingleTapTimerRef.current = null;
    }
  }

  function handleVideoPlayPause() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => undefined);
      }
    } else {
      video.pause();
    }
  }

  function handleVideoSeek(value: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(value)) return;

    video.currentTime = Math.min(
      Math.max(0, value),
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : value,
    );
    setVideoCurrentTime(video.currentTime);

    if (useMobileLayout && isCurrentVideo) {
      setMobileChromeVisible(true);
      scheduleChromeHide();
    }
  }

  async function handleDesktopFullscreen() {
    const shell = desktopVideoShellRef.current;

    if (!shell || typeof document === "undefined") return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      if (typeof shell.requestFullscreen === "function") {
        await shell.requestFullscreen();
      }
    } catch {
      // El navegador puede bloquear fullscreen si no hay interacción válida.
    }
  }

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleFullscreenChange = () => {
      const isShellFullscreen =
        document.fullscreenElement === desktopVideoShellRef.current;

      setDesktopFullscreenActive(isShellFullscreen);
      setDesktopControlsVisible(true);

      if (!isShellFullscreen) {
        clearDesktopControlsTimer();
        setDesktopSpeedMenuOpen(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [clearDesktopControlsTimer]);

  useEffect(() => {
    if (desktopFullscreenActive && isCurrentVideo && videoPlaying) {
      scheduleDesktopControlsHide();
      return;
    }

    clearDesktopControlsTimer();
    setDesktopControlsVisible(true);
  }, [
    clearDesktopControlsTimer,
    desktopFullscreenActive,
    isCurrentVideo,
    scheduleDesktopControlsHide,
    videoPlaying,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.playbackRate = videoPlaybackRate;
  }, [videoPlaybackRate]);

  useEffect(() => {
    setMobileGestureAxis(null);
    setMobileDragOffsetX(0);
    setMobileDragOffsetY(0);
    setMobileVerticalClosing(false);
    setIsCurrentImageZoomed(false);
    setIsCurrentImagePinching(false);
    setIsCurrentVideoZoomed(false);
    setIsCurrentVideoPinching(false);
    setMobileVideoTrueFullscreen(false);
    setVideoCurrentTime(0);
    setVideoDuration(currentMedia?.duration ?? 0);
    setVideoPlaying(false);
    setVideoReady(false);
    setDesktopSpeedMenuOpen(false);
    setDesktopControlsVisible(true);
    resetMobileVideoSpeed();
    setMobileChromeVisible(true);
  }, [
    currentMedia?.url,
    currentMedia?.type,
    currentMedia?.duration,
    resetMobileVideoSpeed,
  ]);

  useEffect(() => {
    if (!open || mediaList.length === 0) return;

    const selectedUrl = initialMediaUrl || image?.url || null;
    const selectedIndex = selectedUrl
      ? mediaList.findIndex(
          (item) =>
            item.url === selectedUrl ||
            item.thumbnailUrl === selectedUrl ||
            item.playbackUrl === selectedUrl ||
            item.hlsUrl === selectedUrl,
        )
      : 0;

    setCurrentMediaIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [image?.url, initialMediaUrl, mediaList, open]);

  useEffect(() => {
    if (!open) {
      setMobileCommentsOpen(false);
      setMobileSheetSnap(0);
      setMobileSheetShowComments(false);
      if (mobileSheetRef.current) {
        mobileSheetRef.current.style.transform = "";
        mobileSheetRef.current.style.transition = "";
      }
      setDesktopPostTextExpanded(false);
      clearChromeTimer();
      clearDesktopControlsTimer();
      clearMobileSingleTapTimer();
      mobileLastVideoTapRef.current = null;
      setDesktopControlsVisible(true);
      setDesktopFullscreenActive(false);
      setIsCurrentVideoZoomed(false);
      setIsCurrentVideoPinching(false);
      setMobileVideoTrueFullscreen(false);
      resetMobileVideoSpeed();
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") goToPreviousMedia();
      if (event.key === "ArrowRight") goToNextMedia();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      clearMobileSingleTapTimer();
      mobileLastVideoTapRef.current = null;
    };
  }, [clearChromeTimer, clearDesktopControlsTimer, open, onClose, totalMedia]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.currentTime = 0;
    video.playbackRate = videoPlaybackRate;

    if (open && isCurrentVideo && currentVideoSrc) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => undefined);
      }
      scheduleChromeHide();
    }
  }, [
    currentMediaIndex,
    currentVideoSrc,
    isCurrentVideo,
    open,
    scheduleChromeHide,
  ]);

  if (!mounted || !open || !currentMedia) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483647,
    background: useMobileLayout ? "#000" : "rgba(0,0,0,0.82)",
    color: "#fff",
    fontFamily: fontStack,
    display: useMobileLayout ? "block" : "grid",
    placeItems: useMobileLayout ? undefined : "center",
    padding: useMobileLayout ? 0 : "22px 0 22px 22px",
    boxSizing: "border-box",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  };

  const closeButtonStyle: CSSProperties = {
    position: "absolute",
    top: useMobileLayout ? "calc(10px + env(safe-area-inset-top))" : 14,
    left: useMobileLayout ? "calc(10px + env(safe-area-inset-left))" : 14,
    zIndex: 8,
    width: 38,
    height: 38,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(0,0,0,0.58)",
    color: "#fff",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    WebkitTapHighlightColor: "transparent",
  };

  const actionButtonStyle: CSSProperties = {
    border: "none",
    background: "transparent",
    padding: 0,
    color: "rgba(255,255,255,0.88)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
    fontFamily: fontStack,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };

  const actionGroupStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
  };

const flameButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  opacity: 1,
  cursor: "pointer",
  transform: viewerHasFlamed ? "scale(1.04)" : "scale(1)",
  transition: "transform 140ms ease",
  touchAction: "manipulation",
};

  const mobileVerticalProgress = useMobileLayout
    ? Math.min(1, Math.max(0, mobileDragOffsetY / Math.max(1, window.innerHeight)))
    : 0;
  const mobileOverlayOpacity = mobileVerticalClosing
    ? 0
    : 1 - Math.min(0.72, mobileVerticalProgress * 1.4);
  const mobileVerticalScale = 1 - Math.min(0.08, mobileVerticalProgress * 0.12);

  function renderMediaPreview(media: ViewerMediaItem | null, label: string) {
    if (!media) return null;

    if (media.type === "video") {
      const poster = media.thumbnailUrl || media.url;
      return (
        <div
          aria-label={label}
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            transform:
              label === "Anterior"
                ? `translateX(calc(-100% + ${mobileDragOffsetX}px))`
                : `translateX(calc(100% + ${mobileDragOffsetX}px))`,
            transition: mobileSwipeAnimating ? "transform 180ms ease" : "none",
            display: "grid",
            placeItems: "center",
          }}
        >
          {poster ? (
            <img
              src={poster}
              alt={media.altText || label}
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : null}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              width: 58,
              height: 58,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              background: "rgba(0,0,0,0.52)",
              border: "1px solid rgba(255,255,255,0.22)",
              color: "#fff",
              fontSize: 28,
              paddingLeft: 4,
            }}
          >
            ▶
          </span>
        </div>
      );
    }

const previewUrl = media.url;

    return (
      <img
        src={previewUrl}
        alt={media.altText || label}
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#000",
          transform:
            label === "Anterior"
              ? `translateX(calc(-100% + ${mobileDragOffsetX}px))`
              : `translateX(calc(100% + ${mobileDragOffsetX}px))`,
          transition: mobileSwipeAnimating ? "transform 180ms ease" : "none",
        }}
      />
    );
  }

  function computeContentClipPath(containerH: number, ar: number | null, sideInset = 0): string {
    if (!ar || containerH <= 0 || typeof window === "undefined") return "inset(0 0 0 0 round 0px)";
    const cW = window.innerWidth;
    const cAR = cW / containerH;
    if (Math.abs(cAR - ar) < 0.02) {
      return `inset(0 ${sideInset}px 0 ${sideInset}px round 12px)`;
    }
    if (cAR > ar) {
      // Pillarbox (contenido portrait/estrecho): sin inset lateral extra
      const barPx = Math.max(0, Math.floor((cW - containerH * ar) / 2));
      return `inset(0 ${barPx}px 0 ${barPx}px round 12px)`;
    } else {
      // Letterbox (contenido landscape/horizontal): aplica inset lateral
      const barPx = Math.max(0, Math.floor((containerH - cW / ar) / 2));
      return `inset(${barPx}px ${sideInset}px ${barPx}px ${sideInset}px round 12px)`;
    }
  }

  function getMobileContentClipPath(snap: 0 | 1 | 2, ar: number | null): string {
    if (typeof window === "undefined") return "inset(0 0 0 0 round 0px)";
    const cH = snap === 2 ? window.innerHeight / 3
      : snap === 1 ? (window.innerHeight * 2) / 3
      : window.innerHeight - 120;
    const sideInset = snap > 0 ? 12 : 0;
    return computeContentClipPath(snap === 0 ? 0 : cH, snap === 0 ? null : ar, sideInset);
  }

  // For iOS Safari: clip-path on a parent doesn't clip <video> (GPU compositing layer).
  // Apply clip-path directly to the <video> element, adjusted for safe-area-inset-top
  // since the video sits inside a div that starts below the safe area.
  function getMobileVideoDirectClipPath(snap: 0 | 1 | 2, ar: number | null): string {
    if (snap === 0 || typeof window === "undefined") return "inset(0 0 0 0 round 0px)";
    const cH = snap === 2 ? window.innerHeight / 3 : (window.innerHeight * 2) / 3;
    // Video element height = gesture container height minus safe area at the top
    const videoH = Math.max(cH - safeAreaTopRef.current, cH * 0.5);
    return computeContentClipPath(videoH, ar, 12);
  }

  function renderCurrentMedia() {
    if (currentMedia.type === "video") {
      const videoSurface = (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
          }}
        >
          {currentVideoSrc ? (
            <>
              {currentVideoPoster && !videoReady ? (
                <img
                  src={currentVideoPoster}
                  alt={currentMedia.altText || "Portada del video"}
                  draggable={false}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit:
                      useMobileLayout && mobileVideoTrueFullscreen
                        ? "cover"
                        : "contain",
                    background: "#000",
                    pointerEvents: "none",
                  }}
                />
              ) : null}

              <video
                ref={videoRef}
                src={currentVideoSrc}
                poster={currentVideoPoster}
                controls={!useMobileLayout || mobileSheetSnap === 0}
                autoPlay
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  event.currentTarget.playbackRate = videoPlaybackRate;
                  const { duration, videoWidth, videoHeight } = event.currentTarget;
                  setVideoDuration(
                    Number.isFinite(duration) && duration > 0
                      ? duration
                      : (currentMedia.duration ?? 0),
                  );
                  if (videoWidth && videoHeight) {
                    setMediaAspectRatio(videoWidth / videoHeight);
                  }
                }}
                onLoadedData={() => setVideoReady(true)}
                onCanPlay={() => setVideoReady(true)}
                onTimeUpdate={(event) => {
                  setVideoCurrentTime(event.currentTarget.currentTime);
                }}
                onPlay={() => setVideoPlaying(true)}
                onPause={() => setVideoPlaying(false)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#000",
                  opacity: videoReady || !currentVideoPoster ? 1 : 0,
                  pointerEvents: useMobileLayout ? "auto" : "none",
                  clipPath: useMobileLayout ? getMobileVideoDirectClipPath(mobileSheetSnap, mediaAspectRatio) : undefined,
                  transition: useMobileLayout ? "clip-path 320ms ease" : undefined,
                }}
              />
            </>
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "grid",
                placeItems: "center",
                color: "rgba(255,255,255,0.72)",
                fontSize: 13,
              }}
            >
              Video no disponible
            </div>
          )}
        </div>
      );

      return (
        <div
          ref={mobileContentClipRef}
          style={{
            position: "absolute",
            inset: 0,
            transform: mobileGestureAxis === "vertical"
              ? `translate3d(0, ${mobileDragOffsetY}px, 0) scale(${mobileVerticalScale})`
              : `translate3d(${mobileDragOffsetX}px, 0, 0) scale(1)`,
            transition: mobileSwipeAnimating
              ? "transform 180ms ease, clip-path 320ms ease"
              : "clip-path 320ms ease",
            opacity: mobileOverlayOpacity,
            background: "#000",
            clipPath: useMobileLayout
              ? getMobileContentClipPath(mobileSheetSnap, mediaAspectRatio)
              : "none",
          }}
        >
          <div style={{
            position: "absolute",
            top: useMobileLayout ? "env(safe-area-inset-top)" : 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}>
            {videoSurface}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={mobileContentClipRef}
        style={{
          position: "absolute",
          inset: 0,
          transform: mobileGestureAxis === "vertical"
            ? `translate3d(0, ${mobileDragOffsetY}px, 0) scale(${mobileVerticalScale})`
            : `translate3d(${mobileDragOffsetX}px, 0, 0) scale(1)`,
          transition: mobileSwipeAnimating
            ? "transform 180ms ease, clip-path 320ms ease"
            : "clip-path 320ms ease",
          opacity: mobileOverlayOpacity,
          background: "#000",
          clipPath: useMobileLayout
            ? getMobileContentClipPath(mobileSheetSnap, mediaAspectRatio)
            : "none",
        }}
      >
        {useMobileLayout ? (
          <PostPinchZoomImage
            key={currentMediaKey}
            src={currentMedia.url}
            alt={currentMedia.altText || "Imagen de la publicación"}
            onClose={onClose}
            onZoomStateChange={setIsCurrentImageZoomed}
            onPinchStateChange={setIsCurrentImagePinching}
            swipeAxis="horizontal"
            disableMinHeight
          />
        ) : (
          <img
            src={currentMedia.url}
            alt={currentMedia.altText || "Imagen de la publicación"}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#000",
            }}
          />
        )}
      </div>
    );
  }

  const mobileContent = (
    <div style={overlayStyle}>
      <div
        onTouchStart={(event) => {
          if (
            mobileSwipeAnimating ||
            isCurrentImageZoomed ||
            isCurrentImagePinching ||
            isCurrentVideoZoomed ||
            isCurrentVideoPinching
          ) {
            return;
          }

          if (isCurrentVideo && event.touches.length > 1) {
            event.preventDefault();
            resetMobileVideoSpeed();
            event.currentTarget.dataset.gestureAxis = "";
            setMobileGestureAxis(null);
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          const touch = event.touches[0];
          if (!touch) return;

          event.currentTarget.dataset.startX = String(touch.clientX);
          event.currentTarget.dataset.startY = String(touch.clientY);

          if (isCurrentVideo) {
            startMobileVideoSpeedHold(touch.clientY);
          }
          event.currentTarget.dataset.gestureAxis = "";

          setMobileGestureAxis(null);
          setMobileDragOffsetX(0);
          setMobileDragOffsetY(0);
        }}
        onTouchMove={(event) => {
          if (
            mobileSwipeAnimating ||
            isCurrentImageZoomed ||
            isCurrentImagePinching ||
            isCurrentVideoZoomed ||
            isCurrentVideoPinching
          ) {
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          if (isCurrentVideo && event.touches.length > 1) {
            event.preventDefault();
            resetMobileVideoSpeed();
            event.currentTarget.dataset.gestureAxis = "";
            setMobileGestureAxis(null);
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          const startX = Number(event.currentTarget.dataset.startX || 0);
          const startY = Number(event.currentTarget.dataset.startY || 0);
          const touch = event.touches[0];

          if (!touch || !startX) return;

          const diffX = touch.clientX - startX;
          const diffY = touch.clientY - startY;

          if (isCurrentVideo) {
            updateMobileVideoSpeedHold(touch.clientY);

            if (mobileSpeedHoldActiveRef.current) {
              event.preventDefault();
              event.currentTarget.dataset.gestureAxis = "speed";
              setMobileGestureAxis(null);
              setMobileDragOffsetX(0);
              setMobileDragOffsetY(0);
              return;
            }
          }
          const absX = Math.abs(diffX);
          const absY = Math.abs(diffY);

          let axis = event.currentTarget.dataset.gestureAxis as
            | "horizontal"
            | "vertical"
            | "speed"
            | "";

          if (!axis && (absX > 10 || absY > 10)) {
            if (isCurrentVideo) {
              clearMobileSingleTapTimer();
              mobileLastVideoTapRef.current = null;
            }

            if (absX > absY * 1.15) {
              axis = "horizontal";
            } else if (diffY > 0 && absY > absX * 1.15) {
              axis = "vertical";
            }

            if (axis) {
              event.currentTarget.dataset.gestureAxis = axis;
              setMobileGestureAxis(axis);
            }
          }

          if (axis === "horizontal") {
            event.preventDefault();
            setMobileDragOffsetX(diffX);
            setMobileDragOffsetY(0);
            return;
          }

          if (axis === "vertical") {
            event.preventDefault();
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(Math.max(0, diffY));
          }
        }}
        onTouchEnd={(event) => {
          if (
            mobileSwipeAnimating ||
            isCurrentImageZoomed ||
            isCurrentImagePinching ||
            isCurrentVideoZoomed ||
            isCurrentVideoPinching
          ) {
            setMobileGestureAxis(null);
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          const axis = event.currentTarget.dataset.gestureAxis;
          const startX = Number(event.currentTarget.dataset.startX || 0);
          const startY = Number(event.currentTarget.dataset.startY || 0);
          const touch = event.changedTouches[0];

          event.currentTarget.dataset.gestureAxis = "";
          setMobileGestureAxis(null);

          const wasSpeedGestureActive = mobileSpeedHoldActiveRef.current;
          resetMobileVideoSpeed();

          if (!touch || !startX) {
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          const diffX = touch.clientX - startX;
          const diffY = touch.clientY - startY;

          if (wasSpeedGestureActive || axis === "speed") {
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          if (axis === "vertical" && diffY > 120) {
            setMobileVerticalClosing(true);
            setMobileSwipeAnimating(true);
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(window.innerHeight);

            window.setTimeout(() => {
              onClose();
              setMobileDragOffsetY(0);
              setMobileDragOffsetX(0);
              setMobileVerticalClosing(false);
              setMobileSwipeAnimating(false);
            }, 180);
            return;
          }

          if (axis === "vertical") {
            setMobileSwipeAnimating(true);
            setMobileDragOffsetY(0);
            window.setTimeout(() => setMobileSwipeAnimating(false), 180);
            return;
          }

          if (!axis && Math.abs(diffX) < 10 && Math.abs(diffY) < 10) {
            if (isCurrentVideo && mobileSheetSnap > 0) {
              const video = videoRef.current;
              if (video) video.muted = !video.muted;
            }
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          if (!canNavigateMedia || axis !== "horizontal") {
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          if (Math.abs(diffX) < 65 || Math.abs(diffY) > 90) {
            setMobileSwipeAnimating(true);
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            window.setTimeout(() => setMobileSwipeAnimating(false), 180);
            return;
          }

          const direction = diffX < 0 ? "next" : "prev";
          const targetOffset =
            direction === "next" ? -window.innerWidth : window.innerWidth;

          setMobileSwipeAnimating(true);
          setMobileDragOffsetX(targetOffset);

          window.setTimeout(() => {
            if (direction === "next") goToNextMedia();
            else goToPreviousMedia();

            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            setMobileSwipeAnimating(false);
          }, 180);
        }}
        ref={mobileMediaClipRef}
        style={{
          position: "relative",
          width: "100%",
          height: useMobileLayout
            ? mobileSheetSnap === 2 ? "calc(100dvh / 3)"
              : mobileSheetSnap === 1 ? "calc(200dvh / 3)"
              : "calc(100dvh - 120px)"
            : "100%",
          overflow: "hidden",
          touchAction: "none",
          background: "#000",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          borderRadius: useMobileLayout && mobileSheetSnap > 0 ? 12 : 0,
          boxShadow: useMobileLayout && mobileSheetSnap > 0
            ? "0 0 0 1.5px rgba(255,255,255,0.18)"
            : "none",
          transition: useMobileLayout
            ? "height 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94), border-radius 320ms ease, box-shadow 320ms ease"
            : undefined,
        }}
      >
        {renderMediaPreview(previousMedia, "Anterior")}
        {renderCurrentMedia()}
        {renderMediaPreview(nextMedia, "Siguiente")}
      </div>



      {isCurrentVideo && mobileSpeedGestureActive && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: "calc(54px + env(safe-area-inset-top))",
            transform: "translateX(-50%)",
            zIndex: 2147483647,
            minHeight: 30,
            padding: "7px 12px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.66)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 800,
            lineHeight: 1,
            pointerEvents: "none",
          }}
        >
          {videoPlaybackRate.toFixed(videoPlaybackRate % 1 === 0 ? 0 : 1)}x
        </div>
      )}

      <div
        ref={mobileSheetRef}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2147483646,
          height: "88dvh",
          display: "flex",
          flexDirection: "column",
          background: "rgb(10, 10, 14)",
          borderRadius: "14px 14px 0 0",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          transform:
            mobileSheetSnap === 2 ? "translateY(calc(100% - 200dvh / 3))" :
            mobileSheetSnap === 1 ? "translateY(calc(100% - 100dvh / 3))" :
            "translateY(calc(100% - 120px))",
          transition: "transform 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          overflow: "hidden",
        }}
      >
        {/* Drag zone — touch handlers scoped here so the content area below can scroll freely */}
        <div
          style={{
            flexShrink: 0,
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          onTouchStart={(e) => {
            const sheet = mobileSheetRef.current;
            const touch = e.touches[0];
            if (!sheet || !touch) return;
            mobileSheetDragStartYRef.current = touch.clientY;
            const maxOffset = Math.max(0, sheet.offsetHeight - 120);
            const thirdOffset = Math.max(0, sheet.offsetHeight - Math.round(window.innerHeight / 3));
            const twoThirdOffset = Math.max(0, sheet.offsetHeight - Math.round(window.innerHeight * 2 / 3));
            mobileSheetBaseOffsetRef.current =
              mobileSheetSnap === 2 ? twoThirdOffset :
              mobileSheetSnap === 1 ? thirdOffset :
              maxOffset;
            sheet.style.transition = "none";
            if (mobileMediaClipRef.current) mobileMediaClipRef.current.style.transition = "none";
            if (mobileContentClipRef.current) mobileContentClipRef.current.style.transition = "none";
            if (videoRef.current) videoRef.current.style.transition = "none";
          }}
          onTouchMove={(e) => {
            const sheet = mobileSheetRef.current;
            const startY = mobileSheetDragStartYRef.current;
            if (!sheet || startY === null) return;
            const touch = e.touches[0];
            if (!touch) return;
            const diff = touch.clientY - startY;
            const maxOffset = Math.max(0, sheet.offsetHeight - 120);
            const twoThirdOffset = Math.max(0, sheet.offsetHeight - Math.round(window.innerHeight * 2 / 3));
            const clamped = Math.max(twoThirdOffset, Math.min(maxOffset, mobileSheetBaseOffsetRef.current + diff));
            sheet.style.transform = `translateY(${clamped}px)`;
            const mediaH = Math.max(0, window.innerHeight - (sheet.offsetHeight - clamped));
            if (mobileMediaClipRef.current) {
              mobileMediaClipRef.current.style.height = `${mediaH}px`;
            }
            if (mobileContentClipRef.current) {
              mobileContentClipRef.current.style.clipPath =
                computeContentClipPath(mediaH, mediaAspectRatioRef.current, 12);
            }
            if (videoRef.current) {
              const videoH = Math.max(0, mediaH - safeAreaTopRef.current);
              videoRef.current.style.clipPath = computeContentClipPath(
                videoH > 0 ? videoH : mediaH,
                mediaAspectRatioRef.current,
                12,
              );
            }
          }}
          onTouchEnd={(e) => {
            const sheet = mobileSheetRef.current;
            const startY = mobileSheetDragStartYRef.current;
            mobileSheetDragStartYRef.current = null;
            if (!sheet || startY === null) return;
            const touch = e.changedTouches[0];
            const endY = touch?.clientY ?? startY;
            const diff = endY - startY;
            const maxOffset = Math.max(0, sheet.offsetHeight - 120);
            const thirdOffset = Math.max(0, sheet.offsetHeight - Math.round(window.innerHeight / 3));
            const twoThirdOffset = Math.max(0, sheet.offsetHeight - Math.round(window.innerHeight * 2 / 3));
            const snapOffsets: [number, number, number] = [maxOffset, thirdOffset, twoThirdOffset];
            sheet.style.transition = "transform 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94)";
            if (mobileMediaClipRef.current) mobileMediaClipRef.current.style.transition = "height 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94), border-radius 320ms ease, box-shadow 320ms ease";
            if (mobileContentClipRef.current) mobileContentClipRef.current.style.transition = "clip-path 320ms ease";
            if (videoRef.current) videoRef.current.style.transition = "clip-path 320ms ease";
            if (Math.abs(diff) < 8) {
              const target = e.target as HTMLElement;
              if (target.closest("button, a, input, textarea, select")) {
                sheet.style.transform = `translateY(${snapOffsets[mobileSheetSnap]}px)`;
                return;
              }
              // Tap: peek→1/3, 1/3 o 2/3→peek
              const tapTarget: 0 | 1 | 2 = mobileSheetSnap === 0 ? 1 : 0;
              if (tapTarget !== mobileSheetSnap) setMobileSheetSnap(tapTarget);
              return;
            }
            // Snap al tope más cercano a la posición de release
            let newSnap: 0 | 1 | 2;
            const releasePos = Math.max(twoThirdOffset, Math.min(maxOffset, mobileSheetBaseOffsetRef.current + diff));
            const d0 = Math.abs(releasePos - maxOffset);
            const d1 = Math.abs(releasePos - thirdOffset);
            const d2 = Math.abs(releasePos - twoThirdOffset);
            if (d0 <= d1 && d0 <= d2) newSnap = 0;
            else if (d1 <= d2) newSnap = 1;
            else newSnap = 2;
            if (newSnap !== mobileSheetSnap) {
              setMobileSheetSnap(newSnap);
            } else {
              sheet.style.transform = `translateY(${snapOffsets[newSnap]}px)`;
              if (mobileMediaClipRef.current) {
                mobileMediaClipRef.current.style.height = `${window.innerHeight - (sheet.offsetHeight - snapOffsets[newSnap])}px`;
              }
              const s = newSnap;
              setTimeout(() => {
                if (mobileSheetRef.current) mobileSheetRef.current.style.transform =
                  s === 2 ? "translateY(calc(100% - 200dvh / 3))" :
                  s === 1 ? "translateY(calc(100% - 100dvh / 3))" :
                  "translateY(calc(100% - 120px))";
                if (mobileMediaClipRef.current) {
                  mobileMediaClipRef.current.style.height =
                    s === 2 ? "calc(100dvh / 3)" :
                    s === 1 ? "calc(200dvh / 3)" :
                    "calc(100dvh - 120px)";
                  mobileMediaClipRef.current.style.borderRadius = s > 0 ? "12px" : "0";
                  mobileMediaClipRef.current.style.boxShadow = s > 0
                    ? "0 0 0 1.5px rgba(255,255,255,0.18)"
                    : "none";
                }
                if (mobileContentClipRef.current) {
                  const snapH = s === 2 ? window.innerHeight / 3
                    : s === 1 ? (window.innerHeight * 2) / 3
                    : window.innerHeight - 120;
                  mobileContentClipRef.current.style.clipPath =
                    computeContentClipPath(s === 0 ? 0 : snapH, mediaAspectRatioRef.current, s > 0 ? 12 : 0);
                }
                if (videoRef.current) {
                  const snapH = s === 2 ? window.innerHeight / 3 : s === 1 ? (window.innerHeight * 2) / 3 : 0;
                  if (s === 0) {
                    videoRef.current.style.clipPath = "inset(0 0 0 0 round 0px)";
                  } else {
                    const videoH = Math.max(snapH - safeAreaTopRef.current, snapH * 0.5);
                    videoRef.current.style.clipPath = computeContentClipPath(videoH, mediaAspectRatioRef.current, 12);
                  }
                }
              }, 340);
            }
          }}
        >
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            justifyContent: "center",
            paddingTop: 14,
            paddingBottom: 8,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 999,
              background: "rgba(255,255,255,0.22)",
            }}
          />
        </div>

        {/* Row 1: Avatar + Name/Date */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "2px 16px 6px",
            minWidth: 0,
          }}
        >
          <Link href={author.profileHref} style={{ flexShrink: 0, lineHeight: 0 }}>
            <Avatar name={author.authorName} avatarUrl={author.avatarUrl} size={36} />
          </Link>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                maxWidth: "100%",
                overflow: "hidden",
              }}
            >
              <Link
                href={author.profileHref}
                style={{
                  color: "#fff",
                  textDecoration: "none",
                  fontSize: 12.5,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {author.authorName}
              </Link>

              {group && (
                <>
                  <span
                    aria-hidden="true"
                    style={{
                      color: "rgba(255,255,255,0.34)",
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    •
                  </span>
                  {group.href ? (
                    <Link
                      href={group.href}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        minWidth: 0,
                        color: "rgba(255,255,255,0.68)",
                        textDecoration: "none",
                        fontSize: 11,
                        fontWeight: 600,
                        overflow: "hidden",
                      }}
                    >
                      <Avatar
                        name={group.name}
                        avatarUrl={group.avatarUrl}
                        size={15}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {group.name}
                      </span>
                    </Link>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        minWidth: 0,
                        color: "rgba(255,255,255,0.68)",
                        fontSize: 11,
                        fontWeight: 600,
                        overflow: "hidden",
                      }}
                    >
                      <Avatar
                        name={group.name}
                        avatarUrl={group.avatarUrl}
                        size={15}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {group.name}
                      </span>
                    </span>
                  )}
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowExactDate((prev) => !prev)}
              title={exactDate}
              aria-label={
                showExactDate
                  ? "Mostrar fecha relativa"
                  : "Mostrar fecha exacta"
              }
              style={{
                width: "fit-content",
                color: "rgba(255,255,255,0.55)",
                fontSize: 10.5,
                lineHeight: 1.1,
                border: "none",
                background: "transparent",
                padding: 0,
                fontFamily: fontStack,
                cursor: "pointer",
                textAlign: "left",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {showExactDate ? exactDate : relativeDate}
            </button>
          </div>
        </div>

        {/* Row 2: Actions — always visible in peek */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 16px 4px",
          }}
        >
          <div style={actionGroupStyle}>
            <button
              type="button"
              onClick={onToggleFlame}
              aria-pressed={viewerHasFlamed}
              aria-label={
                viewerHasFlamed
                  ? "Quitar flamita de la publicación"
                  : "Dar flamita a la publicación"
              }
              style={flameButtonStyle}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  lineHeight: 1,
                }}
              >
                <VibraFlameIcon active={viewerHasFlamed} size={22} />
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenFlames}
              disabled={!onOpenFlames || likesCount === 0}
              aria-label="Ver usuarios que dieron flamita"
              style={{
                ...actionButtonStyle,
                opacity: !onOpenFlames || likesCount === 0 ? 0.55 : 1,
                cursor:
                  !onOpenFlames || likesCount === 0 ? "default" : "pointer",
              }}
            >
              {likesCount}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              onOpenComments();
              setMobileSheetSnap(2);
              setMobileSheetShowComments(true);
            }}
            aria-label="Ver comentarios"
            style={actionButtonStyle}
          >
            <span aria-hidden="true">
              <VibraCommentIcon size={20} color="rgba(255,255,255,0.88)" />
            </span>
            <span>{commentsCount}</span>
          </button>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <PostSaveButton
              count={savesCount}
              saved={isSaved}
              loading={saveBusy}
              disabled={!onToggleSave}
              onClick={onToggleSave}
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
        </div>{/* end drag zone */}

        {/* Expanded section — always in DOM to prevent height changes during animation */}
        <div
          style={{
            flex: 1,
            overflowY: mobileSheetSnap > 0 ? "auto" : "hidden",
            opacity: mobileSheetSnap > 0 ? 1 : 0,
            pointerEvents: mobileSheetSnap > 0 ? "auto" : "none",
            transition: "opacity 200ms ease",
            padding: "6px 16px calc(20px + env(safe-area-inset-bottom))",
            overscrollBehavior: "contain",
          }}
        >
          {shouldShowMobilePostText && (
            mobilePostTextExpanded ? (
              <p style={{ margin: 0, color: "rgba(255,255,255,0.86)", fontSize: 13, fontWeight: 300, lineHeight: 1.55, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                {cleanPostText}{" "}
                {postTextNeedsExpand && (
                  <span
                    onClick={() => setMobilePostTextExpanded(false)}
                    style={{ color: "rgba(255,255,255,0.45)", cursor: "pointer" }}
                  >
                    ...menos
                  </span>
                )}
              </p>
            ) : (
              <div style={{ position: "relative", overflow: "hidden", maxHeight: 21 }}>
                <p ref={postTextPRef} style={{ margin: 0, color: "rgba(255,255,255,0.86)", fontSize: 13, fontWeight: 300, lineHeight: 1.55, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                  {cleanPostText}
                </p>
                {postTextNeedsExpand && (
                  <span
                    onClick={() => setMobilePostTextExpanded(true)}
                    style={{
                      position: "absolute", right: 0, bottom: 0,
                      paddingLeft: 36,
                      background: "linear-gradient(to right, transparent, rgb(10,10,14) 40%)",
                      color: "rgba(255,255,255,0.86)", fontSize: 13, fontWeight: 400,
                      lineHeight: "21px", cursor: "pointer",
                    }}
                  >
                    ...más
                  </span>
                )}
              </div>
            )
          )}

          {mobileSheetShowComments && mobileSheetCommentsContent && (
            <div style={{ marginTop: 16 }}>
              {mobileSheetCommentsContent}
            </div>
          )}
        </div>
      </div>

      {mobileCommentsOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            background: "rgba(0,0,0,0.54)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={() => setMobileCommentsOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxHeight: "72dvh",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              background: "rgba(12,12,12,0.98)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderBottom: "none",
              padding: "10px 12px calc(12px + env(safe-area-inset-bottom))",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {commentsContent}
          </div>
        </div>
      )}
    </div>
  );

  const desktopContent = (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={{
          width: "min(960px, calc(100vw - 96px))",
          height: "min(620px, calc(100dvh - 96px))",
          display: "grid",
          gridTemplateColumns: "minmax(0, 620px) 340px",
          borderRadius: 16,
          overflow: "hidden",
          background: "#000",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.58)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          ref={desktopVideoShellRef}
          onMouseMove={revealDesktopControls}
          onClick={revealDesktopControls}
          style={{
            position: "relative",
            minWidth: 0,
            minHeight: 0,
            width: "100%",
            height: "100%",
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {(!desktopFullscreenActive || desktopControlsVisible) && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar visor"
              style={closeButtonStyle}
            >
              ×
            </button>
          )}

          {currentMedia.type === "video" ? (
            currentVideoSrc ? (
              <video
                ref={videoRef}
                src={currentVideoSrc}
                poster={currentVideoPoster}
                controls
                autoPlay
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  event.currentTarget.playbackRate = videoPlaybackRate;
                  const duration = event.currentTarget.duration;
                  setVideoDuration(
                    Number.isFinite(duration) && duration > 0
                      ? duration
                      : (currentMedia.duration ?? 0),
                  );
                }}
                onTimeUpdate={(event) =>
                  setVideoCurrentTime(event.currentTarget.currentTime)
                }
                onPlay={() => setVideoPlaying(true)}
                onPause={() => setVideoPlaying(false)}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#000",
                }}
              />
            ) : (
              <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}>
                Video no disponible
              </div>
            )
          ) : (
            <img
              src={currentMedia.url}
              alt={currentMedia.altText || "Imagen de la publicación"}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                background: "#000",
              }}
            />
          )}

          {(!desktopFullscreenActive || desktopControlsVisible) &&
            (currentMedia.type === "video" || canNavigateMedia) && (
            <div
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                zIndex: 7,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >

              {canNavigateMedia && (
                <div
                  style={{
                    minHeight: 30,
                    padding: "8px 10px",
                    borderRadius: 999,
                    background: "rgba(0,0,0,0.52)",
                    border: "1px solid rgba(255,255,255,0.16)",
                    color: "rgba(255,255,255,0.92)",
                    fontSize: 11,
                    fontWeight: 750,
                    lineHeight: 1,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {currentMediaIndex + 1}/{totalMedia}
                </div>
              )}
            </div>
          )}

          {false &&
            currentMedia.type === "video" &&
            currentVideoSrc && (
            <div
              style={{
                position: "absolute",
                left: 22,
                right: 22,
                bottom: 18,
                zIndex: 7,
                display: "grid",
                gridTemplateColumns: "auto auto minmax(0, 1fr) auto auto auto",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.62))",
                color: "#fff",
              }}
            >
              <button
                type="button"
                onClick={handleVideoPlayPause}
                aria-label={videoPlaying ? "Pausar video" : "Reproducir video"}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  border: "none",
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  fontSize: 15,
                  paddingLeft: videoPlaying ? 0 : 2,
                }}
              >
                {videoPlaying ? "Ⅱ" : "▶"}
              </button>

              <span
                style={{
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {formatMediaDuration(videoCurrentTime)} /{" "}
                {formatMediaDuration(videoDuration)}
              </span>

              <input
                type="range"
                min={0}
                max={videoDuration > 0 ? videoDuration : 0}
                step={0.05}
                value={Math.min(
                  videoCurrentTime,
                  videoDuration > 0 ? videoDuration : videoCurrentTime,
                )}
                aria-label="Avanzar o retroceder video"
                onChange={(event) =>
                  handleVideoSeek(Number(event.currentTarget.value))
                }
                style={{
                  width: "100%",
                  margin: 0,
                  accentColor: "#fff",
                  cursor: "pointer",
                }}
              />

              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  video.muted = !video.muted;
                }}
                aria-label="Silenciar o activar sonido"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  border: "none",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                ◔
              </button>

              <div style={{ position: "relative", width: 36, height: 30 }}>
                <button
                  type="button"
                  onClick={() => setDesktopSpeedMenuOpen((prev) => !prev)}
                  aria-label="Elegir velocidad de reproducción"
                  aria-expanded={desktopSpeedMenuOpen}
                  style={{
                    width: 36,
                    height: 30,
                    borderRadius: 999,
                    border: "none",
                    background: "transparent",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 800,
                    lineHeight: 1,
                    fontFamily: fontStack,
                  }}
                >
                  {videoPlaybackRate.toFixed(
                    videoPlaybackRate % 1 === 0 ? 0 : 1,
                  )}
                  x
                </button>

                {desktopSpeedMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Velocidad de reproducción"
                    style={{
                      position: "absolute",
                      right: 0,
                      bottom: 38,
                      minWidth: 86,
                      padding: 5,
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "rgba(10,10,10,0.94)",
                      boxShadow: "0 12px 30px rgba(0,0,0,0.38)",
                      display: "grid",
                      gap: 3,
                    }}
                  >
                    {playbackRates.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setVideoPlaybackRate(rate);
                          setDesktopSpeedMenuOpen(false);
                        }}
                        style={{
                          minHeight: 28,
                          borderRadius: 8,
                          border: "none",
                          background:
                            videoPlaybackRate === rate
                              ? "rgba(255,255,255,0.16)"
                              : "transparent",
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: videoPlaybackRate === rate ? 850 : 700,
                          fontFamily: fontStack,
                          cursor: "pointer",
                          textAlign: "left",
                          padding: "6px 9px",
                        }}
                      >
                        {rate
                          .toFixed(rate % 1 === 0 ? 0 : 2)
                          .replace(/\.00$/, "")}
                        x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleDesktopFullscreen}
                aria-label="Ver video en pantalla completa"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  border: "none",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                ⛶
              </button>
            </div>
          )}

          {(!desktopFullscreenActive || desktopControlsVisible) &&
            canNavigateMedia && (
            <>
              <button
                type="button"
                onClick={goToPreviousMedia}
                aria-label="Ver media anterior"
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  zIndex: 6,
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(0,0,0,0.48)",
                  color: "#fff",
                  fontSize: 26,
                  lineHeight: 1,
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                }}
              >
                ‹
              </button>

              <button
                type="button"
                onClick={goToNextMedia}
                aria-label="Ver media siguiente"
                style={{
                  position: "absolute",
                  right: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  zIndex: 6,
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(0,0,0,0.48)",
                  color: "#fff",
                  fontSize: 26,
                  lineHeight: 1,
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                }}
              >
                ›
              </button>
            </>
          )}
        </div>

        <aside
          style={{
            minHeight: 0,
            borderLeft: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(22,22,22,0.98)",
            display: "grid",
            gridTemplateRows: "auto 1fr",
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: "16px 16px 13px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              minWidth: 0,
            }}
          >
            <Link href={author.profileHref} style={{ flexShrink: 0 }}>
              <Avatar
                name={author.authorName}
                avatarUrl={author.avatarUrl}
                size={38}
              />
            </Link>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <Link
                  href={author.profileHref}
                  style={{
                    color: "#fff",
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {author.authorName}
                </Link>

                {group && (
                  <>
                    <span
                      aria-hidden="true"
                      style={{ color: "rgba(255,255,255,0.32)", fontSize: 12 }}
                    >
                      •
                    </span>

                    {group.href ? (
                      <Link
                        href={group.href}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          minWidth: 0,
                          color: "rgba(255,255,255,0.62)",
                          textDecoration: "none",
                          fontSize: 11,
                          fontWeight: 600,
                          overflow: "hidden",
                        }}
                      >
                        <Avatar
                          name={group.name}
                          avatarUrl={group.avatarUrl}
                          size={16}
                        />
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {group.name}
                        </span>
                      </Link>
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          minWidth: 0,
                          color: "rgba(255,255,255,0.62)",
                          fontSize: 11,
                          fontWeight: 600,
                          overflow: "hidden",
                        }}
                      >
                        <Avatar
                          name={group.name}
                          avatarUrl={group.avatarUrl}
                          size={16}
                        />
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {group.name}
                        </span>
                      </span>
                    )}
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowExactDate((prev) => !prev)}
                title={exactDate}
                aria-label={
                  showExactDate
                    ? "Mostrar fecha relativa de la publicación"
                    : "Mostrar fecha exacta de la publicación"
                }
                style={{
                  display: "block",
                  width: "fit-content",
                  marginTop: 0,
                  color: "rgba(255,255,255,0.52)",
                  fontSize: 11,
                  lineHeight: "11px",
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  fontFamily: fontStack,
                  cursor: "pointer",
                  textAlign: "left",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {showExactDate ? exactDate : relativeDate}
              </button>
            </div>
          </div>

          <div
            className="post-image-viewer-scroll"
            style={{
              minHeight: 0,
              overflowY: "auto",
              padding: "16px 16px 14px",
              display: "grid",
              alignContent: "start",
              gap: 8,
            }}
          >
            {(authorStatusBadge || shouldShowDesktopPostText) && (
              <div
                style={{
                  color: "rgba(255,255,255,0.9)",
                  fontSize: 13,
                  fontWeight: 300,
                  lineHeight: 1.55,
                  wordBreak: "break-word",
                }}
              >
                {authorStatusBadge && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      minHeight: 18,
                      padding: "2px 7px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 650,
                      lineHeight: 1,
                      letterSpacing: "-0.01em",
                      whiteSpace: "nowrap",
                      border: authorStatusBadge.border,
                      background: authorStatusBadge.background,
                      color: authorStatusBadge.color,
                      marginRight: shouldShowDesktopPostText ? 8 : 0,
                      verticalAlign: "middle",
                    }}
                  >
                    {authorStatusBadge.text}
                  </span>
                )}

                {shouldShowDesktopPostText && (
                  <span style={{ whiteSpace: "pre-wrap" }}>
                    {desktopPostTextExpanded || !shouldClampDesktopPostText
                      ? cleanPostText
                      : `${cleanPostText.slice(0, 145).trim()}...`}

                    {shouldClampDesktopPostText && (
                      <button
                        type="button"
                        onClick={() =>
                          setDesktopPostTextExpanded((prev) => !prev)
                        }
                        style={{
                          marginLeft: 6,
                          border: "none",
                          background: "transparent",
                          color: "rgba(255,255,255,0.78)",
                          padding: 0,
                          fontSize: 13,
                          fontWeight: 700,
                          fontFamily: fontStack,
                          cursor: "pointer",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {desktopPostTextExpanded ? "- Ver menos" : "+ Ver más"}
                      </button>
                    )}
                  </span>
                )}
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 0,
                width: "100%",
              }}
            >
              <div style={actionGroupStyle}>
<button
  type="button"
  onClick={onToggleFlame}
  aria-pressed={viewerHasFlamed}
  aria-label={
    viewerHasFlamed
      ? "Quitar flamita de la publicación"
      : "Dar flamita a la publicación"
  }
  style={flameButtonStyle}
>
  <span
    aria-hidden="true"
    style={{
      display: "inline-grid",
      placeItems: "center",
      lineHeight: 1,
    }}
  >
    <VibraFlameIcon active={viewerHasFlamed} size={21} />
  </span>
</button>

                <button
                  type="button"
                  onClick={onOpenFlames}
                  disabled={!onOpenFlames || likesCount === 0}
                  aria-label="Ver usuarios que dieron flamita"
                  style={{
                    ...actionButtonStyle,
                    opacity: !onOpenFlames || likesCount === 0 ? 0.55 : 1,
                    cursor:
                      !onOpenFlames || likesCount === 0 ? "default" : "pointer",
                  }}
                >
                  {likesCount}
                </button>
              </div>

              <button
                type="button"
                onClick={onOpenComments}
                aria-label="Abrir comentarios"
                style={{ ...actionButtonStyle, gap: 3 }}
              >
                <span
                  aria-hidden="true"
                  style={{ fontSize: 19, lineHeight: 1 }}
                >
                  💬
                </span>
                <span>{commentsCount}</span>
              </button>

              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
                <PostSaveButton
                  count={savesCount}
                  saved={isSaved}
                  loading={saveBusy}
                  disabled={!onToggleSave}
                  onClick={onToggleSave}
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

            <div style={{ marginTop: 0, paddingTop: 0, minWidth: 0 }}>
              {commentsContent}
            </div>
          </div>
        </aside>
      </div>

      <style>
        {`
          .post-image-viewer-scroll {
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.22) transparent;
          }

          .post-image-viewer-scroll::-webkit-scrollbar {
            width: 6px;
          }

          .post-image-viewer-scroll::-webkit-scrollbar-track {
            background: transparent;
          }

          .post-image-viewer-scroll::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.22);
            border-radius: 999px;
          }

          .post-image-viewer-scroll::-webkit-scrollbar-button {
            display: none;
            width: 0;
            height: 0;
          }
        `}
      </style>
    </div>
  );

  return createPortal(
    useMobileLayout ? mobileContent : desktopContent,
    document.body,
  );
}
