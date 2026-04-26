"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  role: "buyer" | "creator";
  scheduledAtLabel?: string | null;
  durationMinutes?: number | null;
};

export default function MeetGreetPreparationFullscreen({
  open,
  onClose,
  role,
  scheduledAtLabel,
  durationMinutes,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

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
    padding: "max(12px, 1.8dvh) 16px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    color: "#fff",
    flexShrink: 0,
    minHeight: 60,
    boxSizing: "border-box",
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
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr) auto",
    gap: 12,
    padding: "12px 16px max(12px, env(safe-area-inset-bottom))",
    color: "#fff",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  const videoArea: CSSProperties = {
    minHeight: 0,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background:
      "linear-gradient(180deg, rgba(20,20,20,0.98) 0%, rgba(8,8,8,0.98) 100%)",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: "clamp(16px, 4dvw, 24px)",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  const footerPanel: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    padding: 14,
    display: "grid",
    gap: 10,
    flexShrink: 0,
    maxHeight: "38dvh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    boxSizing: "border-box",
  };

  const controlsRow: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))",
    gap: 10,
  };

  const ghostButton: CSSProperties = {
    minHeight: 44,
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.1,
    WebkitTapHighlightColor: "transparent",
  };

  const primaryButton: CSSProperties = {
    minHeight: 44,
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "#fff",
    color: "#000",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.1,
    WebkitTapHighlightColor: "transparent",
  };

  return createPortal(
    <div role="dialog" aria-modal="true" style={backdrop}>
      <div style={topBar}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "clamp(14px, 4dvw, 16px)",
              fontWeight: 800,
              lineHeight: 1.15,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "calc(100dvw - 130px - env(safe-area-inset-left) - env(safe-area-inset-right))",
            }}
          >
            Meet & Greet — Sala de preparación
          </div>

          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              lineHeight: 1.35,
              color: "rgba(255,255,255,0.70)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            Rol: {role === "buyer" ? "Comprador" : "Creador"}
            {scheduledAtLabel ? ` · ${scheduledAtLabel}` : ""}
            {durationMinutes != null ? ` · ${durationMinutes} min` : ""}
          </div>
        </div>

        <button type="button" onClick={onClose} style={closeButton}>
          Cerrar
        </button>
      </div>

      <div style={body}>
        <div style={videoArea}>
          <div style={{ maxWidth: 720, width: "100%" }}>
            <div
              style={{
                fontSize: "clamp(18px, 5dvw, 22px)",
                fontWeight: 900,
                lineHeight: 1.1,
                color: "#fff",
              }}
            >
              Placeholder de videollamada fullscreen
            </div>

            <div
              style={{
                marginTop: 10,
                fontSize: "clamp(13px, 3.5dvw, 14px)",
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.80)",
              }}
            >
              Aquí se conectará la videollamada real del meet & greet.
              Este panel ya ocupa toda la pantalla para que el flujo quede
              listo tanto en móvil como en desktop.
            </div>
          </div>
        </div>

        <div style={footerPanel}>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              color: "rgba(255,255,255,0.74)",
            }}
          >
            Controles placeholder:
          </div>

          <div style={controlsRow}>
            <button type="button" style={ghostButton}>
              Micrófono
            </button>
            <button type="button" style={ghostButton}>
              Cámara
            </button>
            <button type="button" style={ghostButton}>
              Compartir pantalla
            </button>
            <button type="button" style={primaryButton}>
              Unirse a la llamada
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
