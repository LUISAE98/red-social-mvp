"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import SessionIntro from "@/app/[locale]/egress/session/SessionIntro";
import SessionOutro, { type OutroMode } from "@/app/[locale]/egress/session/SessionOutro";
import SessionOverlay from "@/app/[locale]/egress/session/SessionOverlay";
import GreetingDownloadPreview from "./GreetingDownloadPreview";
import {
  GroupCategoryPill,
  CelebrationBurst,
  celebTimings,
  INTEREST_GRID_MIN_COL,
  INTEREST_GRID_GAP,
  INTEREST_SLIDE_VARIANTS,
} from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import { GROUP_CATEGORY_OPTIONS, type CanonicalGroupCategory } from "@/types/group";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
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
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { BRAND_DOMAIN } from "@/lib/brand";

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

function InterestsOnboardingSandbox() {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  const [selectedCategories, setSelectedCategories] = useState<CanonicalGroupCategory[]>([]);
  const [interestsPage, setInterestsPage] = useState(0);
  const [interestsDirection, setInterestsDirection] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const [interestsGridEl, setInterestsGridEl] = useState<HTMLDivElement | null>(null);
  const [interestsColumns, setInterestsColumns] = useState(4);
  const [interestsContainerWidth, setInterestsContainerWidth] = useState(0);

  const minCategories = 1;

  const toggleCategory = (value: CanonicalGroupCategory) =>
    setSelectedCategories((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );

  // Mide cuántas columnas caben en el grid para paginar en renglones completos.
  useEffect(() => {
    if (!interestsGridEl || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      const w = interestsGridEl.clientWidth;
      if (w <= 0) return;
      const cols = Math.max(
        1,
        Math.floor((w + INTEREST_GRID_GAP) / (INTEREST_GRID_MIN_COL + INTEREST_GRID_GAP))
      );
      setInterestsColumns(cols);
      setInterestsContainerWidth(w);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(interestsGridEl);
    return () => ro.disconnect();
  }, [interestsGridEl]);

  const interestsPerPage = Math.max(1, interestsColumns * 2);
  const interestPageCount = Math.ceil(GROUP_CATEGORY_OPTIONS.length / interestsPerPage);
  const interestPage = Math.min(interestsPage, Math.max(0, interestPageCount - 1));
  const interestPageOptions = GROUP_CATEGORY_OPTIONS.slice(
    interestPage * interestsPerPage,
    (interestPage + 1) * interestsPerPage
  );
  const isLastInterestPage = interestPage >= interestPageCount - 1;

  const interestRows = Math.max(1, Math.ceil(interestPageOptions.length / interestsColumns));
  const interestColWidth =
    interestsContainerWidth > 0
      ? (interestsContainerWidth - (interestsColumns - 1) * INTEREST_GRID_GAP) / interestsColumns
      : 0;
  const interestsGridHeight =
    interestColWidth > 0
      ? interestRows * interestColWidth + (interestRows - 1) * INTEREST_GRID_GAP
      : undefined;

  const reset = () => {
    setCelebrating(false);
    setSelectedCategories([]);
    setInterestsPage(0);
    setInterestsDirection(0);
  };

  const selectedOptions = useMemo(
    () => GROUP_CATEGORY_OPTIONS.filter((o) => selectedCategories.includes(o.value)),
    [selectedCategories]
  );

  // El área de la celebración conserva el alto del grid para que nada salte al
  // entrar; si aún no se midió, un alto razonable de respaldo.
  const celebHeight = interestsGridHeight ?? 300;

  // El texto y los botones se van justo cuando empiezan a salir los avatares.
  const chromeFade = celebrating
    ? { delay: celebTimings(selectedOptions.length).outStart, duration: 0.55, ease: "easeOut" as const }
    : { duration: 0.2 };

  const gradientBtn = (enabled: boolean): React.CSSProperties => ({
    marginLeft: "auto",
    border: "none",
    borderRadius: 10,
    padding: "7px 32px",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: "-0.01em",
    color: enabled ? "#fff" : "rgba(255,255,255,0.6)",
    backgroundColor: enabled ? "transparent" : "rgba(255,255,255,0.16)",
    backgroundImage: enabled
      ? "linear-gradient(100deg, #ff2fb3 0%, #a855ff 35%, #4f46ff 70%, #ff2fb3 100%)"
      : "none",
    backgroundSize: "280% 280%",
    backgroundPosition: "0% 50%",
    boxShadow: enabled ? "0 10px 28px rgba(168,85,255,0.22)" : "none",
    cursor: enabled ? "pointer" : "default",
    overflow: "hidden",
    fontFamily: "inherit",
  });

  return (
    <>
      <motion.div initial={false} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <style>{`
          .vibInterestsGradient {
            background: linear-gradient(100deg, #ff2fb3 0%, #a855ff 45%, #4f46ff 100%);
            background-size: 220% 220%;
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            animation: vibInterestsFlow 4.5s ease-in-out infinite;
          }
          @keyframes vibInterestsFlow {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
          }
          .vibCatIcon { will-change: transform; }
          .vibCatCard:hover .vibCatIcon { transform: scale(1.08); }
        `}</style>

        <motion.div
          initial={false}
          animate={celebrating ? { opacity: 0, y: -6 } : { opacity: 1, y: 0 }}
          transition={chromeFade}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center" }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "#a855ff", letterSpacing: "0.01em" }}>
            {tGroups("interestsIntro")}
          </span>
          <span style={{ fontSize: 26.4, fontWeight: 665, lineHeight: 1.15, color: "#fff" }}>
            {tGroups("interestsTitlePre")}{" "}
            <span className="vibInterestsGradient" style={{ fontWeight: 740 }}>
              {tGroups("interestsTitleHighlight")}
            </span>
          </span>
          <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.6)" }}>
            {tGroups("interestsSubtitle")}
          </span>
          <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.45)" }}>
            {tGroups("interestsFootnote")}
          </span>
          <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(168,85,255,0.55)" }}>
            {tGroups("interestsMinHint")}
          </span>
        </motion.div>

        {celebrating ? (
          <CelebrationBurst
            categories={selectedOptions}
            width={interestsContainerWidth}
            height={celebHeight}
          />
        ) : (
            <motion.div
              ref={setInterestsGridEl}
              animate={{ height: interestsGridHeight ?? "auto" }}
              transition={{ height: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
              style={{ position: "relative", width: "100%", overflow: "hidden" }}
            >
              <AnimatePresence initial={false} custom={interestsDirection} mode="popLayout">
                <motion.div
                  key={interestPage}
                  custom={interestsDirection}
                  variants={INTEREST_SLIDE_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.4 },
                    opacity: { duration: 0.25 },
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(auto-fill, minmax(${INTEREST_GRID_MIN_COL}px, 1fr))`,
                    gap: INTEREST_GRID_GAP,
                    width: "100%",
                  }}
                >
                  {interestPageOptions.map((option) => (
                    <GroupCategoryPill
                      key={option.value}
                      label={option.label}
                      category={option.value}
                      selected={selectedCategories.includes(option.value)}
                      onToggle={() => toggleCategory(option.value)}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>
            </motion.div>
        )}

        <motion.div
          initial={false}
          animate={celebrating ? { opacity: 0, y: -6 } : { opacity: 1, y: 0 }}
          transition={chromeFade}
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: celebrating ? "none" : "auto",
          }}
        >
              {interestPage > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setInterestsDirection(-1);
                    setInterestsPage(interestPage - 1);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    color: "#a855ff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {tGroups("interestsGoBack")}
                </button>
              )}

              {isLastInterestPage ? (
                <button
                  type="button"
                  onClick={() => setCelebrating(true)}
                  disabled={selectedCategories.length < minCategories}
                  style={gradientBtn(selectedCategories.length >= minCategories)}
                >
                  {tCommon("continue")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setInterestsDirection(1);
                    setInterestsPage(interestPage + 1);
                  }}
                  style={gradientBtn(true)}
                >
                  {tCommon("next")}
                </button>
              )}
        </motion.div>
      </motion.div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 18 }}>
        <TriggerBtn label="Reiniciar" onClick={reset} />
        <span style={{ color: "rgba(255,255,255,0.32)", fontSize: 12 }}>
          Página {interestPage + 1}/{interestPageCount} · {interestsColumns} columnas ·{" "}
          {selectedCategories.length} seleccionados
        </span>
      </div>
    </>
  );
}

// ── Simuladores de dispositivo (lienzos para diseñar los paneles de ──────────
//    supercomentarios / donación en vivo, poco a poco) ──────────────────────
function PhoneFrame({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {label && (
        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600 }}>{label}</span>
      )}
      <div
        style={{
          position: "relative",
          width: 300,
          height: 630,
          borderRadius: 46,
          padding: 11,
          background: "linear-gradient(150deg, #2c2c30, #101012)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      >
        {/* Pantalla */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 36,
            overflow: "hidden",
            background: "#050506",
          }}
        >
          {/* Dynamic island */}
          <div
            style={{
              position: "absolute",
              top: 11,
              left: "50%",
              transform: "translateX(-50%)",
              width: 98,
              height: 27,
              borderRadius: 20,
              background: "#000",
              zIndex: 5,
            }}
          />
          {children}
        </div>
      </div>
    </div>
  );
}

function DesktopFrame({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {label && (
        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600 }}>{label}</span>
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* Monitor */}
        <div
          style={{
            width: 780,
            maxWidth: "100%",
            borderRadius: 18,
            padding: 12,
            background: "linear-gradient(150deg, #2c2c30, #101012)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: 8,
              overflow: "hidden",
              background: "#050506",
            }}
          >
            {children}
          </div>
        </div>
        {/* Soporte */}
        <div
          style={{
            width: 96,
            height: 44,
            background: "linear-gradient(#1c1c1f, #141416)",
            clipPath: "polygon(30% 0, 70% 0, 100% 100%, 0 100%)",
          }}
        />
        <div style={{ width: 190, height: 12, borderRadius: 8, background: "#1c1c1f" }} />
      </div>
    </div>
  );
}

// ── Mockup: espectador de un LIVE horizontal en celular vertical ─────────────
//    Réplica del layout real de LiveViewerModal (rama "MOBILE — horizontal:
//    video top + chat panel below"): video 16:9 arriba + info del creador + chat.
function LiveChatMsg({ initial, color, name, text }: { initial: string; color: string; name: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "center" }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: color, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>
        {initial}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", marginRight: 4 }}>{name}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.4, wordBreak: "break-word" }}>{text}</span>
      </div>
    </div>
  );
}

// ── Mockup: pasarela de donación del live ────────────────────────────────────
//    Réplica visual del ServicePaymentModal (modo donación / monto editable) del
//    perfil. `narrow` = layout móvil apilado (Celular 1); false = dos columnas
//    (Ordenador). Estática, sin SDK real de MP — solo para diseñar.
function DonationGatewayMockup({ narrow, onClose }: { narrow: boolean; onClose: () => void }) {
  const MP_BLUE = "#009ee3";
  const pf = usePriceFormat();
  // Montos sugeridos: anclas en MXN; se muestran (y se convierten) en la moneda del usuario.
  const DONATION_PRESETS_MXN = [30, 70, 140, 240];
  const [method, setMethod] = useState<"credit" | "debit" | null>(null);
  const [amount, setAmount] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");

  // El botón "Pagar" (igual que el ServicePaymentModal real) exige monto válido,
  // un método elegido Y los datos de la tarjeta completos.
  const amountOk = !!amount && Number(amount) > 0;
  const cardOk = cardNumber.trim().length > 0 && cardExp.trim().length > 0 && cardCvv.trim().length > 0 && cardName.trim().length > 0;
  const canPay = amountOk && method !== null && cardOk;

  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#5b616e", marginBottom: 6, display: "block" };
  const inputBox: React.CSSProperties = { height: 40, borderRadius: 10, border: "1px solid #e3e6ea", background: "#fff", padding: "0 12px", boxSizing: "border-box", color: "#3a3f4a", fontSize: 14, outline: "none", fontFamily: "inherit", width: "100%" };
  const rowButton: React.CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "15px 2px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" };
  const rowDivider: React.CSSProperties = { borderBottom: "1px solid #eceef1" };
  const cardIcon = (active: boolean) => (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={active ? MP_BLUE : "#8a8f99"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" />
    </svg>
  );
  const radio = (active: boolean) => (
    <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${active ? MP_BLUE : "#b8bcc4"}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
      {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: MP_BLUE }} />}
    </span>
  );
  const cardFields = (
    <div style={{ display: "grid", gap: 14, padding: "6px 2px 18px" }}>
      <div><label style={label}>Número de tarjeta</label><input className="vibra-mock-card" style={inputBox} inputMode="numeric" placeholder="1234 1234 1234 1234" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={label}>Vencimiento</label><input className="vibra-mock-card" style={inputBox} placeholder="MM/AA" value={cardExp} onChange={(e) => setCardExp(e.target.value)} /></div>
        <div><label style={label}>CVV</label><input className="vibra-mock-card" style={inputBox} inputMode="numeric" placeholder="CVV" value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} /></div>
      </div>
      <div><label style={label}>Nombre del titular</label><input className="vibra-mock-card" style={inputBox} placeholder="Como aparece en la tarjeta" value={cardName} onChange={(e) => setCardName(e.target.value)} /></div>
    </div>
  );
  function methodRow(kind: "credit" | "debit", title: string) {
    const active = method === kind;
    return (
      <div style={rowDivider}>
        <button type="button" onClick={() => setMethod(active ? null : kind)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "left" }}>{title}</span>
          {radio(active)}
        </button>
        <div style={{ display: "grid", gridTemplateRows: active ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
          <div style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}>{cardFields}</div>
        </div>
      </div>
    );
  }

  const leftColumn = (
    <div style={{ position: "relative", padding: narrow ? "24px 18px 4px" : "28px 24px 24px", minWidth: 0 }}>
      <button type="button" onClick={onClose} aria-label="Cerrar" style={{ position: "absolute", top: 8, right: 10, zIndex: 2, border: "none", background: "none", color: "#9aa0a8", cursor: "pointer", fontSize: 26, lineHeight: 1, padding: 4 }}>×</button>
      {narrow && (
        // eslint-disable-next-line @next/next/no-img-element
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-start" }}><img src="/mercadopago.webp" alt="Mercado Pago" style={{ height: 30, width: "auto" }} /></div>
      )}
      <div style={{ marginBottom: 16, marginTop: narrow ? 0 : 4 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#3a3f4a" }}>¿Cómo quieres pagar?</h4>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#9aa0a8", fontWeight: 400 }}>Elige tu forma de pago</p>
      </div>
      <div style={{ display: "grid" }}>
        {methodRow("credit", "Tarjeta de crédito")}
        {methodRow("debit", "Tarjeta de débito")}
      </div>
    </div>
  );

  const rightColumn = (
    <div style={{ position: "relative", padding: narrow ? "16px 18px 20px" : "48px 24px 24px", background: "#fff", borderLeft: narrow ? "none" : "1px solid #eaecef", display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, minWidth: 0 }}>
      {!narrow && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/mercadopago.webp" alt="Mercado Pago" style={{ position: "absolute", top: 22, right: 24, height: 30, width: "auto" }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)", display: "grid", placeItems: "center", fontSize: 19, fontWeight: 700, color: "#fff" }}>N</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a" }}>Nombre del creador</div>
          <div style={{ fontSize: 12.5, color: "#6b7280" }}>Donación</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
        <div style={{ height: 1, background: "#e6e8ec" }} />
        <p style={{ margin: 0, fontSize: 12.5, color: "#5b616e", lineHeight: 1.5 }}>Tu contribución es un apoyo directo para Nombre del creador. ¡Gracias por respaldar su historia!</p>
      </div>
      <div style={{ height: 1, background: "#e6e8ec" }} />
      {/* 4 montos sugeridos (anclas MXN → moneda del usuario). Al elegir uno se pone en "Otro monto". */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {DONATION_PRESETS_MXN.map((mxn) => {
          const selected = selectedPreset === mxn;
          return (
            <button
              key={mxn}
              type="button"
              onClick={() => { setSelectedPreset(mxn); setAmount(String(Math.round(pf.toDisplayForInput(mxn, "MXN")))); }}
              style={{ padding: "9px 2px", borderRadius: 10, border: "none", background: selected ? "#eaf6fd" : "transparent", color: selected ? MP_BLUE : "#3a3f4a", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {pf.format(mxn, { code: true })}
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gap: 6, justifyItems: "center", marginTop: 2 }}>
        <span style={{ fontSize: 12.5, color: "#6b7280", fontWeight: 600 }}>Otro monto</span>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "#3a3f4a" }}>$</span>
          <input type="number" inputMode="decimal" min={1} className="vibra-amount-input" value={amount} onChange={(e) => { setAmount(e.target.value); setSelectedPreset(null); }} placeholder="0" style={{ width: 120, border: "none", borderBottom: "1px solid #eceef1", background: "transparent", fontSize: 22, fontWeight: 700, color: "#3a3f4a", textAlign: "center", outline: "none", fontFamily: "inherit", padding: "0 2px 4px" }} />
          <span style={{ fontSize: 13, color: "#9aa0a8", fontWeight: 600 }}>{pf.currency}</span>
        </div>
      </div>
      <button type="button" disabled={!canPay} style={{ height: 40, borderRadius: 10, border: "none", background: canPay ? MP_BLUE : "#9fd8f2", color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: canPay ? "pointer" : "not-allowed" }}>Pagar</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: "#8a8f99", marginTop: -6 }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={MP_BLUE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" />
        </svg>
        <span>Tu pago está protegido por <span style={{ color: MP_BLUE, fontWeight: 700 }}>Mercado Pago</span></span>
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", maxWidth: narrow ? "none" : 660, margin: narrow ? undefined : "0 auto", background: "#fff", color: "#3a3f4a", fontFamily: "system-ui, sans-serif" }}>
      <style>{`.vibra-amount-input::-webkit-outer-spin-button,.vibra-amount-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}.vibra-amount-input{-moz-appearance:textfield;appearance:textfield}.vibra-mock-card::placeholder{color:#9aa0a8;opacity:1}`}</style>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1.05fr 1fr", alignItems: "stretch" }}>
        {leftColumn}
        {rightColumn}
      </div>
    </div>
  );
}

function LiveSpectatorMockup() {
  const [chatFocused, setChatFocused] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [donateClosing, setDonateClosing] = useState(false);
  const closeDonate = () => setDonateClosing(true);
  const headerBtn: React.CSSProperties = { background: "none", border: "none", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", background: "#0a0a0a", paddingTop: 42, overflow: "hidden" }}>
      <style>{`@keyframes lvmPulse{0%,100%{opacity:1}50%{opacity:0.35}}.vibra-chat-ph::placeholder{color:rgba(255,255,255,0.32)}`}</style>

      {/* ── Video 16:9 ── */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000", flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://picsum.photos/seed/vibralive/640/360" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

        {/* Header: mute + expandir + cerrar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, padding: "8px 8px" }}>
          <button style={headerBtn} aria-label="Silenciar">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>
          <button style={headerBtn} aria-label="Pantalla completa">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          <button style={headerBtn} aria-label="Cerrar">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Badge EN VIVO — abajo derecha */}
        <div style={{ position: "absolute", bottom: 12, right: 12, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.88)", borderRadius: 7, padding: "5px 11px 5px 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#fff", backdropFilter: "blur(4px)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "lvmPulse 1.4s ease-in-out infinite" }} />
          EN VIVO
        </div>

        {/* Badge espectadores — abajo izquierda */}
        <div style={{ position: "absolute", bottom: 12, left: 12, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.55)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", padding: "5px 10px 5px 8px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          1,284
        </div>
      </div>

      {/* Contenido bajo el video — el panel de donación se ancla aquí, así el live nunca queda tapado */}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>

      {/* ── Info del creador ── */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid transparent", display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
        <div style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)", display: "grid", placeItems: "center", fontSize: 17, fontWeight: 700, color: "#fff" }}>
          N
        </div>
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
            Nombre del creador
          </span>
          {/* 2ª línea: "En vivo" izquierda · like derecha (conteo fijo a la derecha, flamita a su izquierda) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.2 }}>En vivo</span>
            <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }} aria-label="Me gusta">
              <VibraFlameIcon size={18} active />
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>1,284</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Chat ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 10px", display: "flex", flexDirection: "column", gap: 1 }}>
        <LiveChatMsg initial="A" color="#f43f5e" name="Ana" text="¡Qué buena transmisión! 🔥" />
        <LiveChatMsg initial="C" color="#3b82f6" name="Carlos" text="Saludos desde México 🇲🇽" />

        {/* Supercomentario / donación */}
        <div style={{ display: "flex", gap: 8, padding: "6px 10px", alignItems: "flex-start", margin: "2px -10px" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: "#8b5cf6", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 0 0 2px #a855f7" }}>
            L
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Lucía</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>donó</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>$100 MXN</span>
            </div>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.4 }}>¡Sigue así crack! 💜</span>
          </div>
        </div>

        <LiveChatMsg initial="D" color="#10b981" name="Diego" text="¿Vas a hablar del tema nuevo?" />
        <LiveChatMsg initial="M" color="#f59e0b" name="María" text="😍😍😍" />
        <LiveChatMsg initial="J" color="#6366f1" name="Jorge" text="Primera vez aquí, todo excelente" />
      </div>

      {/* ── Barra de input ── */}
      <div style={{ padding: "8px 10px", borderTop: "1px solid transparent", flexShrink: 0, display: "flex", alignItems: "center" }}>
        {/* Campo con flecha de enviar DENTRO */}
        <div style={{ position: "relative", flex: 1 }}>
          <input
            maxLength={50}
            className="vibra-chat-ph"
            placeholder="Escribe un comentario…"
            onFocus={() => setChatFocused(true)}
            onBlur={() => setChatFocused(false)}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 36px 10px 12px", color: "#fff", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, outline: "none" }}
          />
          <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Enviar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#a855f7" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ transform: "rotate(-20deg)" }} aria-hidden="true">
              <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
            </svg>
          </button>
        </div>
        {/* Moneda (supercomentario) + corazón (aportación) — se colapsan al enfocar */}
        <div style={{ overflow: "hidden", flexShrink: 0, width: chatFocused ? 0 : 56, marginLeft: chatFocused ? 0 : 10, opacity: chatFocused ? 0 : 1, transition: "width 0.25s ease, margin 0.25s ease, opacity 0.2s ease" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Supercomentario — moneda */}
            <button style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Supercomentario">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8.2" />
                <path d="M12 7.4v9.2" />
                <path d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2" />
              </svg>
            </button>
            {/* Aportación — solo corazón */}
            <button onClick={() => setDonateOpen(true)} style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Hacer aportación">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Panel de donación — entra desde abajo; cubre de debajo del video hacia abajo (no tapa el live) ── */}
      {donateOpen && (
        <div
          onAnimationEnd={() => { if (donateClosing) { setDonateOpen(false); setDonateClosing(false); } }}
          style={{ position: "absolute", inset: 0, zIndex: 100, background: "#fff", overflowY: "auto", animation: `${donateClosing ? "dgDown" : "dgUp"} 0.32s cubic-bezier(0.2,0.8,0.2,1) forwards` }}
        >
          <style>{`@keyframes dgUp{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes dgDown{from{transform:translateY(0)}to{transform:translateY(100%)}}`}</style>
          <DonationGatewayMockup narrow onClose={closeDonate} />
        </div>
      )}
      </div>
    </div>
  );
}

// ── Mockup: espectador de un LIVE VERTICAL en celular vertical ───────────────
//    Réplica de la rama "MOBILE — portrait: fullscreen + overlay chat":
//    video a pantalla completa (cover) + chat translúcido encima.
function LiveOverlayMsg({ initial, color, name, text }: { initial: string; color: string; name: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: color, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>
        {initial}
      </div>
      <span style={{ fontSize: 12.5, lineHeight: 1.4, color: "rgba(255,255,255,0.92)", flex: 1, minWidth: 0 }}>
        <strong style={{ fontWeight: 700, color: "#fff", marginRight: 5 }}>{name}</strong>
        {text}
      </span>
    </div>
  );
}

function LivePortraitSpectatorMockup() {
  const [chatFocused, setChatFocused] = useState(false);
  const headerBtn: React.CSSProperties = { background: "none", border: "none", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000", overflow: "hidden" }}>
      <style>{`@keyframes lvmPulse2{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>

      {/* Video vertical a pantalla completa (imagen, cover) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="https://picsum.photos/seed/vibralivev/420/900" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

      {/* Badge EN VIVO — arriba-centro (debajo del island) */}
      <div style={{ position: "absolute", top: 46, left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.88)", borderRadius: 7, padding: "5px 11px 5px 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#fff", backdropFilter: "blur(4px)", zIndex: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "lvmPulse2 1.4s ease-in-out infinite" }} />
        EN VIVO
      </div>

      {/* Badge espectadores — arriba-izquierda */}
      <div style={{ position: "absolute", top: 46, left: 12, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.55)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", padding: "5px 10px 5px 8px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)", zIndex: 10 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        1,284
      </div>

      {/* Header — mute + cerrar (sin expandir en portrait), arriba-derecha */}
      <div style={{ position: "absolute", top: 42, right: 8, display: "flex", alignItems: "center", gap: 4, zIndex: 10 }}>
        <button style={headerBtn} aria-label="Silenciar">
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
        <button style={headerBtn} aria-label="Cerrar">
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Overlay de chat translúcido — parte inferior */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5, display: "flex", flexDirection: "column", paddingTop: 44, background: "linear-gradient(to top, rgba(0,0,0,0.68) 50%, transparent 100%)" }}>
        {/* Mensajes */}
        <div style={{ padding: "0 14px", display: "flex", flexDirection: "column" }}>
          {/* Like (izquierda) · Botón Seguir (derecha) — misma línea */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 8 }}>
            <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }} aria-label="Me gusta">
              <VibraFlameIcon size={18} active />
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>1,284</span>
            </button>
            <button style={{ background: "rgba(255,255,255,0.92)", border: "none", color: "#000", borderRadius: 20, padding: "5px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: "0.01em" }}>
              Seguir
            </button>
          </div>

          <LiveOverlayMsg initial="A" color="#f43f5e" name="Ana" text="¡Qué buena transmisión! 🔥" />
          <LiveOverlayMsg initial="C" color="#3b82f6" name="Carlos" text="Saludos desde México 🇲🇽" />

          {/* Supercomentario / donación */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "0 -14px 5px -14px", padding: "6px 14px" }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: "#8b5cf6", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 0 0 2px #a855f7" }}>
              L
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Lucía</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>donó</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>$100 MXN</span>
              </div>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.9)", lineHeight: 1.4 }}>¡Sigue así crack! 💜</span>
            </div>
          </div>

          <LiveOverlayMsg initial="M" color="#f59e0b" name="María" text="😍😍😍" />
        </div>

        {/* Barra de input — mismo sistema que el horizontal */}
        <div style={{ padding: "7px 14px 14px", display: "flex", alignItems: "center" }}>
          {/* Campo con flecha de enviar DENTRO */}
          <div style={{ position: "relative", flex: 1 }}>
            <input
              maxLength={50}
              className="vibra-chat-ph"
              placeholder="Escribe un comentario…"
              onFocus={() => setChatFocused(true)}
              onBlur={() => setChatFocused(false)}
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 36px 10px 12px", color: "#fff", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, outline: "none" }}
            />
            <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#a855f7" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ transform: "rotate(-20deg)" }} aria-hidden="true">
                <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
              </svg>
            </button>
          </div>
          {/* Moneda (supercomentario) + corazón (aportación) — se colapsan al enfocar */}
          <div style={{ overflow: "hidden", flexShrink: 0, width: chatFocused ? 0 : 56, marginLeft: chatFocused ? 0 : 10, opacity: chatFocused ? 0 : 1, transition: "width 0.25s ease, margin 0.25s ease, opacity 0.2s ease" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Supercomentario">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8.2" /><path d="M12 7.4v9.2" />
                  <path d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2" />
                </svg>
              </button>
              <button style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Hacer aportación">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mockup: espectador de un LIVE horizontal en ORDENADOR ────────────────────
//    Réplica de la rama "DESKTOP — horizontal": dos cards flotantes (video
//    grande + card de chat con info del creador arriba). Se renderiza a tamaño
//    real (800×450 + 300×450) y se escala para caber en la pantalla 16:9.
function LiveDesktopSpectatorMockup() {
  const [chatFocused, setChatFocused] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [donateClosing, setDonateClosing] = useState(false);
  const closeDonate = () => setDonateClosing(true);
  const FLOAT_SHADOW = "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)";
  const headerBtn: React.CSSProperties = { background: "none", border: "none", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.88)", overflow: "hidden" }}>
      <style>{`@keyframes lvmPulse3{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%) scale(0.62)", display: "flex", gap: 24 }}>

        {/* ── Card de video 800×450 ── */}
        <div style={{ position: "relative", width: 800, height: 450, background: "#000", borderRadius: 18, overflow: "hidden", flexShrink: 0, boxShadow: FLOAT_SHADOW }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://picsum.photos/seed/vibralived/960/540" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

          {/* Header: mute + pantalla completa + cerrar (íconos 20) */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, padding: "12px 14px" }}>
            <button style={headerBtn} aria-label="Silenciar">
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </button>
            <button style={headerBtn} aria-label="Pantalla completa">
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
            <button style={headerBtn} aria-label="Cerrar">
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Badge EN VIVO — abajo derecha */}
          <div style={{ position: "absolute", bottom: 14, right: 14, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.88)", borderRadius: 7, padding: "5px 11px 5px 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#fff", backdropFilter: "blur(4px)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "lvmPulse3 1.4s ease-in-out infinite" }} />
            EN VIVO
          </div>

          {/* Badge espectadores — abajo izquierda */}
          <div style={{ position: "absolute", bottom: 14, left: 14, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.55)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", padding: "5px 10px 5px 8px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            1,284
          </div>
        </div>

        {/* ── Card de chat 300×450 ── */}
        <div style={{ width: 300, height: 450, background: "rgba(10,10,10,0.97)", borderRadius: 18, overflow: "hidden", flexShrink: 0, boxShadow: FLOAT_SHADOW, display: "flex", flexDirection: "column" }}>
          {/* Info del creador */}
          <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid transparent", display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)", display: "grid", placeItems: "center", fontSize: 17, fontWeight: 700, color: "#fff" }}>
              N
            </div>
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>Nombre del creador</span>
              {/* 2ª línea: "En vivo" izquierda · like derecha */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.2 }}>En vivo</span>
                <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }} aria-label="Me gusta">
                  <VibraFlameIcon size={18} active />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>1,284</span>
                </button>
              </div>
            </div>
          </div>

          {/* Chat */}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 10px", display: "flex", flexDirection: "column", gap: 1 }}>
            <LiveChatMsg initial="A" color="#f43f5e" name="Ana" text="¡Qué buena transmisión! 🔥" />
            <LiveChatMsg initial="C" color="#3b82f6" name="Carlos" text="Saludos desde México 🇲🇽" />

            {/* Supercomentario / donación */}
            <div style={{ display: "flex", gap: 8, padding: "6px 10px", alignItems: "flex-start", margin: "2px -10px" }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: "#8b5cf6", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 0 0 2px #a855f7" }}>L</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Lucía</span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>donó</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>$100 MXN</span>
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.4 }}>¡Sigue así crack! 💜</span>
              </div>
            </div>

            <LiveChatMsg initial="D" color="#10b981" name="Diego" text="¿Vas a hablar del tema nuevo?" />
            <LiveChatMsg initial="M" color="#f59e0b" name="María" text="😍😍😍" />
            <LiveChatMsg initial="J" color="#6366f1" name="Jorge" text="Primera vez aquí, todo excelente" />
          </div>

          {/* Barra de input */}
          <div style={{ padding: "8px 10px", borderTop: "1px solid transparent", flexShrink: 0, display: "flex", alignItems: "center" }}>
            {/* Campo con flecha de enviar DENTRO */}
            <div style={{ position: "relative", flex: 1 }}>
              <input maxLength={50} className="vibra-chat-ph" placeholder="Escribe un comentario…" onFocus={() => setChatFocused(true)} onBlur={() => setChatFocused(false)} style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 36px 10px 12px", color: "#fff", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, outline: "none" }} />
              <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Enviar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#a855f7" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ transform: "rotate(-20deg)" }} aria-hidden="true">
                  <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
                </svg>
              </button>
            </div>
            {/* Moneda (supercomentario) + corazón (aportación) — se colapsan al enfocar */}
            <div style={{ overflow: "hidden", flexShrink: 0, width: chatFocused ? 0 : 56, marginLeft: chatFocused ? 0 : 10, opacity: chatFocused ? 0 : 1, transition: "width 0.25s ease, margin 0.25s ease, opacity 0.2s ease" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Supercomentario">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8.2" /><path d="M12 7.4v9.2" />
                    <path d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2" />
                  </svg>
                </button>
                <button onClick={() => setDonateOpen(true)} style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Hacer aportación">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Panel de donación — cubre toda el área del live, entra desde abajo ── */}
      {donateOpen && (
        <div
          onAnimationEnd={() => { if (donateClosing) { setDonateOpen(false); setDonateClosing(false); } }}
          style={{ position: "absolute", inset: 0, zIndex: 100, background: "#fff", overflowY: "auto", display: "flex", alignItems: "center", justifyContent: "center", animation: `${donateClosing ? "dgDown3" : "dgUp3"} 0.32s cubic-bezier(0.2,0.8,0.2,1) forwards` }}
        >
          <style>{`@keyframes dgUp3{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes dgDown3{from{transform:translateY(0)}to{transform:translateY(100%)}}`}</style>
          <DonationGatewayMockup narrow={false} onClose={closeDonate} />
        </div>
      )}
    </div>
  );
}

export default function VideoIconsPreview() {
  const [elapsed, setElapsed] = useState(0);
  // Cambiar esta key re-monta el bloque y vuelve a disparar la animación de entrada.
  const [animKey, setAnimKey] = useState(0);
  // Preview del intro de la grabación (mismo componente que la plantilla real).
  const [introKey, setIntroKey] = useState(0);
  const [introName, setIntroName] = useState("Nombre del creador");
  // Preview del cierre de la grabación (mismo componente que la plantilla real).
  const [outroKey, setOutroKey] = useState(0);
  const [outroMode, setOutroMode] = useState<OutroMode>(null);
  // Preview del overlay de la esquina (mismo componente que la plantilla real).
  const [ovKey, setOvKey] = useState(0);
  // Simulación de descarga animada de saludo/consejo (horizontal + vertical).
  const [greetKey, setGreetKey] = useState(0);
  const [greetName, setGreetName] = useState("Nombre del creador");
  const [greetLabel, setGreetLabel] = useState("Saludo");
  const [ovOut, setOvOut] = useState(false);
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

      {/* ── Estilo del texto "Vibra" animado (copiado del login) ── */}
      <style>{`
        .vibraHeroText {
          background: linear-gradient(100deg, #ff2fb3 0%, #a855ff 45%, #4f46ff 100%);
          background-size: 220% 220%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: vibraTextFlow 4.5s ease-in-out infinite;
        }
        @keyframes vibraTextFlow {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes vibraReveal {
          0%   { opacity: 0; transform: translateY(28px) scale(0.94); filter: blur(12px); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
      `}</style>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SIMULADORES — supercomentarios y donación en vivo                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>
        Simuladores — supercomentarios y donación en vivo
      </h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
        Lienzos vacíos para ir diseñando los paneles poco a poco. Dos celulares en vertical y una
        pantalla de ordenador en horizontal.
      </p>

      <div
        style={{
          display: "flex",
          gap: 40,
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "center",
          marginBottom: 72,
        }}
      >
        <PhoneFrame label="Celular 1 · live (espectador)">
          <LiveSpectatorMockup />
        </PhoneFrame>
        <PhoneFrame label="Celular 2 · live vertical (espectador)">
          <LivePortraitSpectatorMockup />
        </PhoneFrame>
        <DesktopFrame label="Ordenador · live horizontal (espectador)">
          <LiveDesktopSpectatorMockup />
        </DesktopFrame>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* LIENZO DE DISEÑO — animación "Vibra" para la descarga de sesión        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "24px 0 56px", gap: 24 }}>
        <div
          key={animKey}
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "stretch",
            animation: "vibraReveal 1s cubic-bezier(0.22, 1, 0.36, 1) both",
            willChange: "transform, opacity, filter",
          }}
        >
          <span
            className="vibraHeroText"
            style={{ fontSize: 104, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }}
          >
            Vibra
          </span>
          {/* mismo ancho que "Vibra": las letras se reparten de borde a borde */}
          <span style={{ display: "flex", justifyContent: "space-between", color: "#fff", fontSize: 30, fontWeight: 600, lineHeight: 1, marginTop: -4 }}>
            {BRAND_DOMAIN.split("").map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setAnimKey((k) => k + 1)}
          style={{
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.85)",
            borderRadius: 999,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Repetir animación
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SELECCIONADOR DE INTERESES — el componente real, con estado local      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>
        Seleccionador de intereses — onboarding del rail
      </h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        Las mismas piezas que se renderizan en el feed (<code>GroupCategoryPill</code>, iconos, imágenes y
        medidas del grid se importan de <code>GroupRecommendationsRail</code>), con estado local: no lee ni
        escribe Firestore y &quot;Continuar&quot; solo dispara la celebración.
        <br />
        El ancho del contenedor decide las columnas y por lo tanto la paginación (2 renglones por página):
        angosta la ventana para ver cómo se repagina.
      </p>

      <div style={{ maxWidth: 720, marginBottom: 56 }}>
        <InterestsOnboardingSandbox />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SIMULACIÓN — DESCARGA ANIMADA DE SALUDO / CONSEJO (horizontal + vertical) */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>
        Descarga animada de saludo / consejo — SIMULACIÓN
      </h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
        Solo simulación — <strong style={{ color: "rgba(255,255,255,0.6)" }}>no toca el sistema real de descarga</strong>. Es para aprobar el look antes de implementarlo.
        <br />
        0–6s intro (fondo del splash + Conecta·Comparte·Vibra + nombre + avatar con aro + vibraon.com) · a los 5s del contenido entra la esquina · sale 5s antes de terminar · cierre a negro suave + Vibra 5s.
        <br />
        <span style={{ color: "rgba(255,255,255,0.32)" }}>El contenido aquí dura ~14s (en real es la duración del video). Dale &quot;Reproducir&quot; y espera la secuencia completa (~29s).</span>
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setGreetKey((k) => k + 1)}
          style={{ border: "1px solid rgba(255,255,255,0.16)", background: "rgba(168,85,255,0.22)", color: "#d8b4fe", borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >
          ▶ Reproducir simulación
        </button>
        {(["Saludo", "Consejo", "Mensaje"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => { setGreetLabel(l); setGreetKey((k) => k + 1); }}
            style={{ border: "1px solid rgba(255,255,255,0.16)", background: greetLabel === l ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)", color: greetLabel === l ? "#fff" : "rgba(255,255,255,0.6)", borderRadius: 999, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            {l}
          </button>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
          Creador:
          <input
            value={greetName}
            onChange={(e) => setGreetName(e.target.value)}
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: 13, fontFamily: "inherit", outline: "none" }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 56 }}>
        {/* Horizontal 1920×1080 → escala 0.35 (672×378) */}
        <div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginBottom: 6 }}>Horizontal · 1920×1080</div>
          <div style={{ width: 672, height: 378, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", background: "#000" }}>
            <div style={{ position: "relative", width: 1920, height: 1080, transform: "scale(0.35)", transformOrigin: "top left" }}>
              <GreetingDownloadPreview key={`h-${greetKey}`} orientation="horizontal" name={greetName} serviceLabel={greetLabel} />
            </div>
          </div>
        </div>

        {/* Vertical 1080×1920 → escala 0.30 (324×576) */}
        <div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginBottom: 6 }}>Vertical · 1080×1920</div>
          <div style={{ width: 324, height: 576, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", background: "#000" }}>
            <div style={{ position: "relative", width: 1080, height: 1920, transform: "scale(0.3)", transformOrigin: "top left" }}>
              <GreetingDownloadPreview key={`v-${greetKey}`} orientation="vertical" name={greetName} serviceLabel={greetLabel} />
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* INTRO DE LA GRABACIÓN — cuadro 1920×1080 completo, a escala            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>
        Overlay de la esquina — entrada y salida (tamaño real 1:1)
      </h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
        El mismo componente que se hornea en la grabación (<code>SessionOverlay</code>).
        <br />
        <strong style={{ color: "rgba(255,255,255,0.6)" }}>Entrada:</strong> pop del avatar + el aro se dibuja cargando + nombre y tipo entran deslizando.
        En la grabación real entra hasta el <strong style={{ color: "rgba(255,255,255,0.6)" }}>segundo 10</strong> (contado desde que arranca la grabación); aquí sin espera para poder iterarla.
        <br />
        <strong style={{ color: "rgba(255,255,255,0.6)" }}>Salida:</strong> la entrada al revés — el aro se descarga, los textos salen a la esquina y el avatar se encoge (~1s).
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => { setOvOut(false); setOvKey((k) => k + 1); }}
          style={{ border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)", borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >
          Repetir entrada
        </button>
        <button
          type="button"
          onClick={() => setOvOut(true)}
          style={{ border: "1px solid rgba(255,255,255,0.16)", background: ovOut ? "rgba(168,85,255,0.22)" : "rgba(255,255,255,0.06)", color: ovOut ? "#d8b4fe" : "rgba(255,255,255,0.85)", borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >
          Reproducir salida
        </button>
        <span style={{ color: "rgba(255,255,255,0.32)", fontSize: 12 }}>
          Medidas reales: esquina 34 · avatar Ø104 · aro 7 · hueco 5 · nombre 37/700 · servicio 27/500.
        </span>
      </div>

      <div style={{ overflow: "auto", maxWidth: "100%", maxHeight: 420, border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, marginBottom: 56 }}>
        <div style={{ position: "relative", width: 1920, height: 620, background: "linear-gradient(135deg, #334155 0%, #0f172a 100%)" }}>
          <SessionOverlay key={ovKey} avatarUrl={null} name="Nombre del creador" type="meet_greet" startDelay={300} out={ovOut} />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>
        Intro de la grabación — cuadro 1920×1080 completo
      </h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
        El mismo componente que se hornea en la grabación real (<code>SessionIntro</code>), escalado para verlo entero.
        <br />
        0.3s título · 1.3s &quot;Tu momento con…&quot; · 2.0s avatar (pop) · 2.4s el aro se carga (1.7s) · 2.7s vibraon.com · 4.4s todo se desvanece y sube el audio · 6.2s queda la sesión.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setIntroKey((k) => k + 1)}
          style={{
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.85)",
            borderRadius: 999,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Repetir intro
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
          Nombre del creador:
          <input
            value={introName}
            onChange={(e) => setIntroName(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#fff",
              fontSize: 13,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </label>
        <span style={{ color: "rgba(255,255,255,0.32)", fontSize: 12 }}>
          Tras el intro queda transparente: en la grabación real ahí está la sesión.
        </span>
      </div>

      {/* Cuadro 1920×1080 escalado a 960×540 (50%) para verlo completo. El
          contenido interno conserva sus px reales de 1080p. */}
      <div
        style={{
          width: 960,
          height: 540,
          maxWidth: "100%",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 56,
          background: "linear-gradient(135deg, #334155 0%, #0f172a 100%)",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 1920,
            height: 1080,
            transform: "scale(0.5)",
            transformOrigin: "top left",
          }}
        >
          {/* Marcador de "la sesión" que queda debajo del intro */}
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.22)", fontSize: 44, fontWeight: 700 }}>
            (aquí va la sesión)
          </div>
          <SessionIntro key={introKey} avatarUrl={null} name={introName} />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SALIDA DE LA GRABACIÓN — cuadro 1920×1080 completo, a escala           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>
        Salida de la grabación — cuadro 1920×1080 completo
      </h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
        El mismo componente que se hornea en la grabación real (<code>SessionOutro</code>), escalado para verlo entero.
        <br />
        <strong style={{ color: "rgba(255,255,255,0.6)" }}>Por reloj</strong> (llega a 0): 0→3s normal · 3s borroso + Vibra + el audio baja en 7s · 10s corta. <strong style={{ color: "rgba(255,255,255,0.6)" }}>Nunca se va a negro.</strong>
        <br />
        <strong style={{ color: "rgba(255,255,255,0.6)" }}>Por cancelación</strong>: negro muy suave + Vibra durante 7s.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {([
          { label: "Reproducir cierre por reloj", mode: "timer" as const },
          { label: "Reproducir cancelación", mode: "cancel" as const },
        ]).map((b) => (
          <button
            key={b.mode}
            type="button"
            onClick={() => {
              setOutroMode(null);
              setOutroKey((k) => k + 1);
              // Deja que se remonte en null antes de disparar el modo.
              setTimeout(() => setOutroMode(b.mode), 50);
            }}
            style={{
              border: "1px solid rgba(255,255,255,0.16)",
              background: outroMode === b.mode ? "rgba(168,85,255,0.22)" : "rgba(255,255,255,0.06)",
              color: outroMode === b.mode ? "#d8b4fe" : "rgba(255,255,255,0.85)",
              borderRadius: 999,
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {b.label}
          </button>
        ))}
        <span style={{ color: "rgba(255,255,255,0.32)", fontSize: 12 }}>
          El audio no suena aquí; en la grabación real baja suave a 0.
        </span>
      </div>

      {/* Cuadro 1920×1080 escalado a 960×540 (50%). El contenido interno
          conserva sus px reales de 1080p. */}
      <div
        style={{
          width: 960,
          height: 540,
          maxWidth: "100%",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 56,
          background: "#000",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 1920,
            height: 1080,
            transform: "scale(0.5)",
            transformOrigin: "top left",
          }}
        >
          <SessionOutro key={outroKey} mode={outroMode}>
            {/* Simulación de la sesión: se difumina igual que el video real */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #334155 0%, #0f172a 100%)", display: "grid", placeItems: "center" }}>
              <span style={{ color: "rgba(255,255,255,0.22)", fontSize: 44, fontWeight: 700 }}>(aquí va la sesión)</span>
            </div>
            {/* El overlay sale junto con el cierre, igual que en la grabación:
                por reloj con la fase overlayOut (t=-5), en cancelación al
                instante. Aquí se dispara con el modo para poder verlo. */}
            <SessionOverlay
              avatarUrl={null}
              name="Nombre del creador"
              type="meet_greet"
              startDelay={0}
              out={outroMode !== null}
            />
          </SessionOutro>
        </div>
      </div>

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
