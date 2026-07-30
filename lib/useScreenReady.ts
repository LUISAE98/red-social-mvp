"use client";

import { useEffect } from "react";

// Avisa (una vez pintada) que la pantalla-destino ya está en el fondo, para que
// el splash de arranque no se quite antes de tiempo dejando la pantalla en negro.
// Lo usan las pantallas a las que se puede llegar en un arranque en frío
// (login, feed, perfil, comunidad). El splash (DesktopRefreshSplash) lo escucha.
//
// `ready` permite esperar a que la pantalla tenga su contenido base (p. ej. el
// feed tras resolver la sesión). Por defecto avisa apenas monta y pinta.
export function useScreenReady(ready: boolean = true) {
  useEffect(() => {
    if (!ready) return;
    let raf2 = 0;
    // Doble rAF: aseguramos que el navegador ya pintó el contenido detrás.
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.dispatchEvent(new Event("vibra:screen-ready"));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [ready]);
}
