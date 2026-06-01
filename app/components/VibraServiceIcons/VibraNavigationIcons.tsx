"use client";

import React from "react";

export type VibraNavigationIconType =
  | "home"
  | "search"
  | "saved"
  | "finance"
  | "calendar"
  | "pending"
  | "history"
  | "myCommunities"
  | "otherCommunities"
  | "requested"
  | "copyLink";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
const vibraBlue = "#4f46ff";

const gradientStroke = "url(#vibraNavigationGradient)";
const purpleStroke = vibraPurple;

function VibraGradientDefs() {
  return (
    <defs>
      <linearGradient
        id="vibraNavigationGradient"
        x1="3"
        y1="3"
        x2="21"
        y2="21"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0%" stopColor={vibraPink} />
        <stop offset="45%" stopColor={vibraPurple} />
        <stop offset="100%" stopColor={vibraBlue} />
      </linearGradient>
    </defs>
  );
}

const NAVIGATION_ICON_CONFIG: Record<
  VibraNavigationIconType,
  {
    label: string;
    icon: React.ReactNode;
  }
> = {
  home: {
    label: "Inicio",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <path stroke={gradientStroke} d="M3.5 11.2 12 4l8.5 7.2" />
        <path stroke={gradientStroke} d="M5.8 10.2V20h12.4v-9.8" />
        <path stroke={gradientStroke} d="M9.5 20v-5.8h5V20" />
      </svg>
    ),
  },

  search: {
    label: "Buscar",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle stroke={purpleStroke} cx="10.8" cy="10.8" r="5.8" />
        <path stroke={purpleStroke} d="m15.1 15.1 4.4 4.4" />
      </svg>
    ),
  },

  saved: {
    label: "Guardados",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <path
          stroke={gradientStroke}
          d="M6.5 4.5h11v15L12 16.2l-5.5 3.3v-15Z"
        />
      </svg>
    ),
  },

  finance: {
    label: "Finanzas",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <path stroke={gradientStroke} d="M4.5 18.5h15" />
        <path stroke={gradientStroke} d="M7.2 18.5v-6" />
        <path stroke={gradientStroke} d="M12 18.5v-11" />
        <path stroke={gradientStroke} d="M16.8 18.5v-8" />
        <path stroke={gradientStroke} d="M6.4 7.2h4" />
        <path stroke={gradientStroke} d="M8.4 5.2v4" />
      </svg>
    ),
  },

  calendar: {
    label: "Calendario",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <rect
          stroke={gradientStroke}
          x="4.5"
          y="5.8"
          width="15"
          height="14"
          rx="2.2"
        />
        <path stroke={gradientStroke} d="M8 3.8v4" />
        <path stroke={gradientStroke} d="M16 3.8v4" />
        <path stroke={gradientStroke} d="M4.5 10h15" />
        <path stroke={gradientStroke} d="M8.2 14h.1" />
        <path stroke={gradientStroke} d="M12 14h.1" />
        <path stroke={gradientStroke} d="M15.8 14h.1" />
      </svg>
    ),
  },

  pending: {
    label: "Pendientes",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <path stroke={gradientStroke} d="M5 6.8h14" />
        <path stroke={gradientStroke} d="M5 12h9" />
        <path stroke={gradientStroke} d="M5 17.2h6" />
        <path stroke={gradientStroke} d="m15.2 17.2 2 2 4-5" />
      </svg>
    ),
  },

  history: {
    label: "Historial",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <path stroke={gradientStroke} d="M7.2 8.4A7.5 7.5 0 1 1 6.4 15" />
        <path stroke={gradientStroke} d="M4.5 8.4h2.8v2.8" />
        <path stroke={gradientStroke} d="M12 8.2v4.2l3 1.8" />
      </svg>
    ),
  },

  myCommunities: {
    label: "Mis comunidades",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <circle stroke={gradientStroke} cx="10" cy="8" r="3" />
        <path
          stroke={gradientStroke}
          d="M4.5 19c.9-4 2.8-6.2 5.5-6.2s4.6 2.2 5.5 6.2"
        />
        <path stroke={gradientStroke} d="m16.5 8.5 1.7 1.7 3.3-4" />
      </svg>
    ),
  },

  otherCommunities: {
    label: "Otras comunidades",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <circle stroke={gradientStroke} cx="8.5" cy="8.8" r="2.5" />
        <circle stroke={gradientStroke} cx="16" cy="8.8" r="2.5" />
        <path stroke={gradientStroke} d="M3.8 19c.7-3.5 2.4-5.4 4.7-5.4" />
        <path
          stroke={gradientStroke}
          d="M11.2 19c.8-3.5 2.5-5.4 4.8-5.4s4 1.9 4.8 5.4"
        />
      </svg>
    ),
  },

  requested: {
    label: "Solicitados",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />
        <path stroke={gradientStroke} d="M6.5 4.5h11v15h-11v-15Z" />
        <path stroke={gradientStroke} d="M9 9h6" />
        <path stroke={gradientStroke} d="M9 13h4" />
        <path stroke={gradientStroke} d="m14.8 17 1.6 1.6 3.4-4.3" />
      </svg>
    ),
  },

  copyLink: {
    label: "Copiar link",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <VibraGradientDefs />

        <path
          stroke="#a855ff"
          d="
            M8.1 4.1
            H12.9
            Q15.5 4.1 15.5 6.7
            V7.1
          "
        />

        <path
          stroke="#a855ff"
          d="
            M5.5 14.3
            V6.7
            Q5.5 4.1 8.1 4.1
          "
        />

        <path
          stroke="#a855ff"
          d="
            M5.5 14.3
            Q5.5 16.9 8.1 16.9
            H8.5
          "
        />

        <rect
          stroke="#a855ff"
          x="8.5"
          y="7.1"
          width="10"
          height="12.8"
          rx="2.6"
        />
      </svg>
    ),
  },
};

export function VibraNavigationIcon({
  type,
  label,
  size = 22,
  showLabel = false,
  strokeWidth = 2,
}: {
  type: VibraNavigationIconType;
  label?: string;
  size?: number;
  showLabel?: boolean;
  strokeWidth?: number;
}) {
  const config = NAVIGATION_ICON_CONFIG[type];
  const finalLabel = label ?? config.label;

  return (
    <span
      className="vibraNavigationIcon"
      style={
        {
          "--vibra-navigation-icon-size": `${size}px`,
          "--vibra-navigation-icon-stroke": strokeWidth,
        } as React.CSSProperties
      }
      aria-label={showLabel ? undefined : finalLabel}
      title={finalLabel}
    >
      <span className="vibraNavigationIconSvg">{config.icon}</span>

      {showLabel ? (
        <span className="vibraNavigationIconLabel">{finalLabel}</span>
      ) : null}
    </span>
  );
}

export function VibraNavigationIconsStyles() {
  return (
    <style jsx global>{`
      .vibraNavigationIcon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        line-height: 1;
        flex: 0 0 auto;
      }

      .vibraNavigationIconSvg {
        width: var(--vibra-navigation-icon-size);
        height: var(--vibra-navigation-icon-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
      }

      .vibraNavigationIconSvg svg {
        width: 100%;
        height: 100%;
        display: block;
        fill: none;
        stroke-width: var(--vibra-navigation-icon-stroke);
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .vibraNavigationIconLabel {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: -0.02em;
        background: linear-gradient(
          100deg,
          #ff2fb3 0%,
          #a855ff 45%,
          #4f46ff 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        white-space: nowrap;
      }
    `}</style>
  );
}