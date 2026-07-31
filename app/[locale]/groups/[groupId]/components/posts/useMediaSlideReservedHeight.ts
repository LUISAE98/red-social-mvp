"use client";

// Reserva de altura para el slide de galerías del subnav de Publicaciones
// (Fotos / Videos / En vivo). Mantiene la altura de la galería MÁS ALTA vista y
// rellena con espacio transparente abajo las más cortas, para que el
// deslizamiento entre galerías no "salte" por el cambio de altura del contenido.
//
// El máximo CRECE solo desde las galerías (Fotos/Videos/En vivo), NO desde el feed
// de Publicaciones (scroll infinito → reservar su alto gigante llenaría de espacio
// las galerías). Pero el `minHeight` resultante se aplica a TODAS las pestañas —
// incluido el feed — como piso: así, al pasar a Publicaciones el contenedor no
// colapsa (el feed, que es más alto, simplemente crece por encima del piso).
//
// Aplica igual en perfil y comunidad, en celular y laptop, logueado o no.
//
// @param growWithThis si el tab actual debe HACER CRECER el máximo (true en
//        galerías, false en el feed). El piso se aplica siempre.

import { useCallback, useEffect, useRef, useState } from "react";

export function useMediaSlideReservedHeight(growWithThis: boolean) {
  const [maxHeight, setMaxHeight] = useState(0);
  // Ref para que el callback (async) del ResizeObserver lea el valor más reciente.
  const growRef = useRef(growWithThis);
  growRef.current = growWithThis;
  const roRef = useRef<ResizeObserver | null>(null);

  // Callback ref: se re-crea el observer cada vez que el contenido (motion.div) se
  // (re)monta al cambiar de sub-pestaña.
  const contentRef = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!growRef.current) return; // el feed no infla el máximo
      const h = el.offsetHeight;
      setMaxHeight((prev) => (h > prev ? h : prev));
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  useEffect(() => () => roRef.current?.disconnect(), []);

  // Piso aplicado SIEMPRE (incluido el feed): evita el colapso al cambiar de tab.
  return { contentRef, minHeight: maxHeight || undefined };
}
