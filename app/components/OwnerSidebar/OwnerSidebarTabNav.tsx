"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import type { TopView } from "./OwnerSidebar";
import {
  SidebarFollowingIcon,
  SidebarMyCommunitiesIcon,
  SidebarOtherCommunitiesIcon,
  SidebarExperiencesIcon,
} from "@/app/components/VibraServiceIcons/OwnerSidebarNavIcons/OwnerSidebarNavIcons";

type Props = {
  activeView: TopView;
  onChange: (view: TopView) => void;
  requestedCount?: number;
  deliveredCount?: number;
  joinRequestsCount?: number;
  followedCount?: number;
  myGroupsCount?: number;
  joinedGroupsCount?: number;
  loadingFollowing?: boolean;
  loadingGroups?: boolean;
};

export default function OwnerSidebarTabNav({
  activeView,
  onChange,
  requestedCount = 0,
  deliveredCount = 0,
  joinRequestsCount = 0,
  followedCount = 0,
  myGroupsCount = 0,
  joinedGroupsCount = 0,
  loadingFollowing = false,
  loadingGroups = false,
}: Props) {
  const fontStack =
    'inherit';

  const hasRequests = requestedCount > 0 || deliveredCount > 0;
  const showFollowing = loadingFollowing || followedCount > 0;
  const showMyGroups = loadingGroups || myGroupsCount > 0;
  const showOtherGroups = loadingGroups || joinedGroupsCount > 0;

  const tabs = [
    ...(showFollowing
      ? [
          {
            key: "following" as const,
            label: "Seguidos",
            title: "Seguidos",
            showBadge: false,
            icon: <SidebarFollowingIcon size={25} strokeWidth={1.6} />,
          },
        ]
      : []),
    ...(showMyGroups
      ? [
          {
            key: "owned" as const,
            label: "Mis comunidades",
            title: "Mis comunidades",
            showBadge: joinRequestsCount > 0,
            icon: <SidebarMyCommunitiesIcon size={25} strokeWidth={1.6} />,
          },
        ]
      : []),
    ...(showOtherGroups
      ? [
          {
            key: "communities" as const,
            label: "Comunidades que sigo",
            title: "Comunidades que sigo",
            showBadge: false,
            icon: <SidebarOtherCommunitiesIcon size={25} strokeWidth={1.6} />,
          },
        ]
      : []),
    ...(hasRequests
      ? [
          {
            key: "greetings" as const,
            label: "Experiencias",
            title: "Experiencias",
            showBadge: false,
            icon: <SidebarExperiencesIcon size={25} strokeWidth={1.6} />,
          },
        ]
      : []),
  ];

  const tabKeys = new Set(tabs.map((t) => t.key));
  const safeActiveView = tabKeys.has(activeView)
    ? activeView
    : (tabs[0]?.key ?? "following");

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === safeActiveView)
  );

  const badgeText = requestedCount > 99 ? "99+" : String(requestedCount);
  const joinBadgeText = joinRequestsCount > 99 ? "99+" : String(joinRequestsCount);

  const wrapStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    display: "grid",
    gap: 2,
    fontFamily: fontStack,
    boxSizing: "border-box",
    padding: "4px 2px 6px",
  };

  const itemBase: CSSProperties = {
    position: "relative",
    width: "100%",
    minHeight: 39,
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
    padding: "7px 8px 7px 6px",
    borderRadius: 10,
    textAlign: "left",
    overflow: "hidden",
  };

  const activeStyle: CSSProperties = {
    color: "rgba(255,255,255,0.95)",
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

  return (
    <div style={wrapStyle}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 2,
          right: 2,
          top: 4,
          height: 39,
          borderRadius: 10,
          background: "rgba(255,255,255,0.035)",
          pointerEvents: "none",
          transform: `translate3d(0, ${activeIndex * 41}px, 0)`,
          transition: "transform 420ms cubic-bezier(0.2, 0.9, 0.2, 1)",
          willChange: "transform",
          zIndex: 1,
        }}
      />

      <Image
        src="/suscomunidades.png"
        alt=""
        aria-hidden
        width={120} height={28}
        style={{
          position: "absolute",
          right: 10,
          top: 12,
          height: 28,
          width: "auto",
          objectFit: "contain",
          pointerEvents: "none",
          userSelect: "none",
          transform: `translate3d(0, ${activeIndex * 41}px, 0)`,
          transition: "transform 420ms cubic-bezier(0.2, 0.9, 0.2, 1)",
          willChange: "transform",
          zIndex: 4,
        }}
      />

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
            <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, opacity: active ? 1 : 0.55 }}>
              {tab.icon}
              <span style={labelStyle}>{tab.label}</span>
            </span>

            {tab.showBadge ? (
              <span style={badgeStyle}>
                {tab.key === "owned" ? joinBadgeText : badgeText}
              </span>
            ) : null}

          </button>
        );
      })}
    </div>
  );
}