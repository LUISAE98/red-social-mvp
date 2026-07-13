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
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

// ── Subnav mobile icons ────────────────────────────────────────────────────────

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

  const revealControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

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

        <div style={{
          ...fade, position: "absolute", top: 0, left: 0, right: 0,
          padding: "12px 48px 12px 14px",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button style={btnStyle} onClick={(e) => { e.stopPropagation(); setFullscreen(f => !f); }}>
              {fullscreen ? <VideoCompressIcon /> : <VideoExpandIcon />}
            </button>
            <button style={btnStyle} onClick={toggleMute}>
              {muted ? <VideoMuteIcon /> : <VideoUnmuteIcon />}
            </button>
          </div>
        </div>

        <button
          style={{ ...btnStyle, position: "absolute", top: 12, right: 14, zIndex: 10 }}
          onClick={(e) => e.stopPropagation()}
        >
          <VideoCloseIcon />
        </button>

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

        <div style={{
          ...fade, position: "absolute", bottom: 0, left: 0, right: 0,
          padding: "0 14px 10px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
              {formatTime(Math.round(currentTime))}
            </span>
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
              {formatTime(Math.round(duration))}
            </span>
          </div>
          <Scrubber current={currentTime} duration={duration || 1} onChange={seek} />
        </div>
      </div>
    </div>
  );
}

// ── Helpers visuales ──────────────────────────────────────────────────────────

function SectionLabel({ number, title, tag }: { number: number; title: string; tag?: "ok" | "warn" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, fontWeight: 700 }}>{number}</span>
      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {title}
      </span>
      {tag === "ok" && (
        <span style={{ fontSize: 10, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.28)", color: "#4ade80", padding: "2px 8px", borderRadius: 99, fontWeight: 700, letterSpacing: "0.06em" }}>
          ESTÁNDAR
        </span>
      )}
      {tag === "warn" && (
        <span style={{ fontSize: 10, background: "rgba(234,179,8,0.10)", border: "1px solid rgba(234,179,8,0.25)", color: "#fbbf24", padding: "2px 8px", borderRadius: 99, fontWeight: 700, letterSpacing: "0.06em" }}>
          FUERA DE ESTÁNDAR
        </span>
      )}
    </div>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: "rgba(255,255,255,0.28)", fontSize: 11.5, marginBottom: 18, lineHeight: 1.5 }}>
      {children}
    </p>
  );
}

function VibraToastMockup({ type, message }: { type: "success" | "error" | "warning"; message: string }) {
  const border =
    type === "success" ? "rgba(34,197,94,0.35)"
    : type === "error" ? "rgba(239,68,68,0.35)"
    : "rgba(255,255,255,0.14)";
  const iconBg =
    type === "success" ? "#22c55e"
    : type === "error" ? "#ef4444"
    : "#6b7280";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "10px 18px 10px 10px", borderRadius: 40,
      background: "#0a0a0a", border: `1.5px solid ${border}`,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
      color: "#fff", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: iconBg,
      }}>
        {type === "success" ? (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2.5 7L5 9.5L10.5 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : type === "error" ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M2 2L9 9M9 2L2 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1, color: "#fff" }}>!</span>
        )}
      </span>
      <span>{message}</span>
    </div>
  );
}

function TriggerBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.8)", borderRadius: 8, padding: "7px 14px",
        fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function VideoIconsPreview() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Simulación de countdown descendente para el mockup de videollamada (20 min)
  const [mockCountdown, setMockCountdown] = useState(20 * 60);
  useEffect(() => {
    const id = setInterval(() => setMockCountdown((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const [mockMic, setMockMic] = useState(true);
  const [mockCam, setMockCam] = useState(true);
  const [showTwoMinAlert, setShowTwoMinAlert] = useState(false);
  const twoMinShownRef = useRef(false);
  const [endSheet, setEndSheet] = useState<"hidden" | "confirm" | "feedback">("hidden");
  const [feedbackText, setFeedbackText] = useState("");
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    if (mockCountdown <= 120 && !twoMinShownRef.current) {
      twoMinShownRef.current = true;
      setShowTwoMinAlert(true);
      setTimeout(() => setShowTwoMinAlert(false), 4500);
    }
  }, [mockCountdown]);

  function timerColor(s: number): string {
    if (s > 240) return "rgba(255,255,255,0.75)";
    const p = (240 - s) / 240;
    const r = Math.round(255 + (239 - 255) * p);
    const g = Math.round(255 + (68 - 255) * p);
    const b = Math.round(255 + (68 - 255) * p);
    const a = (0.75 + 0.25 * p).toFixed(2);
    return `rgba(${r},${g},${b},${a})`;
  }

  const PIP_W = 200;
  const PIP_H = Math.round(PIP_W * 9 / 16);
  const PANEL_W = 800;
  const PANEL_H = 450;
  const [pipPos, setPipPos] = useState({ x: PANEL_W - PIP_W - 16, y: PANEL_H - PIP_H - 88 });
  const pipDragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  function handlePipDown(e: React.PointerEvent<HTMLDivElement>) {
    pipDragRef.current = { sx: e.clientX, sy: e.clientY, px: pipPos.x, py: pipPos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function handlePipMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pipDragRef.current) return;
    const x = Math.max(0, Math.min(PANEL_W - PIP_W, pipDragRef.current.px + e.clientX - pipDragRef.current.sx));
    const y = Math.max(0, Math.min(PANEL_H - PIP_H, pipDragRef.current.py + e.clientY - pipDragRef.current.sy));
    setPipPos({ x, y });
  }
  function handlePipUp() { pipDragRef.current = null; }

  // ── Estado panel móvil ────────────────────────────────────────────────────
  const [mockMicMobile, setMockMicMobile] = useState(true);
  const [mockCamMobile, setMockCamMobile] = useState(true);
  const [endSheetMobile, setEndSheetMobile] = useState<"hidden" | "confirm" | "feedback">("hidden");
  const [feedbackTextMobile, setFeedbackTextMobile] = useState("");
  const [sessionEndedMobile, setSessionEndedMobile] = useState(false);

  const MOBILE_W = 812;
  const MOBILE_H = 375;
  const PIP_WM = 170;
  const PIP_HM = Math.round(PIP_WM * 9 / 16);
  const [pipPosMobile, setPipPosMobile] = useState({ x: MOBILE_W - PIP_WM - 30, y: 16 });
  const pipDragRefMobile = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  function handlePipDownMobile(e: React.PointerEvent<HTMLDivElement>) {
    pipDragRefMobile.current = { sx: e.clientX, sy: e.clientY, px: pipPosMobile.x, py: pipPosMobile.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function handlePipMoveMobile(e: React.PointerEvent<HTMLDivElement>) {
    if (!pipDragRefMobile.current) return;
    const x = Math.max(0, Math.min(MOBILE_W - PIP_WM, pipDragRefMobile.current.px + e.clientX - pipDragRefMobile.current.sx));
    const y = Math.max(0, Math.min(MOBILE_H - PIP_HM, pipDragRefMobile.current.py + e.clientY - pipDragRefMobile.current.sy));
    setPipPosMobile({ x, y });
  }
  function handlePipUpMobile() { pipDragRefMobile.current = null; }

  const [scrubPos, setScrubPos] = useState(37);
  const { toast, showToast } = useVibraToast();
  const { toast: demoToast, showToast: showDemoToast } = useVibraToast(1400);

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", padding: "40px 32px", fontFamily: "inherit" }}>

      <VibraToast toast={toast} />
      <VibraToast toast={demoToast} />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SIMULACIÓN — PANTALLA DEL CREADOR (horizontal)                        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
        Simulación — Pantalla del creador (horizontal)
      </h1>
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 24 }}>
        Video grande = comprador · PiP esquina inferior-derecha = creador mismo · controles flotantes en el centro
      </p>

      <div style={{ marginBottom: 64 }}>
        {/* Marco laptop — representa el browser window */}
        <div style={{
          width: 960,
          maxWidth: "100%",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.10)",
          overflow: "hidden",
          background: "#0a0a0a",
        }}>
          {/* Chrome bar */}
          <div style={{
            height: 36, background: "#141414",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", padding: "0 14px", gap: 7, flexShrink: 0,
          }}>
            <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f57" }} />
            <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#ffbd2e" }} />
            <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#28ca41" }} />
          </div>

          {/* Área de página — overlay de videollamada */}
          <div style={{
            position: "relative", height: 536,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#040404",
          }}>
            {/* Panel de videollamada */}
            <div style={{
              position: "relative",
              width: 800, height: 450,
              maxWidth: "96%", maxHeight: "90%",
              borderRadius: 20,
              overflow: "hidden",
              background: "#0e1c2e",
              flexShrink: 0,
            }}>

              {/* Video del comprador */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://picsum.photos/seed/buyer/800/450" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />

              {/* Timer — top center */}
              <div style={{
                position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
                zIndex: 4,
                display: "inline-flex", alignItems: "center",
                background: "rgba(0,0,0,0.28)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                borderRadius: 6,
                padding: "4px 10px",
                whiteSpace: "nowrap",
              }}>
                <span style={{
                  fontFamily: "inherit",
                  fontSize: 14, fontWeight: 600,
                  color: timerColor(mockCountdown),
                  lineHeight: 1,
                }}>
                  {formatTime(mockCountdown)}
                </span>
              </div>

              {/* PiP — creador (arrastrable) */}
              <div
                onPointerDown={handlePipDown}
                onPointerMove={handlePipMove}
                onPointerUp={handlePipUp}
                onPointerCancel={handlePipUp}
                style={{
                  position: "absolute",
                  left: pipPos.x, top: pipPos.y,
                  width: PIP_W, height: PIP_H,
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "#1a2510",
                  zIndex: 3,
                  // eslint-disable-next-line react-hooks/refs
                  cursor: pipDragRef.current ? "grabbing" : "grab",
                  touchAction: "none",
                  userSelect: "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="https://picsum.photos/seed/creator/200/113" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              </div>


              {/* Aviso 2 minutos */}
              {showTwoMinAlert && (
                <div style={{
                  position: "absolute", inset: 0, zIndex: 6,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none",
                }}>
                  <div style={{
                    background: "rgba(0,0,0,0.35)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    borderRadius: 10,
                    padding: "10px 20px",
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)", letterSpacing: "0.01em" }}>
                      Quedan 2 minutos de sesión
                    </span>
                  </div>
                </div>
              )}

          {/* Controles flotantes */}
          <div style={{
            position: "absolute",
            bottom: 28, left: "50%", transform: "translateX(-50%)",
            zIndex: 5,
            display: "flex", gap: 28, alignItems: "center",
          }}>
            {/* Mic */}
            <button type="button" onClick={() => setMockMic(v => !v)} style={{
              position: "relative", background: "none", border: "none", padding: 4,
              cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              {!mockMic && (
                <span style={{ position: "absolute", bottom: 0, right: 0, width: 14, height: 14, borderRadius: "50%", background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </span>
              )}
            </button>

            {/* Cámara */}
            <button type="button" onClick={() => setMockCam(v => !v)} style={{
              position: "relative", background: "none", border: "none", padding: 4,
              cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              {!mockCam && (
                <span style={{ position: "absolute", bottom: 0, right: 0, width: 14, height: 14, borderRadius: "50%", background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </span>
              )}
            </button>

            {/* Terminar sesión */}
            <button type="button" onClick={() => setEndSheet("confirm")} style={{
              background: "none", border: "none", padding: 4,
              cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>{/* /controles */}

              {/* Pantalla negra al terminar sesión */}
              {sessionEnded && (
                <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 7 }} />
              )}

              {/* Panel Vibra — confirmar / feedback */}
              {endSheet !== "hidden" && (
                <>
                  <style>{`
                    @keyframes vibraEndPanelIn {
                      from { opacity: 0; transform: scale(0.94) translateY(10px); }
                      to   { opacity: 1; transform: scale(1) translateY(0); }
                    }
                  `}</style>
                  <div
                    style={{
                      position: "absolute", inset: 0, zIndex: 10,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: 24,
                      background: "rgba(0,0,0,0.88)",
                      fontFamily: "inherit",
                    }}
                    onMouseDown={e => { if (e.target === e.currentTarget && endSheet === "confirm") setEndSheet("hidden"); }}
                  >
                    <section style={{
                      width: "min(100%, 380px)",
                      borderRadius: 18,
                      background: "#0a0a0a",
                      boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
                      color: "#fff",
                      overflow: "hidden",
                      animation: "vibraEndPanelIn 180ms ease-out",
                    }}>

                      {/* Header */}
                      <header style={{
                        height: 56,
                        display: "grid",
                        gridTemplateColumns: "48px 1fr 48px",
                        alignItems: "center",
                        padding: "0 12px",
                        borderBottom: "1px solid rgba(255,255,255,0.12)",
                        flexShrink: 0,
                      }}>
                        <div aria-hidden="true" />
                        <span style={{
                          fontSize: 17, fontWeight: 500, color: "#fff",
                          lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em",
                        }}>
                          {endSheet === "confirm" ? "Terminar sesión" : "Sesión terminada"}
                        </span>
                        {endSheet === "confirm" ? (
                          <button type="button" onClick={() => setEndSheet("hidden")} style={{
                            border: "none", background: "none", color: "#fff",
                            cursor: "pointer", display: "grid", placeItems: "center",
                            justifySelf: "end", padding: 4,
                            fontSize: 32, fontWeight: 300, lineHeight: 1,
                          }}>×</button>
                        ) : (
                          <div aria-hidden="true" />
                        )}
                      </header>

                      {/* Confirmar */}
                      {endSheet === "confirm" && (
                        <>
                          <div style={{ padding: "18px 20px 8px" }}>
                            <p style={{ color: "rgba(255,255,255,0.70)", fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                              ¿Estás seguro de que quieres acabar la sesión antes de tiempo? Después nos dejarás un mensaje para decirnos qué pasó.
                            </p>
                          </div>
                          <div style={{ padding: "14px 20px 18px", borderTop: "1px solid rgba(255,255,255,0.12)", display: "flex", flexDirection: "column", gap: 10 }}>
                            <button type="button" onClick={() => { setSessionEnded(true); setEndSheet("feedback"); }} style={{
                              width: "100%", height: 42, borderRadius: 5, border: "none",
                              background: "#ef4444", color: "rgba(255,255,255,0.98)",
                              fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                              cursor: "pointer", letterSpacing: "-0.02em",
                              display: "grid", placeItems: "center",
                            }}>
                              Sí, terminar sesión
                            </button>
                            <button type="button" onClick={() => setEndSheet("hidden")} style={{
                              width: "100%", height: 42, borderRadius: 5, border: "none",
                              background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)",
                              fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                              cursor: "pointer", letterSpacing: "-0.02em",
                              display: "grid", placeItems: "center",
                            }}>
                              No, continuar
                            </button>
                          </div>
                        </>
                      )}

                      {/* Feedback */}
                      {endSheet === "feedback" && (
                        <>
                          <div style={{ padding: "18px 20px 8px" }}>
                            <textarea
                              placeholder="Dinos qué pasó..."
                              value={feedbackText}
                              onChange={e => setFeedbackText(e.target.value)}
                              rows={4}
                              style={{
                                width: "100%", boxSizing: "border-box",
                                background: "rgba(255,255,255,0.06)",
                                border: "none",
                                borderRadius: 12, padding: "10px 12px",
                                color: "#fff", fontSize: 13, resize: "none",
                                fontFamily: "inherit", outline: "none",
                                lineHeight: 1.5,
                              }}
                            />
                          </div>
                          <div style={{ padding: "14px 20px 18px", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                            <button type="button" onClick={() => { setEndSheet("hidden"); setFeedbackText(""); setSessionEnded(false); }} style={{
                              width: "100%", height: 42, borderRadius: 5, border: "none",
                              background: "#a855ff", color: "rgba(255,255,255,0.98)",
                              fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                              cursor: "pointer", letterSpacing: "-0.02em",
                              display: "grid", placeItems: "center",
                            }}>
                              Enviar
                            </button>
                          </div>
                        </>
                      )}

                    </section>
                  </div>
                </>
              )}

            </div>{/* /panel videollamada */}
          </div>{/* /área de página */}
        </div>{/* /marco laptop */}
      </div>{/* /marginBottom */}

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginBottom: 56 }} />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SIMULACIÓN — CELULAR                                                  */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
        Simulación — Pantalla del creador (celular)
      </h1>
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 24 }}>
        Video ocupa toda la pantalla · sin esquinas redondeadas · respeta safe area
      </p>

      <div style={{ marginBottom: 64 }}>
        {/* Marco teléfono — landscape */}
        <div style={{
          width: MOBILE_W,
          height: MOBILE_H,
          borderRadius: 44,
          border: "8px solid #1c1c1e",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 24px 64px rgba(0,0,0,0.8)",
          overflow: "hidden",
          position: "relative",
          background: "#000",
          flexShrink: 0,
        }}>

          {/* Video del comprador — respeta safe areas laterales */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://picsum.photos/seed/buyer-mobile/812/375" alt="" style={{ position: "absolute", top: 0, bottom: 0, left: 50, right: 30, objectFit: "cover" }} />

          {/* Safe area izquierda — Dynamic Island landscape (izquierda) */}
          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 50, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 12, height: 60, borderRadius: 8, background: "#000" }} />
          </div>

          {/* Timer — centrado arriba */}
          <div style={{
            position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
            zIndex: 4,
            display: "inline-flex", alignItems: "center",
            background: "rgba(0,0,0,0.28)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            borderRadius: 6,
            padding: "4px 10px",
            whiteSpace: "nowrap",
          }}>
            <span style={{
              fontFamily: "inherit", fontSize: 14, fontWeight: 600,
              color: timerColor(mockCountdown), lineHeight: 1,
            }}>
              {formatTime(mockCountdown)}
            </span>
          </div>

          {/* PiP — arrastrable */}
          <div
            onPointerDown={handlePipDownMobile}
            onPointerMove={handlePipMoveMobile}
            onPointerUp={handlePipUpMobile}
            onPointerCancel={handlePipUpMobile}
            style={{
              position: "absolute",
              left: pipPosMobile.x, top: pipPosMobile.y,
              width: PIP_WM, height: PIP_HM,
              borderRadius: 10,
              overflow: "hidden",
              background: "#1a2510",
              zIndex: 3,
              // eslint-disable-next-line react-hooks/refs
              cursor: pipDragRefMobile.current ? "grabbing" : "grab",
              touchAction: "none",
              userSelect: "none",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://picsum.photos/seed/creator-mobile-l/120/68" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>

          {/* Aviso 2 minutos */}
          {showTwoMinAlert && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
            }}>
              <div style={{
                background: "rgba(0,0,0,0.35)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                borderRadius: 10,
                padding: "10px 20px",
              }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)", letterSpacing: "0.01em" }}>
                  Quedan 2 minutos de sesión
                </span>
              </div>
            </div>
          )}

          {/* Controles flotantes — centrados abajo, safe area derecha en landscape */}
          <div style={{
            position: "absolute",
            bottom: 0, left: 50, right: 30,
            zIndex: 5,
            display: "flex", gap: 40, justifyContent: "center", alignItems: "center",
            paddingBottom: 20, paddingTop: 16,
          }}>
            {/* Mic */}
            <button type="button" onClick={() => setMockMicMobile(v => !v)} style={{
              position: "relative", background: "none", border: "none", padding: 4,
              cursor: "pointer", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              {!mockMicMobile && (
                <span style={{ position: "absolute", bottom: 0, right: 0, width: 14, height: 14, borderRadius: "50%", background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </span>
              )}
            </button>

            {/* Cámara */}
            <button type="button" onClick={() => setMockCamMobile(v => !v)} style={{
              position: "relative", background: "none", border: "none", padding: 4,
              cursor: "pointer", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              {!mockCamMobile && (
                <span style={{ position: "absolute", bottom: 0, right: 0, width: 14, height: 14, borderRadius: "50%", background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </span>
              )}
            </button>

            {/* Terminar sesión */}
            <button type="button" onClick={() => setEndSheetMobile("confirm")} style={{
              background: "none", border: "none", padding: 4,
              cursor: "pointer", color: "#ef4444",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Pantalla negra al terminar */}
          {sessionEndedMobile && (
            <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 7 }} />
          )}

          {/* Panel Vibra móvil */}
          {endSheetMobile !== "hidden" && (
            <>
              <style>{`
                @keyframes vibraEndPanelInM {
                  from { opacity: 0; transform: scale(0.94) translateY(10px); }
                  to   { opacity: 1; transform: scale(1) translateY(0); }
                }
              `}</style>
              <div
                style={{
                  position: "absolute", inset: 0, zIndex: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 20,
                  background: "rgba(0,0,0,0.88)",
                  fontFamily: "inherit",
                }}
                onMouseDown={e => { if (e.target === e.currentTarget && endSheetMobile === "confirm") setEndSheetMobile("hidden"); }}
              >
                <section style={{
                  width: "100%",
                  borderRadius: 18,
                  background: "#0a0a0a",
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
                  color: "#fff",
                  overflow: "hidden",
                  animation: "vibraEndPanelInM 180ms ease-out",
                }}>
                  <header style={{
                    height: 56,
                    display: "grid",
                    gridTemplateColumns: "48px 1fr 48px",
                    alignItems: "center",
                    padding: "0 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.12)",
                    flexShrink: 0,
                  }}>
                    <div aria-hidden="true" />
                    <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em" }}>
                      {endSheetMobile === "confirm" ? "Terminar sesión" : "Sesión terminada"}
                    </span>
                    {endSheetMobile === "confirm" ? (
                      <button type="button" onClick={() => setEndSheetMobile("hidden")} style={{
                        border: "none", background: "none", color: "#fff", cursor: "pointer",
                        display: "grid", placeItems: "center", justifySelf: "end", padding: 4,
                        fontSize: 32, fontWeight: 300, lineHeight: 1,
                      }}>×</button>
                    ) : <div aria-hidden="true" />}
                  </header>

                  {endSheetMobile === "confirm" && (
                    <>
                      <div style={{ padding: "18px 20px 8px" }}>
                        <p style={{ color: "rgba(255,255,255,0.70)", fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                          ¿Estás seguro de que quieres acabar la sesión antes de tiempo? Después nos dejarás un mensaje para decirnos qué pasó.
                        </p>
                      </div>
                      <div style={{ padding: "14px 20px 18px", borderTop: "1px solid rgba(255,255,255,0.12)", display: "flex", flexDirection: "column", gap: 10 }}>
                        <button type="button" onClick={() => { setSessionEndedMobile(true); setEndSheetMobile("feedback"); }} style={{
                          width: "100%", height: 42, borderRadius: 5, border: "none",
                          background: "#ef4444", color: "rgba(255,255,255,0.98)",
                          fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                          cursor: "pointer", letterSpacing: "-0.02em",
                          display: "grid", placeItems: "center",
                        }}>
                          Sí, terminar sesión
                        </button>
                        <button type="button" onClick={() => setEndSheetMobile("hidden")} style={{
                          width: "100%", height: 42, borderRadius: 5, border: "none",
                          background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)",
                          fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                          cursor: "pointer", letterSpacing: "-0.02em",
                          display: "grid", placeItems: "center",
                        }}>
                          No, continuar
                        </button>
                      </div>
                    </>
                  )}

                  {endSheetMobile === "feedback" && (
                    <>
                      <div style={{ padding: "18px 20px 8px" }}>
                        <textarea
                          placeholder="Dinos qué pasó..."
                          value={feedbackTextMobile}
                          onChange={e => setFeedbackTextMobile(e.target.value)}
                          rows={4}
                          style={{
                            width: "100%", boxSizing: "border-box",
                            background: "rgba(255,255,255,0.06)",
                            border: "none", borderRadius: 12,
                            padding: "10px 12px", color: "#fff",
                            fontSize: 13, resize: "none",
                            fontFamily: "inherit", outline: "none", lineHeight: 1.5,
                          }}
                        />
                      </div>
                      <div style={{ padding: "14px 20px 18px", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                        <button type="button" onClick={() => { setEndSheetMobile("hidden"); setFeedbackTextMobile(""); setSessionEndedMobile(false); }} style={{
                          width: "100%", height: 42, borderRadius: 5, border: "none",
                          background: "#a855ff", color: "rgba(255,255,255,0.98)",
                          fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                          cursor: "pointer", letterSpacing: "-0.02em",
                          display: "grid", placeItems: "center",
                        }}>
                          Enviar
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </div>
            </>
          )}

        </div>{/* /marco teléfono */}
      </div>{/* /marginBottom */}

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginBottom: 56 }} />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* NUEVOS ICONOS — EN PROCESO                                            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
        Nuevos iconos — En proceso
      </h1>
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 32 }}>
        Minimalistas · stroke blanco · 24×24px viewBox · para iterar uno por uno
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 2, maxWidth: 800, marginBottom: 64 }}>

        {/* Reloj */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Reloj</span>
        </div>

        {/* Cámara de video */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="6" width="14" height="12" rx="2" />
            <path d="M16 10l6-3v10l-6-3V10Z" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Cámara</span>
        </div>

        {/* Calendario */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 10h18M8 2v4M16 2v4" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Calendario</span>
        </div>

        {/* Estrella */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.5L12 17l-5.9 3 1.2-6.5L2.5 9l6.6-.9L12 2Z" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Estrella</span>
        </div>

        {/* Palomita en círculo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12.5l3 3 5-5" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Check</span>
        </div>

        {/* Info (i en círculo) */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4" />
            <circle cx="12" cy="8" r="0.5" fill="#fff" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Info</span>
        </div>

        {/* Tiro al blanco */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1.5" fill="#fff" stroke="none" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Objetivo</span>
        </div>

        {/* Candado */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            <circle cx="12" cy="16" r="1" fill="#fff" stroke="none" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Candado</span>
        </div>

        {/* Descargable */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "28px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 11l5 5 5-5" />
            <path d="M4 19h16" />
          </svg>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>Descargable</span>
        </div>

      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginBottom: 56 }} />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* AVISOS Y NOTIFICACIONES                                               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
        Estilos de Avisos — Inventario Actual
      </h1>
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 48 }}>
        Todos los patrones de notificación conviviendo en la plataforma. El objetivo es unificarlos.
      </p>

      {/* ── 1. VibraToast ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 52 }}>
        <SectionLabel number={1} title="VibraToast" tag="ok" />
        <Meta>
          Fijo · abajo al centro · 88px sobre el nav · animación expand + pop icon · z-index 11500 · 3500ms auto-dismiss{"\n"}
          Usado en: PostEditModal · disponible via useVibraToast()
        </Meta>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          <VibraToastMockup type="success" message="Suscripción aprobada" />
          <VibraToastMockup type="error" message="No se pudo completar la acción" />
          <VibraToastMockup type="warning" message="Revisa los datos antes de continuar" />
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <TriggerBtn label="Disparar éxito" onClick={() => showToast("Suscripción aprobada", "success")} />
          <TriggerBtn label="Disparar error" onClick={() => showToast("No se pudo completar la acción", "error")} />
          <TriggerBtn label="Disparar warning" onClick={() => showToast("Revisa los datos antes de continuar", "warning")} />
        </div>

        <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
            Demo animación de salida — ciclo completo en 1.4s
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <TriggerBtn label="⚡ Ver entrada + salida (éxito)" onClick={() => showDemoToast("Toast de prueba — mira la salida", "success")} />
            <TriggerBtn label="⚡ Ver entrada + salida (error)" onClick={() => showDemoToast("Error de prueba", "error")} />
          </div>
        </div>
      </div>

      {/* ── 2. CopyLinkButton Toast ───────────────────────────────────────── */}
      <div style={{ marginBottom: 52 }}>
        <SectionLabel number={2} title="CopyLinkButton Toast (implementación propia)" tag="warn" />
        <Meta>
          Fijo · abajo al centro · 24px del bottom (no 88px) · blur backdrop · sin ícono · pill · z-index 11000 · 2400ms{"\n"}
          Diferencias vs VibraToast: posición distinta, sin ícono, blur, border 1px (no 1.5px), fondo con opacidad
        </Meta>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Success */}
          <div style={{
            display: "inline-block",
            padding: "10px 12px", borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(12,12,12,0.94)",
            color: "#fff", fontSize: 13, fontWeight: 600,
            boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            backdropFilter: "blur(10px)",
          }}>
            Link copiado correctamente
          </div>
          {/* Error */}
          <div style={{
            display: "inline-block",
            padding: "10px 12px", borderRadius: 999,
            border: "1px solid rgba(255,90,90,0.30)",
            background: "rgba(80,12,12,0.94)",
            color: "#fff", fontSize: 13, fontWeight: 600,
            boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            backdropFilter: "blur(10px)",
          }}>
            No se pudo copiar el link.
          </div>
        </div>
      </div>

      {/* ── 3. messageBox (inline neutral) ───────────────────────────────── */}
      <div style={{ marginBottom: 52 }}>
        <SectionLabel number={3} title="messageBox — inline en modales de servicios" tag="warn" />
        <Meta>
          Inline · dentro del modal · mismo estilo para éxito Y error · sin color semántico · sin ícono{"\n"}
          Usado en: GroupServiceModals, CreatorServiceModals, ProfileClient — para greetError, greetSuccess, subscriptionError, params.error
        </Meta>

        <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Éxito — mismo estilo que error */}
          <div style={{
            padding: "10px 12px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.05)",
            fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.92)", lineHeight: 1.45,
          }}>
            Suscripción aprobada — (éxito, mismo estilo que error)
          </div>
          {/* Error — mismo estilo que éxito */}
          <div style={{
            padding: "10px 12px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.05)",
            fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.92)", lineHeight: 1.45,
          }}>
            No se pudo procesar tu solicitud — (error, mismo estilo que éxito)
          </div>
        </div>
      </div>

      {/* ── 4. InviteLinkModal noticeStyle ───────────────────────────────── */}
      <div style={{ marginBottom: 52 }}>
        <SectionLabel number={4} title="InviteLinkModal — noticeStyle (info/neutro)" tag="warn" />
        <Meta>
          Inline · dentro del modal · para confirmaciones neutras{"\n"}
          Usado en: &quot;Link generado. Ya puedes copiarlo.&quot; · &quot;Link copiado al portapapeles.&quot;
        </Meta>

        <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            borderRadius: 9,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.035)",
            padding: "7px 9px",
            fontSize: 11.5, lineHeight: 1.35, color: "rgba(255,255,255,0.84)",
          }}>
            Link generado. Ya puedes copiarlo y compartirlo.
          </div>
          <div style={{
            borderRadius: 9,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.035)",
            padding: "7px 9px",
            fontSize: 11.5, lineHeight: 1.35, color: "rgba(255,255,255,0.84)",
          }}>
            Link copiado al portapapeles.
          </div>
        </div>
      </div>

      {/* ── 5. InviteLinkModal errorStyle ────────────────────────────────── */}
      <div style={{ marginBottom: 52 }}>
        <SectionLabel number={5} title="InviteLinkModal — errorStyle (error rojo suave)" tag="warn" />
        <Meta>
          Inline · dentro del modal · para errores de validación de forma de invitación{"\n"}
          Usado en: &quot;La duración debe ser mayor a 0.&quot; · &quot;Los días deben estar entre 1 y 30.&quot; · &quot;Los usos deben estar entre 1 y 1000.&quot;
        </Meta>

        <div style={{ maxWidth: 480 }}>
          <div style={{
            borderRadius: 9,
            border: "1px solid rgba(248,113,113,0.22)",
            background: "rgba(239,68,68,0.12)",
            padding: "7px 9px",
            fontSize: 11.5, lineHeight: 1.35, color: "#fecaca",
          }}>
            La duración debe ser mayor a 0.
          </div>
        </div>
      </div>

      {/* ── 6. LiveComposerModal error ────────────────────────────────────── */}
      <div style={{ marginBottom: 52 }}>
        <SectionLabel number={6} title="LiveComposerModal — error (rojo más oscuro)" tag="warn" />
        <Meta>
          Inline · dentro del modal de crear live · fondo más oscuro/saturado que errorStyle{"\n"}
          Usado en: errores de validación de título, fecha, precio del ticket
        </Meta>

        <div style={{ maxWidth: 480 }}>
          <div style={{
            borderRadius: 10,
            border: "1px solid rgba(255,90,90,0.24)",
            background: "rgba(120,18,18,0.28)",
            padding: "9px 12px",
            fontSize: 12, lineHeight: 1.4, color: "#ffdada",
          }}>
            El título es obligatorio.
          </div>
        </div>
      </div>

      {/* ── 7. serviceToastStyle (inline toast en modales) ───────────────── */}
      <div style={{ marginBottom: 52 }}>
        <SectionLabel number={7} title="serviceToastStyle — toast inline dentro de modales" tag="warn" />
        <Meta>
          Fijo · bottom 24px · pero renderizado dentro del contexto del modal · sin ícono · pill · blur{"\n"}
          Pasado como prop a CreatorServiceModals / GroupServiceModals / StoryViewer
        </Meta>

        <div style={{ position: "relative", height: 80, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)" }}>
            <div style={{
              padding: "10px 12px", borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(12,12,12,0.94)",
              color: "#fff", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
              backdropFilter: "blur(10px)",
            }}>
              Solicitud enviada correctamente
            </div>
          </div>
          <span style={{ position: "absolute", top: 10, left: 12, color: "rgba(255,255,255,0.2)", fontSize: 10 }}>— modal container —</span>
        </div>
      </div>

      {/* ── Tabla resumen ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 64 }}>
        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
          Resumen de diferencias
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, fontSize: 11, borderRadius: 10, overflow: "hidden" }}>
          {[
            ["Estilo", "Posición", "Ícono", "Variantes"],
            ["VibraToast ✅", "Fijo bottom 88px", "Sí (círculo color)", "success / error / warning"],
            ["CopyLinkButton", "Fijo bottom 24px", "No", "success / error"],
            ["messageBox", "Inline en modal", "No", "solo neutro (éxito=error)"],
            ["noticeStyle", "Inline en modal", "No", "solo neutro"],
            ["errorStyle", "Inline en modal", "No", "solo error (rosa suave)"],
            ["LiveComposer err", "Inline en modal", "No", "solo error (rojo oscuro)"],
            ["serviceToastStyle", "Fijo bottom 24px*", "No", "solo neutro"],
          ].map((row, ri) => (
            row.map((cell, ci) => (
              <div key={`${ri}-${ci}`} style={{
                padding: "8px 12px",
                background: ri === 0 ? "rgba(255,255,255,0.06)" : ri === 1 ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.025)",
                color: ri === 0 ? "rgba(255,255,255,0.5)" : ci === 0 ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.4)",
                fontWeight: ri === 0 || ci === 0 ? 600 : 400,
                lineHeight: 1.4,
              }}>
                {cell}
              </div>
            ))
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginBottom: 56 }} />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SUBNAV MOBILE                                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Subnav Mobile — Iconos actuales</h1>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 20 }}>
        MobileBottomNav · 3 ítems fijos · 26×26px stroke blanco
      </p>

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

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIDEO ICONS                                                            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>VibraVideoIcons — Preview</h1>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 32 }}>
        20px estándar · skip 24px · play/pausa 26px · sin contenedor
      </p>

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

      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Velocidad de reproducción</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 40 }}>
        {[0.5, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
          <div key={speed} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "16px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}>
            <VideoSpeedIcon speed={speed} size={20} />
            <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>VideoSpeedIcon</span>
          </div>
        ))}
      </div>

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

      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Barra de progreso</h2>
      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "24px 20px", maxWidth: 600, marginBottom: 48 }}>
        <Scrubber current={scrubPos} duration={DURATION} onChange={setScrubPos} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>{formatTime(Math.round(scrubPos))}</span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>{formatTime(DURATION)}</span>
        </div>
      </div>

      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 24 }}>Players con controles</h2>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 32, flexWrap: "wrap" }}>
        <VideoPlayer orientation="horizontal" label="Horizontal 16:9" />
        <VideoPlayer orientation="vertical" label="Vertical 9:16" />
      </div>

    </div>
  );
}
