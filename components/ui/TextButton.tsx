"use client";

import React, { forwardRef } from "react";

/**
 * Texto pulsable de Vibra. Fuente única de la familia (ver `vibra_style.md`).
 *
 * Es el botón sin caja: ni fondo, ni borde, ni relleno. Lo que lo hace pulsable
 * es el color y el peso, no un contenedor. Cubre dos usos que antes estaban
 * escritos a mano de 41 formas distintas:
 *
 *   · `brand` — la acción, en morado: "Cambiar nombre", "Ver guardados".
 *   · `plain` — la acción en blanco pleno, cuando cae sobre una foto o una
 *               tarjeta oscura y el morado no se lee: "Cambiar foto de perfil".
 *   · `mute`  — la salida o el detalle, atenuado: "Cancelar", "Ver más".
 *
 * `plain` existe porque al migrar aparecieron botones en blanco puro que en
 * `mute` se apagaban de más. Son un tono propio, no una variante mal puesta.
 *
 * El anillo de foco accesible viene de `.vibra-btn` (globals.css), igual que en
 * `Button`. Sin él, un texto sin caja es invisible al navegar con el teclado.
 */

export type TextButtonTone = "brand" | "plain" | "mute";
export type TextButtonSize = "sm" | "md";

export type TextButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: TextButtonTone;
  size?: TextButtonSize;
  /**
   * Sombra bajo el texto, para cuando cae encima de una foto. Sobre una portada
   * el morado no siempre despega del fondo.
   */
  shadow?: boolean;
};

const SIZES: Record<TextButtonSize, React.CSSProperties> = {
  sm: { fontSize: 12 },
  md: { fontSize: 13 },
};

const TONES: Record<TextButtonTone, React.CSSProperties> = {
  brand: { color: "var(--brand)" },
  plain: { color: "#fff" },
  mute: { color: "rgba(255,255,255,0.58)" },
};

export const TextButton = forwardRef<HTMLButtonElement, TextButtonProps>(function TextButton(
  { tone = "brand", size = "md", shadow, children, disabled, style, type, className, ...rest },
  ref,
) {
  const composedStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    padding: 0,
    fontFamily: "inherit",
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    WebkitTapHighlightColor: "transparent",
    transition: "opacity var(--duration-fast) var(--ease-smooth)",
    ...SIZES[size],
    ...TONES[tone],
    ...(shadow ? { textShadow: "0 1px 3px rgba(0,0,0,0.55)" } : null),
    ...style,
  };

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled}
      className={className ? `vibra-btn ${className}` : "vibra-btn"}
      style={composedStyle}
      {...rest}
    >
      {children}
    </button>
  );
});

export default TextButton;
