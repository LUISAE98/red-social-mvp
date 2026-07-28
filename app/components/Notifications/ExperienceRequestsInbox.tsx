"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import {
  useExperienceRequestsInbox,
  type BucketItem,
} from "@/lib/experiences/useExperienceRequestsInbox";
import { getInitials } from "@/app/components/OwnerSidebar/OwnerSidebar.utils";
import GreetingReviewOverlay from "@/app/components/OwnerSidebar/GreetingReviewOverlay";
import SessionRequestOverlay from "@/app/components/OwnerSidebar/SessionRequestOverlay";
import { respondGreetingRequest } from "@/lib/greetings/greetingRequests";
import {
  acceptMeetGreetRequest,
  rejectMeetGreetRequest,
  proposeMeetGreetSchedule,
  declineMeetGreetReschedule,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  acceptExclusiveSessionRequest,
  rejectExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  declineExclusiveSessionReschedule,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";
import type { WalletServiceItem } from "@/lib/wallet/ownerWallet";
import type {
  GreetingRequestDoc,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
} from "@/app/components/OwnerSidebar/OwnerSidebar";

type ServiceKind = "meet_greet" | "exclusive_session";
type SessionDoc = MeetGreetRequestDoc | ExclusiveSessionRequestDoc;

// Mismos predicados de estado que el sidebar (OwnerSidebarMyGroups).
function isServiceRequestAlertStatus(status?: string | null): boolean {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "reschedule_requested"
  );
}
function toDateSafe(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const d = (value as { toDate: () => Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  return null;
}

const styles: Record<string, CSSProperties> = {
  section: {
    display: "grid",
    gap: 8,
    padding: "10px",
    borderRadius: 14,
    background: "rgba(90, 41, 174, 0.10)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  headerName: {
    fontSize: 14,
    fontWeight: 600,
    color: "rgba(255,255,255,0.94)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  miniItem: {
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.03)",
    boxShadow: "none",
    padding: 9,
    display: "grid",
    gap: 7,
    width: "100%",
    boxSizing: "border-box",
    minWidth: 0,
  },
  row: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 11,
    color: "#fff",
    flexShrink: 0,
  },
  earning: {
    color: "#86efac",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1,
    flexShrink: 0,
  },
};

export default function ExperienceRequestsInbox({
  uid,
  emptyLabel,
  onDetailOpenChange,
}: {
  uid: string | null | undefined;
  emptyLabel: string;
  /** Avisa cuándo se abre/cierra un overlay de detalle (para que el panel
   *  contenedor —la campanita— se cierre y no estorbe la interacción). */
  onDetailOpenChange?: (open: boolean) => void;
}) {
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  const tCommon = useTranslations("common");
  const { format: formatMoney } = usePriceFormat();

  const {
    greetingsByBucket,
    meetGreetsByBucket,
    exclusiveByBucket,
    groupMetaMap,
    userMiniMap,
    loading,
  } = useExperienceRequestsInbox(uid);

  // Overlays
  const [reviewState, setReviewState] = useState<{
    items: BucketItem<GreetingRequestDoc>[];
    startIndex: number;
  } | null>(null);
  const [greetingBusyId, setGreetingBusyId] = useState<string | null>(null);

  const [sessionOverlay, setSessionOverlay] = useState<{
    id: string;
    req: SessionDoc;
    serviceKind: ServiceKind;
  } | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  // Notifica al contenedor cuando se abre/cierra un overlay de detalle.
  const detailOpen = reviewState !== null || sessionOpen;
  const prevDetailOpen = useRef(false);
  useEffect(() => {
    if (prevDetailOpen.current !== detailOpen) {
      prevDetailOpen.current = detailOpen;
      onDetailOpenChange?.(detailOpen);
    }
  }, [detailOpen, onDetailOpenChange]);

  const relativeTime = (value: unknown): string => {
    const date = toDateSafe(value);
    if (!date) return tCommon("relativeTimeNow");
    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days >= 1) return tCommon("relativeTimeDays", { count: days });
    if (hours >= 1) return tCommon("relativeTimeHours", { count: hours });
    if (mins >= 1) return tCommon("relativeTimeMinutes", { count: mins });
    return tCommon("relativeTimeNow");
  };

  const greetingTypeLabel = (type: string): string => {
    if (type === "consejo") return tWallet("typeLabelAdvice");
    if (type === "mensaje") return tWallet("typeLabelMessage");
    if (type === "meet_greet_digital") return tServices("exclusiveSession");
    if (
      type === "exclusive_session" ||
      type === "clase_personalizada" ||
      type === "digital_exclusive_session"
    ) {
      return tServices("exclusiveSession");
    }
    return tWallet("typeLabelGreeting");
  };

  // Todos los saludos ordenados (el review overlay navega entre ellos).
  const allSortedGreetings = useMemo(() => {
    return Object.values(greetingsByBucket)
      .flat()
      .sort(
        (a, b) =>
          (toDateSafe(a.data.createdAt)?.getTime() ?? 0) -
          (toDateSafe(b.data.createdAt)?.getTime() ?? 0)
      );
  }, [greetingsByBucket]);

  // Buckets a mostrar (perfil primero), solo con contenido.
  const buckets = useMemo(() => {
    const keys = new Set<string>([
      ...Object.keys(greetingsByBucket),
      ...Object.keys(meetGreetsByBucket),
      ...Object.keys(exclusiveByBucket),
    ]);
    return Array.from(keys)
      .map((key) => {
        const greetings = greetingsByBucket[key] ?? [];
        const sessions: Array<{ id: string; data: SessionDoc; kind: ServiceKind }> = [
          ...(meetGreetsByBucket[key] ?? []).map((r) => ({
            ...r,
            kind: "meet_greet" as const,
          })),
          ...(exclusiveByBucket[key] ?? []).map((r) => ({
            ...r,
            kind: "exclusive_session" as const,
          })),
        ];
        const alerts = sessions
          .filter((s) => isServiceRequestAlertStatus(s.data.status))
          .sort(
            (a, b) =>
              (toDateSafe(a.data.createdAt)?.getTime() ?? 0) -
              (toDateSafe(b.data.createdAt)?.getTime() ?? 0)
          );
        return { key, greetings, alerts };
      })
      .filter((b) => b.greetings.length + b.alerts.length > 0)
      .sort((a, b) => {
        const ap = a.key.startsWith("profile:") ? 0 : 1;
        const bp = b.key.startsWith("profile:") ? 0 : 1;
        return ap - bp;
      });
  }, [greetingsByBucket, meetGreetsByBucket, exclusiveByBucket]);

  const earningOf = (price?: number | null, currency?: string | null): string | null =>
    price != null && price > 0
      ? formatMoney(price * 0.77, { code: true, baseCurrency: (currency as "MXN" | "USD") ?? "MXN" })
      : null;

  // ── Handlers de saludo ─────────────────────────────────────────────────────
  const handleGreeting = async (id: string, action: "accept" | "reject") => {
    setGreetingBusyId(id);
    try {
      await respondGreetingRequest({ requestId: id, action });
    } finally {
      setGreetingBusyId(null);
      setReviewState(null);
    }
  };

  // ── Handlers de sesión (calcados de wallet/pendientes) ─────────────────────
  const closeSession = () => {
    setSessionOpen(false);
    setTimeout(() => setSessionOverlay(null), 300);
    setBusy(false);
    setFeedbackError(null);
    setFeedbackSuccess(null);
  };

  const handleAccept = async () => {
    if (!sessionOverlay) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      if (sessionOverlay.serviceKind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId: sessionOverlay.id });
      } else {
        await acceptMeetGreetRequest({ requestId: sessionOverlay.id });
      }
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotAccept"));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (reason: string | null) => {
    if (!sessionOverlay) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      if (sessionOverlay.serviceKind === "exclusive_session") {
        await rejectExclusiveSessionRequest({
          requestId: sessionOverlay.id,
          rejectionReason: reason ?? undefined,
        });
      } else {
        await rejectMeetGreetRequest({
          requestId: sessionOverlay.id,
          rejectionReason: reason ?? undefined,
        });
      }
      closeSession();
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotReject"));
    } finally {
      setBusy(false);
    }
  };

  const handleSchedule = async (scheduledAtIso: string | null) => {
    if (!sessionOverlay || !scheduledAtIso) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (sessionOverlay.serviceKind === "exclusive_session") {
        await proposeExclusiveSessionSchedule({
          requestId: sessionOverlay.id,
          scheduledAt: scheduledAtIso,
          creatorTimezone,
        });
      } else {
        await proposeMeetGreetSchedule({
          requestId: sessionOverlay.id,
          scheduledAt: scheduledAtIso,
          creatorTimezone,
        });
      }
      setFeedbackSuccess(tWallet("sessionScheduled"));
      setTimeout(closeSession, 900);
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotSchedule"));
    } finally {
      setBusy(false);
    }
  };

  // Reagenda: el comprador pidió cambiar la fecha. "Mantener" declina la reagenda
  // (conserva la fecha actual); proponer nueva fecha va por onSchedule/onReschedule.
  const handleKeepSchedule = async () => {
    if (!sessionOverlay) return;
    try {
      if (sessionOverlay.serviceKind === "exclusive_session") {
        await declineExclusiveSessionReschedule({ requestId: sessionOverlay.id });
      } else {
        await declineMeetGreetReschedule(sessionOverlay.id);
      }
    } catch {
      /* el overlay cierra de todos modos */
    }
    closeSession();
  };

  const handleReschedule = async (item: WalletServiceItem, scheduledAt: string) => {
    const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (item.source === "exclusive_session") {
      await proposeExclusiveSessionSchedule({ requestId: item.id, scheduledAt, creatorTimezone });
    } else {
      await proposeMeetGreetSchedule({ requestId: item.id, scheduledAt, creatorTimezone });
    }
  };

  const handleAcceptAndSchedule = async (scheduledAtIso: string | null) => {
    if (!sessionOverlay) return;
    setBusy(true);
    setFeedbackError(null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (sessionOverlay.serviceKind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId: sessionOverlay.id });
        if (scheduledAtIso)
          await proposeExclusiveSessionSchedule({
            requestId: sessionOverlay.id,
            scheduledAt: scheduledAtIso,
            creatorTimezone,
          });
      } else {
        await acceptMeetGreetRequest({ requestId: sessionOverlay.id });
        if (scheduledAtIso)
          await proposeMeetGreetSchedule({
            requestId: sessionOverlay.id,
            scheduledAt: scheduledAtIso,
            creatorTimezone,
          });
      }
      setFeedbackSuccess(tWallet("sessionAcceptedAndScheduled"));
      setTimeout(closeSession, 900);
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tWallet("cannotAcceptAndSchedule"));
    } finally {
      setBusy(false);
    }
  };

  if (loading && buckets.length === 0) {
    return (
      <div
        className="expInboxState"
        style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 150 }}
      >
        <span
          className="vibraPullRefreshSpinner refreshing"
          style={{ display: "block", width: 32, height: 32 }}
          aria-label={tCommon("loading")}
          role="status"
        />
      </div>
    );
  }
  if (buckets.length === 0) {
    return <div className="expInboxState">{emptyLabel}</div>;
  }

  return (
    <div className="expInbox">
      {buckets.map(({ key, greetings, alerts }) => {
        const meta = groupMetaMap[key];
        const isProfile = key.startsWith("profile:");
        const name = meta?.name ?? (isProfile ? "Mi perfil" : tCommon("user"));
        const avatarUrl = meta?.avatarUrl ?? null;

        // Línea vertical + avatar del perfil/comunidad desde donde compraron la
        // experiencia (se muestra junto a la hora, en cada tarjeta del bucket).
        const sourceNode = (
          <>
            <span
              aria-hidden="true"
              style={{ width: 1, height: 12, background: "rgba(255,255,255,0.28)", flexShrink: 0 }}
            />
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                title={name}
                style={{ width: 17, height: 17, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
              />
            ) : (
              <span
                title={name}
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.10)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {getInitials(name)}
              </span>
            )}
          </>
        );

        return (
          <Fragment key={key}>
            {/* Saludos / consejos */}
            {greetings.map((r) => {
              const req = r.data;
              const buyer = userMiniMap[req.buyerId] ?? null;
              const earning = earningOf(req.priceSnapshot, req.currency);
              // Tarjeta con imagen de fondo (+ degradado para legibilidad) y layout
              // horizontal: info a la izquierda, monto + botón "Ver solicitud" a la
              // derecha. Cada tipo tiene su imagen y su color de botón.
              const cardImage =
                req.type === "saludo"
                  ? "/saludo.webp"
                  : req.type === "consejo"
                    ? "/consejo.webp"
                    : null;
              const isConsejo = req.type === "consejo";
              const cardStyle: CSSProperties = {
                borderRadius: 12,
                padding: cardImage ? 12 : 9,
                minWidth: 0,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                gap: 10,
                ...(cardImage
                  ? {
                      backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0.82) 55%, rgba(0,0,0,0.97) 92%, rgba(0,0,0,1) 100%), url('${cardImage}')`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : { background: "rgba(255,255,255,0.03)" }),
              };
              return (
                <div key={r.id} style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    {buyer?.photoURL ? (
                      <Image
                        src={buyer.photoURL}
                        alt={buyer.displayName}
                        width={44}
                        height={44}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: "50%",
                          objectFit: "cover",
                          border: "1px solid rgba(255,255,255,0.12)",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div style={{ ...styles.avatarFallback, width: 44, height: 44, fontSize: 16 }}>
                        {getInitials(buyer?.displayName)}
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                      {buyer?.handle ? (
                        <Link
                          href={`/u/${buyer.handle}`}
                          style={{
                            color: "#fff",
                            fontWeight: 600,
                            fontSize: 15,
                            lineHeight: 1.25,
                            textDecoration: "none",
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {buyer.displayName}
                        </Link>
                      ) : (
                        <span style={{ color: "#fff", fontWeight: 600, fontSize: 15, lineHeight: 1.25 }}>
                          {buyer?.displayName ?? tCommon("user")}
                        </span>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                        <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 1.3, whiteSpace: "nowrap" }}>
                          {relativeTime(req.createdAt)}
                        </span>
                        {sourceNode}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 6,
                      flexShrink: 0,
                    }}
                  >
                    {earning ? (
                      <span style={{ ...styles.earning, fontSize: 12.1 }}>{earning}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        const startIndex = allSortedGreetings.findIndex((x) => x.id === r.id);
                        setReviewState({
                          items: allSortedGreetings,
                          startIndex: startIndex >= 0 ? startIndex : 0,
                        });
                      }}
                      style={{
                        height: 30,
                        padding: "0 14px",
                        borderRadius: 8,
                        border: "none",
                        background: isConsejo ? "rgba(250,204,21,0.18)" : "rgba(168,85,255,0.18)",
                        color: isConsejo ? "#fde047" : "#d8b4fe",
                        fontWeight: 520,
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {tServices("viewRequest")}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Sesiones por atender / agendar / reagendar */}
            {alerts.map((r) => {
              const req = r.data;
              const earning = earningOf(req.priceSnapshot, req.currency);
              // Mismo estilo que saludo/consejo: imagen de fondo por tipo + layout
              // horizontal. El botón conserva su texto de proceso (agendar/reagendar).
              const cardImage =
                r.kind === "exclusive_session"
                  ? "/sesionexclusiva.webp"
                  : "/encuentroenvivo.webp";
              const cardStyle: CSSProperties = {
                borderRadius: 12,
                padding: 12,
                minWidth: 0,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                gap: 10,
                backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.74) 55%, rgba(0,0,0,0.90) 100%), url('${cardImage}')`,
                // Tamaño por capa: el degradado cubre EXACTO la tarjeta (100% 100%)
                // para que su borde inferior oscuro caiga justo en el borde; la
                // imagen va en cover. Con "cover" a secas, el degradado se
                // escalaba de más y dejaba una línea clara abajo.
                backgroundSize: "100% 100%, cover",
                backgroundPosition: "center",
              };
              return (
                <div key={`${r.kind}-${r.id}`} style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    {req.buyerAvatarUrl ? (
                      <Image
                        src={req.buyerAvatarUrl}
                        alt={req.buyerDisplayName ?? ""}
                        width={44}
                        height={44}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: "50%",
                          objectFit: "cover",
                          border: "1px solid rgba(255,255,255,0.12)",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div style={{ ...styles.avatarFallback, width: 44, height: 44, fontSize: 16 }}>
                        {getInitials(req.buyerDisplayName)}
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                      <span style={{ color: "#fff", fontWeight: 600, fontSize: 15, lineHeight: 1.25, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {req.buyerDisplayName ?? tCommon("user")}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                        <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 1.3, whiteSpace: "nowrap" }}>
                          {relativeTime(req.createdAt)}
                        </span>
                        {sourceNode}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 6,
                      flexShrink: 0,
                    }}
                  >
                    {earning ? (
                      <span style={{ ...styles.earning, fontSize: 12.1 }}>{earning}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setSessionOverlay({ id: r.id, req, serviceKind: r.kind });
                        setSessionOpen(true);
                        setFeedbackError(null);
                        setFeedbackSuccess(null);
                        setBusy(false);
                      }}
                      style={{
                        height: 30,
                        padding: "0 14px",
                        borderRadius: 8,
                        border: "none",
                        background:
                          r.kind === "exclusive_session"
                            ? "rgba(236,72,153,0.18)"
                            : "rgba(59,130,246,0.18)",
                        color: r.kind === "exclusive_session" ? "#f9a8d4" : "#93c5fd",
                        fontWeight: 520,
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {req.status === "reschedule_requested"
                        ? tServices("reschedule")
                        : tServices("schedule")}
                    </button>
                  </div>
                </div>
              );
            })}
          </Fragment>
        );
      })}

      {reviewState && (
        <GreetingReviewOverlay
          items={reviewState.items}
          startIndex={reviewState.startIndex}
          buyers={userMiniMap}
          greetingBusyId={greetingBusyId}
          onAccept={(id) => handleGreeting(id, "accept")}
          onReject={(id) => handleGreeting(id, "reject")}
          onClose={() => setReviewState(null)}
          getInitials={getInitials}
          typeLabel={greetingTypeLabel}
        />
      )}

      {sessionOverlay && (
        <SessionRequestOverlay
          open={sessionOpen}
          onClose={closeSession}
          request={sessionOverlay.req}
          requestId={sessionOverlay.id}
          serviceKind={sessionOverlay.serviceKind}
          earning={earningOf(sessionOverlay.req.priceSnapshot, sessionOverlay.req.currency)}
          busy={busy}
          feedbackError={feedbackError}
          feedbackSuccess={feedbackSuccess}
          ownerCalendarItems={[]}
          getInitials={getInitials}
          onAccept={handleAccept}
          onReject={handleReject}
          onSchedule={handleSchedule}
          onAcceptAndSchedule={handleAcceptAndSchedule}
          onPrepare={closeSession}
          onReschedule={handleReschedule}
          onKeepSchedule={handleKeepSchedule}
        />
      )}

      <style jsx>{`
        .expInbox {
          display: grid;
          gap: 12px;
          padding: 12px 16px;
        }
        .expInboxState {
          padding: 56px 16px;
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 15px;
        }
      `}</style>
    </div>
  );
}
