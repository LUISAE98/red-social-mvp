"use client";

// Feed vertical de saludos y consejos. Una historia por pantalla.
//
// La navegación es scroll nativo con anclaje (`scroll-snap`), no un gesto hecho a
// mano. Sale gratis la inercia, el rebote del sistema, el teclado y el lector de
// pantalla, y el anclaje lo hace el navegador en su propio hilo, así que no se
// entrecorta como se entrecortaría un `transform` movido desde React.
//
// Solo se montan la historia activa y sus vecinas. Las demás son un hueco vacío
// de la misma altura, para que la barra de scroll y las posiciones no se muevan.

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoryDoc } from "@/lib/stories/types";
import { getMutePreference, setMutePreference } from "@/lib/utils/mutePreference";
import ReelStorySlide from "./ReelStorySlide";

/** Cuántas historias se montan a cada lado de la activa. */
const WINDOW = 1;
/** Cuántas quedan por delante para pedir más. */
const LOAD_MORE_MARGIN = 3;

type Props = {
  stories: StoryDoc[];
  /** Se llama al acercarse al final. Debe ser estable. */
  onLoadMore?: () => void;
  /** Una historia se dio por vista. */
  onStoryViewed?: (storyId: string) => void;
  /** Espacio inferior que ocupa el nav del anfitrión. */
  safeBottom?: string;
};

export default function ReelFeed({
  stories,
  onLoadMore,
  onStoryViewed,
  safeBottom = "0px",
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(
    () => typeof window !== "undefined" && getMutePreference(),
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Última página pedida, para no pedir la misma varias veces mientras llega.
  const lastLoadRequestRef = useRef(-1);

  // El índice activo sale de la posición del scroll y no de un IntersectionObserver:
  // con anclaje obligatorio siempre hay una historia justo en el borde superior, así
  // que dividir basta y no depende de umbrales de visibilidad.
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientHeight === 0) return;
    const next = Math.round(el.scrollTop / el.clientHeight);
    setActiveIndex((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (!onLoadMore) return;
    if (stories.length === 0) return;
    if (activeIndex < stories.length - 1 - LOAD_MORE_MARGIN) return;
    if (lastLoadRequestRef.current === stories.length) return;
    lastLoadRequestRef.current = stories.length;
    onLoadMore();
  }, [activeIndex, stories.length, onLoadMore]);

  const handleMutedChange = useCallback((next: boolean) => {
    setMuted(next);
    setMutePreference(next);
  }, []);

  return (
    <>
      <style jsx>{`
        .scroller {
          position: fixed;
          inset-inline-start: 0;
          inset-inline-end: 0;
          top: 0;
          bottom: ${safeBottom};
          overflow-y: scroll;
          overflow-x: hidden;
          scroll-snap-type: y mandatory;
          /* El rebote no debe arrastrar a la página de debajo. */
          overscroll-behavior: contain;
          scrollbar-width: none;
          background: #000;
          -webkit-overflow-scrolling: touch;
        }

        .scroller::-webkit-scrollbar {
          display: none;
        }

        .slide {
          position: relative;
          width: 100%;
          height: 100%;
          scroll-snap-align: start;
          scroll-snap-stop: always;
          overflow: hidden;
          background: #000;
          /* Sin selección ni menú contextual al mantener pulsado. */
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
      `}</style>

      <div className="scroller" ref={scrollerRef} onScroll={handleScroll}>
        {stories.map((story, i) => {
          const mounted = Math.abs(i - activeIndex) <= WINDOW;
          return (
            <div className="slide" key={story.id} onContextMenu={(e) => e.preventDefault()}>
              {mounted && (
                <ReelStorySlide
                  story={story}
                  // El reel NO avanza solo al terminar: repite. Avanzar por su
                  // cuenta pelearía con el scroll del dedo, que es quien manda.
                  loop
                  // Las vecinas se montan para que el video precargue, pero solo
                  // suena y corre la que está en pantalla.
                  paused={i !== activeIndex}
                  muted={muted}
                  onMutedChange={handleMutedChange}
                  safeTop="env(safe-area-inset-top, 0px)"
                  safeBottom="12px"
                  onViewed={() => onStoryViewed?.(story.id)}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
