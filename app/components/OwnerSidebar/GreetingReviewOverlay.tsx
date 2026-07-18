"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { createGreetingMuxUpload } from "@/lib/greetings/greetingRequests";
import { addStoryFromGreeting, deleteStory, subscribeToStoryByGreeting } from "@/lib/stories/storyService";
import type { StoryDoc } from "@/lib/stories/types";
import type { GreetingRequestDoc, UserMini } from "./OwnerSidebar";
import { playEdgeTTS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import {
  VideoMuteIcon,
  VideoUnmuteIcon,
  VideoExpandIcon,
  VideoPlayIcon,
  VideoPauseIcon,
  VideoSkipBackIcon,
  VideoSkipForwardIcon,
} from "@/app/components/VibraServiceIcons/VibraVideoIcons";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { useTranslations, useLocale } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import type { DisplayCurrency } from "@/lib/currency/catalog";

const fontStack =
  'inherit';

function getGreetingStatusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case "delivered": return t("statusDelivered");
    case "rejected": return t("statusRejected");
    case "devolucion": return t("statusRefund");
    case "accepted": return t("statusAccepted");
    case "pending": return t("statusPending");
    default: return status || t("statusPending");
  }
}

function getRelativeTime(createdAt: { toDate: () => Date } | null | undefined, tc: (k: string, v?: Record<string, unknown>) => string): string {
  if (!createdAt) return tc("relativeTimeNow");
  const diffMs = Date.now() - createdAt.toDate().getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return tc("relativeTimeDays", { count: diffDays });
  if (diffHours >= 1) return tc("relativeTimeHours", { count: diffHours });
  if (diffMins >= 1) return tc("relativeTimeMinutes", { count: diffMins });
  return tc("relativeTimeNow");
}

type ViewState = "review" | "camera";
type RecordPhase = "preview" | "recording" | "done";

type Props = {
  items: Array<{ id: string; data: GreetingRequestDoc }>;
  buyers: Record<string, UserMini | null>;
  startIndex?: number;
  greetingBusyId: string | null;
  onAccept?: (id: string) => void;
  onReject: (id: string) => void;
  onClose: () => void;
  getInitials: (name?: string | null) => string;
  typeLabel: (t: string) => string;
  viewMode?: boolean;
  buyerViewMode?: boolean;
  buyerSourceName?: string;
  buyerSourceAvatar?: string | null;
  readOnly?: boolean;
};

function formatDateDisplay(date: Date): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString("es-MX");
  }
}

export default function GreetingReviewOverlay({
  items,
  buyers,
  startIndex = 0,
  greetingBusyId,
  onReject,
  onClose,
  getInitials,
  viewMode = false,
  buyerViewMode = false,
  buyerSourceName,
  buyerSourceAvatar,
  readOnly = false,
}: Props) {
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const { format: formatMoney } = usePriceFormat();
  const [mounted, setMounted] = useState(false);
  const [earningFormatted, setEarningFormatted] = useState<string | null>(null);
  const [sourceInfo, setSourceInfo] = useState<{ name: string; photoURL: string | null } | null>(null);
  const [viewState, setViewState] = useState<ViewState>(viewMode ? "camera" : "review");
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("preview");
  const [isMobile, setIsMobile] = useState(false);
  const [, setSheetExpanded] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const uploadBlobRef = useRef<Blob | File | null>(null);

  // Multi-item queue state
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [uploadSucceeded, setUploadSucceeded] = useState(false);
  const [completedEarningsNet, setCompletedEarningsNet] = useState<number[]>([]);
  const [slideState, setSlideState] = useState<"idle" | "exit" | "enter">("idle");
  const [earningNet, setEarningNet] = useState<number | null>(null);

  // Story state — reset per item
  const [storyAdded, setStoryAdded] = useState(false);
  const [addingStory, setAddingStory] = useState(false);
  const [storyError, setStoryError] = useState<string | null>(null);
  const { toast: overlayToast, showToast: showOverlayToast } = useVibraToast();
  useEffect(() => { if (storyError) showOverlayToast(storyError, "error"); }, [storyError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (uploadError) showOverlayToast(uploadError, "error"); }, [uploadError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cameraError) showOverlayToast(cameraError, "error"); }, [cameraError]); // eslint-disable-line react-hooks/exhaustive-deps
  // viewMode story state
  const [existingStory, setExistingStory] = useState<StoryDoc | null>(null);
  const [removingStory, setRemovingStory] = useState(false);

  // Download state
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // TTS state
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechHighlight, setSpeechHighlight] = useState<{ start: number; length: number } | null>(null);
  const [speechRate, setSpeechRate] = useState<1 | 1.4 | 1.8>(1);
  const speechRateRef = useRef<number>(1);
  const speechOffsetRef = useRef(0);
  const speechGenRef = useRef(0);
  const ttsAudioRef = useRef<EdgeTTSHandle | null>(null);
  const speechTextRef = useRef<HTMLParagraphElement>(null);
  const speechCursorRef = useRef<HTMLSpanElement>(null);

  // Review panel bottom sheet (mobile only)
  const [reviewSheetTransform, setReviewSheetTransform] = useState("translateY(100%)");
  const [reviewSheetDragging, setReviewSheetDragging] = useState(false);
  const reviewDragStartRef = useRef({ y: 0, time: 0 });
  const reviewLastDragRef = useRef({ y: 0, time: 0 });

  // Mobile camera split-panel
  const [mobilePanelHeight, setMobilePanelHeight] = useState(200);
  const [mobilePanelDragging, setMobilePanelDragging] = useState(false);
  const panelDragStartRef = useRef({ y: 0, height: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobUrlRef = useRef<string | null>(null);
  const mimeTypeRef = useRef<string>("");
  const wasUploadedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRecRef = useRef<HTMLCanvasElement | null>(null);
  const rafRecRef = useRef<number | null>(null);
  const cancelDrawLoopRef = useRef<(() => void) | null>(null);

  // URL cruda (pública) del avatar — la plantilla de grabación animada la carga directa.
  const overlayAvatarUrlRef = useRef<string | null>(null);

  // ─── Playback video custom controls ──────────────────────────────────────────
  const playbackVideoRef = useRef<HTMLVideoElement | null>(null);
  const vpScrubberRef = useRef<HTMLDivElement | null>(null);
  const vpChromeTimerRef = useRef<number | null>(null);
  const [vpPlaying, setVpPlaying] = useState(false);
  const [vpCurrentTime, setVpCurrentTime] = useState(0);
  const [vpDuration, setVpDuration] = useState(0);
  const [vpMuted, setVpMuted] = useState(false);
  const [vpReady, setVpReady] = useState(false);
  const [vpChromeVisible, setVpChromeVisible] = useState(true);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Slide-in animation for review bottom sheet on mobile
  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => setReviewSheetTransform("translateY(0)"), 16);
    return () => clearTimeout(t);
  }, [mounted]);

  // Fetch earning + source info from Firestore — re-runs when cycling to next item
  useEffect(() => {
    setEarningFormatted(null);
    setEarningNet(null);
    setSourceInfo(null);
    const req = items[currentIndex]?.data;
    if (!req) return;
    const source = req.source ?? "group";
    const id = source === "profile" ? req.profileUserId ?? req.creatorId : req.groupId;
    if (!id) return;
    const col = source === "profile" ? "users" : "groups";
    getDoc(doc(db, col, id)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;

      // Source name and avatar — only needed for groups (profile uses buyers[creatorId] directly)
      if (source !== "profile") {
        const rawName =
          typeof data.name === "string" && data.name.trim()
            ? data.name.trim()
            : null;
        const resolvedName = rawName || tCommon("community");
        const photoURL =
          typeof data.avatarUrl === "string" && data.avatarUrl ? data.avatarUrl :
          typeof data.photoURL === "string" && data.photoURL ? data.photoURL :
          null;
        setSourceInfo({ name: resolvedName, photoURL });
      }

      // Earnings
      const offerings = Array.isArray(data.offerings)
        ? (data.offerings as Array<Record<string, unknown>>)
        : [];
      const offering = offerings.find((o) => o.type === req.type);
      if (!offering) return;
      const rawPrice =
        typeof offering.memberPrice === "number"
          ? offering.memberPrice
          : typeof offering.price === "number"
            ? offering.price
            : null;
      if (rawPrice == null || rawPrice <= 0) return;
      const net = rawPrice * 0.77;
      const cur = typeof offering.currency === "string" ? offering.currency : "MXN";
      setEarningNet(net);
      setEarningFormatted(formatMoney(net, { baseCurrency: cur as DisplayCurrency, code: true }));
    }).catch(() => {});
  }, [currentIndex, items, formatMoney]);

  // Attach stream to video element after camera activates
  useEffect(() => {
    if (viewState === "camera" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [viewState]);

  // Cleanup stream, blob URL and TTS on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      speechGenRef.current++;
      if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    };
  }, []);

  // Seconds counter while recording — auto-stops at max duration
  useEffect(() => {
    if (recordPhase !== "recording") { setRecordingSeconds(0); return; }
    const maxSeconds = items[currentIndex]?.data.type === "saludo" ? 240 : items[currentIndex]?.data.type === "consejo" ? 420 : 240;
    const id = setInterval(() => {
      setRecordingSeconds((s) => {
        const next = s + 1;
        if (next >= maxSeconds) recorderRef.current?.stop();
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [recordPhase, currentIndex, items]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Lee la duración del preview grabado. NO se hace el "salto a 1e101" para forzar
  // la duración: en iOS ese truco dejaba el video en negro. Si la duración viene
  // Infinity (algunos móviles) el scrubber muestra --:-- pero el video sí reproduce.
  function fixPreviewDuration(v: HTMLVideoElement) {
    const d = v.duration;
    setVpDuration(Number.isFinite(d) && d > 0 ? d : 0);
    setVpReady(true);
  }

  function handleVPPlayPause() {
    const v = playbackVideoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      showVPChrome();
      scheduleVPChromeHide();
    } else {
      v.pause();
    }
  }

  function handleVPSeek(value: number) {
    const v = playbackVideoRef.current;
    if (!v || !Number.isFinite(value)) return;
    v.currentTime = Math.min(Math.max(0, value), Number.isFinite(v.duration) && v.duration > 0 ? v.duration : value);
    setVpCurrentTime(v.currentTime);
    showVPChrome();
  }

  function scheduleVPChromeHide() {
    if (vpChromeTimerRef.current !== null) window.clearTimeout(vpChromeTimerRef.current);
    vpChromeTimerRef.current = window.setTimeout(() => setVpChromeVisible(false), 1000);
  }

  function showVPChrome() {
    setVpChromeVisible(true);
    if (vpChromeTimerRef.current !== null) window.clearTimeout(vpChromeTimerRef.current);
  }

  useEffect(() => {
    if (!vpReady) return;
    let rafId: number;
    const tick = () => {
      const v = playbackVideoRef.current;
      if (v && isFinite(v.currentTime) && isFinite(v.duration) && v.duration > 0) {
        const pct = `${Math.min(100, (v.currentTime / v.duration) * 100).toFixed(2)}%`;
        if (vpScrubberRef.current) vpScrubberRef.current.style.setProperty("--pct", pct);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      if (vpScrubberRef.current) vpScrubberRef.current.style.setProperty("--pct", "0%");
    };
  }, [vpReady]);

  useEffect(() => {
    const v = playbackVideoRef.current;
    if (v) v.muted = vpMuted;
  }, [vpMuted]);

  useEffect(() => {
    setVpPlaying(false);
    setVpCurrentTime(0);
    setVpDuration(0);
    setVpReady(false);
  }, [currentIndex, recordedBlobUrl]);


  function getRecordingMessage(seconds: number, type: string): string | null {
    if (type === "saludo") {
      if (seconds >= 210) {
        const rem = 240 - seconds;
        return rem > 0 ? tServices("greetingConcludesIn", { count: rem }) : null;
      }
      if (seconds >= 180 && seconds < 190) return tServices("greetingVeryLong");
      if (seconds >= 120 && seconds < 130) return tServices("greetingTooLong");
      if (seconds >= 60 && seconds < 70) return tServices("greetingAvgDuration");
    }
    if (type === "consejo") {
      if (seconds >= 390) {
        const rem = 420 - seconds;
        return rem > 0 ? tServices("adviceConcludesIn", { count: rem }) : null;
      }
      if (seconds >= 300 && seconds < 310) return tServices("adviceTooLong");
      if (seconds >= 150 && seconds < 160) return tServices("adviceAvgDuration");
    }
    return null;
  }

  const handleSendGreeting = async () => {
    const blob = uploadBlobRef.current;
    if (!blob) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    try {
      const { uploadUrl } = await createGreetingMuxUpload({ greetingRequestId: currentItem.id });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(tCommon("generalError")));
        };
        xhr.onerror = () => reject(new Error(tCommon("generalError")));
        xhr.open("PUT", uploadUrl);
        xhr.send(blob);
      });

      // Stop camera stream if still running (file upload path)
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setIsUploading(false);
      setUploadProgress(0);
      setCompletedEarningsNet((prev) => [...prev, earningNet ?? 0]);
      setUploadSucceeded(true);
    } catch (e: unknown) {
      setUploadError((e instanceof Error ? e.message : null) ?? tCommon("generalError"));
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const currentItem = items[currentIndex] ?? items[0];
  const req = currentItem.data;
  const buyer = buyers[req.buyerId] ?? null;
  const busy = greetingBusyId === currentItem.id;
  const buyerLetter = getInitials(buyer?.displayName);

  const viewMp4Url = (viewMode || buyerViewMode) && req.muxPlaybackId
    ? `https://stream.mux.com/${req.muxPlaybackId}/high.mp4`
    : null;
  const viewThumbnailUrl = (viewMode || buyerViewMode) && req.muxPlaybackId
    ? `https://image.mux.com/${req.muxPlaybackId}/thumbnail.jpg`
    : null;

  const typeLabel = req.type === "consejo" ? tWallet("typeLabelAdvice") : req.type === "mensaje" ? tWallet("typeLabelMessage") : tWallet("typeLabelGreeting");
  const titleText = viewMode
    ? `${tServices("viewRequest")} ${typeLabel}`
    : `${tServices("readMessage")} ${typeLabel}`;

  const cameraTitleText = viewMode ? titleText : `${tServices("readMessage")} ${typeLabel}`;

  // Resuelve la URL pública del avatar del creador para pasarla a la plantilla de
  // grabación animada (que la carga directa). Prioridad: prop → mapa buyers → Firestore.
  const preloadOverlayAvatar = async () => {
    overlayAvatarUrlRef.current = null;
    let url: string | null =
      (typeof buyerSourceAvatar === "string" && buyerSourceAvatar) ? buyerSourceAvatar
      : buyers[req.creatorId]?.photoURL ?? null;
    if (!url) {
      try {
        const snap = await getDoc(doc(db, "users", req.creatorId));
        const d = snap.data() as Record<string, unknown> | undefined;
        url = (typeof d?.photoURL === "string" && d.photoURL) ? d.photoURL : null;
      } catch { /* best-effort */ }
    }
    overlayAvatarUrlRef.current = url;
  };

  // Resuelve la URL del avatar al montar — la usa la descarga animada.
  useEffect(() => {
    preloadOverlayAvatar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGrabar = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 60 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 2 },
        },
      });
      streamRef.current = stream;
      setMobilePanelHeight(280);
      setViewState("camera");
      setRecordPhase("preview");
    } catch {
      setCameraError(tCommon("generalError"));
      stopCamera();
    }
  };

  const handleStartRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];

    const preferredTypes = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    mimeTypeRef.current = mimeType;

    const cameraStream = streamRef.current;
    // NO forzar videoBitsPerSecond: el cálculo anterior (pixelCount * 0.004) daba
    // ~8 kbps para 1080p. Chrome (laptop) lo ignora y usa su default, pero iOS
    // Safari lo respeta literal y codifica casi solo el primer keyframe → video
    // congelado + audio. Dejamos que el navegador elija un bitrate de video sano.
    const mrOptions = (mimeType
      ? { mimeType, audioBitsPerSecond: 192_000 }
      : { audioBitsPerSecond: 192_000 }) as MediaRecorderOptions;

    const mr = new MediaRecorder(cameraStream, mrOptions);
    // Tipo REAL que usa el grabador (iOS puede ignorar el pedido y usar otro);
    // así el Blob no queda mal etiquetado y el preview decodifica el video.
    mimeTypeRef.current = mr.mimeType || mimeType;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      cameraStream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "video/mp4" });
      uploadBlobRef.current = blob;
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setRecordedBlobUrl(url);
      setFileDuration(null);
      setRecordPhase("done");
    };
    mr.start();
    recorderRef.current = mr;
    setRecordPhase("recording");
  };

  const handleStopRecording = () => { recorderRef.current?.stop(); };

  const handleRepeat = async () => {
    cancelDrawLoopRef.current?.(); cancelDrawLoopRef.current = null; rafRecRef.current = null;
    canvasRecRef.current = null;
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    uploadBlobRef.current = null;
    setRecordedBlobUrl(null);
    recorderRef.current = null;
    chunksRef.current = [];
    setRecordingSeconds(0);
    setCameraError(null);
    setUploadError(null);
    setIsUploading(false);
    setUploadProgress(0);
    setFileDuration(null);
    wasUploadedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 48000 }, channelCount: { ideal: 2 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setRecordPhase("preview");
    } catch {
      setCameraError(tCommon("generalError"));
      stopCamera();
    }
  };

  const handleUploadVideo = (file: File) => {
    setUploadError(null);
    const maxSeconds = req.type === "saludo" ? 240 : req.type === "consejo" ? 420 : 240;
    const maxLabel = req.type === "saludo" ? "4 minutos" : req.type === "consejo" ? "7 minutos" : "4 minutos";

    const url = URL.createObjectURL(file);
    const tempVideo = document.createElement("video");
    tempVideo.preload = "metadata";
    tempVideo.onloadedmetadata = () => {
      if (tempVideo.duration > maxSeconds) {
        URL.revokeObjectURL(url);
        setUploadError(tServices("videoExceedsMax", { max: maxLabel }));
        return;
      }
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;
      uploadBlobRef.current = file;
      wasUploadedRef.current = true;
      setFileDuration(Number.isFinite(tempVideo.duration) ? tempVideo.duration : null);
      setRecordedBlobUrl(url);
      setRecordPhase("done");
      setViewState("camera");
    };
    tempVideo.onerror = () => {
      URL.revokeObjectURL(url);
      setUploadError(tCommon("generalError"));
    };
    tempVideo.src = url;
  };

  const handleReviewBackdropClose = () => {
    setReviewSheetTransform("translateY(100%)");
    setTimeout(handleClose, 330);
  };

  const handleReviewTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    reviewDragStartRef.current = { y: touch.clientY, time: Date.now() };
    reviewLastDragRef.current = { y: touch.clientY, time: Date.now() };
    setReviewSheetDragging(true);
  };

  const handleReviewTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const delta = Math.max(0, touch.clientY - reviewDragStartRef.current.y);
    setReviewSheetTransform(`translateY(${delta}px)`);
    reviewLastDragRef.current = { y: touch.clientY, time: Date.now() };
  };

  const handleReviewTouchEnd = () => {
    setReviewSheetDragging(false);
    const distance = reviewLastDragRef.current.y - reviewDragStartRef.current.y;
    const elapsed = reviewLastDragRef.current.time - reviewDragStartRef.current.time;
    const velocity = elapsed > 0 ? distance / elapsed : 0; // px/ms, positive = downward
    if (velocity > 0.45 || distance > 120) {
      setReviewSheetTransform("translateY(100%)");
      setTimeout(handleClose, 330);
    } else {
      setReviewSheetTransform("translateY(0)");
    }
  };

  useEffect(() => {
    setStoryAdded(false);
    setAddingStory(false);
    setStoryError(null);
    setExistingStory(null);
    setRemovingStory(false);
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    speechGenRef.current++;
    setSpeechState("idle");
    setSpeechHighlight(null);
  }, [currentIndex]);

  // Subscribe to existing story for this greeting when in viewMode or buyerViewMode
  useEffect(() => {
    if (!viewMode && !buyerViewMode) return;
    const id = items[currentIndex]?.id;
    if (!id) return;
    // Filter by the user who would add the story (creator or buyer)
    const filterBy = buyerViewMode ? req.buyerId : req.creatorId;
    if (!filterBy) return;
    return subscribeToStoryByGreeting(id, setExistingStory, filterBy);
  }, [viewMode, buyerViewMode, currentIndex, items, req.buyerId, req.creatorId]);

  const handleAddToStory = async () => {
    if (addingStory || storyAdded) return;
    const type = currentItem.data.type;
    if (type !== "saludo" && type !== "consejo") return;
    setAddingStory(true);
    setStoryError(null);
    let playbackId = currentItem.data.muxPlaybackId ?? null;
    if (!playbackId) {
      try {
        const fresh = await getDoc(doc(db, "greetingRequests", currentItem.id));
        playbackId = (fresh.data()?.muxPlaybackId as string | null) ?? null;
      } catch { /* ignore — story will be created without thumbnail */ }
    }
    try {
      await addStoryFromGreeting({
        creatorId: currentItem.data.creatorId,
        greetingCreatorId: currentItem.data.creatorId,
        instructions: currentItem.data.instructions,
        type,
        muxPlaybackId: playbackId,
        thumbnailUrl: playbackId
          ? `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`
          : null,
        videoDuration: currentItem.data.videoDuration ?? null,
        greetingRequestId: currentItem.id,
        source: (currentItem.data.source as "profile" | "group") ?? "profile",
        groupId: currentItem.data.groupId ?? null,
      });
      setStoryAdded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[addStoryFromGreeting]", msg);
      setStoryError(`Error: ${msg}`);
    } finally {
      setAddingStory(false);
    }
  };

  const handleRemoveFromStory = async () => {
    if (!existingStory || removingStory) return;
    setRemovingStory(true);
    setStoryError(null);
    try {
      await deleteStory(existingStory.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[deleteStory]", msg);
      setStoryError(`Error: ${msg}`);
    } finally {
      setRemovingStory(false);
    }
  };

  // Buyer adds the received greeting to their own profile story
  const handleAddToStoryAsBuyer = async () => {
    if (addingStory) return;
    const type = currentItem.data.type;
    if (type !== "saludo" && type !== "consejo") return;
    const buyerUid = currentItem.data.buyerId;
    if (!buyerUid) return;
    setAddingStory(true);
    setStoryError(null);
    let playbackId = currentItem.data.muxPlaybackId ?? null;
    if (!playbackId) {
      try {
        const fresh = await getDoc(doc(db, "greetingRequests", currentItem.id));
        playbackId = (fresh.data()?.muxPlaybackId as string | null) ?? null;
      } catch { /* ignore */ }
    }
    try {
      await addStoryFromGreeting({
        creatorId: buyerUid,
        greetingCreatorId: currentItem.data.creatorId,
        instructions: currentItem.data.instructions,
        type,
        muxPlaybackId: playbackId,
        thumbnailUrl: playbackId ? `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0` : null,
        videoDuration: currentItem.data.videoDuration ?? null,
        greetingRequestId: currentItem.id,
        source: "profile",
        groupId: null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[addStoryFromGreeting buyer]", msg);
      setStoryError(`Error: ${msg}`);
    } finally {
      setAddingStory(false);
    }
  };

  const handleNextGreeting = () => {
    // Reset recording state and advance to next item — stay in camera panel
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    uploadBlobRef.current = null;
    wasUploadedRef.current = false;
    recorderRef.current = null;
    chunksRef.current = [];
    setRecordedBlobUrl(null);
    setRecordPhase("preview");
    setRecordingSeconds(0);
    setCameraError(null);
    setUploadError(null);
    setIsUploading(false);
    setUploadProgress(0);
    setFileDuration(null);
    setUploadSucceeded(false);
    setCurrentIndex((ci) => ci + 1);
    // Slide-in animation for new item info
    setSlideState("enter");
    requestAnimationFrame(() => requestAnimationFrame(() => setSlideState("idle")));
    // Re-open camera for the next greeting
    void navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 48000 }, channelCount: { ideal: 2 } },
    }).then((stream) => {
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    }).catch(() => {
      setCameraError(tCommon("generalError"));
    });
  };

  const stopCamera = () => {
    cancelDrawLoopRef.current?.(); cancelDrawLoopRef.current = null; rafRecRef.current = null;
    canvasRecRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    setRecordedBlobUrl(null);
    setViewState("review");
    setRecordPhase("preview");
    setRecordingSeconds(0);
    setSheetExpanded(false);
    setCameraError(null);
  };

  const handleClose = () => { stopCamera(); onClose(); };

  // Auto-scroll the instructions <p> to follow the speech cursor
  useEffect(() => {
    const cursor = speechCursorRef.current;
    const container = speechTextRef.current;
    if (!cursor || !container || !speechHighlight) return;
    const containerRect = container.getBoundingClientRect();
    const cursorRect = cursor.getBoundingClientRect();
    const cursorBottom = cursorRect.bottom - containerRect.top + container.scrollTop;
    const cursorTop = cursorRect.top - containerRect.top + container.scrollTop;
    if (cursorBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = cursorBottom - container.clientHeight + 8;
    } else if (cursorTop < container.scrollTop) {
      container.scrollTop = cursorTop - 8;
    }
  }, [speechHighlight]);

  // ─── Download — must be before any early return ─────────────────────────────
  const handleDownload = useCallback(async () => {
    const playbackId = items[currentIndex]?.data.muxPlaybackId;
    if (!playbackId || downloading) return;
    // Video crudo de Mux — solo se usa como último recurso si el render falla.
    const mp4Url = `https://stream.mux.com/${playbackId}/high.mp4`;

    setDownloading(true);
    setDownloadProgress(0);

    try {
      // 1. Metadata → orientación (horizontal/vertical) para el render animado.
      setDownloadProgress(5);
      const metaEl = document.createElement("video");
      metaEl.preload = "metadata";
      metaEl.src = mp4Url;
      await new Promise<void>((resolve) => {
        metaEl.onloadedmetadata = () => resolve();
        setTimeout(resolve, 10_000);
      });
      const srcW = metaEl.videoWidth || 1920;
      const srcH = metaEl.videoHeight || 1080;
      metaEl.src = "";
      const orientation = srcH > srcW ? "vertical" : "horizontal";

      const creatorDisplayName = req.profileDisplayName ?? req.profileUsername ?? tCommon("creator");

      // 2. Auth token — forceRefresh:false usa el token en caché si sigue válido
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated — no currentUser");
      const idToken = await user.getIdToken(false);

      // 3. Descarga ANIMADA: un Web Egress de LiveKit "hornea" intro (6s) + esquina
      //    + outro sobre el video y sube el MP4 a R2. Universal: funciona en TODO
      //    dispositivo (incl. iPhone). Devuelve una URL firmada que descargamos.
      setDownloadProgress(15);
      // Progreso "fake" mientras el grabador renderiza (~intro+video+outro s).
      let animProgress = 15;
      const animInterval = setInterval(() => {
        animProgress = Math.min(85, animProgress + Math.random() * 1.5);
        setDownloadProgress(Math.round(animProgress));
      }, 3_000);
      let animRes: Response;
      try {
        animRes = await fetch("https://greetinganimateddownload-zivezlakcq-uc.a.run.app", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
          body: JSON.stringify({
            playbackId,
            name: creatorDisplayName,
            avatar: overlayAvatarUrlRef.current ?? "",
            type: req.type ?? "saludo",
            orientation,
            locale,
          }),
        });
      } finally {
        clearInterval(animInterval);
      }
      if (!animRes.ok) {
        const errText = await animRes.text().catch(() => "");
        throw new Error(`animated CF ${animRes.status}: ${errText}`);
      }
      const { url: signedUrl } = (await animRes.json()) as { url?: string };
      if (!signedUrl) throw new Error("animated CF: no url");

      // La URL firmada de R2 ya trae Content-Disposition: attachment (con el nombre
      // del archivo), así que navegar a ella descarga el MP4 sin salir de la página.
      // NO usar fetch()+blob: R2 no manda cabeceras CORS y el navegador lo bloquea
      // (igual que la descarga de grabaciones de sesión, que también usa este R2).
      setDownloadProgress(100);
      window.location.href = signedUrl;

    } catch (err) {
      // Último recurso si el render falla (blip de red, egress caído): abrir el
      // video plano de Mux — SIN el diseño viejo, que ya no existe.
      console.error("[handleDownload] animated render failed:", err);
      setUploadError(tServices("errorProcess"));
      window.open(mp4Url, "_blank");
    } finally {
      setDownloading(false);
      setDownloadProgress(0);
    }
  }, [items, currentIndex, downloading, req, locale, tCommon, tServices]);

  // ─── TTS functions — must be before any early return ────────────────────────
  const startSpeechFrom = useCallback((charIndex: number) => {
    const text = (items[currentIndex] ?? items[0])?.data.instructions ?? "";
    if (!text) return;
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    speechOffsetRef.current = charIndex;
    const gen = ++speechGenRef.current;
    const sliceText = text.slice(charIndex);
    if (!sliceText.trim()) return;
    setSpeechHighlight(charIndex > 0 ? { start: charIndex, length: 0 } : null);
    ttsAudioRef.current = playEdgeTTS(sliceText, {
      playbackRate: speechRateRef.current,
      onProgress: (ratio) => {
        if (speechGenRef.current !== gen) return;
        const posInSlice = Math.floor(ratio * sliceText.length);
        const absPos = charIndex + posInSlice;
        const ahead = sliceText.slice(posInSlice);
        const spaceAt = ahead.search(/[\s\n]/);
        const length = spaceAt === -1 ? Math.min(ahead.length, 8) : spaceAt;
        setSpeechHighlight({ start: absPos, length: Math.max(1, length) });
      },
      onEnded: () => {
        if (speechGenRef.current !== gen) return;
        ttsAudioRef.current = null;
        setSpeechState("idle");
        setSpeechHighlight(null);
      },
      onError: () => {
        if (speechGenRef.current !== gen) return;
        ttsAudioRef.current = null;
        setSpeechState("idle");
        setSpeechHighlight(null);
      },
    });
    setSpeechState("playing");
  }, [items, currentIndex]);

  const handleToggleSpeech = useCallback(() => {
    if (speechState === "playing") { ttsAudioRef.current?.audio.pause(); setSpeechState("paused"); return; }
    if (speechState === "paused") { ttsAudioRef.current?.audio.play().catch(() => {}); setSpeechState("playing"); return; }
    startSpeechFrom(0);
  }, [speechState, startSpeechFrom]);

  const handleCycleRate = useCallback(() => {
    const next: 1 | 1.4 | 1.8 = speechRate === 1 ? 1.4 : speechRate === 1.4 ? 1.8 : 1;
    speechRateRef.current = next;
    setSpeechRate(next);
    if (ttsAudioRef.current) ttsAudioRef.current.audio.playbackRate = next;
  }, [speechRate]);

  const handleTextSeek = useCallback((e: React.MouseEvent<HTMLParagraphElement>) => {
    e.stopPropagation();
    let charIndex = 0;
    const el = speechTextRef.current;
    if (el) {
      try {
        let range: Range | null = null;
        if ("caretRangeFromPoint" in document) {
          range = (document as Document & { caretRangeFromPoint(x: number, y: number): Range | null }).caretRangeFromPoint(e.clientX, e.clientY);
        } else if ("caretPositionFromPoint" in document) {
          const d = document as Document & { caretPositionFromPoint(x: number, y: number): { offsetNode: Node; offset: number } | null };
          const pos = d.caretPositionFromPoint(e.clientX, e.clientY);
          if (pos) { range = d.createRange(); range.setStart(pos.offsetNode, pos.offset); }
        }
        if (range) {
          const pre = document.createRange();
          pre.selectNodeContents(el);
          pre.setEnd(range.startContainer, range.startOffset);
          charIndex = pre.toString().length;
        }
      } catch { /* unsupported */ }
    }
    startSpeechFrom(charIndex);
  }, [startSpeechFrom]);

  if (!mounted) return null;

  const slideStyle: React.CSSProperties = {
    transform: slideState === "exit" ? "translateX(-20px)" : slideState === "enter" ? "translateX(20px)" : "translateX(0)",
    opacity: slideState === "idle" ? 1 : 0,
    transition: slideState === "exit" ? "transform 200ms ease, opacity 200ms ease" : slideState === "idle" ? "transform 260ms ease, opacity 260ms ease" : "none",
  };

  // ─── Shared sub-sections ────────────────────────────────────────────────────
  // Success state helpers — used inside camera panels when uploadSucceeded
  const successIsLast = currentIndex >= items.length - 1;
  const successCompletedCount = completedEarningsNet.length;
  const successTotalEarned = completedEarningsNet.reduce((a, b) => a + b, 0);
  const successLabel = req.type === "consejo" ? tServices("successAdvice") : req.type === "mensaje" ? tServices("successMessage") : tServices("successGreeting");

  // Success content — shown inline in the panel below the info section
  const successContent = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <style>{`
        @keyframes vibraSuccessPop {
          0%   { transform: scale(0.3); opacity: 0; }
          65%  { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes vibraCheckDraw {
          0%   { stroke-dashoffset: 32; opacity: 0; }
          30%  { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 1; }
        }
      `}</style>
      {/* Solid green circle with white checkmark */}
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        background: "#22c55e",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        animation: "vibraSuccessPop 0.45s cubic-bezier(0.4,0,0.2,1) both",
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12L10 17L19 8"
            stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="32" strokeDashoffset="0"
            style={{ animation: "vibraCheckDraw 0.5s 0.25s ease both" }}
          />
        </svg>
      </div>
      <span style={{ color: "#fff", fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em", lineHeight: 1.2, textAlign: "center" }}>
        {successLabel}
      </span>
      {/* Earnings + completion — only shown on the very last item */}
      {successIsLast && successTotalEarned > 0 && (
        <span style={{ color: "#86efac", fontWeight: 600, fontSize: 12, lineHeight: 1.5, textAlign: "center" }}>
          {`Grabaste ${successCompletedCount} ${successCompletedCount === 1 ? "saludo o consejo" : "saludos y consejos"} y ganaste ${formatMoney(successTotalEarned, { code: true })}`}
        </span>
      )}
      {successIsLast && (
        <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 12, lineHeight: 1.5, textAlign: "center" }}>
          Terminaste todos tus saludos y consejos pendientes
        </span>
      )}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Add to story — only for saludos/consejos */}
        {(req.type === "saludo" || req.type === "consejo") && !viewMode && !buyerViewMode && (
          req.allowCreatorStory !== false ? (
            <button
              type="button"
              onClick={handleAddToStory}
              disabled={addingStory || storyAdded}
              style={{
                width: "100%", height: 42, borderRadius: 12,
                border: storyAdded
                  ? "1px solid rgba(168,85,247,0.4)"
                  : "1px solid rgba(168,85,247,0.6)",
                background: storyAdded
                  ? "rgba(168,85,247,0.12)"
                  : "rgba(168,85,247,0.18)",
                color: storyAdded ? "#c084fc" : "#d8b4fe",
                fontWeight: 700, fontSize: 14,
                cursor: addingStory || storyAdded ? "default" : "pointer",
                fontFamily: fontStack,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                transition: "background 200ms ease, color 200ms ease",
                opacity: addingStory ? 0.7 : 1,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>
                {storyAdded ? "✓" : "◎"}
              </span>
              {addingStory
                ? tServices("adding")
                : storyAdded
                  ? tServices("addedToStory")
                  : tServices("addToStory")}
            </button>
          ) : (
            <div style={{
              width: "100%", borderRadius: 12, padding: "10px 14px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              display: "flex", alignItems: "center", gap: 8, boxSizing: "border-box",
            }}>
              <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>🔒</span>
              <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 12, lineHeight: 1.4, fontFamily: fontStack }}>
                {req.type === "consejo" ? tServices("buyerNoStoryPermissionAdvice") : tServices("buyerNoStoryPermissionGreeting")}
              </span>
            </div>
          )
        )}
        {!successIsLast && (
          <button type="button" onClick={handleNextGreeting} style={{
            width: "100%", height: 42, borderRadius: 12,
            border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.15)",
            color: "#93c5fd", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: fontStack,
          }}>
            Revisar el siguiente
          </button>
        )}
        <button type="button" onClick={handleClose} style={{
          width: "100%", height: 38, borderRadius: 10,
          border: "none", background: "transparent",
          color: "rgba(255,255,255,0.38)", fontWeight: 500, fontSize: 13,
          cursor: "pointer", fontFamily: fontStack,
        }}>
          {successIsLast ? tCommon("closeLabel") : tCommon("cancel")}
        </button>
      </div>
    </div>
  );

  const typeWord = req.type === "consejo" ? "consejo" : req.type === "mensaje" ? "mensaje" : "saludo";
  // Profile source: name is always "Tu perfil", photo comes from buyers[creatorId] (already loaded)
  // Group source: name and photo come from sourceInfo (loaded async from Firestore)
  const sourceName = req.source === "profile" ? tCommon("yourProfile") : (sourceInfo?.name ?? null);
  const sourcePhotoURL = req.source === "profile"
    ? (buyers[req.creatorId]?.photoURL ?? null)
    : (sourceInfo?.photoURL ?? null);

  function renderSourceChip(topValue: number | string) {
    if (!sourceName) return null;
    // Suma el safe-area superior: los hijos absolutos ignoran el padding del
    // contenedor, así que sin esto el chip se mete bajo el notch en celular.
    const safeTop = typeof topValue === "number"
      ? `calc(${topValue}px + env(safe-area-inset-top, 0px))`
      : topValue;
    return (
      <div style={{
        position: "absolute", top: safeTop, left: "50%", transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        borderRadius: 20, padding: "5px 10px 5px 13px",
        display: "flex", alignItems: "center", gap: 7,
        pointerEvents: "none", zIndex: 2,
      }}>
        <span style={{
          color: "rgba(255,255,255,0.78)", fontSize: 11, fontWeight: 500,
          fontFamily: fontStack, whiteSpace: "nowrap", lineHeight: 1.2,
        }}>
          {`Este ${typeWord} fue solicitado desde ${sourceName}`}
        </span>
        {sourcePhotoURL ? (
          <Image
            src={sourcePhotoURL}
            alt={sourceName}
            width={22} height={22}
            style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.15)" }}
          />
        ) : (
          <div style={{
            width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
            background: "rgba(255,255,255,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)",
          }}>
            {sourceName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    );
  }

  const buyerRow = buyerViewMode ? (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {buyerSourceAvatar ? (
        <Image
          src={buyerSourceAvatar}
          alt={buyerSourceName ?? ""}
          width={38} height={38}
          style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}
        />
      ) : (
        <div style={{
          width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center",
          justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#fff", flexShrink: 0,
        }}>
          {(buyerSourceName ?? "?").charAt(0).toUpperCase()}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {buyerSourceName ?? tCommon("creator")}
        </span>
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3, marginTop: 4 }}>
          {getGreetingStatusLabel(req.status, tServices)}
        </span>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {buyer?.photoURL ? (
        <Image
          src={buyer.photoURL}
          alt={buyer.displayName}
          width={38} height={38}
          style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}
        />
      ) : (
        <div style={{
          width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center",
          justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#fff", flexShrink: 0,
        }}>
          {buyerLetter}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        {buyer?.handle ? (
          <Link href={`/u/${buyer.handle}`} onClick={handleClose} style={{
            color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2,
            textDecoration: "none", display: "block", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {buyer.displayName}
          </Link>
        ) : (
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>
            {buyer?.displayName ?? tCommon("user")}
          </span>
        )}
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3, marginTop: 4 }}>
          {getGreetingStatusLabel(req.status, tServices)}
        </span>
      </div>
      {earningFormatted && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 2 }}>
          <span style={{ color: "#86efac", fontWeight: 500, fontSize: 11, letterSpacing: "0.01em", lineHeight: 1 }}>
            Tu ganancia
          </span>
          <span style={{ color: "#86efac", fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {earningFormatted}
          </span>
        </div>
      )}
    </div>
  );

  const divider = <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />;

  const infoSection = (
    <>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>¿Para quién es?</span>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{req.toName}</span>
      </div>
      {req.instructions ? (
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, flex: 1 }}>
              {req.type === "consejo" ? "¿Cuál es el contexto del consejo?" : "¿Cuál es el contexto del saludo?"}
            </span>
            {speechState !== "idle" && (
              <button
                type="button"
                aria-label={tServices("changeReadingSpeed")}
                onClick={handleCycleRate}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.55)", padding: "2px 4px", display: "flex", alignItems: "center", flexShrink: 0, fontSize: 11, fontWeight: 700, letterSpacing: "-0.3px" }}
              >
                {speechRate}×
              </button>
            )}
            <button
              type="button"
              aria-label={speechState === "playing" ? tServices("pauseReading") : speechState === "paused" ? tServices("resumeReading") : tServices("readContext")}
              onClick={handleToggleSpeech}
              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", padding: 2, display: "flex", alignItems: "center", flexShrink: 0, transition: "color 0.15s" }}
            >
              {speechState === "playing" ? (
                <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="4" width="4" height="16" rx="1"/>
                  <rect x="15" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
              )}
            </button>
          </div>
          <p
            ref={speechTextRef}
            onClick={handleTextSeek}
            style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.82)", margin: 0, cursor: "text", userSelect: "none", maxHeight: 160, overflowY: "auto", paddingRight: 4 }}
          >
            {(() => {
              const text = req.instructions;
              if (speechState === "idle" || !speechHighlight) return text;
              const { start, length } = speechHighlight;
              return (
                <>
                  <strong style={{ color: "#fff", fontWeight: 700 }}>{text.slice(0, start + length)}</strong>
                  <span ref={speechCursorRef} />
                  {text.slice(start + length)}
                </>
              );
            })()}
          </p>
        </div>
      ) : null}
      {viewMode && req.createdAt && (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{tServices("requestedOn")}</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDateDisplay(req.createdAt.toDate())}</span>
        </div>
      )}
      {viewMode && req.deliveredAt && (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{tServices("sentOn")}</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDateDisplay(req.deliveredAt.toDate())}</span>
        </div>
      )}
    </>
  );

  const recordControls = recordPhase === "done" ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {isUploading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${uploadProgress}%`, background: "linear-gradient(90deg, #22c55e, #86efac)", borderRadius: 2, transition: "width 200ms ease" }} />
          </div>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", textAlign: "center", fontFamily: fontStack }}>
            {uploadProgress < 100 ? tServices("uploadingProgress", { progress: uploadProgress }) : tServices("processing")}
          </span>
        </div>
      )}
      {wasUploadedRef.current && fileDuration != null && !isUploading && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 2px" }}>
          <span style={{
            borderRadius: 6, padding: "2px 8px",
            background: "rgba(0,0,0,0.55)", fontSize: 11, fontWeight: 700, color: "#fff",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            🎬 {`${Math.floor(fileDuration / 60)}:${String(Math.round(fileDuration % 60)).padStart(2, "0")}`}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", fontFamily: fontStack }}>{tCommon("fileReady")}</span>
        </div>
      )}
      <button type="button" onClick={handleRepeat} disabled={busy || isUploading} style={{
        width: "100%", height: 38, borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)",
        color: (busy || isUploading) ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.65)",
        fontWeight: 600, fontSize: 13,
        cursor: (busy || isUploading) ? "not-allowed" : "pointer", fontFamily: fontStack,
      }}>
        {wasUploadedRef.current ? tCommon("changeFile") : tServices("recordAgain")}
      </button>
      <button type="button" onClick={handleSendGreeting} disabled={busy || isUploading} style={{
        width: "100%", height: 42, borderRadius: 10,
        border: "1px solid rgba(34,197,94,0.3)",
        background: (busy || isUploading) ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.2)",
        color: (busy || isUploading) ? "rgba(134,239,172,0.45)" : "#86efac",
        fontWeight: 700, fontSize: 14,
        cursor: (busy || isUploading) ? "not-allowed" : "pointer",
        fontFamily: fontStack,
      }}>
        {isUploading
          ? (uploadProgress < 100 ? tServices("uploadingProgress", { progress: uploadProgress }) : tServices("processing"))
          : req.type === "consejo" ? tServices("sendAdvice") : req.type === "mensaje" ? tServices("sendMessage") : tServices("sendGreeting")}
      </button>
    </div>
  ) : null;

  // Button overlaid on the camera zone
  const cameraRecordButton = recordPhase !== "done" ? (
    <button
      type="button"
      onClick={recordPhase === "preview" ? handleStartRecording : handleStopRecording}
      style={{
        position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)",
        width: 68, height: 68, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.88)",
        background: "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", padding: 0,
      }}
    >
      {recordPhase === "recording" ? (
        <div style={{ width: 26, height: 26, borderRadius: 6, background: "#ef4444" }} />
      ) : (
        <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#ef4444" }} />
      )}
    </button>
  ) : null;

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="video/*"
      style={{ display: "none" }}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleUploadVideo(file);
        e.target.value = "";
      }}
    />
  );

  const containerBase: React.CSSProperties = {
    background: "linear-gradient(145deg, rgb(6,3,12) 0%, rgb(10,5,20) 100%)",
    border: "1px solid rgba(168,85,255,0.15)",
    borderRadius: 16,
    padding: 20,
    boxSizing: "border-box",
    boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
    fontFamily: fontStack,
  };

  // ─── Custom video playback controls overlay ──────────────────────────────────
  const vpBtnStyle: React.CSSProperties = {
    background: "none", border: "none", boxShadow: "none", color: "#fff", cursor: "pointer",
    padding: 0, display: "flex", alignItems: "center",
    WebkitTapHighlightColor: "transparent", outline: "none",
  };
  const vpControlsOverlay = (
    <div style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none" }}>
      {/* Click catcher — toggle chrome */}
      <div
        style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "auto", cursor: "pointer" }}
        onClick={() => {
          if (vpChromeVisible) {
            if (vpChromeTimerRef.current !== null) window.clearTimeout(vpChromeTimerRef.current);
            setVpChromeVisible(false);
          } else {
            setVpChromeVisible(true);
            scheduleVPChromeHide();
          }
        }}
      />

      {/* Controls wrapper — fades in/out */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 1,
        opacity: vpChromeVisible ? 1 : 0,
        transition: "opacity 220ms ease",
        pointerEvents: "none",
      }}>
        {/* Top-right: fullscreen + mute */}
        <div style={{
          position: "absolute", top: 0, right: 0,
          padding: "10px 12px",
          display: "flex", alignItems: "center", gap: 10,
          pointerEvents: "auto",
        }}>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              const v = playbackVideoRef.current;
              if (!v) return;
              try {
                if (typeof v.requestFullscreen === "function") await v.requestFullscreen();
                else if (typeof (v as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen === "function")
                  (v as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
              } catch { /* ignored */ }
            }}
            aria-label={tCommon("fullscreen")}
            style={vpBtnStyle}
          >
            <VideoExpandIcon size={22} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setVpMuted((m) => !m); showVPChrome(); scheduleVPChromeHide(); }}
            aria-label={vpMuted ? tCommon("unmute") : tCommon("muteLabel")}
            style={vpBtnStyle}
          >
            {vpMuted ? <VideoMuteIcon size={22} /> : <VideoUnmuteIcon size={22} />}
          </button>
        </div>

        {/* Center: skip-10 | play/pause | skip+10 */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 36,
          pointerEvents: "none",
        }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); const v = playbackVideoRef.current; if (v) v.currentTime = Math.max(0, v.currentTime - 10); showVPChrome(); scheduleVPChromeHide(); }}
            style={{ ...vpBtnStyle, pointerEvents: "auto" }}
          >
            <VideoSkipBackIcon size={38} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleVPPlayPause(); }}
            aria-label={vpPlaying ? tCommon("pause") : tCommon("play")}
            style={{ ...vpBtnStyle, pointerEvents: "auto" }}
          >
            {vpPlaying ? <VideoPauseIcon size={46} /> : <VideoPlayIcon size={46} />}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); const v = playbackVideoRef.current; if (v) v.currentTime = Math.min(v.duration, v.currentTime + 10); showVPChrome(); scheduleVPChromeHide(); }}
            style={{ ...vpBtnStyle, pointerEvents: "auto" }}
          >
            <VideoSkipForwardIcon size={38} />
          </button>
        </div>

        {/* Bottom: time + scrubber */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
          padding: "0 12px 10px",
          pointerEvents: "auto",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.72)", fontVariantNumeric: "tabular-nums", fontFamily: fontStack }}>
              {formatTime(Math.floor(vpCurrentTime))}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.42)", fontVariantNumeric: "tabular-nums", fontFamily: fontStack }}>
              {vpDuration > 0 ? formatTime(Math.floor(vpDuration)) : "--:--"}
            </span>
          </div>
          <div ref={vpScrubberRef} style={{ position: "relative", height: 20, display: "flex", alignItems: "center" }}>
            <div style={{ position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.28)" }}>
              <div style={{ height: "100%", width: "var(--pct, 0%)", background: "#fff", borderRadius: 2 }} />
            </div>
            <div style={{
              position: "absolute", left: "var(--pct, 0%)", transform: "translate(-50%, 0)",
              width: 13, height: 13, borderRadius: "50%", background: "#fff",
              pointerEvents: "none",
            }} />
            <input
              type="range"
              min={0}
              max={vpDuration > 0 ? vpDuration : 0}
              step={0.1}
              value={Math.min(vpCurrentTime, vpDuration > 0 ? vpDuration : vpCurrentTime)}
              aria-label={tCommon("videoProgress")}
              onChange={(e) => handleVPSeek(Number(e.currentTarget.value))}
              onMouseDown={() => showVPChrome()}
              onTouchStart={() => showVPChrome()}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", margin: 0 }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  // ─── MOBILE CAMERA VIEW ──────────────────────────────────────────────────────
  if (viewState === "camera" && isMobile) {
    const MIN_H = 130;
    const MAX_H = Math.round(window.innerHeight * 0.65);

    const handlePanelTouchStart = (e: React.TouchEvent) => {
      const touch = e.touches[0];
      panelDragStartRef.current = { y: touch.clientY, height: mobilePanelHeight };
      setMobilePanelDragging(true);
    };
    const handlePanelTouchMove = (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const delta = panelDragStartRef.current.y - touch.clientY; // positive = dragging up = panel grows
      const next = Math.max(MIN_H, Math.min(MAX_H, panelDragStartRef.current.height + delta));
      setMobilePanelHeight(next);
    };
    const handlePanelTouchEnd = () => setMobilePanelDragging(false);

    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: 10050, fontFamily: fontStack }}>

        {/* ── Camera / playback area — fills from top to panel ── */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          bottom: mobilePanelHeight,
          background: "#000", overflow: "hidden",
          borderRadius: "16px 16px 24px 24px",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}>
          {(viewMode || buyerViewMode) ? (
            viewMp4Url ? (
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <video
                  ref={playbackVideoRef}
                  src={viewMp4Url}
                  poster={viewThumbnailUrl ?? undefined}
                  autoPlay playsInline
                  disablePictureInPicture
                  onContextMenu={(e) => e.preventDefault()}
                  onLoadedMetadata={(e) => { const d = e.currentTarget.duration; setVpDuration(Number.isFinite(d) && d > 0 ? d : 0); setVpReady(true); }}
                  onLoadedData={() => setVpReady(true)}
                  onTimeUpdate={(e) => setVpCurrentTime(e.currentTarget.currentTime)}
                  onPlay={() => { setVpPlaying(true); scheduleVPChromeHide(); }}
                  onPause={() => { setVpPlaying(false); showVPChrome(); }}
                  onEnded={() => { setVpPlaying(false); showVPChrome(); }}
                  style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
                />
                {vpControlsOverlay}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: 13, height: "100%" }}>
                Video no disponible
              </div>
            )
          ) : (
            <>
              {/* Live webcam */}
              <video
                ref={videoRef}
                autoPlay muted playsInline
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: recordPhase === "done" ? "none" : "block" }}
              />
              {/* Playback */}
              {recordPhase === "done" && recordedBlobUrl && (
                <div style={{ position: "relative", width: "100%", height: "100%" }}>
                  <video
                    ref={playbackVideoRef}
                    src={recordedBlobUrl}
                    playsInline
                    disablePictureInPicture
                    onContextMenu={(e) => e.preventDefault()}
                    onLoadedMetadata={(e) => fixPreviewDuration(e.currentTarget)}
                    onLoadedData={() => setVpReady(true)}
                    onTimeUpdate={(e) => setVpCurrentTime(e.currentTarget.currentTime)}
                    onPlay={() => setVpPlaying(true)}
                    onPause={() => setVpPlaying(false)}
                    onEnded={() => setVpPlaying(false)}
                    style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
                  />
                  {vpControlsOverlay}
                </div>
              )}
              {/* Timer */}
              {recordPhase === "recording" && (
                <div style={{
                  position: "absolute", top: "calc(16px + env(safe-area-inset-top, 0px))",
                  left: "50%", transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.55)", borderRadius: 20, padding: "4px 14px",
                  display: "flex", alignItems: "center", gap: 7,
                  color: "#fff", fontWeight: 600, fontSize: 14, fontFamily: fontStack,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "block" }} />
                  {formatTime(recordingSeconds)}
                </div>
              )}
              {recordPhase !== "done" && renderSourceChip(
                recordPhase === "recording" ? 54 : 16
              )}
              {recordPhase === "recording" && getRecordingMessage(recordingSeconds, req.type) && (
                <div style={{
                  position: "absolute", bottom: 110, left: "50%", transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.62)", borderRadius: 20, padding: "5px 14px",
                  color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: fontStack,
                  whiteSpace: "nowrap", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
                }}>
                  {getRecordingMessage(recordingSeconds, req.type)}
                </div>
              )}
              {cameraRecordButton}
            </>
          )}
        </div>

        {/* ── Draggable panel ── */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: mobilePanelHeight,
          borderRadius: "20px 20px 0 0",
          background: "linear-gradient(145deg, rgb(6,3,12) 0%, rgb(10,5,20) 100%)",
          border: "1px solid rgba(168,85,255,0.15)",
          borderBottom: "none",
          boxShadow: "0 -8px 24px rgba(0,0,0,0.5)",
          overflow: "hidden",
          transition: mobilePanelDragging ? "none" : "height 120ms ease",
          boxSizing: "border-box",
        }}>
          {/* Drag handle — handle bar + buyer row with slide */}
          <div
            onTouchStart={handlePanelTouchStart}
            onTouchMove={handlePanelTouchMove}
            onTouchEnd={handlePanelTouchEnd}
            style={{ padding: "10px 16px 12px", touchAction: "none", userSelect: "none", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.22)", margin: "0 auto" }} />
            <div style={slideStyle}>{buyerRow}</div>
          </div>

          {/* Scrollable content */}
          <div style={{ overflowY: "auto", padding: "0 16px", paddingBottom: "calc(14px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, ...slideStyle }}>
              {divider}
              {infoSection}
              {divider}
            </div>
            {(viewMode || buyerViewMode) ? (
              <>
                {buyerViewMode && (req.type === "saludo" || req.type === "consejo") && (
                  <>
                    <button
                      type="button"
                      onClick={existingStory ? handleRemoveFromStory : handleAddToStoryAsBuyer}
                      disabled={addingStory || removingStory}
                      style={{
                        width: "100%", height: 42, borderRadius: 12,
                        border: existingStory
                          ? "1px solid rgba(239,68,68,0.35)"
                          : "1px solid rgba(168,85,247,0.6)",
                        background: existingStory
                          ? "rgba(239,68,68,0.1)"
                          : "rgba(168,85,247,0.18)",
                        color: existingStory ? "#fca5a5" : "#d8b4fe",
                        fontWeight: 700, fontSize: 14,
                        cursor: (addingStory || removingStory) ? "default" : "pointer",
                        fontFamily: fontStack,
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                        opacity: (addingStory || removingStory) ? 0.7 : 1,
                        transition: "background 200ms ease, color 200ms ease",
                      }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>
                        {existingStory ? "✕" : "◎"}
                      </span>
                      {removingStory ? tServices("removing") : addingStory ? tServices("adding") : existingStory ? tServices("removeFromMyStory") : tServices("addToMyStory")}
                    </button>
                  </>
                )}
                {buyerViewMode && viewMp4Url && (
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      width: "100%", height: 42, borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: downloading ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)",
                      color: downloading ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.75)",
                      fontWeight: 600, fontSize: 13, cursor: downloading ? "default" : "pointer",
                      fontFamily: fontStack, boxSizing: "border-box",
                    }}
                  >
                    {downloading ? tServices("downloadingProgress", { progress: downloadProgress }) : tServices("downloadVideo")}
                  </button>
                )}
                {viewMode && !buyerViewMode && (req.type === "saludo" || req.type === "consejo") && (
                  req.allowCreatorStory !== false ? (
                    <>
                      <button
                        type="button"
                        onClick={existingStory ? handleRemoveFromStory : handleAddToStory}
                        disabled={addingStory || removingStory}
                        style={{
                          width: "100%", height: 42, borderRadius: 12,
                          border: existingStory
                            ? "1px solid rgba(239,68,68,0.35)"
                            : "1px solid rgba(168,85,247,0.6)",
                          background: existingStory
                            ? "rgba(239,68,68,0.1)"
                            : "rgba(168,85,247,0.18)",
                          color: existingStory ? "#fca5a5" : "#d8b4fe",
                          fontWeight: 700, fontSize: 14,
                          cursor: (addingStory || removingStory) ? "default" : "pointer",
                          fontFamily: fontStack,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                          opacity: (addingStory || removingStory) ? 0.7 : 1,
                          transition: "background 200ms ease, color 200ms ease",
                        }}
                      >
                        <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>
                          {existingStory ? "✕" : "◎"}
                        </span>
                        {removingStory ? tServices("removing") : addingStory ? tServices("adding") : existingStory ? tServices("removeStory") : tServices("addToStory")}
                      </button>
                    </>
                  ) : (
                    <div style={{ borderRadius: 12, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>🔒</span>
                      <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 12, fontFamily: fontStack }}>
                        {req.type === "consejo" ? tServices("buyerNoStoryPermissionAdvice") : tServices("buyerNoStoryPermissionGreeting")}
                      </span>
                    </div>
                  )
                )}
                <button type="button" onClick={handleClose} style={{
                  width: "100%", height: 42, borderRadius: 12,
                  border: "none", background: "transparent",
                  color: "rgba(255,255,255,0.45)", fontWeight: 500, fontSize: 13,
                  cursor: "pointer", fontFamily: fontStack,
                }}>
                  {tCommon("close")}
                </button>
              </>
            ) : uploadSucceeded ? successContent : (
              <>
                {recordControls}
                {recordPhase === "preview" && (
                  <button type="button" onClick={() => { setUploadError(null); fileInputRef.current?.click(); }} style={{
                    width: "100%", height: 38, borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)",
                    color: "rgba(255,255,255,0.5)", fontWeight: 500, fontSize: 13,
                    cursor: "pointer", fontFamily: fontStack,
                  }}>
                    {tServices("uploadVideo")}
                  </button>
                )}
                <button type="button" onClick={stopCamera} style={{
                  width: "100%", height: 38, borderRadius: 10,
                  border: "none", background: "transparent",
                  color: "rgba(255,255,255,0.3)", fontWeight: 500, fontSize: 13,
                  cursor: "pointer", fontFamily: fontStack,
                }}>
                  {tCommon("cancel")}
                </button>
              </>
            )}
          </div>
        </div>

        {fileInput}
      </div>,
      document.body
    );
  }

  // ─── DESKTOP CAMERA VIEW ─────────────────────────────────────────────────────
  if (viewState === "camera" && !isMobile) {
    return createPortal(
      <div style={{
        position: "fixed", inset: 0, zIndex: 10050,
        background: "rgba(0,0,0,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px 24px", boxSizing: "border-box", fontFamily: fontStack,
      }}
        onClick={handleClose}
      >
        <div style={{
          ...containerBase,
          width: "90vw",
          maxWidth: 1100,
          height: "min(82vh, 720px)",
          display: "flex",
          flexDirection: "row",
          gap: 24,
          alignItems: "stretch",
          overflow: "hidden",
          padding: 0,
        }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Left: info panel — narrow, scrollable */}
          <div style={{
            width: "clamp(220px, 24%, 280px)",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            overflowY: "auto",
            padding: 20,
            borderRight: "1px solid rgba(255,255,255,0.06)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#fff", fontWeight: 500, fontSize: 16, letterSpacing: "-0.02em" }}>
                {cameraTitleText}
              </span>
              <button type="button" onClick={handleClose} style={{
                background: "transparent", border: "none", color: "rgba(255,255,255,0.45)",
                cursor: "pointer", padding: "4px 6px", fontSize: 16, lineHeight: 1, borderRadius: 8,
              }}>
                ✕
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, ...slideStyle }}>
              {buyerRow}
              {divider}
              {infoSection}
            </div>
            <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {(viewMode || buyerViewMode) ? (
                <>
                  {buyerViewMode && (req.type === "saludo" || req.type === "consejo") && (
                    <>
                      <button
                        type="button"
                        onClick={existingStory ? handleRemoveFromStory : handleAddToStoryAsBuyer}
                        disabled={addingStory || removingStory}
                        style={{
                          width: "100%", height: 38, borderRadius: 10,
                          border: existingStory
                            ? "1px solid rgba(239,68,68,0.35)"
                            : "1px solid rgba(168,85,247,0.6)",
                          background: existingStory
                            ? "rgba(239,68,68,0.1)"
                            : "rgba(168,85,247,0.18)",
                          color: existingStory ? "#fca5a5" : "#d8b4fe",
                          fontWeight: 700, fontSize: 13,
                          cursor: (addingStory || removingStory) ? "default" : "pointer",
                          fontFamily: fontStack,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                          opacity: (addingStory || removingStory) ? 0.7 : 1,
                          transition: "background 200ms ease, color 200ms ease",
                        }}
                      >
                        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
                          {existingStory ? "✕" : "◎"}
                        </span>
                        {removingStory ? tServices("removing") : addingStory ? tServices("adding") : existingStory ? tServices("removeFromMyStory") : tServices("addToMyStory")}
                      </button>
                    </>
                  )}
                  {buyerViewMode && viewMp4Url && (
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={downloading}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        width: "100%", height: 38, borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: downloading ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)",
                        color: downloading ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.75)",
                        fontWeight: 600, fontSize: 13, cursor: downloading ? "default" : "pointer",
                        fontFamily: fontStack, boxSizing: "border-box",
                      }}
                    >
                      {downloading ? tServices("downloadingProgress", { progress: downloadProgress }) : tServices("downloadVideo")}
                    </button>
                  )}
                  {viewMode && !buyerViewMode && (req.type === "saludo" || req.type === "consejo") && (
                    req.allowCreatorStory !== false ? (
                      <>
                        <button
                          type="button"
                          onClick={existingStory ? handleRemoveFromStory : handleAddToStory}
                          disabled={addingStory || removingStory}
                          style={{
                            width: "100%", height: 38, borderRadius: 10,
                            border: existingStory
                              ? "1px solid rgba(239,68,68,0.35)"
                              : "1px solid rgba(168,85,247,0.6)",
                            background: existingStory
                              ? "rgba(239,68,68,0.1)"
                              : "rgba(168,85,247,0.18)",
                            color: existingStory ? "#fca5a5" : "#d8b4fe",
                            fontWeight: 700, fontSize: 13,
                            cursor: (addingStory || removingStory) ? "default" : "pointer",
                            fontFamily: fontStack,
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                            opacity: (addingStory || removingStory) ? 0.7 : 1,
                            transition: "background 200ms ease, color 200ms ease",
                          }}
                        >
                          <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
                            {existingStory ? "✕" : "◎"}
                          </span>
                          {removingStory ? tServices("removing") : addingStory ? tServices("adding") : existingStory ? tServices("removeStory") : tServices("addToStory")}
                        </button>
                      </>
                    ) : (
                      <div style={{ borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 8 }}>
                        <span>🔒</span>
                        <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, fontFamily: fontStack }}>
                          {req.type === "consejo" ? tServices("buyerNoStoryPermissionAdvice") : tServices("buyerNoStoryPermissionGreeting")}
                        </span>
                      </div>
                    )
                  )}
                  <button type="button" onClick={handleClose} style={{
                    width: "100%", height: 38, borderRadius: 10,
                    border: "none", background: "transparent",
                    color: "rgba(255,255,255,0.38)", fontWeight: 500, fontSize: 13,
                    cursor: "pointer", fontFamily: fontStack,
                  }}>
                    {tCommon("close")}
                  </button>
                </>
              ) : uploadSucceeded ? successContent : (
                <>
                  {recordControls}
                  {recordPhase === "preview" && (
                    <button type="button" onClick={() => { setUploadError(null); fileInputRef.current?.click(); }} style={{
                      width: "100%", height: 34, borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.08)", background: "transparent",
                      color: "rgba(255,255,255,0.38)", fontWeight: 500, fontSize: 12,
                      cursor: "pointer", fontFamily: fontStack,
                    }}>
                      {tServices("uploadVideo")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {fileInput}
          {/* Right: camera / playback fills remaining height */}
          <div style={{ flex: 1, minWidth: 0, padding: "20px 20px 20px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "relative", height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {(viewMode || buyerViewMode) ? (
                viewMp4Url ? (
                  <div style={{ position: "relative", height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <video
                      ref={playbackVideoRef}
                      src={viewMp4Url}
                      poster={viewThumbnailUrl ?? undefined}
                      autoPlay playsInline
                      disablePictureInPicture
                      onContextMenu={(e) => e.preventDefault()}
                      onLoadedMetadata={(e) => { const d = e.currentTarget.duration; setVpDuration(Number.isFinite(d) && d > 0 ? d : 0); setVpReady(true); }}
                      onLoadedData={() => setVpReady(true)}
                      onTimeUpdate={(e) => setVpCurrentTime(e.currentTarget.currentTime)}
                      onPlay={() => setVpPlaying(true)}
                      onPause={() => setVpPlaying(false)}
                      onEnded={() => setVpPlaying(false)}
                      style={{
                        height: "100%", width: "auto", maxWidth: "100%",
                        borderRadius: 14, objectFit: "contain", background: "#000",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    />
                    {vpControlsOverlay}
                  </div>
                ) : (
                  <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
                    Video no disponible
                  </div>
                )
              ) : (
                <>
                  {/* Live webcam — hidden when done */}
                  <video
                    ref={videoRef}
                    autoPlay muted playsInline
                    disablePictureInPicture
                    onContextMenu={(e) => e.preventDefault()}
                    style={{
                      height: "100%", width: "auto", maxWidth: "100%",
                      borderRadius: 14, objectFit: "contain", background: "#000",
                      display: recordPhase === "done" ? "none" : "block",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  />
                  {recordPhase === "done" && recordedBlobUrl && (
                    <div style={{ position: "relative", height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <video
                      ref={playbackVideoRef}
                      src={recordedBlobUrl}
                      playsInline
                      disablePictureInPicture
                      onContextMenu={(e) => e.preventDefault()}
                      onLoadedMetadata={(e) => fixPreviewDuration(e.currentTarget)}
                      onLoadedData={() => setVpReady(true)}
                      onTimeUpdate={(e) => setVpCurrentTime(e.currentTarget.currentTime)}
                      onPlay={() => setVpPlaying(true)}
                      onPause={() => setVpPlaying(false)}
                      onEnded={() => setVpPlaying(false)}
                      style={{
                        height: "100%", width: "auto", maxWidth: "100%",
                        borderRadius: 14, objectFit: "contain", background: "#000",
                        display: "block", border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    />
                    {vpControlsOverlay}
                    </div>
                  )}
                  {recordPhase === "recording" && (
                    <div style={{
                      position: "absolute", top: "calc(14px + env(safe-area-inset-top, 0px))", left: "50%", transform: "translateX(-50%)",
                      background: "rgba(0,0,0,0.55)", borderRadius: 20, padding: "4px 14px",
                      display: "flex", alignItems: "center", gap: 7,
                      color: "#fff", fontWeight: 600, fontSize: 14, fontFamily: fontStack,
                      backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "block", flexShrink: 0 }} />
                      {formatTime(recordingSeconds)}
                    </div>
                  )}
                  {recordPhase !== "done" && renderSourceChip(recordPhase === "recording" ? 56 : 14)}
                  {recordPhase === "recording" && getRecordingMessage(recordingSeconds, req.type) && (
                    <div style={{
                      position: "absolute", bottom: 110, left: "50%", transform: "translateX(-50%)",
                      background: "rgba(0,0,0,0.62)", borderRadius: 20, padding: "5px 14px",
                      color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: fontStack,
                      whiteSpace: "nowrap", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", textAlign: "center",
                    }}>
                      {getRecordingMessage(recordingSeconds, req.type)}
                    </div>
                  )}
                  {cameraRecordButton}
                </>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  const reviewBgImage = req.type === "consejo" ? "/consejo.webp" : req.type === "saludo" ? "/saludo.webp" : null;
  const REVIEW_BG_CSS = `
    .grv-bg-img {
      position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
      background-size: cover; background-position: center 40%; background-repeat: no-repeat;
      opacity: 0.52;
    }
    .grv-bg-grad {
      position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 1;
      background: linear-gradient(to bottom,
        #0a0a0a 28%,
        rgba(10,10,10,0.72) 46%,
        rgba(10,10,10,0.62) 60%,
        rgba(10,10,10,0.82) 78%,
        #0a0a0a 100%
      );
      -webkit-transform: translateZ(0); transform: translateZ(0); will-change: opacity;
    }
    .grv-z2 { position: relative; z-index: 2; }
    @media (max-width: 900px) {
      .grv-bg-img {
        background-position: center 38%;
      }
      .grv-bg-grad {
        background: linear-gradient(to bottom,
          #0a0a0a 0%,
          #0a0a0a 34%,
          rgba(10,10,10,0.72) 52%,
          rgba(10,10,10,0.62) 64%,
          rgba(10,10,10,0.82) 80%,
          #0a0a0a 100%
        );
      }
    }
  `;

  // ─── REVIEW VIEW — MOBILE (bottom sheet) ────────────────────────────────────
  if (isMobile) {
    return createPortal(
      <>
        {/* Backdrop */}
        <div
          onClick={handleReviewBackdropClose}
          style={{
            position: "fixed", inset: 0, zIndex: 10050,
            background: "rgba(0,0,0,0.52)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          } as React.CSSProperties}
        />
        {/* Bottom sheet */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          zIndex: 10051,
          maxHeight: "calc(100vh - 72px)",
          display: "flex", flexDirection: "column",
          borderRadius: "22px 22px 0 0",
          background: "#0a0a0a",
          boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
          overflow: "hidden",
          transform: reviewSheetTransform,
          transition: reviewSheetDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          fontFamily: fontStack,
          boxSizing: "border-box",
          willChange: "transform",
        }}>
          <style>{REVIEW_BG_CSS}</style>
          {reviewBgImage && <div className="grv-bg-img" style={{ backgroundImage: `url('${reviewBgImage}')` }} />}
          {reviewBgImage && <div className="grv-bg-grad" />}
          {/* Draggable header — handle + título + buyer row */}
          <div
            className="grv-z2"
            onTouchStart={handleReviewTouchStart}
            onTouchMove={handleReviewTouchMove}
            onTouchEnd={handleReviewTouchEnd}
            style={{ padding: "10px 18px 14px", userSelect: "none", touchAction: "none", display: "flex", flexDirection: "column", gap: 14, flexShrink: 0 }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)", margin: "0 auto" }} />
            <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 72px", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 10, marginBottom: 4 }}>
              <div aria-hidden="true" />
              <span style={{ color: "#fff", fontWeight: 500, fontSize: 17, letterSpacing: "-0.02em", textAlign: "center" }}>
                {titleText}
              </span>
              <button type="button" onClick={handleClose} aria-label={tCommon("closeAriaLabel")} style={{ border: "none", background: "none", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4, width: 40, height: 40, fontSize: 28, fontWeight: 300, lineHeight: 1, fontFamily: fontStack }}>×</button>
            </div>
            <div style={slideStyle}>{buyerRow}</div>
          </div>

          {/* Scrollable content + actions inline */}
          <div className="grv-z2" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "0 18px", paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, ...slideStyle }}>
              {infoSection}
              {readOnly ? (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14, marginTop: 6 }}>
                  <button type="button" onClick={handleClose} style={{
                    width: "100%", height: 44, borderRadius: 10,
                    border: "none", background: "rgba(255,255,255,0.08)",
                    color: "#fff",
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                    fontFamily: fontStack, letterSpacing: "-0.01em",
                  }}>
                    {tCommon("closeLabel")}
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={handleGrabar} disabled={busy} style={{
                    flex: 1, height: 36, borderRadius: 6,
                    border: "none",
                    background: busy ? "rgba(255,255,255,0.10)" : req.type === "consejo"
                      ? "linear-gradient(100deg, #b45309, #fde047)"
                      : "linear-gradient(100deg, #7c3aed, #c084fc)",
                    color: "#fff",
                    fontWeight: 700, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.7 : 1,
                    fontFamily: fontStack,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: "50%",
                      border: "2px solid rgba(255,255,255,0.85)",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "block" }} />
                    </span>
                    Comenzar
                  </button>
                  <button type="button" onClick={() => onReject(currentItem.id)} disabled={busy} style={{
                    flex: 1, height: 36, borderRadius: 6,
                    border: "none", background: "rgba(255,255,255,0.10)",
                    color: "rgba(255,255,255,0.70)",
                    fontWeight: 500, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.7 : 1,
                    fontFamily: fontStack,
                  }}>
                    {busy ? tCommon("processing") : tCommon("reject")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ─── REVIEW VIEW — DESKTOP (centered modal) ──────────────────────────────────
  const portal = createPortal(
    <>
      <style>{`
        @keyframes grvDesktopIn  { from { opacity:0; transform:scale(0.94) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
        ${REVIEW_BG_CSS}
      `}</style>
      <div style={{
        position: "fixed", inset: 0, zIndex: 10050,
        background: "rgba(0,0,0,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, boxSizing: "border-box", fontFamily: fontStack,
      }}
        onClick={handleClose}
      >
        <section style={{
          position: "relative",
          width: "min(100%, 540px)",
          maxHeight: "min(88vh, 680px)",
          display: "flex", flexDirection: "column",
          borderRadius: 18,
          background: "#0a0a0a",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff",
          overflow: "hidden",
          animation: "grvDesktopIn 180ms ease-out",
          fontFamily: fontStack,
        }}
          onClick={(e) => e.stopPropagation()}
        >
          {reviewBgImage && <div className="grv-bg-img" style={{ backgroundImage: `url('${reviewBgImage}')` }} />}
          {reviewBgImage && <div className="grv-bg-grad" />}
          {/* Header */}
          <div className="grv-z2" style={{ height: 56, display: "grid", gridTemplateColumns: "48px 1fr 48px", alignItems: "center", padding: "0 12px", borderBottom: "1px solid rgba(255,255,255,0.10)", flexShrink: 0 }}>
            <div aria-hidden="true" />
            <span style={{ color: "#fff", fontWeight: 500, fontSize: 17, letterSpacing: "-0.02em", textAlign: "center" }}>
              {titleText}
            </span>
            <button type="button" onClick={handleClose} aria-label={tCommon("closeAriaLabel")} style={{ border: "none", background: "none", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4, width: 40, height: 40, fontSize: 28, fontWeight: 300, lineHeight: 1, fontFamily: fontStack }}>×</button>
          </div>

          <div className="grv-z2" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 20px", display: "grid", gap: 16, alignContent: "start", ...slideStyle }}>
            {buyerRow}
            {infoSection}

            {/* Actions */}
            {readOnly ? (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14, marginTop: 6 }}>
                <button type="button" onClick={handleClose} style={{
                  width: "100%", height: 44, borderRadius: 10,
                  border: "none", background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                  fontFamily: fontStack, letterSpacing: "-0.01em",
                }}>
                  {tCommon("closeLabel")}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={handleGrabar} disabled={busy} style={{
                  flex: 1, height: 36, borderRadius: 6,
                  border: "none",
                  background: busy ? "rgba(255,255,255,0.10)" : req.type === "consejo"
                    ? "linear-gradient(100deg, #b45309, #fde047)"
                    : "linear-gradient(100deg, #7c3aed, #c084fc)",
                  color: "#fff",
                  fontWeight: 700, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.7 : 1,
                  fontFamily: fontStack,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.85)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "block" }} />
                  </span>
                  Comenzar
                </button>
                <button type="button" onClick={() => onReject(currentItem.id)} disabled={busy} style={{
                  flex: 1, height: 36, borderRadius: 6,
                  border: "none", background: "rgba(255,255,255,0.10)",
                  color: "rgba(255,255,255,0.70)",
                  fontWeight: 500, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.7 : 1,
                  fontFamily: fontStack,
                }}>
                  {busy ? tCommon("processing") : tCommon("reject")}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </>,
    document.body
  );

  return <>
    {portal}
    <VibraToast toast={overlayToast} />
  </>;
}
