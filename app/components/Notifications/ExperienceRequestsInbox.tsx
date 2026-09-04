"use client";

import Image from "next/image";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { VibraAvatarFallback } from "@/components/ui";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
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
import { useCreatorNetRate } from "@/lib/wallet/useCreatorNetRate";
import ListSkeleton from "@/components/ui/ListSkeleton";
import type {
  GreetingRequestDoc,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
} from "@/app/components/OwnerSidebar/OwnerSidebar";

type ServiceKind = "meet_greet" | "exclusive_session";
type SessionDoc = MeetGreetRequestDoc | ExclusiveSessionRequestDoc;

// Elemento de la lista plana ordenada por fecha (saludo/consejo o sesión).
type FlatItem =
  | { kind: "greeting"; id: string; bucketKey: string; data: GreetingRequestDoc; ms: number }
  | { kind: "session"; sessionKind: ServiceKind; id: string; bucketKey: string; data: SessionDoc; ms: number };

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
  const pf = usePriceFormat();

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
  const { toast: inboxToast, showToast: showInboxToast } = useVibraToast();
  useEffect(() => { if (feedbackError) showInboxToast(feedbackError, "error"); }, [feedbackError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (feedbackSuccess) showInboxToast(feedbackSuccess, "success"); }, [feedbackSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Todos los saludos ordenados MÁS NUEVO primero (el review overlay navega entre
  // ellos en el mismo orden que se ven en la lista).
  const allSortedGreetings = useMemo(() => {
    return Object.values(greetingsByBucket)
      .flat()
      .sort(
        (a, b) =>
          (toDateSafe(b.data.createdAt)?.getTime() ?? 0) -
          (toDateSafe(a.data.createdAt)?.getTime() ?? 0)
      );
  }, [greetingsByBucket]);

  // Lista PLANA de experiencias (saludos/consejos + sesiones por atender de todos
  // los orígenes), ordenada por fecha: la más nueva arriba, la más vieja abajo.
  // Cada tarjeta conserva el avatar de su origen (perfil/comunidad) vía bucketKey.
  const flatItems = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    const msOf = (v: unknown) => toDateSafe(v)?.getTime() ?? 0;

    for (const [key, list] of Object.entries(greetingsByBucket)) {
      for (const r of list) {
        out.push({ kind: "greeting", id: r.id, bucketKey: key, data: r.data, ms: msOf(r.data.createdAt) });
      }
    }
    for (const [key, list] of Object.entries(meetGreetsByBucket)) {
      for (const r of list) {
        if (!isServiceRequestAlertStatus(r.data.status)) continue;
        out.push({ kind: "session", sessionKind: "meet_greet", id: r.id, bucketKey: key, data: r.data, ms: msOf(r.data.createdAt) });
      }
    }
    for (const [key, list] of Object.entries(exclusiveByBucket)) {
      for (const r of list) {
        if (!isServiceRequestAlertStatus(r.data.status)) continue;
        out.push({ kind: "session", sessionKind: "exclusive_session", id: r.id, bucketKey: key, data: r.data, ms: msOf(r.data.createdAt) });
      }
    }

    return out.sort((a, b) => b.ms - a.ms); // más nueva arriba
  }, [greetingsByBucket, meetGreetsByBucket, exclusiveByBucket]);

  /**
   * Lo que el creador se lleva por esta solicitud: el 75% de la base, en la moneda de
   * LIQUIDACIÓN y con una referencia en la suya debajo.
   *
   * ⚠️ Antes salía con `format`, que es el precio del COMPRADOR: convertía a la moneda de
   * quien mira, sumaba el 2% y redondeaba al escalón. Al creador se le prometían unos pesos
   * que no iba a recibir, y encima con la etiqueta de su moneda en vez de la del cobro.
   *
   * Tampoco se usa ya la moneda guardada en el documento: la base vive siempre en la de
   * liquidación, y fiarse de la del documento resucita el fallo de leer dólares como pesos.
   */
  const { netRate } = useCreatorNetRate();
  const earningOf = (price?: number | null): { usd: string; local: string | null } | null => {
    if (price == null || price <= 0) return null;
    const neto = price * netRate;
    return {
      usd: pf.formatAnchor(neto, { code: true }),
      local:
        pf.currency === SETTLEMENT_CURRENCY
          ? null
          : pf.formatPlain(neto, { baseCurrency: SETTLEMENT_CURRENCY, code: true }),
    };
  };

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
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorAcceptRequest"));
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
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorRejectRequest"));
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
      setFeedbackSuccess(tServices("successDateProposed"));
      setTimeout(closeSession, 900);
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorScheduleSession"));
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
      setFeedbackSuccess(tServices("successSessionAcceptedAndScheduled"));
      setTimeout(closeSession, 900);
    } catch (e) {
      setFeedbackError((e instanceof Error ? e.message : null) ?? tServices("errorScheduleSession"));
    } finally {
      setBusy(false);
    }
  };

  if (loading && flatItems.length === 0) {
    return <ListSkeleton rows={5} avatarSize={44} />;
  }
  if (flatItems.length === 0) {
    return <div className="expInboxState">{emptyLabel}</div>;
  }

  return (
    <div className="expInbox">
      {flatItems.map((item) => {
        const meta = groupMetaMap[item.bucketKey];
        const isProfile = item.bucketKey.startsWith("profile:");
        const name = meta?.name ?? (isProfile ? "Mi perfil" : tCommon("user"));
        const avatarUrl = meta?.avatarUrl ?? null;

        // Línea vertical + avatar del perfil/comunidad desde donde compraron la
        // experiencia (se muestra junto a la hora, en cada tarjeta).
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

        // ── Saludo / consejo ──────────────────────────────────────────────────
        if (item.kind === "greeting") {
          const r = { id: item.id, data: item.data };
          const req = r.data;
          const buyer = userMiniMap[req.buyerId] ?? null;
              const earning = earningOf(req.priceSnapshot);
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
                // Mismo trato que una notificación social: la fila va de lado a
                // lado y el aire lo pone su propio relleno, no un margen. Sin
                // radio, porque no hay tarjeta que recortar. Ver `.expInbox`.
                //
                // El aire vertical es MENOR que en las sociales (7 y no 12): la
                // fila de experiencia ya trae su foto de fondo, su avatar y su
                // botón, así que es bastante más alta de por sí. Con los 12 de
                // allí, las filas quedaban despegadas unas de otras.
                borderRadius: 0,
                padding: "7px 16px",
                minWidth: 0,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                gap: 10,
                ...(cardImage
                  ? {
                      backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.74) 55%, rgba(0,0,0,0.90) 100%), url('${cardImage}')`,
                      // Degradado EXACTO al tamaño de la tarjeta (no escalado por
                      // "cover"), para que cubra el borde inferior por completo.
                      backgroundSize: "100% calc(100% + 2px), cover",
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
                    ) : buyer?.hasRealName ? (
                      <div style={{ ...styles.avatarFallback, width: 44, height: 44, fontSize: 16 }}>
                        {getInitials(buyer.displayName)}
                      </div>
                    ) : (
                      // Sin foto Y sin nombre no hay iniciales que sacar, solo
                      // las de un código de relleno. Va la marca, que a este
                      // tamaño sí se lee. Trae su propio círculo, así que no
                      // lleva el de respaldo debajo.
                      <VibraAvatarFallback size={44} />
                    )}
                    <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                      {buyer?.handle ? (
                        <Link
                          href={`/u/${buyer.handle}`}
                          style={{
                            color: "#fff",
                            fontWeight: 500,
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
                        // Con nombre, el nombre. Sin nombre, el CORREO de quien
                        // encarga: "Usuario a3f9c1" no le dice nada al creador,
                        // que tiene delante un encargo pagado y ninguna forma de
                        // saber de quién es.
                        //
                        // 📌 Con el completar-perfil de Vibra Express (bloque 7)
                        // la mayoría traerá nombre y esto pasará a ser el
                        // respaldo. No quitarlo entonces: una cuenta recién
                        // nacida sigue llegando sin nombre.
                        <span
                          style={{
                            color: "#fff",
                            fontWeight: 600,
                            fontSize: 15,
                            lineHeight: 1.25,
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {buyer?.hasRealName
                            ? buyer.displayName
                            : (req.buyerEmail ?? tCommon("anonymousUser"))}
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
                    {/* Solo la moneda de liquidación: en la lista no cabe una segunda cifra
                        sin volverla ruidosa, y el desglose completo está en el detalle. */}
                    {earning ? (
                      <span style={{ ...styles.earning, fontSize: 12.1 }}>{earning.usd}</span>
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
        }

        // ── Sesión por atender / agendar / reagendar ──────────────────────────
        const r = { id: item.id, data: item.data, kind: item.sessionKind };
        {
              const req = r.data;
              const earning = earningOf(req.priceSnapshot);
              // Mismo estilo que saludo/consejo: imagen de fondo por tipo + layout
              // horizontal. El botón conserva su texto de proceso (agendar/reagendar).
              const cardImage =
                r.kind === "exclusive_session"
                  ? "/sesionexclusiva.webp"
                  : "/encuentroenvivo.webp";
              const cardStyle: CSSProperties = {
                // Igual que la de saludo/consejo, de lado a lado y sin radio.
                borderRadius: 0,
                padding: "7px 16px",
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
                backgroundSize: "100% calc(100% + 2px), cover",
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
                    {/* Solo la moneda de liquidación: en la lista no cabe una segunda cifra
                        sin volverla ruidosa, y el desglose completo está en el detalle. */}
                    {earning ? (
                      <span style={{ ...styles.earning, fontSize: 12.1 }}>{earning.usd}</span>
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
        }
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
          earning={earningOf(sessionOverlay.req.priceSnapshot)?.usd ?? null}
          earningLocal={earningOf(sessionOverlay.req.priceSnapshot)?.local ?? null}
          busy={busy}
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

      <VibraToast toast={inboxToast} />

      <style jsx>{`
        /* Se presenta como la bandeja social: filas a sangre, pegadas, sin
           relleno propio del contenedor. El aire y el margen lateral los pone
           cada fila con su padding de 12px 16px, que es exactamente el que usa
           .notifLink en la lista social. Asi las dos pestanas se leen igual al
           cambiar de una a otra.

           Ojo: este bloque es un template literal y un acento invertido en un
           comentario lo parte en seco. */
        .expInbox {
          display: grid;
          gap: 0;
          padding: 0;
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
