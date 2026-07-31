"use client";

// Reserva de altura para el slide entre sub-pestañas (Publicaciones / Fotos /
// Videos / En vivo — y las pestañas de finanzas). Evita que el deslizamiento
// horizontal SALTE en vertical cuando la pestaña entrante es más corta o más alta
// que la saliente.
//
// CLAVE — la reserva es TRANSITORIA, no permanente:
//   - Al cambiar de pestaña se sostiene la altura de la pestaña SALIENTE como piso
//     SOLO durante la animación (~340ms). Así el slide corre a altura constante y no
//     hay salto vertical mientras se desliza.
//   - Pasado ese lapso el piso se LIBERA y la pestaña entrante se asienta en su
//     altura natural. Por eso una pestaña corta (galería vacía, finanzas sin
//     registros) NO hereda un hueco gigante de la pestaña más alta. Esto corrige el
//     "safe area falso / hueco alto" que dejaba la versión anterior (que fijaba el
//     máximo global como piso permanente).
//
// El piso solo se aplica si la pestaña SALIENTE era "reservante": nunca desde el
// feed de scroll infinito, cuya altura gigante rellenaría de espacio la entrante.
//
// @param growWithThis si la pestaña ACTUAL puede ceder su altura como piso al salir
//        (true en galerías / pestañas acotadas, false en el feed infinito).

import { useCallback, useEffect, useRef, useState } from "react";

// Un poco por encima de la duración del slide para que el piso no se suelte antes
// de que termine de deslizarse.
const SLIDE_HOLD_MS = 340;

export function useMediaSlideReservedHeight(growWithThis: boolean) {
  const [floor, setFloor] = useState<number | undefined>(undefined);

  // Valor más reciente de growWithThis (para leerlo dentro de callbacks).
  const growRef = useRef(growWithThis);
  growRef.current = growWithThis;

  // Altura viva de la pestaña actualmente montada y si ESA pestaña es reservante.
  const liveHeightRef = useRef(0);
  const mountedReservingRef = useRef(growWithThis);

  const roRef = useRef<ResizeObserver | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callback ref sobre el contenido (motion.div con key por pestaña):
  //   - se invoca con `null` al DESMONTAR la saliente  → capturamos su altura.
  //   - se invoca con el nodo al MONTAR la entrante     → re-observamos.
  const contentRef = useCallback((el: HTMLElement | null) => {
    if (el === null) {
      roRef.current?.disconnect();
      roRef.current = null;
      // Sostener la altura de la saliente durante el slide, luego liberar.
      if (mountedReservingRef.current && liveHeightRef.current > 0) {
        setFloor(liveHeightRef.current);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setFloor(undefined), SLIDE_HOLD_MS);
      }
      return;
    }

    // Monta la entrante: reset de medición + captura si esta pestaña reserva.
    liveHeightRef.current = el.offsetHeight;
    mountedReservingRef.current = growRef.current;

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      liveHeightRef.current = el.offsetHeight;
    });
    ro.observe(el);
    roRef.current?.disconnect();
    roRef.current = ro;
  }, []);

  useEffect(
    () => () => {
      roRef.current?.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // `minHeight` solo tiene valor durante la transición; en reposo es undefined →
  // cada pestaña queda en su altura natural (sin hueco).
  return { contentRef, minHeight: floor };
}
