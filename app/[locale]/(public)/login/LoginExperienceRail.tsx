"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";

/**
 * Contenedor de los bloques de experiencia del login.
 *
 * En laptop no hace nada visible: los apila uno por fila, como estaban.
 *
 * En celular los convierte en un CARRUSEL de una tarjeta por vista, con la
 * siguiente asomando ~10% para que se note que hay más. El gesto horizontal lo
 * resuelve el navegador con scroll nativo y scroll-snap —no se intercepta el
 * touch—, así que un movimiento vertical sigue desplazando la página y nunca
 * queda atrapado por el rail.
 *
 * Además avanza solo cada 5 s, y se detiene en cuanto la persona lo toca: si
 * está leyendo, moverle la tarjeta debajo es lo peor que puede pasar.
 */

const AUTO_MS = 5000;

/** Lo que cada tarjeta necesita saber del carrusel para pintar sus puntos. */
type CarouselInfo = { count: number; current: number; onSelect: (i: number) => void };

export default function LoginExperienceRail({ children }: { children: React.ReactNode }) {
  const isMobile = useMediaQuery(900);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // El nodo del rail va en ESTADO, no en una ref: así los efectos se rearman
  // solos cuando aparece y las funciones que lo usan pueden pasarse a las
  // tarjetas sin leer nada durante el render.
  const [rail, setRail] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  /** La persona tomó el control del rail: se acabó el avance automático. */
  const [manual, setManual] = useState(false);
  /** El rail está a la vista. Sin esto avanzaría solo con la página en otro punto. */
  const [onScreen, setOnScreen] = useState(false);

  const slides = Children.toArray(children);
  const count = slides.length;

  const slideEls = useCallback((): HTMLElement[] => {
    if (!rail) return [];
    return Array.from(rail.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
  }, [rail]);

  const goTo = useCallback(
    (i: number, smooth = true) => {
      const els = slideEls();
      const target = els[i];
      if (!rail || !target) return;
      // La diferencia contra la primera tarjeta descuenta el margen del rail,
      // que es el origen desde el que se mide el acomodo.
      // `left` es la propiedad de scrollTo; no tiene equivalente lógico.
      rail.scrollTo({ left: target.offsetLeft - els[0].offsetLeft, behavior: smooth ? "smooth" : "auto" });
    },
    [rail, slideEls],
  );

  // Tocar un punto lleva a su tarjeta y apaga el avance automático.
  const irYTomarControl = useCallback(
    (destino: number) => {
      setManual(true);
      goTo(destino);
    },
    [goTo],
  );

  const carousel = useMemo<CarouselInfo | null>(
    () => (isMobile ? { count, current: active, onSelect: irYTomarControl } : null),
    [isMobile, count, active, irYTomarControl],
  );

  // Tarjeta activa = la más cercana al borde de arranque del rail.
  useEffect(() => {
    if (!rail || !isMobile) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const els = slideEls();
      if (els.length === 0) return;
      const x = rail.scrollLeft + els[0].offsetLeft;
      let best = 0;
      let bestDist = Infinity;
      els.forEach((el, i) => {
        const d = Math.abs(el.offsetLeft - x);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(read);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      rail.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rail, isMobile, slideEls]);

  // Apaga el avance automático cuando la persona maneja el rail. Solo cuentan
  // los gestos HORIZONTALES: antes bastaba con tocar el rail, y como ocupa toda
  // la pantalla, cualquier scroll vertical de la página lo daba por manipulado y
  // el avance no volvía a arrancar en toda la visita.
  useEffect(() => {
    if (!rail || !isMobile || manual) return;
    let x0 = 0;
    let y0 = 0;
    let siguiendo = false;
    const abajo = (e: PointerEvent) => {
      x0 = e.clientX;
      y0 = e.clientY;
      siguiendo = true;
    };
    const movimiento = (e: PointerEvent) => {
      if (!siguiendo) return;
      const dx = Math.abs(e.clientX - x0);
      const dy = Math.abs(e.clientY - y0);
      // Horizontal y con recorrido suficiente para no confundirlo con el temblor
      // del dedo al empezar a deslizar la página.
      if (dx > 12 && dx > dy) {
        setManual(true);
        siguiendo = false;
      }
    };
    const fin = () => {
      siguiendo = false;
    };
    const rueda = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) setManual(true);
    };
    const tecla = () => setManual(true);
    const opts = { passive: true } as const;
    rail.addEventListener("pointerdown", abajo, opts);
    rail.addEventListener("pointermove", movimiento, opts);
    rail.addEventListener("pointerup", fin, opts);
    rail.addEventListener("pointercancel", fin, opts);
    rail.addEventListener("wheel", rueda, opts);
    rail.addEventListener("keydown", tecla);
    return () => {
      rail.removeEventListener("pointerdown", abajo);
      rail.removeEventListener("pointermove", movimiento);
      rail.removeEventListener("pointerup", fin);
      rail.removeEventListener("pointercancel", fin);
      rail.removeEventListener("wheel", rueda);
      rail.removeEventListener("keydown", tecla);
    };
  }, [rail, isMobile, manual]);

  useEffect(() => {
    if (!rail || typeof IntersectionObserver === "undefined") return;
    // Umbral bajo: una tarjeta puede ser más alta que la pantalla, y con un
    // umbral exigente nunca se daría por visible y jamás avanzaría.
    const obs = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)), {
      threshold: 0.2,
    });
    obs.observe(rail);
    return () => obs.disconnect();
  }, [rail]);

  // Avance automático. El temporizador se rearma con cada cambio de tarjeta,
  // así que siempre son 5 s desde que se llega a una, no desde el arranque.
  useEffect(() => {
    if (!isMobile || manual || !onScreen || reduceMotion || count < 2) return;
    const next = (active + 1) % count;
    // Al cerrar la vuelta el regreso es SECO, no deslizado: recorrer las cinco
    // tarjetas en sentido contrario se ve como un rebobinado y marea.
    const id = setTimeout(() => goTo(next, next !== 0), AUTO_MS);
    return () => clearTimeout(id);
  }, [isMobile, manual, onScreen, reduceMotion, active, count, goTo]);

  return (
    <div className="expRailWrap">
      <style jsx>{`
        .expRailWrap {
          width: 100%;
        }

        /* Laptop: se apilan, una experiencia por fila. El ancho máximo lo pone
           cada bloque. */
        .expRail {
          display: flex;
          flex-direction: column;
          width: 100%;
          padding: 30px 0 8px;
          box-sizing: border-box;
        }

        @media (max-width: 900px) {
          /* Celular: carrusel de una tarjeta por vista. Sin touch-action ni
             listeners de gesto a propósito, el navegador ya distingue el
             desplazamiento vertical de la página del horizontal del rail. */
          .expRail {
            flex-direction: row;
            gap: 12px;
            /* Sin margen lateral: cada tarjeta ocupa el ancho COMPLETO, así que
               ya cae centrada por sí sola, la primera y la última incluidas. */
            padding: 22px 0 6px;
            overflow-x: auto;
            scroll-snap-type: x mandatory;
            /* Que el rebote horizontal no se propague a la página ni al gesto
               de "atrás" del navegador. */
            overscroll-behavior-x: contain;
            scrollbar-width: none;
          }
          .expRail::-webkit-scrollbar {
            display: none;
          }

          /* Una sola tarjeta a la vista, centrada y a pantalla completa. Sin
             asomo de las vecinas: la atención va a una y nada más. */
          .expRail > :global(.expBlock) {
            flex: 0 0 100%;
            max-width: none;
            margin: 0;
            scroll-snap-align: center;
            /* El contenido arranca ARRIBA. Todas las tarjetas miden lo mismo
               (lo que mide la más alta), y sin esto el contenido se repartía
               en ese alto, así que una de dos items quedaba con su texto a
               media pantalla y con hueco arriba y abajo. */
            align-content: start;
          }
        }
      `}</style>

      <div className="expRail" ref={setRail}>
        {slides.map((child, i) =>
          isValidElement<{ active?: boolean; carousel?: CarouselInfo | null }>(child)
            ? // Los puntos se pintan DENTRO de la tarjeta, debajo del círculo.
              cloneElement(child, { active: !isMobile || i === active, carousel })
            : child,
        )}
      </div>
    </div>
  );
}
