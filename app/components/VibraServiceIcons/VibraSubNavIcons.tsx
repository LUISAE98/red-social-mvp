import React from "react";

export type VibraSubnavIconType =
  | "settings"
  | "services"
  | "communities"
  | "posts"
  | "members"
  | "profiles"
  | "stories";

const vibraPurple = "#a855f7";
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
  label: "Experiencias",
  outline: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" fill="none" stroke={vibraPurple} />
      <path d="M12 7.4v9.2" fill="none" stroke={vibraPurple} />
      <path
        d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2"
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

  // Perfiles: círculo con un "monito" (persona) dentro.
  profiles: {
    label: "Perfiles",
    outline: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.4" fill="none" stroke={vibraPurple} />
        <circle cx="12" cy="9.7" r="2.3" fill="none" stroke={vibraPurple} />
        <path
          d="M8 16.7C8.6 14.4 10 13.2 12 13.2C14 13.2 15.4 14.4 16 16.7"
          fill="none"
          stroke={vibraPurple}
        />
      </svg>
    ),
  },

  // Historias: aro de Vibra con sus colores originales (gradiente rosa→morado→azul).
  // El gradiente se define dentro del propio SVG para que resuelva siempre
  // (el `url(#vibraIconGradient)` global no pinta en este contexto).
  stories: {
    label: "Historias",
    outline: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="vibraStoryRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="52%" stopColor="#9333ea" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="8.4" fill="none" stroke="url(#vibraStoryRingGradient)" />
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