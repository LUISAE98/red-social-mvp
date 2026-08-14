"use client";

// Comportamiento del carrusel de celular del login: qué tarjeta está activa,
// el avance automático y el salto por puntos. Solo la lógica — cada sección
// pone su propio CSS, porque en laptop unas se apilan y otras van en fila.
//
// El gesto horizontal lo resuelve el navegador con scroll nativo y scroll-snap.
// No se intercepta el touch a propósito: así un movimiento vertical sigue
// desplazando la página y nunca queda atrapado por el rail.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";

const AUTO_MS = 5000;

/** Lo que cada tarjeta necesita saber para pintar sus puntos indicadores. */
export type CarouselInfo = { count: number; current: number; onSelect: (i: number) => void };

export function useCarouselRail(count: number) {
  const isMobile = useMediaQuery(900);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // El nodo del rail va en ESTADO, no en una ref: así los efectos se rearman
  // solos cuando aparece y las funciones que lo usan pueden pasarse a las
  // tarjetas sin leer nada durante el render.
  const [rail, setRail] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  /** La persona tomó el control del rail: se acabó el avance automático. */
  const [manual, setManual] = useState(false);
  /** El rail está a la vista. Sin esto avanzaría solo con la página en otro punto. */
  const [onScreen, setOnScreen] = useState(false);

  const slideEls = useCallback((): HTMLElement[] => {
    if (!rail) return [];
    return Array.from(rail.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
  }, [rail]);

  const goTo = useCallback(
    (i: number, smooth = true) => {
      const els = slideEls();
      const target = els[i];
      if (!rail || !target) return;
      // La diferencia contra la primera tarjeta descuenta el margen del rail,
      // que es el origen desde el que se mide el acomodo.
      rail.scrollTo({ left: target.offsetLeft - els[0].offsetLeft, behavior: smooth ? "smooth" : "auto" });
    },
    [rail, slideEls],
  );

  // Tocar un punto lleva a su tarjeta y apaga el avance automático.
  const irYTomarControl = useCallback(
    (destino: number) => {
      setManual(true);
      goTo(destino);
    },
    [goTo],
  );

  const carousel = useMemo<CarouselInfo | null>(
    () => (isMobile ? { count, current: active, onSelect: irYTomarControl } : null),
    [isMobile, count, active, irYTomarControl],
  );

  // Tarjeta activa = la más cercana al borde de arranque del rail.
  useEffect(() => {
    if (!rail || !isMobile) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const els = slideEls();
      if (els.length === 0) return;
      const x = rail.scrollLeft + els[0].offsetLeft;
      let best = 0;
      let bestDist = Infinity;
      els.forEach((el, i) => {
        const d = Math.abs(el.offsetLeft - x);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(read);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      rail.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rail, isMobile, slideEls]);

  // Apaga el avance automático cuando la persona maneja el rail. Solo cuentan
  // los gestos HORIZONTALES: el rail ocupa toda la pantalla, así que dar por
  // manipulado cualquier toque haría que un scroll vertical lo detuviera para
  // el resto de la visita.
  useEffect(() => {
    if (!rail || !isMobile || manual) return;
    let x0 = 0;
    let y0 = 0;
    let siguiendo = false;
    const abajo = (e: PointerEvent) => {
      x0 = e.clientX;
      y0 = e.clientY;
      siguiendo = true;
    };
    const movimiento = (e: PointerEvent) => {
      if (!siguiendo) return;
      const dx = Math.abs(e.clientX - x0);
      const dy = Math.abs(e.clientY - y0);
      // Horizontal y con recorrido suficiente para no confundirlo con el
      // temblor del dedo al empezar a deslizar la página.
      if (dx > 12 && dx > dy) {
        setManual(true);
        siguiendo = false;
      }
    };
    const fin = () => {
      siguiendo = false;
    };
    const rueda = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) setManual(true);
    };
    const tecla = () => setManual(true);
    const opts = { passive: true } as const;
    rail.addEventListener("pointerdown", abajo, opts);
    rail.addEventListener("pointermove", movimiento, opts);
    rail.addEventListener("pointerup", fin, opts);
    rail.addEventListener("pointercancel", fin, opts);
    rail.addEventListener("wheel", rueda, opts);
    rail.addEventListener("keydown", tecla);
    return () => {
      rail.removeEventListener("pointerdown", abajo);
      rail.removeEventListener("pointermove", movimiento);
      rail.removeEventListener("pointerup", fin);
      rail.removeEventListener("pointercancel", fin);
      rail.removeEventListener("wheel", rueda);
      rail.removeEventListener("keydown", tecla);
    };
  }, [rail, isMobile, manual]);

  useEffect(() => {
    if (!rail || typeof IntersectionObserver === "undefined") return;
    // Umbral bajo: una tarjeta puede ser más alta que la pantalla, y con un
    // umbral exigente nunca se daría por visible y jamás avanzaría.
    const obs = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)), {
      threshold: 0.2,
    });
    obs.observe(rail);
    return () => obs.disconnect();
  }, [rail]);

  // Avance automático. El temporizador se rearma con cada cambio de tarjeta,
  // así que siempre son 5 s desde que se llega a una, no desde el arranque.
  useEffect(() => {
    if (!isMobile || manual || !onScreen || reduceMotion || count < 2) return;
    const next = (active + 1) % count;
    // Al cerrar la vuelta el regreso es SECO, no deslizado: recorrer las
    // tarjetas en sentido contrario se ve como un rebobinado y marea.
    const id = setTimeout(() => goTo(next, next !== 0), AUTO_MS);
    return () => clearTimeout(id);
  }, [isMobile, manual, onScreen, reduceMotion, active, count, goTo]);

  return { setRail, active, carousel, isMobile };
}
