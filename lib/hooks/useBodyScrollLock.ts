"use client";

import { useEffect } from "react";

/**
 * Bloqueo de scroll del fondo mientras hay un panel/pestaña/overlay abierto.
 *
 * Fuente única de verdad para TODOS los paneles de Vibra: en vez de que cada
 * componente haga su propio `document.body.style.overflow = "hidden"` (que en iOS
 * Safari NO detiene el scroll por inercia y deja el fondo moviéndose), este hook:
 *
 * - Usa `position: fixed` en el `<body>` conservando la posición de scroll
 *   (`top: -scrollY`) — la única técnica que bloquea de verdad en iOS.
 * - Cuenta referencias: si hay varios paneles anidados abiertos, el fondo se
 *   libera solo cuando se cierra el último. (Todos deben usar ESTE hook para que
 *   el conteo sea correcto.)
 * - Compensa el ancho de la scrollbar en escritorio para que el layout no salte
 *   al aparecer/desaparecer la barra.
 * - Restaura la posición exacta de scroll al liberar.
 *
 * Uso: `useBodyScrollLock(open)` — bloquea mientras `open` sea true, libera al
 * cerrarse o desmontarse.
 */

let lockCount = 0;
let scrollY = 0;
let saved: {
  overflow: string;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  paddingRight: string;
  htmlOverscroll: string;
} | null = null;

function applyLock() {
  if (typeof document === "undefined") return;
  const body = document.body;
  const html = document.documentElement;

  scrollY = window.scrollY;
  saved = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    paddingRight: body.style.paddingRight,
    htmlOverscroll: html.style.overscrollBehavior,
  };

  // Compensa la scrollbar (escritorio) para evitar el salto horizontal.
  const scrollbarWidth = window.innerWidth - html.clientWidth;
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

  // Bloqueo real (incluye iOS): fija el body en su posición actual.
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";

  // Mientras haya un modal/overlay abierto, el modal controla su propio safe-area
  // inferior. Ocultamos la franja base `body::after` (ver globals.css) para que su
  // negro sólido no se transparente por debajo de los backdrops translúcidos y
  // aparezca como una "doble" franja de safe-area. Fuente ÚNICA del inset: el modal.
  body.classList.add("vb-modal-open");
}

function releaseLock() {
  if (typeof document === "undefined" || !saved) return;
  const body = document.body;
  const html = document.documentElement;

  body.style.overflow = saved.overflow;
  body.style.position = saved.position;
  body.style.top = saved.top;
  body.style.left = saved.left;
  body.style.right = saved.right;
  body.style.width = saved.width;
  body.style.paddingRight = saved.paddingRight;
  html.style.overscrollBehavior = saved.htmlOverscroll;
  body.classList.remove("vb-modal-open");
  saved = null;

  // Restaura la posición de scroll (el body fijo la había "perdido").
  window.scrollTo(0, scrollY);
}

export function useBodyScrollLock(active: boolean | null | undefined) {
  useEffect(() => {
    if (!active) return;

    lockCount += 1;
    if (lockCount === 1) applyLock();

    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        releaseLock();
      }
    };
  }, [active]);
}
