"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import type { TopView } from "./OwnerSidebar";
import {
  SidebarFollowingIcon,
  SidebarMessagesIcon,
  SidebarMyCommunitiesIcon,
  SidebarOtherCommunitiesIcon,
} from "@/app/components/VibraServiceIcons/OwnerSidebarNavIcons/OwnerSidebarNavIcons";

type Props = {
  /** Sección desplegada, o null si todas están cerradas. */
  openKey: TopView | null;
  /** Clic en una pestaña: abre esa sección o, si ya estaba abierta, la cierra. */
  onToggle: (view: TopView) => void;
  requestedCount?: number;
  deliveredCount?: number;
  joinRequestsCount?: number;
  followedCount?: number;
  myGroupsCount?: number;
  joinedGroupsCount?: number;
  /** No leídos del DM. La pestaña de Mensajes se muestra siempre, con o sin ellos. */
  unreadMessagesCount?: number;
  loadingFollowing?: boolean;
  loadingGroups?: boolean;
  /** Contenido de cada sección; se despliega (acordeón) bajo su pestaña activa. */
  contentByKey?: Partial<Record<TopView, ReactNode>>;
};

export default function OwnerSidebarTabNav({
  openKey,
  onToggle,
  requestedCount = 0,
  deliveredCount = 0,
  joinRequestsCount = 0,
  followedCount = 0,
  myGroupsCount = 0,
  joinedGroupsCount = 0,
  unreadMessagesCount = 0,
  loadingFollowing = false,
  loadingGroups = false,
  contentByKey,
}: Props) {
  const tNav = useTranslations("nav");

  const fontStack =
    'inherit';

  const showFollowing = loadingFollowing || followedCount > 0;
  const showMyGroups = loadingGroups || myGroupsCount > 0;
  const showOtherGroups = loadingGroups || joinedGroupsCount > 0;

  const tabs = [
    ...(showFollowing
      ? [
          {
            key: "following" as const,
            label: tNav("tabFollowing"),
            title: tNav("tabFollowing"),
            showBadge: false,
            icon: <SidebarFollowingIcon size={28} strokeWidth={1.6} />,
          },
        ]
      : []),
    ...(showMyGroups
      ? [
          {
            key: "owned" as const,
            label: tNav("tabOwnedCommunities"),
            title: tNav("tabOwnedCommunities"),
            showBadge: joinRequestsCount > 0,
            icon: <SidebarMyCommunitiesIcon size={28} strokeWidth={1.6} />,
          },
        ]
      : []),
    ...(showOtherGroups
      ? [
          {
            key: "communities" as const,
            label: tNav("tabJoinedCommunities"),
            title: tNav("tabJoinedCommunities"),
            showBadge: false,
            icon: <SidebarOtherCommunitiesIcon size={28} strokeWidth={1.6} />,
          },
        ]
      : []),
    // Mensajes va SIEMPRE, aunque no haya conversaciones: si se ocultara al
    // estar vacía (como las de arriba), nadie descubriría que el DM existe.
    {
      key: "messages" as const,
      label: tNav("tabMessages"),
      title: tNav("tabMessages"),
      showBadge: unreadMessagesCount > 0,
      icon: <SidebarMessagesIcon size={28} strokeWidth={1.6} />,
    },
    // "Experiencias" (estrella) se movió a la página /experiencias, accesible
    // desde el ícono junto a notificaciones. Ya no vive en el sidebar.
  ];

  const badgeText = requestedCount > 99 ? "99+" : String(requestedCount);
  const joinBadgeText = joinRequestsCount > 99 ? "99+" : String(joinRequestsCount);
  const unreadBadgeText = unreadMessagesCount > 99 ? "99+" : String(unreadMessagesCount);

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

  // Mismo estilo que los labels del menú derecho (WalletDesktopRail): fuente
  // heredada 13px, sin letter-spacing; el color y el peso los decide `active`
  // en el render (0.74/400 inactivo · #fff/700 activo).
  const labelStyle: CSSProperties = {
    position: "relative",
    zIndex: 2,
    fontSize: 13,
    fontFamily: fontStack,
    lineHeight: 1.15,
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
      {tabs.map((tab) => {
        const active = openKey === tab.key;
        const content = contentByKey?.[tab.key];

        return (
          <div key={tab.key} style={{ display: "grid" }}>
            <button
              type="button"
              onClick={() => onToggle(tab.key)}
              aria-pressed={active}
              aria-expanded={active}
              aria-label={tab.title}
              title={tab.title}
              style={{
                ...itemBase,
                ...(active ? activeStyle : null),
                background: active ? "rgba(255,255,255,0.05)" : "transparent",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ display: "inline-flex", opacity: active ? 1 : 0.55 }}>{tab.icon}</span>
                <span
                  style={{
                    ...labelStyle,
                    color: active ? "#ffffff" : "rgba(255,255,255,0.74)",
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {tab.label}
                </span>
              </span>

              {tab.showBadge ? (
                <span style={badgeStyle}>
                  {tab.key === "owned"
                    ? joinBadgeText
                    : tab.key === "messages"
                      ? unreadBadgeText
                      : badgeText}
                </span>
              ) : null}

              {/* Planeta: siempre montado (invisible en las cerradas) para que
                  entre y salga con transición en vez de aparecer/desaparecer de golpe. */}
              <Image
                src="/suscomunidades.webp"
                alt=""
                aria-hidden
                width={26}
                height={26}
                style={{
                  flexShrink: 0,
                  width: 26,
                  height: 26,
                  objectFit: "contain",
                  userSelect: "none",
                  opacity: active ? 1 : 0,
                  transform: active ? "scale(1)" : "scale(0.2)",
                  // Rebote marcado: la curva se pasa de tamaño y regresa (pop).
                  transition: "opacity 180ms ease, transform 420ms cubic-bezier(0.34,1.8,0.5,1)",
                }}
              />
            </button>

            {/* Contenido de la sección: se despliega hacia abajo bajo su pestaña.
                grid-template-rows 0fr→1fr anima hasta la altura real del contenido,
                sin tope fijo que recorte listas largas. */}
            {content != null && (
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: active ? "1fr" : "0fr",
                  opacity: active ? 1 : 0,
                  transition:
                    "grid-template-rows 380ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease",
                }}
              >
                <div style={{ overflow: "hidden" }}>
                  <div style={{ paddingTop: 6 }}>{content}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}