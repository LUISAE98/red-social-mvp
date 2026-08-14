"use client";

import { Children, cloneElement, isValidElement } from "react";
import { useCarouselRail, type CarouselInfo } from "./useCarouselRail";

/**
 * Contenedor de los bloques de experiencia del login.
 *
 * En laptop no hace nada visible: los apila uno por fila, como estaban.
 *
 * En celular los convierte en un CARRUSEL de una tarjeta por vista. El
 * comportamiento (tarjeta activa, avance automático, puntos) vive en
 * useCarouselRail, que comparte con las tarjetas de comunidades; aquí solo
 * queda el acomodo.
 */

export default function LoginExperienceRail({ children }: { children: React.ReactNode }) {
  const slides = Children.toArray(children);
  const { setRail, active, carousel, isMobile } = useCarouselRail(slides.length);

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
