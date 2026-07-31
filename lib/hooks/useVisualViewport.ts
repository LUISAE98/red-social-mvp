"use client";

import { useEffect, useState } from "react";

/**
 * Geometría del viewport VISUAL (`window.visualViewport`).
 *
 * En iOS el teclado NO encoge el viewport de LAYOUT (donde ancla `position: fixed`),
 * solo el visual. Para que un bottom-sheet quede pegado sobre el teclado sin adivinar
 * la altura del teclado ni cómo iOS desplaza los `fixed`, posicionamos su contenedor
 * fijo con estos valores crudos: `top = offsetTop`, `height = height` → el contenedor
 * calza EXACTAMENTE el área visible (arriba del teclado). Es la técnica documentada.
 *
 * Devuelve `null` hasta que hay `visualViewport` (SSR / navegadores sin la API) →
 * el consumidor cae a su layout normal (`inset: 0`).
 */
export function useVisualViewport(): { height: number; offsetTop: number } | null {
  const [vp, setVp] = useState<{ height: number; offsetTop: number } | null>(
    null,
  );

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const v = window.visualViewport;
      if (!v) return;
      setVp({ height: v.height, offsetTop: v.offsetTop });
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return vp;
}
