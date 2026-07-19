"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { useNotifications } from "@/lib/hooks/useNotifications";
import NotificationList from "@/app/components/Notifications/NotificationList";
import { AppNotification } from "@/lib/notifications/types";

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const { user } = useAuth();
  const { items, loading, unreadCount, markAllRead, markRead } = useNotifications(user?.uid ?? null);

  const handleItemClick = (n: AppNotification) => {
    if (!n.read) markRead(n.id);
  };

  return (
    <div className="notifPage">
      <div className="notifPageHead">
        <h1 className="notifPageTitle">{t("title")}</h1>
        {unreadCount > 0 ? (
          <button type="button" className="notifPageMarkAll" onClick={() => markAllRead()}>
            {t("markAllRead")}
          </button>
        ) : null}
      </div>

      <NotificationList
        items={items}
        loading={loading}
        onItemClick={handleItemClick}
        variant="page"
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
        .notifPage :global(.notifState) {
          padding: 56px 16px;
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 15px;
        }
      `}</style>
    </div>
  );
}
