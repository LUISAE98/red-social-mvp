"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, memo, type CSSProperties } from "react";
import Hls from "hls.js";
import {
  VideoPlayIcon, VideoPauseIcon,
  VideoSkipBackIcon, VideoSkipForwardIcon,
} from "@/app/components/VibraServiceIcons/VibraVideoIcons";
import type { Post } from "@/lib/posts/types";
import type { LiveChatMessage, SuperComment } from "@/lib/liveChat/types";
import { useLiveChat } from "@/lib/hooks/useLiveChat";
import {
  updateLiveChatEnabled,
  muteLiveChatUser,
  unmuteLiveChatUser,
  banLiveChatUser,
  unbanLiveChatUser,
  subscribeToTotalChatMessages,
  subscribeToLiveChatTimestamps,
} from "@/lib/liveChat/live-chat-service";
import {
  subscribeSuperComments,
  playSuperComment,
  pushActiveSuperToViewers,
  clearActiveSuper,
  hideSuperComment,
  showSuperComment,
  deleteSuperComment,
  updateLiveSuperCommentEnabled,
  getSuperCommentConfig,
  copySuperCommentConfigToLive,
} from "@/lib/liveChat/super-comment-service";
import { useAuth } from "@/app/providers";
import LiveDirectBroadcast from "@/app/components/LiveDirectBroadcast/LiveDirectBroadcast";
import LiveStreamSetup from "@/app/components/LiveStreamSetup/LiveStreamSetup";
import SuperCommentConfigPanel from "@/app/components/LiveChat/SuperCommentConfigPanel";
import LiveEndSummaryPanel from "@/app/components/LiveChat/LiveEndSummaryPanel";
import {
  subscribeToViewerCount,
  updatePeakViewers,
  subscribeToUniqueViewerCount,
  subscribeToAverageWatchTime,
  subscribeToNewFollowersDuringLive,
} from "@/lib/liveKit/liveViewers";
import { playEdgeTTS, TTS_MIN_DURATION_SECS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import { subscribeToTicketRevenue } from "@/lib/liveAccess/live-access-service";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";

const FONT = 'inherit';
const DIV = "1px solid rgba(255,255,255,0.12)";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  upcoming: "Por comenzar",
  live: "En vivo",
  ended: "Finalizado",
  cancelled: "Cancelado",
  error: "Error",
};

type Props = {
  open: boolean;
  onClose: () => void;
  post: Post;
  portrait?: boolean;
};

function OBSBrowserSourceBanner({ postId }: { postId: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/live-overlay.html?postId=${postId}`
    : `/live-overlay.html?postId=${postId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div style={{
      flexShrink: 0, padding: "10px 14px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(168,85,255,0.06)",
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#a855f7", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
        Browser Source — OBS
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{
          flex: 1, fontSize: 11, color: "rgba(255,255,255,0.5)",
          background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "5px 8px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          {url}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            flexShrink: 0, padding: "5px 10px", borderRadius: 6,
            border: "1px solid rgba(168,85,255,0.4)",
            background: copied ? "rgba(74,222,128,0.15)" : "rgba(168,85,255,0.15)",
            color: copied ? "#4ade80" : "#a855f7",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          {copied ? "✓ Copiado" : "Copiar"}
        </button>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 5 }}>
        En OBS: Añadir → Fuente de navegador · 700×160 · ✅ Permitir transparencia · Posiciona libremente en tu escena
      </div>
    </div>
  );
}

export default function LiveCreatorPanel({ open, onClose, post, portrait = false }: Props) {
  const { user } = useAuth();
  const { messages, deleteMessage } = useLiveChat(open ? post.id : null, 50);
  const [isDesktop, setIsDesktop] = useState(false);
  const [mobileTab, setMobileTab] = useState<"supercomentarios" | "estadisticas">("supercomentarios");
  const [panelRatio, setPanelRatio] = useState(0.65);
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const panelDragRef = useRef<HTMLDivElement>(null);
  const isDraggingPanel = useRef(false);
  const panelDragStartY = useRef(0);
  const panelDragStartRatio = useRef(0.65);
  const panelRatioRef = useRef(0.65);
  panelRatioRef.current = panelRatio;
  const PANEL_SNAPS = [0.25, 0.65, 0.82] as const;
  const docTouchMoveRef = useRef<((e: TouchEvent) => void) | null>(null);
  const docTouchEndRef = useRef<(() => void) | null>(null);
  const [togglingChat, setTogglingChat] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [optimisticChatEnabled, setOptimisticChatEnabled] = useState<boolean | null>(null);
  const [togglingScEnabled, setTogglingScEnabled] = useState(false);
  const [optimisticScEnabled, setOptimisticScEnabled] = useState<boolean | null>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  // Ref so the resize handler always reads the latest value without stale closure
  const isBroadcastingRef = useRef(false);
  isBroadcastingRef.current = isBroadcasting;
  const [viewerCount, setViewerCount] = useState(0);
  const [peakViewerCount, setPeakViewerCount] = useState(post.liveData?.peakViewers ?? 0);
  const peakViewerCountRef = useRef(post.liveData?.peakViewers ?? 0);
  peakViewerCountRef.current = peakViewerCount;
  const [uniqueViewerCount, setUniqueViewerCount] = useState(0);
  const [totalChatMessages, setTotalChatMessages] = useState(0);
  const [avgWatchSeconds, setAvgWatchSeconds] = useState(0);
  const [newFollowers, setNewFollowers] = useState(0);
  const [viewerHistory, setViewerHistory] = useState<{ t: number; v: number }[]>([]);
  const [chatTimestamps, setChatTimestamps] = useState<number[]>([]);
  const [ticketRevenue, setTicketRevenue] = useState(0);
  const [ticketCount, setTicketCount] = useState(0);
  const viewerCountRef = useRef(0);
  viewerCountRef.current = viewerCount;
  const [superComments, setSuperComments] = useState<SuperComment[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const isPlayingRef = useRef(false);
  const scheduledPlayTimeoutRef = useRef<number | null>(null);
  // Ventana para que Firestore entregue el snapshot a los viewers antes de scheduledAt.
  // 800ms era insuficiente en redes lentas — 1500ms cubre la gran mayoría de los casos.
  const LEAD_MS = 300;
  const [activeSuperOverlay, setActiveSuperOverlay] = useState<SuperComment | null>(null);
  const [superCommentTab, setSuperCommentTab] = useState<"nuevos" | "reproducidos">("nuevos");
  const [playingOverlay, setPlayingOverlay] = useState<SuperComment | null>(null);
  const [ttsReadIndex, setTtsReadIndex] = useState(0);
  const scBoundaryRef = useRef<HTMLSpanElement>(null);
  const scTextContainerRef = useRef<HTMLDivElement>(null);
  const ttsAudioRef = useRef<EdgeTTSHandle | null>(null);
  const displayEndTimerRef = useRef<number | null>(null);
  const obsReadyCallbackRef = useRef<((scheduledAt: number) => void) | null>(null);
  const [liveSetupOpen, setLiveSetupOpen] = useState(false);
  const [scConfigOpen, setScConfigOpen] = useState(false);
  const [headphonesDetected, setHeadphonesDetected] = useState(false);
  const [micMutedForTTS, setMicMutedForTTS] = useState(false);

  // Freeze the effective layout orientation during a broadcast. The `portrait`
  // prop can change mid-broadcast (e.g. LiveInlinePlayer detects stream orientation)
  // which would switch layout branches and unmount LiveDirectBroadcast.
  const [layoutPortrait, setLayoutPortrait] = useState(portrait);
  useEffect(() => {
    if (!isBroadcastingRef.current) setLayoutPortrait(portrait);
  }, [portrait]);

  useEffect(() => {
    const container = scTextContainerRef.current;
    const cursor = scBoundaryRef.current;
    if (!container || !cursor || ttsReadIndex === 0) return;
    const cRect = container.getBoundingClientRect();
    const cursorRect = cursor.getBoundingClientRect();
    const cursorBottom = cursorRect.bottom - cRect.top + container.scrollTop;
    const cursorTop = cursorRect.top - cRect.top + container.scrollTop;
    if (cursorBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = cursorBottom - container.clientHeight + 8;
    } else if (cursorTop < container.scrollTop) {
      container.scrollTop = cursorTop - 8;
    }
  }, [ttsReadIndex]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const liveData = post.liveData;
  const liveStatus = liveData?.status;
  const chatEnabledFromFirestore = liveData?.chatEnabled !== false;
  const chatEnabled = optimisticChatEnabled ?? chatEnabledFromFirestore;
  const scEnabledFromFirestore = liveData?.superCommentConfig?.enabled !== false;
  const scEnabled = optimisticScEnabled ?? scEnabledFromFirestore;

  const hlsUrl =
    post.playback?.hlsUrl ??
    (liveData?.playbackId ? `https://stream.mux.com/${liveData.playbackId}.m3u8` : null);
  const isEnded = liveStatus === "ended";
  const broadcastMode = liveData?.broadcastMode ?? null;
  const streamProvider = liveData?.streamProvider ?? null;
  const isCFStream = streamProvider === "cloudflare";
  const showDirectBroadcast = broadcastMode === "direct" && !isEnded;
  const showVideo = (liveStatus === "live" || isEnded) && !!hlsUrl && !showDirectBroadcast;

  // End-of-stream summary panel — only for Mux streams (CF lives have no recordable VOD)
  const [endPanelOpen, setEndPanelOpen] = useState(false);
  const showEndPanel = isEnded && !liveData?.vodSettingsConfirmed && !isCFStream;
  useEffect(() => {
    if (showEndPanel && open) setEndPanelOpen(true);
  }, [showEndPanel, open]);


  useEffect(() => {
    const update = () => {
      // Freeze layout while a broadcast is active — changing branches would
      // unmount LiveDirectBroadcast and its cleanup disconnects the room.
      if (isBroadcastingRef.current) return;
      setIsDesktop(window.innerWidth >= 768);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    console.log("[LiveCreatorPanel] liveData.chatEnabled changed to:", liveData?.chatEnabled, "→ resetting optimistic");
    setOptimisticChatEnabled(null);
  }, [liveData?.chatEnabled]);

  useEffect(() => {
    setOptimisticScEnabled(null);
  }, [liveData?.superCommentConfig?.enabled]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!open || isEnded || !post.id) return;
    return subscribeToViewerCount(post.id, (count) => {
      setViewerCount(count);
      if (count > peakViewerCountRef.current) {
        setPeakViewerCount(count);
        updatePeakViewers(post.id, count).catch(console.warn);
      }
    });
  }, [open, isEnded, post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !post.id) return;
    return subscribeToUniqueViewerCount(post.id, setUniqueViewerCount);
  }, [open, post.id]);

  useEffect(() => {
    if (!open || !post.id) return;
    return subscribeToTotalChatMessages(post.id, setTotalChatMessages);
  }, [open, post.id]);

  useEffect(() => {
    if (!open || !post.id) return;
    return subscribeToAverageWatchTime(post.id, setAvgWatchSeconds);
  }, [open, post.id]);

  useEffect(() => {
    if (!open || !post.authorId || !liveData?.startedAt) return;
    return subscribeToNewFollowersDuringLive(post.authorId, liveData.startedAt, setNewFollowers);
  }, [open, post.authorId, liveData?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Muestrea el viewerCount cada 30 s para la gráfica histórica.
  // Usa ref para leer el valor más reciente sin que el intervalo se reinicie.
  useEffect(() => {
    if (!open || !post.id) return;
    const addPoint = () =>
      setViewerHistory((prev) => {
        const point = { t: Date.now(), v: viewerCountRef.current };
        const next = [...prev, point];
        return next.length > 240 ? next.slice(-240) : next;
      });
    addPoint();
    const id = window.setInterval(addPoint, 30_000);
    return () => window.clearInterval(id);
  }, [open, post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !post.id) return;
    return subscribeToLiveChatTimestamps(post.id, setChatTimestamps);
  }, [open, post.id]);

  useEffect(() => {
    if (!open || !post.id || liveData?.accessType !== "paid") return;
    return subscribeToTicketRevenue(post.id, (amount, count) => {
      setTicketRevenue(amount);
      setTicketCount(count);
    });
  }, [open, post.id, liveData?.accessType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Supercomentarios — disponibles en directo (CF) y RTMP (Mux/OBS)
  useEffect(() => {
    if (!open || !post.id || (broadcastMode !== "direct" && broadcastMode !== "rtmp")) {
      setSuperComments([]);
      return;
    }
    return subscribeSuperComments(post.id, setSuperComments);
  }, [open, post.id, broadcastMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // OBS handshake: escucha cuando OBS confirma que ya está mostrando el SC
  useEffect(() => {
    if (!open || !post.id || broadcastMode !== "rtmp") return;
    const unsub = onSnapshot(doc(db, "liveOverlays", post.id), (snap) => {
      const obsReady = snap.data()?.obsReady as number | null;
      if (obsReady != null && obsReadyCallbackRef.current) {
        obsReadyCallbackRef.current(obsReady);
      }
    });
    return () => unsub();
  }, [open, post.id, broadcastMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleChat = useCallback(async () => {
    if (togglingChat || !user) return;
    const newValue = !chatEnabled;
    console.log("[toggleChat] current:", chatEnabled, "→ newValue:", newValue, "postId:", post.id);
    setTogglingChat(true);
    setToggleError(null);
    setOptimisticChatEnabled(newValue);
    try {
      await updateLiveChatEnabled(post.id, newValue);
      console.log("[toggleChat] write ok, chatEnabled now:", newValue);
      // Re-assert optimistic after confirmed write to guard against the
      // Firestore listener resetting it before the snapshot arrives.
      setOptimisticChatEnabled(newValue);
    } catch (err) {
      console.error("[LiveCreatorPanel] toggleChat error:", err);
      setOptimisticChatEnabled(null);
      const msg = err instanceof Error ? err.message : String(err);
      setToggleError(msg.includes("permission") ? "Sin permiso para cambiar el chat." : "Error al cambiar el chat.");
    } finally {
      setTogglingChat(false);
    }
  }, [togglingChat, user, post.id, chatEnabled]);

  const handleToggleSuperComments = useCallback(async () => {
    if (togglingScEnabled || !user) return;
    const newValue = !scEnabled;
    setTogglingScEnabled(true);
    setOptimisticScEnabled(newValue);
    try {
      const currentConfig = liveData?.superCommentConfig;
      if (newValue && (!currentConfig?.tiers?.length)) {
        // Al activar sin tiers en el live, cargar config guardada del usuario
        // (o defaults) para que los viewers vean el botón de supercomentarios
        const savedConfig = await getSuperCommentConfig(user.uid);
        await copySuperCommentConfigToLive(post.id, { ...savedConfig, enabled: true });
      } else if (currentConfig?.tiers?.length) {
        // Ya hay tiers → solo actualizar el flag enabled
        await updateLiveSuperCommentEnabled(post.id, newValue);
      } else {
        // Desactivando sin tiers: escribir config completa con enabled: false
        const savedConfig = await getSuperCommentConfig(user.uid);
        await copySuperCommentConfigToLive(post.id, { ...savedConfig, enabled: false });
      }
      setOptimisticScEnabled(newValue);
    } catch (err) {
      console.error("[LiveCreatorPanel] toggle supercomentarios falló:", err);
      setOptimisticScEnabled(null);
    } finally {
      setTogglingScEnabled(false);
    }
  }, [togglingScEnabled, user, post.id, scEnabled, liveData?.superCommentConfig]);

  const handleMuteToggle = useCallback(async (userId: string) => {
    const isMuted = liveData?.mutedUsers?.includes(userId) ?? false;
    try {
      if (isMuted) await unmuteLiveChatUser(post.id, userId);
      else await muteLiveChatUser(post.id, userId);
    } catch { /* noop */ }
  }, [post.id, liveData]);

  const handleBanToggle = useCallback(async (userId: string) => {
    const isBanned = liveData?.bannedUsers?.includes(userId) ?? false;
    try {
      if (isBanned) await unbanLiveChatUser(post.id, userId);
      else await banLiveChatUser(post.id, userId);
    } catch { /* noop */ }
  }, [post.id, liveData]);

  const handleDeleteMessage = useCallback(async (msgId: string) => {
    if (!user) return;
    await deleteMessage(msgId, user.uid);
  }, [user, deleteMessage]);

  useEffect(() => {
    return () => {
      if (docTouchMoveRef.current) document.removeEventListener("touchmove", docTouchMoveRef.current);
      if (docTouchEndRef.current) document.removeEventListener("touchend", docTouchEndRef.current);
    };
  }, []);

  // ── Drag handlers para panel portrait mobile ─────────────────────────────
  // Usa listeners a nivel document para que el drag siga aunque el dedo salga del handle
  const onPanelTouchStart = (e: React.TouchEvent) => {
    isDraggingPanel.current = true;
    panelDragStartY.current = e.touches[0].clientY;
    panelDragStartRatio.current = panelRatioRef.current;

    docTouchMoveRef.current = (ev: TouchEvent) => {
      if (!isDraggingPanel.current) return;
      ev.preventDefault();
      const totalH = bodyContainerRef.current?.offsetHeight ?? window.innerHeight;
      const deltaY = panelDragStartY.current - ev.touches[0].clientY;
      const newRatio = Math.max(0.15, Math.min(0.88, panelDragStartRatio.current + deltaY / totalH));
      if (panelDragRef.current) panelDragRef.current.style.height = `${newRatio * 100}%`;
      if (videoAreaRef.current) videoAreaRef.current.style.height = `${(1 - newRatio) * 100}%`;
    };

    docTouchEndRef.current = () => {
      if (!isDraggingPanel.current) return;
      isDraggingPanel.current = false;
      if (docTouchMoveRef.current) document.removeEventListener("touchmove", docTouchMoveRef.current);
      if (docTouchEndRef.current) document.removeEventListener("touchend", docTouchEndRef.current);
      const totalH = bodyContainerRef.current?.offsetHeight ?? window.innerHeight;
      const cur = (panelDragRef.current?.offsetHeight ?? totalH * 0.65) / totalH;
      const snapped = [...PANEL_SNAPS].reduce((a, b) => Math.abs(b - cur) < Math.abs(a - cur) ? b : a);
      if (panelDragRef.current) panelDragRef.current.style.height = `${snapped * 100}%`;
      if (videoAreaRef.current) videoAreaRef.current.style.height = `${(1 - snapped) * 100}%`;
      setPanelRatio(snapped);
    };

    document.addEventListener("touchmove", docTouchMoveRef.current, { passive: false });
    document.addEventListener("touchend", docTouchEndRef.current);
  };

  if (!open || typeof document === "undefined") return null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function formatWatchTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  function renderViewerChart() {
    const W = 300; const H = 72;
    const data = viewerHistory;

    if (data.length < 2) {
      return (
        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", fontFamily: FONT }}>
            {data.length === 0 ? "Iniciando…" : "Acumulando datos…"}
          </span>
        </div>
      );
    }

    const maxV = Math.max(...data.map((d) => d.v), 1);
    const minT = data[0].t;
    const maxT = data[data.length - 1].t;
    const rangeT = maxT - minT || 1;

    const toX = (t: number) => ((t - minT) / rangeT) * W;
    const toY = (v: number) => H - 4 - (v / maxV) * (H - 8);

    const linePts = data.map((d) => `${toX(d.t).toFixed(1)},${toY(d.v).toFixed(1)}`).join(" ");
    const lastX = toX(data[data.length - 1].t).toFixed(1);
    const areaPts = `0,${H} ${linePts} ${lastX},${H}`;

    // Format elapsed time label for X-axis ends
    const elapsedMin = Math.round((maxT - minT) / 60_000);
    const durationLabel = elapsedMin < 60
      ? `${elapsedMin}m`
      : `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}m`;

    return (
      <div style={{ position: "relative" }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id="lcp-vg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Área bajo la curva */}
          <polygon points={areaPts} fill="url(#lcp-vg)" />
          {/* Línea principal */}
          <polyline points={linePts} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          {/* Punto actual */}
          <circle cx={lastX} cy={toY(data[data.length - 1].v).toFixed(1)} r="3" fill="#a855f7" />
        </svg>
        {/* Etiquetas X */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: FONT }}>Inicio</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: FONT }}>+{durationLabel}</span>
        </div>
        {/* Etiqueta Y (máximo) */}
        <span style={{
          position: "absolute", top: 0, right: 0,
          fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: FONT,
        }}>
          máx {maxV}
        </span>
      </div>
    );
  }

  function renderHeatmap() {
    const startedAt = liveData?.startedAt;

    if (!startedAt) {
      return (
        <div style={{ height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", fontFamily: FONT }}>
            El live no ha comenzado
          </span>
        </div>
      );
    }

    const startMs = startedAt.toMillis();
    const endMs = liveData?.endedAt?.toMillis() ?? Date.now();
    const durationMs = endMs - startMs;

    if (durationMs < 120_000) {
      return (
        <div style={{ height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", fontFamily: FONT }}>
            Acumulando datos…
          </span>
        </div>
      );
    }

    const durationMin = durationMs / 60_000;
    const bucketMinutes = durationMin <= 40 ? 1 : durationMin <= 120 ? 2 : 5;
    const bucketCount = Math.min(Math.ceil(durationMin / bucketMinutes), 60);
    const bucketMs = durationMs / bucketCount;

    const counts = new Array<number>(bucketCount).fill(0);
    chatTimestamps.forEach((ts) => {
      const idx = Math.floor((ts - startMs) / bucketMs);
      if (idx >= 0 && idx < bucketCount) counts[idx]++;
    });
    const maxCount = Math.max(...counts, 1);

    const fmtClock = (ms: number) => {
      const d = new Date(ms);
      return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    };

    return (
      <div>
        <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 32 }}>
          {counts.map((c, i) => {
            const heat = c / maxCount;
            const barH = Math.max(4, Math.round(4 + heat * 28));
            const alpha = heat < 0.01 ? 0.08 : 0.15 + heat * 0.85;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: barH,
                  minWidth: 0,
                  borderRadius: 3,
                  background: `rgba(168,85,247,${alpha.toFixed(2)})`,
                  alignSelf: "flex-end",
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: FONT }}>
            {fmtClock(startMs)}
          </span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: FONT }}>
            {fmtClock(endMs)}
          </span>
        </div>
      </div>
    );
  }

  function sectionHeader(label: string, extra?: React.ReactNode) {
    return (
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", padding: "12px 16px", borderBottom: DIV, minHeight: 44,
      }}>
        <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, letterSpacing: "-0.02em", fontFamily: FONT }}>
          {label}
        </span>
        {extra && (
          <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)" }}>
            {extra}
          </div>
        )}
      </div>
    );
  }

  function comingSoon() {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.12)", fontFamily: FONT }}>Próximamente</span>
      </div>
    );
  }

  function renderStatsSection() {
    const paidSuperComments = superComments.filter((sc) => sc.status === "paid" && !sc.isDeleted);
    const superCount = paidSuperComments.length;
    const superRevenue = paidSuperComments.reduce((sum, sc) => sum + sc.amount, 0);
    const isPaidLive = liveData?.accessType === "paid";
    const currency = liveData?.currency ?? "MXN";

    const fmtMoney = (amount: number) =>
      amount.toLocaleString("es-MX", { style: "currency", currency, maximumFractionDigits: 0 });

    return (
      <div style={{ flex: 1, overflow: "auto", scrollbarWidth: "none", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Espectadores actuales */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(168,85,247,0.15)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {viewerCount.toLocaleString("es-MX")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Espectadores ahora
            </span>
          </div>
        </div>

        {/* Pico de espectadores */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(251,146,60,0.15)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {peakViewerCount.toLocaleString("es-MX")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Pico máximo simultáneo
            </span>
          </div>
        </div>

        {/* Total espectadores únicos */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(34,197,94,0.12)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {uniqueViewerCount.toLocaleString("es-MX")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Espectadores únicos
            </span>
          </div>
        </div>

        {/* Gráfica de espectadores a lo largo del tiempo */}
        <div style={{
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>
            Espectadores en el tiempo
          </span>
          {renderViewerChart()}
        </div>

        {/* Heatmap de actividad del chat */}
        <div style={{
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>
            Heatmap de actividad
          </span>
          {renderHeatmap()}
        </div>

        {/* Total comentarios del chat */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(99,102,241,0.15)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {totalChatMessages.toLocaleString("es-MX")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Mensajes en el chat
            </span>
          </div>
        </div>

        {/* Tiempo promedio de permanencia */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(20,184,166,0.15)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {avgWatchSeconds > 0 ? formatWatchTime(avgWatchSeconds) : "—"}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Tiempo promedio
            </span>
          </div>
        </div>

        {/* Seguidores nuevos durante el live */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(236,72,153,0.12)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {newFollowers.toLocaleString("es-MX")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Nuevos seguidores
            </span>
          </div>
        </div>

        {/* Total supercomentarios */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(250,204,21,0.12)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {superCount.toLocaleString("es-MX")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Supercomentarios
            </span>
          </div>
        </div>

        {/* Ingresos por supercomentarios */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(250,204,21,0.12)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {superRevenue > 0 ? fmtMoney(superRevenue) : "—"}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Por supercomentarios
            </span>
          </div>
        </div>

        {/* Ingresos por tickets — solo si el live es de pago */}
        {isPaidLive && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: "rgba(74,222,128,0.12)",
              display: "grid", placeItems: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
                {ticketRevenue > 0 ? fmtMoney(ticketRevenue) : "—"}
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
                Tickets · {ticketCount} {ticketCount === 1 ? "comprador" : "compradores"}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  function _doPlay(sc: SuperComment) {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    setPlayingId(sc.id);

    const scheduledAtMs = Date.now() + LEAD_MS;
    if (!isEnded) {
      playSuperComment(post.id, sc).catch(() => {});
      pushActiveSuperToViewers(post.id, sc, scheduledAtMs).catch(() => {});
    }

    // Lógica de mostrar overlay — llamada desde handshake OBS o desde timeout
    function activateCreatorOverlay() {
      if (scheduledPlayTimeoutRef.current !== null) {
        window.clearTimeout(scheduledPlayTimeoutRef.current);
        scheduledPlayTimeoutRef.current = null;
      }
      obsReadyCallbackRef.current = null;

      setActiveSuperOverlay(sc);
      setPlayingOverlay(sc);
      setTtsReadIndex(0);
      if (sc.displaySeconds >= TTS_MIN_DURATION_SECS) {
        if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
        const withoutHeadphones = !headphonesDetected;
        if (withoutHeadphones) setMicMutedForTTS(true);
        const isDonation = !sc.text;
        const ttsText = isDonation
          ? `${sc.username} donó ${sc.amount} pesos`
          : `${sc.username} dijo: ${sc.text}`;
        const prefixLen = isDonation ? 0 : `${sc.username} dijo: `.length;
        const totalLen = ttsText.length;
        ttsAudioRef.current = playEdgeTTS(ttsText, {
          volume: 1,
          onProgress: (ratio) => {
            if (!isDonation) {
              const charPos = Math.floor(ratio * totalLen);
              setTtsReadIndex(Math.max(0, Math.min(charPos - prefixLen, sc.text.length)));
            }
          },
          onEnded: () => {
            ttsAudioRef.current = null;
            if (!isDonation) setTtsReadIndex(sc.text.length);
            if (withoutHeadphones) setMicMutedForTTS(false);
          },
        });
      }
      if (displayEndTimerRef.current !== null) window.clearTimeout(displayEndTimerRef.current);
      displayEndTimerRef.current = window.setTimeout(() => {
        displayEndTimerRef.current = null;
        setActiveSuperOverlay(null);
        isPlayingRef.current = false;
        clearActiveSuper(post.id).catch(() => {});
      }, sc.displaySeconds * 1000);
    }

    if (scheduledPlayTimeoutRef.current !== null) window.clearTimeout(scheduledPlayTimeoutRef.current);

    if (broadcastMode === "rtmp") {
      // RTMP/OBS: esperar confirmación de OBS antes de mostrar overlay del creador.
      // OBS llama a /api/live-overlay-ready cuando ya está mostrando el SC.
      // Si OBS no confirma en 1.5s, mostrar igual (fallback).
      obsReadyCallbackRef.current = (readyScheduledAt: number) => {
        if (readyScheduledAt !== scheduledAtMs) return;
        activateCreatorOverlay();
      };
      scheduledPlayTimeoutRef.current = window.setTimeout(() => {
        scheduledPlayTimeoutRef.current = null;
        if (obsReadyCallbackRef.current) {
          obsReadyCallbackRef.current = null;
          activateCreatorOverlay();
        }
      }, 1500);
    } else {
      // CF/directo: mostrar overlay tras LEAD_MS (sin OBS involucrado)
      scheduledPlayTimeoutRef.current = window.setTimeout(() => {
        scheduledPlayTimeoutRef.current = null;
        activateCreatorOverlay();
      }, LEAD_MS);
    }
  }

  function handlePlaySC(sc: SuperComment) {
    // Igual que handleReplaySCFromOverlay: limpia estado residual antes de _doPlay
    // para que el botón "Reproducir" funcione siempre, aunque el SC anterior no haya
    // limpiado correctamente isPlayingRef.
    if (scheduledPlayTimeoutRef.current !== null) {
      window.clearTimeout(scheduledPlayTimeoutRef.current);
      scheduledPlayTimeoutRef.current = null;
    }
    if (displayEndTimerRef.current !== null) {
      window.clearTimeout(displayEndTimerRef.current);
      displayEndTimerRef.current = null;
    }
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    setMicMutedForTTS(false);
    setTtsReadIndex(0);
    isPlayingRef.current = false;
    _doPlay(sc);
  }

  // Para la reproducción para todos los espectadores sin cerrar el overlay del creador
  function handleStopForAll() {
    if (scheduledPlayTimeoutRef.current !== null) {
      window.clearTimeout(scheduledPlayTimeoutRef.current);
      scheduledPlayTimeoutRef.current = null;
    }
    if (displayEndTimerRef.current !== null) {
      window.clearTimeout(displayEndTimerRef.current);
      displayEndTimerRef.current = null;
    }
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    obsReadyCallbackRef.current = null;
    isPlayingRef.current = false;
    setMicMutedForTTS(false);
    setActiveSuperOverlay(null);
    clearActiveSuper(post.id).catch(() => {});
    // El overlay del creador (playingOverlay) se mantiene abierto
  }

  // Para la reproducción Y cierra el overlay del creador (botón X y cierre de panel)
  function handleCloseSCOverlay() {
    handleStopForAll();
    setPlayingOverlay(null);
    setPlayingId(null);
    setTtsReadIndex(0);
  }

  function handlePanelClose() {
    if (playingOverlay || isPlayingRef.current) handleCloseSCOverlay();
    onClose();
  }

  function handleReplaySCFromOverlay() {
    if (!playingOverlay) return;
    const sc = playingOverlay;
    // Cancelar estado actual del play en curso
    if (scheduledPlayTimeoutRef.current !== null) {
      window.clearTimeout(scheduledPlayTimeoutRef.current);
      scheduledPlayTimeoutRef.current = null;
    }
    if (displayEndTimerRef.current !== null) {
      window.clearTimeout(displayEndTimerRef.current);
      displayEndTimerRef.current = null;
    }
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    setMicMutedForTTS(false);
    setTtsReadIndex(0);
    isPlayingRef.current = false;
    // Relanzar con todas las APIs (playSuperComment + pushActiveSuperToViewers)
    _doPlay(sc);
  }

  function handleNextSCOverlay() {
    const currentId = playingOverlay?.id;
    if (scheduledPlayTimeoutRef.current !== null) {
      window.clearTimeout(scheduledPlayTimeoutRef.current);
      scheduledPlayTimeoutRef.current = null;
    }
    if (displayEndTimerRef.current !== null) {
      window.clearTimeout(displayEndTimerRef.current);
      displayEndTimerRef.current = null;
    }
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    isPlayingRef.current = false;
    setMicMutedForTTS(false);
    setPlayingOverlay(null);
    setPlayingId(null);
    setTtsReadIndex(0);
    clearActiveSuper(post.id).catch(() => {});
    const next = superComments.find((sc) => !sc.isDeleted && !sc.played && sc.id !== currentId);
    if (next) window.setTimeout(() => _doPlay(next), 0);
  }

  function renderSuperCommentsSection() {
    const visible = superComments.filter((sc) => !sc.isDeleted);
    const nuevos = visible.filter((sc) => !sc.played);
    const reproducidos = visible.filter((sc) => sc.played);
    const tabItems = superCommentTab === "nuevos" ? nuevos : reproducidos;

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Browser Source URL para OBS (solo en streams RTMP/Mux) */}
        {broadcastMode === "rtmp" && (
          <OBSBrowserSourceBanner postId={post.id} />
        )}
        {/* Toggle activar/desactivar supercomentarios */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 8, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#a855f7", fontFamily: FONT }}>
            {scEnabled ? "Desactivar supercomentarios" : "Activar supercomentarios"}
          </span>
          <button
            type="button"
            onClick={handleToggleSuperComments}
            disabled={togglingScEnabled}
            aria-label={scEnabled ? "Desactivar supercomentarios" : "Activar supercomentarios"}
            style={{
              border: "none", padding: 0, background: "transparent",
              cursor: togglingScEnabled ? "not-allowed" : "pointer",
              opacity: togglingScEnabled ? 0.6 : 1, flexShrink: 0,
              display: "flex", alignItems: "center",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 40, height: 22, borderRadius: 11,
                background: scEnabled ? "#a855ff" : "transparent",
                boxShadow: scEnabled ? "none" : "inset 0 0 0 1.5px rgba(168,85,255,0.3)",
                position: "relative", display: "inline-block",
                transition: "background 0.18s",
              }}
            >
              <span style={{
                position: "absolute", top: 3,
                left: scEnabled ? 21 : 3,
                width: 16, height: 16, borderRadius: "50%",
                background: scEnabled ? "#fff" : "rgba(196,168,255,0.45)",
                boxShadow: scEnabled ? "0 1px 3px rgba(0,0,0,0.35)" : "none",
                transition: "left 0.18s, background 0.18s",
              }} />
            </span>
          </button>
        </div>

        {/* Botón config — solo disponible antes de iniciar el live */}
        {!isBroadcasting && liveStatus !== "live" && liveStatus !== "ended" && (
          <div style={{ flexShrink: 0, padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              type="button"
              onClick={() => setScConfigOpen(true)}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, rgba(168,85,255,0.85), rgba(124,58,237,0.85))",
                color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: "pointer",
              }}
            >
              Configuración de supercomentarios
            </button>
          </div>
        )}

        {broadcastMode !== "direct" && broadcastMode !== "rtmp" ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontFamily: FONT, textAlign: "center", padding: "0 16px" }}>
              Los supercomentarios solo están disponibles en transmisión directa
            </span>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Tab bar: Nuevos / Reproducidos */}
        <div style={{
          flexShrink: 0, display: "flex",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "0 4px",
        }}>
          {(["nuevos", "reproducidos"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSuperCommentTab(tab)}
              style={{
                flex: 1, padding: "8px 4px",
                border: "none", background: "transparent",
                color: superCommentTab === tab ? "#fff" : "rgba(255,255,255,0.3)",
                fontSize: 10, fontWeight: 700, fontFamily: FONT,
                cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase",
                borderBottom: superCommentTab === tab ? "2px solid #a855f7" : "2px solid transparent",
                marginBottom: -1,
                transition: "color 0.15s",
              }}
            >
              {tab === "nuevos"
                ? `Nuevos${nuevos.length > 0 ? ` (${nuevos.length})` : ""}`
                : `Reproducidos${reproducidos.length > 0 ? ` (${reproducidos.length})` : ""}`}
            </button>
          ))}
        </div>

        {tabItems.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", fontFamily: FONT }}>
              {superCommentTab === "nuevos" ? "Sin supercomentarios nuevos" : "Ninguno reproducido aún"}
            </span>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
            <style>{`.lcp-sc::-webkit-scrollbar{display:none}`}</style>
            <div className="lcp-sc">
              {tabItems.map((sc) => {
                const scIsBanned = liveData?.bannedUsers?.includes(sc.userId) ?? false;
                return (
                <div
                  key={sc.id}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    opacity: scIsBanned ? 0.38 : sc.hidden ? 0.45 : 1,
                    background: "transparent",
                  }}
                >
                  <ScAvatar url={sc.avatarUrl} name={sc.username} ringColor={sc.color} />

                  {/* Contenido central */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Renglón 1: nombre + monto + Reproducir + spacer + acciones */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: FONT, flexShrink: 0 }}>
                        {sc.username}
                      </span>
                      {scIsBanned && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 3, padding: "0px 4px", flexShrink: 0 }}>BAN</span>
                      )}
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#86efac", fontFamily: FONT, flexShrink: 0 }}>
                        +${(sc.amount * 0.77).toFixed(2)} MXN
                      </span>
                      <button
                        type="button"
                        onClick={() => handlePlaySC(sc)}
                        title={sc.played ? "Reproducir de nuevo" : "Reproducir"}
                        style={{
                          padding: "3px 10px", borderRadius: 6, border: "none",
                          background: playingId === sc.id
                            ? `${sc.color}55`
                            : "linear-gradient(135deg, #a855f7, #f72fbe)",
                          color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: FONT,
                          cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        Reproducir
                      </button>
                      {sc.hidden && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", fontFamily: FONT, flexShrink: 0 }}>OCULTO</span>
                      )}
                      <div style={{ flex: 1 }} />
                      <ModActionBtn
                        onClick={() => {
                          if (sc.hidden) showSuperComment(post.id, sc.id);
                          else hideSuperComment(post.id, sc.id);
                        }}
                        active={sc.hidden}
                        activeColor="#f59e0b"
                        title={sc.hidden ? "Mostrar" : "Ocultar"}
                      >
                        {sc.hidden ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </ModActionBtn>
                      <ModActionBtn
                        onClick={() => deleteSuperComment(post.id, sc.id)}
                        active={false}
                        activeColor="#ef4444"
                        title="Eliminar supercomentario"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6" /><path d="M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      </ModActionBtn>
                      <ModActionBtn
                        onClick={() => handleBanToggle(sc.userId)}
                        active={liveData?.bannedUsers?.includes(sc.userId) ?? false}
                        activeColor="#ef4444"
                        title={liveData?.bannedUsers?.includes(sc.userId) ? "Desbanear" : "Banear del live"}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                      </ModActionBtn>
                    </div>
                    {/* Renglón 2: texto del mensaje a ancho completo */}
                    {sc.text ? (
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.4, fontFamily: FONT, wordBreak: "break-word" }}>
                        {sc.text}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontStyle: "italic", fontFamily: FONT }}>
                        Donación ${sc.amount.toFixed(2)} MXN
                      </span>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}
          </div>
        )}
      </div>
    );
  }

  function renderEndedOverlay() {
    return (
      <div style={{
        position: "absolute", inset: 0, zIndex: 4,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10,
        fontFamily: FONT,
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.75)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.01em" }}>
          Transmisión finalizada
        </span>
      </div>
    );
  }

  function renderChatSection() {
    return (
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1, minHeight: 0 }}>
        {sectionHeader("Chat")}

        {/* Fila activar/desactivar chat con switch — agrupados a la derecha */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 8, padding: "10px 16px",
        }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#a855f7", fontFamily: FONT }}>
            {chatEnabled ? "Desactivar chat live" : "Activar chat live"}
          </span>
          <button
            type="button"
            onClick={handleToggleChat}
            disabled={togglingChat}
            aria-label={chatEnabled ? "Desactivar chat" : "Activar chat"}
            style={{
              border: "none", padding: 0, background: "transparent",
              cursor: togglingChat ? "not-allowed" : "pointer",
              opacity: togglingChat ? 0.6 : 1, flexShrink: 0,
              display: "flex", alignItems: "center",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 40, height: 22, borderRadius: 11,
                background: chatEnabled ? "#a855ff" : "transparent",
                boxShadow: chatEnabled ? "none" : "inset 0 0 0 1.5px rgba(168,85,255,0.3)",
                position: "relative", display: "inline-block",
                transition: "background 0.18s",
              }}
            >
              <span style={{
                position: "absolute", top: 3,
                left: chatEnabled ? 21 : 3,
                width: 16, height: 16, borderRadius: "50%",
                background: chatEnabled ? "#fff" : "rgba(196,168,255,0.45)",
                boxShadow: chatEnabled ? "0 1px 3px rgba(0,0,0,0.35)" : "none",
                transition: "left 0.18s, background 0.18s",
              }} />
            </span>
          </button>
        </div>
        {toggleError && (
          <div style={{ flexShrink: 0, padding: "6px 16px", borderBottom: DIV }}>
            <span style={{ fontSize: 11, color: "#f87171", fontWeight: 600, fontFamily: FONT }}>{toggleError}</span>
          </div>
        )}

        <div className="lcp-chat" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
          {messages.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: "100%", gap: 8, color: "rgba(255,255,255,0.15)", textAlign: "center", padding: 20,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span style={{ fontSize: 12 }}>
                {liveStatus === "live" ? "Esperando mensajes..." : "Sin mensajes aún"}
              </span>
            </div>
          ) : (
            messages.map((msg) => (
              <ChatMessageRow
                key={msg.id}
                msg={msg}
                isMuted={liveData?.mutedUsers?.includes(msg.userId) ?? false}
                isBanned={liveData?.bannedUsers?.includes(msg.userId) ?? false}
                onMute={() => handleMuteToggle(msg.userId)}
                onBan={() => handleBanToggle(msg.userId)}
                onDelete={() => handleDeleteMessage(msg.id)}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
    );
  }

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 10001,
      background: "#0a0a0a", display: "flex", flexDirection: "column", fontFamily: FONT,
    }}>
      <style>{`
        @keyframes lcPulse { 0%,100%{opacity:1}50%{opacity:0.35} }
        .lcp-chat::-webkit-scrollbar{display:none}
        @keyframes scOverlayFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes scOverlaySlideUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* SC Playback Overlay */}
      {playingOverlay && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10002,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.6)",
          animation: "scOverlayFadeIn 0.2s ease",
        }}>
          <div style={{
            width: "min(420px, 90vw)",
            background: "#0a0a0a",
            borderRadius: 18,
            boxShadow: "0 32px 64px rgba(0,0,0,0.9)",
            padding: "16px",
            position: "relative",
            animation: "scOverlaySlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          }}>
            {/* Tache cierre */}
            <button
              type="button"
              onClick={handleCloseSCOverlay}
              style={{
                position: "absolute", top: 10, right: 10,
                border: "none", background: "none", color: "rgba(255,255,255,0.7)",
                cursor: "pointer", padding: 4, display: "grid", placeItems: "center",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {/* Fila 1: avatar + nombre + monto */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, paddingRight: 24 }}>
              <ScAvatar url={playingOverlay.avatarUrl} name={playingOverlay.username} ringColor={playingOverlay.color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: FONT }}>
                    {playingOverlay.username}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#86efac", fontFamily: FONT }}>
                    +${(playingOverlay.amount * 0.77).toFixed(2)} MXN
                  </span>
                </div>
              </div>
            </div>
            {/* Fila 2: texto — 3 líneas visibles, scroll + negritas progresivas */}
            <div ref={scTextContainerRef} style={{
              fontSize: 12, lineHeight: 1.55, color: "#fff", fontFamily: FONT,
              maxHeight: `${3 * 12 * 1.55}px`, overflowY: "auto", scrollbarWidth: "none",
              wordBreak: "break-word", marginBottom: 12,
            }}>
              {playingOverlay.text ? (
                <>
                  <strong>{playingOverlay.text.slice(0, ttsReadIndex)}</strong>
                  <span ref={scBoundaryRef} />
                  {playingOverlay.text.slice(ttsReadIndex)}
                </>
              ) : (
                <span style={{ color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>Donación ${playingOverlay.amount.toFixed(2)} MXN</span>
              )}
            </div>
            {/* Botones */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              {/* Izquierda: Detener + Reproducir de nuevo */}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={handleStopForAll}
                  style={{
                    padding: "9px 12px", borderRadius: 9, border: "none",
                    background: "#f87171", color: "#fff",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
                  }}
                >
                  Detener
                </button>
                <button
                  type="button"
                  onClick={handleReplaySCFromOverlay}
                  style={{
                    padding: "9px 12px", borderRadius: 9, border: "none",
                    background: "#a855f7", color: "#fff",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
                  }}
                >
                  Repetir
                </button>
              </div>
              {/* Derecha: Siguiente */}
              <button
                type="button"
                onClick={handleNextSCOverlay}
                style={{
                  padding: "9px 18px", borderRadius: 9, border: "none",
                  background: "linear-gradient(135deg, #a855f7, #f72fbe)", color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
                }}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header — se oculta en desktop (va dentro de la card de cámara) */}
      {!isDesktop && <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
        paddingBottom: 14,
        paddingLeft: "max(16px, env(safe-area-inset-left))",
        paddingRight: "max(16px, env(safe-area-inset-right))",
        borderBottom: DIV,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <button
              type="button"
              onClick={isBroadcasting ? undefined : handlePanelClose}
              disabled={isBroadcasting}
              title={isBroadcasting ? "Detén la transmisión antes de salir" : "Cerrar"}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                border: isBroadcasting ? "1px solid rgba(239,68,68,0.4)" : "none",
                background: isBroadcasting ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.08)",
                color: isBroadcasting ? "rgba(239,68,68,0.5)" : "#fff",
                cursor: isBroadcasting ? "not-allowed" : "pointer",
                display: "grid", placeItems: "center",
              }}
              aria-label={isBroadcasting ? "Detén la transmisión antes de salir" : "Cerrar"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1 }}>Centro de control</span>
            {isBroadcasting && (
              <span style={{ fontSize: 10, color: "rgba(239,68,68,0.75)", fontWeight: 500, lineHeight: 1 }}>
                Detén la transmisión para salir
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isEnded && !isCFStream ? (
            <button
              type="button"
              onClick={() => setEndPanelOpen(true)}
              style={{
                height: 26, padding: "0 10px", borderRadius: 7, border: "none",
                background: "linear-gradient(135deg, #a855f7 0%, #d946b8 100%)", color: "#fff", fontWeight: 600,
                fontSize: 11, fontFamily: FONT, cursor: "pointer",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              Gestionar resumen de la transmisión
            </button>
          ) : !isEnded && broadcastMode === "rtmp" && liveData?.liveStreamId && (
            <button
              type="button"
              onClick={() => setLiveSetupOpen(true)}
              style={{
                height: 26, padding: "0 10px", borderRadius: 7, border: "none",
                background: "#60a5fa", color: "#fff", fontWeight: 600,
                fontSize: 11, fontFamily: FONT, cursor: "pointer",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              Ver Key y URL de transmisión
            </button>
          )}
          {liveStatus !== "live" && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px",
              borderRadius: 7, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.45)",
              border: "1px solid rgba(255,255,255,0.1)",
              backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            }}>
              {liveStatus ? (STATUS_LABELS[liveStatus] ?? liveStatus) : "—"}
            </div>
          )}
        </div>
      </div>}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {isDesktop ? (
        /* ── Desktop — 4 cards flotantes (horizontal y vertical) ────────── */
        <div style={{
          flex: 1, overflow: "hidden",
          display: "flex", flexDirection: "column",
          padding: 12, gap: 10,
        }}>

          {/* Fila superior: 3 cards en fila */}
          <div style={{ flex: 2, display: "flex", gap: 10, minHeight: 0 }}>

            {/* Card 1: Cámara / Video */}
            <div style={{
              flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
              background: "#0d0d12", borderRadius: 18,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 24px 48px rgba(0,0,0,0.8)",
            }}>
              {/* Header de la card: botón salir + Centro de control + badge EN VIVO */}
              <div style={{
                flexShrink: 0, display: "flex", alignItems: "center",
                gap: 10, padding: "10px 14px", borderBottom: DIV,
              }}>
                <button
                  type="button"
                  onClick={isBroadcasting ? undefined : handlePanelClose}
                  disabled={isBroadcasting}
                  title={isBroadcasting ? "Detén la transmisión antes de salir" : "Cerrar"}
                  style={{
                    width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                    border: isBroadcasting ? "1px solid rgba(168,85,255,0.4)" : "none",
                    background: isBroadcasting ? "rgba(168,85,255,0.1)" : "rgba(255,255,255,0.08)",
                    color: isBroadcasting ? "rgba(168,85,255,0.6)" : "#fff",
                    cursor: isBroadcasting ? "not-allowed" : "pointer",
                    display: "grid", placeItems: "center",
                  }}
                  aria-label={isBroadcasting ? "Detén la transmisión antes de salir" : "Cerrar"}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                  </svg>
                </button>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1, fontFamily: FONT }}>Centro de control</span>
                  {isBroadcasting && (
                    <span style={{ fontSize: 10, color: "rgba(168,85,255,0.75)", fontWeight: 500, lineHeight: 1 }}>
                      Detén la transmisión para salir
                    </span>
                  )}
                </div>
                {isEnded && !isCFStream ? (
                  <button
                    type="button"
                    onClick={() => setEndPanelOpen(true)}
                    style={{
                      height: 26, padding: "0 10px", borderRadius: 7, border: "none",
                      background: "linear-gradient(135deg, #a855f7 0%, #d946b8 100%)", color: "#fff", fontWeight: 600,
                      fontSize: 11, fontFamily: FONT, cursor: "pointer",
                      whiteSpace: "nowrap", flexShrink: 0,
                    }}
                  >
                    Gestionar resumen de la transmisión
                  </button>
                ) : !isEnded && broadcastMode === "rtmp" && liveData?.liveStreamId && (
                  <button
                    type="button"
                    onClick={() => setLiveSetupOpen(true)}
                    style={{
                      height: 26, padding: "0 10px", borderRadius: 7, border: "none",
                      background: "#60a5fa", color: "#fff", fontWeight: 600,
                      fontSize: 11, fontFamily: FONT, cursor: "pointer",
                      whiteSpace: "nowrap", flexShrink: 0,
                    }}
                  >
                    Ver Key y URL de transmisión
                  </button>
                )}
              </div>
              <div style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0, background: "#000", margin: "0 10px 10px", borderRadius: 12 }}>
                {layoutPortrait && (showDirectBroadcast || showVideo) ? (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ position: "relative", height: "100%", aspectRatio: "9 / 16", overflow: "hidden", borderRadius: 10 }}>
                      {showDirectBroadcast ? (
                        <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} onHeadphonesChange={setHeadphonesDetected} micMutedForTTS={micMutedForTTS} />
                      ) : isEnded ? (
                        <VideoPreview hlsUrl={hlsUrl!} fill showLiveBadge={false} autoPlay={false} />
                      ) : (
                        <MuxLivePlaceholder />
                      )}
                    </div>
                  </div>
                ) : showDirectBroadcast ? (
                  <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} onHeadphonesChange={setHeadphonesDetected} micMutedForTTS={micMutedForTTS} />
                ) : showVideo ? (
                  <>
                    {isEnded ? (
                      <VideoPreview hlsUrl={hlsUrl!} fill objectFit="contain" showLiveBadge={false} autoPlay={false} />
                    ) : (
                      <MuxLivePlaceholder />
                    )}
                  </>
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontFamily: FONT }}>Sin transmisión activa</span>
                  </div>
                )}
                {liveStatus === "live" && isBroadcasting && (
                  <div style={{
                    position: "absolute", top: 10, left: 10, zIndex: 10,
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "rgba(239,68,68,0.88)",
                    borderRadius: 7, padding: "5px 11px 5px 8px",
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#fff",
                    backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
                    fontFamily: FONT,
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", flexShrink: 0, animation: "lcPulse 1.4s ease-in-out infinite" }} />
                    EN VIVO
                  </div>
                )}
              </div>
            </div>

            {/* Card 2: Chat live */}
            <div style={{
              flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
              background: "#0d0d12", borderRadius: 18,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 24px 48px rgba(0,0,0,0.8)",
            }}>
              {renderChatSection()}
            </div>

            {/* Card 3: Supercomentarios */}
            <div style={{
              flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
              background: "#0d0d12", borderRadius: 18,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 24px 48px rgba(0,0,0,0.8)",
            }}>
              {sectionHeader("Supercomentarios")}
              {renderSuperCommentsSection()}
            </div>
          </div>

          {/* Card 4: Estadísticas — fila inferior, ancho completo */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
            background: "#0d0d12", borderRadius: 18,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 24px 48px rgba(0,0,0,0.8)",
          }}>
            {sectionHeader("Estadísticas")}
            {renderStatsSection()}
          </div>
        </div>

      ) : !isDesktop && !layoutPortrait ? (
        /* ── Mobile + Horizontal live ─────────────────────────────────────── */
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* Video — debajo del header que ya respeta safe-area-top */}
          {(showVideo || showDirectBroadcast) && (
            <div style={{
              flexShrink: 0, width: "100%", height: "38%",
              position: "relative", background: "#000", overflow: "hidden",
            }}>
              {showDirectBroadcast ? (
                <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} onHeadphonesChange={setHeadphonesDetected} micMutedForTTS={micMutedForTTS} />
              ) : isEnded ? (
                <VideoPreview hlsUrl={hlsUrl!} fill objectFit="contain" showLiveBadge={false} autoPlay={false} />
              ) : (
                <MuxLivePlaceholder />
              )}
            </div>
          )}

          {/* Chat en vivo — ocupa la mitad superior del espacio restante */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderBottom: DIV }}>
            {renderChatSection()}
          </div>

          {/* Tabs: Supercomentarios | Estadísticas — mitad inferior */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

            {/* Tab bar */}
            <div style={{
              flexShrink: 0, display: "flex",
              borderBottom: DIV,
              padding: "0 4px",
            }}>
              {(["supercomentarios", "estadisticas"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMobileTab(tab)}
                  style={{
                    flex: 1, padding: "10px 4px",
                    border: "none", background: "transparent",
                    color: mobileTab === tab ? "#fff" : "rgba(255,255,255,0.3)",
                    fontSize: 11, fontWeight: 700, fontFamily: FONT,
                    cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase",
                    borderBottom: mobileTab === tab ? "2px solid #fff" : "2px solid transparent",
                    marginBottom: -1,
                    transition: "color 0.15s",
                  }}
                >
                  {tab === "supercomentarios" ? "Supercomentarios" : "Estadísticas"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {mobileTab === "estadisticas" ? renderStatsSection() : renderSuperCommentsSection()}
            </div>
          </div>
        </div>

      ) : !isDesktop && layoutPortrait ? (
        /* ── Mobile + Portrait live: video miniatura + panel drawer ─────── */
        <div ref={bodyContainerRef} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* Miniatura de video — se encoge/crece según posición del panel */}
          <div
            ref={videoAreaRef}
            style={{
              height: `${(1 - panelRatio) * 100}%`,
              flexShrink: 0, overflow: "hidden",
              background: "#000",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {showDirectBroadcast ? (
              <div style={{ height: "100%", aspectRatio: "9/16", position: "relative", overflow: "hidden" }}>
                <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} onHeadphonesChange={setHeadphonesDetected} micMutedForTTS={micMutedForTTS} />
              </div>
            ) : showVideo ? (
              <div style={{ width: "100%", height: "100%", position: "relative" }}>
                {isEnded ? (
                  <VideoPreview hlsUrl={hlsUrl!} fill objectFit="contain" showLiveBadge={false} autoPlay={false} />
                ) : (
                  <MuxLivePlaceholder />
                )}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontFamily: FONT }}>Sin transmisión activa</span>
            )}
          </div>

          {/* Panel drawer — deslizable con handle en la parte superior */}
          <div
            ref={panelDragRef}
            style={{
              height: `${panelRatio * 100}%`, flexShrink: 0,
              display: "flex", flexDirection: "column", overflow: "hidden",
              borderRadius: "16px 16px 0 0",
              background: "#0a0a0a",
              borderTop: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {/* Handle de arrastre — solo onTouchStart, el move/end van a document */}
            <div
              onTouchStart={onPanelTouchStart}
              style={{
                flexShrink: 0, paddingTop: 10, paddingBottom: 10,
                display: "flex", justifyContent: "center", alignItems: "center",
                touchAction: "none", cursor: "grab",
                borderBottom: DIV,
              }}
            >
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.3)" }} />
            </div>

            {/* Chat en vivo */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderBottom: DIV }}>
              {renderChatSection()}
            </div>

            {/* Tabs: Supercomentarios | Estadísticas */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
              <div style={{ flexShrink: 0, display: "flex", padding: "0 4px", borderBottom: DIV }}>
                {(["supercomentarios", "estadisticas"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMobileTab(tab)}
                    style={{
                      flex: 1, padding: "10px 4px",
                      border: "none", background: "transparent",
                      color: mobileTab === tab ? "#fff" : "rgba(255,255,255,0.3)",
                      fontSize: 11, fontWeight: 700, fontFamily: FONT,
                      cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase",
                      borderBottom: mobileTab === tab ? "2px solid #fff" : "2px solid transparent",
                      marginBottom: -1, transition: "color 0.15s",
                    }}
                  >
                    {tab === "supercomentarios" ? "Supercomentarios" : "Estadísticas"}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {mobileTab === "estadisticas" ? renderStatsSection() : renderSuperCommentsSection()}
              </div>
            </div>
          </div>
        </div>

      ) : (
        /* ── Fallback: mobile portrait (próximamente) ─────────────────────── */
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {(showVideo || showDirectBroadcast) && (
            <div style={{ flexShrink: 0, background: "#000", position: "relative" }}>
              {showDirectBroadcast ? (
                <div style={{ width: "100%", aspectRatio: "9/16", position: "relative" }}>
                  <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} onHeadphonesChange={setHeadphonesDetected} micMutedForTTS={micMutedForTTS} />
                </div>
              ) : (
                <>
                  <VideoPreview hlsUrl={hlsUrl!} showLiveBadge={liveStatus === "live"} autoPlay={!isEnded} />
                </>
              )}
            </div>
          )}
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: DIV }}>
              {renderChatSection()}
            </div>
            <div style={{ width: "clamp(150px, 38%, 240px)", flexShrink: 0, display: "flex", flexDirection: "column" }}>
              {sectionHeader("Control")}
              {comingSoon()}
            </div>
          </div>
        </div>
      )}
      {broadcastMode === "rtmp" && liveData?.liveStreamId && (
        <LiveStreamSetup
          open={liveSetupOpen}
          onClose={() => setLiveSetupOpen(false)}
          postId={post.id}
          liveStreamId={liveData.liveStreamId}
          broadcastMode="rtmp"
          onOpenCreatorPanel={() => setLiveSetupOpen(false)}
        />
      )}
      <SuperCommentConfigPanel
        open={scConfigOpen}
        onClose={() => setScConfigOpen(false)}
        postId={post.id}
      />
      <LiveEndSummaryPanel
        open={endPanelOpen}
        onClose={() => setEndPanelOpen(false)}
        post={post}
      />
    </div>,
    document.body
  );
}

// ── ChatMessageRow ─────────────────────────────────────────────────────────

type MessageRowProps = {
  msg: LiveChatMessage;
  isMuted: boolean;
  isBanned: boolean;
  onMute: () => void;
  onBan: () => void;
  onDelete: () => void;
};

function ChatMessageRow({ msg, isMuted, isBanned, onMute, onBan, onDelete }: MessageRowProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)",
      opacity: isBanned ? 0.38 : 1,
    }}>
      {msg.avatarUrl ? (
        <Image src={msg.avatarUrl} alt="" width={26} height={26} style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 26, height: 26, borderRadius: "50%", background: "rgba(168,85,247,0.35)",
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{msg.username.charAt(0).toUpperCase()}</span>
        </div>
      )}

      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.4, color: "rgba(255,255,255,0.85)", wordBreak: "break-word", fontFamily: FONT }}>
        <strong style={{ fontWeight: 700, color: "#fff", marginRight: 5, whiteSpace: "nowrap" }}>{msg.username}</strong>
        {isMuted && !isBanned && (
          <span style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 3, padding: "0px 4px", marginRight: 4 }}>MUTE</span>
        )}
        {isBanned && (
          <span style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 3, padding: "0px 4px", marginRight: 4 }}>BAN</span>
        )}
        {msg.text}
      </span>

      <div style={{ display: "flex", gap: 2, flexShrink: 0, alignItems: "flex-start", marginTop: 1 }}>
        <ModActionBtn onClick={onMute} active={isMuted} activeColor="#f59e0b" title={isMuted ? "Desmutear" : "Mutear"}>
          {isMuted ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </ModActionBtn>

        <ModActionBtn onClick={onBan} active={isBanned} activeColor="#ef4444" title={isBanned ? "Desbanear" : "Banear del live"}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </ModActionBtn>

        <ModActionBtn onClick={onDelete} active={false} activeColor="#ef4444" title="Eliminar mensaje">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" /><path d="M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
        </ModActionBtn>
      </div>
    </div>
  );
}

function ScAvatar({ url, name, ringColor }: { url?: string | null; name: string; ringColor?: string }) {
  const SIZE = 36;
  const INSET = ringColor ? 3 : 0;
  const RING = 2;
  return (
    <div style={{ position: "relative", width: SIZE, height: SIZE, flexShrink: 0 }}>
      {url ? (
        <div style={{ position: "absolute", inset: INSET, borderRadius: "50%", overflow: "hidden" }}>
          <Image src={url} alt="" fill style={{ objectFit: "cover" }} />
        </div>
      ) : (
        <div style={{ position: "absolute", inset: INSET, borderRadius: "50%", background: "rgba(168,85,247,0.5)", display: "grid", placeItems: "center" }}>
          <span style={{ fontSize: 15, color: "#fff", fontFamily: FONT, fontWeight: 700 }}>{name.charAt(0).toUpperCase()}</span>
        </div>
      )}
      {ringColor && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: ringColor,
          WebkitMaskImage: `radial-gradient(farthest-side, transparent calc(100% - ${RING}px), white calc(100% - ${RING}px))`,
          maskImage: `radial-gradient(farthest-side, transparent calc(100% - ${RING}px), white calc(100% - ${RING}px))`,
        }} />
      )}
    </div>
  );
}

function ModActionBtn({
  onClick, active, activeColor, title, children,
}: {
  onClick: () => void;
  active: boolean;
  activeColor: string;
  title: string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 24, height: 24, borderRadius: 5, border: "none",
        background: active ? `${activeColor}22` : hovered ? "rgba(255,255,255,0.08)" : "transparent",
        color: active ? activeColor : hovered ? "#fff" : "rgba(255,255,255,0.22)",
        cursor: "pointer", display: "grid", placeItems: "center",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {children}
    </button>
  );
}

// ── MuxLivePlaceholder ────────────────────────────────────────────────────
// Muestra mientras el creador transmite vía software externo (OBS/RTMP).
// No intenta reproducir HLS — evita el freeze permanente del VideoPreview.

function MuxLivePlaceholder() {
  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 14, background: "#000",
    }}>
      <style>{`@keyframes muxSpinRing{to{transform:rotate(360deg)}}`}</style>
      <div style={{
        width: 38, height: 38,
        border: "3px solid rgba(168,85,247,0.18)",
        borderTopColor: "#a855f7",
        borderRadius: "50%",
        animation: "muxSpinRing 0.9s linear infinite",
        flexShrink: 0,
      }} />
      <span style={{
        fontSize: 11, fontWeight: 500,
        color: "rgba(255,255,255,0.3)",
        fontFamily: FONT, textAlign: "center",
        maxWidth: 180, lineHeight: 1.5,
      }}>
        Transmitiendo a través de software externo
      </span>
    </div>
  );
}

// ── VideoPreview ───────────────────────────────────────────────────────────
// memo: evita re-renders por cambios de estado del panel (chat, viewers, etc.)

const VOD_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const VideoPreview = memo(function VideoPreview({ hlsUrl, fill, objectFit = "cover", showLiveBadge, autoPlay = true }: { hlsUrl: string; fill?: boolean; objectFit?: "cover" | "contain"; showLiveBadge?: boolean; autoPlay?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [muted, setMuted] = useState(true);

  // ── VOD controls (cuando autoPlay=false → el live ya terminó) ─────────────
  const isVod = !autoPlay;
  const [vodMuted, setVodMuted] = useState(false);
  const [vodPlaying, setVodPlaying] = useState(false);
  const [vodDuration, setVodDuration] = useState(0);
  const [vodCurrentTime, setVodCurrentTime] = useState(0);
  const [vodPlaybackRate, setVodPlaybackRate] = useState(1);
  const [vodControlsVisible, setVodControlsVisible] = useState(true);
  const scrubberRef = useRef<HTMLInputElement>(null);
  const isDraggingRef = useRef(false);
  const vodTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  function fmtTime(sec: number) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function scheduleHide() {
    if (vodTimerRef.current !== null) window.clearTimeout(vodTimerRef.current);
    vodTimerRef.current = window.setTimeout(() => setVodControlsVisible(false), 3500);
  }

  function clearHideTimer() {
    if (vodTimerRef.current !== null) { window.clearTimeout(vodTimerRef.current); vodTimerRef.current = null; }
  }

  // RAF: actualiza scrubber y tiempo sin re-renders de React
  useEffect(() => {
    if (!isVod) return;
    function tick() {
      const v = videoRef.current;
      const el = scrubberRef.current;
      if (v && el && !isDraggingRef.current) {
        const cur = isFinite(v.currentTime) ? v.currentTime : 0;
        const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        el.value = String(cur);
        if (dur > 0) el.max = String(dur);
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        el.style.setProperty("--pct", `${pct}%`);
        setVodCurrentTime(cur);
        if (dur > 0) setVodDuration(dur);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [isVod]);

  // Sync play/pause state
  useEffect(() => {
    if (!isVod) return;
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setVodPlaying(true);
    const onPause = () => setVodPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => { v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause); };
  }, [isVod]);

  // Sync playback rate
  useEffect(() => {
    if (!isVod) return;
    const v = videoRef.current;
    if (v) v.playbackRate = vodPlaybackRate;
  }, [vodPlaybackRate, isVod]);

  function jumpToLive() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video.seekable.length > 0) {
        const end = video.seekable.end(video.seekable.length - 1);
        if (Number.isFinite(end)) video.currentTime = end;
      }
    } catch {}
    if (hlsRef.current) hlsRef.current.startLoad();
    video.play().catch(() => {});
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      if (autoPlay) {
        video.play().catch(() => {});
      } else {
        // VOD en Safari/iOS: mostrar primer frame sin sonido
        video.addEventListener("loadeddata", () => {
          video.currentTime = 0;
        }, { once: true });
      }
      return;
    }

    if (!Hls.isSupported()) return;

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      startLevel: -1,
      autoStartLoad: true,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      liveDurationInfinity: true,
      fragLoadingMaxRetry: 6,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
      backBufferLength: 3600,
    });
    hlsRef.current = hls;
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (autoPlay) {
        video.play().catch(() => {});
      } else {
        // VOD: play silencioso → pause para pintar primer frame
        const wasMuted = video.muted;
        video.muted = true;
        video.play()
          .then(() => { video.pause(); video.currentTime = 0; video.muted = wasMuted; })
          .catch(() => {});
      }
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          hls.destroy();
          hlsRef.current = null;
        }
      } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
        video.play().catch(() => {});
      }
    });

    return () => { hls.destroy(); hlsRef.current = null; };
  }, [hlsUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const muteBtn = (size: number, bottom: number, right: number, bordered: boolean) => (
    <button
      type="button"
      onClick={() => setMuted((m) => !m)}
      title={muted ? "Activar audio" : "Silenciar"}
      style={{
        position: "absolute", bottom, right,
        width: bordered ? 32 : 28, height: bordered ? 32 : 28, borderRadius: "50%",
        border: bordered ? "1px solid rgba(255,255,255,0.18)" : "none",
        background: "rgba(0,0,0,0.55)",
        color: "#fff", cursor: "pointer", display: "grid", placeItems: "center",
        backdropFilter: bordered ? "blur(4px)" : undefined,
        WebkitBackdropFilter: bordered ? "blur(4px)" : undefined,
      }}
    >
      {muted ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );

  const liveBadge = showLiveBadge ? (
    <>
      <style>{`@keyframes vpLivePulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
      <button
        type="button"
        onClick={jumpToLive}
        aria-label="Ir al momento actual del live"
        style={{
          position: "absolute",
          bottom: "max(14px, env(safe-area-inset-bottom))",
          right: "max(14px, env(safe-area-inset-right))",
          zIndex: 10,
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(239,68,68,0.88)",
          borderRadius: 7, border: "none",
          padding: "5px 11px 5px 8px",
          fontFamily: "inherit", fontSize: 11, fontWeight: 700,
          letterSpacing: "0.06em", color: "#fff",
          backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
          cursor: "pointer",
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: "#fff", flexShrink: 0,
          animation: "vpLivePulse 1.4s ease-in-out infinite",
          display: "inline-block",
        }} />
        EN VIVO
      </button>
    </>
  ) : null;

  // ── Controles VOD custom (reemplaza los nativos del browser) ──────────────
  function renderVodControls() {
    if (!isVod) return null;

    const btnBase: CSSProperties = {
      background: "none", border: "none", color: "#fff",
      cursor: "pointer", padding: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      WebkitTapHighlightColor: "transparent",
      outline: "none", pointerEvents: "auto",
    };

    const handlePlayPause = () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) { v.play().catch(() => {}); setVodPlaying(true); }
      else { v.pause(); setVodPlaying(false); }
      scheduleHide();
    };

    const handleSkip = (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : vodDuration;
      v.currentTime = Math.max(0, Math.min(dur, v.currentTime + delta));
      setVodControlsVisible(true);
      scheduleHide();
    };

    const handleSpeedCycle = () => {
      const idx = VOD_PLAYBACK_RATES.indexOf(vodPlaybackRate);
      setVodPlaybackRate(VOD_PLAYBACK_RATES[(idx + 1) % VOD_PLAYBACK_RATES.length]);
      scheduleHide();
    };

    return (
      <>
        <style>{`
          .vp-vod-range{-webkit-appearance:none;appearance:none;width:100%;height:4px;background:rgba(255,255,255,0.28);border-radius:2px;outline:none;cursor:pointer;display:block}
          .vp-vod-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;cursor:pointer;margin-top:-5px}
          .vp-vod-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;cursor:pointer;border:none}
          .vp-vod-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,#fff var(--pct,0%),rgba(255,255,255,0.28) var(--pct,0%))}
          .vp-vod-range::-moz-range-track{height:4px;border-radius:2px;background:rgba(255,255,255,0.28)}
          .vp-vod-range::-moz-range-progress{height:4px;border-radius:2px;background:#fff}
          .vp-vod-btn{outline:none!important;box-shadow:none!important;-webkit-tap-highlight-color:transparent}
          .vp-vod-btn:focus,.vp-vod-btn:focus-visible,.vp-vod-btn:active{outline:none!important;box-shadow:none!important}
        `}</style>

        {/* Tap area para mostrar/ocultar controles */}
        <div
          onClick={() => {
            if (vodControlsVisible) { clearHideTimer(); setVodControlsVisible(false); }
            else { setVodControlsVisible(true); scheduleHide(); }
          }}
          style={{ position: "absolute", inset: 0, zIndex: 6, cursor: "pointer" }}
        />

        {/* Overlay de controles */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 7,
          opacity: vodControlsVisible ? 1 : 0,
          transition: "opacity 0.3s ease",
          pointerEvents: "none",
        }}>
          {/* Gradiente bottom */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 110,
            background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
            pointerEvents: "none",
          }} />

          {/* Mute — esquina superior derecha, respeta safe area */}
          <button type="button" className="vp-vod-btn"
            onClick={(e) => {
              e.stopPropagation();
              const v = videoRef.current;
              const next = !vodMuted;
              setVodMuted(next);
              if (v) v.muted = next;
              scheduleHide();
            }}
            style={{
              ...btnBase,
              position: "absolute",
              top: "max(14px, env(safe-area-inset-top))",
              right: "max(14px, env(safe-area-inset-right))",
              pointerEvents: "auto",
            }}>
            {vodMuted ? (
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>

          {/* Centro: skip -10 · play/pause · skip +10 */}
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 32, pointerEvents: "none",
          }}>
            <button type="button" className="vp-vod-btn"
              onClick={(e) => { e.stopPropagation(); handleSkip(-10); }}
              style={{ ...btnBase, pointerEvents: "auto" }}>
              <VideoSkipBackIcon size={32} color="#fff" />
            </button>
            <button type="button" className="vp-vod-btn"
              onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
              style={{ ...btnBase, pointerEvents: "auto" }}>
              {vodPlaying
                ? <VideoPauseIcon size={38} color="#fff" />
                : <VideoPlayIcon size={38} color="#fff" />}
            </button>
            <button type="button" className="vp-vod-btn"
              onClick={(e) => { e.stopPropagation(); handleSkip(10); }}
              style={{ ...btnBase, pointerEvents: "auto" }}>
              <VideoSkipForwardIcon size={32} color="#fff" />
            </button>
          </div>

          {/* Bottom bar: tiempo + scrubber + velocidad — respeta safe area */}
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0, right: 0,
            padding: "0 14px",
            paddingBottom: "max(14px, env(safe-area-inset-bottom))",
            paddingLeft: "max(14px, env(safe-area-inset-left))",
            paddingRight: "max(14px, env(safe-area-inset-right))",
            pointerEvents: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span style={{
                color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 600,
                fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
              }}>
                {fmtTime(vodCurrentTime)}
                {vodDuration > 0 && <span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 400 }}> / {fmtTime(vodDuration)}</span>}
              </span>
              <button type="button" className="vp-vod-btn"
                onClick={(e) => { e.stopPropagation(); handleSpeedCycle(); }}
                style={{ ...btnBase, fontSize: 16, fontWeight: 700, lineHeight: 1, pointerEvents: "auto" }}>
                ×{vodPlaybackRate}
              </button>
            </div>
            <input
              ref={scrubberRef}
              type="range"
              className="vp-vod-range"
              min={0}
              max={vodDuration > 0 ? vodDuration : 100}
              step="any"
              defaultValue={0}
              onInput={(e) => {
                const v = videoRef.current;
                if (v) v.currentTime = Number((e.target as HTMLInputElement).value);
              }}
              onMouseDown={(e) => { e.stopPropagation(); isDraggingRef.current = true; clearHideTimer(); }}
              onMouseUp={() => { isDraggingRef.current = false; scheduleHide(); }}
              onTouchStart={(e) => { e.stopPropagation(); isDraggingRef.current = true; clearHideTimer(); }}
              onTouchEnd={(e) => { e.stopPropagation(); isDraggingRef.current = false; scheduleHide(); }}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </>
    );
  }

  // fill mode: parent provides container size
  if (fill) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <video
          ref={videoRef}
          autoPlay={autoPlay} muted={autoPlay ? muted : vodMuted} playsInline
          style={{ width: "100%", height: "100%", objectFit: objectFit, display: "block" }}
        />
        {autoPlay && muteBtn(13, 12, 12, true)}
        {autoPlay && liveBadge}
        {renderVodControls()}
      </div>
    );
  }

  // compact mode: self-contained with aspectRatio 16/9
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", maxHeight: 220, background: "#000", overflow: "hidden" }}>
      <video
        ref={videoRef}
        autoPlay={autoPlay} muted={autoPlay ? muted : vodMuted} playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
      {autoPlay && muteBtn(13, 8, 8, false)}
      {autoPlay && liveBadge}
      {renderVodControls()}
    </div>
  );
});
