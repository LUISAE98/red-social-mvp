"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import GlassEdge from "./GlassEdge";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

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
  /**
   * Título del header. Opcional: si se omite, el header queda solo con el botón
   * de cerrar y sin divisor — útil cuando el propio contenido es el mensaje
   * (diálogos de confirmación). En ese caso pasa `ariaLabel` para que el diálogo
   * conserve nombre accesible.
   *
   * OJO: el título se pinta en una sola línea con ellipsis. Si tu texto es largo
   * NO lo pases como título: se cortará. Ponlo en el contenido.
   */
  title?: React.ReactNode;
  /** Nombre accesible del diálogo cuando no hay `title` visible. */
  ariaLabel?: string;
  /**
   * Elimina el header por completo (ni título ni botón de cerrar), para diálogos
   * donde el contenido es todo el mensaje y los botones del footer ya ofrecen la
   * salida. Se sigue pudiendo cerrar con Esc, clic en el backdrop y —en pestaña
   * móvil— arrastrando. Requiere `ariaLabel`.
   */
  hideHeader?: boolean;
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
  /**
   * Presentación en celular. Por defecto `"sheet"` (pestaña deslizable desde
   * abajo), que es el patrón canónico. Usa `"centered"` para que en celular se
   * vea el MISMO panel centrado que en laptop: apropiado para diálogos de
   * confirmación cortos (salir de una comunidad, borrar algo), donde una
   * pestaña a media pantalla para dos botones se siente desproporcionada.
   */
  mobileVariant?: "sheet" | "centered";
  /**
   * Quita el fondo, el borde y la sombra del panel: el contenido queda flotando
   * sobre el velo, sin caja.
   *
   * Solo para contenidos que ya tienen forma propia y no necesitan un marco que
   * los sostenga —el selector de fecha de tambores es el caso—. El resto del
   * comportamiento no cambia: velo, arrastre, bloqueo de scroll, foco y Esc
   * siguen igual.
   */
  bareSurface?: boolean;
  /**
   * Oculta SOLO el tache, conservando el título. Distinto de `hideHeader`, que
   * se lleva los dos. Para paneles donde el contenido ya trae su propia salida,
   * o donde el tache sin caja detrás se vería suelto.
   */
  hideCloseButton?: boolean;
  /**
   * El velo que oscurece la página de detrás. Con `"none"` sigue existiendo y
   * cerrando al tocarlo, pero es transparente: para paneles que oscurecen por su
   * cuenta y no quieren apagar la pantalla entera.
   */
  backdrop?: "dim" | "none";
  /**
   * Base de apilamiento. El velo se pinta aqui y el panel una unidad por encima.
   *
   * Hay que subirla cuando el panel se abre DESDE otro modal que ya esta mas
   * alto: con el valor por omision se dibujaria detras y parece que no abre.
   */
  zIndexBase?: number;
};

export default function VibraResponsivePanel({
  open,
  onClose,
  title,
  ariaLabel,
  hideHeader,
  subtitle,
  children,
  footer,
  maxWidthDesktop = 520,
  closeAriaLabel = "Cerrar",
  contentPadding,
  mobileVariant = "sheet",
  bareSurface = false,
  hideCloseButton = false,
  backdrop = "dim",
  zIndexBase = 999990,
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

  // ¿Se presenta como pestaña inferior? Solo en celular Y si no se pidió el
  // panel centrado. Con `mobileVariant="centered"` no hay arrastre ni offset:
  // se usa la misma rama de panel centrado que en laptop.
  const useSheet = isMobile && mobileVariant === "sheet";

  // --- Arrastre en móvil ---
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  /**
   * Hueco de las barras flotantes. GlassEdge se mide sola y lo avisa; el scroll
   * lo repone con separadores, NO con relleno: quien monta el panel puede pasar
   * su propio `contentPadding` y sumarle algo encima lo rompería.
   */
  const [topInset, setTopInset] = useState(0);
  const [footInset, setFootInset] = useState(0);

  /**
   * Con `bareSurface` el panel no tiene fondo ni cantos —es una superficie
   * desnuda—, así que no hay nada que difuminar ni línea que sustituir. Ahí las
   * barras se quedan en el flujo, como siempre.
   */
  const conCristal = !bareSurface;

  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);

  const closeAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAnimRafRef = useRef<number | null>(null);

  // --- Accesibilidad de foco (#14) ---
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

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
    const sheet = isMobileRef.current && mobileVariant === "sheet";
    if (open) {
      if (closeAnimTimerRef.current) {
        clearTimeout(closeAnimTimerRef.current);
        closeAnimTimerRef.current = null;
      }
      if (sheet) {
        setPanelOffsetY(window.innerHeight);
      }
      setIsClosing(false);
      setShouldRender(true);
    } else if (shouldRenderRef.current) {
      setIsClosing(true);
      if (sheet) {
        setPanelOffsetY(window.innerHeight);
      }
      const duration = sheet ? 260 : 180;
      closeAnimTimerRef.current = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        closeAnimTimerRef.current = null;
      }, duration);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Móvil: anima la pestaña hacia arriba tras montar
  useEffect(() => {
    if (!shouldRender || isClosing || !useSheet) return;
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
  useBodyScrollLock(shouldRender);

  // --- Foco (#14): mover el foco al panel al abrir y devolverlo al cerrar ---
  useEffect(() => {
    if (!shouldRender) return;
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    // Enfoca el contenedor del diálogo para que los lectores de pantalla
    // anuncien el título y el foco de teclado quede dentro del panel.
    const raf = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      // Devuelve el foco al elemento que lo tenía antes de abrir.
      previouslyFocusedRef.current?.focus?.();
    };
  }, [shouldRender]);

  // --- Esc para cerrar ---
  useEffect(() => {
    if (!shouldRender) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shouldRender, onClose]);

  // --- Focus trap: Tab/Shift+Tab ciclan dentro del panel ---
  function handleTrapKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab") return;
    const root = panelRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

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

  const hasTitle = Boolean(title) && !hideHeader;

  // Sin título: el hueco central del header queda vacío (solo la X). El nombre
  // accesible del diálogo pasa a `aria-label`.
  const labelProps = hasTitle
    ? { "aria-labelledby": titleId }
    : ariaLabel
      ? { "aria-label": ariaLabel }
      : {};

  const titleEl = !hasTitle ? (
    <div />
  ) : (
    <div style={{ minWidth: 0, textAlign: "center" }}>
      <h2
        id={titleId}
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

  const closeButton = hideCloseButton ? null : (
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
          height: "var(--vb-alto-pantalla)",
          zIndex: zIndexBase,
          background: backdrop === "none" ? "transparent" : "rgba(0,0,0,0.52)",
          backdropFilter: backdrop === "none" ? "none" : "blur(10px)",
          WebkitBackdropFilter: backdrop === "none" ? "none" : "blur(10px)",
          animation: isClosing
            ? "vbPanelBdOut 0.18s ease forwards"
            : "vbPanelBdIn 0.18s ease",
        }}
      />

      {useSheet ? (
        /* ── Celular: pestaña deslizable desde abajo ── */
        <div
          ref={panelRef as React.RefObject<HTMLDivElement>}
          role="dialog"
          aria-modal="true"
          {...labelProps}
          tabIndex={-1}
          onKeyDown={handleTrapKeyDown}
          style={{
            position: "fixed",
            bottom: "calc(0px - var(--vb-lienzo-extra))",
            insetInlineStart: 0,
            insetInlineEnd: 0,
            zIndex: zIndexBase + 1,
            outline: "none",
            maxHeight: "calc(var(--vb-alto-pantalla) - 72px)",
            borderRadius: bareSurface ? 0 : "22px 22px 0 0",
            border: "1px solid transparent",
            background: bareSurface ? "transparent" : "rgba(8,9,11,0.96)",
            boxShadow: bareSurface ? "none" : "0 -24px 80px rgba(0,0,0,0.56)",
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
          {/* Zona de arrastre: pill + header. Flota sobre el contenido para que
              este se disuelva al pasarle por detrás en vez de cortarse. */}
          <GlassEdge
            side="top"
            onHeight={setTopInset}
            veil="rgba(8,9,11,0.68)"
            zIndex={4}
            style={conCristal ? undefined : { position: "static" }}
          >
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

            {/* Con `hideHeader` se conserva solo el pill de arrastre: sigue
                siendo la forma de cerrar la pestaña con el pulgar. */}
            {hideHeader ? null : (
              <div
                style={{
                  minHeight: hasTitle ? 52 : 40,
                  display: "grid",
                  gridTemplateColumns: "48px 1fr 48px",
                  alignItems: "center",
                  padding: hasTitle ? "0 12px 10px" : "0 12px 4px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  {closeButton}
                </div>
                {titleEl}
                <div />
              </div>
            )}
          </div>
          </GlassEdge>

          <div
            style={{
              padding:
                contentPadding ??
                "14px 14px calc(14px + var(--vb-safe-bottom, 0px))",
              overflowY: "auto",
              flex: 1,
              minHeight: 0,
            }}
          >
            {conCristal ? <div aria-hidden="true" style={{ height: topInset }} /> : null}
            {children}
            {conCristal ? <div aria-hidden="true" style={{ height: footInset }} /> : null}
          </div>

          {footer ? (
            <GlassEdge
              side="bottom"
              onHeight={setFootInset}
              veil="rgba(8,9,11,0.68)"
              zIndex={4}
              style={conCristal ? undefined : { position: "static" }}
            >
              <div
                style={{
                  flexShrink: 0,
                  padding: "12px 14px calc(14px + var(--vb-safe-bottom, 0px))",
                }}
              >
                {footer}
              </div>
            </GlassEdge>
          ) : null}
        </div>
      ) : (
        /* ── Panel centrado con animación de escala (laptop, y celular si se
              pidió mobileVariant="centered") ── */
        <div
          style={{
            position: "fixed",
            inset: 0,
            height: "var(--vb-alto-pantalla)",
            zIndex: zIndexBase + 1,
            display: "grid",
            placeItems: "center",
            paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
            // En celular el panel centrado no debe quedar bajo el indicador de
            // inicio del iOS PWA (ver --vb-safe-bottom en globals.css).
            paddingBottom: "max(14px, var(--vb-safe-bottom, 0px))",
            paddingInlineStart: 14,
            paddingInlineEnd: 14,
            pointerEvents: "none",
          }}
        >
          <section
            ref={panelRef as React.RefObject<HTMLElement>}
            role="dialog"
            aria-modal="true"
            {...labelProps}
            tabIndex={-1}
            onKeyDown={handleTrapKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{
              pointerEvents: "auto",
              // 🚨 ANCLA de la cabecera y el pie, que van en position: absolute.
              // Sin esto se anclan al backdrop —que es el fixed de pantalla
              // completa— y el título, el subtítulo y la X se salen de la
              // tarjeta y aparecen flotando arriba del todo.
              position: "relative",
              width: `min(${maxWidthDesktop}px, calc(100vw - 28px))`,
              maxHeight: "calc(var(--vb-alto-pantalla) - 28px)",
              outline: "none",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              borderRadius: bareSurface ? 0 : 12,
              border: bareSurface ? "none" : "1px solid rgba(255,255,255,0.10)",
              background: bareSurface ? "transparent" : "rgba(8,9,11,0.985)",
              boxShadow: bareSurface
                ? "none"
                : "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
              color: "#fff",
              animation: isClosing
                ? "vbPanelOut 0.18s ease-in forwards"
                : "vbPanelIn 0.18s ease-out",
            }}
          >
            {hideHeader ? null : (
              <GlassEdge
                side="top"
                onHeight={setTopInset}
                veil="rgba(8,9,11,0.68)"
                style={conCristal ? undefined : { position: "static" }}
              >
              <header
                style={{
                  minHeight: hasTitle ? 56 : 44,
                  display: "grid",
                  gridTemplateColumns: "48px 1fr 48px",
                  alignItems: "center",
                  padding: hasTitle ? "8px 12px" : "6px 12px 0",
                  flexShrink: 0,
                }}
              >
                <div />
                {titleEl}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {closeButton}
                </div>
              </header>
              </GlassEdge>
            )}

            <div
              style={{
                padding: contentPadding ?? "16px 18px",
                overflowY: "auto",
                flex: 1,
                minHeight: 0,
              }}
            >
              {conCristal && !hideHeader ? (
                <div aria-hidden="true" style={{ height: topInset }} />
              ) : null}
              {children}
              {conCristal ? <div aria-hidden="true" style={{ height: footInset }} /> : null}
            </div>

            {footer ? (
              <GlassEdge
                side="bottom"
                onHeight={setFootInset}
                veil="rgba(8,9,11,0.68)"
                style={conCristal ? undefined : { position: "static" }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    padding: "14px 18px 18px",
                  }}
                >
                  {footer}
                </div>
              </GlassEdge>
            ) : null}
          </section>
        </div>
      )}
    </>,
    document.body
  );
}
