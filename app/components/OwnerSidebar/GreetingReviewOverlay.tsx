"use client";

import Image from "next/image";
import { IconButton } from "@/components/ui";
import { Switch } from "@/components/services/config/serviceConfigKit";
import { respondGreetingRequest } from "@/lib/greetings/greetingRequests";
import ConfirmPanel from "@/components/ui/ConfirmPanel";
import { createGreetingSampleUpload } from "@/lib/greetings/greetingSamples";
import { useExchangeRates } from "@/lib/currency/rates";
import { convertToAnchor } from "@/lib/currency/format";
import { ANCHOR_CURRENCY } from "@/lib/currency/catalog";
import { useCfError } from "@/lib/i18n/cfError";
import { formatDateTimeLong } from "@/lib/i18n/dateTime";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import Link from "next/link";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
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
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";

const fontStack =
  'inherit';

/** El aro de las historias. Mismo valor que en StoryCircle y StoryRingAvatar. */
const VIBRA_GRADIENT = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

/** Guiones del prompter, indexados por encargo. Solo en el dispositivo. */
const PROMPTER_STORAGE_KEY = "vibra.greetingPrompter.v1";

/** Lo que tarda el cruce entre la grabación y la cámara en vivo. */
const VIDEO_FADE_MS = 280;

/** Lo que dura la salida del panel. Debe coincidir con vibraGreetingPanelOut. */
const PANEL_CLOSE_MS = 200;

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
  /**
   * Muestra del creador, no un encargo comprado. Cambia tres cosas: la subida
   * va a `greetingSamples` en vez de a la solicitud, no hay dinero que enseñar
   * y no hay nada que rechazar, porque no hay comprador al otro lado.
   */
  sampleMode?: boolean;
  /** Volver a empezar el flujo de muestra, desde el panel del contexto. */
  onRecordAnother?: () => void;
  /**
   * Capa del overlay. Por omisión 10050, que basta cuando se abre desde el
   * sidebar o notificaciones. Al abrirlo DESDE otro panel —el de configurar
   * experiencias usa 999999— hay que subirlo o queda detrás.
   */
  zIndex?: number;
};

function formatDateDisplay(date: Date, locale: string): string {
  return formatDateTimeLong(date, locale) ?? "";
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
  sampleMode = false,
  onRecordAnother,
  zIndex = 10050,
}: Props) {
  const tCommon = useTranslations("common");
  const cfError = useCfError();
  const tServices = useTranslations("services");
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  // La ganancia del creador se liquida en USD, así que ese es el número que
  // manda. La moneda del que mira solo sirve de referencia, y por eso usa
  // `formatPlain` (tasa pelada) y no `format`, que es el precio de comprador
  // con su margen de conversión.
  const { formatAnchor, formatPlain, currency: viewerCurrency } = usePriceFormat();
  const exchangeRates = useExchangeRates();

  /** De la moneda en que se cobró, a USD. Si no hay tasa se devuelve el monto
   *  tal cual antes que inventar una cifra. */
  const toUsd = useCallback((amount: number, from: string): number => {
    if (!from || from === ANCHOR_CURRENCY) return amount;
    const usd = convertToAnchor(amount, from as DisplayCurrency, exchangeRates.rates);
    return usd ?? amount;
  }, [exchangeRates]);
  const [mounted, setMounted] = useState(false);
  /** Neto del creador, SIEMPRE en USD. Antes se guardaba ya formateado y en la
   *  moneda de la oferta, lo que además hacía que la suma final de varios
   *  encargos mezclara monedas y se mostrara como si todo fuese USD. */
  const [earningUsd, setEarningUsd] = useState<number | null>(null);
  const [sourceInfo, setSourceInfo] = useState<{ name: string; photoURL: string | null } | null>(null);
  const [viewState, setViewState] = useState<ViewState>(viewMode ? "camera" : "review");
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("preview");
  const [isMobile, setIsMobile] = useState(false);
  // Panel de datos plegado/desplegado. La cámara NO se toca al plegarlo: sigue
  // grabando. Queda una pestaña con la flecha para volver a abrirlo a media
  // grabación, por si el creador necesita releer la petición.
  const [infoOpen, setInfoOpen] = useState(true);
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

  // Story state — reset per item
  const [storyAdded, setStoryAdded] = useState(false);
  /** Lo que el creador acaba de pedir, mientras Firestore no lo confirma. */
  const [optimisticStoryOn, setOptimisticStoryOn] = useState<boolean | null>(null);
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

  // Rechazar cancela el cobro del comprador y no tiene vuelta atrás, así que
  // pasa por el panel de confirmación de la casa.
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // La cámara ya está dando imagen. Sirve para no enseñar el <video> mientras
  // el navegador abre el dispositivo, que es cuando se ve el rectángulo negro.
  const [cameraReady, setCameraReady] = useState(false);

  // Cierre animado del panel de laptop
  const [panelClosing, setPanelClosing] = useState(false);
  /** Cuánto ha bajado el dedo. Mismo gesto que el visor de historias. */
  const [dragY, setDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  // Prompter (solo en el panel de grabación de laptop)
  //
  // El guion es una nota del CREADOR para sí mismo: no es parte del encargo ni
  // lo ve el comprador, así que no toca Firestore. Vive en localStorage, con lo
  // que sobrevive a cerrar el panel y a recargar, pero no sale del dispositivo.
  //
  // Se indexa por TIPO, no por encargo. Un guion de saludo sirve para todos los
  // saludos, y lo que se ensaya grabando una muestra es exactamente lo que se
  // quiere tener delante en el primer encargo real. La contrapartida es que
  // editarlo en uno lo cambia en todos, que es lo que se pidió.
  const [prompterOpen, setPrompterOpen] = useState(false);
  // La hoja de datos de celular nace cerrada, al revés que el panel de laptop,
  // así que lleva su propio interruptor en vez de compartir `infoOpen`.
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [prompterScripts, setPrompterScripts] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(PROMPTER_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const out: Record<string, string> = {};
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string") out[id] = value;
      }
      return out;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(PROMPTER_STORAGE_KEY, JSON.stringify(prompterScripts));
    } catch {
      // Modo privado o cuota llena: el guion sigue en memoria, solo no persiste.
    }
  }, [prompterScripts]);

  // Review panel bottom sheet (mobile only)
  const [reviewSheetTransform, setReviewSheetTransform] = useState("translateY(100%)");
  const [reviewSheetDragging, setReviewSheetDragging] = useState(false);
  const reviewDragStartRef = useRef({ y: 0, time: 0 });
  const reviewLastDragRef = useRef({ y: 0, time: 0 });

  // Mobile camera split-panel
  const [mobilePanelHeight, setMobilePanelHeight] = useState(200);
  const [mobilePanelDragging, setMobilePanelDragging] = useState(false);

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

  // En una muestra no hay nada que revisar antes de grabar, así que la cámara
  // se abre sola. El guardia con ref evita que se vuelva a pedir el permiso si
  // React monta el efecto dos veces en desarrollo.
  const sampleCameraStartedRef = useRef(false);
  useEffect(() => {
    if (!sampleMode || !mounted || sampleCameraStartedRef.current) return;
    sampleCameraStartedRef.current = true;
    void handleGrabar();
    // handleGrabar se recrea en cada render y el guardia ya impide repetirlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleMode, mounted]);

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
    setEarningUsd(null);
    setSourceInfo(null);
    const req = items[currentIndex]?.data;
    if (!req) return;

    // Lo que se cobró EN ESTA venta. Manda sobre el catálogo: el precio de lista
    // puede haber cambiado desde la compra, y lo que el creador va a ganar es lo
    // que se cobró entonces, no lo que cuesta hoy. Además el catálogo del PERFIL
    // guarda el precio en `publicPrice`, así que buscarlo solo por `memberPrice`
    // dejaba la ganancia en blanco en todos los encargos de perfil.
    const snapshot =
      typeof req.priceSnapshot === "number" && req.priceSnapshot > 0
        ? req.priceSnapshot
        : null;
    if (snapshot != null) {
      const snapNet = snapshot * WALLET_NET_RATE;
      const snapCur = (typeof req.currency === "string" && req.currency) || "MXN";
      setEarningUsd(toUsd(snapNet, snapCur));
    }

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

      // Sin instantánea (encargos antiguos) se cae al catálogo vigente.
      if (snapshot != null) return;

      // Earnings
      const offerings = Array.isArray(data.offerings)
        ? (data.offerings as Array<Record<string, unknown>>)
        : [];
      const offering = offerings.find((o) => o.type === req.type);
      if (!offering) return;
      // Misma precedencia que pickOffering: en perfil manda publicPrice y en
      // comunidad memberPrice. Antes se leía siempre memberPrice.
      const priceCandidates = source === "profile"
        ? [offering.publicPrice, offering.memberPrice, offering.price]
        : [offering.memberPrice, offering.publicPrice, offering.price];
      const rawPrice = priceCandidates.find((v): v is number => typeof v === "number" && v > 0) ?? null;
      if (rawPrice == null || rawPrice <= 0) return;
      const net = rawPrice * WALLET_NET_RATE;
      const cur = typeof offering.currency === "string" ? offering.currency : "MXN";
      setEarningUsd(toUsd(net, cur));
    }).catch(() => {});
  }, [currentIndex, items, toUsd]);

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

  /**
   * Publica una muestra recién subida como historia del creador.
   *
   * Espera al playbackId escuchando el documento de la muestra, porque cuando
   * la subida termina Mux todavía está procesando y una historia sin playbackId
   * no se puede reproducir. Si a los dos minutos no llegó, se abandona en
   * silencio: la muestra ya existe y el creador puede publicarla luego desde el
   * rail, así que insistir aquí no aporta nada.
   */
  const publishSampleStory = (sampleId: string) => {
    const type = req.type === "consejo" ? "consejo" : "saludo";
    const ref = doc(db, "greetingSamples", sampleId);
    let done = false;

    const stop = onSnapshot(ref, (snap) => {
      if (done) return;
      const playbackId = snap.get("muxPlaybackId");
      if (typeof playbackId !== "string" || !playbackId) return;
      done = true;
      stop();
      void addStoryFromGreeting({
        creatorId: req.creatorId,
        greetingCreatorId: req.creatorId,
        instructions: req.instructions ?? "",
        type,
        muxPlaybackId: playbackId,
        thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`,
        videoDuration: typeof snap.get("videoDuration") === "number" ? snap.get("videoDuration") : null,
        // La historia se cuelga del id de la MUESTRA. La regla solo exige que
        // sea un texto no vacío, y así queda trazada a su origen.
        greetingRequestId: sampleId,
        source: req.groupId ? "group" : "profile",
        groupId: req.groupId ?? null,
      }).catch((err) => {
        console.error("[publishSampleStory]", err);
      });
    }, (err) => {
      console.error("[publishSampleStory] snapshot", err);
    });

    window.setTimeout(() => { if (!done) { done = true; stop(); } }, 120_000);
  };

  const handleSendGreeting = async () => {
    const blob = uploadBlobRef.current;
    if (!blob) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    try {
      // La muestra no toca la solicitud ni el cobro: tiene su propio circuito.
      const uploadTarget = sampleMode
        ? await createGreetingSampleUpload({
            type: req.type === "consejo" ? "consejo" : "saludo",
            source: req.groupId ? "group" : "profile",
            groupId: req.groupId ?? undefined,
            toName: req.toName || undefined,
            context: req.instructions || undefined,
          })
        : await createGreetingMuxUpload({ greetingRequestId: currentItem.id });
      const { uploadUrl } = uploadTarget;
      const sampleId =
        "sampleId" in uploadTarget && typeof uploadTarget.sampleId === "string"
          ? uploadTarget.sampleId
          : null;

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
      // Una muestra no se le vende a nadie, así que no suma al total liberado.
      if (!sampleMode) setCompletedEarningsNet((prev) => [...prev, earningUsd ?? 0]);
      setUploadSucceeded(true);

      // Solo en laptop, donde el aviso de enviado vive sobre el video. La
      // cámara se acaba de apagar arriba, así que se vuelve a abrir para que
      // el creador se vea en vivo mientras decide, y el fundido la trae de
      // vuelta en lugar de encenderla de golpe.
      if (!isMobile) {
        setCameraReady(false);
        void navigator.mediaDevices.getUserMedia({
          // 1080p@30 con tope — ver nota en handleGrabar.
          video: { facingMode: "user", width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 48000 }, channelCount: { ideal: 2 } },
        }).then((stream) => {
          streamRef.current = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
        }).catch(() => { /* sin cámara el aviso se ve igual, solo sin imagen */ });

        // El switch de historias nace encendido, así que lo que muestra tiene
        // que ser verdad: se publica ya, y apagarlo la retira.
        if ((req.type === "saludo" || req.type === "consejo") && req.allowCreatorStory !== false) {
          void handleAddToStory();
        }
      }

      // La muestra se publica sola en historias, por el mismo camino que un
      // encargo real: addStoryFromGreeting desde el cliente. Lo único que
      // cambia es que hay que ESPERAR al playbackId, porque Mux todavía está
      // procesando cuando la subida termina y una historia sin él no se puede
      // reproducir. El aviso de "ya está compartido" queda en pantalla mientras
      // tanto, así que hay tiempo de sobra.
      if (sampleMode && sampleId) {
        void publishSampleStory(sampleId);
      }
    } catch (e: unknown) {
      setUploadError((e instanceof Error ? cfError(e) : null) ?? tCommon("generalError"));
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

  const typeLabel = req.type === "consejo" ? tWallet("typeLabelAdvice") : tWallet("typeLabelGreeting");
  const titleText = viewMode
    ? `${tServices("viewRequest")} ${typeLabel}`
    : `${tServices("readMessage")} ${typeLabel}`;

  // El título del estudio ya no depende del tipo: va fuera de los paneles.

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
        // 1080p@30 con TOPE (max): pedir 4K@60 hacía que el encoder del celular se
        // saturara y dejara de producir frames de video a mitad de la grabación
        // (video congelado + audio corriendo). 1080p@30 lo codifica estable en
        // cualquier teléfono, sin importar la duración.
        video: {
          facingMode: "user",
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
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
    // timeslice de 1s: en iOS Safari, sin timeslice la pista de VIDEO se congela
    // a los ~13-15s (el audio sigue). Pedir datos cada segundo mantiene viva la
    // codificación de video toda la grabación. Los chunks se reensamblan en onstop.
    recorderRef.current = mr;

    // El tirón al empezar a grabar es el navegador levantando el codificador de
    // video, y eso no se puede evitar. Lo que sí se puede es no hacerlo competir
    // con el repintado: primero se cambia de fase, para que el pie se pliegue y
    // el botón rojo baje con la pantalla libre, y el codificador arranca en el
    // fotograma siguiente, con la animación ya en marcha.
    setRecordPhase("recording");
    requestAnimationFrame(() => {
      try { mr.start(1000); } catch { /* el usuario cerró antes de que arrancara */ }
    });
  };

  const handleStopRecording = () => { recorderRef.current?.stop(); };

  const handleRepeat = async () => {
    // La grabación NO se tira aquí. Antes se soltaba de entrada y la zona se
    // quedaba en negro hasta que el navegador devolvía la cámara; ahora se
    // mantiene a la vista y se suelta al final, ya fundida bajo la imagen
    // nueva, así que nunca hay un hueco negro entre las dos.
    setCameraReady(false);
    cancelDrawLoopRef.current?.(); cancelDrawLoopRef.current = null; rafRecRef.current = null;
    canvasRecRef.current = null;
    uploadBlobRef.current = null;
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
        // 1080p@30 con tope — ver nota en handleGrabar (4K@60 satura el encoder móvil).
        video: { facingMode: "user", width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 48000 }, channelCount: { ideal: 2 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setRecordPhase("preview");
      // Con "preview" la grabación empieza a fundirse y la cámara a aparecer.
      // El desmontaje espera a que termine ese cruce.
      window.setTimeout(() => {
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        setRecordedBlobUrl(null);
      }, VIDEO_FADE_MS);
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

  const handleReject = async () => {
    if (rejecting) return;
    setRejecting(true);
    try {
      await respondGreetingRequest({ requestId: currentItem.id, action: "reject" });
      // Rechazado ya no hay nada que grabar aquí: o queda otro encargo o se
      // acabó la lista y el panel se cierra.
      if (currentIndex >= items.length - 1) handleAnimatedClose();
      else handleNextGreeting();
    } catch (e: unknown) {
      setUploadError((e instanceof Error ? cfError(e) : null) ?? tServices("errorRejectRequest"));
    } finally {
      setRejecting(false);
      setConfirmRejectOpen(false);
    }
  };

  const handleNextGreeting = () => {
    setConfirmRejectOpen(false);
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
      // 1080p@30 con tope — ver nota en handleGrabar (4K@60 satura el encoder móvil).
      video: { facingMode: "user", width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } },
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

  /** Cierra el panel de laptop dejando correr antes la animación de salida.
   *  Sirve tanto al tache como al clic fuera. Si ya se está cerrando no vuelve
   *  a entrar, para no encadenar temporizadores con dobles clics. */
  const handleDragStart = (e: React.TouchEvent) => {
    dragStartYRef.current = e.touches[0]?.clientY ?? null;
  };
  const handleDragMove = (e: React.TouchEvent) => {
    const start = dragStartYRef.current;
    if (start === null) return;
    const dy = (e.touches[0]?.clientY ?? start) - start;
    // Solo hacia abajo: hacia arriba el gesto es de la hoja de datos.
    if (dy > 0) setDragY(dy);
  };
  const handleDragEnd = () => {
    const dy = dragY;
    dragStartYRef.current = null;
    if (dy > 110) { handleClose(); return; }
    setDragY(0);
  };

  const handleAnimatedClose = () => {
    if (closeTimerRef.current !== null) return;
    setPanelClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      handleClose();
    }, PANEL_CLOSE_MS);
  };

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
    // El MISMO archivo, pero pidiéndole a Mux que lo sirva como adjunto. Sin el
    // parámetro `download` la respuesta va con Content-Disposition: inline y el
    // navegador se limita a reproducirlo, que es de donde salía la pestaña nueva
    // con el video en vez de una descarga.
    const mp4DownloadUrl = `${mp4Url}?download=${encodeURIComponent(
      `${req.type === "consejo" ? "consejo" : "saludo"}-vibra`
    )}`;

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
      // Último recurso si el render falla (blip de red, egress caído): el video
      // plano de Mux, SIN intro ni salida. Se DESCARGA, no se abre en otra
      // pestaña: abrirla dejaba al comprador con un reproductor a pelo y sin
      // archivo, que es peor que un video sin adornos.
      console.error("[handleDownload] animated render failed:", err);
      setUploadError(tCommon("errorUpdateRequest"));
      window.location.href = mp4DownloadUrl;
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

  useBodyScrollLock(true);

  if (!mounted) return null;

  const slideStyle: React.CSSProperties = {
    transform: slideState === "exit" ? "translateX(-20px)" : slideState === "enter" ? "translateX(20px)" : "translateX(0)",
    opacity: slideState === "idle" ? 1 : 0,
    transition: slideState === "exit" ? "transform 200ms ease, opacity 200ms ease" : slideState === "idle" ? "transform 260ms ease, opacity 260ms ease" : "none",
  };

  /** El mismo cambio de encargo, pero en vertical. En celular la hoja crece de
   *  abajo hacia arriba, así que un deslizamiento lateral iba a contrapelo del
   *  movimiento del panel: el encargo nuevo entra desde abajo y sube. */
  const slideStyleVertical: React.CSSProperties = {
    transform: slideState === "exit" ? "translateY(-20px)" : slideState === "enter" ? "translateY(20px)" : "translateY(0)",
    opacity: slideState === "idle" ? 1 : 0,
    transition: slideState === "exit" ? "transform 200ms ease, opacity 200ms ease" : slideState === "idle" ? "transform 260ms ease, opacity 260ms ease" : "none",
  };

  // ─── Shared sub-sections ────────────────────────────────────────────────────
  // Success state helpers — used inside camera panels when uploadSucceeded
  const successIsLast = currentIndex >= items.length - 1;
  const successTotalEarned = completedEarningsNet.reduce((a, b) => a + b, 0);
  const successLabel = sampleMode
    ? tServices("samplePublished")
    : req.type === "consejo" ? tServices("successAdvice") : tServices("successGreeting");

  // Success content — shown inline in the panel below the info section

  const typeWord = req.type === "consejo" ? "consejo" : "saludo";
  // Profile source: name is always "Tu perfil", photo comes from buyers[creatorId] (already loaded)
  // Group source: name and photo come from sourceInfo (loaded async from Firestore)
  const sourceName = req.source === "profile" ? tCommon("yourProfile") : (sourceInfo?.name ?? null);
  const sourcePhotoURL = req.source === "profile"
    ? (buyers[req.creatorId]?.photoURL ?? null)
    : (sourceInfo?.photoURL ?? null);

  function renderSourceChip(topValue: number | string) {
    // Solo tiene sentido cuando el saludo viene de una COMUNIDAD (para saber a
    // cuál va dirigido). Si viene del perfil (creador sin comunidades, o pedido
    // directo), decir "solicitado desde tu perfil" es redundante → no se muestra.
    if (!sourceName || req.source === "profile") return null;
    // Suma el safe-area superior: los hijos absolutos ignoran el padding del
    // contenedor, así que sin esto el chip se mete bajo el notch en celular.
    const safeTop = typeof topValue === "number"
      ? `calc(${topValue}px + env(safe-area-inset-top, 0px))`
      : topValue;
    return (
      <div style={{
        position: "absolute", top: safeTop, left: "50%", transform: "translateX(-50%)",
        maxWidth: "calc(100% - 24px)", boxSizing: "border-box",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        borderRadius: 20, padding: "5px 10px 5px 13px",
        display: "flex", alignItems: "center", gap: 7,
        pointerEvents: "none", zIndex: 2,
      }}>
        <span style={{
          color: "rgba(255,255,255,0.78)", fontSize: 11, fontWeight: 500,
          fontFamily: fontStack, whiteSpace: "nowrap", lineHeight: 1.2,
          overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
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
      {/* Sin la ganancia al lado, el nombre dispone de toda la fila y ya no hace
          falta cortarlo con puntos suspensivos: se muestra completo, partiendo
          en varias líneas si hace falta. */}
      <div style={{ minWidth: 0, flex: 1 }}>
        {buyer?.handle ? (
          <Link href={`/u/${buyer.handle}`} onClick={handleClose} style={{
            color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.25,
            textDecoration: "none", display: "block", overflowWrap: "anywhere",
          }}>
            {buyer.displayName}
          </Link>
        ) : (
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.25, overflowWrap: "anywhere" }}>
            {buyer?.displayName ?? tCommon("user")}
          </span>
        )}
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3, marginTop: 4 }}>
          {getGreetingStatusLabel(req.status, tServices)}
        </span>
      </div>
    </div>
  );

  /** El comprador con el aspecto de la CABECERA DEL VISOR DE HISTORIAS: aro de
   *  Vibra de 40, el nombre al lado y debajo el tipo de encargo. Las medidas, el
   *  degradado y la tipografía salen tal cual de ReelStorySlide, en su escala
   *  GRANDE (la de `compact: false`, aro de 54): la compacta se quedaba corta en
   *  un panel de este ancho. Vive solo en el panel de grabación de laptop; los
   *  otros tres sitios siguen con el renglón de antes. */
  const buyerCardName = buyerViewMode
    ? (buyerSourceName ?? tCommon("creator"))
    : (buyer?.displayName ?? tCommon("user"));
  const buyerCardAvatar = buyerViewMode ? buyerSourceAvatar : (buyer?.photoURL ?? null);
  const buyerCardTypeLabel =
    req.type === "consejo" ? tWallet("typeLabelAdvice")
      : req.type === "saludo" ? tWallet("typeLabelGreeting")
      : null;

  const buyerCardNameStyle: React.CSSProperties = {
    color: "#fff",
    fontSize: 17,
    fontWeight: 600,
    lineHeight: "1.2",
    textDecoration: "none",
    // El visor no parte el nombre porque lo pinta sobre el ancho de la pantalla.
    // Aquí la columna es estrecha, así que se deja partir antes que recortarlo.
    overflowWrap: "anywhere",
  };

  const buyerStoryCard = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      {/* Aro de Vibra. No es un relleno: es un disco de degradado enmascarado a
          un anillo de 3px, y la foto va aparte con inset 6. Así, entre el aro y
          la foto quedan 3px de aire en lugar de un borde de color. */}
      <div style={{ position: "relative", width: 54, height: 54, flexShrink: 0 }}>
        <div style={{
          position: "absolute", inset: 6, borderRadius: "50%",
          overflow: "hidden", background: "rgba(255,255,255,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {buyerCardAvatar ? (
            <Image src={buyerCardAvatar} alt="" fill sizes="54px" style={{ objectFit: "cover" }} />
          ) : (
            <span style={{ fontSize: 18, lineHeight: 1, fontWeight: 700, color: "#fff" }}>
              {buyerCardName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div
          aria-hidden="true"
          style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: VIBRA_GRADIENT,
            WebkitMaskImage: "radial-gradient(farthest-side, transparent calc(100% - 3px), white calc(100% - 3px))",
            maskImage: "radial-gradient(farthest-side, transparent calc(100% - 3px), white calc(100% - 3px))",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        {!buyerViewMode && buyer?.handle ? (
          <Link href={`/u/${buyer.handle}`} onClick={handleClose} style={buyerCardNameStyle}>
            {buyerCardName}
          </Link>
        ) : (
          <span style={buyerCardNameStyle}>{buyerCardName}</span>
        )}
        {buyerCardTypeLabel && (
          <span style={{
            color: "rgba(255,255,255,0.75)",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: "1.2",
          }}>
            {buyerCardTypeLabel}
          </span>
        )}
      </div>
    </div>
  );

  const divider = <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />;

  /** El texto de la ganancia en las DOS monedas. La de arriba es USD, que es en
   *  lo que se liquida y por tanto lo que el creador va a cobrar de verdad. La
   *  de abajo es una referencia en la moneda del que mira, y solo aparece si es
   *  distinta, porque en una cuenta en dólares repetir la cifra no aporta nada.
   *
   *  La referencia usa `formatPlain`, la tasa pelada, y NO `format`, que añade
   *  el margen de conversión del comprador. Ese margen no lo paga el creador, y
   *  meterlo aquí daría un número que no coincide con lo que verá en su wallet. */
  const formatEarning = (usdAmount: number) => {
    const usd = formatAnchor(usdAmount, { code: true });
    const local = viewerCurrency === ANCHOR_CURRENCY
      ? null
      : formatPlain(usdAmount, { baseCurrency: ANCHOR_CURRENCY, code: true });
    return { usd, local };
  };

  /** El cuerpo baja por tramos según lo que ocupe la cifra ya formateada. Hay
   *  monedas que dan números larguísimos y el CSS no sabe cuánto mide un texto,
   *  así que es la única forma de garantizar que no parta en dos renglones. */
  const earningSizeFor = (text: string) =>
    text.length > 19 ? 15 : text.length > 15 ? 18 : text.length > 12 ? 20 : 22;

  /** Las dos líneas de dinero en verde, para reusarlas en la ganancia del
   *  encargo y en el total liberado al terminar la lista. */
  const renderMoney = (usdAmount: number, opts: { label?: string; big?: number } = {}) => {
    const { usd, local } = formatEarning(usdAmount);
    const size = opts.big ?? earningSizeFor(usd);
    return (
      <div style={{ display: "grid", gap: 4, justifyItems: "start", minWidth: 0 }}>
        {opts.label && (
          <span style={{ color: "#86efac", fontWeight: 500, fontSize: 11, letterSpacing: "0.01em", lineHeight: 1 }}>
            {opts.label}
          </span>
        )}
        <span style={{
          color: "#86efac", fontWeight: 700, fontSize: size,
          letterSpacing: "-0.03em", lineHeight: 1.1,
          whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
        }}>
          {usd}
        </span>
        {local && (
          // Deliberadamente más pequeña que la de arriba: es una referencia, no
          // la cantidad que se cobra.
          <span style={{
            color: "rgba(134,239,172,0.72)", fontWeight: 500,
            fontSize: Math.max(11, Math.round(size * 0.55)),
            lineHeight: 1.2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
          }}>
            {tWallet("approxAmount", { amount: local })}
          </span>
        )}
      </div>
    );
  };

  const earningRow = (earningUsd != null && !sampleMode && !buyerViewMode)
    ? renderMoney(earningUsd, { label: tWallet("yourEarning") })
    : null;

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
            <IconButton label={speechState === "playing" ? tServices("pauseReading") : speechState === "paused" ? tServices("resumeReading") : tServices("readContext")} size="sm" tone="bare" shape="square" onClick={handleToggleSpeech}>
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
            </IconButton>
          </div>
          <p
            ref={speechTextRef}
            onClick={handleTextSeek}
            style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.82)", margin: 0, cursor: "text", userSelect: "none", maxHeight: 160, overflowY: "auto", paddingInlineEnd: 4 }}
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
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDateDisplay(req.createdAt.toDate(), locale)}</span>
        </div>
      )}
      {viewMode && req.deliveredAt && (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{tServices("sentOn")}</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDateDisplay(req.deliveredAt.toDate(), locale)}</span>
        </div>
      )}
    </>
  );


  // Ficha del archivo elegido. Esta sí se queda en el panel en las dos ramas.
  const recordFileChip = recordPhase === "done" ? (
    <>
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
    </>
  ) : null;


  /** Etiqueta del botón de envío, con el progreso encima mientras sube. */
  const sendLabel = isUploading
    ? (uploadProgress < 100 ? tServices("uploadingProgress", { progress: uploadProgress }) : tServices("processing"))
    // Una muestra no se le envía a nadie, se publica. Llamarlo "enviar saludo"
    // sugeriría que hay un comprador esperándolo al otro lado.
    : sampleMode ? tServices("uploadSample")
    : req.type === "consejo" ? tServices("sendAdvice") : tServices("sendGreeting");

  const repeatLabel = wasUploadedRef.current ? tCommon("changeFile") : tServices("recordAgain");

  /** "Compartir saludo" o "Compartir consejo", según el encargo. */
  const shareLabel = req.type === "consejo" ? tServices("shareAdvice") : tServices("shareGreeting");

  /** Base de los botones que van sobre el video en laptop. Misma geometría que
   *  el de subir video pregrabado; solo cambia el fondo. */
  const videoActionsDisabled = busy || isUploading;
  const videoActionButton: React.CSSProperties = {
    // Misma medida que el primitivo Button en talla media, que es la de los
    // botones de cancelar y continuar del panel de contexto.
    padding: "10px 16px", borderRadius: 12, border: "none",
    // Centrado explícito: al estirarse en la rejilla, el texto de un <button>
    // no se recentra solo con el alto que le sobra.
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em",
    fontFamily: fontStack, whiteSpace: "nowrap",
    cursor: videoActionsDisabled ? "not-allowed" : "pointer",
    filter: videoActionsDisabled ? "brightness(0.72) saturate(0.8)" : "none",
    transition: "filter 200ms ease",
    WebkitTapHighlightColor: "transparent",
  };

  /** El aviso de enviado, centrado sobre el video. Lo comparten las dos ramas:
   *  es el mismo bloque en laptop y en celular, así que vive fuera de ellas. */
  const successOverlay = (() => {
                    const hidden = !uploadSucceeded;
                    const canStory =
                      (req.type === "saludo" || req.type === "consejo") &&
                      req.allowCreatorStory !== false;
                    const storyOn = storyAdded || existingStory !== null;
                    return (
                    <div style={{
                      position: "absolute", inset: 0, zIndex: 6,
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 16,
                      opacity: hidden ? 0 : 1,
                      visibility: hidden ? "hidden" : "visible",
                      pointerEvents: hidden ? "none" : "auto",
                      transform: hidden ? "scale(0.96)" : "scale(1)",
                      transition: [
                        "opacity 220ms ease",
                        "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
                        "visibility 300ms",
                      ].join(", "),
                    }}>
                      <div style={{
                        width: 56, height: 56, borderRadius: "50%",
                        background: "#22c55e", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 8px 32px rgba(34,197,94,0.35)",
                        animation: hidden ? "none" : "vibraSuccessPop 0.45s cubic-bezier(0.4,0,0.2,1) both",
                      }}>
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M5 12L10 17L19 8"
                            stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                            strokeDasharray="32" strokeDashoffset="0"
                            style={{ animation: hidden ? "none" : "vibraCheckDraw 0.5s 0.25s ease both" }}
                          />
                        </svg>
                      </div>

                      <span style={{
                        color: "#fff", fontWeight: 700, fontSize: 18,
                        letterSpacing: "-0.02em", lineHeight: 1.2, textAlign: "center",
                        textShadow: "0 2px 12px rgba(0,0,0,0.6)",
                      }}>
                        {sampleMode
                          ? (req.type === "consejo" ? tServices("sampleSharedAdvice") : tServices("sampleSharedGreeting"))
                          : successIsLast ? tServices("sentAllToday") : successLabel}
                      </span>

                      {/* En una muestra no hay dinero ni siguiente encargo: solo
                          decidir si se graba otra o se termina. */}
                      {sampleMode ? (
                        <div style={{
                          // Rejilla de columnas 1fr para que los dos midan lo
                          // mismo, lo marque el texto que lo marque.
                          display: "grid", gridAutoFlow: "column", gridAutoColumns: "1fr",
                          alignItems: "stretch", gap: 10,
                        }}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleAnimatedClose(); }}
                            style={{ ...videoActionButton, background: "rgba(75,85,99,0.62)", filter: "none" }}
                          >
                            {tServices("finishSamples")}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onRecordAnother?.(); }}
                            style={{ ...videoActionButton, background: "#3b82f6", filter: "none" }}
                          >
                            {tServices("recordAnotherSample")}
                          </button>
                        </div>
                      ) : successIsLast ? (
                        successTotalEarned > 0 && (() => {
                          const { usd, local } = formatEarning(successTotalEarned);
                          return (
                            <div style={{ display: "grid", gap: 4, justifyItems: "center" }}>
                              <span style={{
                                color: "#4ade80", fontWeight: 700, fontSize: 22,
                                letterSpacing: "-0.02em", lineHeight: 1.2, textAlign: "center",
                                textShadow: "0 2px 12px rgba(0,0,0,0.6)",
                                whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                              }}>
                                {tServices("releasedAmount", { amount: usd })}
                              </span>
                              {local && (
                                <span style={{
                                  color: "rgba(74,222,128,0.72)", fontWeight: 500, fontSize: 13,
                                  lineHeight: 1.2, textAlign: "center",
                                  textShadow: "0 2px 10px rgba(0,0,0,0.6)",
                                  whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                                }}>
                                  {tWallet("approxAmount", { amount: local })}
                                </span>
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        <>
                          {/* El switch solo existe si el comprador autorizó que
                              el creador publique el encargo. Sin permiso no hay
                              nada que ofrecer, así que ni se enseña apagado.
                              Sin caja: el aire lo pone el propio texto. */}
                          {canStory && (
                            <div style={{
                              display: "flex", alignItems: "center", gap: 10,
                              margin: "-4px 0",
                            }}>
                              <span style={{
                                color: "rgba(255,255,255,0.88)", fontSize: 14, fontWeight: 600,
                                letterSpacing: "-0.01em",
                                textShadow: "0 2px 10px rgba(0,0,0,0.7)",
                              }}>
                                {shareLabel}
                              </span>
                              <Switch
                                checked={storyOn}
                                disabled={addingStory || removingStory}
                                label={shareLabel}
                                onChange={(next) => {
                                  if (next) void handleAddToStory();
                                  else void handleRemoveFromStory();
                                }}
                              />
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleNextGreeting(); }}
                            style={{ ...videoActionButton, background: "#3b82f6" }}
                          >
                            {tServices("reviewNext")}
                          </button>
                        </>
                      )}
                    </div>
                    );
  })();

  /** Rechazar cancela el cobro retenido al comprador, así que pasa por el panel
   *  de confirmación de la casa en lugar de dispararse con un solo toque. */
  // La verdad la manda la suscripción; la intención solo manda mientras no
  // coincidan. En cuanto coinciden, el valor optimista deja de contar solo, sin
  // necesidad de limpiarlo desde un efecto.
  const storyReallyOn = existingStory !== null;
  const storyOnForBuyer =
    optimisticStoryOn === null || optimisticStoryOn === storyReallyOn
      ? storyReallyOn
      : optimisticStoryOn;
  const storyToggleBusy =
    addingStory ||
    removingStory ||
    (optimisticStoryOn !== null && optimisticStoryOn !== storyReallyOn);

  const handleBuyerStoryToggle = (next: boolean) => {
    if (storyToggleBusy) return;
    setOptimisticStoryOn(next);
    if (next) void handleAddToStoryAsBuyer();
    else void handleRemoveFromStory();
  };

  const rejectConfirmPanel = (
    <ConfirmPanel
      open={confirmRejectOpen}
      onClose={() => setConfirmRejectOpen(false)}
      onConfirm={() => { void handleReject(); }}
      title={tServices("confirmRejectTitle")}
      body={tServices("confirmRejectBody")}
      highlight={buyer?.displayName ?? undefined}
      confirmLabel={tServices("confirmReject")}
      cancelLabel={tCommon("cancel")}
      tone="danger"
      busy={rejecting}
      zIndexBase={zIndex + 10}
    />
  );

  // Los botones apilados a lo ancho del panel lateral. Es lo que sigue usando
  // celular; en laptop se pintan aparte, sobre el video y en fila.


  // Button overlaid on the camera zone
  //
  // La altura es un parámetro porque en laptop el botón comparte el pie con el
  // de subir video pregrabado y tiene que subir para hacerle sitio. En celular
  // sigue fijo en 28, igual que siempre.
  const recordButtonHidden = recordPhase === "done";
  const renderCameraRecordButton = (bottomValue: number) => (
    <button
      type="button"
      onClick={recordPhase === "preview" ? handleStartRecording : handleStopRecording}
      tabIndex={recordButtonHidden ? -1 : 0}
      style={{
        position: "absolute", bottom: bottomValue, left: "50%",
        transform: recordButtonHidden
          ? "translateX(-50%) scale(0.86)"
          : "translateX(-50%) scale(1)",
        opacity: recordButtonHidden ? 0 : 1,
        visibility: recordButtonHidden ? "hidden" : "visible",
        pointerEvents: recordButtonHidden ? "none" : "auto",
        transition: [
          "bottom 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          "transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          "opacity 200ms ease",
          "visibility 260ms",
        ].join(", "),
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
  );

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
  /** `bleed` saca la franja de tiempo hacia los lados. En laptop el chrome vive
   *  dentro de un contenedor estrechado 56px por lado para no comerse las
   *  pestañas, y sin esto el degradado del pie se cortaba a media pantalla. */
  const renderVpControls = (bleed = 0) => (
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
        {/* Top-insetInlineEnd: fullscreen + mute */}
        <div style={{
          position: "absolute", top: 0, insetInlineEnd: 0,
          padding: "10px 12px",
          display: "flex", alignItems: "center", gap: 10,
          pointerEvents: "auto",
        }}>
          <IconButton label={tCommon("fullscreen")} size="sm" tone="bare" shape="square" style={{ boxShadow: "none" }} onClick={async (e) => { e.stopPropagation(); const v = playbackVideoRef.current; if (!v) return; try { if (typeof v.requestFullscreen === "function") await v.requestFullscreen(); else if (typeof (v as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen === "function") (v as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen(); } catch { /* ignored */ } }}>
            <VideoExpandIcon size={22} />
          </IconButton>
          <IconButton label={vpMuted ? tCommon("unmute") : tCommon("muteLabel")} size="sm" tone="bare" shape="square" style={{ boxShadow: "none" }} onClick={(e) => { e.stopPropagation(); setVpMuted((m) => !m); showVPChrome(); scheduleVPChromeHide(); }}>
            {vpMuted ? <VideoMuteIcon size={22} /> : <VideoUnmuteIcon size={22} />}
          </IconButton>
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
          position: "absolute", bottom: 0,
          insetInlineStart: -bleed, insetInlineEnd: -bleed,
          // Más discreto que antes: la sombra está para que se lean los números,
          // no para competir con el video.
          background: "linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 100%)",
          padding: `0 ${12 + bleed}px 10px`,
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
            <div style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.28)" }}>
              <div style={{ height: "100%", width: "var(--pct, 0%)", background: "#fff", borderRadius: 2 }} />
            </div>
            <div style={{
              position: "absolute", insetInlineStart: "var(--pct, 0%)", transform: "translate(-50%, 0)",
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

  // ─── MOBILE CAMERA VIEW — GRABACIÓN ──────────────────────────────────────────
  //
  // La cámara ocupa la pantalla entera. La hoja de datos, que antes se comía el
  // tercio inferior siempre, ahora vive plegada bajo el borde y sube a media
  // altura con la flecha, igual que las pestañas de laptop pero en vertical. El
  // prompter hace lo mismo desde arriba.
  if (viewState === "camera" && isMobile && !viewMode && !buyerViewMode) {
    const SHEET_H = "min(62dvh, 520px)";
    const PROMPTER_H = "min(52dvh, 430px)";
    const BTN_W = "min(78vw, 320px)";
    // La pareja de subir y rechazar necesita algo más de sitio que un botón
    // suelto, porque se reparte el ancho entre dos.
    const PAIR_W = "min(90vw, 380px)";
    const TOP_TAB_H = 110;
    // Los botones no se van nunca: la hoja crece por encima de ellos. Solo
    // desaparecen cuando el encargo ya se envió y manda el aviso de enviado.
    const stackHidden = uploadSucceeded;
    // La línea de tiempo solo existe repasando lo grabado, y ocupa el pie.
    const chromeRaised = recordPhase === "done" && !uploadSucceeded && vpChromeVisible;

    return createPortal(
      <>
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
        .grv-prompter::placeholder { color: rgba(255,255,255,0.28); }
        .grv-prompter { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent; }
        .grv-prompter::-webkit-scrollbar { width: 4px; }
        .grv-prompter::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 2px; }
      `}</style>

      <div style={{
        position: "fixed", inset: 0, zIndex,
        background: "#000", overflow: "hidden", fontFamily: fontStack,
      }}>
        {/* ── Cámara a pantalla completa ─────────────────────────────────── */}
        <video
          ref={videoRef}
          autoPlay muted playsInline
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          onPlaying={() => setCameraReady(true)}
          onLoadedData={() => setCameraReady(true)}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", background: "#000",
            opacity: ((recordPhase !== "done" || uploadSucceeded) && cameraReady) ? 1 : 0,
            transition: `opacity ${VIDEO_FADE_MS}ms ease`,
          }}
        />
        {recordedBlobUrl && (
          <div style={{
            position: "absolute", inset: 0,
            opacity: (recordPhase === "done" && !uploadSucceeded) ? 1 : 0,
            pointerEvents: (recordPhase === "done" && !uploadSucceeded) ? "auto" : "none",
            transition: `opacity ${VIDEO_FADE_MS}ms ease`,
          }}>
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
              style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000", display: "block" }}
            />
            {renderVpControls()}
          </div>
        )}

        {/* Cronómetro, origen y frase de ánimo */}
        {recordPhase === "recording" && (
          <div style={{
            position: "absolute", top: "max(16px, env(safe-area-inset-top))",
            left: "50%", transform: "translateX(-50%)", zIndex: 5,
            background: "rgba(0,0,0,0.55)", borderRadius: 20, padding: "4px 14px",
            display: "flex", alignItems: "center", gap: 7,
            color: "#fff", fontWeight: 600, fontSize: 14,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "block" }} />
            {formatTime(recordingSeconds)}
          </div>
        )}
        {recordPhase !== "done" && renderSourceChip(recordPhase === "recording" ? 54 : 16)}

        {/* ── Velo superior y prompter ─────────────────────────────────── */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: 0,
            zIndex: 2, pointerEvents: "none",
            height: prompterOpen ? PROMPTER_H : TOP_TAB_H,
            transition: "height 320ms cubic-bezier(0.4, 0, 0.2, 1)",
            background: prompterOpen
              ? "linear-gradient(to bottom, rgba(0,0,0,0.94), rgba(0,0,0,0))"
              : "linear-gradient(to bottom, rgba(0,0,0,0.62), rgba(0,0,0,0))",
          }}
        />

        <div style={{
          position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: 0,
          zIndex: 3, height: PROMPTER_H,
          transform: prompterOpen ? "translateY(0)" : "translateY(-100%)",
          opacity: prompterOpen ? 1 : 0,
          visibility: prompterOpen ? "visible" : "hidden",
          pointerEvents: prompterOpen ? "auto" : "none",
          transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease, visibility 320ms",
          display: "flex", flexDirection: "column", gap: 10,
          paddingInline: 16,
          paddingBottom: 16,
          // Por debajo de la fila del tache y de la flecha, que ocupa el alto
          // del IconButton (40) más el margen de seguridad de arriba.
          paddingTop: "calc(max(14px, env(safe-area-inset-top)) + 54px)",
          boxSizing: "border-box",
        }}>
          {/* El hueco de la derecha es para la flecha, que va en otra capa. */}
          <span style={{ paddingInlineEnd: 44, color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
            {tServices("prompterTitle")}
          </span>
          <textarea
            className="grv-prompter"
            value={prompterScripts[req.type] ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              setPrompterScripts((prev) => ({ ...prev, [req.type]: value }));
            }}
            placeholder={tServices("prompterPlaceholder")}
            spellCheck={false}
            style={{
              flex: 1, minHeight: 0, width: "100%",
              resize: "none", border: "none", outline: "none",
              background: "transparent", padding: 0,
              color: "#fff", fontSize: 18, fontWeight: 500, lineHeight: 1.6,
              fontFamily: fontStack, boxSizing: "border-box",
            }}
          />
        </div>

        {/* Flecha del prompter, fija arriba a la derecha en los dos estados. */}
        <div style={{
          position: "absolute", zIndex: 7,
          top: "max(14px, env(safe-area-inset-top))", insetInlineEnd: 8,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          {!prompterOpen && (
            <span aria-hidden="true" style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
              {tServices("prompterTitle")}
            </span>
          )}
          <IconButton
            label={tServices("prompterTitle")}
            size="md" tone="bare" shape="square"
            style={{ boxShadow: "none" }}
            aria-expanded={prompterOpen}
            onClick={() => setPrompterOpen((prev) => !prev)}
          >
            <svg
              width="24" height="24" viewBox="0 0 24 24" fill="none"
              style={{
                transform: `rotate(${prompterOpen ? 180 : 0}deg)`,
                transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <path d="M6 9L12 16L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
        </div>

        {/* Cerrar, arriba a la izquierda. */}
        <div style={{
          position: "absolute", zIndex: 8,
          top: "max(14px, env(safe-area-inset-top))", insetInlineStart: 8,
        }}>
          <IconButton
            label={tCommon("closeAriaLabel")}
            size="md" tone="bare" shape="square"
            style={{ boxShadow: "none" }}
            onClick={handleClose}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </IconButton>
        </div>

        {/* ── Pie: hoja de datos y botonera, en la MISMA columna ───────────
               Así la hoja crece hacia arriba empujando solo lo suyo y los
               botones se quedan donde están. El difuminado es el fondo de esta
               columna, de modo que se estira con ella sin tener que adivinar
               cuánto mide la hoja. */}
        <div style={{
          position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, bottom: 0,
          zIndex: 6,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          paddingInline: 16, paddingTop: 72,
          // Cuando sale la línea de tiempo de la previsualización, el pie se
          // levanta para dejarla libre, igual que en laptop.
          paddingBottom: chromeRaised
            ? "calc(18px + var(--vb-safe-bottom, 0px) + 52px)"
            : "calc(18px + var(--vb-safe-bottom, 0px))",
          boxSizing: "border-box",
          background: "linear-gradient(to top, rgba(0,0,0,0.92) 42%, rgba(0,0,0,0))",
          opacity: stackHidden ? 0 : 1,
          visibility: stackHidden ? "hidden" : "visible",
          pointerEvents: stackHidden ? "none" : "auto",
          transition: [
            "opacity 220ms ease",
            "visibility 320ms",
            "padding-bottom 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          ].join(", "),
        }}>
          {!sampleMode && (
          <>
          {/* La hoja de datos. La rejilla de 0fr a 1fr es lo que permite animar
              hasta el alto REAL del contenido: con una altura fija se abría
              siempre el mismo hueco aunque dentro hubiera dos líneas. El tope
              lo pone maxHeight, y a partir de ahí rueda. */}
          <div style={{
            width: "100%",
            display: "grid",
            gridTemplateRows: mobileInfoOpen ? "1fr" : "0fr",
            opacity: mobileInfoOpen ? 1 : 0,
            transition: "grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease",
          }}>
            <div style={{ minHeight: 0, overflow: "hidden" }}>
              <div style={{
                maxHeight: SHEET_H, overflowY: "auto",
                display: "flex", flexDirection: "column", gap: 14,
                paddingBottom: 4,
                ...slideStyleVertical,
              }}>
                {buyerStoryCard}
                {divider}
                {earningRow}
                {infoSection}
              </div>
            </div>
          </div>
          </>
          )}
          {recordPhase === "done" ? (
            <>
              <button
                type="button"
                onClick={handleRepeat}
                disabled={busy || isUploading}
                style={{ ...videoActionButton, background: "#3b82f6", width: BTN_W }}
              >
                {repeatLabel}
              </button>
              <button
                type="button"
                onClick={handleSendGreeting}
                disabled={busy || isUploading}
                style={{
                  ...videoActionButton,
                  background: "linear-gradient(135deg, #ec4899, #9333ea)",
                  width: BTN_W,
                  position: "relative", overflow: "hidden",
                }}
              >
                {isUploading && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute", inset: 0,
                      background: "rgba(255,255,255,0.28)",
                      transformOrigin: "left center",
                      transform: `scaleX(${Math.max(0, Math.min(100, uploadProgress)) / 100})`,
                      transition: "transform 300ms ease-out",
                    }}
                  />
                )}
                <span style={{ position: "relative" }}>{sendLabel}</span>
              </button>
            </>
          ) : (
            <>
              {/* La flecha que sube y baja la hoja, justo encima del rojo. */}
              {!sampleMode && (
              <button
                type="button"
                onClick={() => setMobileInfoOpen((prev) => !prev)}
                aria-expanded={mobileInfoOpen}
                aria-label={mobileInfoOpen ? tCommon("hide") : tCommon("show")}
                style={{
                  background: "transparent", border: "none", padding: "4px 16px",
                  color: "rgba(255,255,255,0.78)", cursor: "pointer", lineHeight: 0,
                }}
              >
                <svg
                  width="24" height="24" viewBox="0 0 24 24" fill="none"
                  style={{
                    transform: `rotate(${mobileInfoOpen ? 180 : 0}deg)`,
                    transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                >
                  <path d="M6 15L12 8L18 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              )}

              <button
                type="button"
                onClick={recordPhase === "preview" ? handleStartRecording : handleStopRecording}
                style={{
                  width: 68, height: 68, borderRadius: "50%",
                  border: "3px solid rgba(255,255,255,0.88)",
                  background: "transparent", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                {recordPhase === "recording" ? (
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: "#ef4444" }} />
                ) : (
                  <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#ef4444" }} />
                )}
              </button>

              {/* Subir y rechazar se PLIEGAN al grabar, no solo se desvanecen.
                  Con visibility seguían ocupando su hueco en la columna y el
                  botón rojo se quedaba clavado arriba; con la rejilla de 0fr a
                  1fr el hueco se cierra y el rojo baja solo. */}
              <div style={{
                width: "100%",
                display: "grid",
                gridTemplateRows: recordPhase === "recording" ? "0fr" : "1fr",
                opacity: recordPhase === "recording" ? 0 : 1,
                pointerEvents: recordPhase === "recording" ? "none" : "auto",
                transition: "grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease",
              }}>
                <div style={{ minHeight: 0, overflow: "hidden" }}>
                {/* Uno al lado del otro para que la torre no se coma la pantalla.
                    Aquí el texto SÍ puede partirse en dos renglones: a mitad de
                    ancho, "Subir video pregrabado" no cabe en una línea, y en
                    alemán o finés menos todavía. El estirado deja los
                    dos con el mismo alto aunque uno ocupe dos líneas. */}
                <div style={{
                  display: "flex", alignItems: "stretch", gap: 10,
                  width: PAIR_W, paddingTop: 12,
                }}>
                <button
                  type="button"
                  onClick={() => { setUploadError(null); fileInputRef.current?.click(); }}
                  style={{
                    ...videoActionButton, background: "#3b82f6",
                    flex: 1, minWidth: 0, whiteSpace: "normal",
                    textAlign: "center", lineHeight: 1.25, padding: "10px 12px",
                  }}
                >
                  {tServices("uploadPrerecordedVideo")}
                </button>
                {!sampleMode && (
                <button
                  type="button"
                  onClick={() => setConfirmRejectOpen(true)}
                  disabled={rejecting}
                  style={{
                    ...videoActionButton,
                    background: "rgba(75,85,99,0.62)",
                    flex: 1, minWidth: 0, whiteSpace: "normal",
                    textAlign: "center", lineHeight: 1.25, padding: "10px 12px",
                    filter: "none",
                    cursor: rejecting ? "not-allowed" : "pointer",
                  }}
                >
                  {tCommon("reject")}
                </button>
                )}
                </div>
                </div>
              </div>
            </>
          )}
        </div>

        {successOverlay}
        {fileInput}
      </div>
      {rejectConfirmPanel}
      </>,
      document.body
    );
  }

  // ─── MOBILE CAMERA VIEW — VISOR ──────────────────────────────────────────────
  //
  // Ver un saludo ya entregado, con el mismo lenguaje que el panel de grabación:
  // video a pantalla completa, ficha plegada al pie que sube con la flecha y
  // botonera fija sobre un difuminado que crece con ella.
  if (viewState === "camera" && isMobile && (viewMode || buyerViewMode)) {
    const SHEET_H = "min(62dvh, 520px)";
    const BTN_W = "min(88vw, 380px)";

    return createPortal(
      <div
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
        style={{
          position: "fixed", inset: 0, zIndex,
          background: `rgba(0,0,0,${1 - Math.min(1, dragY / 400)})`,
          overflow: "hidden", fontFamily: fontStack,
          transform: `translateY(${dragY}px)`,
          opacity: 1 - Math.min(1, dragY / 320),
          transition: dragY > 0 ? "none" : "transform 300ms ease, opacity 300ms ease",
        }}
      >
        {viewMp4Url ? (
          <div style={{ position: "absolute", inset: 0 }}>
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
            {renderVpControls()}
          </div>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            {tCommon("generalError")}
          </div>
        )}

        {/* Cerrar, arriba a la izquierda y respetando la muesca. */}
        <div style={{
          position: "absolute", zIndex: 8,
          top: "max(14px, env(safe-area-inset-top))", insetInlineStart: 8,
        }}>
          <IconButton
            label={tCommon("closeAriaLabel")}
            size="md" tone="bare" shape="square"
            style={{ boxShadow: "none" }}
            onClick={handleClose}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </IconButton>
        </div>

        {/* Pie: ficha plegable y acciones, en la misma columna. */}
        <div style={{
          position: "absolute", insetInlineStart: 0, insetInlineEnd: 0,
          // La franja del scrubber mide unos 47. El pie se apoya justo encima
          // y recorta su relleno inferior, que ahí ya no hace falta.
          bottom: vpChromeVisible ? 47 : 0,
          zIndex: 6,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          paddingInline: 16, paddingTop: 72,
          paddingBottom: vpChromeVisible ? 10 : "calc(18px + var(--vb-safe-bottom, 0px))",
          boxSizing: "border-box",
          background: "linear-gradient(to top, rgba(0,0,0,0.92) 42%, rgba(0,0,0,0))",
          transition: "bottom 300ms cubic-bezier(0.4, 0, 0.2, 1), padding-bottom 300ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}>
          <div style={{
            width: "100%",
            display: "grid",
            gridTemplateRows: mobileInfoOpen ? "1fr" : "0fr",
            opacity: mobileInfoOpen ? 1 : 0,
            transition: "grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease",
          }}>
            <div style={{ minHeight: 0, overflow: "hidden" }}>
              <div style={{
                maxHeight: SHEET_H, overflowY: "auto",
                display: "flex", flexDirection: "column", gap: 14,
                paddingBottom: 4,
                ...slideStyleVertical,
              }}>
                {buyerStoryCard}
                {divider}
                {earningRow}
                {infoSection}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileInfoOpen((prev) => !prev)}
            aria-expanded={mobileInfoOpen}
            aria-label={mobileInfoOpen ? tCommon("hide") : tCommon("show")}
            style={{
              background: "transparent", border: "none", padding: "4px 16px",
              color: "rgba(255,255,255,0.78)", cursor: "pointer", lineHeight: 0,
            }}
          >
            <svg
              width="24" height="24" viewBox="0 0 24 24" fill="none"
              style={{
                transform: `rotate(${mobileInfoOpen ? 180 : 0}deg)`,
                transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <path d="M6 15L12 8L18 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {buyerViewMode && (req.type === "saludo" || req.type === "consejo") && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "flex-end",
              gap: 12, width: BTN_W,
            }}>
              <span style={{ color: "rgba(255,255,255,0.88)", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
                {tServices("addToMyStory")}
              </span>
              <Switch
                checked={storyOnForBuyer}
                disabled={storyToggleBusy}
                label={tServices("addToMyStory")}
                onChange={handleBuyerStoryToggle}
              />
            </div>
          )}

          {buyerViewMode && viewMp4Url && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              style={{
                ...videoActionButton,
                width: BTN_W, background: "#3b82f6", gap: 8,
                position: "relative", overflow: "hidden",
                cursor: downloading ? "not-allowed" : "pointer",
              }}
            >
              {downloading && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute", inset: 0,
                    background: "rgba(255,255,255,0.28)",
                    transformOrigin: "left center",
                    transform: `scaleX(${Math.max(0, Math.min(100, downloadProgress)) / 100})`,
                    transition: "transform 300ms ease-out",
                  }}
                />
              )}
              <span style={{ position: "relative" }}>
                {downloading ? tServices("downloadingProgress", { progress: downloadProgress }) : tServices("downloadVideo")}
              </span>
            </button>
          )}

          {viewMode && !buyerViewMode && (req.type === "saludo" || req.type === "consejo") && (
            req.allowCreatorStory !== false ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12, width: BTN_W,
              }}>
                <span style={{ color: "rgba(255,255,255,0.88)", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {shareLabel}
                </span>
                <Switch
                  checked={existingStory !== null}
                  disabled={addingStory || removingStory}
                  label={shareLabel}
                  onChange={(next) => {
                    if (next) void handleAddToStory();
                    else void handleRemoveFromStory();
                  }}
                />
              </div>
            ) : (
              <div style={{
                width: BTN_W, borderRadius: 12, padding: "10px 14px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(0,0,0,0.5)",
                display: "flex", alignItems: "center", gap: 8, boxSizing: "border-box",
              }}>
                <span aria-hidden="true">🔒</span>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
                  {req.type === "consejo" ? tServices("buyerNoStoryPermissionAdvice") : tServices("buyerNoStoryPermissionGreeting")}
                </span>
              </div>
            )
          )}
        </div>
      </div>,
      document.body
    );
  }

  // ─── DESKTOP CAMERA VIEW ─────────────────────────────────────────────────────
  if (viewState === "camera" && !isMobile) {
    // Ancho del panel de datos. Es UNA sola medida usada en tres sitios (velo,
    // contenido y posición de la flecha) para que los tres se muevan juntos.
    const infoWidth = "clamp(230px, 26%, 320px)";
    // Lo que queda a la vista al plegar: una pestaña con la flecha.
    const infoTab = 56;

    // El pie apila rechazar, subir video y el botón rojo. Cada piso mide lo que
    // ocupa un botón de acción (40) más el aire entre ellos, contado desde 28.
    const FOOTER_REJECT_BOTTOM = 28;
    // Ahora los dos van en la misma fila, así que el rojo solo sube un piso.
    const FOOTER_RECORD_BOTTOM = FOOTER_REJECT_BOTTOM + 40 + 14;

    // Los controles del video traen un cazador de clics a `inset: 0`, así que
    // tal cual se tragan las pestañas laterales y no dejan plegar ni desplegar
    // nada durante la previsualización. Aquí se encierran en la franja central,
    // entre las dos pestañas: los clics de los bordes vuelven a llegar a las
    // flechas, y de paso los iconos de pantalla completa y silencio dejan de
    // caer justo encima de la pestaña del prompter.
    const videoChrome = (
      <div style={{
        position: "absolute", top: 0, bottom: 0,
        insetInlineStart: infoTab, insetInlineEnd: infoTab,
      }}>
        {renderVpControls(infoTab)}
      </div>
    );

    return createPortal(
      <>
      <style>{`
        /* Pop de entrada: escala con un ligero rebote —la curva se pasa de 1 y
           regresa— en vez de un fundido plano. Los dos paneles entran a la vez.
           Se respeta a quien pidió menos movimiento en su sistema. */
        @keyframes vibraGreetingPanelPop {
          from { opacity: 0; transform: scale(0.92) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        /* Salida: encoge y cae un poco, con curva de aceleración —sin rebote,
           que al irse no pega—. Se queda en el último fotograma (forwards)
           para que no dé un salto justo antes de desmontarse. */
        @keyframes vibraGreetingPanelOut {
          from { opacity: 1; transform: scale(1) translateY(0); }
          to   { opacity: 0; transform: scale(0.94) translateY(8px); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes vibraGreetingPanelPop {
            from { opacity: 0; transform: none; }
            to   { opacity: 1; transform: none; }
          }
          @keyframes vibraGreetingPanelOut {
            from { opacity: 1; transform: none; }
            to   { opacity: 0; transform: none; }
          }
        }
        /* Paloma del aviso de enviado. */
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
        /* El color del texto de ayuda no se puede dar en línea. */
        .grv-prompter::placeholder { color: rgba(255,255,255,0.28); }
        /* Barra fina para que el guion no gane un bloque gris al desbordar. */
        .grv-prompter { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent; }
        .grv-prompter::-webkit-scrollbar { width: 4px; }
        .grv-prompter::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 2px; }
        .grv-prompter::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div style={{
        position: "fixed", inset: 0, zIndex,
        // Mismo fondo que el visor de post: negro alto con desenfoque detrás.
        background: "rgba(0,0,0,0.86)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 10vw", boxSizing: "border-box", fontFamily: fontStack,
        // El fondo se va con el panel, no de golpe al desmontarse.
        opacity: panelClosing ? 0 : 1,
        transition: `opacity ${PANEL_CLOSE_MS}ms ease`,
      }}
        onClick={handleAnimatedClose}
      >

        {/* El tache va FUERA del panel, sobre su esquina superior derecha.
            Dentro se confundía con la flecha de plegar, que está a un dedo de
            distancia y hace algo muy distinto. La animación de entrada y salida
            se mueve a esta envoltura para que el tache entre y salga con el
            panel en vez de aparecer y desaparecer de golpe. */}
        <div
          style={{
            width: "100%",
            maxWidth: 1180,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 8,
            animation: panelClosing
              ? `vibraGreetingPanelOut ${PANEL_CLOSE_MS}ms cubic-bezier(0.4, 0, 1, 1) forwards`
              : "vibraGreetingPanelPop 220ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <IconButton
            label={tCommon("closeAriaLabel")}
            size="sm"
            tone="bare"
            shape="square"
            style={{ boxShadow: "none" }}
            onClick={(e) => { e.stopPropagation(); handleAnimatedClose(); }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6L18 18M18 6L6 18"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              />
            </svg>
          </IconButton>

        {/* UN SOLO panel de grabación. La información ya no es un panel
            hermano: va superpuesta sobre su lado izquierdo, para que el video
            aproveche todo el ancho. Alto un 20% mayor que antes
            (72dvh/688px → 86dvh/826px). */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "relative",
            width: "100%",
            height: "min(86dvh, 826px)",
            overflow: "hidden",
            background: "#000",
            boxSizing: "border-box",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.64)",
          }}
        >
        {!sampleMode && (
        <>
        {/* El VELO, en su propia capa y sin nada dentro. Es lo único que cambia
            de ancho al plegar; como no envuelve contenido, no reacomoda nada.
            Degradado de DOS paradas: con más, cada cambio de pendiente se ve
            como una banda. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: 0,
            bottom: 0,
            zIndex: 6,
            pointerEvents: "none",
            width: (infoOpen && !sampleMode) ? infoWidth : infoTab,
            transition: "width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
            background: infoOpen
              ? "linear-gradient(to right, rgba(0,0,0,0.90), rgba(0,0,0,0))"
              : "linear-gradient(to right, rgba(0,0,0,0.55), rgba(0,0,0,0))",
          }}
        />
        </>
        )}

        {/* La INFORMACIÓN, superpuesta sobre el lado izquierdo de la grabación.
            Al plegar se DESPLAZA fuera del panel conservando su ancho, en vez de
            estrecharse: así nada de lo que hay dentro se reacomoda y al volver a
            abrir ya está colocado tal cual estaba. La cámara no se apaga. */}
        <div style={{
          position: "absolute",
          insetInlineStart: 0,
          top: 0,
          bottom: 0,
          zIndex: 7,
          width: infoWidth,
          transform: (infoOpen && !sampleMode)
            ? "none"
            : "translateX(calc(var(--vb-dir, 1) * -100%))",
          opacity: (infoOpen && !sampleMode) ? 1 : 0,
          visibility: (infoOpen && !sampleMode) ? "visible" : "hidden",
          pointerEvents: (infoOpen && !sampleMode) ? "auto" : "none",
          transition:
            "transform 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease, visibility 300ms",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          // El panel ya NO rueda entero: rueda solo su zona central.
          overflow: "hidden",
          justifyContent: "flex-start",
          padding: 20,
          boxSizing: "border-box",
        }}
          onClick={(e) => e.stopPropagation()}
        >
            {/* Avatar y línea, clavados arriba. Antes se iban con el desplazamiento
                y el creador perdía de vista de quién era el encargo justo cuando
                bajaba a leer el contexto. El hueco de la derecha es para la
                flecha, que vive en otra capa. */}
            <div style={{ flexShrink: 0, paddingInlineEnd: 30, minWidth: 0, ...slideStyle }}>
              {buyerStoryCard}
            </div>
            <div style={{ flexShrink: 0 }}>{divider}</div>

            {/* La zona que rueda arranca DEBAJO de la línea. El colchón de abajo
                la separa de la barra de tiempo del reproductor, que aparece y
                desaparece sobre el video. */}
            <div style={{
              flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
              display: "flex", flexDirection: "column", gap: 16, minWidth: 0,
              paddingBottom: vpChromeVisible ? 56 : 8,
              transition: "padding-bottom 300ms cubic-bezier(0.4, 0, 0.2, 1)",
              ...slideStyle,
            }}>
              {earningRow}
              {infoSection}
            </div>

            <div style={{
              flexShrink: 0, paddingTop: 8,
              display: "flex", flexDirection: "column", gap: 8,
              // Se aparta de la barra de tiempo cuando el reproductor la enseña.
              paddingBottom: vpChromeVisible ? 48 : 0,
              transition: "padding-bottom 300ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}>
              {(viewMode || buyerViewMode) ? (
                <>
                  {buyerViewMode && (req.type === "saludo" || req.type === "consejo") && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
                        <span style={{ color: "rgba(255,255,255,0.88)", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
                          {tServices("addToMyStory")}
                        </span>
                        <Switch
                          checked={storyOnForBuyer}
                          disabled={storyToggleBusy}
                          label={tServices("addToMyStory")}
                          onChange={handleBuyerStoryToggle}
                        />
                      </div>
                    </>
                  )}
                  {buyerViewMode && viewMp4Url && (
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={downloading}
                      style={{
                        ...videoActionButton,
                        width: "100%",
                        background: "#3b82f6",
                        gap: 8,
                        position: "relative", overflow: "hidden",
                        cursor: downloading ? "not-allowed" : "pointer",
                      }}
                    >
                      {downloading && (
                        <span
                          aria-hidden="true"
                          style={{
                            position: "absolute", inset: 0,
                            background: "rgba(255,255,255,0.28)",
                            transformOrigin: "left center",
                            transform: `scaleX(${Math.max(0, Math.min(100, downloadProgress)) / 100})`,
                            transition: "transform 300ms ease-out",
                          }}
                        />
                      )}
                      <span style={{ position: "relative" }}>
                        {downloading ? tServices("downloadingProgress", { progress: downloadProgress }) : tServices("downloadVideo")}
                      </span>
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
                </>
              ) : uploadSucceeded ? null : (
                // El aviso de enviado y el porcentaje ya no viven aquí: el
                // primero va centrado sobre el video y el segundo dentro del
                // propio botón de enviar. Aquí solo queda la ficha del archivo.
                recordFileChip
              )}
            </div>

          {fileInput}
        </div>

        {/* La FLECHA, en su propia capa. No viaja con el contenido: se queda
            siempre sobre la pestaña, alineada a la derecha del panel de datos
            cuando está abierto, y es lo que permite volver a consultarlo a
            media grabación. Solo se desplaza, no reacomoda nada.

            La caja del botón mide 32, así que arranca en 31 para que el icono
            quede centrado con el aro del avatar. */}
        {!sampleMode && (
        <div
          style={{
            position: "absolute",
            zIndex: 8,
            top: 31,
            insetInlineStart: infoOpen ? `calc(${infoWidth} - 47px)` : 12,
            transition: "inset-inline-start 300ms cubic-bezier(0.4, 0, 0.2, 1)",
            display: "flex",
          }}
        >
          {/* Plegar no es cerrar, así que no se anuncia como "Cerrar": el tache
              que sí cierra vive arriba, fuera del panel. */}
          <IconButton
            label={infoOpen ? tCommon("hide") : tCommon("show")}
            size="sm"
            tone="bare"
            shape="square"
            style={{ boxShadow: "none" }}
            aria-expanded={infoOpen}
            onClick={(e) => { e.stopPropagation(); setInfoOpen((prev) => !prev); }}
          >
            {/* Apunta a la izquierda para plegar y a la derecha para volver a
                abrir. La variable --vb-dir lo espeja en árabe y hebreo, donde
                "cerrar hacia el lado" va al revés. */}
            <svg
              width="22" height="22" viewBox="0 0 24 24" fill="none"
              style={{
                transform: `scaleX(calc(var(--vb-dir, 1) * ${infoOpen ? 1 : -1}))`,
                transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <path
                d="M15 5L8 12L15 19"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </IconButton>
        </div>
        )}

        {/* ── PROMPTER ────────────────────────────────────────────────────────
            Espejo del panel de datos, en el borde opuesto y con las mismas tres
            capas: velo que se estrecha, contenido que se desplaza y flecha fija.
            Solo aparece mientras se graba: en la revisión de un video ya
            entregado no hay nada que leer. */}
        {!viewMode && !buyerViewMode && !uploadSucceeded && (
          <>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                insetInlineEnd: 0,
                top: 0,
                bottom: 0,
                zIndex: 6,
                pointerEvents: "none",
                width: prompterOpen ? infoWidth : infoTab,
                transition: "width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
                background: prompterOpen
                  ? "linear-gradient(to left, rgba(0,0,0,0.90), rgba(0,0,0,0))"
                  : "linear-gradient(to left, rgba(0,0,0,0.55), rgba(0,0,0,0))",
              }}
            />

            <div
              style={{
                position: "absolute",
                insetInlineEnd: 0,
                top: 0,
                bottom: 0,
                zIndex: 7,
                width: infoWidth,
                transform: prompterOpen
                  ? "none"
                  : "translateX(calc(var(--vb-dir, 1) * 100%))",
                opacity: prompterOpen ? 1 : 0,
                visibility: prompterOpen ? "visible" : "hidden",
                pointerEvents: prompterOpen ? "auto" : "none",
                transition:
                  "transform 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease, visibility 300ms",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                minWidth: 0,
                padding: 20,
                boxSizing: "border-box",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* El hueco de la izquierda es para la flecha, que va en otra capa. */}
              <span style={{
                flexShrink: 0, paddingInlineStart: 30,
                color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.2,
              }}>
                {tServices("prompterTitle")}
              </span>

              {/* Un textarea a secas, sin modo de edición: el guion se escribe y
                  se lee en el mismo sitio, que es lo que pide un prompter. */}
              <textarea
                className="grv-prompter"
                value={prompterScripts[req.type] ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setPrompterScripts((prev) => ({ ...prev, [req.type]: value }));
                }}
                placeholder={tServices("prompterPlaceholder")}
                spellCheck={false}
                style={{
                  flex: 1, minHeight: 0, width: "100%",
                  resize: "none", border: "none", outline: "none",
                  background: "transparent", padding: 0,
                  color: "#fff", fontSize: 17, fontWeight: 500, lineHeight: 1.6,
                  fontFamily: fontStack, boxSizing: "border-box",
                }}
              />
            </div>

            {/* La flecha y el rótulo van en una columna, NO dentro del mismo
                botón: IconButton es una caja cuadrada de lado fijo y el rótulo
                vertical no cabe en ella, se montaba encima de la flecha. El
                botón se queda con el icono, que es para lo que está. */}
            <div
              style={{
                position: "absolute",
                zIndex: 8,
                top: 8,
                // Descuadrada 9px respecto al panel para que el CENTRO del icono
                // caiga donde caía antes, ya que la caja del botón mide 40.
                insetInlineEnd: prompterOpen ? `calc(${infoWidth} - 51px)` : 8,
                transition: "inset-inline-end 300ms cubic-bezier(0.4, 0, 0.2, 1)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              }}
            >
              <IconButton
                label={tServices("prompterTitle")}
                size="md"
                tone="bare"
                shape="square"
                style={{ boxShadow: "none" }}
                aria-expanded={prompterOpen}
                onClick={(e) => { e.stopPropagation(); setPrompterOpen((prev) => !prev); }}
              >
                <svg
                  width="22" height="22" viewBox="0 0 24 24" fill="none"
                  style={{
                    // Apunta hacia afuera para plegar y hacia adentro para abrir.
                    transform: `scaleX(calc(var(--vb-dir, 1) * ${prompterOpen ? -1 : 1}))`,
                    transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                >
                  <path
                    d="M15 5L8 12L15 19"
                    stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </IconButton>

              {/* Plegado, una flecha sola no dice qué hay detrás. El rótulo en
                  vertical lo aclara sin robarle ancho al video. */}
              <span
                aria-hidden="true"
                style={{
                  writingMode: "vertical-rl",
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 12, letterSpacing: "0.06em",
                  pointerEvents: "none",
                  opacity: prompterOpen ? 0 : 1,
                  transition: "opacity 220ms ease",
                }}
              >
                {tServices("prompterTitle")}
              </span>
            </div>
          </>
        )}

        {/* La grabación ocupa el contenedor entero. Sin caja propia: el borde,
            las esquinas y la sombra los pone el panel de arriba. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
            <div style={{ position: "relative", height: "100%", width: "100%" }}>
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
                        height: "100%", width: "100%",
                        objectFit: "cover", background: "#000",
                      }}
                    />
                    {videoChrome}
                  </div>
                ) : (
                  <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
                    Video no disponible
                  </div>
                )
              ) : (
                <>
                  {/* Cámara en vivo. Se superpone con la grabación en lugar de
                      alternarse con display, que es lo que producía el corte
                      seco. Solo se muestra cuando ya hay imagen que enseñar. */}
                  <video
                    ref={videoRef}
                    autoPlay muted playsInline
                    disablePictureInPicture
                    onContextMenu={(e) => e.preventDefault()}
                    onPlaying={() => setCameraReady(true)}
                    onLoadedData={() => setCameraReady(true)}
                    style={{
                      position: "absolute", inset: 0,
                      height: "100%", width: "100%",
                      objectFit: "cover", background: "#000",
                      opacity: ((recordPhase !== "done" || uploadSucceeded) && cameraReady) ? 1 : 0,
                      transition: `opacity ${VIDEO_FADE_MS}ms ease`,
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  />
                  {recordedBlobUrl && (
                    <div style={{
                      position: "absolute", inset: 0,
                      height: "100%", width: "100%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      // Se queda montada un instante tras pulsar repetir, ya
                      // invisible, para poder fundirse en vez de esfumarse.
                      opacity: (recordPhase === "done" && !uploadSucceeded) ? 1 : 0,
                      pointerEvents: (recordPhase === "done" && !uploadSucceeded) ? "auto" : "none",
                      transition: `opacity ${VIDEO_FADE_MS}ms ease`,
                    }}>
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
                        height: "100%", width: "100%",
                        objectFit: "cover", background: "#000",
                        display: "block",
                      }}
                    />
                    {videoChrome}
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
                  {renderCameraRecordButton(recordPhase === "recording" ? 28 : FOOTER_RECORD_BOTTOM)}

                  {/* Subir un video pregrabado, justo debajo del botón rojo.
                      Se queda montado durante la grabación en vez de quitarse
                      del árbol, que es lo único que permite despedirlo con una
                      transición en lugar de que desaparezca de golpe. */}
                  {(() => {
                    const hidden = recordPhase !== "preview";
                    return (
                    <div
                      style={{
                        position: "absolute", bottom: FOOTER_REJECT_BOTTOM, left: "50%",
                        transform: hidden
                          ? "translateX(-50%) translateY(12px) scale(0.94)"
                          : "translateX(-50%) translateY(0) scale(1)",
                        opacity: hidden ? 0 : 1,
                        visibility: hidden ? "hidden" : "visible",
                        pointerEvents: hidden ? "none" : "auto",
                        transition:
                          "opacity 200ms ease, transform 300ms cubic-bezier(0.4, 0, 0.2, 1), visibility 300ms",
                        // Uno al lado del otro. La rejilla de dos columnas 1fr
                        // en un contenedor de ancho automático las iguala al
                        // contenido más ancho, así que los dos miden lo mismo
                        // sin fijar píxeles.
                        width: "fit-content",
                        display: "grid",
                        gridAutoFlow: "column",
                        gridAutoColumns: "1fr",
                        alignItems: "stretch", gap: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => { setUploadError(null); fileInputRef.current?.click(); }}
                        tabIndex={hidden ? -1 : 0}
                        style={{ ...videoActionButton, background: "#3b82f6", filter: "none" }}
                      >
                        {tServices("uploadPrerecordedVideo")}
                      </button>
                      {/* En una muestra no hay nada que rechazar. */}
                      {!sampleMode && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setConfirmRejectOpen(true); }}
                        disabled={rejecting}
                        tabIndex={hidden ? -1 : 0}
                        style={{
                          ...videoActionButton,
                          background: "rgba(75,85,99,0.62)",
                          filter: "none",
                          cursor: rejecting ? "not-allowed" : "pointer",
                        }}
                      >
                        {tCommon("reject")}
                      </button>
                      )}
                    </div>
                    );
                  })()}


                  {/* Repetir y enviar, al pie del video igual que el de subir.
                      Suben para dejar libre la línea de tiempo cuando aparece,
                      y vuelven a bajar cuando se esconde. Van por encima de los
                      controles del video, que traen un cazador de clics a todo
                      lo ancho y si no se los tragaría. */}
                  {(() => {
                    const hidden = recordPhase !== "done" || uploadSucceeded;
                    return (
                    <div style={{
                      position: "absolute", zIndex: 6, left: "50%",
                      bottom: vpChromeVisible ? 60 : 28,
                      // Se quedan montados para poder despedirse con el mismo
                      // fundido con el que entran los de grabar y subir.
                      transform: hidden
                        ? "translateX(-50%) translateY(12px) scale(0.94)"
                        : "translateX(-50%) translateY(0) scale(1)",
                      opacity: hidden ? 0 : 1,
                      visibility: hidden ? "hidden" : "visible",
                      pointerEvents: hidden ? "none" : "auto",
                      transition: [
                        "bottom 300ms cubic-bezier(0.4, 0, 0.2, 1)",
                        "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
                        "opacity 200ms ease",
                        "visibility 300ms",
                      ].join(", "),
                      // Rejilla en vez de fila: dos columnas de 1fr en un
                      // contenedor de ancho automático se igualan al contenido
                      // más ancho, así que los dos botones miden lo mismo y esa
                      // medida la marca el texto más largo. Con flex cada uno
                      // mediría lo suyo. `stretch` iguala también el alto.
                      display: "grid",
                      gridAutoFlow: "column",
                      gridAutoColumns: "1fr",
                      alignItems: "stretch",
                      gap: 10,
                    }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleRepeat(); }}
                        disabled={busy || isUploading}
                        style={{ ...videoActionButton, background: "#3b82f6" }}
                      >
                        {repeatLabel}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleSendGreeting(); }}
                        disabled={busy || isUploading}
                        style={{
                          ...videoActionButton,
                          // El degradado del botón de seguir de un perfil ajeno.
                          background: "linear-gradient(135deg, #ec4899, #9333ea)",
                          position: "relative", overflow: "hidden",
                        }}
                      >
                        {isUploading && (
                          <span
                            aria-hidden="true"
                            style={{
                              position: "absolute", inset: 0,
                              background: "rgba(255,255,255,0.28)",
                              transformOrigin: "left center",
                              transform: `scaleX(${Math.max(0, Math.min(100, uploadProgress)) / 100})`,
                              transition: "transform 300ms ease-out",
                            }}
                          />
                        )}
                        <span style={{ position: "relative" }}>{sendLabel}</span>
                      </button>
                    </div>
                    );
                  })()}

                  {successOverlay}
                </>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
      {rejectConfirmPanel}
      </>,
      document.body
    );
  }

  const reviewBgImage = req.type === "consejo" ? "/consejo.webp" : req.type === "saludo" ? "/saludo.webp" : null;
  const REVIEW_BG_CSS = `
    .grv-bg-img {
      position: absolute; top: 0; inset-inline-end: 0; bottom: 0; inset-inline-start: 0; z-index: 0;
      background-size: cover; background-position: center 40%; background-repeat: no-repeat;
      opacity: 0.52;
    }
    .grv-bg-grad {
      position: absolute; top: 0; inset-inline-end: 0; bottom: 0; inset-inline-start: 0; z-index: 1;
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
            position: "fixed", inset: 0, zIndex,
            background: "rgba(0,0,0,0.52)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          } as React.CSSProperties}
        />
        {/* Bottom sheet */}
        <div style={{
          position: "fixed", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0,
          zIndex: 10051,
          maxHeight: "calc(100dvh - 72px)",
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
          <div className="grv-z2" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "0 18px", paddingBottom: "calc(20px + var(--vb-safe-bottom, 0px))" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, ...slideStyle }}>
              {earningRow}
              {earningRow ? divider : null}
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
        position: "fixed", inset: 0, zIndex,
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
