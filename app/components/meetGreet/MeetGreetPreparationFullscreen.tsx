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

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
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
  };

  const topBar: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    color: "#fff",
    flexShrink: 0,
  };

  const closeButton: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.1,
  };

  const body: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "1fr auto",
    gap: 12,
    padding: 16,
    color: "#fff",
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
    padding: 24,
  };

  const footerPanel: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    padding: 14,
    display: "grid",
    gap: 10,
    flexShrink: 0,
  };

  const controlsRow: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  };

  const ghostButton: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.1,
  };

  const primaryButton: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "#fff",
    color: "#000",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.1,
  };

  return createPortal(
    <div role="dialog" aria-modal="true" style={backdrop}>
      <div style={topBar}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.15 }}>
            Meet & Greet — Sala de preparación
          </div>

          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              lineHeight: 1.35,
              color: "rgba(255,255,255,0.70)",
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
          <div style={{ maxWidth: 720 }}>
            <div
              style={{
                fontSize: 22,
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
                fontSize: 14,
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