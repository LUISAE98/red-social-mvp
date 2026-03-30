"use client";

import { CSSProperties } from "react";

export type ProfileTabKey = "posts" | "groups" | "settings";

type ProfileSubnavProps = {
  activeTab: ProfileTabKey;
  onChange: (tab: ProfileTabKey) => void;
  isOwner?: boolean;
  showGroupsTab?: boolean;
  showPostsTab?: boolean;
};

function IconPosts({ active }: { active: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M5 7H19"
        stroke="currentColor"
        strokeWidth={active ? "2.2" : "1.9"}
        strokeLinecap="round"
      />
      <path
        d="M5 12H19"
        stroke="currentColor"
        strokeWidth={active ? "2.2" : "1.9"}
        strokeLinecap="round"
      />
      <path
        d="M5 17H19"
        stroke="currentColor"
        strokeWidth={active ? "2.2" : "1.9"}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconGroups({ active }: { active: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M7 8.2C7 7.53726 7.53726 7 8.2 7H15.8C16.4627 7 17 7.53726 17 8.2V15.8C17 16.4627 16.4627 17 15.8 17H8.2C7.53726 17 7 16.4627 7 15.8V8.2Z"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
      />
      <path
        d="M9.5 10H14.5"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
        strokeLinecap="round"
      />
      <path
        d="M9.5 12H14.5"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
        strokeLinecap="round"
      />
      <path
        d="M9.5 14H12.8"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSettings({ active }: { active: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M12 8.9C10.2889 8.9 8.9 10.2889 8.9 12C8.9 13.7111 10.2889 15.1 12 15.1C13.7111 15.1 15.1 13.7111 15.1 12C15.1 10.2889 13.7111 8.9 12 8.9Z"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
      />
      <path
        d="M19 12C19 11.53 18.95 11.08 18.84 10.64L20.45 9.39L18.61 6.19L16.67 6.97C15.98 6.38 15.17 5.92 14.28 5.66L14 3.6H10L9.72 5.66C8.83 5.92 8.02 6.38 7.33 6.97L5.39 6.19L3.55 9.39L5.16 10.64C5.05 11.08 5 11.53 5 12C5 12.47 5.05 12.92 5.16 13.36L3.55 14.61L5.39 17.81L7.33 17.03C8.02 17.62 8.83 18.08 9.72 18.34L10 20.4H14L14.28 18.34C15.17 18.08 15.98 17.62 16.67 17.03L18.61 17.81L20.45 14.61L18.84 13.36C18.95 12.92 19 12.47 19 12Z"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ProfileSubnav({
  activeTab,
  onChange,
  isOwner = false,
  showGroupsTab = true,
  showPostsTab = true,
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
            icon: IconPosts,
          },
        ]
      : []),
    ...(showGroupsTab
      ? [
          {
            key: "groups" as const,
            label: isOwner ? "Mis grupos" : "Sus grupos",
            title: isOwner ? "Mis grupos" : "Los grupos de este perfil",
            icon: IconGroups,
          },
        ]
      : []),
    ...(isOwner
      ? [
          {
            key: "settings" as const,
            label: "Config",
            title: "Configuración",
            icon: IconSettings,
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

  return (
    <div style={wrapStyle}>
      {tabs.map((tab) => {
        const active = activeTab === tab.key;
        const Icon = tab.icon;

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
              <Icon active={active} />
              <span style={labelStyle}>{tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}