"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useSelfHandle } from "@/lib/hooks/useSelfHandle";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { usePendingExperiences } from "@/lib/wallet/usePendingExperiences";
import NotificationList from "@/app/components/Notifications/NotificationList";
import NotificationTabs, { type NotifTab } from "@/app/components/Notifications/NotificationTabs";
import ExperienceRequestsInbox from "@/app/components/Notifications/ExperienceRequestsInbox";
import { AppNotification, isExperienceNotification } from "@/lib/notifications/types";
import RefreshableArea from "@/components/refresh/RefreshableArea";

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const { user } = useAuth();
  const { items, loading, unreadCount, markSeen, markAllRead, markRead, refresh } =
    useNotifications(user?.uid ?? null);
  const selfHandle = useSelfHandle(user?.uid ?? null);

  // El subnav aparece SOLO mientras haya experiencias vivas (por atender o
  // agendadas). `useWalletVisibility` (barato, cacheado) filtra primero a quien
  // vende experiencias, para no abrir listeners a quien no; el conteo real de
  // pendientes decide si el subnav se muestra y vuelve a desaparecer al atender.
  const { hasWallet } = useWalletVisibility(user?.uid ?? null);
  const { hasPending } = usePendingExperiences(hasWallet ? user?.uid ?? null : null);

  // Abrir la página cuenta como "ver" el contenedor → baja el badge del nav.
  useEffect(() => {
    markSeen();
  }, [markSeen]);

  // El subnav solo existe si el usuario vende experiencias. Con prioridad a
  // Experiencias: cuando aparece, es la pestaña activa por defecto. `tab === null`
  // = sin elección manual → se resuelve automáticamente según `showSubnav`.
  const [tab, setTab] = useState<NotifTab | null>(null);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const showSubnav = hasPending;
  const activeTab: NotifTab = tab ?? (showSubnav ? "experiences" : "social");

  // Cambiar de pestaña desliza el contenido (mismas keyframes que el nav de
  // rutas): a la pestaña de la derecha entra desde la derecha, y viceversa.
  const changeTab = (next: NotifTab) => {
    if (next === activeTab) return;
    const order: NotifTab[] = ["experiences", "social"];
    setSlideDir(order.indexOf(next) > order.indexOf(activeTab) ? "right" : "left");
    setTab(next);
  };

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
        <NotificationTabs activeTab={activeTab} onChange={changeTab} />
      ) : null}

      <div className="notifSlideWrap">
        <div
          className="notifSlide"
          key={activeTab}
          data-nav-enter={showSubnav && slideDir ? slideDir : undefined}
        >
          {showSubnav && activeTab === "experiences" ? (
            <ExperienceRequestsInbox
              uid={user?.uid ?? null}
              emptyLabel={t("emptyExperiences")}
            />
          ) : (
            <NotificationList
              items={visibleItems}
              loading={loading}
              onItemClick={handleItemClick}
              variant="page"
              selfHandle={selfHandle}
            />
          )}
        </div>
      </div>

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
        .notifSlideWrap {
          overflow-x: hidden;
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
