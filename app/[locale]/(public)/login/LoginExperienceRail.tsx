"use client";

import { Children, cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from "react";
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

export default function LoginExperienceRail({ children }: { children: React.ReactNode }) {
  const isMobile = useMediaQuery(900);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const railRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  /** La persona tomó el control del rail: se acabó el avance automático. */
  const [manual, setManual] = useState(false);
  /** El rail está a la vista. Sin esto avanzaría solo con la página en otro punto. */
  const [onScreen, setOnScreen] = useState(false);

  const slides = Children.toArray(children);
  const count = slides.length;

  const slideEls = useCallback((): HTMLElement[] => {
    const rail = railRef.current;
    if (!rail) return [];
    return Array.from(rail.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
  }, []);

  const goTo = useCallback(
    (i: number, smooth = true) => {
      const rail = railRef.current;
      const els = slideEls();
      const target = els[i];
      if (!rail || !target) return;
      // La diferencia contra la primera tarjeta descuenta el padding del rail,
      // que es justo lo que scroll-padding usa como origen del snap.
      rail.scrollTo({ left: target.offsetLeft - els[0].offsetLeft, behavior: smooth ? "smooth" : "auto" });
    },
    [slideEls],
  );

  // Tarjeta activa = la más cercana al borde de arranque del rail.
  useEffect(() => {
    const rail = railRef.current;
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
  }, [isMobile, slideEls]);

  // Cualquier señal de que la persona está manejando el rail apaga el avance.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !isMobile || manual) return;
    const stop = () => setManual(true);
    const opts = { passive: true } as const;
    rail.addEventListener("pointerdown", stop, opts);
    rail.addEventListener("touchstart", stop, opts);
    rail.addEventListener("wheel", stop, opts);
    rail.addEventListener("keydown", stop);
    return () => {
      rail.removeEventListener("pointerdown", stop);
      rail.removeEventListener("touchstart", stop);
      rail.removeEventListener("wheel", stop);
      rail.removeEventListener("keydown", stop);
    };
  }, [isMobile, manual]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)), {
      threshold: 0.35,
    });
    obs.observe(rail);
    return () => obs.disconnect();
  }, []);

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

        .expRailDots {
          display: none;
        }

        @media (max-width: 900px) {
          /* Celular: carrusel de una tarjeta por vista. Sin touch-action ni
             listeners de gesto a propósito, el navegador ya distingue el
             desplazamiento vertical de la página del horizontal del rail. */
          .expRail {
            flex-direction: row;
            gap: 10px;
            /* El margen lateral es lo que permite CENTRAR también la primera y
               la última: sin él no habría recorrido para llevarlas al medio y
               quedarían pegadas a su borde. 84% + 8% + 8% = ancho completo.
               El de la izquierda va como padding; el de la derecha NO puede ir
               así porque los navegadores se comen el padding final de un
               contenedor flex con scroll y la última tarjeta se quedaría sin
               recorrido para centrarse. Va como pieza vacía al final. */
            padding: 22px 0 6px;
            padding-left: 8%;
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

          /* Cierre del recorrido para que la última tarjeta llegue al centro.
             El gap ya aporta 10px de los 8%. */
          .expRail::after {
            content: "";
            flex: 0 0 calc(8% - 10px);
          }

          /* La tarjeta se detiene CENTRADA, con la anterior y la siguiente
             asomando ~5% por cada lado. */
          .expRail > :global(.expBlock) {
            flex: 0 0 84%;
            max-width: none;
            margin: 0;
            scroll-snap-align: center;
            /* El contenido arranca ARRIBA. Todas las tarjetas miden lo mismo
               (lo que mide la más alta), y sin esto el contenido se repartía
               en ese alto, así que una de dos items quedaba con su texto a
               media pantalla y con hueco arriba y abajo. */
            align-content: start;
          }

          .expRailDots {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 7px;
            padding: 14px 0 2px;
          }
        }
      `}</style>

      <div className="expRail" ref={railRef}>
        {slides.map((child, i) =>
          isValidElement<{ active?: boolean }>(child)
            ? cloneElement(child, { active: !isMobile || i === active })
            : child,
        )}
      </div>

      <div className="expRailDots">
        {slides.map((_, i) => (
          <Dot
            key={i}
            index={i}
            active={i === active}
            onSelect={() => {
              setManual(true);
              goTo(i);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Punto indicador. El activo se alarga en vez de solo aclararse: a este tamaño
 * el cambio de forma se distingue mejor que el de color.
 */
function Dot({ index, active, onSelect }: { index: number; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Ir a la experiencia ${index + 1}`}
      aria-current={active ? "true" : undefined}
      style={{
        width: active ? 18 : 6,
        height: 6,
        padding: 0,
        border: "none",
        borderRadius: 999,
        background: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)",
        transition: "width 260ms ease, background 260ms ease",
        cursor: "pointer",
      }}
    />
  );
}
