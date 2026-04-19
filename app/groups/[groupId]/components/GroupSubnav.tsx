"use client";

import { CSSProperties } from "react";

export type TabKey = "feed" | "members" | "settings";

type GroupSubnavProps = {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
  canManage?: boolean;
};

function EmojiIcon({
  emoji,
  active,
}: {
  emoji: string;
  active: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        fontSize: active ? 22 : 20,
        lineHeight: 1,
        transform: active ? "scale(1.03)" : "scale(1)",
        transition: "transform 0.15s ease, opacity 0.2s ease",
        opacity: active ? 1 : 0.78,
      }}
    >
      {emoji}
    </span>
  );
}

export default function GroupSubnav({
  activeTab,
  onChange,
  canManage = false,
}: GroupSubnavProps) {
  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const wrapStyle: CSSProperties = {
    width: "100%",
    borderTop: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(20,20,22,0.95)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    boxShadow: "0 -8px 24px rgba(0,0,0,0.12)",
    padding: "10px 10px",
    display: "grid",
    gridTemplateColumns: canManage
      ? "repeat(3, minmax(0, 1fr))"
      : "repeat(2, minmax(0, 1fr))",
    alignItems: "center",
    gap: 0,
    fontFamily: fontStack,
  };

  const itemBase: CSSProperties = {
    position: "relative",
    height: 52,
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.5)",
    background: "transparent",
    border: "none",
    borderRadius: 16,
    cursor: "pointer",
    transition: "color 0.2s ease, transform 0.15s ease, background 0.2s ease",
    WebkitTapHighlightColor: "transparent",
  };

  const activeStyle: CSSProperties = {
    color: "#fff",
    background: "rgba(255,255,255,0.04)",
  };

  const itemInner: CSSProperties = {
    display: "grid",
    justifyItems: "center",
    gap: 4,
  };

  const indicatorBase: CSSProperties = {
    position: "absolute",
    top: -10,
    width: 24,
    height: 3,
    borderRadius: 999,
    background: "transparent",
    opacity: 0,
    transition: "background 0.2s ease, opacity 0.2s ease",
  };

  const labelStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: -0.1,
  };

  const tabs = [
    {
      key: "feed" as const,
      label: "Posts",
      title: "Publicaciones",
      emoji: "📰",
    },
    {
      key: "members" as const,
      label: "Integrantes",
      title: "Integrantes",
      emoji: "👥",
    },
    ...(canManage
      ? [
          {
            key: "settings" as const,
            label: "Config",
            title: "Configuración",
            emoji: "⚙️",
          },
        ]
      : []),
  ];

  return (
    <div style={wrapStyle}>
      {tabs.map((tab) => {
        const active = activeTab === tab.key;

        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            aria-pressed={active}
            title={tab.title}
            style={{
              ...itemBase,
              ...(active ? activeStyle : null),
            }}
          >
            <span
              style={{
                ...indicatorBase,
                ...(active
                  ? {
                      background: "#fff",
                      opacity: 1,
                    }
                  : null),
              }}
            />
            <span style={itemInner}>
              <EmojiIcon emoji={tab.emoji} active={active} />
              <span style={labelStyle}>{tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}