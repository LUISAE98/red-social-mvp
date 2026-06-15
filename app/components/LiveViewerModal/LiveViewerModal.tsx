"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import type { Post } from "@/lib/posts/types";

const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

type Props = {
  open: boolean;
  onClose: () => void;
  post: Post;
};

// Same helper as StoryViewer for the 9:16 vertical panel
function desktopVerticalSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 380, height: 675 };
  const h = Math.min(Math.round(window.innerHeight * 0.88), 720);
  return { width: Math.round((h * 9) / 16), height: h };
}

// 16:9 panel for desktop horizontal
function desktopHorizontalSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 854, height: 480 };
  const w = Math.min(Math.round(window.innerWidth * 0.78), 1000);
  const h = Math.round((w * 9) / 16);
  return { width: w, height: Math.min(h, Math.round(window.innerHeight * 0.82)) };
}

export default function LiveViewerModal({ open, onClose, post }: Props) {
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false); // video orientation, default landscape

  const liveData = post.liveData;
  const playbackId = liveData?.playbackId;
  const hlsUrl = playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null;
  const isLive = liveData?.status === "live";
  const isEnded = liveData?.status === "ended";

  useEffect(() => { setMounted(true); }, []);

  // Desktop detection — same as StoryViewer
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  useEffect(() => {
    if (open) { setShouldRender(true); return; }
    const t = window.setTimeout(() => setShouldRender(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Initialize HLS — wait for shouldRender so videoRef is in DOM
  useEffect(() => {
    if (!open || !shouldRender || !hlsUrl) return;
    const video = videoRef.current;
    if (!video) return;

    setReady(false);
    setError(false);

    const onMeta = () => {
      setReady(true);
      video.play().catch(() => {});
      // Detect portrait/landscape from actual video dimensions
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setIsPortrait(video.videoHeight > video.videoWidth);
      }
    };

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, enableWorker: false });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        // Trigger play attempt even before metadata if already loaded
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setError(true); });
      hlsRef.current = hls;
      return () => { hls.destroy(); hlsRef.current = null; };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("loadedmetadata", onMeta, { once: true });
    } else {
      setError(true);
    }
  }, [open, shouldRender, hlsUrl]);

  if (!mounted || !shouldRender) return null;

  // ── Shared header ──────────────────────────────────────────────────────────
  function renderHeader(inset: string | number = 0) {
    return (
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: typeof inset === "number" ? inset : inset,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `calc(${typeof inset === "string" ? inset : `${inset}px`} + 12px) 14px 12px`,
        background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {isLive && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
              background: "rgba(239,68,68,0.9)", borderRadius: 999,
              padding: "4px 9px", fontFamily: FONT,
              fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#fff",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "lvPulse 1.4s ease-in-out infinite" }} />
              EN VIVO
            </div>
          )}
          {isEnded && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
              background: "rgba(0,0,0,0.5)", borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)",
              padding: "4px 9px", fontFamily: FONT,
              fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.55)",
            }}>
              Finalizado
            </div>
          )}
          {liveData?.title && (
            <span style={{
              fontSize: 13, fontWeight: 600, color: "#fff",
              fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {liveData.title}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            flexShrink: 0, width: 32, height: 32, borderRadius: "50%",
            border: "none", background: "rgba(0,0,0,0.45)",
            color: "#fff", cursor: "pointer", fontSize: 18,
            display: "grid", placeItems: "center", fontFamily: FONT,
            backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
          }}
          aria-label="Cerrar"
        >×</button>
      </div>
    );
  }

  // ── Shared mute button ─────────────────────────────────────────────────────
  function renderMuteBtn() {
    if (!ready) return null;
    return (
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        style={{
          position: "absolute", bottom: 14, right: 14, zIndex: 10,
          width: 38, height: 38, borderRadius: "50%",
          border: "none", background: "rgba(0,0,0,0.55)",
          color: "#fff", cursor: "pointer", display: "grid",
          placeItems: "center",
          backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        }}
        aria-label={muted ? "Activar sonido" : "Silenciar"}
      >
        {muted ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>
    );
  }

  // ── Shared video element ───────────────────────────────────────────────────
  function renderVideo(fit: "cover" | "contain" = "contain") {
    return (
      <>
        {!ready && liveData?.coverUrl && (
          <img
            src={liveData.coverUrl} alt={liveData.title ?? "Live"} draggable={false}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.3 }}
          />
        )}
        {error && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
            color: "rgba(255,255,255,0.45)", fontFamily: FONT, fontSize: 13, textAlign: "center",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            {isEnded ? "La transmisión ha finalizado." : "No se pudo cargar el stream."}
          </div>
        )}
        {!error && !playbackId && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", color: "rgba(255,255,255,0.35)", fontFamily: FONT,
            fontSize: 13, textAlign: "center", padding: "0 24px",
          }}>
            {isEnded ? "La transmisión ha finalizado." : "El stream aún no ha comenzado."}
          </div>
        )}
        <video
          ref={videoRef}
          muted={muted}
          playsInline
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: fit,
            opacity: ready ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
        />
      </>
    );
  }

  // ── Chat placeholder ───────────────────────────────────────────────────────
  function renderChatPanel() {
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 8, padding: "20px 16px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT }}>
          Chat próximamente
        </span>
      </div>
    );
  }

  const keyframes = `
    @keyframes lvPulse { 0%,100%{opacity:1}50%{opacity:0.35} }
    @keyframes lvFadeIn { from{opacity:0}to{opacity:1} }
    @keyframes lvFadeOut { from{opacity:1}to{opacity:0} }
  `;

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP
  // ══════════════════════════════════════════════════════════════════════════
  if (isDesktop) {
    // Vertical (portrait 9:16) — story-like panel
    if (isPortrait) {
      const { width: pw, height: ph } = desktopVerticalSize();
      return createPortal(
        <>
          <style>{keyframes}</style>
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 10000,
              background: "rgba(0,0,0,0.88)",
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: open ? "lvFadeIn 0.2s ease" : "lvFadeOut 0.2s ease forwards",
            }}
            onClick={onClose}
          >
            <div
              style={{
                position: "relative", width: pw, height: ph,
                borderRadius: 18, overflow: "hidden",
                background: "#000", flexShrink: 0,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {renderVideo("cover")}
              {renderHeader()}
              {renderMuteBtn()}
            </div>
          </div>
        </>,
        document.body
      );
    }

    // Horizontal (landscape 16:9) — wider panel
    const { width: hw, height: hh } = desktopHorizontalSize();
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: open ? "lvFadeIn 0.2s ease" : "lvFadeOut 0.2s ease forwards",
          }}
          onClick={onClose}
        >
          <div
            style={{
              position: "relative", width: hw, height: hh,
              borderRadius: 18, overflow: "hidden",
              background: "#000", flexShrink: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderVideo("contain")}
            {renderHeader()}
            {renderMuteBtn()}
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE
  // ══════════════════════════════════════════════════════════════════════════

  // Vertical (portrait) — full screen, no safe area
  if (isPortrait) {
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "#000", display: "flex", flexDirection: "column",
          }}
        >
          <div style={{ position: "relative", flex: 1 }}>
            {renderVideo("cover")}
            {renderHeader(0)}
            {renderMuteBtn()}
          </div>
        </div>
      </>,
      document.body
    );
  }

  // Horizontal (landscape) — video top + safe area, chat panel below
  return createPortal(
    <>
      <style>{keyframes}</style>
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "#0a0a0a",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Video section — respects safe area top */}
        <div style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16/9",
          background: "#000",
          paddingTop: "env(safe-area-inset-top, 0px)",
          flexShrink: 0,
        }}>
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {renderVideo("cover")}
            {renderHeader("env(safe-area-inset-top, 0px)")}
            {renderMuteBtn()}
          </div>
        </div>

        {/* Chat panel */}
        {renderChatPanel()}
      </div>
    </>,
    document.body
  );
}
