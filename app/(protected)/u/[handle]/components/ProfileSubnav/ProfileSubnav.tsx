"use client";

import { CSSProperties } from "react";

export type ProfileTabKey = "posts" | "groups" | "settings";

type ProfileSubnavProps = {
  activeTab: ProfileTabKey;
  onChange: (tab: ProfileTabKey) => void;
  isOwner?: boolean;
  showGroupsTab?: boolean;
  showPostsTab?: boolean;
  showSettingsTab?: boolean;
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

export default function ProfileSubnav({
  activeTab,
  onChange,
  isOwner = false,
  showGroupsTab = true,
  showPostsTab = true,
  showSettingsTab = true,
}: ProfileSubnavProps) {
  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const tabs = [
    ...(showPostsTab
      ? [
          {
            key: "posts" as const,
            label: "Posts",
            title: "Publicaciones",
            emoji: "📰",
          },
        ]
      : []),
    ...(showGroupsTab
      ? [
          {
            key: "groups" as const,
            label: isOwner ? "Mis comunidades" : "Sus comunidades",
            title: isOwner ? "Mis comunidades" : "Las comunidades de este perfil",
            emoji: "🫂",
          },
        ]
      : []),
    ...(isOwner && showSettingsTab
      ? [
          {
            key: "settings" as const,
            label: "Config",
            title: "Configuración del perfil",
            emoji: "⚙️",
          },
        ]
      : []),
  ];

  const wrapStyle: CSSProperties = {
    width: "100%",
    borderTop: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(20,20,22,0.95)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    boxShadow: "0 -8px 24px rgba(0,0,0,0.12)",
    padding: "10px 10px",
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(tabs.length, 1)}, minmax(0, 1fr))`,
    alignItems: "center",
    gap: 0,
    fontFamily: fontStack,
  };

  const itemBase: CSSProperties = {
    position: "relative",
    minHeight: 52,
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.5)",
    background: "transparent",
    border: "none",
    borderRadius: 16,
    cursor: "pointer",
    transition: "color 0.2s ease, transform 0.15s ease, background 0.2s ease",
    WebkitTapHighlightColor: "transparent",
    padding: "8px 6px",
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
    whiteSpace: "nowrap",
  };

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
            aria-label={tab.title}
            title={tab.title}
            style={{
              ...itemBase,
              ...(active ? activeStyle : {}),
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
                  : {}),
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