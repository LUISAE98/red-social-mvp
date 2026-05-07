"use client";

import React from "react";

export type VibraServiceIconType =
  | "saludo"
  | "consejo"
  | "meetGreet"
  | "exclusiveSession"
  | "communities"
  | "content"
  | "realTime";

const SERVICE_CONFIG: Record<
  VibraServiceIconType,
  {
    label: string;
    color: string;
    rgb: string;
    animationClass: string;
    icon: React.ReactNode;
  }
> = {
  saludo: {
    label: "Solicitar saludo",
    color: "#7DD3FC",
    rgb: "125, 211, 252",
    animationClass: "vibraServiceIconWave",
    icon: (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M20 36V24c0-3 2-5 5-5s5 2 5 5v12" />
        <path d="M30 36V20c0-3 2-5 5-5s5 2 5 5v16" />
        <path d="M40 36V24c0-3 2-5 5-5s5 2 5 5v13" />
        <path d="M50 37v-8c0-3 2-5 5-4s4 4 3 8l-2 8c-2 9-9 14-19 14h-3c-8 0-14-4-18-11l-4-8c-2-4-1-7 2-8 3-1 5 1 7 4l3 6" />
      </svg>
    ),
  },

  consejo: {
    label: "Solicitar consejo",
    color: "#FACC15",
    rgb: "250, 204, 21",
    animationClass: "vibraServiceIconBulb",
    icon: (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M22 30c0-7 5-13 10-13s10 6 10 13c0 5-3 8-6 12-2 2-3 4-3 7h-2c0-3-1-5-3-7-3-4-6-7-6-12Z" />
        <path d="M27 50h10" />
        <path d="M28 56h8" />
        <path d="M32 6v5" />
        <path d="M16 12l4 4" />
        <path d="M48 12l-4 4" />
        <path d="M10 30h6" />
        <path d="M48 30h6" />
      </svg>
    ),
  },

  meetGreet: {
    label: "Agendar encuentro",
    color: "#A78BFA",
    rgb: "167, 139, 250",
    animationClass: "vibraServiceIconPulse",
    icon: (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="22" r="8" />
        <path d="M18 52c2-10 7-16 14-16s12 6 14 16" />
        <path d="M14 20c0-5 4-9 9-9" />
        <path d="M50 20c0-5-4-9-9-9" />
        <path d="M10 29c-2-7 0-14 5-19" />
        <path d="M54 29c2-7 0-14-5-19" />
      </svg>
    ),
  },

  exclusiveSession: {
    label: "Reservar sesión exclusiva",
    color: "#F472B6",
    rgb: "244, 114, 182",
    animationClass: "vibraServiceIconCrown",
    icon: (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M13 47l4-25 10 12 5-18 5 18 10-12 4 25H13Z" />
        <path d="M17 53h30" />
        <circle cx="17" cy="21" r="2.5" />
        <circle cx="32" cy="14" r="2.5" />
        <circle cx="47" cy="21" r="2.5" />
      </svg>
    ),
  },

  communities: {
    label: "Comunidades",
    color: "#7DD3FC",
    rgb: "125, 211, 252",
    animationClass: "vibraServiceIconPulse",
    icon: (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="22" r="7" />
        <circle cx="19" cy="28" r="5" />
        <circle cx="45" cy="28" r="5" />
        <path d="M21 50c2-8 6-12 11-12s9 4 11 12" />
        <path d="M9 49c1-6 5-10 10-10" />
        <path d="M55 49c-1-6-5-10-10-10" />
      </svg>
    ),
  },

  content: {
    label: "Contenido",
    color: "#F472B6",
    rgb: "244, 114, 182",
    animationClass: "vibraServiceIconSpark",
    icon: (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M35 6 17 34h14l-2 24 18-31H33l2-21Z" />
      </svg>
    ),
  },

  realTime: {
    label: "Tiempo real",
    color: "#A78BFA",
    rgb: "167, 139, 250",
    animationClass: "vibraServiceIconSignal",
    icon: (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="4" />
        <path d="M24 24c-4 4-4 12 0 16" />
        <path d="M40 24c4 4 4 12 0 16" />
        <path d="M17 17c-8 8-8 22 0 30" />
        <path d="M47 17c8 8 8 22 0 30" />
      </svg>
    ),
  },
};

export function VibraServiceIcon({
  type,
  label,
  size = 92,
  showLabel = true,
}: {
  type: VibraServiceIconType;
  label?: string;
  size?: number;
  showLabel?: boolean;
}) {
  const config = SERVICE_CONFIG[type];
  const finalLabel = label ?? config.label;

  return (
    <div
      className="vibraServiceIconItem"
      style={
        {
          "--service-color": config.color,
          "--service-rgb": config.rgb,
          width: showLabel ? 112 : size,
        } as React.CSSProperties
      }
    >
      <div
        className="vibraServiceIconCircle"
        style={{
          width: size,
          height: size,
        }}
      >
        <div className={`vibraServiceIconSvg ${config.animationClass}`}>
          {config.icon}
        </div>
      </div>

      {showLabel ? (
        <div className="vibraServiceIconLabel">{finalLabel}</div>
      ) : null}
    </div>
  );
}

export function VibraServiceIconsRow({
  size = 92,
  showLabel = true,
  gap = "clamp(18px, 2vw, 28px)",
}: {
  size?: number;
  showLabel?: boolean;
  gap?: number | string;
}) {
  return (
    <div className="vibraServiceIconsRow" style={{ gap }}>
      <VibraServiceIcon type="saludo" size={size} showLabel={showLabel} />
      <VibraServiceIcon type="consejo" size={size} showLabel={showLabel} />
      <VibraServiceIcon type="meetGreet" size={size} showLabel={showLabel} />
      <VibraServiceIcon
        type="exclusiveSession"
        size={size}
        showLabel={showLabel}
      />
    </div>
  );
}

export function VibraServiceIconsShowcase({
  size = 58,
  gap = 42,
}: {
  size?: number;
  gap?: number | string;
}) {
  return (
    <div className="vibraServiceIconsShowcase">
      <div className="vibraServiceIconsRow" style={{ gap }}>
        <VibraServiceIcon type="saludo" size={size} showLabel={false} />
        <VibraServiceIcon type="consejo" size={size} showLabel={false} />
        <VibraServiceIcon type="meetGreet" size={size} showLabel={false} />
        <VibraServiceIcon
          type="exclusiveSession"
          size={size}
          showLabel={false}
        />
      </div>

      <div className="vibraServiceIconsRow" style={{ gap }}>
        <VibraServiceIcon type="communities" size={size} showLabel={false} />
        <VibraServiceIcon type="content" size={size} showLabel={false} />
        <VibraServiceIcon type="realTime" size={size} showLabel={false} />
      </div>
    </div>
  );
}

export function VibraServiceIconsStyles() {
  return (
    <style jsx global>{`
      .vibraServiceIconsShowcase {
        display: grid;
        gap: 24px;
        justify-items: center;
      }

      .vibraServiceIconsRow {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: nowrap;
      }

      .vibraServiceIconItem {
        display: grid;
        justify-items: center;
        gap: 10px;
        color: #fff;
        flex: 0 0 auto;
      }

      .vibraServiceIconCircle {
        position: relative;
        border-radius: 999px;
        border: 1px solid rgba(var(--service-rgb), 0.46);
        display: grid;
        place-items: center;
        background:
          radial-gradient(
            circle at 50% 38%,
            rgba(var(--service-rgb), 0.24) 0%,
            rgba(var(--service-rgb), 0.13) 38%,
            rgba(18, 9, 45, 0.72) 100%
          );
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.08),
          inset 0 0 18px rgba(var(--service-rgb), 0.08);
        overflow: hidden;
      }

      .vibraServiceIconCircle::before {
        content: "";
        position: absolute;
        inset: 1px;
        border-radius: inherit;
        background: linear-gradient(
          145deg,
          rgba(255, 255, 255, 0.08),
          transparent 45%,
          rgba(0, 0, 0, 0.18)
        );
        pointer-events: none;
      }

      .vibraServiceIconSvg {
        position: relative;
        z-index: 1;
        width: 46%;
        height: 46%;
        color: var(--service-color);
        transform-origin: center center;
      }

      .vibraServiceIconSvg svg {
        width: 100%;
        height: 100%;
        display: block;
        fill: none;
        stroke: currentColor;
        stroke-width: 4.5;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .vibraServiceIconLabel {
        max-width: 120px;
        text-align: center;
        font-size: 14px;
        font-weight: 800;
        line-height: 1.05;
        letter-spacing: -0.03em;
        text-shadow: 0 2px 14px rgba(0, 0, 0, 0.5);
      }

.vibraServiceIconWave,
.vibraServiceIconBulb,
.vibraServiceIconPulse,
.vibraServiceIconCrown,
.vibraServiceIconSpark,
.vibraServiceIconSignal {
  animation: none;
  transform: none;
}

      @media (max-width: 900px) {
        .vibraServiceIconsRow {
          justify-content: flex-start;
        }

        .vibraServiceIconItem {
          width: 96px;
        }

        .vibraServiceIconLabel {
          font-size: 12.5px;
        }
      }

      @media (max-width: 420px) {
        .vibraServiceIconItem {
          width: 82px;
        }

        .vibraServiceIconLabel {
          font-size: 11.5px;
        }
      }
    `}</style>
  );
}