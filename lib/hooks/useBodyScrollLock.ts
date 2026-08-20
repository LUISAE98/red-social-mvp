"use client";

import { useEffect } from "react";

/**
 * Bloqueo de scroll del fondo mientras hay un panel/pestaña/overlay abierto.
 *
 * Fuente única de verdad para TODOS los paneles de Vibra.
 *
 * IMPORTANTE (iOS PWA standalone): NO usamos `position: fixed` en el `<body>`.
 * Esa técnica bloquea el scroll, pero en iOS saca al body del flujo y hace que los
 * modales `position: fixed` (portaleados a `document.body`) se anclen al body
 * desplazado (`top: -scrollY`) en lugar de al viewport. Resultado: los modales
 * dejaban de llegar al borde FÍSICO inferior y aparecía una franja negra tipo
 * "safe-area" abajo (mientras que el bottom-nav, que se pinta sin body bloqueado,
 * sí llegaba al borde). Se confirmó con capturas en iPhone.
 *
 * En iOS tampoco se puede bloquear `<html>`/`<body>` con `overflow: hidden`.
 * Al abrir el teclado WebKit desplaza el visual viewport dentro del layout viewport
 * y, con la raíz bloqueada, a veces no puede devolverlo a `offsetTop = 0`. El
 * desplazamiento sobrevive al modal: compositores y barras `position: fixed`
 * quedan flotando hasta la siguiente navegación.
 *
 * Por eso hay dos estrategias:
 * - iOS: la raíz permanece desplazable y el gesto del fondo se cancela con el
 *   listener `touchmove` no pasivo. Los scrollers internos siguen permitidos.
 * - Resto: `overflow: hidden` + `overscroll-behavior: none`, que evita además la
 *   barra de scroll en escritorio sin provocar el bug de WebKit.
 *
 * - Cuenta referencias: con varios paneles anidados, el fondo se libera solo al
 *   cerrar el último. (Todos deben usar ESTE hook para que el conteo sea correcto.)
 * - Compensa el ancho de la scrollbar en escritorio para que el layout no salte.
 *
 * Uso: `useBodyScrollLock(open)` — bloquea mientras `open` sea true.
 */

let lockCount = 0;
let saved: {
  htmlOverflow: string;
  bodyOverflow: string;
  bodyPaddingRight: string;
  htmlOverscroll: string;
  bodyOverscroll: string;
  htmlTouchAction: string;
  bodyTouchAction: string;
  rootStylesApplied: boolean;
} | null = null;

/** iPadOS puede anunciarse como Macintosh cuando solicita el sitio de escritorio. */
function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

// Respaldo para iOS: `overflow: hidden` no siempre frena el scroll por inercia.
// Bloqueamos `touchmove` del fondo PERO dejamos scrollear cualquier contenedor
// scrollable dentro del modal (listas, sheets). Un solo dedo, non-passive.
function preventBackgroundTouchMove(e: TouchEvent) {
  if (e.touches.length > 1) return; // pinch-zoom: no interferir
  let el = e.target as HTMLElement | null;
  while (el && el !== document.body) {
    const s = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (s) {
      const oy = s.overflowY;
      if (
        (oy === "auto" || oy === "scroll") &&
        el.scrollHeight > el.clientHeight
      ) {
        return; // dentro de un scroller real → permitir
      }
    }
    el = el.parentElement;
  }
  if (e.cancelable) e.preventDefault();
}

function applyLock() {
  if (typeof document === "undefined") return;
  const body = document.body;
  const html = document.documentElement;

  const rootStylesApplied = !isIOSDevice();
  saved = {
    htmlOverflow: html.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
    htmlOverscroll: html.style.overscrollBehavior,
    bodyOverscroll: body.style.overscrollBehavior,
    htmlTouchAction: html.style.touchAction,
    bodyTouchAction: body.style.touchAction,
    rootStylesApplied,
  };

  if (rootStylesApplied) {
    // Compensa la scrollbar (escritorio) para evitar el salto horizontal.
    const scrollbarWidth = window.innerWidth - html.clientWidth;
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    // Fuera de iOS, el bloqueo de raíz no deja un visual viewport desplazado.
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    html.style.touchAction = "none";
    body.style.touchAction = "none";
  }

  // En iOS ESTE es el bloqueo. No tocar la raíz permite a WebKit reasentar el
  // visual viewport cuando se cierra el teclado. En los demás navegadores queda
  // como respaldo para el scroll por inercia.
  document.addEventListener("touchmove", preventBackgroundTouchMove, {
    passive: false,
  });

  body.classList.add("vb-modal-open");
}

function releaseLock() {
  if (typeof document === "undefined" || !saved) return;
  const body = document.body;
  const html = document.documentElement;

  if (saved.rootStylesApplied) {
    html.style.overflow = saved.htmlOverflow;
    body.style.overflow = saved.bodyOverflow;
    body.style.paddingRight = saved.bodyPaddingRight;
    html.style.overscrollBehavior = saved.htmlOverscroll;
    body.style.overscrollBehavior = saved.bodyOverscroll;
    html.style.touchAction = saved.htmlTouchAction;
    body.style.touchAction = saved.bodyTouchAction;
  }
  document.removeEventListener("touchmove", preventBackgroundTouchMove);
  body.classList.remove("vb-modal-open");
  saved = null;
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
