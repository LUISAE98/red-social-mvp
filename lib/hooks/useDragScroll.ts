"use client";

// Arrastrar una tira horizontal con el ratón para recorrerla.
//
// En celular no se toca nada: el navegador ya da scroll táctil con inercia y
// secuestrar el gesto lo empeora. Por eso se descarta todo lo que no sea ratón.
//
// Las trampas de este gesto están resueltas aquí y no en cada tira, que es como
// se olvidan. Salieron del rail de comunidades, que fue el primero en tenerlo.

import { useCallback, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";

/** Píxeles de movimiento a partir de los cuales ya no es un clic. */
const CLICK_TOLERANCE = 5;

export function useDragScroll<T extends HTMLElement>(ref: RefObject<T | null>) {
  // El estado va en un ref y no en `useState` porque se actualiza en cada
  // `pointermove`, y repintar la tira sesenta veces por segundo la haría trepidar.
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: 0, captured: false });

  const onPointerDown = useCallback(
    (e: PointerEvent<T>) => {
      if (e.pointerType !== "mouse") return;
      const el = ref.current;
      if (!el) return;

      // 🚨 Nada de `preventDefault()` aquí. Cancela los eventos que el navegador
      // sintetiza después, incluido el `click`, y los elementos de la tira
      // dejarían de poder pulsarse. El arrastre nativo de las imágenes lo frena
      // `onDragStart`.
      //
      // 🚨 Y NADA de `setPointerCapture` aquí tampoco. Con el puntero capturado
      // desde el principio, el `click` se dispara sobre la TIRA y no sobre la
      // tarjeta, porque el navegador calcula su destino con los eventos ya
      // redirigidos a quien captura. Resultado: pulsar dejaba de abrir nada.
      // La captura se pide más abajo, cuando el arrastre empieza de verdad.
      drag.current = {
        active: true,
        startX: e.clientX,
        startScroll: el.scrollLeft,
        moved: 0,
        captured: false,
      };
    },
    [ref],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<T>) => {
      if (!drag.current.active) return;
      const el = ref.current;
      if (!el) return;

      const dx = e.clientX - drag.current.startX;
      drag.current.moved = Math.max(drag.current.moved, Math.abs(dx));

      // Ya es un arrastre, no un clic: ahora sí se captura, para que siga
      // funcionando aunque el cursor se salga de la tira. El clic que venga
      // detrás lo descarta `onClickCapture`, así que capturar aquí no rompe nada.
      if (!drag.current.captured && drag.current.moved > CLICK_TOLERANCE) {
        drag.current.captured = true;
        el.setPointerCapture(e.pointerId);
      }

      // Delta contra el scroll inicial, no incremental: así funciona igual en
      // RTL, donde el signo de `scrollLeft` cambia según el navegador.
      el.scrollLeft = drag.current.startScroll - dx;
    },
    [ref],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<T>) => {
      if (!drag.current.active) return;
      drag.current.active = false;
      drag.current.captured = false;
      const el = ref.current;
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    },
    [ref],
  );

  /**
   * Arrastrar no debe activar el elemento sobre el que sueltas. El `click` llega
   * después del `pointerup`, así que aquí ya se sabe cuánto se movió.
   */
  const onClickCapture = useCallback((e: MouseEvent<T>) => {
    if (drag.current.moved > CLICK_TOLERANCE) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const onDragStart = useCallback((e: { preventDefault: () => void }) => {
    e.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture, onDragStart };
}
