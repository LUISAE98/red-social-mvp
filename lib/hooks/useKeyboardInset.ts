"use client";

import { useEffect, useState } from "react";

/**
 * Altura (px) que ocupa el teclado en pantalla, vía la API `visualViewport`.
 *
 * En iOS Safari el teclado NO encoge el viewport de layout (donde se anclan los
 * `position: fixed`), solo el viewport visual. Por eso un bottom sheet anclado a
 * `bottom: 0` queda detrás del teclado y se ve el fondo en la franja de arriba.
 *
 * Este hook devuelve la altura del teclado para poder empujar el panel hacia
 * arriba (`bottom: keyboardInset`) y que quede justo sobre el teclado, sin hueco.
 * Devuelve 0 cuando no hay teclado.
 */

// En móvil real, `innerHeight - visualViewport.height` casi nunca es 0 aunque el
// teclado esté cerrado: la barra del navegador (URL/pestañas) y los redondeos
// dejan una diferencia de ~40–80px. Si eso se aplicara como inset, aparecería una
// "barra negra" fantasma sobre el safe area. Un teclado real (con su franja de
// sugerencias) siempre es bastante más alto, así que ignoramos todo lo menor a
// este umbral y lo tratamos como "sin teclado".
const MIN_KEYBOARD_PX = 120;

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const viewport = window.visualViewport;
      if (!viewport) return;
      // Espacio del layout viewport que queda tapado por abajo = teclado.
      const kb = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(kb > MIN_KEYBOARD_PX ? kb : 0);
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
