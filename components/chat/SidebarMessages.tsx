"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { setNavSlideDir } from "@/lib/nav-slide";

import { SidebarMessagesIcon } from "@/app/components/VibraServiceIcons/OwnerSidebarNavIcons/OwnerSidebarNavIcons";
import type { ConversationWithId } from "@/lib/chat/chatService";
import ConversationList, { type ProfileMini } from "./ConversationList";

/**
 * Módulo de Mensajes del OwnerSidebar.
 *
 * Es un módulo INDEPENDIENTE, no una pestaña más del acordeón de seguidos /
 * comunidades: siempre está abierto y no se puede plegar. La bandeja no es algo
 * que se despliegue "si te interesa" — o la ves, o no existe para ti.
 *
 * Las solicitudes van en una subsección aparte y sin badge rojo: no deben
 * reclamar atención como un mensaje de alguien conocido.
 */
export default function SidebarMessages({
  loading,
  conversations,
  requests,
  selfUid,
  profiles,
  styles,
  isMobile = false,
  activeConversationIds,
  onOpenConversation,
  unreadTotal = 0,
}: {
  loading: boolean;
  conversations: ConversationWithId[];
  requests: ConversationWithId[];
  selfUid: string | null;
  profiles: Record<string, ProfileMini>;
  styles: Record<string, CSSProperties>;
  isMobile?: boolean;
  activeConversationIds?: string[];
  onOpenConversation: (conversationId: string) => void;
  unreadTotal?: number;
}) {
  const tNav = useTranslations("nav");

  // Mismo encabezado que los rails de comunidades y que los enlaces del menu
  // derecho de laptop: gap 7 y sin tamano de letra propio.
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 8px 7px 6px",
    minHeight: 39,
  };

  const badgeStyle: CSSProperties = {
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
    boxSizing: "border-box",
    flexShrink: 0,
  };

  return (
    // `minWidth: 0` en el módulo entero: sin él, una vista previa larga de
    // cualquier chat ensancha la rejilla y empuja el encabezado —con su "Ver
    // todos"— fuera del panel.
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
      {/* Encabezado fijo. No es un botón: aquí no hay nada que plegar. */}
      <div style={headerStyle}>
        <span
          style={{
            width: 22,
            minWidth: 22,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "rgba(255,255,255,0.68)",
            opacity: 0.82,
          }}
        >
          <SidebarMessagesIcon size={21} strokeWidth={1.6} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontWeight: 400,
            color: "rgba(255,255,255,0.74)",
            lineHeight: 1.15,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tNav("tabMessages")}
        </span>
        {unreadTotal > 0 ? (
          <span style={badgeStyle}>{unreadTotal > 99 ? "99+" : unreadTotal}</span>
        ) : null}

        <Link
          href="/mensajes"
          // Entra deslizando como el resto de la navegación (el layout aplica
          // data-nav-enter al cambiar de ruta).
          onClick={() => setNavSlideDir("right")}
          style={{
            flexShrink: 0,
            color: "#a855f7",
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {tNav("seeAllMessages")}
        </Link>
      </div>

      <div style={{ display: "grid", gap: 10, paddingTop: 2 }}>
        <ConversationList
          loading={loading}
          conversations={conversations}
          selfUid={selfUid}
          profiles={profiles}
          styles={styles}
          isMobile={isMobile}
          activeConversationIds={activeConversationIds}
          onOpenConversation={onOpenConversation}
        />

        {requests.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255,255,255,0.52)",
                padding: "0 2px",
              }}
            >
              {tNav("messageRequests", { count: requests.length })}
            </div>
            <ConversationList
              loading={false}
              conversations={requests}
              selfUid={selfUid}
              profiles={profiles}
              styles={styles}
              isMobile={isMobile}
              activeConversationIds={activeConversationIds}
              onOpenConversation={onOpenConversation}
            />
          </div>
        )}
      </div>
    </div>
  );
}
