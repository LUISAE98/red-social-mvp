"use client";

import type { SVGProps } from "react";

type VibraFlameIconProps = SVGProps<SVGSVGElement> & {
  active?: boolean;
  size?: number;
};

export default function VibraFlameIcon({
  active = false,
  size = 22,
  className,
  ...props
}: VibraFlameIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <style>
        {`
          .vibra-flame-like-pop {
            transform-origin: center;
            animation: vibraFlameLikePop 260ms cubic-bezier(0.2, 0.9, 0.25, 1.2);
          }

          @keyframes vibraFlameLikePop {
            0% {
              transform: scale(0.86) rotate(-3deg);
            }
            55% {
              transform: scale(1.16) rotate(2deg);
            }
            78% {
              transform: scale(0.96) rotate(-1deg);
            }
            100% {
              transform: scale(1) rotate(0deg);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .vibra-flame-like-pop {
              animation: none;
            }
          }
        `}
      </style>

      <defs>
        <linearGradient
          id="vibraFlameBodyActive"
          x1="11"
          y1="2"
          x2="11"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f4511e" />
          <stop offset="18%" stopColor="#ff6a00" />
          <stop offset="38%" stopColor="#ff8a1f" />
          <stop offset="62%" stopColor="#ffb32a" />
          <stop offset="82%" stopColor="#ffd84a" />
          <stop offset="100%" stopColor="#ffe45c" />
        </linearGradient>

        <linearGradient
          id="vibraFlameTipActive"
          x1="17"
          y1="7"
          x2="15"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="22%" stopColor="#f4511e" />
          <stop offset="48%" stopColor="#ff6a00" />
          <stop offset="74%" stopColor="#ff9f1c" />
          <stop offset="100%" stopColor="#ffc83a" />
        </linearGradient>

        <linearGradient
          id="vibraFlameCoreActive"
          x1="12"
          y1="12"
          x2="12"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffb32a" />
          <stop offset="42%" stopColor="#ffd84a" />
          <stop offset="100%" stopColor="#fff176" />
        </linearGradient>

        <linearGradient
          id="vibraFlameBodyInactive"
          x1="11"
          y1="2"
          x2="11"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#9ca3af" />
          <stop offset="100%" stopColor="#6b7280" />
        </linearGradient>

        <linearGradient
          id="vibraFlameTipInactive"
          x1="17"
          y1="7"
          x2="15"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#9ca3af" />
          <stop offset="100%" stopColor="#6b7280" />
        </linearGradient>
      </defs>

      <g className={active ? "vibra-flame-like-pop" : undefined}>
        <path
          d="M12.05 21.45c-3.95 0-7.15-2.95-7.15-6.92 0-2.72 1.47-4.72 3.02-6.46 1.42-1.6 2.86-2.93 3.06-5.2.04-.42.56-.57.84-.25 1.73 1.95 2.88 3.82 3.02 5.86.07 1.02-.14 1.9-.53 2.68.9-.38 1.68-1.1 2.08-2.16.15-.4.7-.46.93-.1 1.12 1.72 1.82 3.6 1.82 5.66 0 3.93-3.13 6.89-7.09 6.89Z"
          fill={
            active
              ? "url(#vibraFlameBodyActive)"
              : "url(#vibraFlameBodyInactive)"
          }
        />

        <path
          d="M12.15 21.45c3.85-.05 6.99-2.98 6.99-6.89 0-2.06-.7-3.94-1.82-5.66-.23-.36-.78-.3-.93.1-.4 1.06-1.18 1.78-2.08 2.16-.52.22-.76.8-.53 1.32.54 1.2.8 2.25.64 3.45-.18 1.43-.9 2.85-2.27 5.52Z"
          fill={
            active
              ? "url(#vibraFlameTipActive)"
              : "url(#vibraFlameTipInactive)"
          }
          opacity={active ? 0.9 : 0.42}
        />

        <path
          d="M11.65 20.05c-1.75-.42-2.95-1.78-2.95-3.42 0-1.28.66-2.17 1.43-2.96.68-.7 1.37-1.25 1.62-2.12.09-.32.52-.4.75-.15 1.03 1.12 1.95 2.42 1.95 4.02 0 2.2-1.12 3.82-2.8 4.63Z"
          fill={active ? "url(#vibraFlameCoreActive)" : "#d1d5db"}
          opacity={active ? 0.82 : 0.34}
        />
      </g>
    </svg>
  );
}