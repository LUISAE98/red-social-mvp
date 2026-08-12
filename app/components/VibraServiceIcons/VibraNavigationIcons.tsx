"use client";

import React from "react";
import { useTranslations } from "next-intl";

export type VibraNavigationIconType =
  | "home"
  | "search"
  | "saved"
  | "wallet"
  | "notifications"
  | "finance"
  | "coin"
  | "calendar"
  | "pending"
  | "history"
  | "myCommunities"
  | "otherCommunities"
  | "requested"
  | "copyLink"
  | "publish"
  | "attachMedia"
  | "premiumCrown"
  | "premiumLock"
  | "premiumUnlocked";

const vibraPink = "#ec4899";
const vibraPurple = "#9333ea";
const vibraBlue = "#3b82f6";

// Solid purple — url(#gradient) no resuelve confiablemente en Safari mobile
const gradientStroke = "#a855f7";
const purpleStroke = vibraPurple;

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

        <path stroke={gradientStroke} d="M3.5 11.2 12 4l8.5 7.2" />
        <path stroke={gradientStroke} d="M5.8 10.2V20h12.4v-9.8" />
        <path stroke={gradientStroke} d="M9.5 20v-5.8h5V20" />
      </svg>
    ),
  },

  wallet: {
    label: "Wallet",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path stroke={gradientStroke} d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
        <rect stroke={gradientStroke} x="3" y="7" width="18" height="12" rx="2.5" fill="none" />
        <path stroke={gradientStroke} d="M16 12.5h3" />
      </svg>
    ),
  },

  notifications: {
    label: "Notificaciones",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path stroke={gradientStroke} d="M6 8a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8" />
        <path stroke={gradientStroke} d="M10.3 20a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    ),
  },

premiumLock: {
  label: "Premium bloqueado",
  icon: (
    <svg
      className="vibraPremiumLockIcon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
<path
  d="
    M7.8 10.8
    V7.6
    Q7.8 3.4 12 3.4
    Q16.2 3.4 16.2 7.6
    V10.8
    H14.4
    V7.6
    Q14.4 5.4 12 5.4
    Q9.6 5.4 9.6 7.6
    V10.8
    H7.8
    Z
  "
  fill={vibraPurple}
/>

<path
  fillRule="evenodd"
  clipRule="evenodd"
  d="
    M6.6 10.2
    H17.4
    Q18.8 10.2 18.8 11.6
    V19
    Q18.8 20.4 17.4 20.4
    H6.6
    Q5.2 20.4 5.2 19
    V11.6
    Q5.2 10.2 6.6 10.2
    Z

    M12 14.1
    Q11.1 14.1 11.1 15
    Q11.1 15.9 12 15.9
    Q12.9 15.9 12.9 15
    Q12.9 14.1 12 14.1
    Z
  "
  fill={vibraPurple}
/>
    </svg>
  ),
},

premiumUnlocked: {
  label: "Premium desbloqueado",
  icon: (
    <svg
      className="vibraPremiumUnlockedIcon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
<path
  d="
    M7.8 6.5
    Q7.8 3.4 12 3.4
    Q16.2 3.4 16.2 7.6
    V10.8
    H14.4
    V7.6
    Q14.4 5.4 12 5.4
    Q9.6 5.4 9.6 6.5
    H7.8
    Z
  "
  fill={vibraPurple}
/>

<path
  fillRule="evenodd"
  clipRule="evenodd"
  d="
    M6.6 10.2
    H17.4
    Q18.8 10.2 18.8 11.6
    V19
    Q18.8 20.4 17.4 20.4
    H6.6
    Q5.2 20.4 5.2 19
    V11.6
    Q5.2 10.2 6.6 10.2
    Z

    M12 14.1
    Q11.1 14.1 11.1 15
    Q11.1 15.9 12 15.9
    Q12.9 15.9 12.9 15
    Q12.9 14.1 12 14.1
    Z
  "
  fill={vibraPurple}
/>
    </svg>
  ),
},

  premiumCrown: {
  label: "Premium",
  icon: (
    <svg
      className="vibraPremiumCrownIcon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="
          M4.8 8.2
          L8.6 11.2
          L12 6.4
          L15.4 11.2
          L19.2 8.2
          L17.8 17.2
          H6.2
          L4.8 8.2
          Z
        "
        fill="#ffffff"
      />

      <path
        d="
          M6.4 18.6
          H17.6
          Q18.2 18.6 18.2 19.2
          V19.6
          Q18.2 20.2 17.6 20.2
          H6.4
          Q5.8 20.2 5.8 19.6
          V19.2
          Q5.8 18.6 6.4 18.6
          Z
        "
        fill="#ffffff"
      />
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

        <path stroke={gradientStroke} d="M5 4.5V19.5H21" />
        <path stroke={gradientStroke} d="M8.5 19.5V14.5" />
        <path stroke={gradientStroke} d="M12.5 19.5V10" />
        <path stroke={gradientStroke} d="M16.5 19.5V6.5" />
      </svg>
    ),
  },

  coin: {
    label: "Moneda",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle stroke={gradientStroke} cx="12" cy="12" r="8.2" />
        <path stroke={gradientStroke} d="M12 7.4v9.2" />
        <path
          stroke={gradientStroke}
          d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2"
        />
      </svg>
    ),
  },

  calendar: {
    label: "Calendario",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">

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

        <circle stroke={gradientStroke} cx="12" cy="12" r="8.2" />
        <path stroke={gradientStroke} d="M12 7.5V12.5" />
        <path stroke={gradientStroke} d="M12 12.5L15.2 14.3" />
      </svg>
    ),
  },

  myCommunities: {
    label: "Mis comunidades",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">

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


        <path
          stroke="#a855f7"
          d="
            M8.1 4.1
            H12.9
            Q15.5 4.1 15.5 6.7
            V7.1
          "
        />

        <path
          stroke="#a855f7"
          d="
            M5.5 14.3
            V6.7
            Q5.5 4.1 8.1 4.1
          "
        />

        <path
          stroke="#a855f7"
          d="
            M5.5 14.3
            Q5.5 16.9 8.1 16.9
            H8.5
          "
        />

        <rect
          stroke="#a855f7"
          x="8.5"
          y="7.1"
          width="10"
          height="12.8"
          rx="2.6"
        />
      </svg>
    ),
  },

publish: {
  label: "Publicar",
  icon: (
    <svg
      className="vibraPublishIcon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="
          M3.8 10.8
          L19.2 4.2
          Q20.3 3.7 19.9 4.9
          L14.3 20.1
          Q13.8 21.4 12.8 20.3
          L9.2 15.2
          L3.7 12.8
          Q2.4 12.2 3.8 10.8
          Z
        "
        fill="#a855f7"
      />

      <path
        d="
          M9.2 15.2
          L11 12.6
          L10.8 17.4
        "
        fill="#121212"
      />
    </svg>
  ),
},

attachMedia: {
  label: "Adjuntar multimedia",
  icon: (
    <svg
      className="vibraAttachMediaIcon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect
        x="3.5"
        y="4"
        width="14"
        height="14"
        rx="2.4"
        fill="none"
        stroke="#22c55e"
        strokeWidth="2.2"
      />

      <circle cx="7.2" cy="8.2" r="1.6" fill="#22c55e" />

      <path
        d="
          M3.5 15.8
          L8 11.2
          L10.5 13.8
          L14.2 10
          L17.5 13.5
          V18
          H3.5
          Z
        "
        fill="#22c55e"
      />
    </svg>
  ),
},
};

export function VibraNavigationIcon({
  type,
  label,
  size,
  showLabel = false,
  strokeWidth = 2,
}: {
  type: VibraNavigationIconType;
  label?: string;
  size?: number;
  showLabel?: boolean;
  strokeWidth?: number;
}) {
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const config = NAVIGATION_ICON_CONFIG[type];
  const translatedLabel = (() => {
    switch (type) {
      case "home": return tNav("home");
      case "search": return tCommon("search");
      case "saved": return tNav("saved");
      case "wallet": return tNav("wallet");
      case "notifications": return tNav("notifications");
      case "finance": return tNav("finances");
      case "calendar": return tNav("calendar");
      case "pending": return tNav("pending");
      case "history": return tNav("history");
      case "myCommunities": return tNav("groups");
      case "otherCommunities": return tNav("otherCommunities");
      case "requested": return tNav("requested");
      case "copyLink": return tCommon("copyLink");
      case "publish": return tCommon("publish");
      case "attachMedia": return tCommon("attachMedia");
      case "premiumCrown": return tCommon("premium");
      case "premiumLock": return tCommon("premiumLock");
      case "premiumUnlocked": return tCommon("premiumUnlocked");
      default: return config.label;
    }
  })();
  const finalLabel = label ?? translatedLabel;

  const finalSize =
    size ??
    (type === "publish" || type === "attachMedia"
      ? 32
      : 22);

  return (
    <span
      className="vibraNavigationIcon"
      style={
        {
          "--vibra-navigation-icon-size": `${finalSize}px`,
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
          #a855f7 45%,
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