"use client";

import { useEffect, type RefObject } from "react";

/**
 * Auto-scroll de cortesía para listas largas dentro de un overlay.
 *
 * Al abrirse, la lista baja sola muy despacio para DELATAR que hay más
 * contenido debajo del pliegue: sin esto, un panel que llena su altura máxima
 * parece terminar ahí y el usuario nunca descubre el resto (el caso real: el
 * selector de idiomas con 23 entradas). Se detiene en cuanto el usuario toca
 * la lista — es una pista, no un secuestro del scroll.
 *
 * Lo usan los dos selectores del header (idioma y moneda), que son hermanos
 * visuales y deben comportarse igual.
 */
export function useAutoScrollHint(
  ref: RefObject<HTMLElement | null>,
  /** Solo corre mientras esté activo (típicamente `montado && abierto`). */
  active: boolean,
  { delayMs = 260, pxPerFrame = 0.6 }: { delayMs?: number; pxPerFrame?: number } = {}
) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    el.scrollTop = 0;
    let rafId: number;
    let stopped = false;

    function stop() {
      stopped = true;
      cancelAnimationFrame(rafId);
    }

    // El retraso deja terminar la animación de entrada del panel; arrancar a
    // la vez se ve como un salto, no como un desplazamiento.
    const startTimer = setTimeout(() => {
      function step() {
        if (stopped || !el) return;
        el.scrollTop += pxPerFrame;
        if (el.scrollTop < el.scrollHeight - el.clientHeight) {
          rafId = requestAnimationFrame(step);
        }
      }
      rafId = requestAnimationFrame(step);
    }, delayMs);

    el.addEventListener("wheel", stop, { passive: true, once: true });
    el.addEventListener("touchstart", stop, { passive: true, once: true });
    el.addEventListener("pointerdown", stop, { passive: true, once: true });

    return () => {
      clearTimeout(startTimer);
      cancelAnimationFrame(rafId);
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("pointerdown", stop);
    };
  }, [ref, active, delayMs, pxPerFrame]);
}
