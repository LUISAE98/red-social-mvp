"use client";

import { CSSProperties } from "react";
import type { TopView, TabIconProps } from "./OwnerSidebar";

function IconMyCommunities({ active }: TabIconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M12 3.2L20 9.3V20.2C20 20.64 19.64 21 19.2 21H14.8C14.36 21 14 20.64 14 20.2V15.4C14 14.96 13.64 14.6 13.2 14.6H10.8C10.36 14.6 10 14.96 10 15.4V20.2C10 20.64 9.64 21 9.2 21H4.8C4.36 21 4 20.64 4 20.2V9.3L12 3.2Z"
        stroke="currentColor"
        strokeWidth={active ? "1.6" : "1.8"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconOtherCommunities({ active }: TabIconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M8 12C9.65685 12 11 10.6569 11 9C11 7.34315 9.65685 6 8 6C6.34315 6 5 7.34315 5 9C5 10.6569 6.34315 12 8 12Z"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
      />
      <path
        d="M16 11C17.3807 11 18.5 9.88071 18.5 8.5C18.5 7.11929 17.3807 6 16 6C14.6193 6 13.5 7.11929 13.5 8.5C13.5 9.88071 14.6193 11 16 11Z"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
      />
      <path
        d="M3.8 17.8C4.65 15.85 6.23 14.8 8 14.8C9.77 14.8 11.35 15.85 12.2 17.8"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
        strokeLinecap="round"
      />
      <path
        d="M12.8 17.2C13.45 15.7 14.72 14.9 16.15 14.9C17.58 14.9 18.85 15.7 19.5 17.2"
        stroke="currentColor"
        strokeWidth={active ? "2.05" : "1.85"}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconGreetings({ active }: TabIconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M6.2 18.8L7 14.8C5.7 13.7 5 12.2 5 10.5C5 6.91 8.13 4 12 4C15.87 4 19 6.91 19 10.5C19 14.09 15.87 17 12 17C10.94 17 9.94 16.78 9.05 16.37L6.2 18.8Z"
        stroke="currentColor"
        strokeWidth={active ? "1.6" : "1.8"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Props = {
  activeView: TopView;
  onChange: (view: TopView) => void;
};

export default function OwnerSidebarTabNav({
  activeView,
  onChange,
}: Props) {
  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const wrapStyle: CSSProperties = {
    width: "100%",
    background: "rgba(20,20,22,0.95)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    boxShadow: "0 -8px 24px rgba(0,0,0,0.12)",
    padding: "10px 10px",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    alignItems: "center",
    gap: 0,
    fontFamily: fontStack,
    boxSizing: "border-box",
    borderRadius: 20,
  };

  const itemBase: CSSProperties = {
    position: "relative",
    minWidth: 0,
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
    padding: 0,
  };

  const activeStyle: CSSProperties = {
    color: "#fff",
    background: "rgba(255,255,255,0.04)",
  };

  const itemInner: CSSProperties = {
    display: "grid",
    justifyItems: "center",
    gap: 4,
    width: "100%",
    minWidth: 0,
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

  const iconWrap: CSSProperties = {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    lineHeight: 0,
    flexShrink: 0,
  };

  const labelStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: -0.1,
    width: "100%",
    textAlign: "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const tabs = [
    {
      key: "owned" as const,
      label: "Inicio",
      title: "Mis comunidades",
      icon: IconMyCommunities,
    },
    {
      key: "communities" as const,
      label: "Explorar",
      title: "Otras comunidades",
      icon: IconOtherCommunities,
    },
    {
      key: "greetings" as const,
      label: "Saludos",
      title: "Saludos",
      icon: IconGreetings,
    },
  ];

  return (
    <div style={wrapStyle}>
      {tabs.map((tab) => {
        const active = activeView === tab.key;
        const Icon = tab.icon;

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
              <span style={iconWrap}>
                <Icon active={active} />
              </span>
              <span style={labelStyle}>{tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}