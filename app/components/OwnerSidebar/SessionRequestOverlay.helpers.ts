// Tipos, helpers puros y estilos (OVERLAY_CSS) de SessionRequestOverlay (hoja).

import { useState, useEffect, useRef, useCallback } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { formatDateTime, formatDateTimeLong } from "@/lib/i18n/dateTime";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations, useLocale } from "next-intl";
import { playEdgeTTS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import Image from "next/image";
import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "@/app/(protected)/wallet/components/ScheduleDateTimeSelector";
import { formatScheduledAt, getTimezoneLabel, getViewerTimezone } from "@/lib/utils/timezoneDisplay";
import ScheduleCalendarOverlay from "@/app/(protected)/wallet/components/ScheduleCalendarOverlay";
import { WalletServiceRow } from "@/app/(protected)/wallet/components/WalletUi";
import {
  getWalletScheduleConflictResult,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";
import type {
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
} from "./OwnerSidebar";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { callGetRecordingDownloadUrl } from "@/lib/liveKit/sessionLifecycle";

export type SessionRequest = MeetGreetRequestDoc | ExclusiveSessionRequestDoc;

export type SessionRequestOverlayProps = {
  open: boolean;
  onClose: () => void;
  request: SessionRequest;
  requestId: string;
  serviceKind: "meet_greet" | "exclusive_session";
  earning: string | null;
  busy: boolean;
  ownerCalendarItems: WalletServiceItem[];
  getInitials: (name?: string | null) => string;
  onAccept: () => void;
  onReject: (reason: string | null) => Promise<void>;
  onSchedule: (scheduledAt: string | null, note: string | null) => Promise<void> | void;
  onAcceptAndSchedule: (scheduledAt: string | null, note: string | null) => void;
  onPrepare: () => void;
  readOnly?: boolean;
  preparationNode?: React.ReactNode;
  onReschedule?: (item: WalletServiceItem, scheduledAt: string) => Promise<void>;
  onKeepSchedule?: () => Promise<void>;
  ownerAvatarUrl?: string | null;
  ownerDisplayName?: string | null;
};

// ── Utilidades locales ────────────────────────────────────────────────────────

export function toDateSafe(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const d = (value as { toDate: () => Date }).toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function formatUnknownDate(value: unknown, locale: string): string | null {
  return formatDateTime(toDateSafe(value), locale, { dateStyle: "medium", timeStyle: "short" });
}

// ⚠️ Antes: `${día} de ${mes} del ${año} a las ${hh}:${mm} horas`. Los cuatro pegamentos
// ("de", "del", "a las", "horas") son gramática española y salían tal cual en cualquier
// idioma. El orden de los campos y el reloj de 12/24 h los decide ahora Intl.
export function formatScheduledDate(value: unknown, locale: string): string | null {
  return formatDateTimeLong(toDateSafe(value), locale);
}

export function getRequestCurrency(req: SessionRequest): string {
  return (req as MeetGreetRequestDoc & { currency?: string }).currency ?? SETTLEMENT_CURRENCY;
}

export function getCreatorScheduleNote(req: SessionRequest): string | null {
  return (req as MeetGreetRequestDoc).creatorScheduleNote ?? null;
}

export function getRelativeTime(value: unknown, tc: (k: string, v?: Record<string, unknown>) => string): string {
  const date = toDateSafe(value);
  if (!date) return tc("relativeTimeNow");
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return tc("relativeTimeDays", { count: diffDays });
  if (diffHours >= 1) return tc("relativeTimeHours", { count: diffHours });
  if (diffMins >= 1) return tc("relativeTimeMinutes", { count: diffMins });
  return tc("relativeTimeNow");
}

export function isPrepareWindowOpen(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;
  return Date.now() >= date.getTime() - 10 * 60 * 1000;
}

export function isNoShowExpired(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;
  return Date.now() >= date.getTime() + 15 * 60 * 1000;
}

export function getMeetGreetStatusLabel(status: string, t?: (k: string) => string): string {
  if (t) {
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
    };
    return map[status] ? t(map[status]) : t("statusUnknown");
  }
  switch (status) {
    case "pending_creator_response": return "En espera de aceptación";
    case "accepted_pending_schedule": return "Aceptado, pendiente de fecha";
    case "scheduled": return "Agendado";
    case "reschedule_requested": return "Cambio de fecha solicitado";
    case "rejected": return "Rechazado";
    case "refund_requested": return "Devolución solicitada";
    case "refund_review": return "Devolución en revisión";
    case "ready_to_prepare": return "Ya casi inicia";
    case "in_preparation": return "En preparación";
    case "completed": return "Completado";
    case "cancelled": return "Cancelado";
    default: return status || "Estado desconocido";
  }
}

export function getMeetGreetStatusStyle(status: string): React.CSSProperties {
  if (["scheduled", "accepted_pending_schedule", "completed"].includes(status))
    return { border: "1px solid rgba(34,197,94,0.24)", background: "rgba(34,197,94,0.12)", color: "#86efac" };
  if (status === "in_preparation")
    return { border: "1px solid rgba(96,165,250,0.30)", background: "rgba(96,165,250,0.16)", color: "#93c5fd" };
  if (["reschedule_requested", "ready_to_prepare", "refund_requested", "refund_review"].includes(status))
    return { border: "1px solid rgba(250,204,21,0.26)", background: "rgba(250,204,21,0.12)", color: "#fde047" };
  if (["rejected", "cancelled"].includes(status))
    return { border: "1px solid rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.14)", color: "#fca5a5" };
  return { border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fff" };
}

export function getTypeChipStyle(type: string): React.CSSProperties {
  if (type === "meet_greet_digital")
    return { border: "1px solid rgba(96,165,250,0.30)", background: "rgba(96,165,250,0.16)", color: "#93c5fd" };
  if (["digital_exclusive_session", "exclusive_session", "clase_personalizada"].includes(type))
    return { border: "1px solid rgba(168,85,247,0.32)", background: "rgba(168,85,247,0.16)", color: "#d8b4fe" };
  return { border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fff" };
}

// ── Chat history ─────────────────────────────────────────────────────────────
export type ChatEntry = { role: "buyer" | "creator"; text: string; ts: unknown };

export function buildChatEntries(req: SessionRequest): ChatEntry[] {
  const mg = req as MeetGreetRequestDoc;
  const entries: ChatEntry[] = [];
  if (mg.buyerMessage) {
    entries.push({ role: "buyer", text: mg.buyerMessage, ts: mg.createdAt ?? null });
  }
  const schedHistory = mg.scheduleHistory ?? [];
  const reschedHistory = mg.rescheduleHistory ?? [];
  // When schedHistory has more entries than reschedHistory, the first sched entry
  // is the initial scheduling (before any buyer reschedule). Otherwise every sched
  // entry is a direct response to the corresponding resched entry at the same index.
  const hasInitialSched = schedHistory.length > reschedHistory.length;
  if (hasInitialSched && schedHistory[0]?.note) {
    entries.push({ role: "creator", text: schedHistory[0].note, ts: schedHistory[0].proposedAt ?? null });
  }
  for (let i = 0; i < reschedHistory.length; i++) {
    const resched = reschedHistory[i];
    if (resched?.reason) entries.push({ role: "buyer", text: resched.reason, ts: resched.requestedAt ?? null });
    const schedIdx = hasInitialSched ? i + 1 : i;
    const sched = schedHistory[schedIdx];
    if (sched?.note) entries.push({ role: "creator", text: sched.note, ts: sched.proposedAt ?? null });
  }
  // Fallback: if scheduleHistory has no notes at all but creatorScheduleNote is set
  if (!schedHistory.some(e => e.note) && mg.creatorScheduleNote) {
    entries.push({ role: "creator", text: mg.creatorScheduleNote, ts: mg.creatorScheduleNoteUpdatedAt ?? null });
  }
  return entries;
}

// ── CSS de animaciones + capas de fondo ──────────────────────────────────────
export const OVERLAY_CSS = `
  @keyframes sroDesktopIn  { from { opacity:0; transform:scale(0.94) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
  @keyframes sroDesktopOut { from { opacity:1; transform:scale(1) translateY(0); } to { opacity:0; transform:scale(0.94) translateY(10px); } }
  .sro-bg-img {
    position: absolute; top: 0; inset-inline-end: 0; bottom: 0; inset-inline-start: 0; z-index: 0;
    background-size: cover; background-position: center 40%; background-repeat: no-repeat;
    opacity: 0.52;
  }
  .sro-bg-grad {
    position: absolute; top: 0; inset-inline-end: 0; bottom: 0; inset-inline-start: 0; z-index: 1;
    background: linear-gradient(to bottom,
      #0a0a0a 28%,
      rgba(10,10,10,0.72) 46%,
      rgba(10,10,10,0.62) 60%,
      rgba(10,10,10,0.82) 78%,
      #0a0a0a 100%
    );
    -webkit-transform: translateZ(0); transform: translateZ(0); will-change: opacity;
  }
  .sro-z2 { position: relative; z-index: 2; }
  .sro-schedule select, .sro-schedule input {
    background: rgba(255,255,255,0.06) !important;
    border-color: transparent !important;
    border-width: 0 !important;
  }
  @media (max-width: 900px) {
    .sro-bg-img {
      background-position: center 38%;
    }
    .sro-bg-grad {
      background: linear-gradient(to bottom,
        #0a0a0a 0%,
        #0a0a0a 34%,
        rgba(10,10,10,0.72) 52%,
        rgba(10,10,10,0.62) 64%,
        rgba(10,10,10,0.82) 80%,
        #0a0a0a 100%
      );
    }
  }
`;

export const CLOSE_DELAY_DESKTOP = 180;
export const CLOSE_DELAY_MOBILE  = 260;
export const SWIPE_THRESHOLD = 130;

// ── Componente ────────────────────────────────────────────────────────────────

