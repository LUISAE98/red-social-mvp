"use client";

/**
 * Íconos estándar para reproductores de video en Vibra.
 * Usar estos componentes en todos los contextos de video/live
 * para mantener consistencia visual.
 */

type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

// ── Cerrar (X) ────────────────────────────────────────────────────────────────
export function VideoCloseIcon({ size = 20, color = "currentColor", strokeWidth = 2.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── Mute (altavoz con X) ──────────────────────────────────────────────────────
export function VideoMuteIcon({ size = 20, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

// ── Unmute (altavoz con ondas) ────────────────────────────────────────────────
export function VideoUnmuteIcon({ size = 20, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

// ── Expandir / Pantalla completa ──────────────────────────────────────────────
export function VideoExpandIcon({ size = 20, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

// ── Comprimir / Salir de pantalla completa ────────────────────────────────────
export function VideoCompressIcon({ size = 20, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="10" y1="14" x2="3" y2="21" />
      <line x1="21" y1="3" x2="14" y2="10" />
    </svg>
  );
}

// ── Retroceder 10s ───────────────────────────────────────────────────────────
// < 10
export function VideoSkipBackIcon({ size = 24, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 24" fill="none" aria-hidden="true">
      <path d="M7 6 L2 12 L7 18" stroke={color} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="27" y="18" textAnchor="end" fontSize="16" fontWeight="600" fontFamily="inherit" fill={color}>10</text>
    </svg>
  );
}

// ── Avanzar 10s ───────────────────────────────────────────────────────────────
export function VideoSkipForwardIcon({ size = 24, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 24" fill="none" aria-hidden="true">
      <text x="1" y="18" textAnchor="start" fontSize="16" fontWeight="600" fontFamily="inherit" fill={color}>10</text>
      <path d="M21 6 L26 12 L21 18" stroke={color} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Velocidad de reproducción ─────────────────────────────────────────────────
// Usar: <VideoSpeedIcon speed={1.5} />  →  "1.5×"
// Valores típicos: 0.5 · 1 · 1.25 · 1.5 · 1.75 · 2
type SpeedIconProps = {
  speed?: number;
  size?: number;
  color?: string;
};
export function VideoSpeedIcon({ speed = 1, size = 20, color = "currentColor" }: SpeedIconProps) {
  const label = `×${speed}`;
  return (
    <svg width={size * 1.8} height={size} viewBox="0 0 44 24" fill="none" aria-hidden="true">
      <text x="22" y="17" textAnchor="middle" fontSize="17" fontWeight="600" fontFamily="inherit" fill={color}>{label}</text>
    </svg>
  );
}

// ── Contador de espectadores ──────────────────────────────────────────────────
function formatViewerCount(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v : v.toFixed(1)} mill`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v % 1 === 0 ? v : v.toFixed(1)} mil`;
  }
  return n.toString();
}

type ViewerBadgeProps = {
  count: number;
  style?: React.CSSProperties;
};
export function VideoViewerBadge({ count, style }: ViewerBadgeProps) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: "rgba(0,0,0,0.55)",
      borderRadius: 7,
      border: "1px solid rgba(255,255,255,0.12)",
      padding: "5px 10px 5px 8px",
      fontFamily: "inherit", fontSize: 12, fontWeight: 600,
      color: "rgba(255,255,255,0.88)",
      backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
      ...style,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      {formatViewerCount(count)}
    </div>
  );
}

// ── Badge EN VIVO ─────────────────────────────────────────────────────────────
// Punto rojo pulsante + texto "EN VIVO". Usar como componente inline, no como SVG.
type LiveBadgeProps = {
  style?: React.CSSProperties;
};
export function VideoLiveBadge({ style }: LiveBadgeProps) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "rgba(239,68,68,0.88)",
      borderRadius: 7, padding: "5px 11px 5px 8px",
      fontFamily: "inherit", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.06em", color: "#fff",
      backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
      ...style,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: "#fff", flexShrink: 0,
        animation: "videoBadgePulse 1.4s ease-in-out infinite",
      }} />
      <style>{`@keyframes videoBadgePulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
      EN VIVO
    </span>
  );
}

// ── Play ──────────────────────────────────────────────────────────────────────
export function VideoPlayIcon({ size = 26, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

// ── Pausa ─────────────────────────────────────────────────────────────────────
export function VideoPauseIcon({ size = 26, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" aria-hidden="true">
      <rect x="5" y="3" width="4" height="18" rx="1" />
      <rect x="15" y="3" width="4" height="18" rx="1" />
    </svg>
  );
}

// ── Picture in Picture ────────────────────────────────────────────────────────
export function VideoPipIcon({ size = 20, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <rect x="12" y="10" width="8" height="5" rx="1" />
    </svg>
  );
}

// ── AirPlay ───────────────────────────────────────────────────────────────────
export function VideoAirPlayIcon({ size = 20, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" />
      <polygon points="12 15 17 21 7 21 12 15" />
    </svg>
  );
}

// ── Google Cast ───────────────────────────────────────────────────────────────
export function VideoCastIcon({ size = 20, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 16.1A5 5 0 0 1 5.9 20" />
      <path d="M2 12.05A9 9 0 0 1 9.95 20" />
      <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
      <line x1="2" y1="20" x2="2.01" y2="20" />
    </svg>
  );
}
