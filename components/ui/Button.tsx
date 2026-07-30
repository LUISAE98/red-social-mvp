"use client";

import React, { forwardRef } from "react";

/**
 * Botón primitivo de Vibra. Fuente única del estilo de botón (ver `vibra_style.md`).
 * Consume los tokens de color de `globals.css` (#6) vía `var(--brand)` etc.
 * El hover/active y el anillo de foco accesible viven en `.vibra-btn` (globals.css).
 */

export type ButtonVariant =
  | "primary" // blanco / texto oscuro (acción principal del style guide)
  | "brand" // sólido morado de marca
  | "gradient" // CTA con gradiente rosa→morado→azul
  | "secondary" // superficie translúcida
  | "ghost" // transparente
  | "danger"; // destructivo

export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Muestra spinner y deshabilita el botón. */
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

const SIZES: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: "6px 12px", fontSize: 13, borderRadius: 10 },
  md: { padding: "10px 16px", fontSize: 14, borderRadius: 12 },
  lg: { padding: "13px 20px", fontSize: 16, borderRadius: 14 },
};

const VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "#ffffff", color: "#08111d", fontWeight: 700 },
  brand: { background: "var(--brand)", color: "rgba(255,255,255,0.98)", fontWeight: 600 },
  gradient: {
    background:
      "linear-gradient(135deg, var(--pink) 0%, var(--brand-strong) 52%, #3b82f6 100%)",
    color: "#fff",
    fontWeight: 600,
  },
  secondary: { background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 600 },
  ghost: { background: "transparent", color: "rgba(255,255,255,0.86)", fontWeight: 600 },
  danger: { background: "var(--error)", color: "#fff", fontWeight: 600 },
};

const DISABLED_STYLE: React.CSSProperties = {
  background: "rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.36)",
  cursor: "not-allowed",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth,
    loading,
    leftIcon,
    rightIcon,
    children,
    disabled,
    style,
    type,
    className,
    ...rest
  },
  ref,
) {
  const isDisabled = Boolean(disabled) || Boolean(loading);
  const composedStyle: React.CSSProperties = {
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1.2,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    whiteSpace: "nowrap",
    transition:
      "filter var(--duration-fast) var(--ease-smooth), opacity var(--duration-fast) var(--ease-smooth)",
    ...SIZES[size],
    ...VARIANTS[variant],
    ...(fullWidth ? { width: "100%" } : null),
    ...(isDisabled ? DISABLED_STYLE : null),
    ...style,
  };

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={className ? `vibra-btn ${className}` : "vibra-btn"}
      style={composedStyle}
      {...rest}
    >
      {loading ? <Spinner /> : leftIcon}
      {children}
      {!loading ? rightIcon : null}
    </button>
  );
});

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.7s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
