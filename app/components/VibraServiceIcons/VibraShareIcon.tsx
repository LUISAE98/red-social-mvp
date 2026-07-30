import type { CSSProperties } from "react";

type VibraShareIconProps = {
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
};

// Flecha de compartir con cuerpo ancho y punta definida, pero HUECA (fill none).
// Silueta contorneada con el morado de marca; mismo grosor/redondeo que el
// resto de iconos de la barra.
export default function VibraShareIcon({
  size = 20,
  color = "#a855f7",
  className,
  style,
}: VibraShareIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{
        display: "block",
        flexShrink: 0,
        ...style,
      }}
    >
      <path
        d="M12.8 4.5L21 11.5L12.8 18.5V14.2H10.5C6.7 14.2 4.2 16 2.5 19.5C2.8 12.7 5.8 9.2 10.7 9.2H12.8V4.5Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
