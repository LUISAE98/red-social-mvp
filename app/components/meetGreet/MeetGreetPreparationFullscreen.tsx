"use client";

import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import LiveKitVideoRoom from "@/app/components/liveKit/LiveKitVideoRoom";
import type { LivekitSessionType } from "@/lib/liveKit/getLivekitToken";

type Props = {
  open: boolean;
  onClose: () => void;
  role: "buyer" | "creator";
  sessionId: string;
  sessionType: LivekitSessionType;
  scheduledAtLabel?: string | null;
  durationMinutes?: number | null;
};

export default function MeetGreetPreparationFullscreen({
  open,
  onClose,
  role,
  sessionId,
  sessionType,
  scheduledAtLabel,
  durationMinutes,
}: Props) {
  // useSyncExternalStore: client snapshot devuelve true, SSR snapshot devuelve false.
  // Equivalente al patrón setMounted(true) en useEffect, sin setState en effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverscroll = document.body.style.overscrollBehavior;
    const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";

    // Lock portrait orientation to prevent recording from cutting when device rotates.
    // Supported on Android Chrome; silently ignored on iOS Safari (no standard API available).
    let orientationLocked = false;
    if (typeof screen !== "undefined" && screen.orientation && typeof (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock === "function") {
      (screen.orientation as ScreenOrientation & { lock: (o: string) => Promise<void> })
        .lock("portrait")
        .then(() => { orientationLocked = true; })
        .catch(() => { /* not supported or denied */ });
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overscrollBehavior = prevBodyOverscroll;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;

      if (orientationLocked && typeof screen !== "undefined" && screen.orientation && typeof (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock === "function") {
        try { (screen.orientation as ScreenOrientation & { unlock: () => void }).unlock(); } catch { /* */ }
      }
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const sessionLabel =
    sessionType === "meet_greet" ? "Sesión en vivo" : "Sesión Exclusiva";

  return createPortal(
    <div role="dialog" aria-modal="true" style={backdrop}>
      {/* Barra superior con info de la sesión */}
      <div style={topBar}>
        <div style={{ minWidth: 0 }}>
          <div style={topBarTitle}>
            {sessionLabel} — Sala de preparación
          </div>
          <div style={topBarSubtitle}>
            {role === "buyer" ? "Participante" : "Creador"}
            {scheduledAtLabel ? ` · ${scheduledAtLabel}` : ""}
            {durationMinutes != null ? ` · ${durationMinutes} min` : ""}
          </div>
        </div>
        <button type="button" onClick={onClose} style={closeButton}>
          Cerrar
        </button>
      </div>

      {/* Área de videollamada */}
      <div style={body}>
        <LiveKitVideoRoom
          sessionId={sessionId}
          sessionType={sessionType}
          role={role}
          onLeave={onClose}
        />
      </div>
    </div>,
    document.body
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const backdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483647,
  background: "rgba(0,0,0,0.94)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  display: "flex",
  flexDirection: "column",
  width: "100dvw",
  height: "100dvh",
  maxWidth: "100dvw",
  maxHeight: "100dvh",
  overflow: "hidden",
  paddingTop: "env(safe-area-inset-top)",
  paddingRight: "env(safe-area-inset-right)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  boxSizing: "border-box",
  overscrollBehavior: "none",
  touchAction: "none",
};

const topBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "max(12px,1.8dvh) 16px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  color: "#fff",
  flexShrink: 0,
  minHeight: 60,
  boxSizing: "border-box",
};

const topBarTitle: CSSProperties = {
  fontSize: "clamp(14px,4dvw,16px)",
  fontWeight: 800,
  lineHeight: 1.15,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "calc(100dvw - 130px - env(safe-area-inset-left) - env(safe-area-inset-right))",
};

const topBarSubtitle: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 1.35,
  color: "rgba(255,255,255,0.70)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
};

const closeButton: CSSProperties = {
  minHeight: 42,
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.1,
  flexShrink: 0,
  WebkitTapHighlightColor: "transparent",
};

const body: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: "12px 16px max(12px,env(safe-area-inset-bottom))",
  overflow: "hidden",
  boxSizing: "border-box",
};
