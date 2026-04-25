"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  acceptMeetGreetRequest,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  requestMeetGreetRefund,
  requestMeetGreetReschedule,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  acceptExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  rejectExclusiveSessionRequest,
  requestExclusiveSessionRefund,
  requestExclusiveSessionReschedule,
  setExclusiveSessionPreparing,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";
import type {
  GroupDocLite,
  GreetingRequestDoc,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
} from "./OwnerSidebar";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";

type ScheduledServiceKind = "meet_greet" | "exclusive_session";

type ScheduledRow = {
  id: string;
  data: MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
  serviceKind: ScheduledServiceKind;
  groupId?: string;
};

type Props = {
  buyerPending: Array<{ id: string; data: GreetingRequestDoc }>;
  buyerMeetGreets: Array<{ id: string; data: MeetGreetRequestDoc }>;
  buyerExclusiveSessions: Array<{ id: string; data: ExclusiveSessionRequestDoc }>;
  exclusiveSessionsByGroup: Record<
    string,
    Array<{ id: string; data: ExclusiveSessionRequestDoc }>
  >;
  meetGreetsByGroup: Record<
    string,
    Array<{ id: string; data: MeetGreetRequestDoc }>
  >;
  groupMetaMap: Record<string, GroupDocLite>;
  styles: Record<string, React.CSSProperties>;
  typeLabel: (t: string) => string;
  fmtDate: (ts?: any) => string;
  renderUserLink: (uid: string) => React.ReactNode;
  router: any;
};

type BusyMap = Record<string, boolean>;
type TextMap = Record<string, string>;
type DateMap = Record<string, string>;
type ToggleMap = Record<string, boolean>;
type ServiceSectionKey = "requested" | "rejected" | "refund";

function getServiceEmoji(type: string): string {
  if (type === "saludo") return "👋";
  if (type === "consejo") return "💡";
  if (type === "meet_greet_digital") return "🤝";
  if (
    type === "digital_exclusive_session" ||
    type === "exclusive_session" ||
    type === "clase_personalizada"
  ) {
    return "👑";
  }
  return "👑";
}

function getServiceName(type: string, typeLabel: (t: string) => string): string {
  if (type === "meet_greet_digital") return "Meet & Greet";
  if (
    type === "digital_exclusive_session" ||
    type === "exclusive_session" ||
    type === "clase_personalizada"
  ) {
    return "Sesión exclusiva";
  }
  return typeLabel(type);
}

function getServiceTone(type: string): {
  border: string;
  background: string;
  color: string;
} {
  if (type === "saludo") {
    return {
      border: "rgba(34,197,94,0.24)",
      background: "rgba(34,197,94,0.08)",
      color: "#86efac",
    };
  }

  if (type === "consejo") {
    return {
      border: "rgba(250,204,21,0.26)",
      background: "rgba(250,204,21,0.08)",
      color: "#fde047",
    };
  }

  if (type === "meet_greet_digital") {
    return {
      border: "rgba(96,165,250,0.28)",
      background: "rgba(96,165,250,0.08)",
      color: "#93c5fd",
    };
  }

  if (
    type === "digital_exclusive_session" ||
    type === "exclusive_session" ||
    type === "clase_personalizada"
  ) {
    return {
      border: "rgba(168,85,247,0.32)",
      background: "rgba(168,85,247,0.10)",
      color: "#d8b4fe",
    };
  }

  return {
    border: "rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
  };
}

function getMeetGreetStatusLabel(status: string): string {
  switch (status) {
    case "pending_creator_response":
      return "En espera de aceptación";
    case "accepted_pending_schedule":
      return "Aceptado, pendiente de fecha";
    case "scheduled":
      return "Agendado";
    case "reschedule_requested":
      return "Cambio de fecha solicitado";
    case "rejected":
      return "Rechazado";
    case "refund_requested":
      return "Devolución solicitada";
    case "refund_review":
      return "Devolución en revisión";
    case "ready_to_prepare":
      return "Ya casi inicia";
    case "in_preparation":
      return "En preparación";
    case "completed":
      return "Completado";
    case "cancelled":
      return "Cancelado";
    default:
      return status || "Estado desconocido";
  }
}

function getMeetGreetStatusStyle(status: string): React.CSSProperties {
  if (
    status === "scheduled" ||
    status === "accepted_pending_schedule" ||
    status === "completed"
  ) {
    return {
      border: "1px solid rgba(34,197,94,0.24)",
      background: "rgba(34,197,94,0.12)",
      color: "#86efac",
    };
  }

  if (status === "in_preparation") {
    return {
      border: "1px solid rgba(96,165,250,0.30)",
      background: "rgba(96,165,250,0.16)",
      color: "#93c5fd",
    };
  }

  if (
    status === "reschedule_requested" ||
    status === "ready_to_prepare" ||
    status === "refund_requested" ||
    status === "refund_review"
  ) {
    return {
      border: "1px solid rgba(250,204,21,0.26)",
      background: "rgba(250,204,21,0.12)",
      color: "#fde047",
    };
  }

  if (status === "rejected" || status === "cancelled") {
    return {
      border: "1px solid rgba(248,113,113,0.28)",
      background: "rgba(248,113,113,0.14)",
      color: "#fca5a5",
    };
  }

  return {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
  };
}

function toDateSafe(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function toDateTimeLocalValue(value: unknown): string {
  const date = toDateSafe(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function isPrepareWindowOpen(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const startsAt = date.getTime();
  const prepareFrom = startsAt - 10 * 60 * 1000;

  return now >= prepareFrom;
}

function isStartingSoon(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const diff = date.getTime() - now;

  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

function remainingReschedules(req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc): number {
  const used =
    typeof req.rescheduleRequestsUsed === "number"
      ? req.rescheduleRequestsUsed
      : 0;

  return Math.max(0, 2 - used);
}

function formatMoney(value: number, currency?: string | null): string {
  const safeCurrency = currency === "USD" ? "USD" : "MXN";

  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${safeCurrency} ${value}`;
  }
}

function getRequestCurrency(req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc): string {
  const reqWithExtras = req as (MeetGreetRequestDoc | ExclusiveSessionRequestDoc) & {
    currency?: string | null;
    serviceSnapshot?: { currency?: string | null } | null;
  };

  return reqWithExtras.currency ?? reqWithExtras.serviceSnapshot?.currency ?? "MXN";
}

function getSectionForMeetGreetStatus(status: string): ServiceSectionKey {
  if (status === "rejected" || status === "cancelled") return "rejected";
  if (status === "refund_requested" || status === "refund_review") return "refund";
  return "requested";
}

function StatusPill({ children, style }: { children: ReactNode; style: React.CSSProperties }) {
  return (
    <span
      style={{
        ...style,
        borderRadius: 999,
        padding: "5px 9px",
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "fit-content",
      }}
    >
      {children}
    </span>
  );
}

function CleanServiceCard({
  id,
  type,
  title,
  subtitle,
  meta,
  expanded,
  onToggle,
  styles,
  children,
}: {
  id: string;
  type: string;
  title: string;
  subtitle: ReactNode;
  meta?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  styles: Record<string, React.CSSProperties>;
  children: ReactNode;
}) {
  const tone = getServiceTone(type);

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${expanded ? tone.border : "rgba(255,255,255,0.08)"}`,
        background: expanded
          ? `linear-gradient(180deg, ${tone.background}, rgba(255,255,255,0.025))`
          : "rgba(255,255,255,0.035)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`service-details-${id}`}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          padding: 12,
          margin: 0,
          cursor: "pointer",
          textAlign: "left",
          display: "grid",
          gap: 7,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{getServiceEmoji(type)}</span>
            <span
              style={{
                color: "#fff",
                fontSize: 14,
                fontWeight: 850,
                lineHeight: 1.15,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </span>
          </div>

          <span
            style={{
              color: "rgba(255,255,255,0.46)",
              fontSize: 16,
              lineHeight: 1,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 160ms ease",
            }}
          >
            ⌄
          </span>
        </div>

        <div style={{ ...styles.subtle, lineHeight: 1.35 }}>{subtitle}</div>
        {meta ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{meta}</div> : null}
      </button>

      {expanded ? (
        <div
          id={`service-details-${id}`}
          style={{
            borderTop: "1px solid rgba(255,255,255,0.07)",
            padding: "0 12px 12px",
            display: "grid",
            gap: 8,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function SectionBlock({
  title,
  icon,
  count,
  empty,
  children,
  styles,
}: {
  title: string;
  icon: string;
  count: number;
  empty: string;
  children: ReactNode;
  styles: Record<string, React.CSSProperties>;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          ...styles.sectionTitle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          paddingTop: 6,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span>{icon}</span>
          <span>{title}</span>
        </span>
        {count > 0 ? (
          <span
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.05)",
              padding: "3px 7px",
              fontSize: 11,
              color: "rgba(255,255,255,0.70)",
            }}
          >
            {count}
          </span>
        ) : null}
      </div>

      {count === 0 ? (
        <div style={{ ...styles.subtle, padding: "2px 2px 4px" }}>{empty}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>{children}</div>
      )}
    </div>
  );
}

export default function OwnerSidebarGreetings({
  buyerPending,
  buyerMeetGreets,
  buyerExclusiveSessions,
  meetGreetsByGroup,
  exclusiveSessionsByGroup,
  groupMetaMap,
  styles,
  typeLabel,
  fmtDate,
  renderUserLink,
  router,
}: Props) {
  const [busyMap, setBusyMap] = useState<BusyMap>({});
  const [errorMap, setErrorMap] = useState<TextMap>({});
  const [successMap, setSuccessMap] = useState<TextMap>({});
  const [expandedMap, setExpandedMap] = useState<ToggleMap>({});
  const [rejectOpenMap, setRejectOpenMap] = useState<ToggleMap>({});
  const [scheduleOpenMap, setScheduleOpenMap] = useState<ToggleMap>({});
  const [refundOpenMap, setRefundOpenMap] = useState<ToggleMap>({});
  const [rescheduleOpenMap, setRescheduleOpenMap] = useState<ToggleMap>({});
  const [preparationOpenMap, setPreparationOpenMap] = useState<ToggleMap>({});
  const [preparationRoleMap, setPreparationRoleMap] = useState<TextMap>({});
  const [rejectReasonMap, setRejectReasonMap] = useState<TextMap>({});
  const [refundReasonMap, setRefundReasonMap] = useState<TextMap>({});
  const [rescheduleReasonMap, setRescheduleReasonMap] = useState<TextMap>({});
  const [scheduleNoteMap, setScheduleNoteMap] = useState<TextMap>({});
  const [scheduleDateMap, setScheduleDateMap] = useState<DateMap>({});

  const incomingMeetGreets = useMemo<ScheduledRow[]>(
    () =>
      Object.entries(meetGreetsByGroup).flatMap(([groupId, rows]) =>
        rows.map((row) => ({ ...row, groupId, serviceKind: "meet_greet" as const }))
      ),
    [meetGreetsByGroup]
  );

  const incomingExclusiveSessions = useMemo<ScheduledRow[]>(
    () =>
      Object.entries(exclusiveSessionsByGroup).flatMap(([groupId, rows]) =>
        rows.map((row) => ({ ...row, groupId, serviceKind: "exclusive_session" as const }))
      ),
    [exclusiveSessionsByGroup]
  );

  const buyerScheduledServices: ScheduledRow[] = useMemo(
    () => [
      ...buyerMeetGreets.map((row) => ({ ...row, serviceKind: "meet_greet" as const })),
      ...buyerExclusiveSessions.map((row) => ({ ...row, serviceKind: "exclusive_session" as const })),
    ],
    [buyerMeetGreets, buyerExclusiveSessions]
  );

  const incomingScheduledServices = useMemo(
    () => [...incomingMeetGreets, ...incomingExclusiveSessions],
    [incomingMeetGreets, incomingExclusiveSessions]
  );

  const requestedCount =
    buyerPending.length +
    buyerScheduledServices.filter((row) => getSectionForMeetGreetStatus(row.data.status) === "requested").length +
    incomingScheduledServices.filter((row) => getSectionForMeetGreetStatus(row.data.status) === "requested").length;

  const rejectedCount =
    buyerScheduledServices.filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected").length +
    incomingScheduledServices.filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected").length;

  const refundCount =
    buyerScheduledServices.filter((row) => getSectionForMeetGreetStatus(row.data.status) === "refund").length +
    incomingScheduledServices.filter((row) => getSectionForMeetGreetStatus(row.data.status) === "refund").length;

  function toggleExpanded(requestId: string) {
    setExpandedMap((prev) => ({ ...prev, [requestId]: !prev[requestId] }));
  }

  function setBusy(requestId: string, value: boolean) {
    setBusyMap((prev) => ({ ...prev, [requestId]: value }));
  }

  function setError(requestId: string, value: string | null) {
    setErrorMap((prev) => ({ ...prev, [requestId]: value ?? "" }));
  }

  function setSuccess(requestId: string, value: string | null) {
    setSuccessMap((prev) => ({ ...prev, [requestId]: value ?? "" }));
  }

  async function handleCreatorAccept(requestId: string, kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId });
      } else {
        await acceptMeetGreetRequest({ requestId });
      }
      setSuccess(requestId, "✅ Solicitud aceptada. Ahora puedes proponer fecha y hora.");
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: true }));
      setExpandedMap((prev) => ({ ...prev, [requestId]: true }));
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo aceptar la solicitud.");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorReject(requestId: string, kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        rejectionReason: rejectReasonMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await rejectExclusiveSessionRequest(payload);
      } else {
        await rejectMeetGreetRequest(payload);
      }

      setSuccess(requestId, "✅ Solicitud rechazada.");
      setRejectOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo rechazar la solicitud.");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorSchedule(requestId: string, kind: ScheduledServiceKind) {
    const scheduledAt = (scheduleDateMap[requestId] ?? "").trim();

    if (!scheduledAt) {
      setError(requestId, "Selecciona fecha y hora.");
      return;
    }

    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        note: scheduleNoteMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await proposeExclusiveSessionSchedule(payload);
      } else {
        await proposeMeetGreetSchedule(payload);
      }

      setSuccess(requestId, "✅ Fecha propuesta/agendada correctamente.");
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo guardar la fecha.");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleBuyerRefund(requestId: string, kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        refundReason: refundReasonMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await requestExclusiveSessionRefund(payload);
      } else {
        await requestMeetGreetRefund(payload);
      }

      setSuccess(requestId, "✅ Devolución solicitada.");
      setRefundOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo solicitar la devolución.");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleBuyerReschedule(requestId: string, kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        reason: rescheduleReasonMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await requestExclusiveSessionReschedule(payload);
      } else {
        await requestMeetGreetReschedule(payload);
      }

      setSuccess(requestId, "✅ Cambio de fecha solicitado.");
      setRescheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo solicitar el cambio de fecha.");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handlePrepare(requestId: string, role: "buyer" | "creator", kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await setExclusiveSessionPreparing({ requestId, role });
      } else {
        await setMeetGreetPreparing({ requestId, role });
      }

      setPreparationRoleMap((prev) => ({ ...prev, [requestId]: role }));
      setPreparationOpenMap((prev) => ({ ...prev, [requestId]: true }));
      setSuccess(requestId, "✅ Panel de preparación abierto.");
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo abrir la preparación.");
    } finally {
      setBusy(requestId, false);
    }
  }

  function renderRequestFeedback(requestId: string) {
    const error = errorMap[requestId];
    const success = successMap[requestId];

    return (
      <>
        {error ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(248,113,113,0.18)",
              background: "rgba(248,113,113,0.08)",
              padding: "7px 8px",
              fontSize: 12,
              lineHeight: 1.3,
              color: "#fecaca",
            }}
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(34,197,94,0.18)",
              background: "rgba(34,197,94,0.08)",
              padding: "7px 8px",
              fontSize: 12,
              lineHeight: 1.3,
              color: "#bbf7d0",
            }}
          >
            {success}
          </div>
        ) : null}
      </>
    );
  }

  function renderPreparationPanel(
    requestId: string,
    req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc,
    role: "buyer" | "creator"
  ) {
    return (
      <MeetGreetPreparationFullscreen
        open={!!preparationOpenMap[requestId]}
        onClose={() =>
          setPreparationOpenMap((prev) => ({ ...prev, [requestId]: false }))
        }
        role={role}
        scheduledAtLabel={req.scheduledAt ? fmtDate(req.scheduledAt) : null}
        durationMinutes={req.durationMinutes ?? null}
      />
    );
  }

  function renderGroupLink(group: GroupDocLite | null) {
    if (!group) return null;

    return (
      <button
        type="button"
        onClick={() => router.push(`/groups/${group.id}`)}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          textAlign: "left",
          cursor: "pointer",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          textDecoration: "underline",
          textUnderlineOffset: 2,
          width: "fit-content",
        }}
      >
        {group.name ?? "Ir a la comunidad"}
      </button>
    );
  }

  function renderTextBox(text: string, tone: "default" | "warning" | "danger" = "default") {
    const visual =
      tone === "danger"
        ? {
            border: "rgba(248,113,113,0.18)",
            background: "rgba(248,113,113,0.08)",
            color: "#fecaca",
          }
        : tone === "warning"
          ? {
              border: "rgba(250,204,21,0.18)",
              background: "rgba(250,204,21,0.08)",
              color: "#fde68a",
            }
          : {
              border: "rgba(255,255,255,0.10)",
              background: "rgba(0,0,0,0.18)",
              color: "rgba(255,255,255,0.92)",
            };

    return (
      <div
        style={{
          borderRadius: 10,
          border: `1px solid ${visual.border}`,
          background: visual.background,
          padding: "7px 8px",
          whiteSpace: "pre-wrap",
          fontSize: 12,
          lineHeight: 1.35,
          color: visual.color,
        }}
      >
        {text}
      </div>
    );
  }

  function renderBuyerGreetingCard(row: { id: string; data: GreetingRequestDoc }) {
    const req = row.data;
    const group = groupMetaMap[req.groupId] ?? null;

    return (
      <CleanServiceCard
        key={row.id}
        id={row.id}
        type={req.type}
        title={getServiceName(req.type, typeLabel)}
        subtitle={
          <>
            Comprado a {renderUserLink(req.creatorId)}
            {req.toName ? <> · Para {req.toName}</> : null}
          </>
        }
        meta={<StatusPill style={{ border: "1px solid " + getServiceTone(req.type).border, background: getServiceTone(req.type).background, color: getServiceTone(req.type).color }}>Solicitado</StatusPill>}
        expanded={!!expandedMap[row.id]}
        onToggle={() => toggleExpanded(row.id)}
        styles={styles}
      >
        {renderGroupLink(group)}
        {req.instructions ? renderTextBox(req.instructions) : null}
        {req.createdAt ? <div style={styles.subtle}>{fmtDate(req.createdAt)}</div> : null}
        {renderRequestFeedback(row.id)}
      </CleanServiceCard>
    );
  }

  function renderBuyerScheduledServiceCard(row: ScheduledRow) {
    const req = row.data;
    const group = groupMetaMap[req.groupId] ?? null;
    const busy = !!busyMap[row.id];
    const isExclusiveSession = row.serviceKind === "exclusive_session";
    const serviceType = isExclusiveSession ? "digital_exclusive_session" : "meet_greet_digital";
    const serviceTitle = isExclusiveSession ? "Sesión exclusiva" : "Meet & Greet";
    const canRequestRefund = req.status === "rejected" && req.paymentStatus !== "refunded";
    const canRetry = req.status === "rejected" && !!group?.id;
    const canRequestReschedule =
      (req.status === "scheduled" || req.status === "ready_to_prepare") &&
      remainingReschedules(req) > 0;
    const canPrepare =
      (req.status === "scheduled" ||
        req.status === "ready_to_prepare" ||
        req.status === "in_preparation") &&
      isPrepareWindowOpen(req.scheduledAt);

    return (
      <CleanServiceCard
        key={`${row.serviceKind}-${row.id}`}
        id={`${row.serviceKind}-${row.id}`}
        type={serviceType}
        title={serviceTitle}
        subtitle={<>Comprado a {renderUserLink(req.creatorId)}</>}
        meta={<StatusPill style={getMeetGreetStatusStyle(req.status)}>{getMeetGreetStatusLabel(req.status)}</StatusPill>}
        expanded={!!expandedMap[row.id]}
        onToggle={() => toggleExpanded(row.id)}
        styles={styles}
      >
        {renderGroupLink(group)}

        {isStartingSoon(req.scheduledAt)
          ? renderTextBox(`⚠️ Tu ${serviceTitle.toLowerCase()} está próximo a iniciar.`, "warning")
          : null}

        {canPrepare ? renderTextBox("🎥 Ya puedes entrar a preparación.", "default") : null}

        {(req.priceSnapshot != null || req.durationMinutes != null) ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {req.priceSnapshot != null ? (
              <span style={styles.subtle}>
                Precio capturado: {formatMoney(req.priceSnapshot, getRequestCurrency(req))}
              </span>
            ) : null}
            {req.durationMinutes != null ? (
              <span style={styles.subtle}>Duración: {req.durationMinutes} min</span>
            ) : null}
          </div>
        ) : null}

        {req.buyerMessage ? renderTextBox(req.buyerMessage) : null}
        {req.rejectionReason ? renderTextBox(`Motivo de rechazo: ${req.rejectionReason}`, "danger") : null}
        {(req as any).autoRejectReason === "creator_no_show_after_15_minutes" ? (
          renderTextBox(
            "El creador no se conectó dentro de los 15 minutos posteriores a la hora agendada. Puedes volver a intentarlo o solicitar devolución.",
            "danger"
          )
        ) : null}
        {req.refundReason ? renderTextBox(`Motivo de devolución: ${req.refundReason}`, "warning") : null}
        {req.scheduledAt ? <div style={styles.subtle}>Fecha propuesta/agendada: {fmtDate(req.scheduledAt)}</div> : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canRequestRefund ? (
            <button
              type="button"
              onClick={() => setRefundOpenMap((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
              disabled={busy}
              style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}
            >
              Solicitar devolución
            </button>
          ) : null}

          {canRetry ? (
            <button
              type="button"
              onClick={() => router.push(`/groups/${group?.id}`)}
              disabled={busy}
              style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}
            >
              Volver a intentarlo
            </button>
          ) : null}

          {canRequestReschedule ? (
            <button
              type="button"
              onClick={() => setRescheduleOpenMap((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
              disabled={busy}
              style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}
            >
              Solicitar cambio de fecha
            </button>
          ) : null}

          {canPrepare ? (
            <button
              type="button"
              onClick={() => handlePrepare(row.id, "buyer", row.serviceKind)}
              disabled={busy}
              style={{ ...styles.buttonPrimary, opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {busy ? "Procesando..." : "Prepararse"}
            </button>
          ) : null}
        </div>

        {req.status === "scheduled" || req.status === "ready_to_prepare" ? (
          <div
            style={{
              ...styles.subtle,
              color: remainingReschedules(req) === 0 ? "#fca5a5" : "rgba(255,255,255,0.62)",
            }}
          >
            Cambios de fecha restantes: {remainingReschedules(req)}
          </div>
        ) : null}

        {refundOpenMap[row.id] ? (
          <div style={{ display: "grid", gap: 8 }}>
            <textarea
              value={refundReasonMap[row.id] ?? ""}
              onChange={(e) => setRefundReasonMap((prev) => ({ ...prev, [row.id]: e.target.value }))}
              placeholder="Explica por qué solicitas devolución."
              style={{ ...styles.input, height: 92, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => handleBuyerRefund(row.id, row.serviceKind)} disabled={busy} style={{ ...styles.buttonPrimary, opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Procesando..." : "Confirmar devolución"}
              </button>
              <button type="button" onClick={() => setRefundOpenMap((prev) => ({ ...prev, [row.id]: false }))} disabled={busy} style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {rescheduleOpenMap[row.id] ? (
          <div style={{ display: "grid", gap: 8 }}>
            <textarea
              value={rescheduleReasonMap[row.id] ?? ""}
              onChange={(e) => setRescheduleReasonMap((prev) => ({ ...prev, [row.id]: e.target.value }))}
              placeholder="Explica por qué necesitas otra fecha."
              style={{ ...styles.input, height: 92, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => handleBuyerReschedule(row.id, row.serviceKind)} disabled={busy} style={{ ...styles.buttonPrimary, opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Procesando..." : "Confirmar cambio"}
              </button>
              <button type="button" onClick={() => setRescheduleOpenMap((prev) => ({ ...prev, [row.id]: false }))} disabled={busy} style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {renderRequestFeedback(row.id)}
        {renderPreparationPanel(row.id, req, (preparationRoleMap[row.id] as "buyer" | "creator") ?? "buyer")}
        {req.createdAt ? <div style={styles.subtle}>{fmtDate(req.createdAt)}</div> : null}
      </CleanServiceCard>
    );
  }

  function renderIncomingScheduledServiceCard(row: ScheduledRow) {
    const req = row.data;
    const group = groupMetaMap[row.groupId ?? req.groupId] ?? null;
    const busy = !!busyMap[row.id];
    const isExclusiveSession = row.serviceKind === "exclusive_session";
    const serviceType = isExclusiveSession ? "digital_exclusive_session" : "meet_greet_digital";
    const serviceTitle = isExclusiveSession ? "Sesión exclusiva" : "Meet & Greet";
    const canAccept = req.status === "pending_creator_response";
    const canReject =
      req.status === "pending_creator_response" ||
      req.status === "accepted_pending_schedule" ||
      req.status === "reschedule_requested";
    const canSchedule =
      req.status === "accepted_pending_schedule" ||
      req.status === "reschedule_requested" ||
      req.status === "scheduled" ||
      req.status === "ready_to_prepare";
    const canPrepare =
      (req.status === "scheduled" ||
        req.status === "ready_to_prepare" ||
        req.status === "in_preparation") &&
      isPrepareWindowOpen(req.scheduledAt);

    return (
      <CleanServiceCard
        key={`${row.serviceKind}-${row.id}`}
        id={`${row.serviceKind}-${row.id}`}
        type={serviceType}
        title={serviceTitle}
        subtitle={<>Solicitado por {renderUserLink(req.buyerId)}</>}
        meta={<StatusPill style={getMeetGreetStatusStyle(req.status)}>{getMeetGreetStatusLabel(req.status)}</StatusPill>}
        expanded={!!expandedMap[row.id]}
        onToggle={() => toggleExpanded(row.id)}
        styles={styles}
      >
        {renderGroupLink(group)}

        {isStartingSoon(req.scheduledAt)
          ? renderTextBox(`⚠️ Este ${serviceTitle.toLowerCase()} está próximo a iniciar.`, "warning")
          : null}
        {canPrepare ? renderTextBox("🎥 Ya puedes entrar a preparación.") : null}

        {(req.priceSnapshot != null || req.durationMinutes != null) ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {req.priceSnapshot != null ? (
              <span style={styles.subtle}>
                Precio capturado: {formatMoney(req.priceSnapshot, getRequestCurrency(req))}
              </span>
            ) : null}
            {req.durationMinutes != null ? <span style={styles.subtle}>Duración: {req.durationMinutes} min</span> : null}
          </div>
        ) : null}

        {req.buyerMessage ? renderTextBox(req.buyerMessage) : null}
        {req.rejectionReason ? renderTextBox(`Motivo de rechazo: ${req.rejectionReason}`, "danger") : null}
        {req.refundReason ? renderTextBox(`Motivo de devolución: ${req.refundReason}`, "warning") : null}
        {req.scheduledAt ? <div style={styles.subtle}>Fecha propuesta/agendada: {fmtDate(req.scheduledAt)}</div> : null}

        {canAccept || canReject || canSchedule || canPrepare ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canAccept ? (
              <button type="button" onClick={() => handleCreatorAccept(row.id, row.serviceKind)} disabled={busy} style={{ ...styles.buttonPrimary, opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Procesando..." : "Aceptar"}
              </button>
            ) : null}

            {canReject ? (
              <button type="button" onClick={() => setRejectOpenMap((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} disabled={busy} style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                Rechazar
              </button>
            ) : null}

            {canSchedule ? (
              <button type="button" onClick={() => setScheduleOpenMap((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} disabled={busy} style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                {req.status === "accepted_pending_schedule" ? "Poner fecha" : "Proponer nueva fecha"}
              </button>
            ) : null}

            {canPrepare ? (
              <button type="button" onClick={() => handlePrepare(row.id, "creator", row.serviceKind)} disabled={busy} style={{ ...styles.buttonPrimary, opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Procesando..." : "Prepararse"}
              </button>
            ) : null}
          </div>
        ) : null}

        {rejectOpenMap[row.id] ? (
          <div style={{ display: "grid", gap: 8 }}>
            <textarea
              value={rejectReasonMap[row.id] ?? ""}
              onChange={(e) => setRejectReasonMap((prev) => ({ ...prev, [row.id]: e.target.value }))}
              placeholder="Explica por qué rechazas la solicitud."
              style={{ ...styles.input, height: 92, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => handleCreatorReject(row.id, row.serviceKind)} disabled={busy} style={{ ...styles.buttonPrimary, opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Procesando..." : "Confirmar rechazo"}
              </button>
              <button type="button" onClick={() => setRejectOpenMap((prev) => ({ ...prev, [row.id]: false }))} disabled={busy} style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {scheduleOpenMap[row.id] ? (
          <div style={{ display: "grid", gap: 8 }}>
            <input
              type="datetime-local"
              value={scheduleDateMap[row.id] || toDateTimeLocalValue(req.scheduledAt)}
              onChange={(e) => setScheduleDateMap((prev) => ({ ...prev, [row.id]: e.target.value }))}
              style={styles.input}
            />
            <textarea
              value={scheduleNoteMap[row.id] ?? ""}
              onChange={(e) => setScheduleNoteMap((prev) => ({ ...prev, [row.id]: e.target.value }))}
              placeholder="Nota opcional sobre la fecha propuesta."
              style={{ ...styles.input, height: 92, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => handleCreatorSchedule(row.id, row.serviceKind)} disabled={busy} style={{ ...styles.buttonPrimary, opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Procesando..." : "Guardar fecha"}
              </button>
              <button type="button" onClick={() => setScheduleOpenMap((prev) => ({ ...prev, [row.id]: false }))} disabled={busy} style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {renderRequestFeedback(row.id)}
        {renderPreparationPanel(row.id, req, (preparationRoleMap[row.id] as "buyer" | "creator") ?? "creator")}
        {req.createdAt ? <div style={styles.subtle}>{fmtDate(req.createdAt)}</div> : null}
      </CleanServiceCard>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <SectionBlock
        title="Servicios solicitados"
        icon="🧾"
        count={requestedCount}
        empty="No tienes servicios solicitados por ahora."
        styles={styles}
      >
        {buyerPending.map(renderBuyerGreetingCard)}
        {buyerScheduledServices
          .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "requested")
          .map(renderBuyerScheduledServiceCard)}
        {incomingScheduledServices
          .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "requested")
          .map(renderIncomingScheduledServiceCard)}
      </SectionBlock>

      <SectionBlock
        title="Servicios rechazados"
        icon="❌"
        count={rejectedCount}
        empty="No tienes servicios rechazados."
        styles={styles}
      >
        {buyerScheduledServices
          .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected")
          .map(renderBuyerScheduledServiceCard)}
        {incomingScheduledServices
          .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected")
          .map(renderIncomingScheduledServiceCard)}
      </SectionBlock>

      <SectionBlock
        title="Servicios en proceso de devolución"
        icon="💸"
        count={refundCount}
        empty="No tienes servicios en proceso de devolución."
        styles={styles}
      >
        {buyerScheduledServices
          .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "refund")
          .map(renderBuyerScheduledServiceCard)}
        {incomingScheduledServices
          .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "refund")
          .map(renderIncomingScheduledServiceCard)}
      </SectionBlock>
    </div>
  );
}
