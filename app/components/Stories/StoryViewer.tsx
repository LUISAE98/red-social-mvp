"use client";

// Visor de un GRUPO de historias (las de un creador, o las de una comunidad).
//
// Aquí vive solo la NAVEGACIÓN y la presentación del contenedor: barras de
// progreso, zonas de toque a los lados, deslizar en horizontal para cambiar de
// grupo, deslizar hacia abajo para cerrar, la animación desde el círculo de
// origen, y las tres cáscaras (embebido, modal de escritorio, pantalla completa).
//
// El CONTENIDO de una historia —video, cabecera, contexto con lectura en voz
// alta y compra— vive en `ReelStorySlide`, que comparte con el feed de reels.
// Antes ambas cosas estaban en este archivo, y por eso el reel no podía
// reutilizarlo: navega scrolleando en vertical, no tocando los lados.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import { getMutePreference, setMutePreference } from "@/lib/utils/mutePreference";
import ReelStorySlide from "@/components/reels/ReelStorySlide";

type Props = {
  stories: StoryDoc[];
  type?: StoryType;
  onClose: () => void;
  /** Se agotó el grupo (último toque o fin del video). Distinto de cerrar a mano. */
  onGroupFinished?: () => void;
  onStoryViewed?: (storyId: string) => void;
  initialIndex?: number;
  /** Embebido, sin portal ni fondo. El padre da el tamaño. */
  contained?: boolean;
  /** Intento de retroceder antes de la primera historia. */
  onPrevGroup?: () => void;
  /** Botón de cerrar dentro del panel, para que anime junto con él (carrusel). */
  onCloseCarousel?: () => void;
  /** Rectángulo de origen para la animación de apertura (solo celular). */
  sourceRect?: DOMRect | null;
};

export function desktopPanelSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 380, height: 675 };
  const h = Math.min(Math.round(window.innerHeight * 0.86), 720);
  return { width: Math.round((h * 9) / 16), height: h };
}

export default function StoryViewer({
  stories,
  type,
  onClose,
  onGroupFinished,
  onStoryViewed,
  initialIndex = 0,
  contained = false,
  onPrevGroup,
  onCloseCarousel,
  sourceRect,
}: Props) {
  const tCommon = useTranslations("common");
  const [index, setIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [muted, setMuted] = useState(
    () => typeof window !== "undefined" && getMutePreference(),
  );
  const [dragY, setDragY] = useState(0);
  const [heroPhase, setHeroPhase] = useState<"entering" | "open" | "exiting" | null>(null);
  // Cuánto dura la salida. Cerrar con Escape o con el botón es más seco que
  // arrastrar hacia abajo, que acompaña al dedo.
  const [heroExitMs, setHeroExitMs] = useState(190);
  // Mantener pulsado pausa el video. El slide lo aplica; aquí solo se detecta.
  const [holding, setHolding] = useState(false);

  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdingRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Animación desde el círculo de origen: arranca en su rectángulo y se expande.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sourceRect && !contained) setHeroPhase("entering");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (heroPhase !== "entering") return;
    let id: number;
    id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setHeroPhase("open"));
    });
    return () => cancelAnimationFrame(id);
  }, [heroPhase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(pointer: fine)");
    // Sincronización inicial tras montar, para no romper la hidratación: el
    // servidor no sabe si el puntero es fino.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  const story = stories[index];

  const goTo = useCallback(
    (nextIndex: number) => {
      if (nextIndex >= stories.length) {
        if (onGroupFinished) onGroupFinished();
        else onClose();
        return;
      }
      if (nextIndex < 0) {
        onPrevGroup?.();
        return;
      }
      setIndex(nextIndex);
      setProgress(0);
    },
    [stories.length, onClose, onGroupFinished, onPrevGroup],
  );

  const heroActive = !!(heroPhase && sourceRect && !contained);

  const closeHero = useCallback((ms: number) => {
    setHeroExitMs(ms);
    setHeroPhase("exiting");
  }, []);

  const handleHeroClose = useCallback(() => closeHero(190), [closeHero]);

  // El cierre lo cronometra un efecto, no un temporizador guardado en un ref.
  // Antes ese temporizador no se limpiaba al desmontar, así que `onClose` podía
  // dispararse sobre un componente que ya no existía.
  useEffect(() => {
    if (heroPhase !== "exiting") return;
    const t = setTimeout(onClose, heroExitMs);
    return () => clearTimeout(t);
  }, [heroPhase, heroExitMs, onClose]);

  useEffect(() => {
    if (contained) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (heroActive) handleHeroClose();
        else onClose();
      }
      if (e.key === "ArrowRight") goTo(index + 1);
      if (e.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [index, goTo, onClose, contained, heroActive, handleHeroClose]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      holdingRef.current = true;
      setHolding(true);
    }, 250);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (
        contained ||
        touchStartYRef.current === null ||
        heroPhase === "entering" ||
        heroPhase === "exiting"
      )
        return;
      const dy = (e.touches[0]?.clientY ?? touchStartYRef.current) - touchStartYRef.current;
      if (dy > 0) setDragY(dy);
    },
    [contained, heroPhase],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // El dedo se levantó antes del umbral: no era un mantener pulsado.
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      const startX = touchStartXRef.current;
      const startY = touchStartYRef.current;
      touchStartXRef.current = null;
      touchStartYRef.current = null;
      const endX = e.changedTouches[0]?.clientX ?? startX ?? 0;
      const endY = e.changedTouches[0]?.clientY ?? startY ?? 0;
      const dx = endX - (startX ?? endX);
      const dy = endY - (startY ?? endY);

      if (!contained && dy > 80 && dy > Math.abs(dx)) {
        holdingRef.current = false;
        setHolding(false);
        setDragY(0);
        if (heroActive) closeHero(300);
        else onClose();
        return;
      }
      setDragY(0);

      // Horizontal dominante y de más de 50px: cambio de grupo.
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        holdingRef.current = false;
        setHolding(false);
        if (dx < 0) {
          if (onGroupFinished) onGroupFinished();
          else onClose();
        } else {
          onPrevGroup?.();
        }
        return;
      }

      // Soltar tras mantener pulsado: reanudar y tragarse el clic que viene detrás.
      if (holdingRef.current) {
        holdingRef.current = false;
        setHolding(false);
        suppressNextClickRef.current = true;
      }
    },
    [onClose, onGroupFinished, onPrevGroup, contained, heroActive, closeHero],
  );

  useBodyScrollLock(!!story);

  if (!mounted || !story) return null;

  const heroAnimating = heroPhase === "entering" || heroPhase === "exiting";

  function getHeroContainerStyle(): React.CSSProperties | null {
    if (!heroActive || !sourceRect) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = sourceRect;
    const ease = "cubic-bezier(0.16,1,0.3,1)";
    const dur = 220;
    const radius = r.width / 2;

    if (heroPhase === "entering") {
      return { insetInlineStart: r.left, top: r.top, width: r.width, height: r.height, borderRadius: radius, background: "transparent" };
    }
    if (heroPhase === "exiting") {
      const exitEase = "cubic-bezier(0.4,0,1,1)";
      const exitDur = 170;
      return { insetInlineStart: r.left, top: r.top, width: r.width, height: r.height, borderRadius: radius, background: "transparent", transition: `left ${exitDur}ms ${exitEase}, top ${exitDur}ms ${exitEase}, width ${exitDur}ms ${exitEase}, height ${exitDur}ms ${exitEase}, border-radius ${exitDur}ms ${exitEase}, background 120ms ease` };
    }
    if (dragY > 0) {
      const t = Math.min(1, dragY / vh);
      const lerp = (a: number, b: number) => a + (b - a) * t;
      return { insetInlineStart: lerp(0, r.left), top: dragY, width: lerp(vw, r.width), height: lerp(vh, r.height), borderRadius: lerp(0, radius), background: `rgba(0,0,0,${1 - t * 0.85})` };
    }
    return { insetInlineStart: 0, top: 0, width: vw, height: vh, borderRadius: 0, background: "#000", transition: `left ${dur}ms ${ease}, top ${dur}ms ${ease}, width ${dur}ms ${ease}, height ${dur}ms ${ease}, border-radius ${dur}ms ${ease}, background 190ms ease` };
  }
  const heroContainerStyle = getHeroContainerStyle();

  // ── Capas que este visor inyecta en el slide ──────────────────────────────

  const progressBars = (safeTop: string | number) => (
    <div style={{ position: "absolute", top: safeTop, insetInlineStart: 0, insetInlineEnd: 0, paddingTop: 12, paddingInlineStart: 10, paddingInlineEnd: 10, display: "flex", gap: 4, zIndex: 10 }}>
      {stories.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 2, background: "#fff", width: i < index ? "100%" : i === index ? `${Math.round(progress * 100)}%` : "0%", transition: i === index ? "none" : undefined }} />
        </div>
      ))}
    </div>
  );

  const tapZones = (
    <>
      <button
        type="button"
        aria-label={tCommon("prevStory")}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          goTo(index - 1);
        }}
        style={{ position: "absolute", top: 0, insetInlineStart: 0, width: "35%", height: "100%", background: "none", border: "none", cursor: index > 0 ? "w-resize" : "default", zIndex: 5 }}
      />
      <button
        type="button"
        aria-label={tCommon("nextStory")}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          goTo(index + 1);
        }}
        style={{ position: "absolute", top: 0, insetInlineEnd: 0, width: "65%", height: "100%", background: "none", border: "none", cursor: "e-resize", zIndex: 5 }}
      />
    </>
  );

  const closeButton = (onCloseOverride?: () => void) => (
    <button
      type="button"
      aria-label={tCommon("closeAriaLabel")}
      onClick={onCloseOverride ?? onCloseCarousel ?? onClose}
      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <svg width={isDesktop ? 20 : 24} height={isDesktop ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );

  const renderSlide = (
    safeTop: string | number = 12,
    showClose = false,
    safeBottom: string | number = 0,
    onCloseOverride?: () => void,
  ) => (
    <>
      {/* Evita la selección de texto y el menú de iOS al mantener pulsado */}
      <style>{`
        .story-viewer-root, .story-viewer-root * {
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
      `}</style>
      <ReelStorySlide
        // Remontar por historia evita arrastrar estado de la anterior (contexto
        // abierto, lectura a medias, aspecto del video). Antes se reseteaba a mano
        // con un efecto por cada cosa.
        key={story.id}
        story={story}
        type={type}
        paused={holding}
        muted={muted}
        onMutedChange={(next) => {
          setMuted(next);
          setMutePreference(next);
        }}
        compact={isDesktop}
        safeTop={safeTop}
        safeBottom={safeBottom}
        overlaysHidden={heroAnimating}
        topSlot={progressBars(safeTop)}
        tapLayer={tapZones}
        topRightActions={
          showClose || onCloseCarousel ? closeButton(onCloseOverride) : null
        }
        onProgress={setProgress}
        onViewed={() => onStoryViewed?.(story.id)}
        onEnded={() => {
          setProgress(1);
          setTimeout(() => goTo(index + 1), 120);
        }}
      />
    </>
  );

  // ── Embebido (lo usa el carrusel de escritorio) ───────────────────────────
  if (contained) {
    return (
      <div
        className="story-viewer-root"
        style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#000", userSelect: "none", WebkitUserSelect: "none" } as React.CSSProperties}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        {renderSlide(12, false)}
      </div>
    );
  }

  // ── Escritorio: modal centrado ────────────────────────────────────────────
  if (isDesktop) {
    const { width: panelW, height: panelH } = desktopPanelSize();
    return createPortal(
      <div
        style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={onClose}
      >
        <div
          style={{ position: "relative", width: panelW, height: panelH, borderRadius: 18, overflow: "hidden", background: "#000", flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {renderSlide(12, true)}
        </div>
      </div>,
      document.body,
    );
  }

  // ── Celular: pantalla completa, deslizar hacia abajo para cerrar ──────────
  return createPortal(
    <div
      className="story-viewer-root"
      style={{
        position: "fixed",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        overflow: "hidden",
        ...(heroActive
          ? (heroContainerStyle ?? { inset: 0, background: "#000" })
          : {
              inset: 0,
              background: "#000",
              transform: `translateY(${dragY}px)`,
              transition: dragY > 0 ? "none" : "transform 0.3s ease",
              opacity: 1 - Math.min(1, dragY / 300),
            }),
      } as React.CSSProperties}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      {renderSlide(
        "env(safe-area-inset-top, 0px)",
        true,
        "var(--vb-safe-bottom, 0px)",
        heroActive ? handleHeroClose : undefined,
      )}
    </div>,
    document.body,
  );
}
