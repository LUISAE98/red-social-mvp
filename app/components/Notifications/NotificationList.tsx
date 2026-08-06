"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Link } from "@/i18n/navigation";
import { setNavSlideDir } from "@/lib/nav-slide";
import { approveJoinRequest, rejectJoinRequest } from "@/lib/groups/joinRequests.admin";
import { respondGroupModeratorInvite } from "@/lib/groups/moderatorInvites";
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
  const intlLocale = LOCALE_MAP[locale] ?? "es";
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });

  // `numeric: "auto"` produce "ayer", "anteayer", "hace 3 días"… siempre en
  // minúscula. El indicador va suelto bajo el texto, así que arranca frase y
  // lleva mayúscula inicial. Se capitaliza SOLO la primera letra: con el
  // `text-transform: capitalize` de CSS saldría "Hace 3 Días".
  const capitalizeFirst = (value: string): string =>
    value ? value.charAt(0).toLocaleUpperCase(intlLocale) + value.slice(1) : value;

  const format = (diffSec: number): string => {
    const abs = Math.abs(diffSec);
    if (abs < 60) return rtf.format(Math.round(diffSec / 1), "second");
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
    if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), "day");
    if (abs < 2629800) return rtf.format(Math.round(diffSec / 604800), "week");
    return rtf.format(Math.round(diffSec / 2629800), "month");
  };

  return (ms: number | null): string => {
    if (!ms) return "";
    return capitalizeFirst(format(Math.round((ms - Date.now()) / 1000)));
  };
}

/**
 * Portada de la comunidad para el fondo de la notificación de solicitud de unión.
 *
 * La notificación solo guarda `groupId` y `groupName`, así que la portada se lee
 * del grupo. Se cachea a nivel de módulo (y se recuerda el fallo como `null`)
 * para no repetir la lectura por cada solicitud de la misma comunidad ni en cada
 * apertura de la campanita.
 */
const groupCoverCache = new Map<string, string | null>();

function useGroupCovers(groupIds: string[]): Record<string, string> {
  const key = groupIds.join(",");
  const [covers, setCovers] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;

    let cancelled = false;

    // Solo se leen las comunidades que no estén ya en el caché del módulo.
    const missing = ids.filter((id) => !groupCoverCache.has(id));
    if (missing.length === 0) return;

    void Promise.all(
      missing.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, "groups", id));
          const data = snap.data() as { coverUrl?: string | null } | undefined;
          const url =
            typeof data?.coverUrl === "string" && data.coverUrl.trim()
              ? data.coverUrl.trim()
              : null;
          groupCoverCache.set(id, url);
          return [id, url] as const;
        } catch {
          // Comunidad no legible o borrada: se recuerda para no reintentar.
          groupCoverCache.set(id, null);
          return [id, null] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, url] of entries) if (url) next[id] = url;
      if (Object.keys(next).length > 0) {
        setCovers((prev) => ({ ...prev, ...next }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  // El resultado se DERIVA del caché del módulo más lo resuelto en esta sesión:
  // así una portada ya cacheada (al reabrir la campanita) se pinta en el primer
  // render, sin escribir estado dentro del efecto.
  const resolved: Record<string, string> = {};
  for (const id of groupIds) {
    const url = covers[id] ?? groupCoverCache.get(id) ?? null;
    if (url) resolved[id] = url;
  }
  return resolved;
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
          color: #a855f7;
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
    status === "approved" ? "#22c55e" : status === "declined" ? "#ef4444" : "#a855f7";
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
          /* Menos altos: se baja el relleno vertical y se ajusta el interlineado
             para que el alto lo mande el padding y no la caja del texto. */
          padding: 5px 16px;
          line-height: 1.25;
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
          background: #a855f7;
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

/**
 * Aceptar / Rechazar la invitación a MODERAR una comunidad, desde la propia
 * notificación. Aceptar te mete a la comunidad (si no estabas) y te deja como
 * moderador en la misma operación — sin pasar por la suscripción.
 */
function ModeratorInviteActions({ groupId }: { groupId: string }) {
  const t = useTranslations("notifications");
  const [status, setStatus] = useState<
    "idle" | "working" | "accepted" | "rejected" | "error"
  >("idle");

  const act = async (accept: boolean) => {
    if (status === "working") return;
    setStatus("working");
    try {
      await respondGroupModeratorInvite(groupId, accept);
      setStatus(accept ? "accepted" : "rejected");
    } catch {
      setStatus("error");
    }
  };

  if (status === "accepted" || status === "rejected") {
    return (
      <span className="jrDone">
        {status === "accepted"
          ? t("moderatorInviteAccepted")
          : t("moderatorInviteRejected")}
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
        onClick={() => act(true)}
      >
        {t("accept")}
      </button>
      <button
        type="button"
        className="jrBtn jrReject"
        disabled={status === "working"}
        onClick={() => act(false)}
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
          padding: 5px 16px;
          line-height: 1.25;
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
          background: #a855f7;
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
  /** Texto del estado vacío (por defecto `t("empty")`). La pestaña Experiencias usa otro. */
  emptyLabel?: string;
}

export default function NotificationList({
  items,
  loading,
  onItemClick,
  variant = "panel",
  selfHandle = null,
  emptyLabel,
}: NotificationListProps) {
  const t = useTranslations("notifications");
  const timeAgo = useTimeAgo();

  // Portadas de las comunidades con solicitudes pendientes: se usan como fondo
  // de esa notificación para que se reconozca de un vistazo a qué comunidad
  // pertenece la solicitud.
  const joinRequestGroupIds = Array.from(
    new Set(
      items
        .filter(
          (n) =>
            (n.type === "join_request" || n.type === "moderator_invite") &&
            n.target.groupId
        )
        .map((n) => n.target.groupId as string)
    )
  );
  const groupCovers = useGroupCovers(joinRequestGroupIds);

  // Al tocar una notificación, el destino (post/perfil/comunidad) entra
  // deslizando de derecha a izquierda, con el mismo sistema del nav inferior y
  // los subnav (setNavSlideDir → el layout aplica data-nav-enter al cambiar de
  // ruta). Se omite cuando el destino es el propio fallback /notifications, para
  // no dejar una dirección "colgada" que animaría la siguiente navegación.
  function handleItemClick(n: AppNotification, dest: string) {
    if (dest !== "/notifications") setNavSlideDir("right");
    onItemClick?.(n);
  }

  if (loading) {
    return (
      <div
        className="notifState"
        style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 150 }}
      >
        <span
          className="vibraPullRefreshSpinner refreshing"
          style={{ display: "block", width: 32, height: 32 }}
          aria-label={t("loading")}
          role="status"
        />
      </div>
    );
  }
  if (items.length === 0) {
    return <div className="notifState">{emptyLabel ?? t("empty")}</div>;
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
              <div
                className={
                  groupCovers[jrGroupId]
                    ? "notifJoinItem notifJoinItemCover"
                    : "notifJoinItem"
                }
                style={
                  groupCovers[jrGroupId]
                    ? {
                        // Mismo tratamiento que la notificación de donación:
                        // degradado oscuro encima para que el texto se lea.
                        backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 100%), url('${groupCovers[jrGroupId]}')`,
                        backgroundSize: "100% 100%, cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              >
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
                        onClick={() => handleItemClick(n, path)}
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
                      onClick={() => handleItemClick(n, path)}
                    >
                      {t("viewAllRequests")}
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : n.type === "moderator_invite" && jrGroupId ? (
              // Invitación a MODERAR: se responde aquí mismo. Mismo formato que
              // la solicitud de unión, con la portada de la comunidad de fondo.
              <div
                className={
                  groupCovers[jrGroupId]
                    ? "notifJoinItem notifJoinItemCover"
                    : "notifJoinItem"
                }
                style={
                  groupCovers[jrGroupId]
                    ? {
                        backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 100%), url('${groupCovers[jrGroupId]}')`,
                        backgroundSize: "100% 100%, cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              >
                <div className="notifJoinTop">
                  <Avatar n={n} />
                  <span className="notifBody">
                    <span className="notifText">
                      <strong>{primaryName}</strong>{" "}
                      {t("verb.moderator_invite", { group })}
                    </span>
                    <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                  </span>
                </div>
                <div className="notifJoinActions">
                  <ModeratorInviteActions groupId={jrGroupId} />
                </div>
              </div>
            ) : n.type === "invite_expired" ? (
              <Link href={href} className="notifLink" onClick={() => handleItemClick(n, path)}>
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
              <Link href={href} className="notifLink" onClick={() => handleItemClick(n, path)}>
                <KycAvatar status={n.target.action} />
                <span className="notifBody">
                  <span className="notifText">
                    {t(`kyc.${n.target.action ?? "pending"}`)}
                  </span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
              </Link>
            ) : n.type === "session_event" ? (
              <Link href={href} className="notifLink" onClick={() => handleItemClick(n, path)}>
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">
                    {t(`session.${n.target.action ?? "reminder"}`, { name: primaryName })}
                  </span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
              </Link>
            ) : n.type === "donation" ? (
              <Link
                href={href}
                className="notifLink notifDonation"
                onClick={() => handleItemClick(n, path)}
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 100%), url('/donacion-perfil.webp')",
                  backgroundSize: "100% 100%, cover",
                  backgroundPosition: "center",
                }}
              >
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">
                    <strong>{primaryName}</strong>
                    {others ? <span> {others}</span> : null}{" "}
                    {t(n.target.groupId ? "donation.fromGroup" : "donation.fromProfile", {
                      count: n.actorCount,
                      group,
                    })}
                  </span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
              </Link>
            ) : n.type === "group_moderation" ? (
              <Link href={href} className="notifLink" onClick={() => handleItemClick(n, path)}>
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">
                    {t(`moderation.${n.target.action ?? "muted"}`, { group })}
                  </span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
              </Link>
            ) : n.type === "group_subscription_transition" ? (
              <Link href={href} className="notifLink" onClick={() => handleItemClick(n, path)}>
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">
                    {t(`subscriptionTransition.${n.target.action ?? "removed_needs_subscription"}`, { group })}
                  </span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
              </Link>
            ) : n.type === "live_vod_ready" && n.target.action === "self" ? (
              <Link href={href} className="notifLink" onClick={() => handleItemClick(n, path)}>
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">{t("liveVodReadySelf")}</span>
                  <span className="notifTime">{timeAgo(n.updatedAtMs)}</span>
                </span>
                {n.target.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="notifThumb" src={n.target.imageUrl} alt="" />
                ) : null}
              </Link>
            ) : n.type === "live_started" || n.type === "live_vod_ready" ? (
              <Link href={href} className="notifLink" onClick={() => handleItemClick(n, path)}>
                <Avatar n={n} />
                <span className="notifBody">
                  <span className="notifText">
                    <strong>{primaryName}</strong> {t(`verb.${n.type}`)}
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
            ) : n.type === "new_post" ? (
              <Link href={href} className="notifLink" onClick={() => handleItemClick(n, path)}>
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
                onClick={() => handleItemClick(n, path)}
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
              /* Con portada de la comunidad, el degradado ya da el contraste:
                 el tinte morado de "no leída" sobraría encima de la imagen. */
              .notifUnread .notifJoinItemCover {
                background-color: transparent;
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
                color: #a855f7;
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
                /* Mismo grosor que el nombre del autor en las publicaciones
                   (authorLinkStyle en GroupPostCard: fontWeight 500). El 700 de
                   antes se veía desproporcionado frente al resto del texto. */
                font-weight: 500;
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
