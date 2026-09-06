"use client";

// Ancla del scroll al cambiar de sub-pestaña (Publicaciones / Fotos / Videos /
// En vivo).
//
// EL PROBLEMA. Yendo de Publicaciones a una galería vacía, el documento pasaba
// de miles de píxeles a casi nada de golpe. El navegador no tiene a dónde
// llevarte, así que recorta el scroll al nuevo máximo, y eso se ve como un
// escalón seco hacia abajo con la pestaña ya cambiada.
//
// `useMediaSlideReservedHeight` no lo cubre: sostiene la altura de la pestaña
// saliente durante el deslizamiento, pero A PROPÓSITO no lo hace cuando sales
// del feed infinito —heredar su altura llenaría de hueco vacío a la entrante—,
// y salir del feed es justo el caso que se reporta.
//
// LA CURA son dos cosas juntas, y hacen falta las dos:
//
//  1. Un piso de una pantalla en el contenedor del slide, para que el documento
//     no colapse por debajo del viewport. Invisible cuando el contenido es más
//     corto, y suficiente para que el recorte no tenga nada que recortar.
//  2. Llevar el scroll a la altura del subnav ANTES de que se pinte la pestaña
//     nueva. Así el movimiento es deliberado y va al sitio donde de verdad
//     empieza el contenido, en vez de ser un tirón del navegador.
//
// Es lo mismo que ya hacía Guardados a mano; aquí vive en un solo sitio.

import { useCallback, useLayoutEffect, useRef } from "react";

export function useMediaTabAnchor<T>(
  tab: T,
  cambiar: (siguiente: T) => void
) {
  const anclaRef = useRef<HTMLDivElement | null>(null);
  const pendienteRef = useRef(false);

  const alCambiarPestana = useCallback(
    (siguiente: T) => {
      if (siguiente === tab) return;
      pendienteRef.current = true;
      cambiar(siguiente);
    },
    [tab, cambiar]
  );

  // `useLayoutEffect` y no `useEffect`: tiene que correr ANTES de que el
  // navegador pinte la pestaña nueva, o el escalón ya se vio.
  useLayoutEffect(() => {
    if (!pendienteRef.current) return;
    pendienteRef.current = false;

    const ancla = anclaRef.current;
    if (!ancla) return;

    const arriba = ancla.getBoundingClientRect().top + window.scrollY;

    // Si estabas POR ENCIMA del subnav —mirando la cabecera del perfil— no se
    // te empuja hacia abajo: ahí no hay nada que recortar.
    if (window.scrollY > arriba) window.scrollTo(0, arriba);
  }, [tab]);

  return { anclaRef, alCambiarPestana };
}
