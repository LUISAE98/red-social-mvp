"use client";

import React, { useState } from "react";

/**
 * Avatar primitivo de Vibra: imagen circular con fallback de iniciales.
 * Reemplaza las decenas de avatares ad-hoc (borderRadius:"50%" + charAt(0)).
 * El color de fallback es determinista por nombre. `ringColor` dibuja un anillo
 * exterior (para live/stories) sin afectar el layout.
 */

export type AvatarProps = {
  src?: string | null;
  /** Nombre para el `alt` y las iniciales del fallback. */
  name?: string | null;
  /** Diámetro en px. Default 40. */
  size?: number;
  /** Color del anillo exterior (ej. morado de live). Sin anillo si se omite. */
  ringColor?: string;
  /** Grosor del anillo en px. Default 2. */
  ringWidth?: number;
  /** Radio de borde: número en px o "full" (círculo, default). */
  rounded?: number | "full";
  onClick?: React.MouseEventHandler<HTMLElement>;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
};

const FALLBACK_COLORS = [
  "var(--brand)",
  "var(--pink)",
  "var(--brand-strong)",
  "#3b82f6",
  "var(--success)",
  "var(--warning)",
  "var(--pink-deep)",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

export function Avatar({
  src,
  name,
  size = 40,
  ringColor,
  ringWidth = 2,
  rounded = "full",
  onClick,
  alt,
  className,
  style,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const safeName = (name ?? "").trim();
  const borderRadius = rounded === "full" ? "50%" : rounded;

  const outer: React.CSSProperties = {
    width: size,
    height: size,
    flex: `0 0 ${size}px`,
    borderRadius,
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    boxShadow: ringColor ? `0 0 0 ${ringWidth}px ${ringColor}` : undefined,
    cursor: onClick ? "pointer" : undefined,
    userSelect: "none",
    ...style,
  };

  const showImage = Boolean(src) && !failed;

  return (
    <span className={className} style={outer} onClick={onClick} aria-label={alt ?? (safeName || undefined)}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt={alt ?? safeName}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "center",
            background: safeName ? colorForName(safeName) : "rgba(255,255,255,0.12)",
            color: "#fff",
            fontFamily: "inherit",
            fontWeight: 700,
            fontSize: Math.round(size * 0.4),
            lineHeight: 1,
          }}
        >
          {safeName ? initials(safeName) : ""}
        </span>
      )}
    </span>
  );
}
