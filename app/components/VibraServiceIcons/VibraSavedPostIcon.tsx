import type { CSSProperties } from "react";

type VibraSavedPostIconProps = {
  saved?: boolean;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
};

export default function VibraSavedPostIcon({
  saved = false,
  size = 20,
  color = "#a855ff",
  className,
  style,
}: VibraSavedPostIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
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
        d="M6.5 4.5h11v15L12 16.2l-5.5 3.3v-15Z"
        fill={saved ? color : "none"}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}