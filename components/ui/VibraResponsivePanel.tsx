"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Panel responsivo canónico de Vibra (ver `vibra_style.md`).
 *
 * - Celular: pestaña deslizable desde abajo (bottom sheet) con arrastre para
 *   cerrar y rubber band hacia arriba.
 * - Laptop: panel centrado con animación de escala.
 *
 * Encapsula backdrop, ciclo de vida de animación, detección de móvil, bloqueo
 * de scroll del body y el gesto de arrastre. El contenido se pasa por children;
 * el footer opcional queda anclado abajo (fuera del scroll).
 *
 * Basado en el patrón ya probado de `ProfileFollowersOverlay`.
 */

const PANEL_CLOSE_THRESHOLD = 130;

type VibraResponsivePanelProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Texto secundario opcional bajo el título (solo se muestra si se pasa). */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Contenido anclado al fondo (botones de acción, etc.). No entra al scroll. */
  footer?: React.ReactNode;
  /** Ancho máximo del panel en desktop. Default 520. */
  maxWidthDesktop?: number;
  closeAriaLabel?: string;
  /** Padding del área de contenido con scroll. */
  contentPadding?: string;
};

export default function VibraResponsivePanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidthDesktop = 520,
  closeAriaLabel = "Cerrar",
  contentPadding,
}: VibraResponsivePanelProps) {
  // --- Ciclo de vida de animación ---
  const [shouldRender, setShouldRender] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const shouldRenderRef = useRef(false);

  // --- Detección de móvil ---
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 639px)").matches
      : false
  );
  const isMobileRef = useRef(isMobile);

  // --- Arrastre en móvil ---
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);

  const closeAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAnimRafRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      isMobileRef.current = e.matches;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    shouldRenderRef.current = shouldRender;
  }, [shouldRender]);

  // Observa `open` → dispara animación de entrada/salida
  useEffect(() => {
    if (open) {
      if (closeAnimTimerRef.current) {
        clearTimeout(closeAnimTimerRef.current);
        closeAnimTimerRef.current = null;
      }
      if (isMobileRef.current) {
        setPanelOffsetY(window.innerHeight);
      }
      setIsClosing(false);
      setShouldRender(true);
    } else if (shouldRenderRef.current) {
      setIsClosing(true);
      if (isMobileRef.current) {
        setPanelOffsetY(window.innerHeight);
      }
      const duration = isMobileRef.current ? 260 : 180;
      closeAnimTimerRef.current = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        closeAnimTimerRef.current = null;
      }, duration);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Móvil: anima la pestaña hacia arriba tras montar
  useEffect(() => {
    if (!shouldRender || isClosing || !isMobile) return;
    if (openAnimRafRef.current) cancelAnimationFrame(openAnimRafRef.current);
    openAnimRafRef.current = requestAnimationFrame(() => {
      openAnimRafRef.current = requestAnimationFrame(() => {
        setPanelOffsetY(0);
        openAnimRafRef.current = null;
      });
    });
  }, [shouldRender]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (closeAnimTimerRef.current) clearTimeout(closeAnimTimerRef.current);
      if (openAnimRafRef.current) cancelAnimationFrame(openAnimRafRef.current);
    };
  }, []);

  // Bloquea el scroll del body mientras el panel está abierto
  useEffect(() => {
    if (!shouldRender) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [shouldRender]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    dragStartYRef.current = e.clientY;
    dragStartOffsetRef.current = panelOffsetY;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging) return;
    const delta = e.clientY - dragStartYRef.current;
    const raw = dragStartOffsetRef.current + delta;
    setPanelOffsetY(raw < 0 ? raw / 4 : raw);
  }

  function handlePointerUp() {
    if (!isDragging) return;
    setIsDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      onClose();
    } else {
      setPanelOffsetY(0);
    }
  }

  if (!shouldRender || typeof document === "undefined") return null;

  const titleEl = (
    <div style={{ minWidth: 0, textAlign: "center" }}>
      <h2
        style={{
          margin: 0,
          fontSize: 17,
          fontWeight: 500,
          lineHeight: 1.2,
          textAlign: "center",
          letterSpacing: "-0.02em",
          color: "#fff",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </h2>
      {subtitle ? (
        <p
          style={{
            margin: "3px 0 0",
            fontSize: 11.5,
            lineHeight: 1.35,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label={closeAriaLabel}
      style={{
        background: "none",
        border: "none",
        color: "rgba(255,255,255,0.86)",
        cursor: "pointer",
        fontSize: 32,
        fontWeight: 300,
        lineHeight: 1,
        padding: 0,
      }}
    >
      ×
    </button>
  );

  return createPortal(
    <>
      <style>{`
        @keyframes vbPanelIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        @keyframes vbPanelOut {
          from { opacity: 1; transform: scale(1)    translateY(0);    }
          to   { opacity: 0; transform: scale(0.94) translateY(10px); }
        }
        @keyframes vbPanelBdIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes vbPanelBdOut { from { opacity: 1; } to { opacity: 0; } }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999990,
          background: "rgba(0,0,0,0.52)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          animation: isClosing
            ? "vbPanelBdOut 0.18s ease forwards"
            : "vbPanelBdIn 0.18s ease",
        }}
      />

      {isMobile ? (
        /* ── Celular: pestaña deslizable desde abajo ── */
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 999991,
            maxHeight: "calc(100vh - 72px)",
            borderRadius: "22px 22px 0 0",
            border: "1px solid transparent",
            background: "rgba(8,9,11,0.96)",
            boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
            color: "#fff",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            transform: `translateY(${panelOffsetY}px)`,
            transition: isDragging
              ? "none"
              : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        >
          {/* Zona de arrastre: pill + header */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: "none", userSelect: "none", flexShrink: 0 }}
          >
            <div style={{ padding: "12px 0 4px", cursor: "grab" }}>
              <div
                style={{
                  width: 38,
                  height: 4,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.18)",
                  margin: "0 auto",
                }}
              />
            </div>

            <div
              style={{
                minHeight: 52,
                display: "grid",
                gridTemplateColumns: "48px 1fr 48px",
                alignItems: "center",
                padding: "0 12px 10px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                {closeButton}
              </div>
              {titleEl}
              <div />
            </div>
          </div>

          <div
            style={{
              padding:
                contentPadding ??
                "14px 14px calc(14px + env(safe-area-inset-bottom))",
              overflowY: "auto",
              flex: 1,
              minHeight: 0,
            }}
          >
            {children}
          </div>

          {footer ? (
            <div
              style={{
                flexShrink: 0,
                borderTop: "1px solid rgba(255,255,255,0.08)",
                padding: "12px 14px calc(14px + env(safe-area-inset-bottom))",
              }}
            >
              {footer}
            </div>
          ) : null}
        </div>
      ) : (
        /* ── Laptop: panel centrado con animación de escala ── */
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999991,
            display: "grid",
            placeItems: "center",
            paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
            paddingBottom: 14,
            paddingLeft: 14,
            paddingRight: 14,
            pointerEvents: "none",
          }}
        >
          <section
            onClick={(e) => e.stopPropagation()}
            style={{
              pointerEvents: "auto",
              width: `min(${maxWidthDesktop}px, calc(100vw - 28px))`,
              maxHeight: "calc(100dvh - 28px)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(8,9,11,0.985)",
              boxShadow:
                "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
              color: "#fff",
              animation: isClosing
                ? "vbPanelOut 0.18s ease-in forwards"
                : "vbPanelIn 0.18s ease-out",
            }}
          >
            <header
              style={{
                minHeight: 56,
                display: "grid",
                gridTemplateColumns: "48px 1fr 48px",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                flexShrink: 0,
              }}
            >
              <div />
              {titleEl}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {closeButton}
              </div>
            </header>

            <div
              style={{
                padding: contentPadding ?? "16px 18px",
                overflowY: "auto",
                flex: 1,
                minHeight: 0,
              }}
            >
              {children}
            </div>

            {footer ? (
              <div
                style={{
                  flexShrink: 0,
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  padding: "14px 18px 18px",
                }}
              >
                {footer}
              </div>
            ) : null}
          </section>
        </div>
      )}
    </>,
    document.body
  );
}
