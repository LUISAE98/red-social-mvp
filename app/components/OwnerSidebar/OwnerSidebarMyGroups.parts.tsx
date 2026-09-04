"use client";

// Tipos, helpers y sub-componente BuyerMessagePlayer de OwnerSidebarMyGroups.

import Image from "next/image";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { IconButton } from "@/components/ui";
import { intlLocale } from "@/i18n/locales";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  doc,
  getDoc,
  addDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import InviteLinkModal from "./InviteLinkModal";
import ScheduleCalendarOverlay from "@/app/(protected)/wallet/components/ScheduleCalendarOverlay";
import { WalletServiceRow } from "@/app/(protected)/wallet/components/WalletUi";

import {
  getWalletScheduleConflictResult,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";

import type {
  GroupDocLite,
  GreetingRequestDoc,
  JoinRequestRow,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
  UserMini,
} from "./OwnerSidebar";

import { CountBadge, typeLabel } from "./OwnerSidebar";
import GreetingReviewOverlay from "./GreetingReviewOverlay";
import SessionRequestOverlay from "./SessionRequestOverlay";

import {
  acceptMeetGreetRequest,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  setMeetGreetPreparing,
  declineMeetGreetReschedule,
} from "@/lib/meetGreet/meetGreetRequests";

import {
  acceptExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  rejectExclusiveSessionRequest,
  setExclusiveSessionPreparing,
  declineExclusiveSessionReschedule,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";

import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import { useTranslations, useLocale } from "next-intl";
import { ReadAlongText } from "@/components/tts/ReadAlongText";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { playEdgeTTS } from "@/lib/tts/edge-tts-client";
import { vozParaLocale } from "@/lib/tts/voices";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";

import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "@/app/(protected)/wallet/components/ScheduleDateTimeSelector";

export function BuyerMessagePlayer({ message }: { message: string }) {
  const tServices = useTranslations("services");
  // Quien escucha aquí es el creador, dentro de su propio sidebar.
  const locale = useLocale();
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechHighlight, setSpeechHighlight] = useState<{ start: number; length: number } | null>(null);
  const [speechRate, setSpeechRate] = useState<1 | 1.4 | 1.8>(1);
  const speechRateRef = useRef<number>(1);
  const speechGenRef = useRef(0);
  const ttsAudioRef = useRef<EdgeTTSHandle | null>(null);

  useEffect(() => {
    return () => {
      speechGenRef.current++;
      if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    };
  }, []);

  const startSpeechFrom = useCallback((charIndex: number) => {
    if (!message) return;
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    const gen = ++speechGenRef.current;
    const sliceText = message.slice(charIndex);
    if (!sliceText.trim()) return;
    setSpeechHighlight(charIndex > 0 ? { start: charIndex, length: 0 } : null);
    ttsAudioRef.current = playEdgeTTS(sliceText, {
      voice: vozParaLocale(locale),
      playbackRate: speechRateRef.current,
      onProgress: (ratio) => {
        if (speechGenRef.current !== gen) return;
        const posInSlice = Math.floor(ratio * sliceText.length);
        const absPos = charIndex + posInSlice;
        setSpeechHighlight({ start: 0, length: absPos });
      },
      onEnded: () => {
        if (speechGenRef.current !== gen) return;
        ttsAudioRef.current = null;
        setSpeechState("idle");
        setSpeechHighlight(null);
      },
      onError: () => {
        if (speechGenRef.current !== gen) return;
        ttsAudioRef.current = null;
        setSpeechState("idle");
        setSpeechHighlight(null);
      },
    });
    setSpeechState("playing");
  }, [message, locale]);

  const handleToggleSpeech = useCallback(() => {
    if (speechState === "playing") { ttsAudioRef.current?.audio.pause(); setSpeechState("paused"); return; }
    if (speechState === "paused") { ttsAudioRef.current?.audio.play().catch(() => {}); setSpeechState("playing"); return; }
    startSpeechFrom(0);
  }, [speechState, startSpeechFrom]);

  const handleCycleRate = useCallback(() => {
    const next: 1 | 1.4 | 1.8 = speechRate === 1 ? 1.4 : speechRate === 1.4 ? 1.8 : 1;
    speechRateRef.current = next;
    setSpeechRate(next);
    if (ttsAudioRef.current) ttsAudioRef.current.audio.playbackRate = next;
  }, [speechRate]);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
        {speechState !== "idle" && (
          <button
            type="button"
            onClick={handleCycleRate}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.55)", padding: "2px 4px", fontSize: 11, fontWeight: 700, letterSpacing: "-0.3px", fontFamily: "inherit" }}
          >
            {speechRate}×
          </button>
        )}
        <IconButton label={speechState === "playing" ? tServices("pauseReading") : speechState === "paused" ? tServices("resumeReading") : tServices("readMessage")} size="sm" tone="bare" shape="square" onClick={handleToggleSpeech}>
          {speechState === "playing" ? (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="4" width="4" height="16" rx="1"/>
              <rect x="15" y="4" width="4" height="16" rx="1"/>
            </svg>
          ) : (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          )}
        </IconButton>
      </div>
      <p style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.9)", margin: 0, padding: "2px 0", userSelect: "none" }}>
        <ReadAlongText
          text={message}
          active={speechState !== "idle" && !!speechHighlight}
          readChars={(speechHighlight?.start ?? 0) + (speechHighlight?.length ?? 0)}
        />
      </p>
    </div>
  );
}

export type ScheduledServiceKind = "meet_greet" | "exclusive_session";

export type Props = {
  loadingGroups: boolean;
  myGroups: GroupDocLite[];
  ownedGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  openCommunities: Record<string, boolean>;

  joinRequestsByGroup: Record<string, JoinRequestRow[]>;
  greetingsByGroup: Record<string, Array<{ id: string; data: GreetingRequestDoc }>>;
  meetGreetsByGroup: Record<string, Array<{ id: string; data: MeetGreetRequestDoc }>>;
  exclusiveSessionsByGroup: Record<string, Array<{ id: string; data: ExclusiveSessionRequestDoc }>>;

  greetingSectionOpen: Record<string, boolean>;
  joinSectionOpen: Record<string, boolean>;

  seenCountsByGroup: Record<string, { join: number; greeting: number }>;
  userMiniMap: Record<string, UserMini>;

  styles: Record<string, React.CSSProperties>;

  getInitials: (name?: string | null) => string;
  renderUserLink: (uid: string) => React.ReactNode;

  setOpenCommunities: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSeenCountsByGroup: React.Dispatch<
    React.SetStateAction<Record<string, { join: number; greeting: number }>>
  >;

  setJoinSectionOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setGreetingSectionOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

  handleApproveJoin: (groupId: string, userId: string) => Promise<void>;
  handleRejectJoin: (groupId: string, userId: string) => Promise<void>;

  handleGreetingAction: (
    requestId: string,
    action: "accept" | "reject"
  ) => Promise<void>;

  onCreateCommunity: () => void;

  joinBusyKey: string | null;
  greetingBusyId: string | null;
  newPostsCounts?: Record<string, number>;
};

export type BusyMap = Record<string, boolean>;
export type TextMap = Record<string, string>;
export type ToggleMap = Record<string, boolean>;
export function getTypeChipStyle(type: string): React.CSSProperties {
  if (type === "saludo") {
    return {
      border: "1px solid rgba(34,197,94,0.28)",
      background: "rgba(34,197,94,0.16)",
      color: "#86efac",
    };
  }
  if (type === "consejo") {
    return {
      border: "1px solid rgba(250,204,21,0.30)",
      background: "rgba(250,204,21,0.16)",
      color: "#fde047",
    };
  }
  if (type === "meet_greet_digital") {
    return {
      border: "1px solid rgba(96,165,250,0.30)",
      background: "rgba(96,165,250,0.16)",
      color: "#93c5fd",
    };
  }
  if (
    type === "digital_exclusive_session" ||
    type === "exclusive_session" ||
    type === "clase_personalizada"
  ) {
    return {
      border: "1px solid rgba(168,85,247,0.32)",
      background: "rgba(168,85,247,0.16)",
      color: "#d8b4fe",
    };
  }
  return {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
  };
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
  // fallback to original Spanish strings
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

export function formatUnknownDate(value: unknown, locale: string): string | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleString(intlLocale(locale));
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.toLocaleString(intlLocale(locale));
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString(intlLocale(locale));
    }
  }

  return null;
}
export function getRequestCurrency(
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc
): string {
  return req.currency ?? req.serviceSnapshot?.currency ?? SETTLEMENT_CURRENCY;
}

export function getCreatorScheduleNote(
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc
): string | null {
  const note = req.creatorScheduleNote;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

export function toDateSafe(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date;
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

export function getRelativeTime(value: unknown, tCommonFn?: (k: string, params?: Record<string, string | number | Date>) => string): string {
  const date = toDateSafe(value);
  if (!date) return tCommonFn ? tCommonFn("relativeTimeNow") : "Hace un momento";
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (tCommonFn) {
    if (diffDays >= 1) return tCommonFn("relativeTimeDays", { count: diffDays });
    if (diffHours >= 1) return tCommonFn("relativeTimeHours", { count: diffHours });
    if (diffMins >= 1) return tCommonFn("relativeTimeMinutes", { count: diffMins });
    return tCommonFn("relativeTimeNow");
  }
  if (diffDays >= 1) return `Hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
  if (diffHours >= 1) return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  if (diffMins >= 1) return `Hace ${diffMins} ${diffMins === 1 ? "minuto" : "minutos"}`;
  return "Hace un momento";
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

export function isPreparationVisibleWindow(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const startsAt = date.getTime();

  const prepareFrom = startsAt - 10 * 60 * 1000;
  const rejectAt = startsAt + 15 * 60 * 1000;

  return now >= prepareFrom && now < rejectAt;
}

export function isServiceRequestAlertStatus(status?: string | null): boolean {
  // `reschedule_requested` (el comprador pidió reagendar) ya NO se muestra en el
  // sidebar: ahora esa solicitud llega a la pestaña Experiencias de notificaciones.
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule"
  );
}

export function isUpcomingServiceStatus(status?: string | null): boolean {
  return (
    status === "scheduled" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

export function shouldHideExpiredPreparationAlert(
  status?: string | null,
  scheduledAt?: unknown
): boolean {
  return (
    (status === "scheduled" ||
      status === "ready_to_prepare" ||
      status === "in_preparation") &&
    isNoShowExpired(scheduledAt)
  );
}

