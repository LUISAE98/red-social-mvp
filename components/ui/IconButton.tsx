"use client";

import React, { forwardRef } from "react";

/**
 * Botón de icono de Vibra. Fuente única de la familia más grande del producto:
 * 171 botones repartidos hoy en 88 firmas distintas, sin ningún primitivo
 * detrás. Por eso cada pantalla se inventó su propio tamaño y su propio gris.
 *
 * `label` es OBLIGATORIO y no es decoración: un botón que solo lleva un icono
 * no tiene texto que leer, así que sin `aria-label` un lector de pantalla
 * anuncia "botón" y ya. En el barrido salieron 176 así. Al exigirlo aquí, el
 * problema no se puede repetir en código nuevo.
 *
 * El hover, el active y el anillo de foco vienen de `.vibra-btn` (globals.css),
 * igual que en `Button` y `TextButton`.
 */

export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonTone = "bare" | "solid" | "brand" | "danger";
export type IconButtonShape = "circle" | "square";

export type IconButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "title"
> & {
  /** Qué hace el botón, en palabras. Va a `aria-label` y a `title`. */
  label: string;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  shape?: IconButtonShape;
  /** Oculta el `title`, para cuando el contenedor ya explica la acción. */
  sinTitulo?: boolean;
};

/** Lado del cuadrado táctil y tamaño del icono que cabe dentro. */
const SIZES: Record<IconButtonSize, { lado: number; icono: number }> = {
  sm: { lado: 32, icono: 16 },
  md: { lado: 40, icono: 20 },
  lg: { lado: 48, icono: 24 },
};

const TONES: Record<IconButtonTone, React.CSSProperties> = {
  bare: { background: "transparent", color: "rgba(255,255,255,0.86)" },
  solid: { background: "rgba(255,255,255,0.10)", color: "#fff" },
  brand: { background: "var(--brand)", color: "#fff" },
  danger: { background: "var(--error)", color: "#fff" },
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    size = "md",
    tone = "bare",
    shape = "circle",
    sinTitulo,
    children,
    disabled,
    style,
    type,
    className,
    ...rest
  },
  ref,
) {
  const { lado, icono } = SIZES[size];
  const composedStyle: React.CSSProperties = {
    width: lado,
    height: lado,
    padding: 0,
    border: "none",
    borderRadius: shape === "circle" ? "50%" : 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    fontFamily: "inherit",
    fontSize: icono,
    lineHeight: 1,
    WebkitTapHighlightColor: "transparent",
    transition: "filter var(--duration-fast) var(--ease-smooth)",
    ...TONES[tone],
    ...style,
  };

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled}
      aria-label={label}
      title={sinTitulo ? undefined : label}
      className={className ? `vibra-btn ${className}` : "vibra-btn"}
      style={composedStyle}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
