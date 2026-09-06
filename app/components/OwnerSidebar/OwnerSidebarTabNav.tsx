"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import type { TopView } from "./OwnerSidebar";
import { SidebarFollowingIcon } from "@/app/components/VibraServiceIcons/OwnerSidebarNavIcons/OwnerSidebarNavIcons";
import Collapsible from "@/components/ui/Collapsible";

type Props = {
  /** Sección desplegada, o null si todas están cerradas. */
  openKey: TopView | null;
  /** Clic en una pestaña: abre esa sección o, si ya estaba abierta, la cierra. */
  onToggle: (view: TopView) => void;
  followedCount?: number;
  loadingFollowing?: boolean;
  /** Contenido de cada sección; se despliega (acordeón) bajo su pestaña activa. */
  contentByKey?: Partial<Record<TopView, ReactNode>>;
};

export default function OwnerSidebarTabNav({
  openKey,
  onToggle,
  followedCount = 0,
  loadingFollowing = false,
  contentByKey,
}: Props) {
  const tNav = useTranslations("nav");

  const fontStack =
    'inherit';

  const showFollowing = loadingFollowing || followedCount > 0;

  const tabs = [
    ...(showFollowing
      ? [
          {
            key: "following" as const,
            label: tNav("tabFollowing"),
            title: tNav("tabFollowing"),
            icon: <SidebarFollowingIcon size={28} strokeWidth={1.6} />,
          },
        ]
      : []),
    // Mensajes NO vive aquí: es un módulo independiente y siempre abierto
    // (ver components/chat/SidebarMessages.tsx), no una sección plegable más.
    // "Experiencias" (estrella) se movió a la página /experiencias, accesible
    // desde el ícono junto a notificaciones. Ya no vive en el sidebar.
    //
    // "Mis comunidades" y "Comunidades que sigo" TAMPOCO viven ya aquí: son
    // rails horizontales que se ven siempre (components/groups/CommunityRail),
    // ordenados por las que más frecuentas, en vez de dos secciones que había
    // que desplegar.
  ];

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
    textAlign: "start",
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

            {/* Contenido de la seccion, plegado por el primitivo compartido:
                mide su alto real y lo anima en pixeles, sin tope que recorte
                una lista larga. */}
            {content != null && (
              <Collapsible open={active} duration={380}>
                <div style={{ paddingTop: 6 }}>{content}</div>
              </Collapsible>
            )}
          </div>
        );
      })}
    </div>
  );
}