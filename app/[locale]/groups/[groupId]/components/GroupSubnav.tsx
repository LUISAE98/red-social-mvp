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
  const fontStack =
    'inherit';

  const tabs: {
    key: TabKey;
    title: string;
    iconType: VibraSubnavIconType;
  }[] = [
    {
      key: "feed",
      title: tGroups("postsSection"),
      iconType: "posts",
    },
    {
      key: "members",
      title: tGroups("membersTab"),
      iconType: "members",
    },
    ...(canManage
      ? [
          {
            key: "services" as const,
            title: tGroups("groupServicesTab"),
            iconType: "services" as const,
          },
          {
            key: "settings" as const,
            title: tGroups("groupSettingsTab"),
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
    left: 10,
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

  return (
    <>
      <style jsx>{`
        @media (max-width: 768px) {
          .group-subnav-mobile-full {
            width: 100vw !important;
            margin-left: calc(50% - 50vw) !important;
            margin-right: calc(50% - 50vw) !important;
            border-radius: 0 !important;
            border-left: 0 !important;
            border-right: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      <VibraSubnavIconsStyles />

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
              <span style={itemInner}>
                <VibraSubnavIcon
                  type={tab.iconType}
                  size={34}
                  strokeWidth={2.25}
                />
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}