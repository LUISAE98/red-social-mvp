"use client";

// Tipos, helpers y sub-componentes de OwnerSidebarGreetings (aislados).

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

export type ScheduledServiceKind = "meet_greet" | "exclusive_session";

export type ScheduledRow = {
  id: string;
  data: MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
  serviceKind: ScheduledServiceKind;
  groupId?: string | null;
};

export type Props = {
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
  /**
   * Si se pasa, muestra SOLO esa sección (forzada abierta) — para la página
   * /experiencias con subnav de pestañas. Si se omite, muestra todas apiladas
   * (comportamiento del sidebar). "rejected" incluye también la de devoluciones.
   */
  activeSection?: "requested" | "rejected" | "delivered";
};

export type BusyMap = Record<string, boolean>;
export type TextMap = Record<string, string>;
export type ToggleMap = Record<string, boolean>;
export type ServiceSectionKey = "requested" | "rejected" | "refund";

export type BuyerGreetingRow = {
  rowType: "buyer_greeting";
  id: string;
  row: { id: string; data: GreetingRequestDoc };
};

export type BuyerScheduledRow = {
  rowType: "buyer_scheduled";
  id: string;
  row: ScheduledRow;
};

export type IncomingScheduledRow = {
  rowType: "incoming_scheduled";
  id: string;
  row: ScheduledRow;
};

export type DisplayRow = BuyerGreetingRow | BuyerScheduledRow | IncomingScheduledRow;

export function getServiceEmoji(type: string): string {
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

export function getServiceCardColors(type: string): { bg: string; expandedBg: string; expandedBorder: string; btnBg: string; btnColor: string } {
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
export function greetingBgImage(type: string): string | null {
  if (type === "saludo") return "/saludo.webp";
  if (type === "consejo") return "/consejo.webp";
  return null;
}

// Fondo con la portada del servicio + degradado para legibilidad; si no hay
// imagen, usa el color sólido de respaldo.
export function serviceCardBackground(image: string | null, fallback: string): string {
  return image
    ? `linear-gradient(90deg, rgba(0,0,0,0.88), rgba(0,0,0,0.72)), center / cover no-repeat url("${image}")`
    : fallback;
}

// Estilo de fondo de card; con `muted` desatura la propia imagen (tonos
// grisáceos) vía background-blend-mode "saturation", sin teñir texto/avatar.
export function serviceCardBackgroundStyle(image: string | null, fallback: string, muted = false): React.CSSProperties {
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
export function fmtScheduledSplit(ts: unknown): { dayTime: string; dateStr: string } | null {
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

// Días que tiene el creador para responder una solicitud de saludo/consejo antes
// de que se marque como rechazada automáticamente. Debe coincidir con el backend
// (GREETING_RESPONSE_DAYS en greetingRequests.ts).
export const GREETING_RESPONSE_DAYS = 90;

// Días restantes (>= 0) para que el creador responda, contados desde createdAt.
export function greetingResponseDaysLeft(createdAt: unknown): number | null {
  const d = toDateSafe(createdAt);
  if (!d) return null;
  const ms = d.getTime() + GREETING_RESPONSE_DAYS * 86400000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

// Contador regresivo en vivo hacia una fecha objetivo, como frase.
export function ScheduledCountdown({ target }: { target: Date }) {
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

export function isProfileRequest(req: {
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

export function getMeetGreetStatusLabel(status?: string | null, t?: (key: string) => string): string {
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

export function getMeetGreetStatusStyle(status: string): React.CSSProperties {
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

export function toDateSafe(value: unknown): Date | null {
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

export function getRelativeTime(
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

export function isPrepareWindowOpen(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const startsAt = date.getTime();
  const prepareFrom = startsAt - 10 * 60 * 1000;

  return now >= prepareFrom;
}

export function isNoShowExpired(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;
  const rejectAt = date.getTime() + 15 * 60 * 1000;
  return Date.now() >= rejectAt;
}

export function isStartingSoon(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const diff = date.getTime() - now;

  return diff > 0 && diff <= 15 * 60 * 1000;
}

export function getSortDate(row: DisplayRow): Date | null {
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

export function sortDisplayRows(a: DisplayRow, b: DisplayRow): number {
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
export function getResolvedDate(row: DisplayRow): Date | null {
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
export function sortResolvedDesc(a: DisplayRow, b: DisplayRow): number {
  return (getResolvedDate(b)?.getTime() ?? 0) - (getResolvedDate(a)?.getTime() ?? 0);
}

export function remainingReschedules(req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc): number {
  const used =
    typeof req.rescheduleRequestsUsed === "number"
      ? req.rescheduleRequestsUsed
      : 0;

  return Math.max(0, 2 - used);
}

export function getRequestCurrency(req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc): string {
  const reqWithExtras = req as (MeetGreetRequestDoc | ExclusiveSessionRequestDoc) & {
    currency?: string | null;
    serviceSnapshot?: { currency?: string | null } | null;
  };

  return reqWithExtras.currency ?? reqWithExtras.serviceSnapshot?.currency ?? "MXN";
}

export function getCreatorScheduleNote(
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc
): string | null {
  const note = req.creatorScheduleNote;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

export function getSectionForMeetGreetStatus(status: string): ServiceSectionKey {
  if (status === "rejected" || status === "cancelled" || status === "refund_requested" || status === "refund_review") return "rejected";
  return "requested";
}

// Distingue, dentro de la sección de rechazados, los que están en devolución.
export function isRefundStatus(status: string): boolean {
  return status === "refund_requested" || status === "refund_review";
}

// Status de una fila (cualquier variante de DisplayRow).
export function displayRowStatus(row: DisplayRow): string {
  return row.row.data.status;
}

export function getSectionVisual(key: ServiceSectionKey): {
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

export function StatusPill({ children, style }: { children: ReactNode; style: React.CSSProperties }) {
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

export function CleanServiceCard({
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

export function SectionBlock({
  sectionKey,
  count,
  open,
  onToggle,
  children,
  styles,
  hideHeader = false,
}: {
  sectionKey: ServiceSectionKey;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  styles: Record<string, React.CSSProperties>;
  /** Oculta el encabezado (ícono + título + count) y deja el contenido siempre
   *  visible. Se usa en la página /experiencias, donde el subnav ya hace de título. */
  hideHeader?: boolean;
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
        ...(hideHeader ? { padding: 0, background: "transparent", boxShadow: "none" } : null),
      }}
    >
      {!hideHeader && (
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
      )}

      <div
        style={{
          maxHeight: hideHeader ? "none" : open ? "1200px" : "0",
          overflow: hideHeader ? "visible" : "hidden",
          opacity: hideHeader || open ? 1 : 0,
          transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
        }}
      >
        <div
          style={{
            marginTop: hideHeader ? 0 : 8,
            paddingTop: hideHeader ? 0 : 8,
            borderTop: hideHeader ? "none" : "1px solid rgba(255,255,255,0.06)",
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

