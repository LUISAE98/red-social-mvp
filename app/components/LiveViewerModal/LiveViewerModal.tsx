"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import type { Post, PostLiveData } from "@/lib/posts/types";
import LiveChatViewer from "@/app/components/LiveChat/LiveChatViewer";

const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';


type Props = {
  open: boolean;
  onClose: () => void;
  post: Post;
  onManage?: () => void;
};

// Igual que StoryViewer.desktopPanelSize()
function desktopStorySize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 405, height: 720 };
  const h = Math.min(Math.round(window.innerHeight * 0.86), 720);
  return { width: Math.round((h * 9) / 16), height: h };
}

// Video horizontal: deja espacio para el chat flotante separado
function desktopHorizontalSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 800, height: 450 };
  const w = Math.min(Math.round(window.innerWidth * 0.62), 800);
  const h = Math.round((w * 9) / 16);
  return { width: w, height: Math.min(h, Math.round(window.innerHeight * 0.80)) };
}

const CHAT_FLOAT_W = 300;

export default function LiveViewerModal({ open, onClose, post, onManage }: Props) {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [localLiveData, setLocalLiveData] = useState<PostLiveData | null | undefined>(post.liveData);

  // Subscripción propia: no depende de que el padre pase el prop a tiempo
  useEffect(() => {
    if (!post.id) return;
    const unsub = onSnapshot(
      doc(db, "posts", post.id),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (data?.liveData) setLocalLiveData(data.liveData as PostLiveData);
      },
      (err) => console.warn("[LiveViewerModal] snapshot error", err)
    );
    return () => unsub();
  }, [post.id]);

  const liveData = localLiveData;
  const playbackId = liveData?.playbackId;
  const hlsUrl = playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null;
  const isLive = liveData?.status === "live";
  const isEnded = liveData?.status === "ended";
  const isMuted = !!(user?.uid && liveData?.mutedUsers?.includes(user.uid));
  const isBanned = !!(user?.uid && liveData?.bannedUsers?.includes(user.uid));
  const chatEnabled = !isEnded && !isBanned && liveData?.chatEnabled !== false;

  useEffect(() => { setMounted(true); }, []);

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

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Initialize HLS
  useEffect(() => {
    if (!open || !shouldRender || !hlsUrl) return;
    const video = videoRef.current;
    if (!video) return;

    setReady(false);
    setError(false);

    const onMeta = () => {
      setReady(true);
      video.play().catch(() => {});
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
  }, [open, shouldRender, hlsUrl, isLive]);

  // Congelar video en último frame cuando el live termina o el usuario es baneado
  useEffect(() => {
    if (!isEnded && !isBanned) return;
    videoRef.current?.pause();
  }, [isEnded, isBanned]);

  if (!mounted || !shouldRender) return null;

  // ── Header — siempre visible: título izquierda, mute + gestionar + cerrar derecha ──
  function renderHeader(safeTop = false) {
    const iconSz = isDesktop ? 20 : 24;
    return (
      <div style={{
        position: "absolute",
        top: 0, left: 0, right: 0, zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: safeTop ? "max(12px, env(safe-area-inset-top))" : 12,
        paddingBottom: 12,
        paddingLeft: 14,
        paddingRight: 14,
      }}>
        {liveData?.title ? (
          <span style={{
            fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)", fontFamily: FONT,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            minWidth: 0, flex: 1, paddingRight: 8,
          }}>
            {liveData.title}
          </span>
        ) : <span style={{ flex: 1 }} />}

        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {/* Mute — igual que historias */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
            aria-label={muted ? "Activar sonido" : "Silenciar"}
          >
            {muted ? (
              <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>

          {onManage && (
            <button
              type="button"
              onClick={onManage}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(0,0,0,0.45)",
                color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: FONT,
                cursor: "pointer",
                backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Gestionar
            </button>
          )}

          {/* Cerrar — igual que historias */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ── Badge EN VIVO / Finalizado — siempre visible, esquina inferior derecha ──
  // Cuando el live está activo, al hacer clic salta al extremo más actual del stream.
  function renderLiveBadge() {
    if (!isLive && !isEnded) return null;

    function jumpToLive(e: React.MouseEvent) {
      e.stopPropagation();
      const video = videoRef.current;
      if (!video || !isLive) return;
      try {
        const end = video.seekable.end(video.seekable.length - 1);
        if (Number.isFinite(end)) video.currentTime = end;
      } catch {
        // seekable puede estar vacío si el stream no ha cargado aún
      }
    }

    const sharedStyle: CSSProperties = {
      position: "absolute", bottom: 14, right: 14, zIndex: 10,
      display: "inline-flex", alignItems: "center", gap: 6,
      background: isLive ? "rgba(239,68,68,0.88)" : "rgba(0,0,0,0.55)",
      borderRadius: 7,
      border: isEnded ? "1px solid rgba(255,255,255,0.18)" : "none",
      padding: "5px 11px 5px 8px",
      fontFamily: FONT, fontSize: 11, fontWeight: 700,
      letterSpacing: "0.06em",
      color: isLive ? "#fff" : "rgba(255,255,255,0.55)",
      backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
    };

    const inner = (
      <>
        {isLive && (
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: "#fff", flexShrink: 0,
            animation: "lvPulse 1.4s ease-in-out infinite",
          }} />
        )}
        {isLive ? "EN VIVO" : "Finalizado"}
      </>
    );

    return isLive ? (
      <button
        type="button"
        onClick={jumpToLive}
        aria-label="Ir al momento actual del live"
        style={{ ...sharedStyle, cursor: "pointer" }}
      >
        {inner}
      </button>
    ) : (
      <div style={{ ...sharedStyle, pointerEvents: "none" }}>{inner}</div>
    );
  }

  // ── Overlay "Transmisión finalizada" — se muestra sobre el último frame ───
  function renderEndedOverlay() {
    if (!isEnded) return null;
    return (
      <div style={{
        position: "absolute", inset: 0, zIndex: 8,
        background: "rgba(0,0,0,0.55)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12,
        fontFamily: FONT,
      }}>
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.75)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span style={{
          fontSize: 15, fontWeight: 700,
          color: "rgba(255,255,255,0.85)",
          letterSpacing: "0.01em",
        }}>
          Transmisión finalizada
        </span>
      </div>
    );
  }

  // ── Overlay "Fuiste baneado" — cubre el video, el usuario no puede interactuar ─
  function renderBannedOverlay() {
    if (!isBanned) return null;
    return (
      <div style={{
        position: "absolute", inset: 0, zIndex: 9,
        background: "rgba(0,0,0,0.72)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12,
        fontFamily: FONT,
      }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.6)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        <span style={{
          fontSize: 15, fontWeight: 700,
          color: "rgba(255,255,255,0.85)",
          letterSpacing: "0.01em", textAlign: "center", padding: "0 24px",
        }}>
          Fuiste baneado de este live
        </span>
        <span style={{
          fontSize: 12, color: "rgba(255,255,255,0.4)",
          fontFamily: FONT, textAlign: "center", padding: "0 32px",
        }}>
          Ya no puedes participar en esta transmisión
        </span>
      </div>
    );
  }

  // ── Video element ──────────────────────────────────────────────────────────
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
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: fit, opacity: ready ? 1 : 0, transition: "opacity 0.3s ease",
          }}
        />
      </>
    );
  }

  const keyframes = `
    @keyframes lvPulse { 0%,100%{opacity:1}50%{opacity:0.35} }
    @keyframes lvFadeIn { from{opacity:0}to{opacity:1} }
    @keyframes lvFadeOut { from{opacity:1}to{opacity:0} }
  `;

  const floatCardShadow = "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)";

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP — portrait: dos cards flotantes separadas (video + chat)
  // ══════════════════════════════════════════════════════════════════════════
  if (isDesktop && isPortrait) {
    const { width: pw, height: ph } = desktopStorySize();
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 20,
            animation: open ? "lvFadeIn 0.2s ease" : "lvFadeOut 0.2s ease forwards",
          }}
          onClick={onClose}
        >
          {/* Card de video */}
          <div
            style={{
              position: "relative", width: pw, height: ph, background: "#000",
              borderRadius: 18, overflow: "hidden", flexShrink: 0,
              boxShadow: floatCardShadow,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderVideo("cover")}
            {renderEndedOverlay()}
            {renderBannedOverlay()}
            {renderHeader()}
            {renderLiveBadge()}
          </div>
          {/* Card de chat */}
          <div
            style={{
              width: CHAT_FLOAT_W, height: ph,
              background: "rgba(10,10,10,0.97)",
              borderRadius: 18, overflow: "hidden", flexShrink: 0,
              boxShadow: floatCardShadow,
              display: "flex", flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <LiveChatViewer liveId={post.id} chatEnabled={chatEnabled} liveEnded={isEnded} isMuted={isMuted} mode="panel" />
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP — horizontal: dos cards flotantes separadas (video grande + chat)
  // ══════════════════════════════════════════════════════════════════════════
  if (isDesktop) {
    const { width: hw, height: hh } = desktopHorizontalSize();
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 24,
            animation: open ? "lvFadeIn 0.2s ease" : "lvFadeOut 0.2s ease forwards",
          }}
          onClick={onClose}
        >
          {/* Card de video */}
          <div
            style={{
              position: "relative", width: hw, height: hh, background: "#000",
              borderRadius: 18, overflow: "hidden", flexShrink: 0,
              boxShadow: floatCardShadow,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderVideo("contain")}
            {renderEndedOverlay()}
            {renderBannedOverlay()}
            {renderHeader()}
            {renderLiveBadge()}
          </div>
          {/* Card de chat */}
          <div
            style={{
              width: CHAT_FLOAT_W, height: hh,
              background: "rgba(10,10,10,0.97)",
              borderRadius: 18, overflow: "hidden", flexShrink: 0,
              boxShadow: floatCardShadow,
              display: "flex", flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <LiveChatViewer liveId={post.id} chatEnabled={chatEnabled} liveEnded={isEnded} isMuted={isMuted} mode="panel" />
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE — portrait: fullscreen + overlay chat
  // ══════════════════════════════════════════════════════════════════════════
  if (isPortrait) {
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#000", display: "flex", flexDirection: "column" }}
        >
          <div style={{ position: "relative", flex: 1, minHeight: 0, height: "100%" }}>
            {renderVideo("cover")}
            {renderEndedOverlay()}
            {renderBannedOverlay()}
            {renderHeader(true)}
            {renderLiveBadge()}
            <LiveChatViewer liveId={post.id} chatEnabled={chatEnabled} liveEnded={isEnded} isMuted={isMuted} mode="overlay" />
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE — horizontal: video top + chat panel below
  // ══════════════════════════════════════════════════════════════════════════
  return createPortal(
    <>
      <style>{keyframes}</style>
      <div style={{
        position: "fixed", inset: 0, zIndex: 10000, background: "#0a0a0a",
        display: "flex", flexDirection: "column",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}>
        {/* Video */}
        <div
          style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000", flexShrink: 0 }}
        >
          {renderVideo("cover")}
          {renderEndedOverlay()}
          {renderBannedOverlay()}
          {renderHeader()}
          {renderLiveBadge()}
        </div>

        {/* Chat panel */}
        <div style={{
          flex: 1, overflow: "hidden",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}>
          <LiveChatViewer liveId={post.id} chatEnabled={chatEnabled} liveEnded={isEnded} isMuted={isMuted} mode="panel" />
        </div>
      </div>
    </>,
    document.body
  );
}
