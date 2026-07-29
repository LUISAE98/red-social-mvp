"use client";

import React, { forwardRef } from "react";

/**
 * Input primitivo de Vibra. Mismo lenguaje visual que TextArea (ver `vibra_style.md`).
 * Foco visible vía `.vibra-field` en globals.css.
 */

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Marca el campo con anillo de error. */
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, style, className, type, ...rest },
  ref,
) {
  const composedStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.06)",
    border: "none",
    borderRadius: 12,
    padding: "10px 12px",
    color: "#fff",
    fontSize: 13,
    fontFamily: "inherit",
    lineHeight: 1.5,
    outline: "none",
    ...(invalid ? { boxShadow: "0 0 0 1px var(--error)" } : null),
    ...style,
  };

  return (
    <input
      ref={ref}
      type={type ?? "text"}
      aria-invalid={invalid || undefined}
      className={className ? `vibra-field ${className}` : "vibra-field"}
      style={composedStyle}
      {...rest}
    />
  );
});
