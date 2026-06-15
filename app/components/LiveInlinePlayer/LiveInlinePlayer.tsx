"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Hls from "hls.js";

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

type Props = {
  playbackId: string;
  title?: string | null;
  coverUrl?: string | null;
  portrait?: boolean;
  paused?: boolean;
  onClick?: () => void;
  onOrientationDetected?: (portrait: boolean) => void;
};

export default function LiveInlinePlayer({
  playbackId,
  title,
  coverUrl,
  portrait = false,
  paused = false,
  onClick,
  onOrientationDetected,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  const hlsUrl = `https://stream.mux.com/${playbackId}.m3u8`;

  // Initialize HLS
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setReady(false);
    setError(false);

    const onMeta = () => {
      setReady(true);
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onOrientationDetected?.(video.videoHeight > video.videoWidth);
      }
    };

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, enableWorker: false });
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
      setError(true);
    }
  }, [hlsUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* Cover placeholder until video ready */}
      {!ready && coverUrl && (
        <img
          src={coverUrl}
          alt={title ?? "Live"}
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }}
        />
      )}

      {/* Error state */}
      {error && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8,
          color: "rgba(255,255,255,0.5)", fontFamily: fontStack, fontSize: 13,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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

      {/* Mute/unmute button */}
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>

      <style>{`
        @keyframes liveInlinePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
