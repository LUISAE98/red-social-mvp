"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import BlurFade from "./BlurFade";

/**
 * Cabecera o pie que FLOTA sobre el contenido que scrollea, con el desenfoque
 * progresivo de BlurFade detrás.
 *
 * Existe porque el montaje se repetía en cada panel y tiene tres partes que es
 * fácil olvidar por separado:
 *
 *  1. Sacar la barra del flujo, para que el contenido le pase por DETRÁS. Sin
 *     esto no hay nada que difuminar y el efecto no se ve.
 *  2. Medirla, porque casi ninguna tiene alto fijo — un pie cambia según los
 *     botones que traiga, y una cabecera puede irse a dos renglones.
 *  3. Devolver ese alto a quien la monta, que es quien tiene que reservarle el
 *     hueco en su scroller. Para eso está `onHeight`.
 *
 * Lo que va dentro se pinta por encima del cristal; el cristal nunca captura
 * toques.
 */
export type GlassEdgeProps = {
  /** Borde al que se pega, y donde el efecto es más fuerte. */
  side?: "top" | "bottom";
  /**
   * Se llama con el hueco que hay que reservarle, cada vez que cambia. Quien la
   * monta lo usa como relleno de su scroller.
   *
   * ⚠️ Es la barra MÁS el sobresaliente, no solo la barra. El fundido no acaba
   * en el canto de la barra: baja `overhang` píxeles más adentro. Reservando
   * solo la barra, lo primero del contenido nacía dentro de la rampa y se veía
   * difuminado desde el principio, sin haber scrolleado. Con el sobresaliente
   * incluido, el contenido empieza justo donde el fundido termina.
   */
  onHeight?: (height: number) => void;
  /** Cuánto se mete el cristal en el contenido, más allá de la barra. */
  overhang?: number;
  /** Largo del desvanecido, en px. */
  fade?: number;
  blur?: number;
  /** Color del velo. Debe ser el del fondo del panel. */
  veil?: string;
  /** Por encima del contenido del panel. Súbelo si el panel apila capas. */
  zIndex?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

export default function GlassEdge({
  side = "top",
  onHeight,
  overhang = 26,
  fade = 40,
  blur = 22,
  veil = "rgba(11,11,13,0.68)",
  zIndex = 3,
  className,
  style,
  children,
}: GlassEdgeProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  // `onHeight` en una referencia: quien la monta suele pasar una función nueva
  // en cada render, y ponerla en las dependencias reengancharía el observador
  // en cada uno.
  const onHeightRef = useRef(onHeight);
  // En un efecto, no en el cuerpo del render: tocar una referencia mientras se
  // renderiza es justo lo que prohibe la regla de hooks.
  useEffect(() => {
    onHeightRef.current = onHeight;
  }, [onHeight]);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      // El BORDE, no `contentRect`: el relleno propio de la barra es justo lo
      // que hay que reservar, y `contentRect` lo excluye.
      const border = entries[0]?.borderBoxSize?.[0]?.blockSize;
      const next = Math.ceil(border ?? node.getBoundingClientRect().height);
      // Cero es que está oculta, no que mida cero.
      if (next <= 0) return;
      setHeight(next);
      // El alto del cristal es la barra + el sobresaliente, y eso es justo lo
      // que hay que reservar para que el contenido nazca limpio.
      onHeightRef.current?.(next + overhang);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [overhang]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        position: "absolute",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        top: side === "top" ? 0 : undefined,
        bottom: side === "bottom" ? 0 : undefined,
        zIndex,
        ...style,
      }}
    >
      {height > 0 ? (
        <BlurFade
          side={side}
          size={height + overhang}
          fade={fade}
          blur={blur}
          veil={veil}
        />
      ) : null}

      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
