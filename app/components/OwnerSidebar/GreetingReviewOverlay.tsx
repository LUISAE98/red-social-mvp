"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createGreetingMuxUpload } from "@/lib/greetings/greetingRequests";
import { addStoryFromGreeting, deleteStory, subscribeToStoryByGreeting } from "@/lib/stories/storyService";
import type { StoryDoc } from "@/lib/stories/types";
import type { GreetingRequestDoc, UserMini } from "./OwnerSidebar";

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function getRelativeTime(createdAt?: { toDate: () => Date } | null): string {
  if (!createdAt) return "Hace un momento";
  const diffMs = Date.now() - createdAt.toDate().getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return `Hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
  if (diffHours >= 1) return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  if (diffMins >= 1) return `Hace ${diffMins} ${diffMins === 1 ? "minuto" : "minutos"}`;
  return "Hace un momento";
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
  onAccept,
  onReject,
  onClose,
  getInitials,
  typeLabel,
  viewMode = false,
  buyerViewMode = false,
  buyerSourceName,
  buyerSourceAvatar,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [earningFormatted, setEarningFormatted] = useState<string | null>(null);
  const [sourceInfo, setSourceInfo] = useState<{ name: string; photoURL: string | null } | null>(null);
  const [viewState, setViewState] = useState<ViewState>(viewMode ? "camera" : "review");
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("preview");
  const [isMobile, setIsMobile] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
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
  // viewMode story state
  const [existingStory, setExistingStory] = useState<StoryDoc | null>(null);
  const [removingStory, setRemovingStory] = useState(false);

  // TTS state
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechHighlight, setSpeechHighlight] = useState<{ start: number; length: number } | null>(null);
  const speechOffsetRef = useRef(0);
  const speechGenRef = useRef(0);
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
        const resolvedName = rawName || "Comunidad";
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
      setEarningFormatted(
        "$" +
          new Intl.NumberFormat("es-MX", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(net) +
          ` ${cur}`
      );
    }).catch(() => {});
  }, [currentIndex, items]);

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
      speechGenRef.current++;
      window.speechSynthesis?.cancel();
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

  function getRecordingMessage(seconds: number, type: string): string | null {
    if (type === "saludo") {
      if (seconds >= 210) {
        const rem = 240 - seconds;
        return rem > 0 ? `El saludo concluirá en ${rem} ${rem === 1 ? "segundo" : "segundos"}` : null;
      }
      if (seconds >= 180 && seconds < 190) return "Este saludo es considerablemente más largo de lo habitual";
      if (seconds >= 120 && seconds < 130) return "Este saludo ya supera la duración habitual";
      if (seconds >= 60 && seconds < 70) return "Ya estás en el tiempo promedio de un saludo personalizado";
    }
    if (type === "consejo") {
      if (seconds >= 390) {
        const rem = 420 - seconds;
        return rem > 0 ? `El consejo concluirá en ${rem} ${rem === 1 ? "segundo" : "segundos"}` : null;
      }
      if (seconds >= 300 && seconds < 310) return "Este consejo ya supera la duración habitual";
      if (seconds >= 150 && seconds < 160) return "Ya estás en el tiempo promedio de un consejo";
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
          else reject(new Error(`Error al subir: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Error de red al subir el video."));
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
    } catch (e: any) {
      setUploadError(e?.message ?? "No se pudo subir el video. Intenta de nuevo.");
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

  const titleText = viewMode
    ? (req.type === "consejo" ? "Ver Consejo" : req.type === "mensaje" ? "Ver Mensaje" : "Ver Saludo")
    : req.type === "consejo"
      ? "Revisar Consejo"
      : req.type === "mensaje"
        ? "Revisar Mensaje"
        : "Revisar Saludo";

  const cameraTitleText = viewMode ? titleText
    : req.type === "consejo"
      ? "Responder Consejo"
      : req.type === "mensaje"
        ? "Responder Mensaje"
        : "Responder Saludo";

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
      setCameraError("No se pudo acceder a la cámara. Verifica los permisos.");
    }
  };

  const handleStartRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const preferredTypes = [
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    mimeTypeRef.current = mimeType;
    const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "video/webm" });
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
      setCameraError("No se pudo acceder a la cámara.");
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
        setUploadError(`El video supera el máximo de ${maxLabel} para este tipo de servicio.`);
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
      setUploadError("No se pudo leer el archivo de video.");
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
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
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
      setCameraError("No se pudo acceder a la cámara.");
    });
  };

  const stopCamera = () => {
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

  // ─── TTS functions — must be before any early return ────────────────────────
  const startSpeechFrom = useCallback((charIndex: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const text = (items[currentIndex] ?? items[0])?.data.instructions ?? "";
    if (!text) return;
    window.speechSynthesis.cancel();
    speechOffsetRef.current = charIndex;
    const gen = ++speechGenRef.current;
    setSpeechHighlight(charIndex > 0 ? { start: charIndex, length: 0 } : null);
    const utterance = new SpeechSynthesisUtterance(text.slice(charIndex));
    utterance.lang = "es-MX";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onboundary = (e) => {
      if (speechGenRef.current !== gen || e.name !== "word") return;
      const absIndex = charIndex + e.charIndex;
      const fromIndex = text.slice(absIndex);
      const spaceAt = fromIndex.search(/[\s\n]/);
      const length = e.charLength ?? (spaceAt === -1 ? fromIndex.length : spaceAt);
      setSpeechHighlight({ start: absIndex, length });
    };
    utterance.onend = () => {
      if (speechGenRef.current !== gen) return;
      setSpeechState("idle");
      setSpeechHighlight(null);
    };
    utterance.onerror = () => {
      if (speechGenRef.current !== gen) return;
      setSpeechState("idle");
      setSpeechHighlight(null);
    };
    window.speechSynthesis.speak(utterance);
    setSpeechState("playing");
  }, [items, currentIndex]);

  const handleToggleSpeech = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speechState === "playing") { window.speechSynthesis.pause(); setSpeechState("paused"); return; }
    if (speechState === "paused") { window.speechSynthesis.resume(); setSpeechState("playing"); return; }
    startSpeechFrom(0);
  }, [speechState, startSpeechFrom]);

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
          const pos = (document as Document & { caretPositionFromPoint(x: number, y: number): { offsetNode: Node; offset: number } | null }).caretPositionFromPoint(e.clientX, e.clientY);
          if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
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
  const successFmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const successLabel = req.type === "consejo" ? "¡Consejo enviado!" : req.type === "mensaje" ? "¡Mensaje enviado!" : "¡Saludo enviado!";

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
          {`Grabaste ${successCompletedCount} ${successCompletedCount === 1 ? "saludo o consejo" : "saludos y consejos"} y ganaste $${successFmt.format(successTotalEarned)} MXN`}
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
                ? "Agregando..."
                : storyAdded
                  ? "Agregado a tu historia"
                  : "Agregar a historia"}
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
                El comprador no permitió publicar este {req.type === "consejo" ? "consejo" : "saludo"} en historias
              </span>
            </div>
          )
        )}
        {storyError && (
          <span style={{ color: "#f87171", fontSize: 12, textAlign: "center", fontFamily: fontStack }}>
            {storyError}
          </span>
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
          {successIsLast ? "Cerrar" : "Cancelar"}
        </button>
      </div>
    </div>
  );

  const typeWord = req.type === "consejo" ? "consejo" : req.type === "mensaje" ? "mensaje" : "saludo";
  // Profile source: name is always "Tu perfil", photo comes from buyers[creatorId] (already loaded)
  // Group source: name and photo come from sourceInfo (loaded async from Firestore)
  const sourceName = req.source === "profile" ? "Tu perfil" : (sourceInfo?.name ?? null);
  const sourcePhotoURL = req.source === "profile"
    ? (buyers[req.creatorId]?.photoURL ?? null)
    : (sourceInfo?.photoURL ?? null);

  function renderSourceChip(topValue: number | string) {
    if (!sourceName) return null;
    return (
      <div style={{
        position: "absolute", top: topValue, left: "50%", transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
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
          <img
            src={sourcePhotoURL}
            alt={sourceName}
            style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.15)" }}
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
        <img
          src={buyerSourceAvatar}
          alt={buyerSourceName}
          style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}
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
          {buyerSourceName ?? "Creador"}
        </span>
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3 }}>
          {getRelativeTime(req.deliveredAt ?? req.createdAt)}
        </span>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {buyer?.photoURL ? (
        <img
          src={buyer.photoURL}
          alt={buyer.displayName}
          style={{
            width: 38, height: 38, borderRadius: "50%", objectFit: "cover",
            border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0,
          }}
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
            {buyer?.displayName ?? "Usuario"}
          </span>
        )}
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3 }}>
          {getRelativeTime(req.createdAt)}
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
            <button
              type="button"
              aria-label={speechState === "playing" ? "Pausar lectura" : speechState === "paused" ? "Reanudar lectura" : "Leer contexto"}
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
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Solicitado el</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDateDisplay(req.createdAt.toDate())}</span>
        </div>
      )}
      {viewMode && req.deliveredAt && (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Enviado el</span>
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
            {uploadProgress < 100 ? `Subiendo... ${uploadProgress}%` : "Procesando..."}
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
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", fontFamily: fontStack }}>Archivo listo para subir</span>
        </div>
      )}
      <button type="button" onClick={handleRepeat} disabled={busy || isUploading} style={{
        width: "100%", height: 38, borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)",
        color: (busy || isUploading) ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.65)",
        fontWeight: 600, fontSize: 13,
        cursor: (busy || isUploading) ? "not-allowed" : "pointer", fontFamily: fontStack,
      }}>
        {wasUploadedRef.current ? "Cambiar archivo" : "Repetir grabación"}
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
          ? (uploadProgress < 100 ? `Subiendo ${uploadProgress}%` : "Procesando...")
          : `Enviar ${req.type === "consejo" ? "consejo" : req.type === "mensaje" ? "mensaje" : "saludo"}`}
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
        }}>
          {(viewMode || buyerViewMode) ? (
            viewMp4Url ? (
              <video
                src={viewMp4Url}
                poster={viewThumbnailUrl ?? undefined}
                autoPlay controls playsInline
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
                style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
              />
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
                <video
                  src={recordedBlobUrl}
                  controls playsInline
                  disablePictureInPicture
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
                />
              )}
              {/* Timer */}
              {recordPhase === "recording" && (
                <div style={{
                  position: "absolute", top: "calc(16px + env(safe-area-inset-top))",
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
                recordPhase === "recording"
                  ? "calc(54px + env(safe-area-inset-top))"
                  : "calc(16px + env(safe-area-inset-top))"
              )}
              {recordPhase === "recording" && getRecordingMessage(recordingSeconds, req.type) && (
                <div style={{
                  position: "absolute", bottom: 110, left: "50%", transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.62)", borderRadius: 20, padding: "5px 14px",
                  color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: fontStack,
                  whiteSpace: "nowrap", backdropFilter: "blur(4px)",
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
                      {removingStory ? "Quitando..." : addingStory ? "Agregando..." : existingStory ? "Quitar de mi historia" : "Agregar a mi historia"}
                    </button>
                    {storyError && (
                      <span style={{ color: "#f87171", fontSize: 12, textAlign: "center", fontFamily: fontStack }}>
                        {storyError}
                      </span>
                    )}
                  </>
                )}
                {buyerViewMode && viewMp4Url && (
                  <a href={viewMp4Url} download target="_blank" rel="noopener noreferrer" style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "100%", height: 42, borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)",
                    color: "rgba(255,255,255,0.75)", fontWeight: 600, fontSize: 13,
                    textDecoration: "none", fontFamily: fontStack, boxSizing: "border-box",
                  }}>
                    ↓ Descargar video
                  </a>
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
                        {removingStory ? "Quitando..." : addingStory ? "Agregando..." : existingStory ? "Quitar historia" : "Agregar a historia"}
                      </button>
                      {storyError && (
                        <span style={{ color: "#f87171", fontSize: 12, textAlign: "center", fontFamily: fontStack }}>
                          {storyError}
                        </span>
                      )}
                    </>
                  ) : (
                    <div style={{ borderRadius: 12, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>🔒</span>
                      <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 12, fontFamily: fontStack }}>
                        El comprador no permitió publicar este {req.type === "consejo" ? "consejo" : "saludo"} en historias
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
                  Cerrar
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
                    Subir video
                  </button>
                )}
                <button type="button" onClick={stopCamera} style={{
                  width: "100%", height: 38, borderRadius: 10,
                  border: "none", background: "transparent",
                  color: "rgba(255,255,255,0.3)", fontWeight: 500, fontSize: 13,
                  cursor: "pointer", fontFamily: fontStack,
                }}>
                  Cancelar
                </button>
                {uploadError && (
                  <span style={{ fontSize: 11, color: "#f87171", textAlign: "center" }}>{uploadError}</span>
                )}
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
                        {removingStory ? "Quitando..." : addingStory ? "Agregando..." : existingStory ? "Quitar de mi historia" : "Agregar a mi historia"}
                      </button>
                      {storyError && (
                        <span style={{ color: "#f87171", fontSize: 11, textAlign: "center", fontFamily: fontStack }}>
                          {storyError}
                        </span>
                      )}
                    </>
                  )}
                  {buyerViewMode && viewMp4Url && (
                    <a href={viewMp4Url} download target="_blank" rel="noopener noreferrer" style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: "100%", height: 38, borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)",
                      color: "rgba(255,255,255,0.75)", fontWeight: 600, fontSize: 13,
                      textDecoration: "none", fontFamily: fontStack, boxSizing: "border-box",
                    }}>
                      ↓ Descargar video
                    </a>
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
                          {removingStory ? "Quitando..." : addingStory ? "Agregando..." : existingStory ? "Quitar historia" : "Agregar a historia"}
                        </button>
                        {storyError && (
                          <span style={{ color: "#f87171", fontSize: 11, textAlign: "center", fontFamily: fontStack }}>
                            {storyError}
                          </span>
                        )}
                      </>
                    ) : (
                      <div style={{ borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 8 }}>
                        <span>🔒</span>
                        <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, fontFamily: fontStack }}>
                          El comprador no permitió publicar este {req.type === "consejo" ? "consejo" : "saludo"} en historias
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
                    Cerrar
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
                      Subir video
                    </button>
                  )}
                  {uploadError && (
                    <span style={{ fontSize: 11, color: "#f87171", textAlign: "center" }}>{uploadError}</span>
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
                  <video
                    src={viewMp4Url}
                    poster={viewThumbnailUrl ?? undefined}
                    autoPlay controls playsInline
                    disablePictureInPicture
                    onContextMenu={(e) => e.preventDefault()}
                    style={{
                      height: "100%", width: "auto", maxWidth: "100%",
                      borderRadius: 14, objectFit: "contain", background: "#000",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  />
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
                    <video
                      src={recordedBlobUrl}
                      controls playsInline
                      disablePictureInPicture
                      onContextMenu={(e) => e.preventDefault()}
                      style={{
                        height: "100%", width: "auto", maxWidth: "100%",
                        borderRadius: 14, objectFit: "contain", background: "#000",
                        display: "block", border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    />
                  )}
                  {recordPhase === "recording" && (
                    <div style={{
                      position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
                      background: "rgba(0,0,0,0.55)", borderRadius: 20, padding: "4px 14px",
                      display: "flex", alignItems: "center", gap: 7,
                      color: "#fff", fontWeight: 600, fontSize: 14, fontFamily: fontStack,
                      backdropFilter: "blur(4px)",
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
                      whiteSpace: "nowrap", backdropFilter: "blur(4px)", textAlign: "center",
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

  // ─── REVIEW VIEW — MOBILE (bottom sheet) ────────────────────────────────────
  if (isMobile) {
    return createPortal(
      <>
        {/* Backdrop */}
        <div
          onClick={handleReviewBackdropClose}
          style={{
            position: "fixed", inset: 0, zIndex: 10050,
            background: "rgba(0,0,0,0.62)",
          }}
        />
        {/* Bottom sheet */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          zIndex: 10051,
          height: "55vh",
          overflowY: "auto",
          borderRadius: "20px 20px 0 0",
          background: "linear-gradient(145deg, rgb(6,3,12) 0%, rgb(10,5,20) 100%)",
          border: "1px solid rgba(168,85,255,0.15)",
          borderBottom: "none",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.55)",
          transform: reviewSheetTransform,
          transition: reviewSheetDragging ? "none" : "transform 320ms cubic-bezier(0.4,0,0.2,1)",
          fontFamily: fontStack,
          boxSizing: "border-box",
          willChange: "transform",
        }}>
          {/* Draggable header — handle + título + buyer row */}
          <div
            onTouchStart={handleReviewTouchStart}
            onTouchMove={handleReviewTouchMove}
            onTouchEnd={handleReviewTouchEnd}
            style={{ padding: "10px 16px 14px", userSelect: "none", touchAction: "none", display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.22)", margin: "0 auto" }} />
            <span style={{ color: "#fff", fontWeight: 500, fontSize: 17, letterSpacing: "-0.02em" }}>
              {titleText}
            </span>
            <div style={slideStyle}>{buyerRow}</div>
          </div>

          {/* Scrollable content + actions inline */}
          <div style={{ overflowY: "auto", padding: "0 16px", paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, ...slideStyle }}>
              {divider}
              {infoSection}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={handleGrabar} disabled={busy} style={{
                  flex: 1, height: 44, borderRadius: 12,
                  border: "1px solid rgba(59,130,246,0.35)",
                  background: busy ? "rgba(59,130,246,0.06)" : "rgba(59,130,246,0.18)",
                  color: busy ? "rgba(147,197,253,0.4)" : "#93c5fd",
                  fontWeight: 700, fontSize: 14, cursor: busy ? "not-allowed" : "pointer",
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
                  flex: 1, height: 44, borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)",
                  color: busy ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.65)",
                  fontWeight: 600, fontSize: 14, cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: fontStack,
                }}>
                  {busy ? "Procesando..." : "Rechazar"}
                </button>
              </div>
              {cameraError && (
                <span style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{cameraError}</span>
              )}
            </div>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ─── REVIEW VIEW — DESKTOP (centered modal) ──────────────────────────────────
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 10050,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16, boxSizing: "border-box", fontFamily: fontStack,
    }}
      onClick={handleClose}
    >
      <div style={{ ...containerBase, width: "100%", maxWidth: 380, display: "grid", gap: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#fff", fontWeight: 500, fontSize: 17, letterSpacing: "-0.02em" }}>
            {titleText}
          </span>
          <button type="button" onClick={handleClose} style={{
            background: "transparent", border: "none", color: "rgba(255,255,255,0.45)",
            cursor: "pointer", padding: "4px 6px", fontSize: 16, lineHeight: 1, borderRadius: 8,
          }}>
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gap: 16, ...slideStyle }}>
          {buyerRow}
          {divider}
          {infoSection}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={handleGrabar} disabled={busy} style={{
              flex: 1, height: 38, borderRadius: 10,
              border: "1px solid rgba(59,130,246,0.35)", background: busy ? "rgba(59,130,246,0.06)" : "rgba(59,130,246,0.18)",
              color: busy ? "rgba(147,197,253,0.4)" : "#93c5fd",
              fontWeight: 700, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
              fontFamily: fontStack, transition: "background 150ms",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.85)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "#ef4444",
                  display: "block",
                }} />
              </span>
              Comenzar
            </button>
            <button type="button" onClick={() => onReject(currentItem.id)} disabled={busy} style={{
              flex: 1, height: 38, borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)",
              color: busy ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.65)",
              fontWeight: 600, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
              fontFamily: fontStack, transition: "background 150ms",
            }}>
              {busy ? "Procesando..." : "Rechazar"}
            </button>
          </div>

          {cameraError && (
            <span style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{cameraError}</span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
