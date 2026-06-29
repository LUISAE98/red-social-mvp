"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  VideoSpeedIcon,
  VideoLiveBadge,
  VideoViewerBadge,
  VideoCloseIcon,
  VideoMuteIcon,
  VideoUnmuteIcon,
  VideoExpandIcon,
  VideoCompressIcon,
  VideoSkipBackIcon,
  VideoPlayIcon,
  VideoPauseIcon,
  VideoSkipForwardIcon,
  VideoPipIcon,
  VideoAirPlayIcon,
  VideoCastIcon,
} from "@/app/components/VibraServiceIcons/VibraVideoIcons";

// ── Subnav mobile icons (copias locales para preview) ────────────────────────

function NavHomeIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 11.2 12 4l8.5 7.2" />
      <path d="M5.8 10.2V20h12.4v-9.8" />
      <path d="M9.5 20v-5.8h5V20" />
    </svg>
  );
}

function NavHomeIconFilled() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path fill="white" d="M3.5 11.2 12 4l8.5 7.2" />
      <path fill="white" d="M5.8 10.2V20h12.4v-9.8" />
      <path fill="#000000" d="M9.5 20v-5.8h5V20" />
    </svg>
  );
}

function NavBellIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8" />
      <path d="M10.3 20a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function NavBellIconFilled() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path fill="white" d="M6 8a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8Z" />
      <path d="M10.3 20a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function NavGroupsIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="6.5" r="3.2" />
      <circle cx="6.5" cy="16" r="3.2" />
      <circle cx="17.5" cy="16" r="3.2" />
      <path d="M9.4 8.8L8.8 13" strokeWidth={1.5} />
      <path d="M14.6 8.8L15.2 13" strokeWidth={1.5} />
      <path d="M9.7 16H14.3" strokeWidth={1.5} />
    </svg>
  );
}

function NavGroupsIconFilled() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="6.5" r="3.2" fill="white" />
      <circle cx="6.5" cy="16" r="3.2" fill="white" />
      <circle cx="17.5" cy="16" r="3.2" fill="white" />
      <path d="M9.4 8.8L8.8 13" strokeWidth={1.5} />
      <path d="M14.6 8.8L15.2 13" strokeWidth={1.5} />
      <path d="M9.7 16H14.3" strokeWidth={1.5} />
    </svg>
  );
}

function NavWalletIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12V7H5a2 2 0 0 1 0-4h13v4" />
      <path d="M3 5v13a2 2 0 0 0 2 2h15v-5" />
      <path d="M17 12a2 2 0 0 0 0 4h3v-4Z" />
    </svg>
  );
}

function NavWalletIconFilled() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path fill="white" stroke="none" d="M3 6v12a2 2 0 0 0 2 2h15V6H3Z" />
      <path fill="#000000" stroke="none" d="M16.4 11.5a2.55 2.55 0 0 0 0 5.1h3.6v-5.1Z" />
      <path d="M20 12V7H5a2 2 0 0 1 0-4h13v4" />
      <path d="M3 5v13a2 2 0 0 0 2 2h15v-5" />
      <path d="M17 12a2 2 0 0 0 0 4h3v-4Z" />
    </svg>
  );
}

const SUBNAV_ITEMS = [
  { label: "Home",           name: "NavHomeIcon",    icon: NavHomeIcon,    filled: NavHomeIconFilled },
  { label: "Comunidades",    name: "NavGroupsIcon",  icon: NavGroupsIcon,  filled: NavGroupsIconFilled },
  { label: "Notificaciones", name: "NavBellIcon",    icon: NavBellIcon,    filled: NavBellIconFilled },
  { label: "Wallet",         name: "NavWalletIcon",  icon: NavWalletIcon,  filled: NavWalletIconFilled },
];

// ── Tipos ─────────────────────────────────────────────────────────────────────

const ICONS: { name: string; label: string; component: React.ComponentType<{ size?: number }>; size?: number }[] = [
  { name: "VideoCloseIcon",       label: "Cerrar",             component: VideoCloseIcon },
  { name: "VideoMuteIcon",        label: "Silenciar",          component: VideoMuteIcon },
  { name: "VideoUnmuteIcon",      label: "Con sonido",         component: VideoUnmuteIcon },
  { name: "VideoExpandIcon",      label: "Expandir",           component: VideoExpandIcon },
  { name: "VideoCompressIcon",    label: "Comprimir",          component: VideoCompressIcon },
  { name: "VideoSkipBackIcon",    label: "Retroceder 10s",     component: VideoSkipBackIcon,    size: 24 },
  { name: "VideoPlayIcon",        label: "Play",               component: VideoPlayIcon,        size: 26 },
  { name: "VideoPauseIcon",       label: "Pausa",              component: VideoPauseIcon,       size: 26 },
  { name: "VideoSkipForwardIcon", label: "Avanzar 10s",        component: VideoSkipForwardIcon, size: 24 },
  { name: "VideoPipIcon",         label: "Picture in Picture", component: VideoPipIcon },
  { name: "VideoAirPlayIcon",     label: "AirPlay",            component: VideoAirPlayIcon },
  { name: "VideoCastIcon",        label: "Google Cast",        component: VideoCastIcon },
];

const DURATION = 180;
const VIDEO_SRC = "https://vjs.zencdn.net/v/oceans.mp4";

// ── Utilidades ────────────────────────────────────────────────────────────────

function formatTime(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ── Scrubber ──────────────────────────────────────────────────────────────────

function Scrubber({ current, duration, onChange }: { current: number; duration: number; onChange: (t: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const seek = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (clientX - left) / width)) * duration);
  }, [duration, onChange]);

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      ref={trackRef}
      onMouseDown={(e) => { dragging.current = true; seek(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) seek(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onClick={(e) => e.stopPropagation()}
      style={{ position: "relative", height: 28, cursor: "pointer", display: "flex", alignItems: "center" }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.25)" }} />
      <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: 4, borderRadius: 99, background: "#fff" }} />
      <div style={{ position: "absolute", left: `${pct}%`, transform: "translateX(-50%)", width: 11, height: 11, borderRadius: "50%", background: "#fff" }} />
    </div>
  );
}

// ── VideoPlayer ───────────────────────────────────────────────────────────────

function VideoPlayer({ orientation, label }: { orientation: "horizontal" | "vertical"; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2];

  const applySpeed = useCallback((s: number) => {
    setSpeed(s);
    setMenuOpen(false);
    if (videoRef.current) videoRef.current.playbackRate = s;
  }, []);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Muestra controles sin iniciar timer (mientras el mouse está dentro)
  const revealControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  // Inicia el timer para ocultar (al salir el mouse o al dar play sin mouse)
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControls(false);
    }, 1000);
  }, []);

  const toggle = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); }
    else { v.pause(); }
  }, []);

  const skip = useCallback((secs: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + secs));
  }, []);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMuted(m => !m);
  }, []);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  }, []);

  const isH = orientation === "horizontal";
  const W = isH ? (fullscreen ? "100%" : 520) : 260;
  const H = isH ? (fullscreen ? "100%" : 292) : 462;

  const fade: React.CSSProperties = {
    opacity: controls ? 1 : 0,
    transition: "opacity 0.3s ease",
    pointerEvents: controls ? "auto" : "none",
  };

  const btnStyle: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer",
    color: "rgba(255,255,255,0.9)", padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600 }}>{label}</span>
      <div
        style={{
          position: "relative", width: W, height: H,
          borderRadius: 14, overflow: "hidden", background: "#000",
          cursor: "pointer", flexShrink: 0,
        }}
        onClick={revealControls}
        onMouseEnter={revealControls}
        onMouseMove={revealControls}
        onMouseLeave={scheduleHide}
      >
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          style={{ width: "100%", height: "100%", objectFit: isH ? "contain" : "cover", display: "block" }}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
          onPlay={() => { setPlaying(true); scheduleHide(); }}
          onPause={() => { setPlaying(false); setControls(true); if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } }}
          playsInline
        />

        {/* ── Top bar (se desvanece al reproducir) ── */}
        <div style={{
          ...fade, position: "absolute", top: 0, left: 0, right: 0,
          padding: "12px 48px 12px 14px",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          {/* Izquierda: menú 3 puntos + PiP + AirPlay */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              style={btnStyle}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(m => !m); }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>

            {menuOpen && (
              <div
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }}
                style={{
                  position: "fixed", inset: 0, zIndex: 99990,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(0,0,0,0.50)",
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "min(280px, 88vw)",
                    background: "rgba(8,9,11,0.985)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 12,
                    boxShadow: "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
                    backdropFilter: "blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                    overflow: "hidden",
                  }}
                >
                  {SPEEDS.map((s, i) => (
                    <button
                      key={s}
                      onClick={() => applySpeed(s)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", minHeight: 46,
                        padding: "11px 16px", background: "none", border: "none",
                        borderTop: i > 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
                        color: s === speed ? "#fff" : "rgba(255,255,255,0.75)",
                        fontSize: 14, fontWeight: s === speed ? 700 : 500,
                        fontFamily: "inherit", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      {s === 1 ? "Normal" : `×${s}`}
                      {s === speed && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button style={btnStyle} onClick={(e) => e.stopPropagation()}>
              <VideoPipIcon />
            </button>
            <button style={btnStyle} onClick={(e) => e.stopPropagation()}>
              <VideoAirPlayIcon />
            </button>
          </div>

          {/* Derecha: Expand + Mute */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button style={btnStyle} onClick={(e) => { e.stopPropagation(); setFullscreen(f => !f); }}>
              {fullscreen ? <VideoCompressIcon /> : <VideoExpandIcon />}
            </button>
            <button style={btnStyle} onClick={toggleMute}>
              {muted ? <VideoMuteIcon /> : <VideoUnmuteIcon />}
            </button>
          </div>
        </div>

        {/* ── Cerrar — siempre visible ── */}
        <button
          style={{ ...btnStyle, position: "absolute", top: 12, right: 14, zIndex: 10 }}
          onClick={(e) => e.stopPropagation()}
        >
          <VideoCloseIcon />
        </button>

        {/* ── Centro: skip + play/pause ── */}
        <div style={{
          ...fade, position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 36,
        }}>
          <button style={btnStyle} onClick={(e) => skip(-10, e)}>
            <VideoSkipBackIcon size={24} />
          </button>
          <button style={btnStyle} onClick={toggle}>
            {playing ? <VideoPauseIcon /> : <VideoPlayIcon />}
          </button>
          <button style={btnStyle} onClick={(e) => skip(10, e)}>
            <VideoSkipForwardIcon size={24} />
          </button>
        </div>

        {/* ── Bottom bar ── */}
        <div style={{
          ...fade, position: "absolute", bottom: 0, left: 0, right: 0,
          padding: "0 14px 10px",
        }}>
          {/* Fila superior: tiempo + tiempo */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
              {formatTime(Math.round(currentTime))}
            </span>
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
              {formatTime(Math.round(duration))}
            </span>
          </div>
          {/* Barra de progreso al fondo */}
          <Scrubber current={currentTime} duration={duration || 1} onChange={seek} />
        </div>
      </div>
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function VideoIconsPreview() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const [scrubPos, setScrubPos] = useState(37);

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", padding: "40px 32px", fontFamily: "inherit" }}>

      {/* ── Subnav mobile actual ── */}
      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Subnav Mobile — Iconos actuales</h1>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 20 }}>
        MobileBottomNav · 3 ítems fijos · 26×26px stroke blanco
      </p>

      {/* Inactivo */}
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Inactivo</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, maxWidth: 440, marginBottom: 16 }}>
        {SUBNAV_ITEMS.map(({ label, name, icon: Icon }) => (
          <div key={name} style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 12, padding: "28px 12px",
            borderRadius: 12, background: "rgba(255,255,255,0.04)",
          }}>
            <Icon />
            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 600 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Activo */}
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Activo</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, maxWidth: 440, marginBottom: 56 }}>
        {SUBNAV_ITEMS.map(({ label, name, filled: FilledIcon }) => (
          <div key={`${name}-filled`} style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 12, padding: "28px 12px",
            borderRadius: 12, background: "rgba(255,255,255,0.04)",
          }}>
            <FilledIcon />
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 600 }}>{label}</span>
          </div>
        ))}
      </div>

      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>VibraVideoIcons — Preview</h1>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 32 }}>
        20px estándar · skip 24px · play/pausa 26px · sin contenedor
      </p>

      {/* Grid de íconos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 2, marginBottom: 48 }}>
        {ICONS.map(({ name, label, component: Icon, size }) => (
          <div key={name} style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 12, padding: "28px 12px",
            borderRadius: 12, background: "rgba(255,255,255,0.04)",
          }}>
            <button style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 32 }}>
              <Icon size={size ?? 20} />
            </button>
            <div style={{ textAlign: "center" }}>
              <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, display: "block" }}>{label}</span>
              <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>{name}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Badge EN VIVO + Espectadores */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Badge EN VIVO + Espectadores</h2>
      <div style={{ marginBottom: 40, display: "flex", alignItems: "center", gap: 12 }}>
        <VideoLiveBadge />
        <VideoViewerBadge count={8} />
        <VideoViewerBadge count={430} />
        <VideoViewerBadge count={1284} />
        <VideoViewerBadge count={5000} />
        <VideoViewerBadge count={12500} />
        <VideoViewerBadge count={1200000} />
      </div>

      {/* Velocidad */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Velocidad de reproducción</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 40 }}>
        {[0.5, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
          <div key={speed} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "16px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}>
            <VideoSpeedIcon speed={speed} size={20} />
            <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>VideoSpeedIcon</span>
          </div>
        ))}
      </div>

      {/* Contador */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Contador de tiempo</h2>
      <div style={{ marginBottom: 40, display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ padding: "16px 20px", borderRadius: 10, background: "rgba(255,255,255,0.04)", display: "inline-flex" }}>
          <svg width={80} height={20} viewBox="0 0 70 24" fill="none">
            <text x="0" y="17" fontSize="17" fontWeight="600" fontFamily="inherit" fill="rgba(255,255,255,0.9)">{formatTime(elapsed)}</text>
          </svg>
        </div>
        <div style={{ padding: "16px 20px", borderRadius: 10, background: "rgba(255,255,255,0.04)", display: "inline-flex" }}>
          <svg width={170} height={20} viewBox="0 0 160 24" fill="none">
            <text x="0" y="17" fontSize="17" fontWeight="600" fontFamily="inherit" fill="rgba(255,255,255,0.9)">{formatTime(elapsed)} / 45:00</text>
          </svg>
        </div>
      </div>

      {/* Barra de progreso */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Barra de progreso</h2>
      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "24px 20px", maxWidth: 600, marginBottom: 48 }}>
        <Scrubber current={scrubPos} duration={DURATION} onChange={setScrubPos} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>{formatTime(Math.round(scrubPos))}</span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>{formatTime(DURATION)}</span>
        </div>
      </div>

      {/* Video players */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 24 }}>Players con controles</h2>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 32, flexWrap: "wrap" }}>
        <VideoPlayer orientation="horizontal" label="Horizontal 16:9" />
        <VideoPlayer orientation="vertical" label="Vertical 9:16" />
      </div>
    </div>
  );
}
