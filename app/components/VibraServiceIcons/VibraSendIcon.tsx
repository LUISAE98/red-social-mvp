import type { CSSProperties } from "react";

type VibraSendIconProps = {
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
};

// Flecha "enviar" (paper-plane) rellena morada — el MISMO icono del envío de
// mensajes del chat en vivo (SendButton). Reutilizable para el botón de comentar.
export default function VibraSendIcon({
  size = 23,
  color = "#a855f7",
  className,
  style,
}: VibraSendIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke={color}
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flexShrink: 0, transform: "rotate(-20deg)", ...style }}
    >
      <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
    </svg>
  );
}
