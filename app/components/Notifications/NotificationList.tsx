"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { approveJoinRequest, rejectJoinRequest } from "@/lib/groups/joinRequests.admin";
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

/** Escudo de verificación (KYC): verde aprobado, rojo rechazado, morado en proceso. */
function KycAvatar({ status }: { status?: string | null }) {
  const color =
    status === "approved" ? "#22c55e" : status === "declined" ? "#ef4444" : "#a855ff";
  return (
    <span
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "#1a1a1a",
        display: "grid",
        placeItems: "center",
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
        <path fill={color} d="M12 2 4 5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V5l-8-3Z" />
        <path fill="#0e0e12" d="m10.6 14.6-2.1-2.1-1.1 1.1 3.2 3.2 5.3-5.3-1.1-1.1-4.2 4.2Z" />
      </svg>
    </span>
  );
}

/** Botones Aceptar/Rechazar inline para la notificación de solicitud de unión. */
function JoinRequestActions({ groupId, userId }: { groupId: string; userId: string }) {
  const t = useTranslations("notifications");
  const [status, setStatus] = useState<"idle" | "working" | "approved" | "rejected" | "error">(
    "idle"
  );

  const act = async (kind: "approve" | "reject") => {
    if (status === "working") return;
    setStatus("working");
    try {
      if (kind === "approve") await approveJoinRequest(groupId, userId);
      else await rejectJoinRequest(groupId, userId);
      setStatus(kind === "approve" ? "approved" : "rejected");
    } catch {
      setStatus("error");
    }
  };

  if (status === "approved" || status === "rejected") {
    return (
      <span className="jrDone">
        {status === "approved" ? t("requestAccepted") : t("requestRejected")}
        <style jsx>{`
          .jrDone {
            font-size: 13px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.6);
          }
        `}</style>
      </span>
    );
  }

  return (
    <div className="jrActions">
      <button
        type="button"
        className="jrBtn jrApprove"
        disabled={status === "working"}
        onClick={() => act("approve")}
      >
        {t("accept")}
      </button>
      <button
        type="button"
        className="jrBtn jrReject"
        disabled={status === "working"}
        onClick={() => act("reject")}
      >
        {t("reject")}
      </button>
      {status === "error" ? <span className="jrError">{t("actionError")}</span> : null}

      <style jsx>{`
        .jrActions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .jrBtn {
          flex: 0 0 auto;
          padding: 7px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          border: none;
          transition: opacity 120ms ease, background 120ms ease;
        }
        .jrBtn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .jrApprove {
          background: #a855ff;
          color: #fff;
        }
        .jrApprove:hover:not(:disabled) {
          background: #9333ea;
        }
        .jrReject {
          background: rgba(255, 255, 255, 0.1);
          color: #f2f2f2;
        }
        .jrReject:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.18);
        }
        .jrError {
          font-size: 12px;
          color: #ef4444;
        }
      `}</style>
    </div>
  );
}

interface NotificationListProps {
  items: AppNotification[];
  loading: boolean;
  onItemClick?: (n: AppNotification) => void;
  variant?: "panel" | "page";
  /** Handle del usuario actual: para el link al perfil propio (follows colectivos). */
  selfHandle?: string | null;
}

export default function NotificationList({
  items,
  loading,
  onItemClick,
  variant = "panel",
  selfHandle = null,
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
        const path = notificationHref(n, selfHandle);
        const query = notificationQuery(n);
        // Adjunta el query salvo que el destino sea el fallback /notifications.
        const href =
          query && path !== "/notifications" ? { pathname: path, query } : path;

        // Solicitud de unión: item especializado con Aceptar/Rechazar inline.
        const jrGroupId = n.target.groupId;
        const jrUserId = n.actors[0]?.id;

        return (
          <li key={n.id} className={n.read ? "notifItem" : "notifItem notifUnread"}>
            {n.type === "join_request" && jrGroupId ? (
              <div className="notifJoinItem">
                <div className="notifJoinTop">
                  <Avatar n={n} />
                  <span className="notifBody">
                    <span className="notifText">
                      <strong>{primaryName}</strong>
                      {others ? <span> {others}</span> : null}{" "}
                      {t("verb.join_request", { count: n.actorCount, group })}
                    </span>
                    {n.bulk ? (
                      <Link
                        href={{ pathname: `/groups/${jrGroupId}`, query: { requests: "1" } }}
                        className="notifViewRequests"
                        onClick={() => onItemClick?.(n)}
                      >
                        {t("viewAllRequests")}
                      </Link>
                    ) : null}
                    <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                  </span>
                </div>
                {!n.bulk && jrUserId ? (
                  <div className="notifJoinActions">
                    <JoinRequestActions groupId={jrGroupId} userId={jrUserId} />
                    <Link
                      href={{ pathname: `/groups/${jrGroupId}`, query: { requests: "1" } }}
                      className="notifViewRequests"
                      onClick={() => onItemClick?.(n)}
                    >
                      {t("viewAllRequests")}
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : n.type === "invite_expired" ? (
              <Link href={href} className="notifLink" onClick={() => onItemClick?.(n)}>
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">
                    {t(n.target.reason === "max_uses" ? "inviteMaxed" : "inviteExpired", {
                      group,
                    })}
                  </span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
              </Link>
            ) : n.type === "kyc_update" ? (
              <Link href={href} className="notifLink" onClick={() => onItemClick?.(n)}>
                <KycAvatar status={n.target.action} />
                <span className="notifBody">
                  <span className="notifText">
                    {t(`kyc.${n.target.action ?? "pending"}`)}
                  </span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
              </Link>
            ) : n.type === "group_moderation" ? (
              <Link href={href} className="notifLink" onClick={() => onItemClick?.(n)}>
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">
                    {t(`moderation.${n.target.action ?? "muted"}`, { group })}
                  </span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
              </Link>
            ) : n.type === "new_post" ? (
              <Link href={href} className="notifLink" onClick={() => onItemClick?.(n)}>
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">
                    <strong>{primaryName}</strong>{" "}
                    {t(n.target.groupId ? "verb.new_post_group" : "verb.new_post", {
                      count: n.actorCount,
                      group,
                    })}
                  </span>
                  {n.target.preview ? (
                    <span className="notifPreview">{n.target.preview}</span>
                  ) : null}
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
                {n.target.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="notifThumb" src={n.target.imageUrl} alt="" />
                ) : null}
              </Link>
            ) : (
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
              </Link>
            )}

            <style jsx>{`
              .notifItem {
                list-style: none;
              }
              .notifJoinItem {
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 12px 16px;
              }
              .notifUnread .notifJoinItem {
                background: rgba(168, 85, 255, 0.08);
              }
              .notifJoinTop {
                display: flex;
                align-items: flex-start;
                gap: 12px;
              }
              .notifJoinActions {
                display: flex;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
              }
              .notifItem :global(.notifViewRequests) {
                font-size: 13px;
                font-weight: 600;
                color: #a855ff;
                text-decoration: none;
                width: fit-content;
              }
              .notifItem :global(.notifViewRequests:hover) {
                text-decoration: underline;
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
            `}</style>
          </li>
        );
      })}
    </ul>
  );
}
