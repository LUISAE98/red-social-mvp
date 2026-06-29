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
      <svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
        <path d="M188 56c39 5 70 35 86 71M151 91c37 8 66 37 80 70M83 276c-34-15-57-45-65-81M119 238c-29-10-51-33-61-63" stroke="currentColor" strokeWidth="28" strokeLinecap="round"/>
        <path d="M157 143l144 144M105 196l144 144M84 267l139 139c58 58 152 58 210 0 35-35 47-87 31-134l-48-143c-9-27-47-24-52 4l-16 97-129-129c-18-18-48-18-66 0l-7 7c-18-18-48-18-66 0s-18 48 0 66l25 25" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },

  consejo: {
    label: "Solicitar consejo",
    color: "#FACC15",
    rgb: "250, 204, 21",
    animationClass: "vibraServiceIconBulb",
    icon: (
      <svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
        <path d="M256 103c-69 0-125 54-125 121 0 45 24 78 54 104 15 13 22 31 22 50h98c0-19 7-37 22-50 30-26 54-59 54-104 0-67-56-121-125-121z" stroke="currentColor" strokeWidth="24" strokeLinejoin="round"/>
        <path d="M207 379h98M211 418h90M224 455h64" stroke="currentColor" strokeWidth="24" strokeLinecap="round"/>
        <path d="M256 48v35M365 79l-18 31M433 188h-36M147 79l18 31M79 188h36" stroke="currentColor" strokeWidth="24" strokeLinecap="round"/>
        <path d="M228 293v-38c0-16 24-16 24 0v38M252 255c0-16 24-16 24 0v38" stroke="currentColor" strokeWidth="18" strokeLinecap="round"/>
      </svg>
    ),
  },

  meetGreet: {
    label: "Agendar encuentro",
    color: "#A78BFA",
    rgb: "167, 139, 250",
    animationClass: "vibraServiceIconPulse",
    icon: (
      <svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
        <path d="M69 232l59 45 53-83M443 232l-59 45-53-83M181 194l61-35c25-14 55-14 80 0l47 27" stroke="currentColor" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M165 276l-26 31c-13 16-10 39 6 52 16 13 39 10 52-6l10-12M207 341l-17 21c-13 16-10 39 6 52 16 13 39 10 52-6l13-16M261 392l-4 5c-13 16-10 39 6 52 16 13 39 10 52-6l12-15" stroke="currentColor" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M201 194l-54 72c22 13 49 7 65-14l16-21 122 99c16 13 39 10 52-6s10-39-6-52l-74-60" stroke="currentColor" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M351 330l-35 44M316 374l-37 47M279 421l-19 24" stroke="currentColor" strokeWidth="24" strokeLinecap="round"/>
      </svg>
    ),
  },

  exclusiveSession: {
    label: "Reservar sesión exclusiva",
    color: "#F472B6",
    rgb: "244, 114, 182",
    animationClass: "vibraServiceIconCrown",
    icon: (
      <svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
        <path d="M72 413h368v51H72z" fill="currentColor"/>
        <path d="M91 198l105 70 60-151 60 151 105-70-32 215H123L91 198z" stroke="currentColor" strokeWidth="42" strokeLinejoin="round"/>
        <circle cx="91" cy="198" r="35" stroke="currentColor" strokeWidth="34"/>
        <circle cx="256" cy="117" r="35" stroke="currentColor" strokeWidth="34"/>
        <circle cx="421" cy="198" r="35" stroke="currentColor" strokeWidth="34"/>
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
        className={`vibraServiceIconSvg ${config.animationClass}`}
        style={{ width: size, height: size }}
      >
        {config.icon}
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

      .vibraServiceIconSvg {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        color: var(--service-color);
        transform-origin: center center;
      }

      .vibraServiceIconSvg svg {
        width: 100%;
        height: 100%;
        display: block;
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
