"use client";

// Sub-componentes, tipos y constantes de LiveCreatorPanel, aislados a nivel de módulo.

import Image from "next/image";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, memo, type CSSProperties } from "react";
import Hls from "hls.js";
import { getAuth } from "firebase/auth";
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
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import {
  subscribeToViewerCount,
  updatePeakViewers,
  subscribeToUniqueViewerCount,
  subscribeToAverageWatchTime,
  subscribeToNewFollowersDuringLive,
  subscribeToVodViewCount,
  fetchViewerHistory,
} from "@/lib/liveKit/liveViewers";
import { playEdgeTTS, TTS_MIN_DURATION_SECS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import { subscribeToTicketRevenue } from "@/lib/liveAccess/live-access-service";
import { subscribeToVodRevenue } from "@/lib/posts/post-access-service";
import { subscribeToPeakRevenue, updatePeakRevenueIfRecord } from "@/lib/liveCreator/creator-stats-service";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

export const FONT = 'inherit';
export const DIV = "1px solid rgba(255,255,255,0.12)";

export const STATUS_LABEL_KEYS: Record<string, string> = {
  draft: "statusDraft",
  scheduled: "statusScheduled",
  upcoming: "statusUpcoming",
  live: "statusLive",
  ended: "statusEnded",
  cancelled: "statusCancelled",
  error: "statusError",
};

export type Props = {
  open: boolean;
  onClose: () => void;
  post: Post;
  portrait?: boolean;
};

export function OBSBrowserSourceBanner({ postId }: { postId: string }) {
  const tLive = useTranslations("live");
  const [copied, setCopied] = useState(false);
  // El token autentica las llamadas de OBS a /api/live-overlay-ready. Solo el
  // autor del live puede pedirlo, así que la URL se arma en el servidor.
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = await getAuth().currentUser?.getIdToken();
        if (!idToken) return;
        const res = await fetch(`/api/live-overlay-url?postId=${encodeURIComponent(postId)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.token === "string") setToken(data.token);
      } catch { /* la URL se muestra sin token; OBS caerá al fallback de 1.5s */ }
    })();
    return () => { cancelled = true; };
  }, [postId]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/live-overlay.html?postId=${postId}${token ? `&t=${token}` : ""}`;

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
          {copied ? tLive("copied") : tLive("copy")}
        </button>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 5 }}>
        En OBS: Añadir → Fuente de navegador · 700×160 · ✅ Permitir transparencia · Posiciona libremente en tu escena
      </div>
    </div>
  );
}


export type MessageRowProps = {
  msg: LiveChatMessage;
  isMuted: boolean;
  isBanned: boolean;
  onMute: () => void;
  onBan: () => void;
  onDelete: () => void;
};

export function ChatMessageRow({ msg, isMuted, isBanned, onMute, onBan, onDelete }: MessageRowProps) {
  const tLive = useTranslations("live");
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
        <strong style={{ fontWeight: 500, letterSpacing: "-0.02em", color: "#fff", marginInlineEnd: 5, whiteSpace: "nowrap" }}>{msg.username}</strong>
        {isMuted && !isBanned && (
          <span style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 3, padding: "0px 4px", marginInlineEnd: 4 }}>MUTE</span>
        )}
        {isBanned && (
          <span style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 3, padding: "0px 4px", marginInlineEnd: 4 }}>BAN</span>
        )}
        {msg.text}
      </span>

      <div style={{ display: "flex", gap: 2, flexShrink: 0, alignItems: "flex-start", marginTop: 1 }}>
        <ModActionBtn onClick={onMute} active={isMuted} activeColor="#f59e0b" title={isMuted ? tLive("unmute") : tLive("mute")}>
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

        <ModActionBtn onClick={onBan} active={isBanned} activeColor="#ef4444" title={isBanned ? tLive("unban") : tLive("banFromLive")}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </ModActionBtn>

        <ModActionBtn onClick={onDelete} active={false} activeColor="#ef4444" title={tLive("deleteMessage")}>
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

export function ScAvatar({ url, name, ringColor }: { url?: string | null; name: string; ringColor?: string }) {
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

export function ModActionBtn({
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

export function MuxLivePlaceholder() {
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

export const VOD_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const VideoPreview = memo(function VideoPreview({ hlsUrl, fill, objectFit = "cover", showLiveBadge, autoPlay = true }: { hlsUrl: string; fill?: boolean; objectFit?: "cover" | "contain"; showLiveBadge?: boolean; autoPlay?: boolean }) {
  const tCommon = useTranslations("common");
  const tLive = useTranslations("live");
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
      title={muted ? tCommon("unmuteLabel") : tCommon("muteLabel")}
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
        aria-label={tLive("goToLive")}
        style={{
          position: "absolute",
          bottom: "max(14px, var(--vb-safe-bottom, 0px))",
          insetInlineEnd: "max(14px, env(safe-area-inset-right))",
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
            position: "absolute", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0, height: 110,
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
              insetInlineEnd: "max(14px, env(safe-area-inset-right))",
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
            insetInlineStart: 0, insetInlineEnd: 0,
            padding: "0 14px",
            paddingBottom: "max(14px, var(--vb-safe-bottom, 0px))",
            paddingInlineStart: "max(14px, env(safe-area-inset-left))",
            paddingInlineEnd: "max(14px, env(safe-area-inset-right))",
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
