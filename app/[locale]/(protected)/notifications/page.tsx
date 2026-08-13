"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useSelfHandle } from "@/lib/hooks/useSelfHandle";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { usePendingExperiences } from "@/lib/wallet/usePendingExperiences";
import { useExperiencesSeen } from "@/lib/experiences/useExperiencesSeen";
import NotificationList from "@/app/components/Notifications/NotificationList";
import NotificationTabs, { type NotifTab } from "@/app/components/Notifications/NotificationTabs";
import ExperienceRequestsInbox from "@/app/components/Notifications/ExperienceRequestsInbox";
import { AppNotification, isExperienceNotification } from "@/lib/notifications/types";
import RefreshableArea from "@/components/refresh/RefreshableArea";

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const { user } = useAuth();
  const { items, loading, unreadCount, badgeCount, markSeen, markAllRead, markRead, refresh } =
    useNotifications(user?.uid ?? null);
  const selfHandle = useSelfHandle(user?.uid ?? null);

  // El subnav aparece SOLO mientras haya experiencias vivas (por atender o
  // agendadas). `useWalletVisibility` (barato, cacheado) filtra primero a quien
  // vende experiencias, para no abrir listeners a quien no; el conteo real de
  // pendientes decide si el subnav se muestra y vuelve a desaparecer al atender.
  const { hasWallet } = useWalletVisibility(user?.uid ?? null);
  const {
    hasPending,
    count: experienceCount,
    latestMs: expLatestMs,
    loading: expLoading,
  } = usePendingExperiences(hasWallet ? user?.uid ?? null : null);
  const { seenAt: expSeenAt, markSeen: markExpSeen } = useExperiencesSeen(
    hasWallet ? user?.uid ?? null : null
  );

  // ¿Hay experiencias NUEVAS desde la última vez que se vio la pestaña?
  const hasNewExperiences = experienceCount > 0 && expLatestMs > expSeenAt;

  // El subnav solo existe si el usuario vende experiencias.
  const [tab, setTab] = useState<NotifTab | null>(null);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const showSubnav = hasPending;

  // Pestaña por defecto, decidida UNA vez (al cargar los datos), por prioridad:
  // hay experiencias nuevas → Experiencias (prioridad); si no, hay sociales
  // nuevas → Sociales; si no hay nada nuevo → Experiencias. Se congela para que
  // marcar "visto" no la haga saltar sola. La elección manual (`tab`) manda.
  const [decidedTab, setDecidedTab] = useState<NotifTab | null>(null);
  useEffect(() => {
    if (decidedTab !== null) return;
    if (loading || (hasWallet && expLoading)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDecidedTab(
      !hasPending
        ? "social"
        : hasNewExperiences
          ? "experiences"
          : badgeCount > 0
            ? "social"
            : "experiences"
    );
  }, [decidedTab, loading, hasWallet, expLoading, hasPending, hasNewExperiences, badgeCount]);

  const activeTab: NotifTab = tab ?? decidedTab ?? (showSubnav ? "experiences" : "social");

  // Entrar aquí marca visto TODO lo que había, las dos pestañas a la vez, sin
  // marcar nada como leído. Antes se marcaba solo la pestaña activa: como se
  // entra a una sola, la otra conservaba su cuenta para siempre y el punto rojo
  // volvía en cada sesión aunque no hubiera llegado nada nuevo. Las experiencias
  // se marcan hasta el timestamp de SERVIDOR más reciente, para que cuenten solo
  // las posteriores (el reloj del cliente reencendía el punto por desfase).
  // Espera a que la pestaña por defecto esté decidida: marcar antes pondría los
  // contadores en 0 y la prioridad (Experiencias nuevas → Sociales nuevas) se
  // decidiría siempre sobre cero.
  useEffect(() => {
    if (decidedTab === null) return;
    markSeen();
    markExpSeen(expLatestMs);
  }, [decidedTab, markSeen, markExpSeen, expLatestMs]);

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
        <NotificationTabs
          activeTab={activeTab}
          onChange={changeTab}
          counts={{ social: badgeCount, experiences: experienceCount }}
        />
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
          color: #a855f7;
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
