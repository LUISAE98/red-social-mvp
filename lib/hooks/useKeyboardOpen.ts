"use client";

import { useEffect, useState } from "react";

/**
 * ¿Está el teclado del sistema ocupando la pantalla?
 *
 * POR QUÉ EXISTE
 * ==============
 * La barra inferior es `position: fixed; bottom: 0`, y un `fixed` no se ancla a
 * lo que se ve: se ancla al VIEWPORT DE LAYOUT. Cuando sale el teclado, ese
 * viewport deja de coincidir con la pantalla, y cada sistema lo rompe distinto:
 *
 * • Android encoge el viewport de layout de verdad. Su borde inferior sube a
 *   donde empieza el teclado, y la barra —obediente— sube con él. Aparece
 *   flotando a media pantalla, encima del teclado. No es un fallo del navegador:
 *   es exactamente lo que se le pidió.
 *
 * • iOS no lo encoge; encoge solo el viewport VISUAL y lo desplaza. Safari
 *   entonces recoloca los `fixed` por su cuenta, a trompicones, y a veces se
 *   queda con el desfase puesto después de que el teclado ya se fue.
 *
 * De ahí el "a veces se vuelve loco y se sube a media pantalla": no hay nada en
 * el código que la mueva —ningún efecto le toca la posición—, la mueve el
 * navegador. Por eso no se arregla con CSS: hay que saber que el teclado está
 * abierto y decidir qué hacer.
 *
 * CÓMO SE DETECTA
 * ===============
 * Dos señales, y hacen falta las dos:
 *
 * 1. HAY UN CAMPO ENFOCADO QUE ABRE TECLADO. Un `input[type=file]` o una casilla
 *    no abren nada, y un teclado físico de iPad tampoco encoge la pantalla.
 * 2. EL ÁREA VISIBLE ENCOGIÓ respecto a su alto en reposo.
 *
 * Solo con la geometría no basta: la barra de direcciones al plegarse también
 * cambia el alto, y se leería como un teclado. Solo con el foco tampoco: con
 * teclado físico no sobra nada que esquivar.
 *
 * El alto EN REPOSO se remide continuamente mientras no hay campo enfocado. Así
 * un giro de pantalla o la barra de direcciones lo actualizan solos, sin que
 * ninguno de los dos se confunda nunca con un teclado.
 */

/** Cuánto tiene que encoger el área visible para que cuente como teclado. */
const UMBRAL_PX = 120;

/**
 * Remedidas del reposo tras soltar el foco, en ms.
 *
 * El teclado tarda en retirarse y el navegador no siempre avisa del último
 * cambio. Sin estas, el reposo podría quedarse con un alto tomado a mitad de la
 * retirada —demasiado bajo— y el siguiente teclado ya no se detectaría.
 */
const REPOSO_MS = [250, 500, 900] as const;

/** Tipos de <input> que NO abren teclado. */
const SIN_TECLADO = new Set([
  "file", "button", "submit", "reset", "image",
  "checkbox", "radio", "range", "color",
]);

function abreTeclado(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.tagName === "INPUT") {
    const tipo = ((el as HTMLInputElement).type || "text").toLowerCase();
    return !SIN_TECLADO.has(tipo);
  }
  return false;
}

export function useKeyboardOpen(): boolean {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;

    /* En Android encoge `innerHeight`; en iOS encoge `visualViewport.height`.
       Mirar el visual cuando existe cubre los dos casos con una sola medida. */
    const alturaVisible = () => vv?.height ?? window.innerHeight;

    let reposo = alturaVisible();
    let tardios: ReturnType<typeof setTimeout>[] = [];

    const revisar = () => {
      if (!abreTeclado(document.activeElement)) {
        // Sin campo enfocado, lo que se mida ES el reposo, por definición.
        reposo = alturaVisible();
        setAbierto(false);
        return;
      }
      setAbierto(alturaVisible() < reposo - UMBRAL_PX);
    };

    const alSoltarFoco = () => {
      /* Se apaga ya, sin esperar a que la geometría se entere. Si el foco solo
         salta a otro campo, el `focusin` que viene inmediatamente después lo
         vuelve a encender en la misma tanda de React: no hay parpadeo. */
      setAbierto(false);
      tardios.forEach(clearTimeout);
      tardios = REPOSO_MS.map((ms) =>
        setTimeout(() => {
          // Si el foco ya saltó a otro campo, esto NO es un reposo.
          if (!abreTeclado(document.activeElement)) reposo = alturaVisible();
        }, ms),
      );
    };

    document.addEventListener("focusin", revisar);
    document.addEventListener("focusout", alSoltarFoco);
    window.addEventListener("resize", revisar);
    window.addEventListener("orientationchange", revisar);
    vv?.addEventListener("resize", revisar);
    vv?.addEventListener("scroll", revisar);

    return () => {
      tardios.forEach(clearTimeout);
      document.removeEventListener("focusin", revisar);
      document.removeEventListener("focusout", alSoltarFoco);
      window.removeEventListener("resize", revisar);
      window.removeEventListener("orientationchange", revisar);
      vv?.removeEventListener("resize", revisar);
      vv?.removeEventListener("scroll", revisar);
    };
  }, []);

  return abierto;
}
