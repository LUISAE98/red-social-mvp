"use client";

import { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import {
  VibraSubnavIcon,
  VibraSubnavIconsStyles,
  type VibraSubnavIconType,
} from "@/app/components/VibraServiceIcons/VibraSubNavIcons";

export type TabKey = "feed" | "members" | "services" | "settings";

type GroupSubnavProps = {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
  canManage?: boolean;
};

export default function GroupSubnav({
  activeTab,
  onChange,
  canManage = false,
}: GroupSubnavProps) {
  const tGroups = useTranslations("groups");
  const fontStack = 'inherit';

  // El texto y el tamaño del icono se controlan por CONTAINER QUERY (el ancho
  // real del subnav), no por el viewport: así en laptops pequeñas queda
  // icon-only, igual que el subnav de wallet.
  const tabs: {
    key: TabKey;
    title: string;
    label: string;
    iconType: VibraSubnavIconType;
  }[] = [
    {
      key: "feed",
      title: tGroups("postsSection"),
      label: tGroups("postsSection"),
      iconType: "posts",
    },
    {
      key: "members",
      title: tGroups("membersTab"),
      label: tGroups("membersTab"),
      iconType: "members",
    },
    ...(canManage
      ? [
          {
            key: "services" as const,
            title: tGroups("groupServicesTab"),
            label: tGroups("servicesLabel"),
            iconType: "services" as const,
          },
          {
            key: "settings" as const,
            title: tGroups("groupSettingsTab"),
            label: tGroups("settingsLabel"),
            iconType: "settings" as const,
          },
        ]
      : []),
  ];

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === activeTab)
  );

  const safeTabCount = Math.max(tabs.length, 1);
  const selectorTranslatePercent = activeIndex * 100;

  const wrapStyle: CSSProperties = {
    position: "relative",
    overflow: "visible",
    borderRadius: 18,
    width: "100%",
    border: "1px solid transparent",
    background: "transparent",
    boxShadow: "none",
    padding: "8px 10px",
    display: "grid",
    gridTemplateColumns: `repeat(${safeTabCount}, minmax(0, 1fr))`,
    alignItems: "center",
    gap: 0,
    fontFamily: fontStack,
  };

  const indicatorStyle: CSSProperties = {
    position: "absolute",
    insetInlineStart: 10,
    bottom: 15,
    width: `calc((100% - 20px) / ${safeTabCount})`,
    height: 2,
    pointerEvents: "none",
    transform: `translate3d(${selectorTranslatePercent}%, 0, 0)`,
    transition: "transform 420ms cubic-bezier(0.2, 0.9, 0.2, 1)",
    willChange: "transform",
    zIndex: 2,
  };

  const itemBase: CSSProperties = {
    position: "relative",
    zIndex: 1,
    minHeight: 52,
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.62)",
    background: "transparent",
    border: "none",
    borderRadius: 16,
    cursor: "pointer",
    transition: "color 0.2s ease, opacity 0.2s ease, filter 0.2s ease",
    WebkitTapHighlightColor: "transparent",
    padding: "6px 6px 10px",
  };

  const itemInner: CSSProperties = {
    display: "grid",
    justifyItems: "center",
    alignItems: "center",
  };

  const itemLabel: CSSProperties = {
    display: "none",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    lineHeight: 1,
  };

  return (
    <>
      <style jsx>{`
        /* El subnav se mide a sí mismo (container query), no al viewport. */
        .group-subnav-container {
          width: 100%;
          container-type: inline-size;
        }

        @media (max-width: 768px) {
          .group-subnav-mobile-full {
            width: 100vw !important;
            margin-inline-start: calc(50% - 50vw) !important;
            margin-inline-end: calc(50% - 50vw) !important;
            border-radius: 0 !important;
            border-inline-start: 0 !important;
            border-inline-end: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }
        }

        /* Con ancho suficiente en el propio subnav: se muestra el texto y el
           icono normal. Debajo de ese ancho queda icon-only, como en celular. */
        @container (min-width: 760px) {
          .group-subnav-item-inner {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 7px !important;
          }
          .group-subnav-icon-wrap {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important;
          }
          .group-subnav-label {
            display: block !important;
            color: #a855f7 !important;
            line-height: 1 !important;
          }
        }
      `}</style>

      <style jsx global>{`
        /* Icono grande en modo solo-icono; se reduce cuando aparece el texto. */
        .groupSubnavIconSized .vibraSubnavIconSvg {
          width: 34px !important;
          height: 34px !important;
        }
        @container (min-width: 760px) {
          .groupSubnavIconSized .vibraSubnavIconSvg {
            width: 26px !important;
            height: 26px !important;
          }
        }
      `}</style>

      <VibraSubnavIconsStyles />

      <div className="group-subnav-container">
      <div className="group-subnav-mobile-full" style={wrapStyle}>
        <span style={indicatorStyle}>
          <span
            style={{
              position: "absolute",
              left: "50%",
              width: 58,
              height: 2,
              borderRadius: 999,
              background: "rgba(168,85,247,0.95)",
              transform: "translateX(-50%)",
            }}
          />
        </span>

        {tabs.map((tab) => {
          const active = activeTab === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              aria-pressed={active}
              aria-label={tab.title}
              title={tab.title}
              style={{
                ...itemBase,
                color: active ? "#ffffff" : "rgba(255,255,255,0.38)",
                opacity: active ? 1 : 0.48,
                filter: active
                  ? "drop-shadow(0 0 8px rgba(168,85,247,0.45))"
                  : "none",
              }}
            >
              <span style={itemInner} className="group-subnav-item-inner">
                <span className="group-subnav-icon-wrap groupSubnavIconSized">
                  <VibraSubnavIcon
                    type={tab.iconType}
                    size={26}
                    strokeWidth={2.25}
                  />
                </span>
                <span style={itemLabel} className="group-subnav-label">
                  {tab.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      </div>
    </>
  );
}