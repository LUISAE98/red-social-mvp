"use client";

// ¿Está este bloque a la vista AHORA? Devuelve true al entrar y false al salir,
// tantas veces como haga falta: las entradas del login se rehacen cada vez que
// vuelves a enfocar una sección, no una sola vez.
//
// Se usa por SECCIÓN, no por página: si un panel largo llevara un solo
// observador, bastaría con que asomara una esquina para dar por vistas también
// las partes que siguen fuera de la pantalla.

import { useEffect, useRef, useState } from "react";

export function useInView<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    // Sin observador (navegador viejo) el contenido se muestra tal cual: el
    // estado de partida es invisible, así que un fallo aquí lo escondería.
    if (!node || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(id);
    }
    // Sale con un umbral MUCHO más bajo del que necesita para entrar.
    //
    // Sin esa diferencia el bloque parpadea al quedar justo en el borde: la
    // animación de entrada lo desplaza unos píxeles, ese desplazamiento cambia
    // cuánto se ve, eso lo saca del umbral, la animación se revierte, y vuelve
    // a entrar. Con la salida tan abajo, el movimiento de la propia animación
    // ya no alcanza a apagarla.
    const salida = Math.max(0.01, threshold * 0.35);
    const obs = new IntersectionObserver(
      (entries) => {
        const ratio = Math.max(...entries.map((e) => (e.isIntersecting ? e.intersectionRatio : 0)));
        setInView((visible) => (visible ? ratio > salida : ratio >= threshold));
      },
      { threshold: [0, salida, threshold, Math.min(1, threshold * 3)] },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [threshold]);

  return [ref, inView] as const;
}
