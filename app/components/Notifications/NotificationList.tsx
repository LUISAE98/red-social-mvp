"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  AppNotification,
  KNOWN_NOTIFICATION_TYPES,
  notificationHref,
  notificationQuery,
} from "@/lib/notifications/types";

const LOCALE_MAP: Record<string, string> = {
  en: "en",
  es: "es",
  "pt-BR": "pt-BR",
};

function useTimeAgo() {
  const locale = useLocale();
  const rtf = new Intl.RelativeTimeFormat(LOCALE_MAP[locale] ?? "es", { numeric: "auto" });
  return (ms: number | null): string => {
    if (!ms) return "";
    const diffSec = Math.round((ms - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return rtf.format(Math.round(diffSec / 1), "second");
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
    if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), "day");
    if (abs < 2629800) return rtf.format(Math.round(diffSec / 604800), "week");
    return rtf.format(Math.round(diffSec / 2629800), "month");
  };
}

function Avatar({ n }: { n: AppNotification }) {
  const actor = n.actors[0];
  const initial = (actor?.name ?? "?").slice(0, 1).toUpperCase();
  return (
    <span className="notifAvatar">
      {actor?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={actor.avatarUrl} alt="" />
      ) : (
        <span className="notifAvatarFallback">{initial}</span>
      )}
      <style jsx>{`
        .notifAvatar {
          position: relative;
          flex: 0 0 auto;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          overflow: hidden;
          background: #1a1a1a;
          display: grid;
          place-items: center;
        }
        .notifAvatar :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .notifAvatarFallback {
          color: #a855ff;
          font-weight: 800;
          font-size: 18px;
        }
      `}</style>
    </span>
  );
}

interface NotificationListProps {
  items: AppNotification[];
  loading: boolean;
  onItemClick?: (n: AppNotification) => void;
  variant?: "panel" | "page";
}

export default function NotificationList({
  items,
  loading,
  onItemClick,
  variant = "panel",
}: NotificationListProps) {
  const t = useTranslations("notifications");
  const timeAgo = useTimeAgo();

  if (loading) {
    return <div className="notifState">{t("loading")}</div>;
  }
  if (items.length === 0) {
    return <div className="notifState">{t("empty")}</div>;
  }

  return (
    <ul className={variant === "page" ? "notifList notifListPage" : "notifList"}>
      {items.map((n) => {
        const group = n.target.groupName || t("aCommunity");
        const primaryName = n.actors[0]?.name ?? "";
        const others = n.actorCount > 1 ? t("andOthers", { count: n.actorCount - 1 }) : "";
        // Tipos sin plantilla enriquecida (ej. moderación) muestran `message`.
        const isGeneric = !KNOWN_NOTIFICATION_TYPES.has(n.type);
        const query = notificationQuery(n);
        const href = query ? { pathname: notificationHref(n), query } : notificationHref(n);

        return (
          <li key={n.id} className={n.read ? "notifItem" : "notifItem notifUnread"}>
            <Link
              href={href}
              className="notifLink"
              onClick={() => onItemClick?.(n)}
            >
              <Avatar n={n} />
              <span className="notifBody">
                <span className="notifText">
                  {isGeneric ? (
                    n.message
                  ) : (
                    <>
                      <strong>{primaryName}</strong>
                      {others ? <span> {others}</span> : null}{" "}
                      {t(`verb.${n.type}`, { count: n.actorCount, group })}
                    </>
                  )}
                </span>
                {n.target.preview && !isGeneric ? (
                  <span className="notifPreview">{n.target.preview}</span>
                ) : null}
                <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
              </span>
              {n.target.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="notifThumb" src={n.target.imageUrl} alt="" />
              ) : null}
              {!n.read ? <span className="notifDot" aria-hidden /> : null}
            </Link>

            <style jsx>{`
              .notifItem {
                list-style: none;
              }
              .notifItem :global(.notifLink) {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 12px 16px;
                text-decoration: none;
                color: #f2f2f2;
                transition: background 120ms ease;
              }
              .notifItem :global(.notifLink:hover) {
                background: rgba(255, 255, 255, 0.05);
              }
              .notifUnread :global(.notifLink) {
                background: rgba(168, 85, 255, 0.08);
              }
              .notifBody {
                display: flex;
                flex-direction: column;
                gap: 3px;
                min-width: 0;
                flex: 1 1 auto;
              }
              .notifText {
                font-size: 14px;
                line-height: 1.35;
                color: #e8e8e8;
              }
              .notifText :global(strong) {
                font-weight: 700;
                color: #ffffff;
              }
              .notifPreview {
                font-size: 13px;
                color: rgba(255, 255, 255, 0.55);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 100%;
              }
              .notifTime {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.4);
              }
              .notifItem :global(.notifThumb) {
                flex: 0 0 auto;
                width: 44px;
                height: 44px;
                border-radius: 8px;
                object-fit: cover;
              }
              .notifDot {
                flex: 0 0 auto;
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: #a855ff;
                margin-top: 6px;
              }
            `}</style>
          </li>
        );
      })}
    </ul>
  );
}
