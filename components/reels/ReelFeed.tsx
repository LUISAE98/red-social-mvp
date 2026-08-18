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
import { createPortal } from "react-dom";
import type { StoryDoc } from "@/lib/stories/types";
import type { ReelItem, ReelLivePost } from "@/lib/reels/reelItems";
import { getMutePreference, setMutePreference } from "@/lib/utils/mutePreference";
import ReelStorySlide from "./ReelStorySlide";
import ReelLiveSlide from "./ReelLiveSlide";

/** Cuántas historias se montan a cada lado de la activa. */
const WINDOW = 1;
/** Cuántas quedan por delante para pedir más. */
const LOAD_MORE_MARGIN = 3;

type Props = {
  /** Historias y lives, ya mezclados y en orden. */
  items: ReelItem[];
  /** Entrar al visor de un live. */
  onOpenLive?: (post: ReelLivePost) => void;
  /** Se llama al acercarse al final. Debe ser estable. */
  onLoadMore?: () => void;
  /** Una historia se dio por vista. */
  onStoryViewed?: (storyId: string) => void;
  /**
   * Cuánto se quedó mirando cada historia al salir de ella. Es lo que distingue
   * "me interesó" de "pasé de largo", y alimenta el vector de intereses.
   */
  onEngagement?: (engagement: { story: StoryDoc; dwellMs: number; completion: number }) => void;
  /**
   * Espacio que ocupa el nav del anfitrión.
   *
   * ⚠️ NO recorta el feed: el video llega hasta el borde inferior y el nav
   * queda flotando encima. Esto solo aparta los controles del slide para que
   * no queden debajo del nav. Recortar dejaba una franja muerta entre el
   * video y el nav que se veía como un fallo de maquetación.
   */
  navClearance?: string;
};

export default function ReelFeed({
  items,
  onOpenLive,
  onLoadMore,
  onStoryViewed,
  onEngagement,
  navClearance = "0px",
}: Props) {
  // Se monta en un PORTAL sobre `document.body`.
  //
  // ⚠️ `position: fixed` deja de referirse a la pantalla en cuanto un ancestro
  // tiene `transform`, `filter` o `perspective`. El layout protegido anima la
  // columna principal con un transform al cambiar de pantalla, así que el feed
  // se anclaba al fondo de esa columna —que además reserva sitio para el nav— y
  // el video acababa flotando por encima del subnav en vez de llegar al borde.
  //
  // Fuera del árbol del layout, ningún ancestro puede volver a confinarlo. Es
  // lo mismo que hace el visor de historias, y por la misma razón.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Alto REAL del nav inferior, medido del propio elemento.
  //
  // No se calcula: su alto depende del safe-area del aparato y además el nav
  // se encoge al hacer scroll, así que cualquier número fijo queda desfasado.
  // `navClearance` solo sirve de valor inicial hasta que hay medida.
  const [navH, setNavH] = useState<number | null>(null);
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>("[data-vibra-bottom-nav]");
    if (!nav) return;

    const read = () => setNavH(nav.getBoundingClientRect().height);
    read();

    // ⚠️ El nav se encoge y crece con `transform: scaleY`, y un transform NO
    // dispara `ResizeObserver`: solo cambia la caja pintada, no la de layout.
    // Así que mientras dura su transición se muestrea cada fotograma.
    //
    // Seguirlo así, en vez de animar los botones por nuestra cuenta con la
    // misma duración y curva, es lo que hace que el movimiento se vea
    // realmente coordinado: van pegados al nav, no en paralelo a él.
    let raf = 0;
    const follow = () => {
      read();
      raf = requestAnimationFrame(follow);
    };
    const start = () => {
      if (raf) return;
      raf = requestAnimationFrame(follow);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      read();
    };

    nav.addEventListener("transitionstart", start);
    nav.addEventListener("transitionend", stop);
    nav.addEventListener("transitioncancel", stop);

    // El `transform` vive en un hijo del nav, así que los eventos llegan por
    // burbujeo; el observador cubre además los cambios de layout (rotación,
    // safe-area) que sí mueven la caja.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(nav);

    return () => {
      stop();
      nav.removeEventListener("transitionstart", start);
      nav.removeEventListener("transitionend", stop);
      nav.removeEventListener("transitioncancel", stop);
      ro?.disconnect();
    };
  }, []);

  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(
    () => typeof window !== "undefined" && getMutePreference(),
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Última página pedida, para no pedir la misma varias veces mientras llega.
  const lastLoadRequestRef = useRef(-1);

  // Medición de permanencia. Se cierra al SALIR de una historia, que es cuando se
  // sabe cuánto duró; medir al entrar solo diría que entró.
  const dwellRef = useRef<{ index: number; startedAt: number } | null>(null);
  const completionRef = useRef(0);
  // Se guardan en refs para que `closeDwell` no cambie de identidad y no
  // reinicie la medición cada vez que el padre repinta. Se actualizan en un
  // efecto, no al pintar.
  const onEngagementRef = useRef(onEngagement);
  const itemsRef = useRef(items);
  useEffect(() => {
    onEngagementRef.current = onEngagement;
    itemsRef.current = items;
  });

  const closeDwell = useCallback(() => {
    const open = dwellRef.current;
    dwellRef.current = null;
    if (!open) return;
    const item = itemsRef.current[open.index];
    // Un live no alimenta el vector de intereses: no tiene texto de contexto ni
    // categorías, que es de donde ese vector aprende.
    if (!item || item.kind !== "story") return;
    onEngagementRef.current?.({
      story: item.story,
      dwellMs: Date.now() - open.startedAt,
      completion: completionRef.current,
    });
    completionRef.current = 0;
  }, []);

  // Abre la medición de la historia activa y cierra la anterior.
  useEffect(() => {
    if (items.length === 0) return;
    closeDwell();
    dwellRef.current = { index: activeIndex, startedAt: Date.now() };
    return () => {
      closeDwell();
    };
  }, [activeIndex, items.length, closeDwell]);

  // Salir de la app cuenta como salir de la historia. Sin esto, la última que
  // miras —que suele ser la que más te interesó— nunca registra nada.
  useEffect(() => {
    const onHide = () => closeDwell();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [closeDwell]);

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
    if (items.length === 0) return;
    if (activeIndex < items.length - 1 - LOAD_MORE_MARGIN) return;
    if (lastLoadRequestRef.current === items.length) return;
    lastLoadRequestRef.current = items.length;
    onLoadMore();
  }, [activeIndex, items.length, onLoadMore]);

  const handleMutedChange = useCallback((next: boolean) => {
    setMuted(next);
    setMutePreference(next);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <>
      <style jsx>{`
        .scroller {
          position: fixed;
          inset-inline-start: 0;
          inset-inline-end: 0;
          top: 0;
          bottom: 0;
          /* Por debajo del nav inferior (9999), que va encima del video. Sin esto,
             al montarse en un portal DESPUÉS del layout, el feed taparía el nav. */
          z-index: 1;
          overflow-y: scroll;
          overflow-x: hidden;
          scroll-snap-type: y mandatory;
          /* El rebote no debe arrastrar a la página de debajo. */
          overscroll-behavior: contain;
          /* Aquí solo se navega hacia arriba y hacia abajo.
             ⚠️ Sin esto, el arrastre lateral no lo consume nadie —el reel no se
             desplaza en horizontal— y el navegador lo toma como su gesto de
             atrás/adelante: deslizar sacaba del reel y mandaba a home o a
             mensajes. Con pan-y no hay gesto lateral que atender en esta zona.
             Los controles que sí se arrastran de lado (la línea de tiempo)
             declaran touch-action none y siguen funcionando. */
          touch-action: pan-y;
          overscroll-behavior-x: none;
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
        {items.map((item, i) => {
          const mounted = Math.abs(i - activeIndex) <= WINDOW;
          const safeBottom = navH !== null ? `${Math.round(navH)}px` : navClearance;
          return (
            <div className="slide" key={item.key} onContextMenu={(e) => e.preventDefault()}>
              {mounted && item.kind === "live" && (
                <ReelLiveSlide
                  post={item.post}
                  // Fuera de pantalla suelta la conexión: un live que no se ve no
                  // puede seguir gastando datos.
                  paused={i !== activeIndex}
                  muted={muted}
                  onMutedChange={handleMutedChange}
                  onOpen={() => onOpenLive?.(item.post)}
                  safeTop="env(safe-area-inset-top, 0px)"
                  safeBottom={safeBottom}
                />
              )}
              {mounted && item.kind === "story" && (
                <ReelStorySlide
                  story={item.story}
                  // El reel NO avanza solo al terminar: repite. Avanzar por su
                  // cuenta pelearía con el scroll del dedo, que es quien manda.
                  loop
                  // Las vecinas se montan para que el video precargue, pero solo
                  // suena y corre la que está en pantalla.
                  paused={i !== activeIndex}
                  muted={muted}
                  onMutedChange={handleMutedChange}
                  // El reel no tiene barras por historia como el visor de
                  // círculos: una sola, y manipulable.
                  showProgressBar
                  safeTop="env(safe-area-inset-top, 0px)"
                  // Justo encima del nav, sin holgura extra: con margen de más
                  // los botones flotaban despegados y se leía como un error.
                  safeBottom={safeBottom}
                  onViewed={() => onStoryViewed?.(item.story.id)}
                  onProgress={
                    i === activeIndex
                      ? (ratio) => {
                          // Se guarda el MÁXIMO alcanzado, no el instante de
                          // salida: si repite, el progreso vuelve a cero y no
                          // debe borrar que ya lo había visto entero.
                          if (ratio > completionRef.current) completionRef.current = ratio;
                        }
                      : undefined
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
