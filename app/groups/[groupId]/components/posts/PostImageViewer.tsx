"use client";

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
import { createPortal } from "react-dom";
import type { Post } from "@/lib/posts/types";
import PostPinchZoomImage from "./PostPinchZoomImage";

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
  onClose: () => void;
  onToggleFlame: () => void;
  onOpenComments: () => void;
  onOpenFlames?: () => void;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function formatMediaDuration(seconds?: number | null): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
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
  onClose,
  onToggleFlame,
  onOpenComments,
  onOpenFlames,
}: PostImageViewerProps) {
  const [mounted, setMounted] = useState(false);
  const [showExactDate, setShowExactDate] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [mobileCommentsOpen, setMobileCommentsOpen] = useState(false);
  const [mobileDragOffsetX, setMobileDragOffsetX] = useState(0);
  const [mobileSwipeAnimating, setMobileSwipeAnimating] = useState(false);
  const [mobileGestureAxis, setMobileGestureAxis] = useState<
    "horizontal" | "vertical" | null
  >(null);
  const [isCurrentImageZoomed, setIsCurrentImageZoomed] = useState(false);
  const [isCurrentImagePinching, setIsCurrentImagePinching] = useState(false);
  const [mobilePostTextExpanded, setMobilePostTextExpanded] = useState(false);
  const [desktopPostTextExpanded, setDesktopPostTextExpanded] = useState(false);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isLandscape, setIsLandscape] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const chromeHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
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
        if (!item || typeof item.url !== "string" || item.url.trim().length === 0) {
          return false;
        }

        if (item.type === "image") return true;
        if (item.type === "video") return Boolean(getVideoSrc(item) || item.thumbnailUrl);
        return false;
      });
    }

    const postMedia = Array.isArray(post.media)
      ? post.media
          .map<ViewerMediaItem | null>((item) => {
            if (item.type === "image") {
              if (typeof item.url !== "string" || item.url.trim().length === 0) {
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
  const previousMedia =
    mediaList.length > 1
      ? mediaList[currentMediaIndex <= 0 ? mediaList.length - 1 : currentMediaIndex - 1]
      : null;
  const nextMedia =
    mediaList.length > 1
      ? mediaList[currentMediaIndex >= mediaList.length - 1 ? 0 : currentMediaIndex + 1]
      : null;

  const totalMedia = mediaList.length;
  const canNavigateMedia = totalMedia > 1;
  const isCurrentVideo = currentMedia?.type === "video";
  const currentVideoSrc = getVideoSrc(currentMedia);
  const currentVideoPoster =
    currentMedia?.type === "video" ? currentMedia.thumbnailUrl ?? undefined : undefined;

  const cleanPostText = typeof post.text === "string" ? post.text.trim() : "";
  const shouldShowMobilePostText = cleanPostText.length > 0;
  const shouldClampMobilePostText = cleanPostText.length > 90;
  const shouldShowDesktopPostText = cleanPostText.length > 0;
  const shouldClampDesktopPostText = cleanPostText.length > 160;

  const remainingSeconds = Math.max(0, Math.ceil(videoDuration - videoCurrentTime));
  const progressPercent =
    videoDuration > 0 ? Math.min(100, Math.max(0, (videoCurrentTime / videoDuration) * 100)) : 0;

  const shouldShowMobileMeta = mobileChromeVisible && !(isCurrentVideo && isLandscape);
  const shouldShowMobileControls = !isCurrentVideo || mobileChromeVisible;

  const clearChromeTimer = useCallback(() => {
    if (chromeHideTimerRef.current !== null) {
      window.clearTimeout(chromeHideTimerRef.current);
      chromeHideTimerRef.current = null;
    }
  }, []);

  const scheduleChromeHide = useCallback(() => {
    if (!isMobile || !isCurrentVideo) return;

    clearChromeTimer();
    chromeHideTimerRef.current = window.setTimeout(() => {
      setMobileChromeVisible(false);
    }, 2600);
  }, [clearChromeTimer, isCurrentVideo, isMobile]);

  function goToPreviousMedia() {
    if (!canNavigateMedia) return;
    setCurrentMediaIndex((current) => (current <= 0 ? totalMedia - 1 : current - 1));
  }

  function goToNextMedia() {
    if (!canNavigateMedia) return;
    setCurrentMediaIndex((current) => (current >= totalMedia - 1 ? 0 : current + 1));
  }

  function showMobileVideoChromeTemporarily() {
    setMobileChromeVisible((visible) => !visible);

    window.setTimeout(() => {
      setMobileChromeVisible((visible) => {
        if (!visible) return visible;
        scheduleChromeHide();
        return visible;
      });
    }, 0);
  }

  useEffect(() => {
    setMobileGestureAxis(null);
    setMobileDragOffsetX(0);
    setIsCurrentImageZoomed(false);
    setIsCurrentImagePinching(false);
    setVideoCurrentTime(0);
    setVideoDuration(currentMedia?.duration ?? 0);
    setMobileChromeVisible(true);
  }, [currentMedia?.url, currentMedia?.type, currentMedia?.duration]);

  useEffect(() => {
    if (!open || mediaList.length === 0) return;

    const selectedUrl = initialMediaUrl || image?.url || null;
    const selectedIndex = selectedUrl
      ? mediaList.findIndex(
          (item) =>
            item.url === selectedUrl ||
            item.thumbnailUrl === selectedUrl ||
            item.playbackUrl === selectedUrl ||
            item.hlsUrl === selectedUrl
        )
      : 0;

    setCurrentMediaIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [image?.url, initialMediaUrl, mediaList, open]);

  useEffect(() => {
    if (!open) {
      setMobileCommentsOpen(false);
      setMobilePostTextExpanded(false);
      setDesktopPostTextExpanded(false);
      clearChromeTimer();
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
    };
  }, [clearChromeTimer, open, onClose, totalMedia]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.currentTime = 0;

    if (open && isCurrentVideo && currentVideoSrc) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => undefined);
      }
      scheduleChromeHide();
    }
  }, [currentMediaIndex, currentVideoSrc, isCurrentVideo, open, scheduleChromeHide]);

  if (!mounted || !open || !currentMedia) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483647,
    background: isMobile ? "#000" : "rgba(0,0,0,0.82)",
    color: "#fff",
    fontFamily: fontStack,
    display: isMobile ? "block" : "grid",
    placeItems: isMobile ? undefined : "center",
    padding: isMobile ? 0 : "22px 0 22px 22px",
    boxSizing: "border-box",
  };

  const closeButtonStyle: CSSProperties = {
    position: "absolute",
    top: isMobile ? "calc(10px + env(safe-area-inset-top))" : 14,
    left: isMobile ? "calc(10px + env(safe-area-inset-left))" : 14,
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

    return (
      <img
        src={media.url}
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

  function renderCurrentMedia() {
    if (currentMedia.type === "video") {
      return (
        <button
          type="button"
          onClick={isMobile ? showMobileVideoChromeTemporarily : undefined}
          aria-label="Mostrar u ocultar controles del video"
          style={{
            position: "absolute",
            inset: 0,
            border: "none",
            padding: 0,
            background: "#000",
            transform: `translateX(${mobileDragOffsetX}px)`,
            transition: mobileSwipeAnimating ? "transform 180ms ease" : "none",
            cursor: isMobile ? "pointer" : "default",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {currentVideoSrc ? (
            <video
              ref={videoRef}
              src={currentVideoSrc}
              poster={currentVideoPoster}
              controls={!isMobile}
              autoPlay
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration;
                setVideoDuration(
                  Number.isFinite(duration) && duration > 0
                    ? duration
                    : currentMedia.duration ?? 0
                );
              }}
              onTimeUpdate={(event) => {
                setVideoCurrentTime(event.currentTarget.currentTime);
              }}
              onPlay={scheduleChromeHide}
              style={{
                width: "100%",
                height: "100%",
                objectFit: isMobile && isLandscape ? "cover" : "contain",
                background: "#000",
              }}
            />
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
        </button>
      );
    }

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateX(${mobileDragOffsetX}px)`,
          transition: mobileSwipeAnimating ? "transform 180ms ease" : "none",
          background: "#000",
        }}
      >
        {isMobile ? (
          <PostPinchZoomImage
            src={currentMedia.url}
            alt={currentMedia.altText || "Imagen de la publicación"}
            onClose={onClose}
            onZoomStateChange={setIsCurrentImageZoomed}
            onPinchStateChange={setIsCurrentImagePinching}
            swipeAxis={mobileGestureAxis}
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
      {(!isCurrentVideo || mobileChromeVisible) && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar visor"
          style={closeButtonStyle}
        >
          ×
        </button>
      )}

      <div
        onTouchStart={(event) => {
          if (
            mobileSwipeAnimating ||
            isCurrentImageZoomed ||
            isCurrentImagePinching
          ) {
            return;
          }

          const touch = event.touches[0];
          if (!touch) return;

          event.currentTarget.dataset.startX = String(touch.clientX);
          event.currentTarget.dataset.startY = String(touch.clientY);
          event.currentTarget.dataset.gestureAxis = "";

          setMobileGestureAxis(null);
          setMobileDragOffsetX(0);
        }}
        onTouchMove={(event) => {
          if (
            mobileSwipeAnimating ||
            isCurrentImageZoomed ||
            isCurrentImagePinching
          ) {
            setMobileDragOffsetX(0);
            return;
          }

          const startX = Number(event.currentTarget.dataset.startX || 0);
          const startY = Number(event.currentTarget.dataset.startY || 0);
          const touch = event.touches[0];

          if (!touch || !startX) return;

          const diffX = touch.clientX - startX;
          const diffY = touch.clientY - startY;
          const absX = Math.abs(diffX);
          const absY = Math.abs(diffY);

          let axis = event.currentTarget.dataset.gestureAxis as
            | "horizontal"
            | "vertical"
            | "";

          if (!axis && (absX > 10 || absY > 10)) {
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
            return;
          }

          if (axis === "vertical") {
            setMobileDragOffsetX(0);
          }
        }}
        onTouchEnd={(event) => {
          if (
            mobileSwipeAnimating ||
            isCurrentImageZoomed ||
            isCurrentImagePinching
          ) {
            setMobileGestureAxis(null);
            setMobileDragOffsetX(0);
            return;
          }

          const axis = event.currentTarget.dataset.gestureAxis;
          const startX = Number(event.currentTarget.dataset.startX || 0);
          const startY = Number(event.currentTarget.dataset.startY || 0);
          const touch = event.changedTouches[0];

          event.currentTarget.dataset.gestureAxis = "";
          setMobileGestureAxis(null);

          if (!canNavigateMedia || axis !== "horizontal" || !touch || !startX) {
            setMobileDragOffsetX(0);
            return;
          }

          const diffX = touch.clientX - startX;
          const diffY = touch.clientY - startY;

          if (Math.abs(diffX) < 65 || Math.abs(diffY) > 90) {
            setMobileSwipeAnimating(true);
            setMobileDragOffsetX(0);
            window.setTimeout(() => setMobileSwipeAnimating(false), 180);
            return;
          }

          const direction = diffX < 0 ? "next" : "prev";
          const targetOffset = direction === "next" ? -window.innerWidth : window.innerWidth;

          setMobileSwipeAnimating(true);
          setMobileDragOffsetX(targetOffset);

          window.setTimeout(() => {
            if (direction === "next") goToNextMedia();
            else goToPreviousMedia();

            setMobileDragOffsetX(0);
            setMobileSwipeAnimating(false);
          }, 180);
        }}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          touchAction: "none",
          background: "#000",
        }}
      >
        {renderMediaPreview(previousMedia, "Anterior")}
        {renderCurrentMedia()}
        {renderMediaPreview(nextMedia, "Siguiente")}
      </div>

      {canNavigateMedia && shouldShowMobileControls && (
        <div
          style={{
            position: "fixed",
            right: "calc(16px + env(safe-area-inset-right))",
            bottom: isCurrentVideo
              ? "calc(88px + env(safe-area-inset-bottom))"
              : "calc(16px + env(safe-area-inset-bottom))",
            zIndex: 2147483647,
            minHeight: 22,
            padding: "4px 0",
            color: "rgba(255,255,255,0.92)",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            textShadow: "0 1px 8px rgba(0,0,0,0.75)",
          }}
        >
          {currentMediaIndex + 1}/{totalMedia}
        </div>
      )}

      {isCurrentVideo && shouldShowMobileControls && (
        <div
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: shouldShowMobileMeta
              ? "calc(104px + env(safe-area-inset-bottom))"
              : "calc(22px + env(safe-area-inset-bottom))",
            zIndex: 2147483647,
            display: "grid",
            gap: 6,
          }}
        >
          <div
            style={{
              justifySelf: "end",
              padding: "3px 7px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.58)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            -{formatMediaDuration(remainingSeconds)}
          </div>
          <div
            aria-hidden="true"
            style={{
              position: "relative",
              height: 3,
              borderRadius: 999,
              background: "rgba(255,255,255,0.28)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                background: "#fff",
              }}
            />
          </div>
        </div>
      )}

      {shouldShowMobileMeta && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2147483646,
            padding: "14px 16px calc(14px + env(safe-area-inset-bottom))",
            background:
              "linear-gradient(to top, rgba(0,0,0,0.86), rgba(0,0,0,0.42), transparent)",
            display: "grid",
            gap: 7,
            justifyItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                maxWidth: "calc(100vw - 32px)",
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
                    style={{ color: "rgba(255,255,255,0.34)", fontSize: 12 }}
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
                      <Avatar name={group.name} avatarUrl={group.avatarUrl} size={15} />
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
                      <Avatar name={group.name} avatarUrl={group.avatarUrl} size={15} />
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
                width: "fit-content",
                color: "rgba(255,255,255,0.58)",
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

          {shouldShowMobilePostText && (
            <div
              style={{
                maxWidth: "calc(100vw - 32px)",
                color: "rgba(255,255,255,0.86)",
                fontSize: 12,
                fontWeight: 300,
                lineHeight: 1.35,
                wordBreak: "break-word",
              }}
            >
              {!mobilePostTextExpanded ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    maxWidth: "100%",
                    minWidth: 0,
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cleanPostText}
                  </span>

                  {shouldClampMobilePostText && (
                    <button
                      type="button"
                      onClick={() => setMobilePostTextExpanded(true)}
                      style={{
                        flexShrink: 0,
                        border: "none",
                        background: "transparent",
                        color: "rgba(255,255,255,0.78)",
                        padding: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: fontStack,
                        cursor: "pointer",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      + Ver más
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ whiteSpace: "pre-wrap" }}>
                  {cleanPostText}
                  {shouldClampMobilePostText && (
                    <button
                      type="button"
                      onClick={() => setMobilePostTextExpanded(false)}
                      style={{
                        marginLeft: 6,
                        border: "none",
                        background: "transparent",
                        color: "rgba(255,255,255,0.78)",
                        padding: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: fontStack,
                        cursor: "pointer",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      - Ver menos
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              display: "inline-flex",
              justifyContent: "flex-start",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div style={actionGroupStyle}>
              <button
                type="button"
                onClick={onToggleFlame}
                disabled={flameBusy}
                aria-pressed={viewerHasFlamed}
                aria-label={
                  viewerHasFlamed
                    ? "Quitar flamita de la publicación"
                    : "Dar flamita a la publicación"
                }
                style={{
                  ...actionButtonStyle,
                  opacity: flameBusy ? 0.62 : 1,
                  cursor: flameBusy ? "not-allowed" : "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 21,
                    lineHeight: 1,
                    filter: viewerHasFlamed ? "none" : "grayscale(1)",
                    opacity: viewerHasFlamed ? 1 : 0.6,
                  }}
                >
                  🔥
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
                  cursor: !onOpenFlames || likesCount === 0 ? "default" : "pointer",
                }}
              >
                {likesCount}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onOpenComments();
                setMobileCommentsOpen(true);
              }}
              aria-label="Abrir comentarios"
              style={actionButtonStyle}
            >
              <span aria-hidden="true" style={{ fontSize: 21, lineHeight: 1 }}>
                💬
              </span>
              <span>{commentsCount}</span>
            </button>
          </div>
        </div>
      )}

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
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar visor"
            style={closeButtonStyle}
          >
            ×
          </button>

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
                  const duration = event.currentTarget.duration;
                  setVideoDuration(
                    Number.isFinite(duration) && duration > 0
                      ? duration
                      : currentMedia.duration ?? 0
                  );
                }}
                onTimeUpdate={(event) => setVideoCurrentTime(event.currentTarget.currentTime)}
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

          {canNavigateMedia && (
            <div
              style={{
                position: "absolute",
                right: 14,
                bottom: 14,
                zIndex: 6,
                minHeight: 24,
                padding: "5px 8px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.46)",
                color: "rgba(255,255,255,0.88)",
                fontSize: 11,
                fontWeight: 650,
                lineHeight: 1,
              }}
            >
              {currentMediaIndex + 1}/{totalMedia}
            </div>
          )}

          {canNavigateMedia && (
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
              <Avatar name={author.authorName} avatarUrl={author.avatarUrl} size={38} />
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
                        <Avatar name={group.name} avatarUrl={group.avatarUrl} size={16} />
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
                        <Avatar name={group.name} avatarUrl={group.avatarUrl} size={16} />
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
                        onClick={() => setDesktopPostTextExpanded((prev) => !prev)}
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
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                marginTop: 0,
              }}
            >
              <div style={actionGroupStyle}>
                <button
                  type="button"
                  onClick={onToggleFlame}
                  disabled={flameBusy}
                  aria-pressed={viewerHasFlamed}
                  aria-label={
                    viewerHasFlamed
                      ? "Quitar flamita de la publicación"
                      : "Dar flamita a la publicación"
                  }
                  style={{
                    ...actionButtonStyle,
                    opacity: flameBusy ? 0.62 : 1,
                    cursor: flameBusy ? "not-allowed" : "pointer",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      fontSize: 19,
                      lineHeight: 1,
                      filter: viewerHasFlamed ? "none" : "grayscale(1)",
                      opacity: viewerHasFlamed ? 1 : 0.6,
                    }}
                  >
                    🔥
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
                    cursor: !onOpenFlames || likesCount === 0 ? "default" : "pointer",
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
                <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>
                  💬
                </span>
                <span>{commentsCount}</span>
              </button>
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

  return createPortal(isMobile ? mobileContent : desktopContent, document.body);
}
