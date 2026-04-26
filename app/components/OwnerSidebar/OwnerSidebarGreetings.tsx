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
import { Chevron } from "./OwnerSidebar";
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

type BuyerGreetingRow = {
  rowType: "buyer_greeting";
  id: string;
  row: { id: string; data: GreetingRequestDoc };
};

type BuyerScheduledRow = {
  rowType: "buyer_scheduled";
  id: string;
  row: ScheduledRow;
};

type IncomingScheduledRow = {
  rowType: "incoming_scheduled";
  id: string;
  row: ScheduledRow;
};

type DisplayRow = BuyerGreetingRow | BuyerScheduledRow | IncomingScheduledRow;

function getServiceEmoji(type: string): string {
  if (type === "saludo") return "👋";
  if (type === "consejo") return "💡";
  if (type === "mensaje") return "💬";
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

function getTypeChipStyle(_type: string): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.035)",
    color: "rgba(255,255,255,0.92)",
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

function isNoShowExpired(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;
  const rejectAt = date.getTime() + 15 * 60 * 1000;
  return Date.now() >= rejectAt;
}

function isStartingSoon(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const diff = date.getTime() - now;

  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

function getSortDate(row: DisplayRow): Date | null {
  if (row.rowType === "buyer_greeting") {
    return toDateSafe(row.row.data.createdAt) ?? toDateSafe(row.row.data.updatedAt);
  }

  const data = row.row.data;
  return (
    toDateSafe(data.scheduledAt) ??
    toDateSafe(data.updatedAt) ??
    toDateSafe(data.createdAt)
  );
}

function sortDisplayRows(a: DisplayRow, b: DisplayRow): number {
  const aScheduled = a.rowType !== "buyer_greeting" ? a.row.data.scheduledAt : null;
  const bScheduled = b.rowType !== "buyer_greeting" ? b.row.data.scheduledAt : null;
  const aSoon = isStartingSoon(aScheduled);
  const bSoon = isStartingSoon(bScheduled);

  if (aSoon !== bSoon) return aSoon ? -1 : 1;

  const aDate = getSortDate(a);
  const bDate = getSortDate(b);

  return (
    (aDate?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (bDate?.getTime() ?? Number.MAX_SAFE_INTEGER)
  );
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

function getCreatorScheduleNote(
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc
): string | null {
  const note = (req as any).creatorScheduleNote;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

function getSectionForMeetGreetStatus(status: string): ServiceSectionKey {
  if (status === "rejected" || status === "cancelled") return "rejected";
  if (status === "refund_requested" || status === "refund_review") return "refund";
  return "requested";
}

function getSectionVisual(key: ServiceSectionKey): {
  icon: string;
  title: string;
  countTone: React.CSSProperties;
} {
  if (key === "rejected") {
    return {
      icon: "❌",
      title: "Servicios rechazados",
      countTone: {
        color: "#f43f5e",
      },
    };
  }

  if (key === "refund") {
    return {
      icon: "💸",
      title: "Devolución en proceso",
      countTone: {
        color: "#f43f5e",
      },
    };
  }

  return {
    icon: "🧾",
    title: "Servicios solicitados",
    countTone: {
      color: "#f43f5e",
    },
  };
}

function StatusPill({ children, style }: { children: ReactNode; style: React.CSSProperties }) {
  return (
    <span
      style={{
        ...style,
        borderRadius: 999,
        padding: "5px 9px",
        fontSize: 11,
        fontWeight: 700,
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

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "rgba(255,255,255,0.42)",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        padding: "2px 2px 0",
      }}
    >
      {children}
    </div>
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
  return (
    <div
      style={{
        ...styles.miniItem,
        background: expanded ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.02)",
        border: expanded ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(255,255,255,0.07)",
        borderRadius: 16,
        padding: 0,
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
          padding: 10,
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
              gap: 8,
              minWidth: 0,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.045)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  lineHeight: 1,
                  boxShadow: "0 6px 16px rgba(0,0,0,0.20)",
                  flexShrink: 0,
                }}
              >
                {getServiceEmoji(type)}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 750,
                  color: "#fff",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}
              >
                {title}
              </span>
            </span>
            {meta}
          </div>

          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Chevron open={expanded} />
          </span>
        </div>

        <div style={{ ...styles.subtle, lineHeight: 1.35 }}>{subtitle}</div>
      </button>

      {expanded ? (
        <div
          id={`service-details-${id}`}
          className="mini-vertical-scroll"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: 10,
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
  sectionKey,
  count,
  open,
  onToggle,
  children,
  styles,
}: {
  sectionKey: ServiceSectionKey;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  styles: Record<string, React.CSSProperties>;
}) {
  const visual = getSectionVisual(sectionKey);

  if (count <= 0) return null;

  return (
    <div
      style={{
        ...styles.card,
        border: "none",
        margin: 0,
        borderRadius: 16,
        background: "rgba(0,0,0,0.96)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          color: "#fff",
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          textAlign: "left",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            {visual.icon}
          </span>
          <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#fff",
                lineHeight: 1.15,
              }}
            >
              {visual.title}
            </span>
          </span>
        </span>

        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span
            style={{
              ...visual.countTone,
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1,
              minWidth: 10,
              textAlign: "center",
            }}
          >
            {count}
          </span>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Chevron open={open} />
          </span>
        </span>
      </button>

      {open ? (
        <div
          style={{
            marginTop: 9,
            paddingTop: 9,
            borderTop: "1px solid rgba(255,255,255,0.06)",
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
  const [openSectionKey, setOpenSectionKey] = useState<ServiceSectionKey | null>("requested");
  const [openItemKey, setOpenItemKey] = useState<string | null>(null);
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

  const requestedRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [
      ...buyerPending.map((row) => ({ rowType: "buyer_greeting" as const, id: `buyer-greeting-${row.id}`, row })),
      ...buyerScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "requested")
        .map((row) => ({ rowType: "buyer_scheduled" as const, id: `buyer-${row.serviceKind}-${row.id}`, row })),
      ...incomingScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "requested")
        .map((row) => ({ rowType: "incoming_scheduled" as const, id: `incoming-${row.serviceKind}-${row.id}`, row })),
    ];

    return rows.sort(sortDisplayRows);
  }, [buyerPending, buyerScheduledServices, incomingScheduledServices]);

  const rejectedRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [
      ...buyerScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected")
        .map((row) => ({ rowType: "buyer_scheduled" as const, id: `buyer-${row.serviceKind}-${row.id}`, row })),
      ...incomingScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected")
        .map((row) => ({ rowType: "incoming_scheduled" as const, id: `incoming-${row.serviceKind}-${row.id}`, row })),
    ];

    return rows.sort(sortDisplayRows);
  }, [buyerScheduledServices, incomingScheduledServices]);

  const refundRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [
      ...buyerScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "refund")
        .map((row) => ({ rowType: "buyer_scheduled" as const, id: `buyer-${row.serviceKind}-${row.id}`, row })),
      ...incomingScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "refund")
        .map((row) => ({ rowType: "incoming_scheduled" as const, id: `incoming-${row.serviceKind}-${row.id}`, row })),
    ];

    return rows.sort(sortDisplayRows);
  }, [buyerScheduledServices, incomingScheduledServices]);

  function closeInlinePanels(requestId: string, except?: "reject" | "schedule" | "refund" | "reschedule") {
    if (except !== "reject") setRejectOpenMap((prev) => ({ ...prev, [requestId]: false }));
    if (except !== "schedule") setScheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    if (except !== "refund") setRefundOpenMap((prev) => ({ ...prev, [requestId]: false }));
    if (except !== "reschedule") setRescheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
  }

  function toggleSection(sectionKey: ServiceSectionKey) {
    setOpenSectionKey((prev) => (prev === sectionKey ? null : sectionKey));
    setOpenItemKey(null);
  }

  function toggleItem(itemKey: string) {
    setOpenItemKey((prev) => (prev === itemKey ? null : itemKey));
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
      closeInlinePanels(requestId, "schedule");
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: true }));
      setOpenItemKey(`incoming-${kind}-${requestId}`);
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
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 999,
          padding: "6px 9px",
          margin: 0,
          textAlign: "left",
          cursor: "pointer",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          width: "fit-content",
        }}
      >
        Comunidad: {group.name ?? "Ir a la comunidad"}
      </button>
    );
  }

  function renderTextBox(text: string, tone: "default" | "warning" | "danger" | "info" = "default") {
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
          : tone === "info"
            ? {
                border: "rgba(96,165,250,0.18)",
                background: "rgba(96,165,250,0.08)",
                color: "#bfdbfe",
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
          lineHeight: 1.3,
          color: visual.color,
        }}
      >
        {text}
      </div>
    );
  }

  function renderBuyerGreetingCard(row: { id: string; data: GreetingRequestDoc }, itemKey: string) {
    const req = row.data;
    const group = groupMetaMap[req.groupId] ?? null;

    return (
      <CleanServiceCard
        key={itemKey}
        id={itemKey}
        type={req.type}
        title={getServiceName(req.type, typeLabel)}
        subtitle={
          <>
            Comprado a {renderUserLink(req.creatorId)}
            {req.toName ? <> · Para {req.toName}</> : null}
          </>
        }
        meta={
          <StatusPill style={getTypeChipStyle(req.type)}>
            Solicitado
          </StatusPill>
        }
        expanded={openItemKey === itemKey}
        onToggle={() => toggleItem(itemKey)}
        styles={styles}
      >
        {renderGroupLink(group)}
        {req.instructions ? renderTextBox(req.instructions) : null}
        {req.createdAt ? <div style={styles.subtle}>Solicitado: {fmtDate(req.createdAt)}</div> : null}
        {renderRequestFeedback(row.id)}
      </CleanServiceCard>
    );
  }

  function renderBuyerScheduledServiceCard(row: ScheduledRow, itemKey: string) {
    const req = row.data;
    const group = groupMetaMap[req.groupId] ?? null;
    const busy = !!busyMap[row.id];
    const isExclusiveSession = row.serviceKind === "exclusive_session";
    const serviceType = isExclusiveSession ? "digital_exclusive_session" : "meet_greet_digital";
    const serviceTitle = isExclusiveSession ? "Sesión exclusiva" : "Meet & Greet";
    const noShowExpired = isNoShowExpired(req.scheduledAt);
    const canRequestRefund = req.status === "rejected" && req.paymentStatus !== "refunded";
    const canRetry = req.status === "rejected" && !!group?.id;
    const canRequestReschedule =
      (req.status === "scheduled" || req.status === "ready_to_prepare") &&
      remainingReschedules(req) > 0 &&
      !noShowExpired;
    const canPrepare =
      (req.status === "scheduled" ||
        req.status === "ready_to_prepare" ||
        req.status === "in_preparation") &&
      isPrepareWindowOpen(req.scheduledAt) &&
      !noShowExpired;
const creatorScheduleNote = getCreatorScheduleNote(req);

    return (
      <CleanServiceCard
        key={itemKey}
        id={itemKey}
        type={serviceType}
        title={serviceTitle}
        subtitle={<>Comprado a {renderUserLink(req.creatorId)}</>}
        meta={<StatusPill style={getMeetGreetStatusStyle(req.status)}>{getMeetGreetStatusLabel(req.status)}</StatusPill>}
        expanded={openItemKey === itemKey}
        onToggle={() => toggleItem(itemKey)}
        styles={styles}
      >
        {renderGroupLink(group)}

        {isStartingSoon(req.scheduledAt) && !noShowExpired
          ? renderTextBox(`⚠️ Tu ${serviceTitle.toLowerCase()} está próximo a iniciar.`, "warning")
          : null}

        {canPrepare ? renderTextBox("🎥 Ya puedes entrar a preparación.", "info") : null}

        {(req.priceSnapshot != null || req.durationMinutes != null) ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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

        {creatorScheduleNote
          ? renderTextBox(`Mensaje del creador: ${creatorScheduleNote}`, "info")
          : null}

{req.rejectionReason ? renderTextBox(`Motivo de rechazo: ${req.rejectionReason}`, "danger") : null}
        {(req as any).autoRejectReason === "creator_no_show_after_15_minutes" ? (
          renderTextBox(
            "El creador no se conectó dentro de los 15 minutos posteriores a la hora agendada. Puedes volver a intentarlo o solicitar devolución.",
            "danger"
          )
        ) : null}
        {(req as any).autoRejectReason === "buyer_no_show_after_15_minutes" ? (
          renderTextBox(
            "No te conectaste dentro de los 15 minutos posteriores a la hora agendada. Revisa el estado antes de solicitar una devolución.",
            "danger"
          )
        ) : null}
        {req.refundReason ? renderTextBox(`Motivo de devolución: ${req.refundReason}`, "warning") : null}
        {req.scheduledAt ? <div style={styles.subtle}>Fecha propuesta/agendada: {fmtDate(req.scheduledAt)}</div> : null}
        {req.createdAt ? <div style={styles.subtle}>Solicitado: {fmtDate(req.createdAt)}</div> : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canRequestRefund ? (
            <button
              type="button"
              onClick={() => {
                const nextOpen = !refundOpenMap[row.id];
                closeInlinePanels(row.id, "refund");
                setRefundOpenMap((prev) => ({ ...prev, [row.id]: nextOpen }));
              }}
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
              onClick={() => {
                const nextOpen = !rescheduleOpenMap[row.id];
                closeInlinePanels(row.id, "reschedule");
                setRescheduleOpenMap((prev) => ({ ...prev, [row.id]: nextOpen }));
              }}
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
      </CleanServiceCard>
    );
  }

  function renderIncomingScheduledServiceCard(row: ScheduledRow, itemKey: string) {
    const req = row.data;
    const group = groupMetaMap[row.groupId ?? req.groupId] ?? null;
    const busy = !!busyMap[row.id];
    const isExclusiveSession = row.serviceKind === "exclusive_session";
    const serviceType = isExclusiveSession ? "digital_exclusive_session" : "meet_greet_digital";
    const serviceTitle = isExclusiveSession ? "Sesión exclusiva" : "Meet & Greet";
    const noShowExpired = isNoShowExpired(req.scheduledAt);
    const canAccept = req.status === "pending_creator_response";
    const canReject =
      req.status === "pending_creator_response" ||
      req.status === "accepted_pending_schedule" ||
      req.status === "reschedule_requested";
    const canSchedule =
      (req.status === "accepted_pending_schedule" ||
        req.status === "reschedule_requested" ||
        req.status === "scheduled" ||
        req.status === "ready_to_prepare") &&
      !noShowExpired;
      const creatorScheduleNote = getCreatorScheduleNote(req);
    const canPrepare =
      (req.status === "scheduled" ||
        req.status === "ready_to_prepare" ||
        req.status === "in_preparation") &&
      isPrepareWindowOpen(req.scheduledAt) &&
      !noShowExpired;

    return (
      <CleanServiceCard
        key={itemKey}
        id={itemKey}
        type={serviceType}
        title={serviceTitle}
        subtitle={<>Solicitado por {renderUserLink(req.buyerId)}</>}
        meta={<StatusPill style={getMeetGreetStatusStyle(req.status)}>{getMeetGreetStatusLabel(req.status)}</StatusPill>}
        expanded={openItemKey === itemKey}
        onToggle={() => toggleItem(itemKey)}
        styles={styles}
      >
        {renderGroupLink(group)}

        {isStartingSoon(req.scheduledAt) && !noShowExpired
          ? renderTextBox(`⚠️ Este ${serviceTitle.toLowerCase()} está próximo a iniciar.`, "warning")
          : null}
        {canPrepare ? renderTextBox("🎥 Ya puedes entrar a preparación.", "info") : null}

        {(req.priceSnapshot != null || req.durationMinutes != null) ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {req.priceSnapshot != null ? (
              <span style={styles.subtle}>
                Precio capturado: {formatMoney(req.priceSnapshot, getRequestCurrency(req))}
              </span>
            ) : null}
            {req.durationMinutes != null ? <span style={styles.subtle}>Duración: {req.durationMinutes} min</span> : null}
          </div>
        ) : null}

        {req.buyerMessage ? renderTextBox(req.buyerMessage) : null}
        {creatorScheduleNote
         ? renderTextBox(`Mensaje del creador: ${creatorScheduleNote}`, "info")
         : null}
        {req.rejectionReason ? renderTextBox(`Motivo de rechazo: ${req.rejectionReason}`, "danger") : null}
        {(req as any).autoRejectReason === "buyer_no_show_after_15_minutes" ? (
          renderTextBox(
            "El comprador no se conectó dentro de los 15 minutos posteriores a la hora agendada.",
            "danger"
          )
        ) : null}
        {(req as any).autoRejectReason === "creator_no_show_after_15_minutes" ? (
          renderTextBox(
            "No te conectaste dentro de los 15 minutos posteriores a la hora agendada.",
            "danger"
          )
        ) : null}
        {req.refundReason ? renderTextBox(`Motivo de devolución: ${req.refundReason}`, "warning") : null}
        {req.scheduledAt ? <div style={styles.subtle}>Fecha propuesta/agendada: {fmtDate(req.scheduledAt)}</div> : null}
        {req.createdAt ? <div style={styles.subtle}>Solicitado: {fmtDate(req.createdAt)}</div> : null}

        {canAccept || canReject || canSchedule || canPrepare ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canAccept ? (
              <button type="button" onClick={() => handleCreatorAccept(row.id, row.serviceKind)} disabled={busy} style={{ ...styles.buttonPrimary, opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "Procesando..." : "Aceptar"}
              </button>
            ) : null}

            {canReject ? (
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !rejectOpenMap[row.id];
                  closeInlinePanels(row.id, "reject");
                  setRejectOpenMap((prev) => ({ ...prev, [row.id]: nextOpen }));
                }}
                disabled={busy}
                style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}
              >
                Rechazar
              </button>
            ) : null}

            {canSchedule ? (
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !scheduleOpenMap[row.id];
                  closeInlinePanels(row.id, "schedule");
                  setScheduleOpenMap((prev) => ({ ...prev, [row.id]: nextOpen }));
                }}
                disabled={busy}
                style={{ ...styles.buttonSecondary, opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer" }}
              >
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
              value={scheduleNoteMap[row.id] ?? getCreatorScheduleNote(req) ?? ""}
              onChange={(e) => setScheduleNoteMap((prev) => ({ ...prev, [row.id]: e.target.value }))}
              placeholder="Mensaje o instrucciones para el comprador sobre esta fecha."
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
      </CleanServiceCard>
    );
  }

  function renderDisplayRow(row: DisplayRow) {
    if (row.rowType === "buyer_greeting") {
      return renderBuyerGreetingCard(row.row, row.id);
    }

    if (row.rowType === "buyer_scheduled") {
      return renderBuyerScheduledServiceCard(row.row, row.id);
    }

    return renderIncomingScheduledServiceCard(row.row, row.id);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <SectionHeading>Mis servicios</SectionHeading>

      <SectionBlock
        sectionKey="requested"
        count={requestedRows.length}
        open={openSectionKey === "requested"}
        onToggle={() => toggleSection("requested")}
        styles={styles}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8 }}>
          {requestedRows.map(renderDisplayRow)}
        </div>
      </SectionBlock>

      <SectionBlock
        sectionKey="rejected"
        count={rejectedRows.length}
        open={openSectionKey === "rejected"}
        onToggle={() => toggleSection("rejected")}
        styles={styles}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8 }}>
          {rejectedRows.map(renderDisplayRow)}
        </div>
      </SectionBlock>

      <SectionBlock
        sectionKey="refund"
        count={refundRows.length}
        open={openSectionKey === "refund"}
        onToggle={() => toggleSection("refund")}
        styles={styles}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8 }}>
          {refundRows.map(renderDisplayRow)}
        </div>
      </SectionBlock>
    </div>
  );
}
