import React from "react";

/**
 * Ícono informativo (una "i" dentro de un círculo) que se muestra junto a la
 * descripción de un servicio cuando está INACTIVO, coloreado según el servicio:
 * saludos morado, consejos amarillo, tiempo contigo azul, sesión exclusiva rosa
 * y donaciones vino. Reemplaza a los emojis en ese estado.
 */
export default function ServiceInfoIcon({
  color,
  size = 15,
}: {
  color: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <circle cx="8" cy="8" r="6.9" stroke={color} strokeWidth="1.4" />
      <circle cx="8" cy="4.9" r="0.95" fill={color} />
      <rect x="7.15" y="6.8" width="1.7" height="4.7" rx="0.85" fill={color} />
    </svg>
  );
}
