"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import {
  acceptMeetGreetRequest,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  requestMeetGreetRefund,
  requestMeetGreetReschedule,
  declineMeetGreetReschedule,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  acceptExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  rejectExclusiveSessionRequest,
  requestExclusiveSessionRefund,
  requestExclusiveSessionReschedule,
  declineExclusiveSessionReschedule,
  setExclusiveSessionPreparing,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { type Timestamp } from "firebase/firestore";
import { callGetRecordingDownloadUrl } from "@/lib/liveKit/sessionLifecycle";
import type {
  GroupDocLite,
  GreetingRequestDoc,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
  UserMini,
} from "./OwnerSidebar";
import { Chevron } from "./OwnerSidebar";
import BuyerGreetingRequestOverlay from "./BuyerGreetingRequestOverlay";
import BuyerSessionRequestOverlay from "./BuyerSessionRequestOverlay";
import SessionRequestOverlay from "./SessionRequestOverlay";
import GreetingReviewOverlay from "./GreetingReviewOverlay";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";
import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "@/app/(protected)/wallet/components/ScheduleDateTimeSelector";
import ScheduleCalendarOverlay from "@/app/(protected)/wallet/components/ScheduleCalendarOverlay";
import { WalletServiceRow } from "@/app/(protected)/wallet/components/WalletUi";
import {
  getWalletScheduleConflictResult,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";

type ScheduledServiceKind = "meet_greet" | "exclusive_session";

type ScheduledRow = {
  id: string;
  data: MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
  serviceKind: ScheduledServiceKind;
  groupId?: string | null;
};

type Props = {
  buyerPending: Array<{ id: string; data: GreetingRequestDoc }>;
  buyerDelivered: Array<{ id: string; data: GreetingRequestDoc }>;
  buyerRejectedGreetings: Array<{ id: string; data: GreetingRequestDoc }>;
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
  userMiniMap: Record<string, UserMini>;
  styles: Record<string, React.CSSProperties>;
  typeLabel: (t: string) => string;
  fmtDate: (ts?: Timestamp | null) => string;
  renderUserLink: (uid: string) => React.ReactNode;
  router: { push: (href: string) => void };
};

type BusyMap = Record<string, boolean>;
type TextMap = Record<string, string>;
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

function getServiceCardColors(type: string): { bg: string; expandedBg: string; expandedBorder: string; btnBg: string; btnColor: string } {
  if (type === "consejo") {
    return { bg: "rgba(250,204,21,0.14)", expandedBg: "rgba(250,204,21,0.08)", expandedBorder: "rgba(250,204,21,0.18)", btnBg: "rgba(250,204,21,0.18)", btnColor: "#fde047" };
  }
  if (type === "mensaje" || type === "meet_greet" || type === "meet_greet_digital") {
    return { bg: "rgba(96,165,250,0.14)", expandedBg: "rgba(96,165,250,0.08)", expandedBorder: "rgba(96,165,250,0.18)", btnBg: "rgba(96,165,250,0.18)", btnColor: "#93c5fd" };
  }
  if (type === "exclusive_session" || type === "digital_exclusive_session" || type === "clase_personalizada") {
    return { bg: "rgba(244,114,182,0.14)", expandedBg: "rgba(244,114,182,0.08)", expandedBorder: "rgba(244,114,182,0.18)", btnBg: "rgba(244,114,182,0.18)", btnColor: "#f9a8d4" };
  }
  return { bg: "rgba(90,41,174,0.14)", expandedBg: "rgba(90,41,174,0.08)", expandedBorder: "rgba(90,41,174,0.18)", btnBg: "rgba(168,85,255,0.18)", btnColor: "#d8b4fe" };
}

// Imagen de fondo del saludo según su tipo (mensaje no tiene imagen propia).
function greetingBgImage(type: string): string | null {
  if (type === "saludo") return "/saludo.png";
  if (type === "consejo") return "/consejo.png";
  return null;
}

// Fondo con la portada del servicio + degradado para legibilidad; si no hay
// imagen, usa el color sólido de respaldo.
function serviceCardBackground(image: string | null, fallback: string): string {
  return image
    ? `linear-gradient(90deg, rgba(0,0,0,0.88), rgba(0,0,0,0.72)), center / cover no-repeat url("${image}")`
    : fallback;
}

// Estilo de fondo de card; con `muted` desatura la propia imagen (tonos
// grisáceos) vía background-blend-mode "saturation", sin teñir texto/avatar.
function serviceCardBackgroundStyle(image: string | null, fallback: string, muted = false): React.CSSProperties {
  if (!image) return { background: fallback };
  const dark = "linear-gradient(90deg, rgba(0,0,0,0.88), rgba(0,0,0,0.72))";
  if (!muted) {
    return { background: `${dark}, center / cover no-repeat url("${image}")` };
  }
  return {
    backgroundImage: `${dark}, linear-gradient(rgba(125,125,125,0.78), rgba(125,125,125,0.78)), url("${image}")`,
    backgroundBlendMode: "normal, saturation, normal",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

// Fecha agendada en dos líneas (mismo formato que el overlay de detalles).
function fmtScheduledSplit(ts: unknown): { dayTime: string; dateStr: string } | null {
  const d = toDateSafe(ts);
  if (!d) return null;
  const weekday = d.toLocaleString("es-MX", { weekday: "long" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("es-MX", { month: "long" });
  const year = d.getFullYear();
  return {
    dayTime: `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${hh}:${mm} hrs`,
    dateStr: `${day} de ${month.charAt(0).toUpperCase() + month.slice(1)} de ${year}`,
  };
}

// Contador regresivo en vivo hacia una fecha objetivo, como frase.
function ScheduledCountdown({ target }: { target: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = target.getTime() - now;
  if (diff <= 0) return null;
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hh = String(Math.floor((totalSec % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const dayLabel = days === 1 ? "día" : "días";
  return (
    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 500, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
      {`Faltan ${days} ${dayLabel} con ${hh}:${mm}:${ss} horas`}
    </div>
  );
}

function isProfileRequest(req: {
  source?: string | null;
  requestSource?: string | null;
  groupId?: string | null;
  profileUserId?: string | null;
}) {
  return (
    req.source === "profile" ||
    req.requestSource === "profile" ||
    !!req.profileUserId ||
    !req.groupId
  );
}

function getMeetGreetStatusLabel(status?: string | null, t?: (key: string) => string): string {
  if (!status) return t ? t("statusUnknown") : "Estado desconocido";
  const map: Record<string, string> = {
    pending_creator_response: "statusPendingResponse",
    accepted_pending_schedule: "statusAcceptedPendingSchedule",
    scheduled: "statusScheduled",
    reschedule_requested: "statusRescheduleRequested",
    rejected: "statusRejected",
    refund_requested: "statusRefundRequested",
    refund_review: "statusRefundReview",
    ready_to_prepare: "statusReadyToPrepare",
    in_preparation: "statusInPreparation",
    completed: "statusCompleted",
    cancelled: "statusCancelled",
    session_incomplete: "statusSessionIncomplete",
    auto_rejected_no_show: "statusRejected",
  };
  const key = map[status];
  if (key && t) return t(key);
  // fallback strings (for when t is not provided)
  if (status === "pending_creator_response") return "En espera de aceptación";
  if (status === "accepted_pending_schedule") return "Aceptado, pendiente de fecha";
  if (status === "scheduled") return "Agendado";
  if (status === "reschedule_requested") return "Cambio de fecha solicitado";
  if (status === "rejected" || status === "auto_rejected_no_show") return "Rechazado";
  if (status === "refund_requested" || status === "refund_review") return "En proceso de devolución";
  if (status === "ready_to_prepare") return "Ya casi inicia";
  if (status === "in_preparation") return "En preparación";
  if (status === "completed") return "Completado";
  if (status === "cancelled") return "Cancelado";
  if (status === "session_incomplete") return "Sesión corta";
  return status || (t ? t("statusUnknown") : "Estado desconocido");
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

  if (status === "rejected" || status === "cancelled" || status === "auto_rejected_no_show") {
    return {
      border: "1px solid rgba(248,113,113,0.28)",
      background: "rgba(248,113,113,0.14)",
      color: "#fca5a5",
    };
  }

  if (status === "session_incomplete") {
    return {
      border: "1px solid rgba(250,204,21,0.26)",
      background: "rgba(250,204,21,0.12)",
      color: "#fde047",
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

function getRelativeTime(
  ts: { toDate: () => Date } | null | undefined,
  t: (key: string, params?: Record<string, number>) => string
): string {
  if (!ts) return t("relativeTimeNow");
  const diffMs = Date.now() - ts.toDate().getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return t("relativeTimeDays", { count: diffDays });
  if (diffHours >= 1) return t("relativeTimeHours", { count: diffHours });
  if (diffMins >= 1) return t("relativeTimeMinutes", { count: diffMins });
  return t("relativeTimeNow");
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

  return diff > 0 && diff <= 15 * 60 * 1000;
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

// Fecha en que la experiencia se resolvió (rechazo/finalización): usamos
// updatedAt (momento del cambio de estado); caemos en createdAt/scheduledAt.
function getResolvedDate(row: DisplayRow): Date | null {
  if (row.rowType === "buyer_greeting") {
    return toDateSafe(row.row.data.updatedAt) ?? toDateSafe(row.row.data.createdAt);
  }
  const data = row.row.data;
  return (
    toDateSafe(data.updatedAt) ??
    toDateSafe(data.createdAt) ??
    toDateSafe(data.scheduledAt)
  );
}

// Orden descendente por fecha de resolución (más nuevo arriba).
function sortResolvedDesc(a: DisplayRow, b: DisplayRow): number {
  return (getResolvedDate(b)?.getTime() ?? 0) - (getResolvedDate(a)?.getTime() ?? 0);
}

function remainingReschedules(req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc): number {
  const used =
    typeof req.rescheduleRequestsUsed === "number"
      ? req.rescheduleRequestsUsed
      : 0;

  return Math.max(0, 2 - used);
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
  const note = req.creatorScheduleNote;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

function getSectionForMeetGreetStatus(status: string): ServiceSectionKey {
  if (status === "rejected" || status === "cancelled" || status === "refund_requested" || status === "refund_review") return "rejected";
  return "requested";
}

// Distingue, dentro de la sección de rechazados, los que están en devolución.
function isRefundStatus(status: string): boolean {
  return status === "refund_requested" || status === "refund_review";
}

// Status de una fila (cualquier variante de DisplayRow).
function displayRowStatus(row: DisplayRow): string {
  return row.row.data.status;
}

function getSectionVisual(key: ServiceSectionKey): {
  icon: ReactNode;
  title: string;
  countTone: React.CSSProperties;
  containerStyle?: React.CSSProperties;
} {
  if (key === "rejected") {
    return {
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M8 8L16 16" />
          <path d="M16 8L8 16" />
        </svg>
      ),
      title: "Experiencias rechazadas",
      countTone: { color: "#f43f5e" },
      containerStyle: {
        background: "#ef4444",
        border: "none",
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
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 7.5V12.5" />
        <path d="M12 12.5L15.2 14.3" />
      </svg>
    ),
    title: "Pendientes",
    countTone: {
      color: "#f43f5e",
    },
    containerStyle: {
      background: "#7c3aed",
      border: "none",
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
        background: "rgba(90,41,174,0.14)",
        border: "none",
        borderRadius: 12,
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

      <div
        style={{
          maxHeight: expanded ? "600px" : "0",
          overflow: "hidden",
          opacity: expanded ? 1 : 0,
          transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
        }}
      >
        <div
          id={`service-details-${id}`}
          className="mini-vertical-scroll"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: 10,
            display: "grid",
            gap: 8,
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {children}
        </div>
      </div>
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
  const tWallet = useTranslations("wallet");
  const visual = getSectionVisual(sectionKey);
  const sectionTitle =
    sectionKey === "rejected"
      ? tWallet("sectionRejected")
      : sectionKey === "refund"
        ? tWallet("sectionRefund")
        : tWallet("sectionPending");

  if (count <= 0) return null;

  return (
    <div
      style={{
        ...styles.card,
        margin: 0,
        padding: "7px 10px",
        borderRadius: 14,
        background: sectionKey === "rejected" || sectionKey === "requested"
          ? "transparent"
          : open
            ? "linear-gradient(90deg, rgba(236,72,153,0.20) 0%, rgba(147,51,234,0.18) 42%, rgba(59,130,246,0.14) 100%)"
            : "rgba(0,0,0,0.96)",
        border: "none",
        boxShadow: sectionKey === "rejected" || sectionKey === "requested"
          ? "none"
          : open
            ? "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 24px rgba(0,0,0,0.22)"
            : "none",
        transition: "background 0.25s ease, box-shadow 0.25s ease",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          minHeight: 34,
          border: "none",
          background: "transparent",
          color: "#fff",
          cursor: "pointer",
          padding: "0 6px 0 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              ...visual.containerStyle,
            }}
          >
            {visual.icon}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              lineHeight: 1.2,
              minWidth: 0,
            }}
          >
            {sectionTitle}
          </span>
        </span>

        <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{count}</span>
      </button>

      <div
        style={{
          maxHeight: open ? "1200px" : "0",
          overflow: "hidden",
          opacity: open ? 1 : 0,
          transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
        }}
      >
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "grid",
            gap: 8,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default function OwnerSidebarGreetings({
  buyerPending,
  buyerDelivered,
  buyerRejectedGreetings,
  buyerMeetGreets,
  buyerExclusiveSessions,
  meetGreetsByGroup,
  exclusiveSessionsByGroup,
  groupMetaMap,
  userMiniMap,
  styles,
  fmtDate,
  renderUserLink,
  router,
}: Props) {
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const tGroups = useTranslations("groups");
  const tSessions = useTranslations("sessions");
  const tWallet = useTranslations("wallet");
  const { format: formatMoney } = usePriceFormat();
  const [busyMap, setBusyMap] = useState<BusyMap>({});
  const [errorMap, setErrorMap] = useState<TextMap>({});
  const [successMap, setSuccessMap] = useState<TextMap>({});
  const { toast: greetingsToast, showToast: showGreetingsToast } = useVibraToast();
  const [viewItem, setViewItem] = useState<{ item: { id: string; data: GreetingRequestDoc }; sourceName: string; sourceAvatar: string | null } | null>(null);
  const [viewDeliveredItem, setViewDeliveredItem] = useState<{ item: { id: string; data: GreetingRequestDoc }; sourceName: string; sourceAvatar: string | null } | null>(null);
  const [viewSessionItem, setViewSessionItem] = useState<{ row: ScheduledRow; creatorName: string; creatorAvatar: string | null } | null>(null);
  const [incomingSessionOverlayData, setIncomingSessionOverlayData] = useState<{
    id: string;
    req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
    serviceKind: ScheduledServiceKind;
  } | null>(null);
  const [incomingSessionOverlayOpen, setIncomingSessionOverlayOpen] = useState(false);
  const [openSectionKey, setOpenSectionKey] = useState<ServiceSectionKey | null>(null);
  const [deliveredSectionOpen, setDeliveredSectionOpen] = useState(false);
  // Submenú de entregados abierto: solo uno a la vez ("sessions" | "greetings" | null).
  const [deliveredSubOpen, setDeliveredSubOpen] = useState<"sessions" | "greetings" | null>(null);
  // Submenú de rechazados abierto: solo uno a la vez ("rejected" | "refund" | null).
  const [rejectedSubOpen, setRejectedSubOpen] = useState<"rejected" | "refund" | null>(null);
  const [pendingVisibleCount, setPendingVisibleCount] = useState(6);
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
  const [calendarOpenMap, setCalendarOpenMap] = useState<ToggleMap>({});
  const [schedulePartsMap, setSchedulePartsMap] = useState<Record<string, ScheduleParts>>({});
  const [deliveredScheduledSectionOpen, setDeliveredScheduledSectionOpen] = useState(false);
  const [downloadBusyMap, setDownloadBusyMap] = useState<Record<string, boolean>>({});
  const [downloadErrorMap, setDownloadErrorMap] = useState<Record<string, string | null>>({});


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



  const completedBuyerScheduledRows = useMemo<ScheduledRow[]>(() => {
    return buyerScheduledServices.filter((row) => row.data.status === "completed");
  }, [buyerScheduledServices]);

  // Sesiones/encuentros entregados, del más nuevo al más viejo.
  const deliveredSessions = useMemo(() => {
    const ts = (r: ScheduledRow) =>
      (toDateSafe(r.data.updatedAt) ??
        toDateSafe(r.data.scheduledAt) ??
        toDateSafe(r.data.createdAt))?.getTime() ?? 0;
    return [...completedBuyerScheduledRows].sort((a, b) => ts(b) - ts(a));
  }, [completedBuyerScheduledRows]);

  // Saludos/consejos entregados, del más nuevo al más viejo.
  const deliveredGreetings = useMemo(() => {
    const ts = (r: { data: GreetingRequestDoc }) =>
      (toDateSafe(r.data.deliveredAt) ??
        toDateSafe(r.data.updatedAt) ??
        toDateSafe(r.data.createdAt))?.getTime() ?? 0;
    return [...buyerDelivered].sort((a, b) => ts(b) - ts(a));
  }, [buyerDelivered]);

  // Estilo del encabezado de cada submenú de entregados.
  const submenuHeaderStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    border: "none",
    background: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    color: "#fff",
    cursor: "pointer",
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    textAlign: "left",
  };

  const requestedRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [
      ...buyerPending.map((row) => ({ rowType: "buyer_greeting" as const, id: `buyer-greeting-${row.id}`, row })),
      ...buyerScheduledServices
        .filter((row) => row.data.status !== "completed" && getSectionForMeetGreetStatus(row.data.status) === "requested")
        .map((row) => ({ rowType: "buyer_scheduled" as const, id: `buyer-${row.serviceKind}-${row.id}`, row })),
      ...incomingScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "requested")
        .map((row) => ({ rowType: "incoming_scheduled" as const, id: `incoming-${row.serviceKind}-${row.id}`, row })),
    ];

    return rows.sort(sortDisplayRows);
  }, [buyerPending, buyerScheduledServices, incomingScheduledServices]);

  const rejectedRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [
      ...buyerRejectedGreetings.map((row) => ({ rowType: "buyer_greeting" as const, id: `buyer-greeting-rejected-${row.id}`, row })),
      ...buyerScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected")
        .map((row) => ({ rowType: "buyer_scheduled" as const, id: `buyer-${row.serviceKind}-${row.id}`, row })),
      ...incomingScheduledServices
        .filter((row) => getSectionForMeetGreetStatus(row.data.status) === "rejected")
        .map((row) => ({ rowType: "incoming_scheduled" as const, id: `incoming-${row.serviceKind}-${row.id}`, row })),
    ];

    return rows.sort(sortResolvedDesc);
  }, [buyerRejectedGreetings, buyerScheduledServices, incomingScheduledServices]);

  // Submenús de rechazados: rechazados "puros" y los que están en devolución.
  const rejectedOnlyRows = useMemo(
    () => rejectedRows.filter((r) => !isRefundStatus(displayRowStatus(r))),
    [rejectedRows]
  );
  const refundOnlyRows = useMemo(
    () => rejectedRows.filter((r) => isRefundStatus(displayRowStatus(r))),
    [rejectedRows]
  );

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
    setDeliveredSectionOpen(false);
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
      showGreetingsToast(tServices("successRequestAccepted"));
      closeInlinePanels(requestId, "schedule");
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: true }));
      setOpenItemKey(`incoming-${kind}-${requestId}`);
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorAcceptRequest"), "error");
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

      showGreetingsToast(tServices("successRequestRejected"));
      setRejectOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorRejectRequest"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorRejectDirect(requestId: string, kind: ScheduledServiceKind, reason: string | null) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);
    try {
      if (kind === "exclusive_session") {
        await rejectExclusiveSessionRequest({ requestId, rejectionReason: reason });
      } else {
        await rejectMeetGreetRequest({ requestId, rejectionReason: reason });
      }
      showGreetingsToast(tServices("successRequestRejected"));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorRejectRequest"), "error");
      throw e;
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorScheduleDirect(requestId: string, kind: ScheduledServiceKind, scheduledAtIso: string | null, note: string | null) {
    if (!scheduledAtIso) {
      setError(requestId, tServices("selectDateTimeError"));
      return;
    }
    const selectedDate = new Date(scheduledAtIso);
    const conflict = getWalletScheduleConflictResult(
      { id: requestId, source: kind, scheduledAt: selectedDate, durationMinutes: kind === "exclusive_session" ? 60 : 30 },
      buildCalendarItems
    );
    if (conflict.hasConflict) {
      setError(requestId, conflict.message ?? tServices("scheduleConflictError"));
      return;
    }
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const payload = { requestId, scheduledAt: scheduledAtIso, note, creatorTimezone };
      if (kind === "exclusive_session") {
        await proposeExclusiveSessionSchedule(payload);
      } else {
        await proposeMeetGreetSchedule(payload);
      }
      showGreetingsToast(tServices("successDateProposed"));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorSaveDate"), "error");
      throw e;
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorAcceptAndSchedule(requestId: string, kind: ScheduledServiceKind, scheduledAtIso: string | null, note: string | null) {
    if (!scheduledAtIso) {
      setError(requestId, tServices("selectDateTimeError"));
      return;
    }
    const selectedDate = new Date(scheduledAtIso);
    const conflict = getWalletScheduleConflictResult(
      { id: requestId, source: kind, scheduledAt: selectedDate, durationMinutes: kind === "exclusive_session" ? 60 : 30 },
      buildCalendarItems
    );
    if (conflict.hasConflict) {
      setError(requestId, conflict.message ?? tServices("scheduleConflictError"));
      return;
    }
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (kind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId });
        await proposeExclusiveSessionSchedule({ requestId, scheduledAt: scheduledAtIso, note, creatorTimezone });
      } else {
        await acceptMeetGreetRequest({ requestId });
        await proposeMeetGreetSchedule({ requestId, scheduledAt: scheduledAtIso, note, creatorTimezone });
      }
      showGreetingsToast(tServices("successSessionAcceptedAndScheduled"));
      setIncomingSessionOverlayOpen(false);
      setTimeout(() => setIncomingSessionOverlayData(null), 300);
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorScheduleSession"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

async function handleCreatorSchedule(
  requestId: string,
  kind: ScheduledServiceKind
) {
  const parts = schedulePartsMap[requestId];
  const scheduledAt = parts ? schedulePartsToIso(parts) : null;

  if (!scheduledAt) {
    setError(requestId, tServices("selectDateTimeError"));
    return;
  }

  const selectedScheduleDate = new Date(scheduledAt);

  const scheduleConflict = getWalletScheduleConflictResult(
    {
      id: requestId,
      source: kind,
      scheduledAt: selectedScheduleDate,
      durationMinutes: kind === "exclusive_session" ? 60 : 30,
    },
    buildCalendarItems
  );

  if (scheduleConflict.hasConflict) {
    setError(
      requestId,
      scheduleConflict.message ?? tServices("scheduleConflictError")
    );
    return;
  }

  setBusy(requestId, true);
  setError(requestId, null);
  setSuccess(requestId, null);

  try {
    const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const payload = {
      requestId,
      scheduledAt,
      note: scheduleNoteMap[requestId] ?? null,
      creatorTimezone,
    };

    if (kind === "exclusive_session") {
      await proposeExclusiveSessionSchedule(payload);
    } else {
      await proposeMeetGreetSchedule(payload);
    }

    showGreetingsToast(tServices("successDateProposed"));
    setScheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    setCalendarOpenMap((prev) => ({ ...prev, [requestId]: false }));
  } catch (e: unknown) {
    showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorSaveDate"), "error");
  } finally {
    setBusy(requestId, false);
  }
}

  async function handleBuyerRefund(requestId: string, kind: ScheduledServiceKind, reasonOverride?: string) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        refundReason: reasonOverride !== undefined ? reasonOverride : (refundReasonMap[requestId] ?? null),
      };

      if (kind === "exclusive_session") {
        await requestExclusiveSessionRefund(payload);
      } else {
        await requestMeetGreetRefund(payload);
      }

      showGreetingsToast(tServices("successRefundRequested"));
      setRefundOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorRequestRefund"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleBuyerReschedule(requestId: string, kind: ScheduledServiceKind, reason?: string | null) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        reason: reason ?? rescheduleReasonMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await requestExclusiveSessionReschedule(payload);
      } else {
        await requestMeetGreetReschedule(payload);
      }

      showGreetingsToast(tServices("successRescheduleRequested"));
      setRescheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorRequestReschedule"), "error");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleKeepSchedule(requestId: string, kind: ScheduledServiceKind) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);
    try {
      if (kind === "exclusive_session") {
        await declineExclusiveSessionReschedule({ requestId });
      } else {
        await declineMeetGreetReschedule(requestId);
      }
    } catch (e: unknown) {
      showGreetingsToast((e instanceof Error ? e.message : null) ?? tServices("errorProcess"), "error");
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
      setSuccess(requestId, tServices("successPreparationOpened"));
    } catch (e: unknown) {
      setError(requestId, (e instanceof Error ? e.message : null) ?? tServices("errorOpenPreparation"));
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
        sessionId={requestId}
        sessionType={req.type === "digital_meet_greet" ? "meet_greet" : "exclusive_session"}
        scheduledAtLabel={req.scheduledAt ? fmtDate(req.scheduledAt) : null}
        durationMinutes={req.durationMinutes ?? null}
      />
    );
  }

  function renderContextLink(
  group: GroupDocLite | null,
  req?: {
    source?: string | null;
    requestSource?: string | null;
    profileUserId?: string | null;
    profileUsername?: string | null;
    profileDisplayName?: string | null;
    creatorUsername?: string | null;
    creatorDisplayName?: string | null;
    groupId?: string | null;
  }
) {
  const baseStyle: React.CSSProperties = {
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
  };

  if (group) {
    return (
      <button
        type="button"
        onClick={() => router.push(`/groups/${group.id}`)}
        style={baseStyle}
      >
        {tServices("contextCommunity", { name: group.name ?? tServices("contextCommunityDefault") })}
      </button>
    );
  }

  if (req && isProfileRequest(req)) {
    const username = req.profileUsername ?? req.creatorUsername ?? null;
    const label =
      req.profileDisplayName ??
      req.creatorDisplayName ??
      tServices("contextProfileDefault");

    if (username) {
      return (
        <button
          type="button"
          onClick={() => router.push(`/u/${username}`)}
          style={baseStyle}
        >
          {tServices("contextProfile", { name: label })}
        </button>
      );
    }

    return (
      <span
        style={{
          ...baseStyle,
          cursor: "default",
          display: "inline-flex",
        }}
      >
        {tServices("contextProfile", { name: label })}
      </span>
    );
  }

  return null;
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
    const isProfile = req.source === "profile";
    const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
    const creator = userMiniMap[req.creatorId] ?? null;

    const sourceName = isProfile
      ? (req.profileDisplayName ?? creator?.displayName ?? tCommon("profile"))
      : (group?.name ?? tCommon("community"));
    const sourceAvatar = isProfile
      ? (creator?.photoURL ?? null)
      : (group?.avatarUrl ?? null);
    const sourceInitial = sourceName.charAt(0).toUpperCase();

    const relTime = req.createdAt ? getRelativeTime(req.createdAt as { toDate: () => Date }, tCommon) : null;
    const cardColors = getServiceCardColors(req.type);
    const bgImage = greetingBgImage(req.type);

    return (
      <div
        key={itemKey}
        style={{
          ...styles.miniItem,
          ...serviceCardBackgroundStyle(bgImage, cardColors.bg, getSectionForMeetGreetStatus(req.status) === "rejected"),
          border: "none",
          borderRadius: 12,
          overflow: "hidden",
          padding: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {sourceAvatar ? (
          <Image
            src={sourceAvatar}
            alt={sourceName}
            width={36} height={36}
            style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
          />
        ) : (
          <div style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 14, color: "#fff",
          }}>
            {sourceInitial}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sourceName}
          </div>
          {(req.status === "rejected" || req.status === "refund_requested" || req.status === "refund_review" || relTime) && (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
              {req.status === "rejected" ? tSessions("statusRejected") : (req.status === "refund_requested" || req.status === "refund_review") ? tServices("statusRefundInProgress") : relTime}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setViewItem({ item: row, sourceName, sourceAvatar })}
          style={{
            flexShrink: 0,
            height: 28,
            padding: "0 12px",
            borderRadius: 8,
            border: "none",
            background: cardColors.btnBg,
            color: cardColors.btnColor,
            fontWeight: 600,
            fontSize: 11,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {tServices("viewRequest")}
        </button>
      </div>
    );
  }

  function renderBuyerScheduledServiceCard(row: ScheduledRow, itemKey: string) {
    const req = row.data;
    const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
    const busy = !!busyMap[row.id];
    const isExclusiveSession = row.serviceKind === "exclusive_session";
    const serviceType = isExclusiveSession ? "digital_exclusive_session" : "meet_greet_digital";
    const serviceTitle = isExclusiveSession ? tServices("exclusiveSession") : tSessions("meetGreetTitle");
    const noShowExpired = isNoShowExpired(req.scheduledAt);
    const canRequestRefund = req.status === "rejected" && req.paymentStatus !== "refunded";
    const canRetry =
      req.status === "rejected" &&
      (!!group?.id || !!req.profileUsername || !!req.creatorUsername);
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

    if (req.status === "rejected") {
      const creator = userMiniMap[req.creatorId] ?? null;
      const creatorName = creator?.displayName ?? tCommon("creator");
      const creatorAvatar = creator?.photoURL ?? null;
      const creatorInitial = creatorName.charAt(0).toUpperCase();
      const relTime = req.createdAt ? getRelativeTime(req.createdAt as { toDate: () => Date }, tCommon) : null;
      const cardColors = getServiceCardColors(row.serviceKind);
      const bgImage = isExclusiveSession ? "/sesionexclusiva.png" : "/encuentroenvivo.png";

      return (
        <div
          key={itemKey}
          style={{
            ...styles.miniItem,
            ...serviceCardBackgroundStyle(bgImage, cardColors.bg, true),
            border: "none",
            borderRadius: 12,
            overflow: "hidden",
            padding: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {creatorAvatar ? (
            <Image
              src={creatorAvatar}
              alt={creatorName}
              width={36} height={36}
              style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
            />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 14, color: "#fff",
            }}>
              {creatorInitial}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {creatorName}
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
              {tSessions("statusRejected")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setViewSessionItem({ row, creatorName, creatorAvatar })}
            style={{
              flexShrink: 0,
              height: 28,
              padding: "0 12px",
              borderRadius: 8,
              border: "none",
              background: cardColors.btnBg,
              color: cardColors.btnColor,
              fontWeight: 600,
              fontSize: 11,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {tServices("viewRequest")}
          </button>
        </div>
      );
    }

    {
      const creator2 = userMiniMap[req.creatorId] ?? null;
      const creatorName2 = creator2?.displayName ?? tCommon("creator");
      const creatorAvatar2 = creator2?.photoURL ?? null;
      const creatorInitial2 = creatorName2.charAt(0).toUpperCase();
      const relTime2 = req.createdAt ? getRelativeTime(req.createdAt as { toDate: () => Date }, tCommon) : null;
      const cardColors2 = getServiceCardColors(row.serviceKind);
      const noShowExpired2 = isNoShowExpired(req.scheduledAt);
      const canPrepareCard =
        (req.status === "scheduled" || req.status === "ready_to_prepare" || req.status === "in_preparation") &&
        isPrepareWindowOpen(req.scheduledAt) &&
        !noShowExpired2;
      const isRefundCard = getSectionForMeetGreetStatus(req.status) === "rejected";
      const bgImage2 = isExclusiveSession ? "/sesionexclusiva.png" : "/encuentroenvivo.png";
      // Solo en pendientes (no devolución) y con fecha agendada existente.
      const scheduledDate2 = toDateSafe(req.scheduledAt);
      const showScheduled2 = !isRefundCard && !!scheduledDate2;
      const scheduledSplit2 = showScheduled2 ? fmtScheduledSplit(req.scheduledAt) : null;
      const priceColor2 = isExclusiveSession ? "#f9a8d4" : "#93c5fd";
      return (
        <div key={itemKey} style={{
          ...styles.miniItem,
          ...serviceCardBackgroundStyle(bgImage2, cardColors2.bg, isRefundCard),
          border: "none", borderRadius: 12, overflow: "hidden", padding: 10,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {creatorAvatar2 ? (
              <Image src={creatorAvatar2} alt={creatorName2} width={36} height={36}
                style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }} />
            ) : (
              <div style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 14, color: "#fff",
              }}>{creatorInitial2}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {creatorName2}
              </div>
              {(req.status === "rejected" || req.status === "refund_requested" || req.status === "refund_review" || relTime2) && (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
                  {req.status === "rejected" ? tSessions("statusRejected") : (req.status === "refund_requested" || req.status === "refund_review") ? tServices("statusRefundInProgress") : relTime2}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setViewSessionItem({ row, creatorName: creatorName2, creatorAvatar: creatorAvatar2 })}
              style={{
                flexShrink: 0, height: 28, padding: "0 12px", borderRadius: 8, border: "none",
                background: cardColors2.btnBg, color: cardColors2.btnColor,
                fontWeight: 600, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {canPrepareCard ? tServices("prepare") : tServices("viewDetails")}
            </button>
          </div>
          {showScheduled2 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              {scheduledDate2 && <ScheduledCountdown target={scheduledDate2} />}
              <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 8 }}>
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={priceColor2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{tServices("scheduledDateLabel")}</span>
                  {scheduledSplit2 ? (
                    <>
                      <span style={{ color: "#fff", fontSize: 12.5, fontWeight: 400, lineHeight: 1.25, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{scheduledSplit2.dayTime}</span>
                      <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 11.5, fontWeight: 400, lineHeight: 1.25, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{scheduledSplit2.dateStr}</span>
                    </>
                  ) : (
                    <span style={{ color: "#fff", fontSize: 12.5, fontWeight: 400, lineHeight: 1.25 }}>{tServices("noDateLabel")}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
  }

const buildCalendarItems = useMemo<WalletServiceItem[]>(() => {
  return incomingScheduledServices
    .filter((item) => !!item.data.scheduledAt)
    .map((item): WalletServiceItem => {
      const resolvedGroupId = item.groupId ?? item.data.groupId ?? "";
      const group = resolvedGroupId ? groupMetaMap[resolvedGroupId] ?? null : null;

      const scheduledAt = toDateSafe(item.data.scheduledAt);
      const createdAt = toDateSafe(item.data.createdAt);
      const updatedAt = toDateSafe(item.data.updatedAt);
      const isExclusive = item.serviceKind === "exclusive_session";

      const kind: WalletServiceItem["kind"] = isExclusive
        ? "exclusive_session"
        : "meet_greet";

      const source: WalletServiceItem["source"] = isExclusive
        ? "exclusive_session"
        : "meet_greet";

      const rawNoShowRole = item.data.noShowRole;
      const noShowRole: WalletServiceItem["noShowRole"] =
        rawNoShowRole === "buyer" ||
        rawNoShowRole === "creator" ||
        rawNoShowRole === "both"
          ? rawNoShowRole
          : null;

      return {
        id: item.id,
        kind,
        title: isExclusive ? tServices("exclusiveSession") : tSessions("meetGreetTitle"),
        groupId: resolvedGroupId,
        groupName: group?.name ?? null,
        buyerId: item.data.buyerId ?? "",
        buyerDisplayName: item.data.buyerDisplayName ?? null,
        buyerUsername: item.data.buyerUsername ?? null,
        buyerAvatarUrl: item.data.buyerAvatarUrl ?? null,
        sourceAvatarUrl: null,
        muxPlaybackId: null,
        videoDuration: null,
        deliveredAt: null,
        profileUserId: item.data.profileUserId ?? null,
        profileDisplayName: item.data.profileDisplayName ?? null,
        profileUsername: item.data.profileUsername ?? null,
        requestSource:
         (item.data.requestSource ?? item.data.source ?? null) as "group" | "profile" | null,
        noShowRole,

        targetName: null,
        requestText: item.data.buyerMessage ?? null,
        status: item.data.status,
        statusLabel: getMeetGreetStatusLabel(item.data.status, tSessions),
        description: item.data.buyerMessage ?? null,
        creatorScheduleNote: getCreatorScheduleNote(item.data),
        creatorScheduleNoteUpdatedAt: toDateSafe(
          item.data.creatorScheduleNoteUpdatedAt
        ),
        rejectionReason: item.data.rejectionReason ?? null,
        refundReason: item.data.refundReason ?? null,
        priceSnapshot:
          typeof item.data.priceSnapshot === "number"
            ? item.data.priceSnapshot
            : null,
        currency: item.data.currency === "USD" ? "USD" : "MXN",
        durationMinutes:
          typeof item.data.durationMinutes === "number"
            ? item.data.durationMinutes
            : null,
        source,
        scheduledAt,
        acceptedAt: toDateSafe(item.data.acceptedAt),
        rejectedAt: toDateSafe(item.data.rejectedAt),
        preparingBuyerAt: toDateSafe(item.data.preparingBuyerAt),
        preparingCreatorAt: toDateSafe(item.data.preparingCreatorAt),
        preparationOpenedAt: toDateSafe(item.data.preparationOpenedAt),
        noShowRejectAt: toDateSafe(item.data.noShowRejectAt),
        autoRejectedAt: toDateSafe(item.data.autoRejectedAt),
        autoRejectReason: item.data.autoRejectReason ?? null,
        createdAt,
        updatedAt,
        creatorScheduleCount: Array.isArray((item.data as { scheduleHistory?: unknown[] }).scheduleHistory) ? (item.data as { scheduleHistory: unknown[] }).scheduleHistory.length : 0,
        scheduleHistory: Array.isArray((item.data as { scheduleHistory?: unknown[] }).scheduleHistory) ? ((item.data as { scheduleHistory: unknown[] }).scheduleHistory as WalletServiceItem["scheduleHistory"]) : [],
        rescheduleHistory: Array.isArray((item.data as { rescheduleHistory?: unknown[] }).rescheduleHistory) ? ((item.data as { rescheduleHistory: unknown[] }).rescheduleHistory as WalletServiceItem["rescheduleHistory"]) : [],
        recordingStatus: null,
        recordingUrl: null,
        recordingDurationSeconds: null,
        recordingExpiresAt: null,
      };
      });
}, [incomingScheduledServices, groupMetaMap]);
  function renderIncomingScheduledServiceCard(row: ScheduledRow, itemKey: string) {
    const req = row.data;
    const isExclusiveSession = row.serviceKind === "exclusive_session";
    const serviceTitle = isExclusiveSession ? tServices("exclusiveSession") : tSessions("meetGreetTitle");
    const buyerName = req.buyerDisplayName ?? tCommon("buyer");
    const buyerAvatar = (req as MeetGreetRequestDoc).buyerAvatarUrl ?? null;
    const buyerInitial = buyerName.charAt(0).toUpperCase();
    const relTime = req.createdAt ? getRelativeTime(req.createdAt as { toDate: () => Date }, tCommon) : null;
    const cardColors = getServiceCardColors(row.serviceKind);
    const bgImage = isExclusiveSession ? "/sesionexclusiva.png" : "/encuentroenvivo.png";
    const muted = getSectionForMeetGreetStatus(req.status) === "rejected";

    return (
      <div
        key={itemKey}
        style={{
          ...styles.miniItem,
          ...serviceCardBackgroundStyle(bgImage, cardColors.bg, muted),
          border: "none",
          borderRadius: 12,
          overflow: "hidden",
          padding: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {buyerAvatar ? (
          <Image
            src={buyerAvatar}
            alt={buyerName}
            width={36} height={36}
            style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
          />
        ) : (
          <div style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 14, color: "#fff",
          }}>
            {buyerInitial}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {buyerName}
          </div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
            {serviceTitle}{relTime ? ` · ${relTime}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setIncomingSessionOverlayData({ id: row.id, req, serviceKind: row.serviceKind });
            setIncomingSessionOverlayOpen(true);
          }}
          style={{
            flexShrink: 0,
            height: 28,
            padding: "0 12px",
            borderRadius: 8,
            border: "none",
            background: cardColors.btnBg,
            color: cardColors.btnColor,
            fontWeight: 600,
            fontSize: 11,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {req.status === "reschedule_requested" ? tServices("reschedule") : tServices("viewDetails")}
        </button>
      </div>
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
    <>
    <div style={{ display: "grid", gap: 8 }}>
      <SectionHeading>{tGroups("myServices")}</SectionHeading>

      <SectionBlock
        sectionKey="requested"
        count={requestedRows.length}
        open={openSectionKey === "requested"}
        onToggle={() => toggleSection("requested")}
        styles={styles}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8, overflow: "hidden", minWidth: 0 }}>
          {requestedRows.slice(0, pendingVisibleCount).map(renderDisplayRow)}
          {requestedRows.length > pendingVisibleCount && (
            <button
              type="button"
              onClick={() => setPendingVisibleCount((v) => v + 6)}
              style={{
                width: "100%", height: 36, borderRadius: 8, border: "none",
                background: "rgba(168,85,255,0.18)", color: "#d8b4fe",
                fontWeight: 600, fontSize: 12, cursor: "pointer",
              }}
            >
              {tCommon("viewMore")}
            </button>
          )}
        </div>
      </SectionBlock>

      <SectionBlock
        sectionKey="rejected"
        count={rejectedRows.length}
        open={openSectionKey === "rejected"}
        onToggle={() => toggleSection("rejected")}
        styles={styles}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8, overflow: "hidden", minWidth: 0 }}>
          {/* Submenú: Rechazados */}
          {rejectedOnlyRows.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setRejectedSubOpen((v) => (v === "rejected" ? null : "rejected"))}
              aria-expanded={rejectedSubOpen === "rejected"}
              style={submenuHeaderStyle}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("rejectedGroup")}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{rejectedOnlyRows.length}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.25s ease", transform: rejectedSubOpen === "rejected" ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </span>
            </button>
            <div style={{ display: "grid", gridTemplateRows: rejectedSubOpen === "rejected" ? "1fr" : "0fr", opacity: rejectedSubOpen === "rejected" ? 1 : 0, transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease" }}>
              <div style={{ overflow: "hidden", minHeight: 0 }}>
                <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
                  {rejectedOnlyRows.map(renderDisplayRow)}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Submenú: En devolución */}
          {refundOnlyRows.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setRejectedSubOpen((v) => (v === "refund" ? null : "refund"))}
              aria-expanded={rejectedSubOpen === "refund"}
              style={submenuHeaderStyle}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("refundGroup")}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{refundOnlyRows.length}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.25s ease", transform: rejectedSubOpen === "refund" ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </span>
            </button>
            <div style={{ display: "grid", gridTemplateRows: rejectedSubOpen === "refund" ? "1fr" : "0fr", opacity: rejectedSubOpen === "refund" ? 1 : 0, transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease" }}>
              <div style={{ overflow: "hidden", minHeight: 0 }}>
                <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
                  {refundOnlyRows.map(renderDisplayRow)}
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      </SectionBlock>

      <SectionBlock
        sectionKey="refund"
        count={refundRows.length}
        open={openSectionKey === "refund"}
        onToggle={() => toggleSection("refund")}
        styles={styles}
      >
        <div className="mini-vertical-scroll" style={{ display: "grid", gap: 8, overflow: "hidden", minWidth: 0 }}>
          {refundRows.map(renderDisplayRow)}
        </div>
      </SectionBlock>

      {(buyerDelivered.length > 0 || completedBuyerScheduledRows.length > 0) && (
        <div
          style={{
            ...styles.card,
            margin: 0,
            padding: "7px 10px",
            borderRadius: 14,
            background: "transparent",
            border: "none",
            boxShadow: "none",
            transition: "background 0.25s ease, box-shadow 0.25s ease",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setDeliveredSectionOpen((v) => !v);
              setOpenSectionKey(null);
              setOpenItemKey(null);
            }}
            aria-expanded={deliveredSectionOpen}
            style={{
              width: "100%",
              minHeight: 34,
              border: "none",
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
              padding: "0 6px 0 0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "#22c55e",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12L10 17L19 8" />
                </svg>
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.2, minWidth: 0 }}>
                {tCommon("delivered")}
              </span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{buyerDelivered.length + completedBuyerScheduledRows.length}</span>
          </button>

          <div
            style={{
              display: "grid",
              gridTemplateRows: deliveredSectionOpen ? "1fr" : "0fr",
              opacity: deliveredSectionOpen ? 1 : 0,
              transition: "grid-template-rows 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
            }}
          >
            <div style={{ overflow: "hidden", minHeight: 0 }}>
            <div
              style={{
                marginTop: 9,
                paddingTop: 9,
                borderTop: "1px solid rgba(255,255,255,0.06)",
                display: "grid",
                gap: 8,
              }}
            >
              <style>{`
                .vb-dels-btn-desktop { display: flex; justify-content: center; }
                .vb-dels-btn-mobile { display: none; }
                @media (max-width: 900px) {
                  .vb-dels-btn-desktop { display: none; }
                  .vb-dels-btn-mobile { display: block; }
                }
              `}</style>

              {/* Submenú: Sesiones */}
              {deliveredSessions.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setDeliveredSubOpen((v) => (v === "sessions" ? null : "sessions"))}
                  aria-expanded={deliveredSubOpen === "sessions"}
                  style={submenuHeaderStyle}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("sessionsGroup")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{deliveredSessions.length}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.25s ease", transform: deliveredSubOpen === "sessions" ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </button>
                <div style={{ display: "grid", gridTemplateRows: deliveredSubOpen === "sessions" ? "1fr" : "0fr", opacity: deliveredSubOpen === "sessions" ? 1 : 0, transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease" }}>
                  <div style={{ overflow: "hidden", minHeight: 0 }}>
                    <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
              {deliveredSessions.map((row) => {
                const req = row.data;
                const isExclusive = row.serviceKind === "exclusive_session";
                const sessionType = isExclusive ? "exclusive_session" : "meet_greet";
                const creator = userMiniMap[req.creatorId] ?? null;
                const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
                const sourceName = req.profileDisplayName ?? creator?.displayName ?? (group?.name ?? tCommon("creator"));
                const sourceAvatar = creator?.photoURL ?? group?.avatarUrl ?? null;
                const sourceInitial = sourceName.charAt(0).toUpperCase();
                const completedTs = req.updatedAt as { toDate: () => Date } | undefined;
                const relTime = completedTs ? getRelativeTime(completedTs, tCommon) : null;
                const downloadBusy = !!downloadBusyMap[row.id];
                const downloadError = downloadErrorMap[row.id] ?? null;
                // Contador descendente 30 → 0 para descargar la grabación de la sesión.
                const dlRef = toDateSafe(req.scheduledAt);
                const dlElapsed = dlRef
                  ? Math.floor((Date.now() - dlRef.getTime()) / (1000 * 60 * 60 * 24))
                  : 0;
                const daysLeft = Math.max(0, 30 - dlElapsed);
                const canDownload = daysLeft > 0;
                const bgImage = isExclusive ? "/sesionexclusiva.png" : "/encuentroenvivo.png";

                const avatarNode = sourceAvatar ? (
                  <Image
                    src={sourceAvatar}
                    alt={sourceName}
                    width={36} height={36}
                    style={{ borderRadius: 999, objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
                  />
                ) : (
                  <div style={{
                    width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                    background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: 14, color: "#fff",
                  }}>
                    {sourceInitial}
                  </div>
                );

                const downloadButton = (
                  <button
                    type="button"
                    disabled={downloadBusy || !canDownload}
                    onClick={async () => {
                      setDownloadBusyMap((prev) => ({ ...prev, [row.id]: true }));
                      setDownloadErrorMap((prev) => ({ ...prev, [row.id]: null }));
                      try {
                        const url = await callGetRecordingDownloadUrl({ sessionId: row.id, sessionType });
                        window.location.href = url;
                      } catch {
                        setDownloadErrorMap((prev) => ({ ...prev, [row.id]: tCommon("generalError") }));
                      } finally {
                        setDownloadBusyMap((prev) => ({ ...prev, [row.id]: false }));
                      }
                    }}
                    style={{
                      flexShrink: 0,
                      height: 28,
                      padding: "0 12px",
                      borderRadius: 8,
                      border: "none",
                      background: canDownload
                        ? (isExclusive ? "rgba(244,114,182,0.18)" : "rgba(96,165,250,0.18)")
                        : "rgba(255,255,255,0.08)",
                      color: canDownload
                        ? (isExclusive ? "#f9a8d4" : "#93c5fd")
                        : "rgba(255,255,255,0.3)",
                      fontWeight: 600,
                      fontSize: 11,
                      cursor: !canDownload || downloadBusy ? "not-allowed" : "pointer",
                      opacity: downloadBusy ? 0.7 : 1,
                      whiteSpace: "nowrap",
                      fontFamily: "inherit",
                    }}
                  >
                    {downloadBusy ? tCommon("loading") : tServices("downloadSession")}
                  </button>
                );

                return (
                  <div
                    key={`completed-session-${row.id}`}
                    style={{
                      background: `linear-gradient(rgba(0,0,0,0.62), rgba(0,0,0,0.62)), center / cover no-repeat url("${bgImage}")`,
                      border: "none",
                      borderRadius: 12,
                      overflow: "hidden",
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {/* Fila superior: avatar + nombre/tiempo (+ botón en celular). */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {avatarNode}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                          {sourceName}
                        </div>
                        {relTime && (
                          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                            {relTime}
                          </div>
                        )}
                      </div>
                      {canDownload && (
                        <div className="vb-dels-btn-mobile" style={{ flexShrink: 0 }}>
                          {downloadButton}
                        </div>
                      )}
                    </div>

                    {/* Contador centrado. */}
                    {canDownload ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 1 }}>
                        <span style={{ color: "#fff", fontSize: 11, fontWeight: 500, textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
                          {tServices("downloadLeftPre", { days: daysLeft })}
                        </span>
                        <span style={{ color: "#fff", fontSize: 30, fontWeight: 600, lineHeight: 1.05, textShadow: "0 1px 5px rgba(0,0,0,0.9)" }}>
                          {daysLeft}
                        </span>
                        <span style={{ color: "#fff", fontSize: 11, fontWeight: 500, textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
                          {tServices("downloadLeftPost", { days: daysLeft })}
                        </span>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", color: "#fca5a5", fontSize: 12, fontWeight: 600, textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
                        {tServices("downloadExpired")}
                      </div>
                    )}

                    {/* Botón abajo de todo (laptop). */}
                    {canDownload && (
                      <div className="vb-dels-btn-desktop">
                        {downloadButton}
                      </div>
                    )}

                    {downloadError && (
                      <div style={{ fontSize: 10, color: "#fca5a5", textAlign: "center", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{downloadError}</div>
                    )}
                  </div>
                );
              })}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Submenú: Saludos y consejos */}
              {deliveredGreetings.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setDeliveredSubOpen((v) => (v === "greetings" ? null : "greetings"))}
                  aria-expanded={deliveredSubOpen === "greetings"}
                  style={submenuHeaderStyle}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{tServices("greetingsGroup")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{deliveredGreetings.length}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.25s ease", transform: deliveredSubOpen === "greetings" ? "rotate(180deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                </button>
                <div style={{ display: "grid", gridTemplateRows: deliveredSubOpen === "greetings" ? "1fr" : "0fr", opacity: deliveredSubOpen === "greetings" ? 1 : 0, transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease" }}>
                  <div style={{ overflow: "hidden", minHeight: 0 }}>
                    <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
              {deliveredGreetings.map((row) => {
                const req = row.data;
                const itemKey = `delivered-${row.id}`;
                const isProfile = req.source === "profile";
                const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
                const creator = userMiniMap[req.creatorId] ?? null;

                const sourceName = isProfile
                  ? (req.profileDisplayName ?? creator?.displayName ?? tCommon("profile"))
                  : (group?.name ?? tCommon("community"));
                const sourceAvatar = isProfile
                  ? (creator?.photoURL ?? null)
                  : (group?.avatarUrl ?? null);
                const sourceInitial = sourceName.charAt(0).toUpperCase();

                const deliveredTs = req.deliveredAt as { toDate: () => Date } | undefined;
                const relTime = deliveredTs ? getRelativeTime(deliveredTs, tCommon) : null;

                const btnLabel = req.type === "consejo" ? tServices("viewAdvice") : req.type === "mensaje" ? tServices("viewMessage") : tServices("viewGreeting");
                const bgImage = greetingBgImage(req.type);
                const cardColors = getServiceCardColors(req.type);

                return (
                  <div
                    key={itemKey}
                    style={{
                      ...styles.miniItem,
                      background: serviceCardBackground(bgImage, "rgba(90,41,174,0.14)"),
                      border: "none",
                      borderRadius: 12,
                      overflow: "hidden",
                      padding: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    {sourceAvatar ? (
                      <Image
                        src={sourceAvatar}
                        alt={sourceName}
                        width={36} height={36}
                        style={{ borderRadius: 999, objectFit: "cover", flexShrink: 0, border: "1px solid rgba(255,255,255,0.10)" }}
                      />
                    ) : (
                      <div style={{
                        width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                        background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: 14, color: "#fff",
                      }}>
                        {sourceInitial}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sourceName}
                      </div>
                      {relTime && (
                        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
                          {relTime}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewDeliveredItem({ item: row, sourceName, sourceAvatar })}
                      style={{
                        flexShrink: 0,
                        width: 112,
                        height: 28,
                        padding: "0 12px",
                        borderRadius: 8,
                        border: "none",
                        background: cardColors.btnBg,
                        color: cardColors.btnColor,
                        fontWeight: 600,
                        fontSize: 11,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {btnLabel}
                    </button>
                  </div>
                );
              })}
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
    {viewItem && (() => {
      const req = viewItem.item.data;
      const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
      return (
        <BuyerGreetingRequestOverlay
          item={viewItem.item}
          sourceName={viewItem.sourceName}
          sourceAvatar={viewItem.sourceAvatar}
          onClose={() => setViewItem(null)}
          onRetry={() => {
            setViewItem(null);
            const params = new URLSearchParams();
            params.set("service", req.type);
            params.set("retry", "true");
            if (req.toName) params.set("toName", req.toName);
            if (req.instructions) params.set("instructions", req.instructions);
            if (group?.id) { router.push(`/groups/${group.id}?${params.toString()}`); return; }
            const greetCreatorMini = userMiniMap[req.creatorId] ?? null;
            const username = req.profileUsername ?? greetCreatorMini?.handle ?? null;
            if (username) { router.push(`/u/${username}?${params.toString()}`); }
          }}
        />
      );
    })()}
    {viewDeliveredItem && (
      <GreetingReviewOverlay
        viewMode
        buyerViewMode
        buyerSourceName={viewDeliveredItem.sourceName}
        buyerSourceAvatar={viewDeliveredItem.sourceAvatar}
        items={[viewDeliveredItem.item]}
        buyers={{}}
        greetingBusyId={null}
        onReject={() => {}}
        onClose={() => setViewDeliveredItem(null)}
        getInitials={(name) => (name ?? "?").charAt(0).toUpperCase()}
        typeLabel={(t) => t === "consejo" ? tWallet("typeLabelAdvice") : t === "mensaje" ? tWallet("typeLabelMessage") : tWallet("typeLabelGreeting")}
      />
    )}
    {viewSessionItem && (() => {
      const { row, creatorName, creatorAvatar } = viewSessionItem;
      const req = row.data;
      const group = req.groupId ? groupMetaMap[req.groupId] ?? null : null;
      const canRequestRefund = req.status === "rejected" && req.paymentStatus !== "refunded";
      const creatorMini = userMiniMap[req.creatorId] ?? null;
      const canRetry =
        req.status === "rejected" &&
        (!!group?.id || !!req.profileUsername || !!req.creatorUsername || !!creatorMini?.handle);
      const noShowExpired = isNoShowExpired(req.scheduledAt);
      const canRequestRescheduleOverlay =
        (req.status === "scheduled" || req.status === "ready_to_prepare") &&
        remainingReschedules(req) > 0 &&
        !noShowExpired;
      const canPrepareOverlay =
        (req.status === "scheduled" || req.status === "ready_to_prepare" || req.status === "in_preparation") &&
        isPrepareWindowOpen(req.scheduledAt) &&
        !noShowExpired;
      return (
        <BuyerSessionRequestOverlay
          item={row}
          creatorName={creatorName}
          creatorAvatar={creatorAvatar}
          canRefund={canRequestRefund}
          canRetry={canRetry}
          canReschedule={canRequestRescheduleOverlay}
          canPrepare={canPrepareOverlay}
          busy={!!busyMap[row.id]}
          onClose={() => setViewSessionItem(null)}
          onPrepare={() => {
            handlePrepare(row.id, "buyer", row.serviceKind);
            setViewSessionItem(null);
          }}
          onRefund={(reason) => {
            setViewSessionItem(null);
            handleBuyerRefund(row.id, row.serviceKind, reason);
          }}
          onRetry={() => {
            setViewSessionItem(null);
            const serviceParam = row.serviceKind === "exclusive_session" ? "clase_personalizada" : "meet_greet_digital";
            const params = new URLSearchParams();
            params.set("service", serviceParam);
            params.set("retry", "true");
            if (req.buyerMessage) params.set("message", req.buyerMessage);
            if (group?.id) { router.push(`/groups/${group.id}?${params.toString()}`); return; }
            const username = req.profileUsername ?? req.creatorUsername ?? creatorMini?.handle ?? null;
            if (username) { router.push(`/u/${username}?${params.toString()}`); }
          }}
          onReschedule={(reason) => {
            setRescheduleReasonMap((prev) => ({ ...prev, [row.id]: reason }));
            handleBuyerReschedule(row.id, row.serviceKind, reason);
            setViewSessionItem(null);
          }}
        />
      );
    })()}
    {incomingSessionOverlayData && (
      <SessionRequestOverlay
        open={incomingSessionOverlayOpen}
        onClose={() => {
          setIncomingSessionOverlayOpen(false);
          setTimeout(() => setIncomingSessionOverlayData(null), 300);
        }}
        request={incomingSessionOverlayData.req}
        requestId={incomingSessionOverlayData.id}
        serviceKind={incomingSessionOverlayData.serviceKind}
        earning={
          incomingSessionOverlayData.req.priceSnapshot != null && incomingSessionOverlayData.req.priceSnapshot > 0
            ? formatMoney(incomingSessionOverlayData.req.priceSnapshot * 0.77, { code: true })
            : null
        }
        busy={!!busyMap[incomingSessionOverlayData.id]}
        feedbackError={errorMap[incomingSessionOverlayData.id] ?? null}
        feedbackSuccess={successMap[incomingSessionOverlayData.id] ?? null}
        ownerCalendarItems={buildCalendarItems}
        getInitials={(name) => name?.charAt(0).toUpperCase() ?? "?"}
        onAccept={() => handleCreatorAccept(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind)}
        onReject={(reason) => handleCreatorRejectDirect(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind, reason)}
        onSchedule={(scheduledAtIso, note) => handleCreatorScheduleDirect(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind, scheduledAtIso, note)}
        onAcceptAndSchedule={(scheduledAtIso, note) => handleCreatorAcceptAndSchedule(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind, scheduledAtIso, note)}
        onPrepare={() => handlePrepare(incomingSessionOverlayData.id, "creator", incomingSessionOverlayData.serviceKind)}
        preparationNode={renderPreparationPanel(incomingSessionOverlayData.id, incomingSessionOverlayData.req, "creator")}
        onKeepSchedule={() => handleKeepSchedule(incomingSessionOverlayData.id, incomingSessionOverlayData.serviceKind)}
      />
    )}
    <VibraToast toast={greetingsToast} />
    </>
  );
}
