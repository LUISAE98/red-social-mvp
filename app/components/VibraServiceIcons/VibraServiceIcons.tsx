"use client";

import React from "react";
import { useTranslations } from "next-intl";

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
      // Open palm facing viewer — 4 finger arcs + thumb + palm
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* Index */}
        <path d="M20 42 C20 10 28 10 28 42" />
        {/* Middle (tallest) */}
        <path d="M28 42 C28 6 36 6 36 42" />
        {/* Ring */}
        <path d="M36 42 C36 10 44 10 44 42" />
        {/* Pinky (shortest) */}
        <path d="M44 42 C44 22 50 22 50 42" />
        {/* Palm bottom arc */}
        <path d="M18 44 Q18 56 34 56 Q50 56 50 44" />
        {/* Thumb (curves left from palm, returns to index base) */}
        <path d="M18 44 Q10 40 8 32 Q6 22 14 18 Q18 20 22 28 Q24 38 22 42" />
      </svg>
    ),
  },

  consejo: {
    label: "requestAdvice",
    color: "#FACC15",
    rgb: "250, 204, 21",
    animationClass: "vibraServiceIconBulb",
    icon: (
      // Classic lightbulb — round globe + filament + cap + base bands
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* Bulb glass globe (closed outline) */}
        <path d="M20 30 C20 16 44 16 44 30 C44 38 40 43 36 44 L28 44 C24 43 20 38 20 30 Z" />
        {/* Filament — W/zigzag inside */}
        <path d="M27 37 L29 30 L32 36 L35 30 L37 37" />
        {/* Metal cap connecting globe to base */}
        <path d="M28 44 L26 44 L26 48 L38 48 L38 44 L36 44" />
        {/* Base threads */}
        <path d="M26 52 L38 52" />
        <path d="M28 56 L36 56" />
      </svg>
    ),
  },

  meetGreet: {
    label: "Agendar encuentro",
    color: "#A78BFA",
    rgb: "167, 139, 250",
    animationClass: "vibraServiceIconPulse",
    icon: (
      // Handshake — two arms + two hands meeting + fingers from each side
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* Left arm */}
        <path d="M4 56 L20 44" />
        {/* Left hand body curving to grip */}
        <path d="M20 44 L22 36 Q22 28 30 28 L34 28" />
        {/* Left hand fingers (lean upper-left) */}
        <path d="M22 42 L16 28" />
        <path d="M26 38 L22 24" />
        {/* Right arm */}
        <path d="M60 56 L44 44" />
        {/* Right hand body curving to grip */}
        <path d="M44 44 L42 36 Q42 28 34 28 L30 28" />
        {/* Right hand fingers (lean upper-right) */}
        <path d="M42 42 L48 28" />
        <path d="M38 38 L42 24" />
      </svg>
    ),
  },

  exclusiveSession: {
    label: "Reservar sesión exclusiva",
    color: "#F472B6",
    rgb: "244, 114, 182",
    animationClass: "vibraServiceIconCrown",
    icon: (
      // Crown — 3 peaks + filled base band + gem dots at tips
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* Crown outline — left base → left tip → valley → center peak → valley → right tip → right base */}
        <path d="M8 44 L14 22 L26 34 L32 12 L38 34 L50 22 L56 44" />
        {/* Solid base band */}
        <rect x="8" y="44" width="48" height="8" rx="2" fill="currentColor" stroke="none" />
        {/* Gem dots at each peak */}
        <circle cx="14" cy="21" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="32" cy="11" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="50" cy="21" r="2.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },

  communities: {
    label: "Comunidades",
    color: "#7DD3FC",
    rgb: "125, 211, 252",
    animationClass: "vibraServiceIconPulse",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="32" cy="32" r="4" />
        <path d="M24 24c-4 4-4 12 0 16" />
        <path d="M40 24c4 4 4 12 0 16" />
        <path d="M17 17c-8 8-8 22 0 30" />
        <path d="M47 17c8 8 8 22 0 30" />
      </svg>
    ),
  },
};

/** Types whose SERVICE_CONFIG.label stores a next-intl "services" namespace key. */
const TRANSLATED_LABEL_TYPES = new Set<VibraServiceIconType>(["consejo"]);

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
  const tServices = useTranslations("services");
  const config = SERVICE_CONFIG[type];
  const configLabel = TRANSLATED_LABEL_TYPES.has(type)
    ? tServices(config.label as Parameters<typeof tServices>[0])
    : config.label;
  const finalLabel = label ?? configLabel;

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
