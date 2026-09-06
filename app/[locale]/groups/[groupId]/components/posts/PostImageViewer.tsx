"use client";

import { useDirectionFactor } from "@/lib/i18n/useDirectionFactor";

import { TextButton, IconButton, MenuLinesIcon } from "@/components/ui";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import type { Post } from "@/lib/posts/types";
import PostPinchZoomImage from "./PostPinchZoomImage";
import PostSaveButton from "@/components/ui/PostSaveButton";
import PostShareButton from "@/components/ui/PostShareButton";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import VibraCommentIcon from "@/app/components/VibraServiceIcons/VibraCommentIcon";
import {
  VideoMuteIcon,
  VideoUnmuteIcon,
  VideoExpandIcon,
  VideoCompressIcon,
  VideoPlayIcon,
  VideoPauseIcon,
  VideoSkipBackIcon,
  VideoSkipForwardIcon,
  VideoPipIcon,
  VideoAirPlayIcon,
} from "@/app/components/VibraServiceIcons/VibraVideoIcons";
import { usePwaInstalled } from "@/lib/hooks/usePwaInstalled";
import {
  fontStack,
  formatMediaDuration,
  getVideoSrc,
} from "./PostImageViewer.utils";
import { Avatar } from "./PostImageViewer.components";

// Z-index base de los overlays del viewer. Se deja apenas por debajo del máximo
// (2147483647) para reservar cabecera al menú de acciones del post, que debe
// poder mostrarse POR ENCIMA del viewer cuando se abre desde sus 3 puntos.
const VIEWER_OVERLAY_Z = 2147480000;

/**
 * Salida del visor en celular: la imagen o el video se deslizan hacia abajo y se
 * desvanecen. Mismo tiempo y misma curva que `CommentImageLightbox`, el visor de
 * las imágenes de comentarios y mensajes, para que el gesto se sienta igual en
 * toda la plataforma.
 *
 * El video sigue reproduciéndose: mientras corre la animación el elemento
 * `<video controlsList="noremoteplayback">` sigue vivo, y al terminar `handleMobileClose` lo devuelve a su hueco
 * del feed con la posición intacta.
 */
const MOBILE_CLOSE_MS = 240;
const MOBILE_CLOSE_EASE = "ease-in";

/** Recorrido del dedo, en px, que apaga del todo el velo. */
const MOBILE_DRAG_FADE_PX = 320;

/**
 * Tamaño de la caja del medio en laptop.
 *
 * La altura es quien manda: un medio vertical crece hasta este alto y su ancho
 * sale de la proporción. Los apaisados se topan antes con el ancho disponible,
 * así que el margen lateral del overlay va emparejado aquí: subir la altura sin
 * bajar el margen no agranda un video 16:9, solo le deja franjas negras.
 */
const DESKTOP_MEDIA_HEIGHT = "min(86dvh, 826px)";
const DESKTOP_OVERLAY_PADDING = "16px 4vw";

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
  sourceRect?: DOMRect | null;
  initialVideoTime?: number;
  onVideoClose?: (currentTime: number) => void;
  externalVideoElement?: HTMLVideoElement | null;
  /** Muestra el botón de 3 puntos (menú de acciones del post) dentro del viewer. */
  showActionsMenu?: boolean;
  /** Abre el mismo menú de "..." del post, por encima del viewer. */
  onOpenActionsMenu?: () => void;
};

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
  sourceRect = null,
  initialVideoTime,
  onVideoClose,
  externalVideoElement = null,
  showActionsMenu = false,
  onOpenActionsMenu,
}: PostImageViewerProps) {
  const tGroups = useTranslations("groups");
  const tPosts = useTranslations("posts");
  const tCommon = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [showExactDate, setShowExactDate] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [mobileCommentsOpen, setMobileCommentsOpen] = useState(false);
  // +1 / -1 según el sentido de lectura. El arrastre se guarda en LÓGICO (el dedo
  // se multiplica al leerlo), así los umbrales y el "diffX < 0 ⇒ siguiente" siguen
  // valiendo; se vuelve a multiplicar solo al pintar el translateX.
  const dirX = useDirectionFactor();
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
  /**
   * Si se puede sacar el video a la ventanita flotante.
   *
   * En el iPhone instalado como app NO se puede: la ventanita es de Safari
   * y una app en pantalla completa no la tiene, asi que el boton estaba ahi
   * sin hacer absolutamente nada. En Safari dentro del navegador si, y en
   * Android tambien, asi que ahi se queda.
   *
   * `resuelto` en falso es el primer render, donde todavia no hay navegador
   * que preguntar. Se oculta hasta saberlo: el visor se abre al tocar un
   * video, mucho despues de hidratar, asi que no se ve aparecer.
   */
  const pwa = usePwaInstalled();
  const hayPip = pwa.resuelto && !(pwa.plataforma === "ios" && pwa.instalada);

  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [, setIsLandscape] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [isTouchCapable, setIsTouchCapable] = useState(false);
  const [videoPlaybackRate, setVideoPlaybackRateState] = useState(1);
  const [desktopSpeedMenuOpen, setDesktopSpeedMenuOpen] = useState(false);
  const [mobileSpeedMenuOpen, setMobileSpeedMenuOpen] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  // Solo entrada: la caja crece desde la miniatura del feed hasta pantalla
  // completa. La salida NO usa fases —se cierra deslizando hacia abajo, igual
  // que el visor de imágenes de comentarios y mensajes (`CommentImageLightbox`).
  const [heroPhase, setHeroPhase] = useState<"entering" | "open">("open");
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
  const pivRef1 = useRef<HTMLDivElement>(null);
  const pivRef2 = useRef<HTMLDivElement>(null);
  const externalVideoSlotRef = useRef<HTMLDivElement | null>(null);
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
  const savedPositionsRef = useRef<Map<string, number>>(new Map());
  const lastVideoSrcRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);

    if (typeof window !== "undefined") {
      setIsTouchCapable(
        window.matchMedia?.("(pointer: coarse)")?.matches === true ||
          navigator.maxTouchPoints > 0,
      );
      const safeEl = document.createElement("div");
      safeEl.style.cssText = "position:fixed;height:env(safe-area-inset-top,0px);top:0;inset-inline-start:-9999px;pointer-events:none;visibility:hidden;";
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
                altText: item.altText ?? tPosts("videoAlt"),
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

  /**
   * Proporción real del video, leída del propio elemento.
   *
   * Es lo que hace que la carcasa de escritorio se ajuste a un video vertical en
   * vez de abrirse apaisada, igual que ya ocurría con las imágenes. Los tres
   * caminos que montan video (el del escritorio, el de celular y el elemento que
   * se muda desde el feed) pasan por aquí.
   */
  function applyVideoAspectRatio(el: HTMLVideoElement | null | undefined) {
    if (!el) return;
    const { videoWidth: w, videoHeight: h } = el;
    if (w > 0 && h > 0) setMediaAspectRatio(w / h);
  }

  // Reset aspect ratio when media changes
  useEffect(() => {
    setMediaAspectRatio(null);
    // Un video que llega ya cargado —el que se muda desde el feed— no volverá a
    // emitir `loadedmetadata`, así que si esperásemos al evento se quedaría sin
    // medir y la carcasa saldría apaisada. Se lee a mano.
    if (currentMedia?.type === "video") {
      const el = externalVideoElement ?? videoRef.current;
      if (el && el.readyState >= 1) applyVideoAspectRatio(el);
    }
  }, [currentMedia?.url, currentMedia?.type, externalVideoElement]);

  // Load image natural dimensions to compute precise clip-path
  useEffect(() => {
    if (!currentMedia || currentMedia.type === "video" || !currentMedia.url) return;
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setMediaAspectRatio(img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = currentMedia.url;
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = videoMuted;
  }, [videoMuted]);

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
    if (!isCurrentVideo) return;

    clearDesktopControlsTimer();
    desktopControlsHideTimerRef.current = window.setTimeout(() => {
      setDesktopControlsVisible(false);
      setDesktopSpeedMenuOpen(false);
    }, 1000);
  }, [clearDesktopControlsTimer, isCurrentVideo]);

  const revealDesktopControls = useCallback(() => {
    setDesktopControlsVisible(true);
    clearDesktopControlsTimer();
  }, [clearDesktopControlsTimer]);

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
      if (useMobileLayout) {
        setMobileChromeVisible(true);
        scheduleChromeHide();
      }
    } else {
      video.pause();
      if (useMobileLayout) {
        clearChromeTimer();
        setMobileChromeVisible(true);
      }
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
      const isMobileVideoFullscreen =
        document.fullscreenElement === videoRef.current;

      if (isShellFullscreen && videoRef.current) {
        videoRef.current.controls = false;
      }

      setDesktopFullscreenActive(isShellFullscreen);
      setDesktopControlsVisible(true);
      setMobileVideoTrueFullscreen(isMobileVideoFullscreen);

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
    if (isCurrentVideo && videoPlaying) {
      scheduleDesktopControlsHide();
      return;
    }

    clearDesktopControlsTimer();
    setDesktopControlsVisible(true);
  }, [
    clearDesktopControlsTimer,
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
      setMobileSpeedMenuOpen(false);
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

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearMobileSingleTapTimer();
      mobileLastVideoTapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearChromeTimer, clearDesktopControlsTimer, open, onClose, totalMedia]);

  useBodyScrollLock(open);

  // Insert external video into viewer slot synchronously before first paint
  useLayoutEffect(() => {
    const slot = externalVideoSlotRef.current;
    if (!slot || !externalVideoElement) return;
    // Clear controls BEFORE appending so no native UI flashes during the opening animation
    externalVideoElement.controls = false;
    slot.appendChild(externalVideoElement);
    externalVideoElement.style.objectFit = "contain";
    /**
     * El sonido pasa a mandarlo el visor, y se dice aquí en vez de confiar en
     * que el efecto del silencio corra después.
     *
     * El elemento viene de la galería del feed, donde se crea MUDO a propósito
     * —así puede arrancar solo— y donde el arranque del HLS se lo vuelve a
     * poner. Al adoptarlo, si nadie le quita el silencio de forma explícita, el
     * video se ve pero no se oye.
     */
    externalVideoElement.muted = videoMuted;
    if (useMobileLayout) {
      // Mobile: gesture container must receive touch events; video must not intercept them
      externalVideoElement.style.pointerEvents = "none";
    } else {
      externalVideoElement.style.pointerEvents = "none";
    }
    videoRef.current = externalVideoElement;
    return () => {
      externalVideoElement.style.pointerEvents = "";
      externalVideoElement.controls = false;
      videoRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalVideoElement]);

  // Sync viewer UI state from external video element (timeupdate, play/pause, etc.)
  useEffect(() => {
    if (!externalVideoElement) return;

    function onTimeUpdate() { setVideoCurrentTime(externalVideoElement!.currentTime); }
    function onPlay() {
      setVideoPlaying(true);
      if (useMobileLayout) scheduleChromeHide();
    }
    function onPause() { setVideoPlaying(false); }
    function onEnded() {
      setVideoPlaying(false);
      if (useMobileLayout) { clearChromeTimer(); setMobileChromeVisible(true); }
    }
    function onLoadedMetadata() {
      const d = externalVideoElement!.duration;
      if (Number.isFinite(d) && d > 0) setVideoDuration(d);
      applyVideoAspectRatio(externalVideoElement);
      setVideoReady(true);
    }

    externalVideoElement.addEventListener("timeupdate", onTimeUpdate);
    externalVideoElement.addEventListener("play", onPlay);
    externalVideoElement.addEventListener("pause", onPause);
    externalVideoElement.addEventListener("ended", onEnded);
    externalVideoElement.addEventListener("loadedmetadata", onLoadedMetadata);

    // Sync initial state from already-playing video
    setVideoCurrentTime(externalVideoElement.currentTime);
    setVideoPlaying(!externalVideoElement.paused);
    if (externalVideoElement.readyState >= 1) {
      const d = externalVideoElement.duration;
      if (Number.isFinite(d) && d > 0) setVideoDuration(d);
      applyVideoAspectRatio(externalVideoElement);
      setVideoReady(true);
    }

    // Video is already playing when viewer opens — hide chrome so pause icon doesn't flash
    if (!externalVideoElement.paused && useMobileLayout) {
      setMobileChromeVisible(false);
    }

    return () => {
      externalVideoElement.removeEventListener("timeupdate", onTimeUpdate);
      externalVideoElement.removeEventListener("play", onPlay);
      externalVideoElement.removeEventListener("pause", onPause);
      externalVideoElement.removeEventListener("ended", onEnded);
      externalVideoElement.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalVideoElement]);

  // ── RAF: scrubber suave a 60fps — actualiza --pct directo al DOM ──────────
  useEffect(() => {
    if (!videoReady) return;
    let rafId: number;
    const tick = () => {
      const v = videoRef.current;
      if (v && isFinite(v.currentTime) && isFinite(v.duration) && v.duration > 0) {
        const pct = `${Math.min(100, v.currentTime / v.duration * 100).toFixed(2)}%`;
        if (pivRef1.current) pivRef1.current.style.setProperty("--pct", pct);
        if (pivRef2.current) pivRef2.current.style.setProperty("--pct", pct);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      if (pivRef1.current) pivRef1.current.style.setProperty("--pct", "0%");
      if (pivRef2.current) pivRef2.current.style.setProperty("--pct", "0%");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Skip for external video — it's already playing from the feed, no need to reset/seek/play
    if (externalVideoElement) return;

    // Save position of the previous video before resetting
    if (lastVideoSrcRef.current && video.currentTime > 0.5) {
      savedPositionsRef.current.set(lastVideoSrcRef.current, video.currentTime);
    }

    video.pause();
    video.currentTime = 0;
    video.playbackRate = videoPlaybackRate;

    if (open && isCurrentVideo && currentVideoSrc) {
      // Restore saved position; fall back to initialVideoTime (feed video sync) if no saved position
      const saved = savedPositionsRef.current.get(currentVideoSrc);
      const startTime = (saved !== undefined && saved > 0) ? saved : (initialVideoTime ?? 0);
      if (startTime > 0) {
        video.currentTime = startTime;
        setVideoCurrentTime(startTime);
      }
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          /**
           * iOS NO deja arrancar un video con sonido si la orden no sale de un
           * toque directo. Abrir el visor sí viene de un toque, pero esto corre
           * en un efecto —o sea, en otra tarea—, así que Safari lo trata como
           * automático y lo rechaza.
           *
           * Antes el rechazo se tragaba en silencio y el video se quedaba
           * congelado en su portada, sin decir por qué. Ahora se reintenta en
           * mudo, que es lo único que iOS permite arrancar solo, y el botón de
           * sonido —que ya existe— queda como la forma de recuperarlo con un
           * toque.
           */
          const node = videoRef.current;
          if (!node) return;
          node.muted = true;
          setVideoMuted(true);
          void node.play().catch(() => undefined);
        });
      }
      scheduleChromeHide();
    }

    lastVideoSrcRef.current = currentVideoSrc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentMediaIndex,
    currentVideoSrc,
    externalVideoElement,
    isCurrentVideo,
    open,
    scheduleChromeHide,
  ]);

  // Hero transition: reset phase when viewer opens
  useLayoutEffect(() => {
    if (!open || !isMobile) return;
    setHeroPhase(sourceRect ? "entering" : "open");
  }, [open, isMobile, sourceRect]);

  // Hero transition: fire the CSS animation after initial FLIP frame is painted
  useEffect(() => {
    if (heroPhase !== "entering") return;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setHeroPhase("open"))
    );
    return () => cancelAnimationFrame(id);
  }, [heroPhase]);

  function handleMobileClose() {
    if (onVideoClose && videoRef.current && isCurrentVideo) {
      onVideoClose(videoRef.current.currentTime);
    }
    onClose();
  }

  if (!mounted || !open || !currentMedia) return null;

  const heroActive = isMobile && sourceRect != null;

  // Animate the outer container from sourceRect → fullscreen (no squish, no clip-path artifacts)
  function getHeroContainerStyle() {
    if (!heroActive) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = sourceRect!;
    const ease = "cubic-bezier(0.22,1,0.36,1)";
    const dur = 340;

    if (heroPhase === "entering") {
      return { insetInlineStart: r.left, top: r.top, width: r.width, height: r.height, borderRadius: 12, background: "transparent", transition: undefined as string | undefined };
    }

    // "open" — may have drag in progress.
    //
    // Al arrastrar hacia abajo el contenedor NO se encoge hacia la miniatura: se
    // queda a pantalla completa haciendo de velo, y quien baja es la superficie
    // de dentro (ver `renderCurrentMedia`). Antes se movía y encogía aquí Y la
    // imagen volvía a trasladarse dentro, así que el gesto avanzaba al doble y
    // en diagonal.
    //
    // El fondo se queda NEGRO SÓLIDO: quien lo transparenta es la opacidad del
    // contenedor entero (ver `mobileContent`). Aclararlo también aquí lo haría
    // dos veces.
    if (mobileDragOffsetY > 0) {
      return {
        insetInlineStart: 0,
        top: 0,
        width: vw,
        height: vh,
        borderRadius: 0,
        background: "#000",
        // Este objeto se esparce DESPUÉS de la transición del contenedor, así que
        // hay que repetirla aquí o el spread la anularía y la opacidad saltaría a
        // 0 de golpe al soltar. Durante el arrastre, sin transición: sigue al dedo.
        transition: mobileSwipeAnimating
          ? `opacity ${MOBILE_CLOSE_MS}ms ${MOBILE_CLOSE_EASE}`
          : (undefined as string | undefined),
      };
    }

    // Fullscreen
    return { insetInlineStart: 0, top: 0, width: vw, height: vh, borderRadius: 0, background: "#000", transition: `left ${dur}ms ${ease}, top ${dur}ms ${ease}, width ${dur}ms ${ease}, height ${dur}ms ${ease}, border-radius ${dur}ms ${ease}, background 300ms ease` };
  }

  const heroContainerStyle = getHeroContainerStyle();
  const controlsOpacity = (() => {
    // El arrastre apaga los controles enseguida, haya hero o no. Antes sin hero
    // se quedaban a plena opacidad y, ahora que el velo deja ver el feed, se
    // verían flotando sobre él.
    if (mobileDragOffsetY > 0) return Math.max(0, 1 - mobileDragOffsetY / 80);
    if (!heroActive) return 1;
    if (heroPhase !== "open") return 0;
    return 1;
  })();
  const controlsTransition = heroPhase === "open" && mobileDragOffsetY === 0
    ? "opacity 200ms ease 260ms"
    : "opacity 100ms ease";

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    height: "var(--vb-alto-pantalla)",
    zIndex: VIEWER_OVERLAY_Z,
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
    insetInlineStart: useMobileLayout ? "calc(10px + env(safe-area-inset-left))" : 14,
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
    outline: "none",
    boxShadow: "none",
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
    outline: "none",
    boxShadow: "none",
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

const topBtnStyle: CSSProperties = {
  width: 36, height: 36,
  borderRadius: "50%",
  background: "rgba(0,0,0,0.46)",
  border: "none",
  display: "grid", placeItems: "center",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  outline: "none",
  boxShadow: "none",
  flexShrink: 0,
};

const liveBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "rgba(255,255,255,0.9)",
  padding: "0 5px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  WebkitTapHighlightColor: "transparent",
  outline: "none",
  boxShadow: "none",
  flexShrink: 0,
};

  const mobileVerticalProgress = useMobileLayout
    ? Math.min(1, Math.max(0, mobileDragOffsetY / Math.max(1, window.innerHeight)))
    : 0;
  // El medio se apaga a la par que el velo: mismo recorrido de referencia
  // (`MOBILE_DRAG_FADE_PX`) y misma pendiente. Antes se medía contra el alto de
  // la pantalla, así que en el umbral de cierre apenas había bajado a 0.79 y el
  // desvanecimiento no se notaba; ahora cae de forma continua mientras el dedo
  // baja, y cuanto más lejos, más transparente.
  const mobileFadeProgress = useMobileLayout
    ? Math.min(1, Math.max(0, mobileDragOffsetY / MOBILE_DRAG_FADE_PX))
    : 0;
  const mobileOverlayOpacity = mobileVerticalClosing
    ? 0
    : 1 - mobileFadeProgress * 0.85;
  const mobileVerticalScale = 1 - Math.min(0.08, mobileVerticalProgress * 0.12);

  // ¿La superficie se está moviendo en vertical? Incluye el cierre, no solo el
  // arrastre: `onTouchEnd` pone el eje a null antes de lanzar la salida, así que
  // mirando solo el eje la superficie perdía el desplazamiento y volvía a subir
  // justo cuando debía irse hacia abajo.
  const mobileVerticalActive =
    mobileGestureAxis === "vertical" || mobileVerticalClosing;

  // Transición de la superficie que sigue al gesto. Al cerrar hacia abajo toma
  // el tiempo y la curva de `CommentImageLightbox` y arrastra también la
  // opacidad (antes saltaba a 0 de golpe). La opacidad va también en el caso
  // corto: es el que devuelve el medio a su sitio cuando sueltas sin llegar al
  // umbral, y sin ella el brillo volvería de golpe mientras la posición aún
  // está viajando.
  const mobileSurfaceTransition = mobileSwipeAnimating
    ? mobileVerticalClosing
      ? `transform ${MOBILE_CLOSE_MS}ms ${MOBILE_CLOSE_EASE}, opacity ${MOBILE_CLOSE_MS}ms ${MOBILE_CLOSE_EASE}`
      : "transform 180ms ease, opacity 180ms ease"
    : undefined;

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
                ? `translateX(calc(${-100 * dirX}% + ${mobileDragOffsetX * dirX}px))`
                : `translateX(calc(${100 * dirX}% + ${mobileDragOffsetX * dirX}px))`,
            transition: mobileSwipeAnimating ? "transform 180ms ease" : "none",
            display: "grid",
            placeItems: "center",
          }}
        >
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
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
              paddingInlineStart: 4,
            }}
          >
            ▶
          </span>
        </div>
      );
    }

const previewUrl = media.url;

    return (
      // eslint-disable-next-line @next/next/no-img-element
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
              ? `translateX(calc(${-100 * dirX}% + ${mobileDragOffsetX * dirX}px))`
              : `translateX(calc(${100 * dirX}% + ${mobileDragOffsetX * dirX}px))`,
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

  // For iOS Safari: clip-path on a parent doesn't clip <video controlsList="noremoteplayback"> (GPU compositing layer).
  // Apply clip-path directly to the <video controlsList="noremoteplayback"> element, adjusted for safe-area-inset-top
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
          {externalVideoElement ? (
            <div
              ref={externalVideoSlotRef}
              style={{ position: "absolute", inset: 0, background: "#000" }}
            />
          ) : currentVideoSrc ? (
            <>
              {currentVideoPoster && !videoReady ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentVideoPoster}
                  alt={currentMedia.altText || tPosts("videoCoverAlt")}
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

              <video controlsList="noremoteplayback"
                ref={videoRef}
                src={currentVideoSrc}
                poster={currentVideoPoster}
                controls={!useMobileLayout || mobileVideoTrueFullscreen}
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
                onPlay={() => { setVideoPlaying(true); if (useMobileLayout) scheduleChromeHide(); }}
                onPause={() => setVideoPlaying(false)}
                onEnded={() => {
                  setVideoPlaying(false);
                  if (useMobileLayout) { clearChromeTimer(); setMobileChromeVisible(true); }
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#000",
                  opacity: videoReady || !currentVideoPoster ? 1 : 0,
                  pointerEvents: "none",
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
            // Con o sin hero, la superficie es la que baja: el contenedor de
            // fuera se queda quieto haciendo de velo.
            transform: mobileVerticalActive
              ? `translate3d(0, ${mobileDragOffsetY}px, 0) scale(${mobileVerticalScale})`
              : `translate3d(${mobileDragOffsetX * dirX}px, 0, 0) scale(1)`,
            transition: mobileSurfaceTransition,
            // Sin opacidad propia: la pone el contenedor de fuera, para todo el
            // visor a la vez. Aquí solo se mueve.
            background: "#000",
          }}
        >
          {videoSurface}
        </div>
      );
    }

    return (
      <div
        ref={mobileContentClipRef}
        style={{
          position: "absolute",
          inset: 0,
          transform: mobileVerticalActive
            ? `translate3d(0, ${mobileDragOffsetY}px, 0) scale(${mobileVerticalScale})`
            : `translate3d(${mobileDragOffsetX * dirX}px, 0, 0) scale(1)`,
          transition: mobileSurfaceTransition,
          // Sin opacidad propia; ver la superficie de video.
          background: "#000",
        }}
      >
        {useMobileLayout ? (
          <PostPinchZoomImage
            key={currentMediaKey}
            src={currentMedia.url}
            alt={currentMedia.altText || tPosts("imageAlt")}
            onClose={onClose}
            onZoomStateChange={setIsCurrentImageZoomed}
            onPinchStateChange={setIsCurrentImagePinching}
            swipeAxis="horizontal"
            disableMinHeight
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentMedia.url}
            alt={currentMedia.altText || tPosts("imageAlt")}
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
    <div
      style={{
        position: "fixed",
        zIndex: VIEWER_OVERLAY_Z,
        display: "flex",
        flexDirection: "column",
        fontFamily: fontStack,
        userSelect: "none",
        WebkitUserSelect: "none",
        color: "#fff",
        overflow: "hidden",
        // TODO el visor se transparenta a la vez mientras arrastras: fondo negro,
        // imagen y controles. Es la única forma sensata de dejar ver el feed de
        // detrás —dentro hay ocho capas con `background: #000` propias (el marco
        // del visor de pellizco, el <img>, las superficies de video…), y volverlas
        // transparentes una a una es una lista que se desactualiza sola.
        //
        // Aquí es donde se hace, y por eso las capas de dentro NO tocan su
        // opacidad: se multiplicaría.
        opacity: mobileOverlayOpacity,
        // La transición la trae cada rama (con y sin hero): ponerla también aquí
        // la duplicaría y el spread de abajo se quedaría con la última.
        ...(heroContainerStyle ?? {
          inset: 0,
          background: "#000",
          transition: mobileSwipeAnimating
            ? `opacity ${MOBILE_CLOSE_MS}ms ${MOBILE_CLOSE_EASE}`
            : undefined,
        }),
      }}
    >
      {/* ── Media area ── */}
      <div
        ref={mobileMediaClipRef}
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

          const diffX = (touch.clientX - startX) * dirX;
          const diffY = touch.clientY - startY;

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

          if (!touch || !startX) {
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(0);
            return;
          }

          const diffX = (touch.clientX - startX) * dirX;
          const diffY = touch.clientY - startY;

          if (axis === "vertical" && diffY > 120) {
            // Salida única: se va hacia abajo y se desvanece, venga de una
            // miniatura del feed (hero) o no. Antes, con hero, se encogía de
            // vuelta al hueco del feed; el gesto de bajar el dedo y ver la
            // imagen irse en diagonal no acompañaba.
            //
            // `handleMobileClose` (y no `onClose` a secas) es obligatorio: es
            // quien entrega la posición del video al feed para que siga
            // reproduciéndose donde iba.
            setMobileVerticalClosing(true);
            setMobileSwipeAnimating(true);
            setMobileDragOffsetX(0);
            setMobileDragOffsetY(window.innerHeight);
            window.setTimeout(() => {
              handleMobileClose();
              setMobileDragOffsetY(0);
              setMobileDragOffsetX(0);
              setMobileVerticalClosing(false);
              setMobileSwipeAnimating(false);
            }, MOBILE_CLOSE_MS);
            return;
          }

          if (axis === "vertical") {
            setMobileSwipeAnimating(true);
            setMobileDragOffsetY(0);
            window.setTimeout(() => setMobileSwipeAnimating(false), 180);
            return;
          }

          if (!axis && Math.abs(diffX) < 10 && Math.abs(diffY) < 10) {
            if (isCurrentVideo) {
              if (mobileChromeVisible) {
                clearChromeTimer();
                setMobileChromeVisible(false);
              } else {
                setMobileChromeVisible(true);
                scheduleChromeHide();
              }
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
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          touchAction: "none",
          background: "#000",
          WebkitTouchCallout: "none",
        }}
      >
        {/* Top bar: menú izquierda | [mute, expand, ×] derecha */}
        <div
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 0,
            insetInlineStart: 0,
            insetInlineEnd: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: "max(12px, env(safe-area-inset-top))",
            paddingBottom: 8,
            paddingInlineStart: "max(8px, env(safe-area-inset-left))",
            paddingInlineEnd: "max(8px, env(safe-area-inset-right))",
            opacity: controlsOpacity,
            transition: controlsTransition,
          }}
        >
          {/* Menú de acciones del post + PiP · AirPlay — izquierda */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {showActionsMenu && onOpenActionsMenu && (
            <IconButton label={tPosts("moreOptions")} size="sm" tone="bare" shape="square" style={{ boxShadow: "none" }} onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onOpenActionsMenu(); }} onClick={(e) => { e.stopPropagation(); onOpenActionsMenu(); }}>
              <MenuLinesIcon size={22} />
            </IconButton>
          )}
          {isCurrentVideo && !mobileVideoTrueFullscreen ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4, opacity: mobileChromeVisible ? 1 : 0, transition: "opacity 220ms ease", pointerEvents: mobileChromeVisible ? "auto" : "none" }}>
              {hayPip && (
              <IconButton label="Picture in Picture" size="sm" tone="bare" shape="square" style={{ boxShadow: "none" }} onTouchEnd={(e) => { e.preventDefault(); const v = videoRef.current; if (!v) return; if (document.pictureInPictureElement) { void document.exitPictureInPicture(); } else if (document.pictureInPictureEnabled) { void v.requestPictureInPicture(); } }} onClick={(e) => { e.stopPropagation(); }}>
                <VideoPipIcon size={25} />
              </IconButton>
              )}
              {typeof window !== "undefined" && "WebKitPlaybackTargetAvailabilityEvent" in window && (
                <IconButton label="AirPlay" size="sm" tone="bare" shape="square" style={{ boxShadow: "none" }} onTouchEnd={(e) => { e.preventDefault(); const v = videoRef.current as HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }; v?.webkitShowPlaybackTargetPicker?.(); }} onClick={(e) => { e.stopPropagation(); }}>
                  <VideoAirPlayIcon size={25} />
                </IconButton>
              )}
            </div>
          ) : null}
          </div>

          {/* Derecha: mute + expand + × */}
          <div style={{ display: "flex", alignItems: "center" }}>
            {isCurrentVideo && !mobileVideoTrueFullscreen && (
              <div style={{ display: "flex", alignItems: "center", opacity: mobileChromeVisible ? 1 : 0, transition: "opacity 220ms ease", pointerEvents: mobileChromeVisible ? "auto" : "none" }}>
                {/* Mute */}
                <IconButton label={videoMuted ? tCommon("unmute") : tCommon("muteAriaLabel")} size="sm" tone="bare" shape="square" style={{ boxShadow: "none" }} onTouchEnd={(e) => { e.preventDefault(); setVideoMuted((m) => !m); }} onClick={() => setVideoMuted((m) => !m)}>
                  {videoMuted ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  )}
                </IconButton>
                {/* Expand / fullscreen */}
                <IconButton label={tCommon("fullscreen")} size="sm" tone="bare" shape="square" style={{ boxShadow: "none" }} onTouchEnd={(e) => { e.preventDefault(); void (async () => { const vid = videoRef.current; if (!vid) return; try { if (typeof vid.requestFullscreen === "function") await vid.requestFullscreen(); else if (typeof (vid as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen === "function") (vid as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen(); } catch { /* ignored */ } })(); }} onClick={async () => { const vid = videoRef.current; if (!vid) return; try { if (typeof vid.requestFullscreen === "function") await vid.requestFullscreen(); else if (typeof (vid as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen === "function") (vid as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen(); } catch { /* ignored */ } }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </IconButton>
              </div>
            )}
            {/* Cerrar × */}
            <IconButton label={tPosts("closeViewer")} size="sm" tone="bare" shape="square" style={{ boxShadow: "none" }} onTouchEnd={(e) => { e.preventDefault(); handleMobileClose(); }} onClick={handleMobileClose}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          </div>
        </div>

        {renderMediaPreview(previousMedia, tPosts("previousMedia"))}
        {renderCurrentMedia()}
        {renderMediaPreview(nextMedia, tPosts("nextMedia"))}

        {/* ── Center: Skip-10 · Play/Pause · Skip+10 ── */}
        {isCurrentVideo && !mobileVideoTrueFullscreen && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 36,
              zIndex: 8,
              opacity: mobileChromeVisible ? 1 : 0,
              transition: "opacity 220ms ease",
              pointerEvents: "none",
            }}
          >
            <button
              type="button"
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 10); }}
              onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 10); }}
              style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", pointerEvents: "auto", WebkitTapHighlightColor: "transparent", outline: "none", boxShadow: "none" }}
            >
              <VideoSkipBackIcon size={40} />
            </button>
            <IconButton label={videoPlaying ? tPosts("pauseVideo") : tPosts("playVideo")} size="sm" tone="bare" shape="square" style={{ pointerEvents: "auto", boxShadow: "none" }} onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); handleVideoPlayPause(); }} onClick={(e) => { e.stopPropagation(); handleVideoPlayPause(); }}>
              {videoPlaying ? <VideoPauseIcon size={44} /> : <VideoPlayIcon size={44} />}
            </IconButton>
            <button
              type="button"
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.min(v.duration, v.currentTime + 10); }}
              onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.min(v.duration, v.currentTime + 10); }}
              style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", pointerEvents: "auto", WebkitTapHighlightColor: "transparent", outline: "none", boxShadow: "none" }}
            >
              <VideoSkipForwardIcon size={40} />
            </button>
          </div>
        )}

        {/* ── Bottom info bar ── */}
        <div
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: 0,
            insetInlineStart: 0,
            insetInlineEnd: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.84) 0%, rgba(0,0,0,0.54) 58%, transparent 100%)",
            paddingBottom: "calc(8px + var(--vb-safe-bottom, 0px))",
            zIndex: 5,
            opacity: controlsOpacity,
            transition: controlsTransition,
          }}
        >
          {/* Avatar + name/date + [video: menú, expand] */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "4px 16px 2px",
              minWidth: 0,
            }}
          >
            <Link href={author.profileHref} style={{ flexShrink: 0, lineHeight: 0 }}>
              <Avatar name={author.authorName} avatarUrl={author.avatarUrl} size={34} />
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link
                href={author.profileHref}
                style={{
                  color: "#fff",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1.2,
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {author.authorName}
              </Link>
              <TextButton tone="mute" size="sm" style={{ display: "block", margin: 0, fontFamily: fontStack, textAlign: "start" }} onClick={() => setShowExactDate((prev) => !prev)} title={exactDate} aria-label={showExactDate ? tPosts("showRelativeDateLabel") : tPosts("showExactDateLabel")}>
                {showExactDate ? exactDate : relativeDate}
              </TextButton>
            </div>
          </div>

          {/* Time + progress bar — always rendered, animates in/out smoothly */}
          <div
            style={{
              display: "grid",
              gridTemplateRows: (isCurrentVideo && !mobileVideoTrueFullscreen && mobileChromeVisible) ? "1fr" : "0fr",
              opacity: (isCurrentVideo && !mobileVideoTrueFullscreen && mobileChromeVisible) ? 1 : 0,
              transition: "grid-template-rows 240ms ease, opacity 200ms ease",
            }}
          >
            <div style={{ overflow: "hidden", minHeight: 0 }}>
              {isCurrentVideo && !mobileVideoTrueFullscreen && (
                <div style={{ padding: "0px 16px 4px", pointerEvents: mobileChromeVisible ? "auto" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.68)", letterSpacing: "0.01em", fontVariantNumeric: "tabular-nums" }}>
                      {formatMediaDuration(videoCurrentTime)}
                    </span>
                    <button
                      type="button"
                      onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); const idx = playbackRates.indexOf(videoPlaybackRate); setVideoPlaybackRate(playbackRates[(idx + 1) % playbackRates.length]); }}
                      onClick={(e) => { e.stopPropagation(); const idx = playbackRates.indexOf(videoPlaybackRate); setVideoPlaybackRate(playbackRates[(idx + 1) % playbackRates.length]); }}
                      style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, fontSize: 14, fontWeight: 700, fontFamily: fontStack, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}
                    >
                      ×{videoPlaybackRate}
                    </button>
                  </div>
                  <div ref={pivRef1} style={{ position: "relative", height: 20, display: "flex", alignItems: "center" }}>
                    <div style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.28)" }}>
                      <div style={{ height: "100%", width: "var(--pct, 0%)", background: "#fff", borderRadius: 2 }} />
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        insetInlineStart: "var(--pct, 0%)",
                        transform: "translate(-50%, 0)",
                        width: 14, height: 14, borderRadius: "50%",
                        background: "#fff", boxShadow: "0 1px 5px rgba(0,0,0,0.55)",
                        pointerEvents: "none",
                      }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={videoDuration > 0 ? videoDuration : 0}
                      step={0.1}
                      value={Math.min(videoCurrentTime, videoDuration > 0 ? videoDuration : videoCurrentTime)}
                      aria-label={tCommon("videoProgress")}
                      onChange={(e) => handleVideoSeek(Number(e.currentTarget.value))}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchMove={(e) => e.stopPropagation()}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", margin: 0 }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "2px 16px 6px",
            }}
          >
            <div style={actionGroupStyle}>
              <button
                type="button"
                onClick={onToggleFlame}
                aria-pressed={viewerHasFlamed}
                aria-label={viewerHasFlamed ? tPosts("removeFlameFromPost") : tPosts("addFlameToPost")}
                style={flameButtonStyle}
              >
                <span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", lineHeight: 1 }}>
                  <VibraFlameIcon active={viewerHasFlamed} size={22} />
                </span>
              </button>
              <button
                type="button"
                onClick={onOpenFlames}
                disabled={!onOpenFlames || likesCount === 0}
                aria-label={tPosts("viewFlameUsers")}
                style={{
                  ...actionButtonStyle,
                  opacity: !onOpenFlames || likesCount === 0 ? 0.55 : 1,
                  cursor: !onOpenFlames || likesCount === 0 ? "default" : "pointer",
                }}
              >
                {likesCount}
              </button>
            </div>

            <IconButton label={tPosts("viewComments")} size="sm" tone="bare" shape="square" style={{ gap: 6, fontWeight: 700, boxShadow: "none" }} onClick={onOpenComments}>
              <span aria-hidden="true">
                <VibraCommentIcon size={20} color="rgba(255,255,255,0.88)" />
              </span>
              <span>{commentsCount}</span>
            </IconButton>

            <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 14 }}>
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
                  title={post.shareTitle || tPosts("shareDefaultTitle")}
                  text={post.shareDescription || post.text || tPosts("shareDefaultText")}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Comments overlay */}
      {mobileCommentsOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            height: "var(--vb-alto-pantalla)",
            zIndex: VIEWER_OVERLAY_Z,
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
              borderStartStartRadius: 18,
              borderStartEndRadius: 18,
              background: "rgba(12,12,12,0.98)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderBottom: "none",
              padding: "10px 12px calc(12px + var(--vb-safe-bottom, 0px))",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {commentsContent}
          </div>
        </div>
      )}

      {/* Panel central de velocidad */}
      {mounted && mobileSpeedMenuOpen && createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: VIEWER_OVERLAY_Z, background: "rgba(0,0,0,0.52)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
            onClick={() => setMobileSpeedMenuOpen(false)}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: VIEWER_OVERLAY_Z,
              background: "rgba(18,18,20,0.98)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 18,
              width: 230,
              overflow: "hidden",
              boxShadow: "0 24px 64px rgba(0,0,0,0.64)",
            }}
          >
            <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.38)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {tGroups("playbackSpeed")}
              </span>
            </div>
            {([0.5, 1, 1.5, 2] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => { setVideoPlaybackRate(rate); setMobileSpeedMenuOpen(false); }}
                aria-pressed={videoPlaybackRate === rate}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "14px 16px",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  background: "transparent",
                  color: videoPlaybackRate === rate ? "#fff" : "rgba(255,255,255,0.68)",
                  fontSize: 15,
                  fontWeight: videoPlaybackRate === rate ? 700 : 400,
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  textAlign: "start",
                }}
              >
                <span>{rate === 1 ? "Normal" : `${rate}×`}</span>
                {videoPlaybackRate === rate && (
                  <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
                    <path d="M1 6L5.5 10.5L15 1" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );

  const desktopContent = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        height: "var(--vb-alto-pantalla)",
        zIndex: VIEWER_OVERLAY_Z,
        background: "rgba(0,0,0,0.86)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        color: "#fff",
        fontFamily: fontStack,
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: DESKTOP_OVERLAY_PADDING,
        boxSizing: "border-box",
      }}
      onClick={onClose}
    >
        <div
          ref={desktopVideoShellRef}
          onMouseEnter={revealDesktopControls}
          onMouseMove={revealDesktopControls}
          onMouseLeave={scheduleDesktopControlsHide}
          onClick={(e) => { e.stopPropagation(); revealDesktopControls(); }}
          style={{
            ...(mediaAspectRatio !== null && mediaAspectRatio < 1
              ? { flex: "none", aspectRatio: String(mediaAspectRatio), height: DESKTOP_MEDIA_HEIGHT, width: "auto" }
              : { flex: 1, height: DESKTOP_MEDIA_HEIGHT }),
            position: "relative",
            minWidth: 0,
            minHeight: 0,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.64)",
          }}
        >
          <IconButton label={tPosts("closeViewer")} size="sm" tone="bare" shape="square" style={{ position: "absolute", top: 14, insetInlineEnd: 14, zIndex: 8, placeItems: "center" }} onClick={onClose}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>

          {currentMedia.type === "video" ? (
            externalVideoElement ? (
              <div
                ref={externalVideoSlotRef}
                style={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  background: "#000",
                  position: "relative",
                  overflow: "hidden",
                }}
              />
            ) : currentVideoSrc ? (
              <video controlsList="noremoteplayback"
                ref={videoRef}
                src={currentVideoSrc}
                poster={currentVideoPoster}
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
                  applyVideoAspectRatio(event.currentTarget);
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentMedia.url}
              alt={currentMedia.altText || tPosts("imageAlt")}
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

          {currentMedia.type === "video" && (currentVideoSrc || externalVideoElement) && (
            <>
              {/* Fade wrapper — todo excepto el botón de cerrar (que ya está fuera con zIndex 8) */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 5,
                  opacity: desktopControlsVisible ? 1 : 0,
                  transition: "opacity 0.3s ease",
                  pointerEvents: desktopControlsVisible ? "auto" : "none",
                }}
              >
                {/* Top bar — padding-right 50px para no tapar el botón cerrar (top-right) */}
                <div style={{
                  position: "absolute", top: 0, insetInlineStart: 0, insetInlineEnd: 0,
                  padding: "19px 50px 8px 14px",
                  background: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  {/* IZQUIERDA: PiP · AirPlay */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {hayPip && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const v = videoRef.current;
                        if (!v) return;
                        if (document.pictureInPictureElement) {
                          void document.exitPictureInPicture();
                        } else if (document.pictureInPictureEnabled) {
                          void v.requestPictureInPicture();
                        }
                      }}
                      style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                    >
                      <VideoPipIcon size={20} />
                    </button>
                    )}
                    {typeof window !== "undefined" && "WebKitPlaybackTargetAvailabilityEvent" in window && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const v = videoRef.current as HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void };
                          v?.webkitShowPlaybackTargetPicker?.();
                        }}
                        style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                      >
                        <VideoAirPlayIcon size={20} />
                      </button>
                    )}
                  </div>
                  {/* DERECHA: Expand · Mute */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleDesktopFullscreen(); }}
                      style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                    >
                      {desktopFullscreenActive ? <VideoCompressIcon size={20} /> : <VideoExpandIcon size={20} />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setVideoMuted(m => !m); }}
                      style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                    >
                      {videoMuted ? <VideoMuteIcon size={20} /> : <VideoUnmuteIcon size={20} />}
                    </button>
                  </div>
                </div>

                {/* Centro: Skip-10 · Play/Pause · Skip+10 — pointer-events none en el container para no bloquear el top bar */}
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 50,
                  pointerEvents: "none",
                }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 10); }}
                    style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", pointerEvents: "auto" }}
                  >
                    <VideoSkipBackIcon size={34} />
                  </button>
                  <IconButton label={videoPlaying ? tCommon("pause") : tCommon("play")} size="sm" tone="bare" shape="square" style={{ pointerEvents: "auto" }} onClick={(e) => { e.stopPropagation(); handleVideoPlayPause(); }}>
                    {videoPlaying ? <VideoPauseIcon size={36} /> : <VideoPlayIcon size={36} />}
                  </IconButton>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) v.currentTime = Math.min(v.duration, v.currentTime + 10); }}
                    style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", pointerEvents: "auto" }}
                  >
                    <VideoSkipForwardIcon size={34} />
                  </button>
                </div>

                {/* Bottom bar: tiempos + scrubber */}
                <div style={{ position: "absolute", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0, padding: "0 14px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 600, fontFamily: fontStack, fontVariantNumeric: "tabular-nums" }}>
                      {formatMediaDuration(videoCurrentTime)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const idx = playbackRates.indexOf(videoPlaybackRate);
                        const next = playbackRates[(idx + 1) % playbackRates.length];
                        setVideoPlaybackRate(next);
                      }}
                      style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 700, fontFamily: fontStack, lineHeight: 1 }}
                    >
                      ×{videoPlaybackRate}
                    </button>
                  </div>
                  <div ref={pivRef2} style={{ position: "relative", height: 28, display: "flex", alignItems: "center" }}>
                    <div style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.25)" }} />
                    <div style={{ position: "absolute", insetInlineStart: 0, width: "var(--pct, 0%)", height: 4, borderRadius: 99, background: "#fff" }} />
                    <div style={{
                      position: "absolute",
                      insetInlineStart: "var(--pct, 0%)",
                      transform: "translateX(-50%)",
                      width: 11, height: 11, borderRadius: "50%", background: "#fff",
                      pointerEvents: "none",
                    }} />
                    <input
                      type="range" min={0} max={videoDuration > 0 ? videoDuration : 0} step={0.1}
                      value={Math.min(videoCurrentTime, videoDuration > 0 ? videoDuration : videoCurrentTime)}
                      onChange={(e) => handleVideoSeek(Number(e.currentTarget.value))}
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", margin: 0 }}
                    />
                  </div>
                </div>
              </div>

            </>
          )}

          {(!desktopFullscreenActive || desktopControlsVisible) &&
            canNavigateMedia && (
            <>
              <button
                type="button"
                onClick={goToPreviousMedia}
                aria-label={tPosts("viewPrevMedia")}
                style={{
                  position: "absolute",
                  insetInlineStart: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  zIndex: 6,
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: 42,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0,
                  textShadow: "0 1px 6px rgba(0,0,0,0.6)",
                }}
              >
                ‹
              </button>

              <button
                type="button"
                onClick={goToNextMedia}
                aria-label={tPosts("viewNextMedia")}
                style={{
                  position: "absolute",
                  insetInlineEnd: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  zIndex: 6,
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: 42,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0,
                  textShadow: "0 1px 6px rgba(0,0,0,0.6)",
                }}
              >
                ›
              </button>
            </>
          )}
        </div>

        <aside
          onClick={(e) => e.stopPropagation()}
          style={{
            // Un poco más ancho cuando el post es de comunidad: así el badge de
            // comunidad tras el nombre y el botón de 3 puntos caben sin apretarse.
            width: group ? "min(340px, 30vw)" : "min(304px, 27vw)",
            // Misma altura que la caja del medio: es el lado contra el que se
            // alinea, y si se quedan distintas el panel corta a media caja.
            height: DESKTOP_MEDIA_HEIGHT,
            flexShrink: 0,
            minHeight: 0,
            background: "rgba(14,14,16,0.98)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.64)",
            borderRadius: 16,
            display: "grid",
            gridTemplateRows: "auto 1fr",
            minWidth: 0,
            overflow: "hidden",
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
                    fontWeight: 500,
                    lineHeight: 1.35,
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
                    ? tPosts("showRelativeDateLabel")
                    : tPosts("showExactDateLabel")
                }
                style={{
                  display: "block",
                  width: "fit-content",
                  marginTop: 0,
                  color: "rgba(255,255,255,0.54)",
                  fontSize: 10.5,
                  lineHeight: 1.35,
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  fontFamily: fontStack,
                  cursor: "pointer",
                  textAlign: "start",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {showExactDate ? exactDate : relativeDate}
              </button>
            </div>

            {showActionsMenu && onOpenActionsMenu && (
              <IconButton label={tPosts("moreOptions")} size="sm" tone="bare" shape="square" style={{ alignSelf: "flex-start", marginTop: -2 }} onClick={(e) => { e.stopPropagation(); onOpenActionsMenu(); }}>
                <MenuLinesIcon size={18} />
              </IconButton>
            )}
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
                      marginInlineEnd: shouldShowDesktopPostText ? 8 : 0,
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
                          marginInlineStart: 6,
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
                        {desktopPostTextExpanded ? tGroups("seeLess") : tGroups("seeMore")}
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
      ? tPosts("removeFlameFromPost")
      : tPosts("addFlameToPost")
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
                  aria-label={tPosts("viewFlameUsers")}
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

              <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 14 }}>
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
                    title={post.shareTitle || tPosts("shareDefaultTitle")}
                    text={post.shareDescription || post.text || tPosts("shareDefaultText")}
                  />
                )}
              </div>
            </div>

            <div style={{ marginTop: 0, paddingTop: 0, minWidth: 0 }}>
              {commentsContent}
            </div>
          </div>
        </aside>

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
