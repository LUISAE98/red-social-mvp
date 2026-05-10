"use client";

import { CSSProperties } from "react";
import type { TopView } from "./OwnerSidebar";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
  type VibraNavigationIconType,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

type Props = {
  activeView: TopView;
  onChange: (view: TopView) => void;
  requestedCount?: number;
};

export default function OwnerSidebarTabNav({
  activeView,
  onChange,
  requestedCount = 0,
}: Props) {
  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const hasRequests = requestedCount > 0;

  const tabs = [
    {
      key: "owned" as const,
      label: "Mis comunidades",
      title: "Mis comunidades",
      iconType: "myCommunities" as VibraNavigationIconType,
      imageSrc: "/miscomunidades.png",
      showBadge: false,
    },
    {
      key: "communities" as const,
      label: "Otras comunidades",
      title: "Otras comunidades",
      iconType: "otherCommunities" as VibraNavigationIconType,
      imageSrc: "/suscomunidades.png",
      showBadge: false,
    },
    ...(hasRequests
      ? [
          {
            key: "greetings" as const,
            label: "Solicitados",
            title: "Solicitados",
            iconType: "requested" as VibraNavigationIconType,
            imageSrc: "/solicitados.png",
            showBadge: true,
          },
        ]
      : []),
  ];

  const safeActiveView =
    !hasRequests && activeView === "greetings" ? "owned" : activeView;

  const badgeText = requestedCount > 99 ? "99+" : String(requestedCount);

  const wrapStyle: CSSProperties = {
    width: "100%",
    display: "grid",
    gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
    alignItems: "start",
    gap: 0,
    fontFamily: fontStack,
    boxSizing: "border-box",
    padding: "0 8px",
    overflow: "visible",
  };

  const itemBase: CSSProperties = {
    position: "relative",
    minWidth: 0,
    height: 92,
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.62)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    transition: "color 0.2s ease, transform 0.15s ease",
    WebkitTapHighlightColor: "transparent",
    padding: "0 4px",
    overflow: "visible",
  };

const activeStyle: CSSProperties = {
  color: "rgba(255,255,255,0.92)",
};

  const itemInner: CSSProperties = {
    position: "relative",
    display: "grid",
    gridTemplateRows: "44px 28px",
    justifyItems: "center",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    paddingTop: 4,
    paddingBottom: 16,
    zIndex: 2,
  };

const iconWrap: CSSProperties = {
  position: "relative",
  display: "grid",
  placeItems: "center",
  width: 88,
  height: 44,
  overflow: "visible",
  lineHeight: 1,
  zIndex: 1,
};

const imageIconStyle = (
  active: boolean,
  tabKey: TopView
): CSSProperties => {
  const styleByTab: Record<
    TopView,
    {
      size: number;
      scale: number;
    }
  > = {
    owned: {
      size: 44,
      scale: 2.7,
    },
    communities: {
      size: 45,
      scale: 1,
    },
    greetings: {
      size: 90,
      scale: 1,
    },
  };

  const tabStyle = styleByTab[tabKey];
  const inactiveScale = tabStyle.scale * 0.96;

  return {
    position: "absolute",
top:
  tabKey === "owned"
    ? "54%"
    : tabKey === "greetings"
      ? "45%"
      : "50%",
    left: "50%",
    width: tabStyle.size,
    height: tabStyle.size,
    objectFit: "contain",
    display: "block",
opacity: active ? 0.93 : 0.65,
filter: active
  ? "brightness(0.92) saturate(0.96)"
  : "grayscale(0.45) brightness(0.72) saturate(0.75)",
    transform: active
      ? `translate(-50%, -50%) scale(${tabStyle.scale})`
      : `translate(-50%, -50%) scale(${inactiveScale})`,
    transformOrigin: "center center",
    transition: "opacity 0.2s ease, transform 0.2s ease",
    pointerEvents: "none",
    zIndex: 0,
  };
};
  const badgeStyle: CSSProperties = {
    position: "absolute",
    top: -2,
    right: -8,
    minWidth: 18,
    height: 18,
    padding: "0 5px",
    borderRadius: 999,
    background: "#ff3b30",
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: -0.1,
    border: "1px solid rgba(0,0,0,0.35)",
    boxShadow: "0 4px 10px rgba(0,0,0,0.28)",
    pointerEvents: "none",
    boxSizing: "border-box",
    zIndex: 5,
  };

const labelStyle: CSSProperties = {
  position: "relative",
  zIndex: 3,
  fontSize: 11.5,
  fontWeight: 550,
  fontFamily: fontStack,
  lineHeight: 1.05,
  letterSpacing: "-0.08px",
  color: "rgba(255,255,255,0.88)",
  textAlign: "center",
  whiteSpace: "normal",
  overflow: "hidden",
  textOverflow: "clip",
  wordBreak: "normal",
  maxWidth: "100%",
  minHeight: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

  const indicatorStyle = (active: boolean): CSSProperties => ({
    position: "absolute",
    left: "50%",
    bottom: 8,
    transform: "translateX(-50%)",
    width: 68,
    height: 3,
    borderRadius: 999,
    background: "#a855ff",
    opacity: active ? 0.75 : 0,
    transition: "opacity 0.2s ease",
    zIndex: 4,
  });

  return (
    <>
      <VibraNavigationIconsStyles />

      <div style={wrapStyle}>
        {tabs.map((tab) => {
          const active = safeActiveView === tab.key;

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
                ...(active ? activeStyle : null),
              }}
            >
              <span style={itemInner}>
                <span style={iconWrap}>
                  {tab.imageSrc ? (
                    <img
                      src={tab.imageSrc}
                      alt=""
                      aria-hidden="true"
                      style={imageIconStyle(active, tab.key)}
                    />
                  ) : (
                    <VibraNavigationIcon
                      type={tab.iconType}
                      size={active ? 24 : 22}
                      strokeWidth={active ? 2.2 : 2}
                    />
                  )}

                  {tab.showBadge && requestedCount > 0 ? (
                    <span style={badgeStyle}>{badgeText}</span>
                  ) : null}
                </span>

                <span style={labelStyle}>{tab.label}</span>
              </span>

              <span style={indicatorStyle(active)} />
            </button>
          );
        })}
      </div>
    </>
  );
}