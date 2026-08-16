"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Una columna de tambor, al estilo de las ruedas de iOS.
 *
 * El giro NO está animado por JavaScript: es un contenedor con scroll nativo y
 * `scroll-snap`. Eso da gratis la inercia y el rebote que hacen que la rueda se
 * sienta de verdad —imitar eso a mano sale mal en cuanto el dedo se mueve
 * rápido— y además funciona igual con dedo, con rueda de ratón y con teclado.
 *
 * Arriba y abajo lleva dos huecos vacíos de la mitad de la ventana, para que el
 * primer y el último valor puedan quedar centrados en la banda.
 */

/** Alto de cada renglón. Es lo que convierte la posición del scroll en índice. */
export const WHEEL_ITEM_H = 38;
/** Renglones visibles. Impar a la fuerza: tiene que haber uno en el centro. */
export const WHEEL_VISIBLE = 5;

export const WHEEL_HEIGHT = WHEEL_ITEM_H * WHEEL_VISIBLE;

const PAD = (WHEEL_ITEM_H * (WHEEL_VISIBLE - 1)) / 2;

/** Lo que se espera sin que el scroll se mueva para dar el valor por elegido. */
const SETTLE_MS = 90;

export type WheelItem = { value: string; label: string };

/**
 * Copias de la lista cuando la rueda da la vuelta. Impar, para que haya una
 * central: se arranca en ella y sobran dos a cada lado, de modo que el dedo
 * nunca llega al borde antes de que la rueda se recoloque.
 */
const LOOP_COPIES = 5;

export default function WheelColumn({
  items,
  value,
  onChange,
  ariaLabel,
  loop = false,
}: {
  items: WheelItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  /**
   * La rueda da la vuelta: después de diciembre viene enero y antes de enero,
   * diciembre. Solo para listas cíclicas de verdad —los meses—; en los años no
   * tendría sentido saltar de 2008 a 1906.
   */
  loop?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  /**
   * Mientras el dedo manda, el valor de fuera no debe reposicionar la rueda: la
   * arrancaría de un tirón a media inercia.
   */
  const userScrollingRef = useRef(false);

  const indexOfValue = items.findIndex((item) => item.value === value);

  /**
   * Lo que se pinta de verdad. Al dar la vuelta son varias copias seguidas, y el
   * truco está en que se ven idénticas: cuando el dedo se aleja de la copia
   * central, se salta a la misma posición de esa copia sin animación y no se
   * nota nada.
   */
  const rendered = loop
    ? Array.from({ length: LOOP_COPIES }, () => items).flat()
    : items;

  /** Dónde empieza la copia central. */
  const centerOffset = loop ? Math.floor(LOOP_COPIES / 2) * items.length : 0;

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const node = scrollerRef.current;
    if (!node || index < 0) return;
    node.scrollTo({ top: index * WHEEL_ITEM_H, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Colocarse en el valor que viene de fuera. También corre cuando la lista
  // cambia de tamaño —los días al cambiar de mes— y el valor sigue existiendo.
  useEffect(() => {
    if (userScrollingRef.current) return;
    const node = scrollerRef.current;
    if (!node || indexOfValue < 0) return;

    // Si ya está en una posición equivalente, no se toca: en una rueda cíclica
    // reposicionar a la copia central en cada cambio de valor daría un tirón.
    const actual = Math.round(node.scrollTop / WHEEL_ITEM_H);
    if (loop && items.length > 0) {
      const logico = ((actual % items.length) + items.length) % items.length;
      if (logico === indexOfValue) return;
    } else if (actual === indexOfValue) {
      return;
    }

    scrollToIndex(centerOffset + indexOfValue, false);
  }, [indexOfValue, items.length, centerOffset, loop, scrollToIndex]);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    },
    []
  );

  /**
   * La rueda del ratón avanza UN renglón por muesca.
   *
   * Sin esto, una sola muesca del ratón mueve unos cien píxeles —dos renglones y
   * medio— así que en una lista corta se saltaba del primero al último y había
   * opciones a las que no se podía llegar. En un tambor, una muesca es un paso.
   *
   * Va con `passive: false` porque hace falta cancelar el desplazamiento normal,
   * y React no deja pedir eso desde `onWheel`.
   */
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;

    let bloqueado = false;
    let timer: number | null = null;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (bloqueado || !node) return;

      // Un pequeño candado: sin él, el gesto continuo de un trackpad dispara
      // decenas de eventos y la rueda vuelve a volar.
      bloqueado = true;
      timer = window.setTimeout(() => {
        bloqueado = false;
      }, 110);

      const paso = e.deltaY > 0 ? 1 : -1;
      const actual = Math.round(node.scrollTop / WHEEL_ITEM_H);
      const destino = actual + paso;

      // Sin dar la vuelta no se sale de la lista; con vuelta, el reajuste del
      // final se encarga de devolver a la copia central.
      const limitado = loop
        ? destino
        : Math.max(0, Math.min(destino, items.length - 1));

      node.scrollTo({ top: limitado * WHEEL_ITEM_H, behavior: "smooth" });
    }

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [items.length, loop]);

  function handleScroll() {
    userScrollingRef.current = true;

    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      userScrollingRef.current = false;

      const node = scrollerRef.current;
      if (!node) return;

      const index = Math.round(node.scrollTop / WHEEL_ITEM_H);

      if (loop && items.length > 0) {
        const logico = ((index % items.length) + items.length) % items.length;

        // Volver a la copia central si el dedo se alejó de ella. El salto es
        // instantáneo y a una posición con el MISMO contenido a la vista, así
        // que no se percibe — es lo que hace que la rueda parezca no acabarse.
        const centrado = centerOffset + logico;
        if (index !== centrado) node.scrollTop = centrado * WHEEL_ITEM_H;

        const next = items[logico];
        if (next && next.value !== value) onChange(next.value);
        return;
      }

      const clamped = Math.max(0, Math.min(index, items.length - 1));
      const next = items[clamped];
      if (next && next.value !== value) onChange(next.value);
    }, SETTLE_MS);
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      role="listbox"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = loop
          ? ((indexOfValue + delta) % items.length + items.length) % items.length
          : Math.max(0, Math.min(indexOfValue + delta, items.length - 1));
        if (items[next]) {
          onChange(items[next].value);
          scrollToIndex(centerOffset + next, true);
        }
      }}
      className="vb-wheel"
      style={{ height: WHEEL_HEIGHT }}
    >
      <style jsx global>{`
        .vb-wheel {
          flex: 1;
          min-width: 0;
          overflow-y: scroll;
          overscroll-behavior: contain;
          scroll-snap-type: y mandatory;
          scrollbar-width: none;
          -ms-overflow-style: none;
          -webkit-overflow-scrolling: touch;
          outline: none;
          /* Los extremos se desvanecen con una mascara en vez de calcular la
             opacidad de cada renglon en cada cuadro del scroll: el efecto es el
             mismo y no cuesta ni un render. */
          -webkit-mask-image: linear-gradient(
            to bottom,
            transparent 0%,
            rgba(0, 0, 0, 0.35) 14%,
            #000 38%,
            #000 62%,
            rgba(0, 0, 0, 0.35) 86%,
            transparent 100%
          );
          mask-image: linear-gradient(
            to bottom,
            transparent 0%,
            rgba(0, 0, 0, 0.35) 14%,
            #000 38%,
            #000 62%,
            rgba(0, 0, 0, 0.35) 86%,
            transparent 100%
          );
        }

        .vb-wheel::-webkit-scrollbar {
          display: none;
        }

        .vb-wheel:focus-visible {
          border-radius: 10px;
          box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.6);
        }

        .vb-wheel-item {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          border: none;
          background: transparent;
          padding: 0;
          font-family: inherit;
          scroll-snap-align: center;
          scroll-snap-stop: always;
          font-size: 15px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.55);
          white-space: nowrap;
          user-select: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: color 140ms ease;
        }

        .vb-wheel-item:hover {
          color: rgba(255, 255, 255, 0.85);
        }

        .vb-wheel-item[data-selected="true"] {
          color: #fff;
          font-weight: 650;
        }

        @media (prefers-reduced-motion: reduce) {
          .vb-wheel-item {
            transition: none;
          }
        }
      `}</style>

      <div style={{ height: PAD }} aria-hidden="true" />

      {rendered.map((item, i) => (
        // La clave lleva el índice porque al dar la vuelta el mismo valor sale
        // varias veces, una por copia.
        <button
          key={`${item.value}-${i}`}
          type="button"
          className="vb-wheel-item"
          data-selected={item.value === value}
          role="option"
          aria-selected={item.value === value}
          style={{ height: WHEEL_ITEM_H }}
          /**
           * Tocar un renglón lo trae al centro. Es lo que la mano espera al ver
           * una opción encima o debajo: se pulsa, no se busca cómo girar. Y en
           * laptop es la salida cuando el ratón no tiene rueda.
           */
          onClick={() => {
            const node = scrollerRef.current;
            if (node) node.scrollTo({ top: i * WHEEL_ITEM_H, behavior: "smooth" });
            if (item.value !== value) onChange(item.value);
          }}
        >
          {item.label}
        </button>
      ))}

      <div style={{ height: PAD }} aria-hidden="true" />
    </div>
  );
}
