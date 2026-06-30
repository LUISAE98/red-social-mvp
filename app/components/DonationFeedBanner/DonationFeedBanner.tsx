"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import { getMutePreference, setMutePreference } from "@/lib/utils/mutePreference";

type Props = {
  message?: string | null;
  playbackId?: string | null;
  creatorName?: string | null;
  profilePhoto?: string | null;
  profileHandle?: string | null;
  donationMode?: string | null;
  goalLabel?: string | null;
  expanded?: boolean;
  onClose?: () => void;
  onDonate?: () => void;
  onClick?: () => void;
};

type VideoDimensions = { w: number; h: number } | null;

const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

function desktopPanelSize() {
  if (typeof window === "undefined") return { width: 380, height: 675 };
  const h = Math.min(Math.round(window.innerHeight * 0.86), 720);
  return { width: Math.round((h * 9) / 16), height: h };
}

export default function DonationFeedBanner({
  message, playbackId, creatorName, profilePhoto, profileHandle,
  donationMode, goalLabel,
  expanded, onClose, onDonate, onClick,
}: Props) {
  const [dims, setDims] = useState<VideoDimensions>(null);
  const [muted, setMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragY, setDragY] = useState(0);

  // Banner video — callback ref so HLS re-initializes when the element is replaced
  // (happens when orientation flips after dims loads)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null);
  const videoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoNode(node);
  }, []);
  // Viewer video — in a body-level portal (no ancestor-transform issues)
  const viewerVideoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  // Tracks whether HLS is currently attached to the viewer video
  const hlsInViewerRef = useRef(false);
  // Persists playback position across transfers
  const savedTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const thumbnailUrl = playbackId
    ? `https://image.mux.com/${playbackId}/thumbnail.jpg?time=2`
    : null;
  const hlsUrl = playbackId
    ? `https://stream.mux.com/${playbackId}.m3u8`
    : null;

  useEffect(() => {
    if (!thumbnailUrl) return;
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0)
        setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = thumbnailUrl;
  }, [thumbnailUrl]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 599px)");
    setIsMobile(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  // ── HLS on banner video ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    setVideoReady(false);
    hlsInViewerRef.current = false;
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (!video || !hlsUrl) {
      if (video) { video.removeAttribute("src"); video.load(); }
      return;
    }
    video.muted = true;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, startLevel: -1, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => setVideoReady(true));
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    } else {
      video.src = hlsUrl;
      video.load();
      video.addEventListener("loadedmetadata", () => setVideoReady(true), { once: true });
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [hlsUrl, videoNode]); // videoNode re-triggers when the element is replaced on orientation flip

  // ── Autoplay banner ───────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady || expanded) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        entry.intersectionRatio >= 0.5
          ? video.play().catch(() => undefined)
          : video.pause();
      },
      { threshold: [0, 0.5] }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [videoReady, expanded, videoNode]);

  // ── HLS transfer: banner ↔ viewer ────────────────────────────────────────────
  // Uses hlsInViewerRef to avoid double-transfers (this effect re-runs on videoReady too)
  useEffect(() => {
    if (expanded && !hlsInViewerRef.current && videoReady) {
      const viewerVideo = viewerVideoRef.current;
      if (!viewerVideo) return;

      // Save banner position
      if (videoRef.current) savedTimeRef.current = videoRef.current.currentTime;

      if (Hls.isSupported()) {
        const hls = hlsRef.current;
        if (!hls) return;
        hls.detachMedia();
        hls.attachMedia(viewerVideo);
      } else {
        if (videoRef.current) videoRef.current.pause();
        viewerVideo.src = hlsUrl ?? "";
      }

      const pref = getMutePreference();
      setMuted(pref);
      viewerVideo.muted = pref;
      hlsInViewerRef.current = true;

      const doPlay = () => {
        viewerVideo.currentTime = savedTimeRef.current;
        viewerVideo.play().catch(() => undefined);
      };
      viewerVideo.readyState >= 3
        ? doPlay()
        : viewerVideo.addEventListener("canplay", doPlay, { once: true });

    } else if (!expanded && hlsInViewerRef.current) {
      const bannerVideo = videoRef.current;
      if (!bannerVideo) return;
      hlsInViewerRef.current = false;

      if (Hls.isSupported()) {
        const hls = hlsRef.current;
        if (!hls) return;
        hls.detachMedia();
        hls.attachMedia(bannerVideo);
      }

      bannerVideo.muted = true;
      setMuted(true);

      const doPlay = () => {
        bannerVideo.currentTime = savedTimeRef.current;
        bannerVideo.play().catch(() => undefined);
      };
      bannerVideo.readyState >= 3
        ? doPlay()
        : bannerVideo.addEventListener("canplay", doPlay, { once: true });
    }
  }, [expanded, videoReady, hlsUrl]);

  // Mute sync to viewer video when muted state changes
  useEffect(() => {
    const target = hlsInViewerRef.current ? viewerVideoRef.current : videoRef.current;
    if (target) target.muted = muted;
  }, [muted]);

  // Body scroll lock
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [expanded]);

  // Progress rAF
  useEffect(() => {
    if (!expanded) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setProgress(0);
      return;
    }
    const tick = () => {
      const v = viewerVideoRef.current;
      if (v && v.duration > 0) setProgress(v.currentTime / v.duration);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [expanded]);

  // Save time before closing so the transfer-back effect has the right position
  const handleClose = useCallback(() => {
    if (viewerVideoRef.current) savedTimeRef.current = viewerVideoRef.current.currentTime;
    onClose?.();
  }, [onClose]);

  // Swipe to close (mobile)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const dy = (e.touches[0]?.clientY ?? touchStartYRef.current) - touchStartYRef.current;
    if (dy > 0) setDragY(dy);
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const startX = touchStartXRef.current;
    const startY = touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    const dy = (e.changedTouches[0]?.clientY ?? startY ?? 0) - (startY ?? 0);
    const dx = (e.changedTouches[0]?.clientX ?? startX ?? 0) - (startX ?? 0);
    if (dy > 80 && dy > Math.abs(dx)) { setDragY(0); handleClose(); return; }
    setDragY(0);
  }, [handleClose]);

  const isPortrait = dims ? dims.h > dims.w : false;
  const aspectRatio = dims ? `${dims.w} / ${dims.h}` : isPortrait ? "9 / 16" : "16 / 9";
  const videoWidthInline = isPortrait ? "18%" : "36%";
  const orientation = isPortrait ? "portrait" : "landscape";
  const donateLabel = donationMode === "wedding"
    ? (goalLabel?.trim() || "Sumarte a nuestro gran día 💍")
    : "Donar";

  // ── Viewer controls ───────────────────────────────────────────────────────────
  const muteBtn = (sz: number) => (
    <button type="button" aria-label={muted ? "Activar sonido" : "Silenciar"}
      onClick={(e) => { e.stopPropagation(); setMuted((m) => { const next = !m; setMutePreference(next); return next; }); }}
      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {muted ? (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
      ) : (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      )}
    </button>
  );

  const renderControls = (safeTop: string | number, sz: number, safeBottom: string | number) => {
    const headerTop = typeof safeTop === "number" ? safeTop + 36 : `calc(${safeTop} + 36px)`;
    const controlsTop = typeof safeTop === "number" ? safeTop + 28 : `calc(${safeTop} + 28px)`;
    const btnPadBottom = typeof safeBottom === "string" ? `max(8px, ${safeBottom})` : "8px";
    const avatarSz = sz === 20 ? 40 : 54;
    const avatarInset = sz === 20 ? 5 : 6;

    const avatarRing = (
      <div style={{ position: "relative", width: avatarSz, height: avatarSz, flexShrink: 0 }}>
        <div style={{ position: "absolute", inset: avatarInset, borderRadius: "50%", overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
          {profilePhoto ? <Image src={profilePhoto} alt="" fill style={{ objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.15)" }} />}
        </div>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: VIBRA_RING,
          WebkitMaskImage: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), white calc(100% - 2.5px))",
          maskImage: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), white calc(100% - 2.5px))" }} />
      </div>
    );

    const headerInner = (
      <>
        {avatarRing}
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ color: "#fff", fontSize: sz === 20 ? 13 : 17, fontWeight: 600, lineHeight: "1.2" }}>{creatorName ?? ""}</span>
          <span style={{ color: "rgba(255,255,255,0.75)", fontSize: sz === 20 ? 11 : 13, fontWeight: 500, lineHeight: "1.2" }}>Donación</span>
        </div>
      </>
    );

    const headerStyle: React.CSSProperties = {
      position: "absolute", top: headerTop, left: 12, zIndex: 10,
      display: "flex", alignItems: "center", gap: sz === 20 ? 6 : 8,
      textDecoration: "none", WebkitTapHighlightColor: "transparent",
    };

    return (
      <>
        <div style={{ position: "absolute", top: safeTop, left: 0, right: 0, paddingTop: 12, paddingLeft: 10, paddingRight: 10, zIndex: 10 }}>
          <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: "#fff", width: `${Math.round(progress * 100)}%`, transition: "none" }} />
          </div>
        </div>
        {profileHandle
          ? <a href={`/u/${profileHandle}`} onClick={(e) => e.stopPropagation()} style={{ ...headerStyle, cursor: "pointer" }}>{headerInner}</a>
          : <div style={headerStyle}>{headerInner}</div>}
        <div style={{ position: "absolute", top: controlsTop, right: 10, display: "flex", alignItems: "center", gap: 4, zIndex: 11 }}>
          {muteBtn(sz)}
          <button type="button" aria-label="Cerrar" onClick={handleClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40%", background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)", pointerEvents: "none", zIndex: 8 }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 14px", paddingBottom: btnPadBottom, zIndex: 10 }}>
          <button type="button" onTouchStart={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDonate?.(); }}
            style={{ width: "100%", padding: sz === 20 ? "8px 10px" : "11px 10px", borderRadius: 10, border: "none", background: "#ec4899", color: "#fff", fontSize: sz === 20 ? 12 : 14, fontWeight: 600, cursor: "pointer", letterSpacing: "-0.01em", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          >
            <svg width={sz === 20 ? 12 : 14} height={sz === 20 ? 12 : 14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.27 2 8.5 2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.53L12 21.35z" />
            </svg>
            {donateLabel === "Donar" ? "Hacer una aportación" : donateLabel}
          </button>
        </div>
      </>
    );
  };

  const renderViewer = () => {
    if (!mounted || !expanded) return null;

    if (isDesktop) {
      const { width: panelW, height: panelH } = desktopPanelSize();
      const panelStyle: React.CSSProperties = {
        position: "fixed", zIndex: 99998,
        width: panelW, height: panelH,
        left: "50%", top: "50%",
        transform: "translate(-50%, -50%)",
        borderRadius: 18, overflow: "hidden", background: "#000",
      };
      return createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 99997, background: "rgba(0,0,0,0.85)" }} onClick={handleClose} />
          {/* Viewer video at 99998 */}
          <div style={panelStyle}>
            <video ref={viewerVideoRef} playsInline loop style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
          </div>
          {/* Controls at 99999 — above the video */}
          <div style={{ ...panelStyle, zIndex: 99999, background: "transparent", pointerEvents: "none" }}>
            <div style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "auto" }} onClick={(e) => e.stopPropagation()}>
              {renderControls(12, 20, 0)}
            </div>
          </div>
        </>,
        document.body,
      );
    }

    // Mobile
    const drag = dragY;
    const op = 1 - Math.min(1, drag / 300);
    const mobileVideoStyle: React.CSSProperties = {
      position: "fixed", inset: 0, zIndex: 99998, background: "#000",
      transform: `translateY(${drag}px)`,
      opacity: op,
      transition: drag > 0 ? "none" : "transform 0.3s ease",
    };
    return createPortal(
      <>
        <div style={{ position: "fixed", inset: 0, zIndex: 99997, background: "#000", opacity: op } as React.CSSProperties} />
        {/* Viewer video */}
        <div style={mobileVideoStyle}>
          <video ref={viewerVideoRef} playsInline loop style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        </div>
        {/* Controls */}
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99999, transform: `translateY(${drag}px)`, transition: drag > 0 ? "none" : "transform 0.3s ease" } as React.CSSProperties}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {renderControls("env(safe-area-inset-top, 0px)", 24, "env(safe-area-inset-bottom, 0px)")}
          </div>
        </div>
      </>,
      document.body,
    );
  };

  const muteIconBanner = (
    <button type="button" aria-label={muted ? "Activar sonido" : "Silenciar"}
      onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
      style={{ position: "absolute", bottom: 6, right: 6, zIndex: 3, background: "rgba(0,0,0,0.55)", border: "none", borderRadius: "50%", width: 26, height: 26, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.9)", WebkitTapHighlightColor: "transparent" }}
    >
      {muted ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      )}
    </button>
  );

  const donateRow = onClick ? (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 5, width: "86%", overflow: "hidden" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <span style={{ fontSize: 11, color: "#ec4899", lineHeight: 1.3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>
          Tu aportación es completamente voluntaria
        </span>
      </div>
      <button type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        style={{ width: "86%", padding: "10px 0", justifyContent: "center", borderRadius: 10, border: "none", background: "#ec4899", color: "#fff", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", cursor: "pointer", fontFamily: "inherit", WebkitTapHighlightColor: "transparent", display: "flex", alignItems: "center", gap: 7 }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
        Hacer una aportación
      </button>
    </>
  ) : null;

  return (
    <>
      <style>{`
        .dbv-video-wrap { position: absolute; z-index: 2; border-radius: 10px; overflow: hidden; background: #111; }
        .dbv-video-wrap.portrait  { top: 2%; right: 12%; }
        @media (min-width: 560px) {
          .dbv-video-wrap.portrait { top: 4%; bottom: 4%; right: 4%; width: auto !important; }
        }
        .dbv-actions { position: absolute; inset: 0; z-index: 1; padding: 0 18px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
        .dbv-upper { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; gap: 10px; }
        .dbv-lower { display: flex; flex-direction: column; align-items: center; gap: 8px; padding-bottom: 18px; width: 100%; }
        .dbv-text-block, .dbv-shield-row, .dbv-btn { width: 86%; }
        @media (min-width: 560px) and (max-width: 899px) {
          .dbv-avatar { width: 60px !important; height: 60px !important; }
          .dbv-title  { font-size: 13px !important; }
          .dbv-upper  { gap: 5px; }
          .dbv-lower  { padding-bottom: 12px; gap: 5px; }
          .dbv-shield-row span { font-size: 10px !important; }
          .dbv-btn { font-size: 12px !important; padding-top: 7px !important; padding-bottom: 7px !important; }
        }
        @media (min-width: 900px) {
          .dbv-actions.portrait { right: auto; width: 74%; }
          .dbv-actions.portrait .dbv-text-block,
          .dbv-actions.portrait .dbv-shield-row,
          .dbv-actions.portrait .dbv-btn { width: 70%; }
        }
        @media (max-width: 599px) {
          .dbv-landscape-wrap { padding-left: 14px; padding-right: 14px; }
        }
      `}</style>

      {renderViewer()}

      {isMobile && isPortrait ? (
        /* ── MOBILE PORTRAIT: column layout, video below description ── */
        <div className="dbv-landscape-wrap">
          <div
            className="dbv-container"
            onClick={onClick}
            style={{ position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", backgroundColor: "#0a0a0a", backgroundImage: "url(/donacion2.png)", backgroundSize: "cover", backgroundPosition: "center", cursor: onClick ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}
          >
            <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.68)" }} />
            <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "22px 18px 18px", gap: 10 }}>
              {profilePhoto && (
                <div style={{ position: "relative", width: 84, height: 84, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.1)" }}>
                  <Image src={profilePhoto} alt="" fill sizes="84px" style={{ objectFit: "cover" }} />
                </div>
              )}
              {(creatorName || message) && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, width: "90%" }}>
                  {creatorName && (
                    <p style={{ margin: 0, fontSize: 17, fontWeight: 400, color: "#fff", lineHeight: 1.2, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", width: "100%" }}>
                      Apoya a {creatorName}
                    </p>
                  )}
                  {message && (
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.80)", lineHeight: 1.45, textAlign: "center" }}>
                      {message}
                    </p>
                  )}
                </div>
              )}
              {hlsUrl && (
                <div style={{ position: "relative", width: "52%", aspectRatio: `${dims?.w ?? 9} / ${dims?.h ?? 16}`, borderRadius: 10, overflow: "hidden", background: "#111", marginTop: 10, marginBottom: 10 }}>
                  <video ref={videoCallbackRef} playsInline autoPlay loop muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  {muteIconBanner}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%", paddingTop: 2 }}>
                {donateRow}
              </div>
            </div>
          </div>
        </div>
      ) : isPortrait ? (
        /* ── PORTRAIT card: fixed aspect ratio, video top-right ── */
        <div
          className="dbv-container"
          onClick={onClick}
          style={{ position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", background: "#0a0a0a", cursor: onClick ? "pointer" : "default", aspectRatio: "16 / 8", WebkitTapHighlightColor: "transparent" }}
        >
          <Image src="/donacion.png" alt="Donación" fill sizes="(max-width: 720px) 100vw, 720px" style={{ objectFit: "cover", objectPosition: "center" }} priority />
          <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.68)" }} />

          {hlsUrl && (
            <div className="dbv-video-wrap portrait" style={{ width: videoWidthInline, aspectRatio }}>
              <video ref={videoCallbackRef} playsInline autoPlay loop muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              {muteIconBanner}
            </div>
          )}

          <div className="dbv-actions portrait">
            <div className="dbv-upper">
              {profilePhoto && (
                <div className="dbv-avatar" style={{ position: "relative", width: 100, height: 100, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.1)" }}>
                  <Image src={profilePhoto} alt="" fill sizes="100px" style={{ objectFit: "cover" }} />
                </div>
              )}
              {(creatorName || message) && (
                <div className="dbv-text-block" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  {creatorName && (
                    <p className="dbv-title" style={{ margin: 0, fontSize: 18, fontWeight: 400, color: "#fff", lineHeight: 1.2, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      Apoya a {creatorName}
                    </p>
                  )}
                  {message && (
                    <p className="dbv-desc" style={{ margin: 0, fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.80)", lineHeight: 1.45, textAlign: "center", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", padding: 0, width: "110%", alignSelf: "center" }}>
                      {message}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="dbv-lower">
              {donateRow}
            </div>
          </div>
        </div>
      ) : (
        /* ── LANDSCAPE card: taller, video at bottom ── */
        <div className="dbv-landscape-wrap">
        <div
          className="dbv-container"
          onClick={onClick}
          style={{ position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", backgroundColor: "#0a0a0a", backgroundImage: "url(/donacion2.png)", backgroundSize: "cover", backgroundPosition: "center", cursor: onClick ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}
        >
          <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.68)" }} />

          {/* Content in normal flow — height is determined by content */}
          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "22px 18px 18px", gap: 10 }}>
            {profilePhoto && (
              <div style={{ position: "relative", width: 84, height: 84, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.1)" }}>
                <Image src={profilePhoto} alt="" fill sizes="84px" style={{ objectFit: "cover" }} />
              </div>
            )}
            {(creatorName || message) && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, width: "90%" }}>
                {creatorName && (
                  <p style={{ margin: 0, fontSize: 17, fontWeight: 400, color: "#fff", lineHeight: 1.2, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", width: "100%" }}>
                    Apoya a {creatorName}
                  </p>
                )}
                {message && (
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.80)", lineHeight: 1.45, textAlign: "center", ...(isMobile ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>
                    {message}
                  </p>
                )}
              </div>
            )}

            {/* Landscape video — 80% width, below the description */}
            {hlsUrl && (
              <div style={{ position: "relative", width: "80%", aspectRatio: `${dims?.w ?? 16} / ${dims?.h ?? 9}`, borderRadius: 10, overflow: "hidden", background: "#111", marginTop: 10, marginBottom: 10 }}>
                <video ref={videoCallbackRef} playsInline autoPlay loop muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                {muteIconBanner}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%", paddingTop: 2 }}>
              {donateRow}
            </div>
          </div>
        </div>
        </div>
      )}
    </>
  );
}
