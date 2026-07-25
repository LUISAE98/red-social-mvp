"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useSelfHandle } from "@/lib/hooks/useSelfHandle";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import NotificationList from "@/app/components/Notifications/NotificationList";
import { AppNotification, isExperienceNotification } from "@/lib/notifications/types";
import RefreshableArea from "@/components/refresh/RefreshableArea";

type NotifTab = "experiences" | "social";

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const { user } = useAuth();
  const { items, loading, unreadCount, markSeen, markAllRead, markRead, refresh } =
    useNotifications(user?.uid ?? null);
  const selfHandle = useSelfHandle(user?.uid ?? null);

  // "Vende experiencias" = servicios activos en perfil/comunidad o alguna
  // solicitud histórica. Solo entonces mostramos el subnav de dos pestañas.
  const { hasWallet: sellsExperiences } = useWalletVisibility(user?.uid ?? null);

  // Abrir la página cuenta como "ver" el contenedor → baja el badge del nav.
  useEffect(() => {
    markSeen();
  }, [markSeen]);

  // El subnav solo existe si el usuario vende experiencias. Con prioridad a
  // Experiencias: cuando aparece, es la pestaña activa por defecto. `tab === null`
  // = sin elección manual → se resuelve automáticamente según `showSubnav`.
  const [tab, setTab] = useState<NotifTab | null>(null);
  const showSubnav = sellsExperiences;
  const activeTab: NotifTab = tab ?? (showSubnav ? "experiences" : "social");

  // Sociales = TODAS las notificaciones. Experiencias = solo las del bloque 4.
  const visibleItems = useMemo(() => {
    if (showSubnav && activeTab === "experiences") {
      return items.filter(isExperienceNotification);
    }
    return items;
  }, [items, showSubnav, activeTab]);

  const handleItemClick = (n: AppNotification) => {
    if (!n.read) markRead(n.id);
  };

  return (
    <RefreshableArea onRefresh={refresh}>
    <div className="notifPage">
      <div className="notifPageHead">
        <h1 className="notifPageTitle">{t("title")}</h1>
        {unreadCount > 0 ? (
          <button type="button" className="notifPageMarkAll" onClick={() => markAllRead()}>
            {t("markAllRead")}
          </button>
        ) : null}
      </div>

      {showSubnav ? (
        <div className="notifTabs" role="tablist" aria-label={t("title")}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "experiences"}
            className={activeTab === "experiences" ? "notifTab notifTabActive" : "notifTab"}
            onClick={() => setTab("experiences")}
          >
            {t("tabs.experiences")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "social"}
            className={activeTab === "social" ? "notifTab notifTabActive" : "notifTab"}
            onClick={() => setTab("social")}
          >
            {t("tabs.social")}
          </button>
        </div>
      ) : null}

      <NotificationList
        items={visibleItems}
        loading={loading}
        onItemClick={handleItemClick}
        variant="page"
        selfHandle={selfHandle}
        emptyLabel={
          showSubnav && activeTab === "experiences" ? t("emptyExperiences") : undefined
        }
      />

      <style jsx>{`
        .notifPage {
          max-width: 640px;
          margin: 0 auto;
          padding: 8px 0 96px;
        }
        .notifPageHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 16px 8px;
        }
        .notifPageTitle {
          font-size: 20px;
          font-weight: 600;
          color: #fff;
          margin: 0;
        }
        .notifPageMarkAll {
          background: transparent;
          border: none;
          color: #a855ff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }
        .notifPageMarkAll:hover {
          text-decoration: underline;
        }
        .notifTabs {
          display: flex;
          gap: 24px;
          padding: 4px 20px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .notifTab {
          position: relative;
          padding: 10px 2px 12px;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.5);
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          transition: color 140ms ease;
        }
        .notifTab::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: -1px;
          height: 2px;
          border-radius: 2px;
          background: #a855ff;
          opacity: 0;
          transition: opacity 140ms ease;
        }
        .notifTab:hover:not(.notifTabActive) {
          color: rgba(255, 255, 255, 0.8);
        }
        .notifTabActive {
          color: #fff;
        }
        .notifTabActive::after {
          opacity: 1;
        }
        .notifPage :global(.notifState) {
          padding: 56px 16px;
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 15px;
        }
      `}</style>
    </div>
    </RefreshableArea>
  );
}
