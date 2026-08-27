"use client";

// Tipos, helpers y sub-componentes de OwnerSidebarGreetings (aislados).

import Image from "next/image";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { formatDateLong, formatWeekdayTime } from "@/lib/i18n/dateTime";
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
  if (type === "meet_greet" || type === "meet_greet_digital") {
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

// 🚨 COLUMNA DEL BOTÓN DE LAS CARDS: ANCHO FIJO, NO "LO QUE MIDA LA ETIQUETA" 🚨
//
// Las cards pendientes son tres columnas: [origen] │ [contador o fecha] [botón]. El botón
// tenía ancho automático con `flexShrink: 0`, así que era la LONGITUD DE SU ETIQUETA
// TRADUCIDA la que decidía cuánto espacio sobraba para las otras dos. Y como en una misma
// lista conviven botones distintos ("Ver solicitud" / "Ver detalles" / "Preparar"), el
// contador del centro caía en una X distinta en cada card.
//
// En español no se veía: las etiquetas miden casi lo mismo. En griego (Δες το αίτημα vs
// Δες τις λεπτομέρειες), alemán o turco la diferencia es enorme y las cards quedan
// escalonadas.
//
// Al fijar esta columna en proporción, las dos de la izquierda miden SIEMPRE lo mismo sea
// cual sea el idioma, y una etiqueta larga parte en dos líneas DENTRO del botón en vez de
// robarle ancho al resto. Por eso el botón lleva `whiteSpace: "normal"` y `minHeight` en
// lugar de `height` fijo.
export const cardButtonColumnStyle: React.CSSProperties = {
  flex: "0 0 30%",
  minWidth: 0,
  display: "flex",
  justifyContent: "flex-end",
};

// Estilo base del botón de las cards. Se deja envolver a dos líneas a propósito: ver
// `cardButtonColumnStyle`.
export const cardButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  maxWidth: "100%",
  minHeight: 30,
  padding: "6px 12px",
  borderRadius: 8,
  border: "none",
  fontWeight: 600,
  fontSize: 11,
  lineHeight: 1.2,
  cursor: "pointer",
  whiteSpace: "normal",
};

// Fecha agendada en dos líneas (mismo formato que el overlay de detalles).
//
// ⚠️ Antes esto estaba clavado en "es-MX" y armaba la fecha CONCATENANDO ("15 de Julio
// de 2026", "Miércoles 22:45 hrs"). Resultado: a un usuario con la app en griego se le
// mostraba la fecha en español dentro de una interfaz griega. La concatenación además
// no es traducible: el "de … de" es una regla del español y el orden día-mes-año no es
// universal (en-US pone el mes primero).
//
// Ahora lo arma `Intl.DateTimeFormat` con el locale ACTIVO, que resuelve solo el orden
// de los campos, el nombre del mes y el reloj de 12 o 24 horas según el idioma. Por eso
// desaparece el sufijo "hrs": en los locales de 12 horas lo pone el propio Intl como
// AM/PM, y ponerlo a mano daría "10:45 PM hrs".
export function fmtScheduledSplit(
  ts: unknown,
  locale: string
): { dayTime: string; dateStr: string } | null {
  const d = toDateSafe(ts);
  if (!d) return null;
  const dayTime = formatWeekdayTime(d, locale);
  const dateStr = formatDateLong(d, locale);
  return dayTime && dateStr ? { dayTime, dateStr } : null;
}

// Días que tiene el creador para ENTREGAR (grabar el saludo / agendar la sesión) antes de
// que el comprador pueda pedir devolución. El pago se retiene (hold) al comprar y se
// captura al entregar (o como respaldo interno al 5º día, por el límite de ~7 días del
// hold en Stripe); esta ventana de 60 días es la de entrega, no la de captura.
export const GREETING_RESPONSE_DAYS = 60;
export const SESSION_RESPONSE_DAYS = 60;

// Días restantes (>= 0) para responder, contados desde createdAt sobre una ventana
// de `days` días.
export function responseDaysLeft(createdAt: unknown, days: number): number | null {
  const d = toDateSafe(createdAt);
  if (!d) return null;
  const ms = d.getTime() + days * 86400000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
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
    session_incomplete: "shortSession",
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

  return reqWithExtras.currency ?? reqWithExtras.serviceSnapshot?.currency ?? SETTLEMENT_CURRENCY;
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

export function displayRowPaymentStatus(row: DisplayRow): string | undefined {
  return (row.row.data as { paymentStatus?: string }).paymentStatus;
}

/**
 * ¿La experiencia ya fue DEVUELTA? (crédito o tarjeta) → sale de "Rechazados" y vive en
 * Entregados → "Todo". Devuelta a crédito = refund_requested/refund_review. Devuelta a la
 * tarjeta = rechazada ANTES de cobrar (hold cancelado): status "rejected" sin `paymentStatus`
 * "paid".
 */
export function isReturnedRow(row: DisplayRow): boolean {
  const st = displayRowStatus(row);
  if (isRefundStatus(st)) return true;
  if (st === "rejected" && displayRowPaymentStatus(row) !== "paid") return true;
  return false;
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
          textAlign: "start",
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

