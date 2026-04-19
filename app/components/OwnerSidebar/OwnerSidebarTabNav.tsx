"use client";

import { CSSProperties } from "react";
import type { TopView } from "./OwnerSidebar";

type Props = {
  activeView: TopView;
  onChange: (view: TopView) => void;
  requestedCount?: number;
};

type EmojiIconProps = {
  emoji: string;
  active: boolean;
};

function EmojiIcon({ emoji, active }: EmojiIconProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        fontSize: active ? 22 : 20,
        lineHeight: 1,
        transform: active ? "scale(1.02)" : "scale(1)",
        transition: "transform 0.15s ease, opacity 0.2s ease",
        opacity: active ? 1 : 0.78,
      }}
    >
      {emoji}
    </span>
  );
}

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
      emoji: "🫂",
      showBadge: false,
    },
    {
      key: "communities" as const,
      label: "Otras comunidades",
      title: "Otras comunidades",
      emoji: "🌐",
      showBadge: false,
    },
    ...(hasRequests
      ? [
          {
            key: "greetings" as const,
            label: "Solicitados",
            title: "Solicitados",
            emoji: "📩",
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
  };

  const itemBase: CSSProperties = {
    position: "relative",
    minWidth: 0,
    height: 70,
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.62)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    transition: "color 0.2s ease, transform 0.15s ease",
    WebkitTapHighlightColor: "transparent",
    padding: "0 6px",
  };

  const activeStyle: CSSProperties = {
    color: "#fff",
  };

  const itemInner: CSSProperties = {
    display: "grid",
    justifyItems: "center",
    alignContent: "start",
    gap: 6,
    width: "100%",
    minWidth: 0,
    paddingTop: 2,
    paddingBottom: 12,
  };

  const iconWrap: CSSProperties = {
    position: "relative",
    display: "grid",
    placeItems: "center",
    minHeight: 24,
    lineHeight: 1,
    flexShrink: 0,
    width: 30,
    height: 24,
  };

  const badgeStyle: CSSProperties = {
    position: "absolute",
    top: -8,
    right: -12,
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
  };

  const labelStyle: CSSProperties = {
    fontSize: 11.5,
    fontWeight: 500,
    lineHeight: 1.08,
    letterSpacing: -0.12,
    textAlign: "center",
    whiteSpace: "normal",
    overflow: "visible",
    textOverflow: "clip",
    wordBreak: "keep-all",
  };

  const indicatorStyle = (active: boolean): CSSProperties => ({
    position: "absolute",
    left: "50%",
    bottom: 4,
    transform: "translateX(-50%)",
    width: 58,
    height: 4,
    borderRadius: 999,
    background: "#fff",
    opacity: active ? 1 : 0,
    transition: "opacity 0.2s ease",
  });

  return (
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
                <EmojiIcon emoji={tab.emoji} active={active} />
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
  );
}