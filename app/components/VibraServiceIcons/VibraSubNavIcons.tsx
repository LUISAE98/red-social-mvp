"use client";

import React from "react";

export type VibraSubnavIconType =
  | "settings"
  | "services"
  | "communities"
  | "posts"
  | "members";

const vibraPurple = "#a855ff";
const SUBNAV_ICON_CONFIG: Record<
  VibraSubnavIconType,
  {
    label: string;
    outline: React.ReactNode;
  }
> = {
  settings: {
    label: "Configuración",
    outline: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3.2L13.15 5.55C13.72 5.72 14.25 5.95 14.73 6.25L17.25 5.4L18.95 8.35L16.85 10C16.9 10.32 16.93 10.66 16.93 11C16.93 11.34 16.9 11.68 16.85 12L18.95 13.65L17.25 16.6L14.73 15.75C14.25 16.05 13.72 16.28 13.15 16.45L12 18.8H8.6L7.45 16.45C6.88 16.28 6.35 16.05 5.87 15.75L3.35 16.6L1.65 13.65L3.75 12C3.7 11.68 3.67 11.34 3.67 11C3.67 10.66 3.7 10.32 3.75 10L1.65 8.35L3.35 5.4L5.87 6.25C6.35 5.95 6.88 5.72 7.45 5.55L8.6 3.2H12Z"
          fill="none"
          stroke={vibraPurple}
        />
        <circle cx="10.3" cy="11" r="2.65" fill="none" stroke={vibraPurple} />
      </svg>
    ),
  },

services: {
  label: "Servicios",
  outline: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="2.6"
        y="5.2"
        width="18.8"
        height="13.6"
        rx="2.8"
        fill="none"
        stroke={vibraPurple}
      />

      <circle
        cx="12"
        cy="12"
        r="4.45"
        fill="none"
        stroke={vibraPurple}
      />

      <path
        d="M12 8.75V15.25"
        fill="none"
        stroke={vibraPurple}
      />

      <path
        d="M13.75 10.25C13.35 9.7 12.75 9.4 12.05 9.45C11.35 9.5 10.85 9.9 10.85 10.55C10.85 11.25 11.45 11.55 12.25 11.78C13.15 12.05 13.85 12.45 13.85 13.35C13.85 14.15 13.2 14.6 12.25 14.68C11.45 14.75 10.75 14.4 10.35 13.8"
        fill="none"
        stroke={vibraPurple}
      />
    </svg>
  ),
},

  communities: {
    label: "Comunidades",
    outline: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.4" fill="none" stroke={vibraPurple} />

        <path d="M3.9 12H20.1" fill="none" stroke={vibraPurple} />

        <path
          d="M12 3.6C14.05 5.65 15.15 8.55 15.15 12C15.15 15.45 14.05 18.35 12 20.4"
          fill="none"
          stroke={vibraPurple}
        />

        <path
          d="M12 3.6C9.95 5.65 8.85 8.55 8.85 12C8.85 15.45 9.95 18.35 12 20.4"
          fill="none"
          stroke={vibraPurple}
        />

        <path
          d="M5.8 7.15C7.35 8 9.45 8.5 12 8.5C14.55 8.5 16.65 8 18.2 7.15"
          fill="none"
          stroke={vibraPurple}
        />

        <path
          d="M5.8 16.85C7.35 16 9.45 15.5 12 15.5C14.55 15.5 16.65 16 18.2 16.85"
          fill="none"
          stroke={vibraPurple}
        />
      </svg>
    ),
  },

posts: {
  label: "Posts",
  outline: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="4.4"
        y="3.6"
        width="15.2"
        height="16.8"
        rx="2.7"
        fill="none"
        stroke={vibraPurple}
      />

      <path d="M7.6 7.3H16.4" fill="none" stroke={vibraPurple} />
      <path d="M7.6 10.4H16.4" fill="none" stroke={vibraPurple} />
      <path d="M7.6 13.5H16.4" fill="none" stroke={vibraPurple} />
      <path d="M7.6 16.6H16.4" fill="none" stroke={vibraPurple} />
    </svg>
  ),
},

  members: {
    label: "Integrantes",
    outline: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8.5" r="3" fill="none" stroke={vibraPurple} />
        <circle cx="16.2" cy="9.5" r="2.4" fill="none" stroke={vibraPurple} />
        <path
          d="M3.8 19C4.6 15.2 6.4 13.2 9 13.2C11.6 13.2 13.4 15.2 14.2 19"
          fill="none"
          stroke={vibraPurple}
        />
        <path
          d="M13.8 14.2C16.4 14.3 18.2 16 19.2 19"
          fill="none"
          stroke={vibraPurple}
        />
      </svg>
    ),
  },
};

export function VibraSubnavIcon({
  type,
  label,
  size = 22,
  showLabel = false,
  strokeWidth = 2,
}: {
  type: VibraSubnavIconType;
  label?: string;
  size?: number;
  showLabel?: boolean;
  strokeWidth?: number;
}) {
  const config = SUBNAV_ICON_CONFIG[type];
  const finalLabel = label ?? config.label;

  return (
    <span
      className="vibraSubnavIcon"
      style={
        {
          "--vibra-subnav-icon-size": `${size}px`,
          "--vibra-subnav-icon-stroke": strokeWidth,
          transform: "scale(1)",
        } as React.CSSProperties
      }
      aria-label={showLabel ? undefined : finalLabel}
      title={finalLabel}
    >
      <span className="vibraSubnavIconSvg">{config.outline}</span>

      {showLabel ? (
        <span className="vibraSubnavIconLabel">{finalLabel}</span>
      ) : null}
    </span>
  );
}

export function VibraSubnavIconsStyles() {
  return (
    <style jsx global>{`
      .vibraSubnavIcon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        line-height: 1;
        flex: 0 0 auto;
        transition: transform 0.18s ease, opacity 0.18s ease;
      }

      .vibraSubnavIconSvg {
        width: var(--vibra-subnav-icon-size);
        height: var(--vibra-subnav-icon-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
      }

      .vibraSubnavIconSvg svg {
        width: 100%;
        height: 100%;
        display: block;
        fill: none;
        stroke-width: var(--vibra-subnav-icon-stroke);
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .vibraSubnavIconSvg svg path,
      .vibraSubnavIconSvg svg circle,
      .vibraSubnavIconSvg svg rect {
        vector-effect: non-scaling-stroke;
      }

      .vibraSubnavIconLabel {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: ${vibraPurple};
        white-space: nowrap;
      }
    `}</style>
  );
}