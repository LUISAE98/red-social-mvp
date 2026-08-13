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

/**
 * Relecturas tras un cambio de foco, en milisegundos desde el aviso.
 *
 * Existen porque iOS a veces NO emite `resize`/`scroll` del viewport visual cuando
 * el teclado se retira. El navegador sí tiene la geometría buena; los que nos
 * quedamos con la vieja somos nosotros, porque nadie nos despertó. Y con geometría
 * vieja la pantalla se sigue calzando contra el área que se veía CON el teclado:
 * el campo de escritura no vuelve abajo y queda una franja, que es el fallo que
 * esto viene a cerrar.
 *
 * El teclado de iOS tarda unos 250 ms en irse y el reasiento va a trompicones, así
 * que no vale una sola relectura tardía: se mira varias veces repartidas hasta
 * pasado el final de la animación.
 */
const REASENTADO_MS = [0, 60, 150, 300, 500, 800] as const;

/**
 * @param avisoDeCambio Valor que el consumidor cambia cuando sabe que la geometría
 *   va a moverse aunque el navegador no lo anuncie — en la práctica, si el campo
 *   de escritura tiene el foco. Al cambiar dispara las relecturas de arriba.
 */
export function useVisualViewport(
  avisoDeCambio?: unknown,
): { height: number; offsetTop: number } | null {
  const [vp, setVp] = useState<{ height: number; offsetTop: number } | null>(
    null,
  );

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const v = window.visualViewport;
      if (!v) return;
      // Solo se reescribe si de verdad cambió: así un reasiento que no mueve nada
      // no provoca un render por cada relectura.
      setVp((antes) =>
        antes && antes.height === v.height && antes.offsetTop === v.offsetTop
          ? antes
          : { height: v.height, offsetTop: v.offsetTop },
      );
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Relecturas a ciegas tras el aviso, para no depender de un evento que iOS puede
  // no mandar. Va en su propio efecto para no volver a suscribir los listeners.
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const temporizadores = REASENTADO_MS.map((ms) =>
      setTimeout(() => {
        const v = window.visualViewport;
        if (!v) return;
        setVp((antes) =>
          antes && antes.height === v.height && antes.offsetTop === v.offsetTop
            ? antes
            : { height: v.height, offsetTop: v.offsetTop },
        );
      }, ms),
    );

    return () => temporizadores.forEach(clearTimeout);
  }, [avisoDeCambio]);

  return vp;
}
