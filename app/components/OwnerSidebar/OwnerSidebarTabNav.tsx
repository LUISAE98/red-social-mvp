"use client";

import type { CSSProperties } from "react";
import type { TopView } from "./OwnerSidebar";

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
      key: "following" as const,
      label: "Perfiles seguidos",
      title: "Perfiles seguidos",
      showBadge: false,
    },
    {
      key: "owned" as const,
      label: "Mis comunidades",
      title: "Mis comunidades",
      showBadge: false,
    },
    {
      key: "communities" as const,
      label: "Otras comunidades",
      title: "Otras comunidades",
      showBadge: false,
    },
    ...(hasRequests
      ? [
          {
            key: "greetings" as const,
            label: "Solicitados",
            title: "Solicitados",
            showBadge: true,
          },
        ]
      : []),
  ];

  const safeActiveView =
    !hasRequests && activeView === "greetings" ? "following" : activeView;

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === safeActiveView)
  );

  const badgeText = requestedCount > 99 ? "99+" : String(requestedCount);

  const wrapStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    display: "grid",
    gap: 2,
    fontFamily: fontStack,
    boxSizing: "border-box",
    padding: "4px 8px 6px",
  };

  const itemBase: CSSProperties = {
    position: "relative",
    width: "100%",
    minHeight: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    color: "rgba(255,255,255,0.56)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    transition: "color 0.2s ease, background 0.2s ease",
    WebkitTapHighlightColor: "transparent",
    padding: "7px 8px 7px 14px",
    borderRadius: 10,
    textAlign: "left",
    overflow: "hidden",
  };

  const activeStyle: CSSProperties = {
    color: "rgba(255,255,255,0.95)",
    background: "rgba(255,255,255,0.035)",
  };

  const labelStyle: CSSProperties = {
    position: "relative",
    zIndex: 2,
    fontSize: 13,
    fontWeight: 560,
    fontFamily: fontStack,
    lineHeight: 1.15,
    letterSpacing: "-0.08px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const badgeStyle: CSSProperties = {
    position: "relative",
    zIndex: 2,
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
    flexShrink: 0,
  };

  const indicatorTrackStyle: CSSProperties = {
    position: "absolute",
    left: 8,
    top: 4,
    width: 3,
    height: 34,
    pointerEvents: "none",
    transform: `translate3d(0, ${activeIndex * 36}px, 0)`,
    transition: "transform 420ms cubic-bezier(0.2, 0.9, 0.2, 1)",
    willChange: "transform",
    zIndex: 4,
  };

  const indicatorBarStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 7,
    width: 3,
    height: 20,
    borderRadius: 999,
    background: "#a855ff",
    opacity: 0.9,
    boxShadow: "0 0 12px rgba(168,85,255,0.42)",
  };

  return (
    <div style={wrapStyle}>
      <span style={indicatorTrackStyle}>
        <span style={indicatorBarStyle} />
      </span>

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
            <span style={labelStyle}>{tab.label}</span>

            {tab.showBadge && requestedCount > 0 ? (
              <span style={badgeStyle}>{badgeText}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}