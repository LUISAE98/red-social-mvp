import type { CSSProperties } from "react";

type VibraCommentIconProps = {
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
};

export default function VibraCommentIcon({
  size = 18,
  color = "rgba(255,255,255,0.92)",
  className,
  style,
}: VibraCommentIconProps) {
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
      <g>
        <path
          d="M12.2 4.4C7 4.4 2.8 7.5 2.8 11.3c0 2.3 1.55 4.35 3.95 5.6l-.75 2.45c-.11.36.28.67.6.48l3.05-1.8c.82.14 1.68.22 2.55.22 5.2 0 9.4-3.1 9.4-6.95S17.4 4.4 12.2 4.4Z"
          fill="rgba(0,0,0,0.28)"
          transform="translate(0.4 0.65)"
        />

        <path
          d="M12.2 4.4C7 4.4 2.8 7.5 2.8 11.3c0 2.3 1.55 4.35 3.95 5.6l-.75 2.45c-.11.36.28.67.6.48l3.05-1.8c.82.14 1.68.22 2.55.22 5.2 0 9.4-3.1 9.4-6.95S17.4 4.4 12.2 4.4Z"
          fill={color}
        />
      </g>
    </svg>
  );
}