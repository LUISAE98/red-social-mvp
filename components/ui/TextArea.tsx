"use client";

import React, { forwardRef } from "react";

/**
 * TextArea primitivo de Vibra (ver `vibra_style.md` › Textarea).
 * Foco visible vía `.vibra-field` en globals.css.
 */

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Marca el campo con anillo de error. */
  invalid?: boolean;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid, style, className, ...rest },
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
    resize: "none",
    outline: "none",
    ...(invalid ? { boxShadow: "0 0 0 1px var(--error)" } : null),
    ...style,
  };

  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={className ? `vibra-field ${className}` : "vibra-field"}
      style={composedStyle}
      {...rest}
    />
  );
});
