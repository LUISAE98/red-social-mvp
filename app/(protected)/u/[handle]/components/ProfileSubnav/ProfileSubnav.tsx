"use client";

import { CSSProperties, useMemo } from "react";

export type ProfileTabKey = "posts" | "groups" | "services" | "settings";

type ProfileSubnavProps = {
  activeTab: ProfileTabKey;
  onChange: (tab: ProfileTabKey) => void;
  isOwner?: boolean;
  showGroupsTab?: boolean;
  showPostsTab?: boolean;
  showServicesTab?: boolean;
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
        transition: "transform 0.18s ease, opacity 0.2s ease",
        opacity: active ? 1 : 0.9,
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
  showServicesTab = true,
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
            label: isOwner ? "Mis\ncomunidades" : "Sus\ncomunidades",
            title: isOwner
              ? "Mis comunidades"
              : "Las comunidades de este perfil",
            emoji: isOwner ? "✨" : "🌍",
          },
        ]
      : []),
    ...(isOwner && showServicesTab
      ? [
          {
            key: "services" as const,
            label: "Servicios",
            title: "Servicios del perfil",
            emoji: "💸",
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

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === activeTab)
  );

  const safeTabCount = Math.max(tabs.length, 1);
  const selectorWidthPercent = 100 / safeTabCount;
  const selectorTranslatePercent = activeIndex * 100;

  const wrapStyle: CSSProperties = {
    position: "relative",
    overflow: "visible",
    borderRadius: 18,
    width: "100%",
    border: "1px solid rgba(168,85,255,0.08)",
    background: "var(--profile-subnav-bg, rgba(24,8,40,0.96))",
    boxShadow:
      "var(--profile-subnav-shadow, inset 0 1px 0 rgba(255,255,255,0.035), inset 0 -1px 0 rgba(255,255,255,0.015), inset 0 0 18px rgba(168,85,255,0.035), 0 0 18px rgba(168,85,255,0.065), 0 18px 54px rgba(0,0,0,0.42))",
    padding: "10px 10px",
    display: "grid",
    gridTemplateColumns: `repeat(${safeTabCount}, minmax(0, 1fr))`,
    alignItems: "center",
    gap: 0,
    fontFamily: fontStack,
  };

  const selectorStyle: CSSProperties = {
    position: "absolute",
    left: 10,
    bottom: 10,
    width: `calc((100% - 20px) / ${safeTabCount})`,
    height: 68,
    padding: "0 0",
    boxSizing: "border-box",
    pointerEvents: "none",
    transform: `translate3d(${selectorTranslatePercent}%, 0, 0)`,
    transition: "transform 420ms cubic-bezier(0.2, 0.9, 0.2, 1)",
    willChange: "transform",
    zIndex: 0,
  };

  const selectorInnerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    borderRadius: 16,
    background:
      "linear-gradient(90deg, rgba(168,85,247,0.11) 0%, rgba(168,85,247,0.09) 50%, rgba(168,85,247,0.075) 100%)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
    transform: "scaleX(1)",
    transition: "transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  };

  const indicatorStyle: CSSProperties = {
    position: "absolute",
    left: 10,
    top: -1,
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
    color: "rgba(255,255,255,0.68)",
    background: "transparent",
    border: "none",
    borderRadius: 16,
    cursor: "pointer",
    transition: "color 0.2s ease, transform 0.15s ease",
    WebkitTapHighlightColor: "transparent",
    padding: "8px 6px",
  };

  const itemInner: CSSProperties = {
    display: "grid",
    justifyItems: "center",
    gap: 4,
  };

  const labelStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.05,
    letterSpacing: -0.1,
    whiteSpace: "pre-line",
    textAlign: "center",
  };

  return (
    <>
      <style jsx>{`
        @media (max-width: 768px) {
          .profile-subnav-mobile-full {
            --profile-subnav-bg: rgba(14, 4, 24, 0.98);
            --profile-subnav-shadow:
              inset 0 1px 0 rgba(255,255,255,0.025),
              inset 0 -1px 0 rgba(255,255,255,0.012),
              inset 0 0 14px rgba(168,85,255,0.022),
              0 0 10px rgba(168,85,255,0.035),
              0 14px 38px rgba(0,0,0,0.46);

            width: 100vw !important;
            margin-left: calc(50% - 50vw) !important;
            margin-right: calc(50% - 50vw) !important;
            border-radius: 0 !important;
            border-left: 0 !important;
            border-right: 0 !important;
          }
        }
      `}</style>

      <div className="profile-subnav-mobile-full" style={wrapStyle}>
       <span style={indicatorStyle}>
        <span
          style={{
            position: "absolute",
            left: "50%",
            width: 72,
            height: 2,
            borderRadius: 999,
            background: "rgba(168,85,247,0.95)",
            transform: "translateX(-50%)",
          }}
        />
      </span>

      <span style={selectorStyle}>
        <span style={selectorInnerStyle} />
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
              color: active ? "#fff" : itemBase.color,
            }}
          >
            <span style={itemInner}>
              <EmojiIcon emoji={tab.emoji} active={active} />

              {tab.key === "groups" ? (
                <span
                  style={{
                    ...labelStyle,
                    display: "grid",
                    gap: 2,
                    lineHeight: 1,
                  }}
                >
                  <span>{isOwner ? "Mis comunidades" : "Sus comunidades"}</span>
                </span>
              ) : (
                <span style={labelStyle}>{tab.label}</span>
              )}
            </span>
          </button>
        );
      })}
      </div>
    </>
  );
}