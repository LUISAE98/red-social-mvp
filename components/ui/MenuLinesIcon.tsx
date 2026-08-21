import React from "react";

/**
 * El glifo único que abre menús contextuales en Vibra: tres rayitas de largo
 * decreciente. Antes cada pantalla dibujaba su propio "⋮" — literal en unos
 * sitios, tres círculos en SVG en otros — y el mismo gesto se veía distinto
 * según dónde estuvieras. Este archivo es la forma; el disparador lo pone cada
 * pantalla con `IconButton` o su propio botón.
 *
 * `size` es el lado de la caja. El grosor del trazo no escala con ella a
 * propósito: a 16 y a 22 px la rayita debe verse igual de fina.
 */

export type MenuLinesIconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
};

export default function MenuLinesIcon({
  size = 20,
  strokeWidth = 2,
  className,
  style,
}: MenuLinesIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", flexShrink: 0, ...style }}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    >
      <path d="M4 7h16" />
      <path d="M7 12h13" />
      <path d="M10 17h10" />
    </svg>
  );
}
