"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Hls from "hls.js";
import type { ActiveSuperComment } from "@/lib/posts/types";

const fontStack = 'inherit';

// Thumbnail en tiempo real de CF Stream mientras conecta WebRTC
function CfThumbnail({ url, ts, title }: { url: string; ts: number; title?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [ts]); // eslint-disable-line react-hooks/set-state-in-effect

  if (failed) {
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10,
        color: "rgba(255,255,255,0.55)", fontFamily: fontStack, fontSize: 13,
        textAlign: "center", padding: "0 20px",
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"
          style={{ animation: "liveInlineSpin 1s linear infinite", flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="rgba(255,255,255,0.7)" />
        </svg>
        Conectando al en vivo...
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${url}?_t=${ts}`}
      alt={title ?? "En vivo"}
      onError={() => setFailed(true)}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

type Props = {
  postId?: string | null;
  playbackId?: string | null;
  hlsUrl?: string | null;
  title?: string | null;
  coverUrl?: string | null;
  portrait?: boolean;
  paused?: boolean;
  streamProvider?: string | null;
  activeSuper?: ActiveSuperComment | null;
  onClick?: () => void;
  onOrientationDetected?: (portrait: boolean) => void;
  onStreamReady?: (stream: MediaStream | null) => void;
};

export default function LiveInlinePlayer({
  postId,
  playbackId,
  hlsUrl: hlsUrlProp,
  title,
  coverUrl,
  portrait = false,
  paused = false,
  streamProvider,
  activeSuper,
  onClick,
  onOrientationDetected,
  onStreamReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const cfPcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const prevScKeyRef = useRef<string | null>(null);

  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(true);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [cfThumbTs, setCfThumbTs] = useState(() => Date.now());

  const rawHlsUrl = hlsUrlProp ?? (playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : "");
  const hlsUrl = rawHlsUrl ? rawHlsUrl.split("?")[0] : "";

  const isCfLive = streamProvider === "cloudflare";
  // CF thumbnail para mostrar mientras conecta WebRTC (puede fallar → spinner)
  const cfThumbnailUrl = isCfLive && hlsUrl
    ? hlsUrl.replace("/manifest/video.m3u8", "/thumbnails/thumbnail.jpg")
    : null;

  // ── TTS para supercomentarios en el feed ────────────────────────────────────
  useEffect(() => {
    if (!activeSuper || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const scKey = `${activeSuper.id}:${activeSuper.scheduledAt ?? 0}`;
    if (scKey === prevScKeyRef.current) return;
    prevScKeyRef.current = scKey;

    const ttsText = `${activeSuper.username} dijo: ${activeSuper.text}`;

    function doSpeak(text: string) {
      if (mutedRef.current || !text) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-MX";
      window.speechSynthesis.speak(u);
    }

    if (activeSuper.scheduledAt != null) {
      const delay = activeSuper.scheduledAt - Date.now();
      if (delay > 0) {
        const timer = window.setTimeout(() => doSpeak(ttsText), delay);
        return () => window.clearTimeout(timer);
      }
      const remainingSecs = activeSuper.displaySeconds + delay / 1000;
      if (remainingSecs < 2) return;
      const progressRatio = Math.min((activeSuper.displaySeconds - remainingSecs) / activeSuper.displaySeconds, 0.95);
      const startChar = Math.floor(progressRatio * ttsText.length);
      doSpeak(startChar > 0 ? ttsText.slice(startChar) : ttsText);
    } else {
      doSpeak(ttsText);
    }
  }, [activeSuper]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mute/unmute controla TTS con pause/resume (no cancel) para poder reanudar
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (muted) {
      window.speechSynthesis.pause();
    } else {
      window.speechSynthesis.resume();
    }
  }, [muted]);

  // Cancelar TTS al desmontar
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Reset visual state cuando cambia la fuente (solo para non-CF)
  useEffect(() => {
    if (isCfLive) return;
    setReady(false); // eslint-disable-line react-hooks/set-state-in-effect
    setError(false);
  }, [hlsUrl, isCfLive]);

  // ── WebRTC (CF Vibra Directo) ─────────────────────────────────────────────
  // CF no envía CORS headers desde el browser — se usa el mismo proxy que el viewer modal.
  useEffect(() => {
    if (!isCfLive || !postId) return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" },
      ],
    });
    cfPcRef.current = pc;

    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;

    pc.ontrack = ({ track }) => {
      if (cancelled) return;
      if (!remoteStream.getTrackById(track.id)) remoteStream.addTrack(track);

      if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
        onStreamReady?.(remoteStream);

        video.addEventListener("loadedmetadata", () => {
          if (!cancelled) {
            setReady(true);
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              onOrientationDetected?.(video.videoHeight > video.videoWidth);
            }
          }
        }, { once: true });

        video.addEventListener("canplay", () => {
          if (!cancelled) setReady(true);
        }, { once: true });

        video.play().catch(() => {
          video.muted = true;
          setMuted(true);
          video.play().catch(() => {});
        });
      }
    };

    pc.addEventListener("connectionstatechange", () => {
      if (!cancelled && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
        setError(true);
      }
    });

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Esperar a que ICE gathering termine (max 5s)
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") { resolve(); return; }
          const timer = setTimeout(resolve, 5000);
          const handler = () => {
            if (pc.iceGatheringState === "complete") {
              clearTimeout(timer);
              pc.removeEventListener("icegatheringstatechange", handler);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", handler);
        });

        if (cancelled) return;

        const sdp = pc.localDescription?.sdp;
        if (!sdp) return;

        const resp = await fetch(`/api/cf-viewer-proxy?postId=${encodeURIComponent(postId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: sdp,
        });

        if (!resp.ok || cancelled) return;

        const answer = await resp.text();
        if (cancelled) return;

        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch {
        // Fallo silencioso en el feed (no bloquear la experiencia)
      }
    })();

    return () => {
      cancelled = true;
      onStreamReady?.(null);
      try { pc.close(); } catch { /* best effort */ }
      cfPcRef.current = null;
      remoteStreamRef.current = null;
      if (video) { video.srcObject = null; }
      setReady(false);
    };
  }, [isCfLive, postId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresca el thumbnail de CF cada 5s mientras conecta
  useEffect(() => {
    if (!cfThumbnailUrl || ready) return;
    const id = setInterval(() => setCfThumbTs(Date.now()), 5000);
    return () => clearInterval(id);
  }, [cfThumbnailUrl, ready]);

  // ── HLS (Mux / OBS) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isCfLive) return; // CF usa WebRTC arriba

    const video = videoRef.current;
    if (!video) return;

    const tryDetectOrientation = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onOrientationDetected?.(video.videoHeight > video.videoWidth);
        return true;
      }
      return false;
    };

    const onMeta = () => {
      setReady(true);
      if (!tryDetectOrientation()) {
        video.addEventListener("loadeddata", tryDetectOrientation, { once: true });
        video.addEventListener("canplay", tryDetectOrientation, { once: true });
      }
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: -1,
        autoStartLoad: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveDurationInfinity: true,
        abrEwmaFastLive: 3.0,
        abrEwmaSlowLive: 9.0,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        fragLoadingMaxRetry: 8,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
        backBufferLength: 30,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        setReady(true);
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(true);
      });
      hlsRef.current = hls;
      return () => { hls.destroy(); hlsRef.current = null; };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("loadedmetadata", onMeta, { once: true });
    } else {
      setError(true); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [hlsUrl, isCfLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause/resume cuando el modal del live está abierto
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else video.play().catch(() => {});
  }, [paused]);

  // Autoplay / pause on scroll via IntersectionObserver
  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !pausedRef.current) {
          video.play().catch(() => {});
        } else {
          video.pause();
          if (typeof window !== "undefined" && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const wrapper: CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: portrait ? "9 / 16" : "16 / 9",
    background: "#000",
    borderRadius: 12,
    overflow: "hidden",
    cursor: onClick ? "pointer" : "default",
  };

  return (
    <div ref={containerRef} style={wrapper} onClick={onClick}>
      {/* Cover placeholder hasta que el video esté listo */}
      {!ready && coverUrl && (
        <Image
          src={coverUrl}
          alt={title ?? "Live"}
          fill
          style={{ objectFit: "cover", opacity: 0.5 }}
        />
      )}

      {/* CF live: thumbnail mientras WebRTC conecta (spinner si thumbnail no disponible) */}
      {isCfLive && !ready && cfThumbnailUrl && (
        <CfThumbnail url={cfThumbnailUrl} ts={cfThumbTs} title={title} />
      )}
      {isCfLive && !ready && !cfThumbnailUrl && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 10,
          color: "rgba(255,255,255,0.55)", fontFamily: fontStack, fontSize: 13,
          textAlign: "center", padding: "0 20px",
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"
            style={{ animation: "liveInlineSpin 1s linear infinite", flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="rgba(255,255,255,0.7)" />
          </svg>
          Conectando al en vivo...
        </div>
      )}

      {/* Error state — solo para streams no-CF (Mux / HLS) */}
      {error && !isCfLive && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8,
          color: "rgba(255,255,255,0.5)", fontFamily: fontStack, fontSize: 13,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          No se pudo cargar el stream
        </div>
      )}

      {/* Video element */}
      <video
        ref={videoRef}
        muted={muted}
        playsInline
        autoPlay
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: ready ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />

      {/* Botón mute/unmute */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
        style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "none",
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
        aria-label={muted ? "Activar sonido" : "Silenciar"}
      >
        {muted ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>

      <style>{`
        @keyframes liveInlinePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes liveInlineSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}
