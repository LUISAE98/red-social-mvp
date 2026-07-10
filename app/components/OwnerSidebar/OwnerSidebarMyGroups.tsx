"use client";

import Image from "next/image";
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
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";
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
import { useTranslations } from "next-intl";

import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { playEdgeTTS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";

import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "@/app/(protected)/wallet/components/ScheduleDateTimeSelector";

function BuyerMessagePlayer({ message }: { message: string }) {
  const tServices = useTranslations("services");
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
  }, [message]);

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
        <button
          type="button"
          onClick={handleToggleSpeech}
          aria-label={speechState === "playing" ? tServices("pauseReading") : speechState === "paused" ? tServices("resumeReading") : tServices("readMessage")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", padding: 2, display: "flex", alignItems: "center", flexShrink: 0, transition: "color 0.15s" }}
        >
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
        </button>
      </div>
      <p style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.9)", margin: 0, padding: "2px 0", userSelect: "none" }}>
        {speechState === "idle" || !speechHighlight ? message : (
          <>
            <strong style={{ color: "#fff", fontWeight: 700 }}>{message.slice(0, speechHighlight.start + speechHighlight.length)}</strong>
            {message.slice(speechHighlight.start + speechHighlight.length)}
          </>
        )}
      </p>
    </div>
  );
}

type ScheduledServiceKind = "meet_greet" | "exclusive_session";

type Props = {
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

type BusyMap = Record<string, boolean>;
type TextMap = Record<string, string>;
type ToggleMap = Record<string, boolean>;
function getTypeChipStyle(type: string): React.CSSProperties {
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

function getMeetGreetStatusLabel(status: string, t?: (k: string) => string): string {
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

function formatUnknownDate(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleString("es-MX");
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.toLocaleString("es-MX");
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("es-MX");
    }
  }

  return null;
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

function getRequestCurrency(
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc
): string {
  return req.currency ?? req.serviceSnapshot?.currency ?? "MXN";
}

function getCreatorScheduleNote(
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc
): string | null {
  const note = req.creatorScheduleNote;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

function toDateSafe(value: unknown): Date | null {
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

function getRelativeTime(value: unknown, tCommonFn?: (k: string, params?: Record<string, string | number | Date>) => string): string {
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

function isPreparationVisibleWindow(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const startsAt = date.getTime();

  const prepareFrom = startsAt - 10 * 60 * 1000;
  const rejectAt = startsAt + 15 * 60 * 1000;

  return now >= prepareFrom && now < rejectAt;
}

function isServiceRequestAlertStatus(status?: string | null): boolean {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "reschedule_requested"
  );
}

function isUpcomingServiceStatus(status?: string | null): boolean {
  return (
    status === "scheduled" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

function shouldHideExpiredPreparationAlert(
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

export default function OwnerSidebarMyGroups({
  loadingGroups,
  myGroups,
  ownedGrouped,
  openCommunities,
  joinRequestsByGroup,
  greetingsByGroup,
  meetGreetsByGroup,
  exclusiveSessionsByGroup,
  greetingSectionOpen,
  joinSectionOpen,
  seenCountsByGroup,
  userMiniMap,
  styles,
  getInitials,
  renderUserLink,
  setOpenCommunities,
  setSeenCountsByGroup,
  setJoinSectionOpen,
  setGreetingSectionOpen,
  handleApproveJoin,
  handleRejectJoin,
  handleGreetingAction,
  onCreateCommunity,
  joinBusyKey,
  greetingBusyId,
  newPostsCounts = {},
}: Props) {
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const tNav = useTranslations("nav");
  const tGroups = useTranslations("groups");
  const tSessions = useTranslations("sessions");
  const tWallet = useTranslations("wallet");
  const pathname = usePathname();
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [reviewGreetingState, setReviewGreetingState] = useState<{ items: Array<{ id: string; data: GreetingRequestDoc }>; startIndex: number } | null>(null);
  const [greetingEarningsMap, setGreetingEarningsMap] = useState<Record<string, string | null>>({});

  const allSortedGreetings = useMemo(() => {
    const all = Object.values(greetingsByGroup).flat();
    return all.sort((a, b) => {
      const aTime = toDateSafe(a.data.createdAt)?.getTime() ?? 0;
      const bTime = toDateSafe(b.data.createdAt)?.getTime() ?? 0;
      return aTime - bTime;
    });
  }, [greetingsByGroup]);

  useEffect(() => {
    // Deduplicate by (bucketKey, type) — same logic as getServiceBucketKey in OwnerSidebar
    const unique = new Map<string, { col: string; docId: string; type: string }>();
    for (const [bucketKey, rows] of Object.entries(greetingsByGroup)) {
      for (const row of rows) {
        const key = `${bucketKey}_${row.data.type}`;
        if (unique.has(key)) continue;
        const req = row.data;
        // Derive collection + doc from the request's own source fields, same as GreetingReviewOverlay
        const isProfile = req.source === "profile" || bucketKey.startsWith("profile:");
        const docId = isProfile
          ? (req.profileUserId ?? req.creatorId ?? bucketKey.slice("profile:".length))
          : (req.groupId ?? bucketKey);
        if (!docId) continue;
        const col = isProfile ? "users" : "groups";
        unique.set(key, { col, docId, type: req.type });
      }
    }
    if (unique.size === 0) return;
    Promise.all(
      Array.from(unique.entries()).map(async ([key, { col, docId, type }]) => {
        try {
          const snap = await getDoc(doc(db, col, docId));
          if (!snap.exists()) return [key, null] as const;
          const data = snap.data() as Record<string, unknown>;
          const offerings = Array.isArray(data.offerings) ? data.offerings as Array<Record<string, unknown>> : [];
          const offering = offerings.find((o) => o.type === type);
          const rawPrice =
            typeof offering?.memberPrice === "number" ? (offering.memberPrice as number)
            : typeof offering?.price === "number" ? (offering.price as number)
            : null;
          const formatted = rawPrice != null && rawPrice > 0
            ? "$" + new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(rawPrice * 0.77) + " MXN"
            : null;
          return [key, formatted] as const;
        } catch {
          return [key, null] as const;
        }
      })
    ).then((results) => {
      const updates: Record<string, string | null> = {};
      for (const [key, val] of results) updates[key] = val;
      setGreetingEarningsMap((prev) => ({ ...prev, ...updates }));
    });
  }, [greetingsByGroup]);

useEffect(() => {
  if (typeof window === "undefined") return;

  const mediaQuery = window.matchMedia("(max-width: 900px)");

  const sync = () => setIsMobile(mediaQuery.matches);
  sync();

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }

  mediaQuery.addListener(sync);
  return () => mediaQuery.removeListener(sync);
}, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const q = query(
      collection(db, "users", uid, "notifications"),
      where("type", "==", "session_rescheduled"),
      where("read", "==", false),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    return onSnapshot(q, (snap) => {
      if (snap.empty) { setRescheduleNotification(null); return; }
      const d = snap.docs[0];
      const data = d.data() as {
        source?: string;
        newScheduledAt?: string;
        creatorName?: string | null;
      };
      setRescheduleNotification({
        notifId: d.id,
        source: data.source === "exclusive_session" ? "exclusive_session" : "meet_greet",
        newScheduledAt: data.newScheduledAt ?? "",
        creatorName: data.creatorName ?? null,
      });
    });
  }, []);

  const [meetGreetBusyMap, setMeetGreetBusyMap] = useState<BusyMap>({});
  const [meetGreetErrorMap, setMeetGreetErrorMap] = useState<TextMap>({});
  const [meetGreetSuccessMap, setMeetGreetSuccessMap] = useState<TextMap>({});
  const { toast: myGroupsToast, showToast: showMyGroupsToast } = useVibraToast();

  const [meetGreetSectionOpen, setMeetGreetSectionOpen] = useState<Record<string, boolean>>({});
  const [sessionOverlayData, setSessionOverlayData] = useState<{
    id: string;
    req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
    serviceKind: "meet_greet" | "exclusive_session";
  } | null>(null);
  const [sessionOverlayOpen, setSessionOverlayOpen] = useState(false);
  const [postScheduleCalendar, setPostScheduleCalendar] = useState<{
    date: Date;
    kind: "meet_greet" | "exclusive_session";
    req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
    note: string | null;
  } | null>(null);
  const [rescheduleNotification, setRescheduleNotification] = useState<{
    notifId: string;
    source: "meet_greet" | "exclusive_session";
    newScheduledAt: string;
    creatorName: string | null;
  } | null>(null);
  const [rejectOpenMap, setRejectOpenMap] = useState<ToggleMap>({});
  const [scheduleOpenMap, setScheduleOpenMap] = useState<ToggleMap>({});
  const [calendarOpenMap, setCalendarOpenMap] = useState<ToggleMap>({});
  const [calendarEventOpenKey, setCalendarEventOpenKey] =
    useState<string | null>(null);

  const [preparationOpenMap, setPreparationOpenMap] = useState<ToggleMap>({});
  const [preparationRoleMap, setPreparationRoleMap] = useState<TextMap>({});

  const [rejectReasonMap, setRejectReasonMap] = useState<TextMap>({});
  const [scheduleNoteMap, setScheduleNoteMap] = useState<TextMap>({});
  const [schedulePartsMap, setSchedulePartsMap] = useState<
    Record<string, ScheduleParts>
  >({});

  const lastRealGroupSectionIndex = ownedGrouped.reduce(
    (lastIndex, section, index) => {
      const hasRealGroup = section.items.some(
        (item) => item.visibility !== "profile"
      );

      return hasRealGroup ? index : lastIndex;
    },
    -1
  );


  function setMeetGreetBusy(requestId: string, value: boolean) {
    setMeetGreetBusyMap((prev) => ({
      ...prev,
      [requestId]: value,
    }));
  }

  function setMeetGreetError(requestId: string, value: string | null) {
    setMeetGreetErrorMap((prev) => ({
      ...prev,
      [requestId]: value ?? "",
    }));
  }

  function setMeetGreetSuccess(requestId: string, value: string | null) {
    setMeetGreetSuccessMap((prev) => ({
      ...prev,
      [requestId]: value ?? "",
    }));
  }

  async function handleCreatorAccept(
    requestId: string,
    kind: ScheduledServiceKind
  ) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId });
      } else {
        await acceptMeetGreetRequest({ requestId });
      }

      showMyGroupsToast(tServices("successRequestAccepted"));

      setScheduleOpenMap((prev) => ({
        ...prev,
        [requestId]: true,
      }));
    } catch (e: unknown) {
      showMyGroupsToast((e instanceof Error ? e.message : null) ?? tServices("errorAcceptRequest"), "error");
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }
    async function handleCreatorReject(
    requestId: string,
    kind: ScheduledServiceKind
  ) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await rejectExclusiveSessionRequest({
          requestId,
          rejectionReason: rejectReasonMap[requestId] ?? null,
        });
      } else {
        await rejectMeetGreetRequest({
          requestId,
          rejectionReason: rejectReasonMap[requestId] ?? null,
        });
      }

      showMyGroupsToast(tServices("successRequestRejected"));

      setRejectOpenMap((prev) => ({
        ...prev,
        [requestId]: false,
      }));
    } catch (e: unknown) {
      showMyGroupsToast((e instanceof Error ? e.message : null) ?? tServices("errorRejectRequest"), "error");
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handleCreatorSchedule(
    requestId: string,
    kind: ScheduledServiceKind
  ) {
    const parts = schedulePartsMap[requestId];
    const scheduledAt = parts ? schedulePartsToIso(parts) : null;

    if (!scheduledAt) {
      setMeetGreetError(requestId, tServices("selectDateTimeError"));
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
  ownerCalendarItems
);

if (scheduleConflict.hasConflict) {
  setMeetGreetError(
    requestId,
    scheduleConflict.message ??
      tServices("scheduleConflictError")
  );
  return;
}

    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        scheduledAt,
        note: scheduleNoteMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await proposeExclusiveSessionSchedule(payload);
      } else {
        await proposeMeetGreetSchedule(payload);
      }

      showMyGroupsToast(tServices("successDateProposed"));

      setScheduleOpenMap((prev) => ({
        ...prev,
        [requestId]: false,
      }));
    } catch (e: unknown) {
      showMyGroupsToast((e instanceof Error ? e.message : null) ?? tServices("errorSaveDate"), "error");
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handlePrepare(
    requestId: string,
    role: "creator",
    kind: ScheduledServiceKind
  ) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await setExclusiveSessionPreparing({ requestId, role });
      } else {
        await setMeetGreetPreparing({ requestId, role });
      }

      setPreparationRoleMap((prev) => ({
        ...prev,
        [requestId]: role,
      }));

      setPreparationOpenMap((prev) => ({
        ...prev,
        [requestId]: true,
      }));

      showMyGroupsToast(tServices("successPreparationOpened"));
    } catch (e: unknown) {
      showMyGroupsToast((e instanceof Error ? e.message : null) ?? tServices("errorOpenPreparation"), "error");
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handleCreatorAcceptAndSchedule(requestId: string, kind: "meet_greet" | "exclusive_session", scheduledAtIso: string | null, note: string | null) {
    if (!scheduledAtIso) {
      setMeetGreetError(requestId, tServices("selectDateTimeError"));
      return;
    }
    const selectedDate = new Date(scheduledAtIso);
    const conflict = getWalletScheduleConflictResult(
      { id: requestId, source: kind, scheduledAt: selectedDate, durationMinutes: kind === "exclusive_session" ? 60 : 30 },
      ownerCalendarItems
    );
    if (conflict.hasConflict) {
      setMeetGreetError(requestId, conflict.message ?? tServices("scheduleConflictError"));
      return;
    }
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);
    try {
      if (kind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId });
        await proposeExclusiveSessionSchedule({ requestId, scheduledAt: scheduledAtIso, note });
      } else {
        await acceptMeetGreetRequest({ requestId });
        await proposeMeetGreetSchedule({ requestId, scheduledAt: scheduledAtIso, note });
      }
      setSessionOverlayOpen(false);
      setTimeout(() => setSessionOverlayData(null), 300);
      setPostScheduleCalendar({
        date: new Date(scheduledAtIso),
        kind,
        req: sessionOverlayData!.req,
        note: note ?? null,
      });
    } catch (e: unknown) {
      showMyGroupsToast((e instanceof Error ? e.message : null) ?? tServices("errorScheduleSession"), "error");
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handleRescheduleConfirm(item: WalletServiceItem, scheduledAt: string, note: string | null) {
    if (item.source === "exclusive_session") {
      await proposeExclusiveSessionSchedule({ requestId: item.id, scheduledAt, note });
    } else {
      await proposeMeetGreetSchedule({ requestId: item.id, scheduledAt, note });
    }
    // Notificar al comprador
    try {
      await addDoc(collection(db, "users", item.buyerId, "notifications"), {
        type: "session_rescheduled",
        sessionId: item.id,
        source: item.source,
        newScheduledAt: scheduledAt,
        creatorName: null,
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch {
      // La notificación no es crítica; continúa aunque falle
    }
    showMyGroupsToast(tServices("successRescheduled"));
  }

  async function handleCreatorRejectDirect(requestId: string, kind: "meet_greet" | "exclusive_session", reason: string | null) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);
    try {
      if (kind === "exclusive_session") {
        await rejectExclusiveSessionRequest({ requestId, rejectionReason: reason });
      } else {
        await rejectMeetGreetRequest({ requestId, rejectionReason: reason });
      }
      showMyGroupsToast(tServices("successRequestRejected"));
    } catch (e: unknown) {
      showMyGroupsToast((e instanceof Error ? e.message : null) ?? tServices("errorRejectRequest"), "error");
      throw e;
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handleKeepSchedule(requestId: string, kind: "meet_greet" | "exclusive_session") {
    try {
      if (kind === "exclusive_session") {
        await declineExclusiveSessionReschedule({ requestId });
      } else {
        await declineMeetGreetReschedule(requestId);
      }
    } catch {
      // silently ignore — overlay closes either way
    }
  }

  async function handleCreatorScheduleDirect(requestId: string, kind: "meet_greet" | "exclusive_session", scheduledAtIso: string | null, note: string | null) {
    if (!scheduledAtIso) {
      setMeetGreetError(requestId, tServices("selectDateTimeError"));
      return;
    }
    const selectedDate = new Date(scheduledAtIso);
    const conflict = getWalletScheduleConflictResult(
      { id: requestId, source: kind, scheduledAt: selectedDate, durationMinutes: kind === "exclusive_session" ? 60 : 30 },
      ownerCalendarItems
    );
    if (conflict.hasConflict) {
      setMeetGreetError(requestId, conflict.message ?? tServices("scheduleConflictError"));
      return;
    }
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);
    try {
      const payload = { requestId, scheduledAt: scheduledAtIso, note };
      if (kind === "exclusive_session") {
        await proposeExclusiveSessionSchedule(payload);
      } else {
        await proposeMeetGreetSchedule(payload);
      }
      showMyGroupsToast(tServices("successDateProposed"));
    } catch (e: unknown) {
      showMyGroupsToast((e instanceof Error ? e.message : null) ?? tServices("errorSaveDate"), "error");
      throw e;
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

    function renderMeetGreetFeedback(requestId: string) {
    const error = meetGreetErrorMap[requestId];
    const success = meetGreetSuccessMap[requestId];

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
    role: "creator"
  ) {
    return (
      <MeetGreetPreparationFullscreen
        open={!!preparationOpenMap[requestId]}
        onClose={() =>
          setPreparationOpenMap((prev) => ({
            ...prev,
            [requestId]: false,
          }))
        }
        role={role}
        sessionId={requestId}
        sessionType={req.type === "digital_meet_greet" ? "meet_greet" : "exclusive_session"}
        scheduledAtLabel={req.scheduledAt ? formatUnknownDate(req.scheduledAt) : null}
        durationMinutes={req.durationMinutes ?? null}
      />
    );
  }

  const ownerCalendarItems = useMemo<WalletServiceItem[]>(() => {
    const groupNameById = new Map(
      myGroups.map((group) => [group.id, group.name ?? null])
    );

    const meetGreetItems: WalletServiceItem[] = Object.entries(
      meetGreetsByGroup
    ).flatMap(([groupId, rows]) =>
      rows.map((row) => ({
        id: row.id,
        kind: "meet_greet" as const,
        title: "Sesión en vivo",
        groupId,
        groupName: groupNameById.get(groupId) ?? null,
        profileUserId: null,
        profileDisplayName: null,
        profileUsername: null,
        requestSource: "group" as const,
        buyerId: row.data.buyerId ?? "",
        buyerDisplayName: row.data.buyerDisplayName ?? null,
        buyerUsername: row.data.buyerUsername ?? null,
        buyerAvatarUrl: row.data.buyerAvatarUrl ?? null,
        sourceAvatarUrl: null,
        muxPlaybackId: null,
        videoDuration: null,
        deliveredAt: null,
        targetName: null,
        requestText: row.data.buyerMessage ?? null,
        status: row.data.status,
        statusLabel: getMeetGreetStatusLabel(row.data.status, tSessions),
        description: row.data.buyerMessage ?? null,
        creatorScheduleNote: getCreatorScheduleNote(row.data),
        creatorScheduleNoteUpdatedAt: toDateSafe(
          row.data.creatorScheduleNoteUpdatedAt
        ),
        rejectionReason: row.data.rejectionReason ?? null,
        refundReason: row.data.refundReason ?? null,
        priceSnapshot:
          typeof row.data.priceSnapshot === "number"
            ? row.data.priceSnapshot
            : null,
        currency: getRequestCurrency(row.data) === "USD" ? "USD" : "MXN",
        durationMinutes:
          typeof row.data.durationMinutes === "number"
            ? row.data.durationMinutes
            : null,
        source: "meet_greet" as const,
        scheduledAt: toDateSafe(row.data.scheduledAt),
        acceptedAt: toDateSafe(row.data.acceptedAt),
        rejectedAt: toDateSafe(row.data.rejectedAt),
        preparingBuyerAt: toDateSafe(row.data.preparingBuyerAt),
        preparingCreatorAt: toDateSafe(row.data.preparingCreatorAt),
        preparationOpenedAt: toDateSafe(row.data.preparationOpenedAt),
        noShowRejectAt: toDateSafe(row.data.noShowRejectAt),
        autoRejectedAt: toDateSafe(row.data.autoRejectedAt),
        autoRejectReason: row.data.autoRejectReason ?? null,
        noShowRole: row.data.noShowRole ?? null,
        createdAt: toDateSafe(row.data.createdAt),
        updatedAt: toDateSafe(row.data.updatedAt),
        creatorScheduleCount: Array.isArray((row.data as { scheduleHistory?: unknown[] }).scheduleHistory) ? (row.data as { scheduleHistory: unknown[] }).scheduleHistory.length : 0,
        scheduleHistory: Array.isArray((row.data as { scheduleHistory?: unknown[] }).scheduleHistory) ? ((row.data as { scheduleHistory: unknown[] }).scheduleHistory as WalletServiceItem["scheduleHistory"]) : [],
        rescheduleHistory: Array.isArray((row.data as { rescheduleHistory?: unknown[] }).rescheduleHistory) ? ((row.data as { rescheduleHistory: unknown[] }).rescheduleHistory as WalletServiceItem["rescheduleHistory"]) : [],
        recordingStatus: null,
        recordingUrl: null,
        recordingDurationSeconds: null,
        recordingExpiresAt: null,
      }))
    );

    const exclusiveSessionItems: WalletServiceItem[] = Object.entries(
      exclusiveSessionsByGroup
    ).flatMap(([groupId, rows]) =>
      rows.map((row) => ({
        id: row.id,
        kind: "exclusive_session" as const,
        title: tServices("exclusiveSession"),
        groupId,
        groupName: groupNameById.get(groupId) ?? null,
        profileUserId: null,
        profileDisplayName: null,
        profileUsername: null,
        requestSource: "group" as const,
        buyerId: row.data.buyerId ?? "",
        buyerDisplayName: row.data.buyerDisplayName ?? null,
        buyerUsername: row.data.buyerUsername ?? null,
        buyerAvatarUrl: row.data.buyerAvatarUrl ?? null,
        sourceAvatarUrl: null,
        muxPlaybackId: null,
        videoDuration: null,
        deliveredAt: null,
        targetName: null,
        requestText: row.data.buyerMessage ?? null,
        status: row.data.status,
        statusLabel: getMeetGreetStatusLabel(row.data.status, tSessions),
        description: row.data.buyerMessage ?? null,
        creatorScheduleNote: getCreatorScheduleNote(row.data),
        creatorScheduleNoteUpdatedAt: toDateSafe(
          row.data.creatorScheduleNoteUpdatedAt
        ),
        rejectionReason: row.data.rejectionReason ?? null,
        refundReason: row.data.refundReason ?? null,
        priceSnapshot:
          typeof row.data.priceSnapshot === "number"
            ? row.data.priceSnapshot
            : null,
        currency: getRequestCurrency(row.data) === "USD" ? "USD" : "MXN",
        durationMinutes:
          typeof row.data.durationMinutes === "number"
            ? row.data.durationMinutes
            : null,
        source: "exclusive_session" as const,
        scheduledAt: toDateSafe(row.data.scheduledAt),
        acceptedAt: toDateSafe(row.data.acceptedAt),
        rejectedAt: toDateSafe(row.data.rejectedAt),
        preparingBuyerAt: toDateSafe(row.data.preparingBuyerAt),
        preparingCreatorAt: toDateSafe(row.data.preparingCreatorAt),
        preparationOpenedAt: toDateSafe(row.data.preparationOpenedAt),
        noShowRejectAt: toDateSafe(row.data.noShowRejectAt),
        autoRejectedAt: toDateSafe(row.data.autoRejectedAt),
        autoRejectReason: row.data.autoRejectReason ?? null,
        noShowRole: row.data.noShowRole ?? null,
        createdAt: toDateSafe(row.data.createdAt),
        updatedAt: toDateSafe(row.data.updatedAt),
        creatorScheduleCount: Array.isArray((row.data as { scheduleHistory?: unknown[] }).scheduleHistory) ? (row.data as { scheduleHistory: unknown[] }).scheduleHistory.length : 0,
        scheduleHistory: Array.isArray((row.data as { scheduleHistory?: unknown[] }).scheduleHistory) ? ((row.data as { scheduleHistory: unknown[] }).scheduleHistory as WalletServiceItem["scheduleHistory"]) : [],
        rescheduleHistory: Array.isArray((row.data as { rescheduleHistory?: unknown[] }).rescheduleHistory) ? ((row.data as { rescheduleHistory: unknown[] }).rescheduleHistory as WalletServiceItem["rescheduleHistory"]) : [],
        recordingStatus: null,
        recordingUrl: null,
        recordingDurationSeconds: null,
        recordingExpiresAt: null,
      }))
    );

    return [...meetGreetItems, ...exclusiveSessionItems];
  }, [myGroups, meetGreetsByGroup, exclusiveSessionsByGroup]);

  return (
    <>
<VibraNavigationIconsStyles />
<style jsx global>{`
  .ownerInviteMagicOrbit {
    position: absolute;
    inset: -9px;
    border-radius: 999px;
    pointer-events: none;
    z-index: 3;
    overflow: hidden;
  }

  .ownerInviteMagicParticle {
    position: absolute;
    left: 50%;
    top: 50%;
width: 3.2px;
height: 3.2px;
    border-radius: 999px;
    opacity: 0;
    background: rgb(236, 72, 153);
    box-shadow: 0 0 5px rgba(236, 72, 153, 0.42);
    animation-name: ownerInviteMagicFloat;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
    will-change: transform, opacity, background, box-shadow;
  }

  .ownerInviteMagicParticle1 {
    animation-duration: 8.4s;
    animation-delay: -0.8s;
    --x1: -7px;
    --y1: -5px;
    --x2: 4px;
    --y2: -8px;
    --x3: 8px;
    --y3: 2px;
    --x4: -2px;
    --y4: 7px;
    --color-a: rgb(236, 72, 153);
    --glow-a: rgba(236, 72, 153, 0.42);
    --color-b: rgb(168, 85, 247);
    --glow-b: rgba(168, 85, 247, 0.38);
  }

  .ownerInviteMagicParticle2 {
    animation-duration: 9.6s;
    animation-delay: -2.4s;
    --x1: 7px;
    --y1: -4px;
    --x2: -5px;
    --y2: -7px;
    --x3: -8px;
    --y3: 3px;
    --x4: 3px;
    --y4: 8px;
    --color-a: rgb(168, 85, 247);
    --glow-a: rgba(168, 85, 247, 0.40);
    --color-b: rgb(59, 130, 246);
    --glow-b: rgba(59, 130, 246, 0.36);
  }

  .ownerInviteMagicParticle3 {
    animation-duration: 10.8s;
    animation-delay: -4s;
    --x1: -3px;
    --y1: 8px;
    --x2: 8px;
    --y2: 5px;
    --x3: 5px;
    --y3: -7px;
    --x4: -8px;
    --y4: -2px;
    --color-a: rgb(59, 130, 246);
    --glow-a: rgba(59, 130, 246, 0.38);
    --color-b: rgb(236, 72, 153);
    --glow-b: rgba(236, 72, 153, 0.38);
  }

  .ownerInviteMagicParticle4 {
    animation-duration: 11.2s;
    animation-delay: -5.6s;
    --x1: 2px;
    --y1: -8px;
    --x2: 8px;
    --y2: -1px;
    --x3: -4px;
    --y3: 8px;
    --x4: -7px;
    --y4: -4px;
    --color-a: rgb(236, 72, 153);
    --glow-a: rgba(236, 72, 153, 0.36);
    --color-b: rgb(59, 130, 246);
    --glow-b: rgba(59, 130, 246, 0.36);
  }

  .ownerInviteMagicParticle5 {
    animation-duration: 12.4s;
    animation-delay: -7.2s;
    --x1: 8px;
    --y1: 3px;
    --x2: 1px;
    --y2: 8px;
    --x3: -7px;
    --y3: 1px;
    --x4: 4px;
    --y4: -8px;
    --color-a: rgb(168, 85, 247);
    --glow-a: rgba(168, 85, 247, 0.36);
    --color-b: rgb(236, 72, 153);
    --glow-b: rgba(236, 72, 153, 0.36);
  }

  @keyframes ownerInviteMagicFloat {
    0% {
      opacity: 0.24;
      background: var(--color-a);
      box-shadow: 0 0 4px var(--glow-a);
      transform: translate3d(var(--x1), var(--y1), 0) scale(0.72);
    }

    28% {
      opacity: 0.72;
      background: var(--color-b);
      box-shadow: 0 0 6px var(--glow-b);
      transform: translate3d(var(--x2), var(--y2), 0) scale(0.95);
    }

    58% {
      opacity: 0.54;
      background: var(--color-a);
      box-shadow: 0 0 5px var(--glow-a);
      transform: translate3d(var(--x3), var(--y3), 0) scale(0.82);
    }

    82% {
      opacity: 0.66;
      background: var(--color-b);
      box-shadow: 0 0 6px var(--glow-b);
      transform: translate3d(var(--x4), var(--y4), 0) scale(0.92);
    }

    100% {
      opacity: 0.24;
      background: var(--color-a);
      box-shadow: 0 0 4px var(--glow-a);
      transform: translate3d(var(--x1), var(--y1), 0) scale(0.72);
    }
  }
`}</style>
      {!loadingGroups &&
  myGroups.length === 0 &&
  !ownedGrouped.some((section) =>
    section.items.some((item) => item.visibility === "profile")
  ) && (
    <div
      style={{
        fontSize: 12,
        color: "rgba(255,255,255,0.58)",
        padding: "2px 2px 0",
      }}
    >
      {tGroups("noOwnerCommunities")}
    </div>
  )}

      {ownedGrouped.map((section, sectionIndex) => (
        <div key={section.key} style={{ display: "grid", gap: 7 }}>
                    <div style={styles.sectionHeaderRow}>
            <div style={styles.sectionTitle}>{section.title}</div>

            {myGroups.some((item) => item.visibility !== "profile") && sectionIndex === 0 ? ( 
              <button
                type="button"
                onClick={onCreateCommunity}
                style={styles.createInlineButton}
                aria-label={tNav("createCommunityLabel")}
                title={tNav("createCommunityLabel")}
              >
                <span aria-hidden="true">+</span>
                <span>{tCommon("create")}</span>
              </button>
            ) : null}
          </div>

          {section.items.map((g) => {
const isOpen = openCommunities[g.id] === true;
const isPublic = g.visibility === "public";
const isInviteEligible = g.visibility === "hidden";

const communityName = g.name ?? tGroups("noName");
const avatarFallback = getInitials(communityName);
const isProfileCard = g.visibility === "profile";

const profileHref = g.profileHref ?? (g.handle ? `/u/${g.handle}` : null);

const isSelectedGroup = (isProfileCard
  ? !!profileHref && pathname === profileHref
  : pathname === `/groups/${g.id}`)
  || (isMobile && isOpen);

            const joinRequests = joinRequestsByGroup[g.id] ?? [];
            const greetings = greetingsByGroup[g.id] ?? [];
            const meetGreets = meetGreetsByGroup[g.id] ?? [];
            const exclusiveSessions = exclusiveSessionsByGroup[g.id] ?? [];

const canShowLinkAction = true;
const copyHref = isProfileCard
  ? g.profileHref ?? (g.handle ? `/u/${g.handle}` : "/")
  : `/groups/${g.id}`;
const copyTitle = isProfileCard
  ? tCommon("copyProfileLink")
  : tCommon("copyGroupLink");

            const meetGreetServiceRequests = meetGreets
              .filter((row) => isServiceRequestAlertStatus(row.data.status))
              .map((row) => ({
                ...row,
                serviceKind: "meet_greet" as const,
              }));

            const exclusiveSessionServiceRequests = exclusiveSessions
              .filter((row) => isServiceRequestAlertStatus(row.data.status))
              .map((row) => ({
                ...row,
                serviceKind: "exclusive_session" as const,
              }));

            const scheduledServiceRequests = [
              ...meetGreetServiceRequests,
              ...exclusiveSessionServiceRequests,
            ];

            const upcomingScheduledServices = [
              ...meetGreets.map((row) => ({
                ...row,
                serviceKind: "meet_greet" as const,
              })),
              ...exclusiveSessions.map((row) => ({
                ...row,
                serviceKind: "exclusive_session" as const,
              })),
            ].filter((row) => {
              if (!isUpcomingServiceStatus(row.data.status)) return false;

              if (
                shouldHideExpiredPreparationAlert(
                  row.data.status,
                  row.data.scheduledAt
                )
              ) {
                return false;
              }

              return isPreparationVisibleWindow(row.data.scheduledAt);
            });
                        const greetingServiceCount = greetings.length;
            const scheduledServiceRequestCount = scheduledServiceRequests.length;
            const upcomingServiceCount = upcomingScheduledServices.length;

            const totalServiceCount =
                  greetingServiceCount + scheduledServiceRequestCount;
            const cardBadgeCount = totalServiceCount + joinRequests.length;

            const sortedGreetings = [...greetings].sort((a, b) => {
              const aTime = toDateSafe(a.data.createdAt)?.getTime() ?? 0;
              const bTime = toDateSafe(b.data.createdAt)?.getTime() ?? 0;
              return aTime - bTime;
            });

            const sortedScheduledServiceRequests = [
              ...scheduledServiceRequests,
            ].sort((a, b) => {
              const aTime = toDateSafe(a.data.createdAt)?.getTime() ?? 0;
              const bTime = toDateSafe(b.data.createdAt)?.getTime() ?? 0;
              return aTime - bTime;
            });

            const showJoinSection = !isPublic && joinRequests.length > 0;
            const showGreetingsSection = totalServiceCount > 0;
            const showUpcomingSection = upcomingServiceCount > 0;

            const greetingListOpen = greetingSectionOpen[g.id] === true;
            const joinListOpen = joinSectionOpen[g.id] === true;

            const hasPreparingAlert = upcomingServiceCount > 0;

            const currentJoinCount = showJoinSection ? joinRequests.length : 0;

            const currentGreetingCount = showGreetingsSection
              ? greetings.length + scheduledServiceRequests.length
              : 0;

            const seen = seenCountsByGroup[g.id] ?? {
              join: 0,
              greeting: 0,
            };

            const hasNewJoin = currentJoinCount > seen.join;
            const hasNewGreeting = currentGreetingCount > seen.greeting;

            const hasOwnerSidebarAlerts =
  showJoinSection ||
  showGreetingsSection ||
  showUpcomingSection ||
  hasNewJoin ||
  hasNewGreeting ||
  hasPreparingAlert;

            const handleToggle = () => {
              const nextOpen = !openCommunities[g.id];
              setOpenCommunities(nextOpen ? { [g.id]: true } : { [g.id]: false });
              if (nextOpen) {
                setSeenCountsByGroup((prev) => ({
                  ...prev,
                  [g.id]: {
                    join: currentJoinCount,
                    greeting: currentGreetingCount,
                  },
                }));
              }
            };

            return (
              <div
                key={g.id}
                style={{
                  borderRadius: 16,
                }}
              >
                <div
style={{
  ...styles.card,
  border: "none",
  margin: 0,
  borderRadius: 16,
background:
  !isSelectedGroup
    ? "transparent"
    : "linear-gradient(90deg, rgba(236,72,153,0.20) 0%, rgba(147,51,234,0.18) 42%, rgba(59,130,246,0.14) 100%)",
boxShadow:
  !isSelectedGroup
    ? "none"
    : "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 24px rgba(0,0,0,0.22)",
}}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      ...(hasOwnerSidebarAlerts ? { cursor: "pointer" } : {}),
                    }}
                    onClick={hasOwnerSidebarAlerts ? handleToggle : undefined}
                  >
<Link
  href={
    g.visibility === "profile"
      ? g.profileHref ?? (g.handle ? `/u/${g.handle}` : "/")
      : `/groups/${g.id}`
  }
  onClick={(e) => {
    e.stopPropagation();
    if (g.visibility === "profile" && !g.profileHref && !g.handle) {
      e.preventDefault();
    }
  }}
  style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        color: "#fff",
                        textAlign: "left",
                        cursor:
                           g.visibility === "profile" && !g.profileHref && !g.handle
                            ? "default"
                            : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        minWidth: 0,
                        flex: 1,
                        textDecoration: "none",
                      }}
                    >
                      <LiveRingAvatar
                        entityId={g.visibility === "profile" ? (g.ownerId ?? g.id) : g.id}
                        entityType={g.visibility === "profile" ? "profile" : "group"}
                        currentUserId={null}
                        photoURL={g.avatarUrl ?? null}
                        displayName={communityName}
                        size={isMobile ? 43 : 36}
                        style={{ flexShrink: 0 }}
                      />
                                            <div
                        style={{
                          minWidth: 0,
                          display: "grid",
                          gap: 4,
                          flex: 1,
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
    fontSize: 13,
    fontWeight: isProfileCard ? 600 : 550,
    fontFamily:
      'inherit',
    letterSpacing: "-0.08px",
    color: "rgba(255,255,255,0.94)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  }}
>
  {communityName}
</span>

                        </div>
                        {(newPostsCounts[g.id] ?? 0) > 0 && (
                          <div
                            style={{
                              fontSize: 10.5,
                              color: "#a855f7",
                              fontWeight: 700,
                              lineHeight: 1.3,
                              marginTop: 1,
                            }}
                          >
                            {tCommon("newPostsCount", { count: newPostsCounts![g.id] })}
                          </div>
                        )}
                      </div>
                    </Link>
{hasOwnerSidebarAlerts ? (
  <button
    type="button"
    aria-label={
      isOpen
        ? tGroups("closeCommunityOptions")
        : tGroups("openCommunityOptions")
    }
    style={{
      border: "none",
      background: "transparent",
      padding: 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      flexShrink: 0,
    }}
  >
    <span
      style={{
        width: 20,
        height: 20,
        minWidth: 20,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)",
        boxShadow: "0 2px 8px rgba(236,72,153,0.50), 0 0 10px rgba(168,85,247,0.40)",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {cardBadgeCount > 9 ? "+9" : cardBadgeCount}
    </span>
  </button>
) : null}

{canShowLinkAction && (
  isInviteEligible ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setInviteGroupId(g.id); }}
      title={tGroups("generateInviteLink")}
      aria-label={tGroups("generateInviteLink")}
      style={{
        flexShrink: 0,
        marginLeft: "auto",
        width: 24,
        height: 24,
        border: "none",
        background: "transparent",
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        cursor: "pointer",
        opacity: isMobile ? 0.85 : 0.65,
        position: "relative",
        overflow: "visible",
      }}
    >
      <VibraNavigationIcon type="copyLink" size={21} />

      <span aria-hidden="true" className="ownerInviteMagicOrbit">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className={`ownerInviteMagicParticle ownerInviteMagicParticle${index + 1}`}
          />
        ))}
      </span>
    </button>
  ) : (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ flexShrink: 0, marginLeft: "auto", display: "inline-flex" }}
    >
      <CopyLinkButton
        href={copyHref}
        title={copyTitle}
      />
    </div>
  )
)}
                  </div>

                  {hasOwnerSidebarAlerts && (
                    <div
                      style={{
                        maxHeight: isOpen ? "1200px" : "0",
                        overflow: "hidden",
                        opacity: isOpen ? 1 : 0,
                        transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
                      }}
                    >
                    <div
                      style={{
                        marginTop: 9,
                        paddingTop: 9,
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      {isInviteEligible && (
                        <div style={styles.sectionPanel}>
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#fff",
                                  fontWeight: 700,
                                }}
                              >
                                {tGroups("inviteLinkTitle")}
                              </span>

                              <span style={styles.subtle}>
                                {tGroups("inviteLinkSubtitleFull")}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => setInviteGroupId(g.id)}
                              style={{
                                ...styles.buttonSecondary,
                                width: "100%",
                              }}
                            >
                              {tGroups("generateInviteLink")}
                            </button>
                          </div>
                        </div>
                      )}
                                            {showJoinSection && (
                        <div style={{ ...styles.sectionPanel, gap: 0 }}>
                          <button
                            type="button"
                            onClick={() => {
                              const opening = !joinSectionOpen[g.id];
                              setJoinSectionOpen((prev) => ({ ...prev, [g.id]: opening }));
                              if (opening) {
                                setGreetingSectionOpen((prev) => ({ ...prev, [g.id]: false }));
                                setMeetGreetSectionOpen((prev) => ({ ...prev, [g.id]: false }));
                              }
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "0 6px 0 0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              width: "100%",
                              color: "#fff",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                color: "rgba(255,255,255,0.94)",
                                fontWeight: 550,
                              }}
                            >
                              {tGroups("joinRequestSectionTitle")}
                            </span>

                            <CountBadge count={joinRequests.length} tone="pink" />
                          </button>

                          <div
                            style={{
                              maxHeight: joinListOpen ? "600px" : "0",
                              overflow: "hidden",
                              opacity: joinListOpen ? 1 : 0,
                              transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
                            }}
                          >
                            <div className="mini-vertical-scroll" style={{ paddingTop: 8 }}>
                              <div style={{ display: "grid", gap: 7 }}>
                                {joinRequests.map((r) => {
                                  const approveKey = `${g.id}:${r.userId}:approve`;
                                  const rejectKey = `${g.id}:${r.userId}:reject`;
                                  const busy =
                                    joinBusyKey === approveKey ||
                                    joinBusyKey === rejectKey;

                                  const requester = userMiniMap[r.userId] ?? null;
                                  const letter = getInitials(
                                    requester?.displayName
                                  );

                                  return (
                                    <div key={r.id} style={styles.miniItem}>
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 8,
                                          minWidth: 0,
                                        }}
                                      >
                                        {requester?.photoURL ? (
                                          <Image
                                            src={requester.photoURL}
                                            alt={requester.displayName}
                                            width={28} height={28}
                                            style={{
                                              borderRadius: 10,
                                              objectFit: "cover",
                                              border: "1px solid rgba(255,255,255,0.12)",
                                              flexShrink: 0,
                                            }}
                                          />
                                        ) : (
                                          <div
                                            style={{
                                              width: 28,
                                              height: 28,
                                              borderRadius: 10,
                                              background:
                                                "rgba(255,255,255,0.05)",
                                              border:
                                                "1px solid rgba(255,255,255,0.12)",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              fontWeight: 700,
                                              fontSize: 11,
                                              color: "#fff",
                                              flexShrink: 0,
                                            }}
                                          >
                                            {letter}
                                          </div>
                                        )}

                                        <div style={{ minWidth: 0 }}>
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 6,
                                              minWidth: 0,
                                              flexWrap: "wrap",
                                            }}
                                          >
                                            {renderUserLink(r.userId)}
                                          </div>

                                          <div style={styles.subtle}>
                                            {tGroups("joinRequestPending")}
                                          </div>
                                        </div>
                                      </div>

                                      <div
                                        style={{
                                          display: "flex",
                                          gap: 6,
                                          width: "100%",
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleApproveJoin(g.id, r.userId)
                                          }
                                          disabled={busy}
                                          style={{
                                            flex: 1,
                                            height: 30,
                                            borderRadius: 8,
                                            border: "none",
                                            background: "rgba(59,130,246,0.18)",
                                            color: "#93c5fd",
                                            fontWeight: 520,
                                            fontSize: 12,
                                            cursor: busy ? "not-allowed" : "pointer",
                                            fontFamily: "inherit",
                                            opacity: busy ? 0.6 : 1,
                                          }}
                                        >
                                          {busy ? tCommon("processing") : tGroups("approveButton")}
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleRejectJoin(g.id, r.userId)
                                          }
                                          disabled={busy}
                                          style={{
                                            flex: 1,
                                            height: 30,
                                            borderRadius: 8,
                                            border: "none",
                                            background: "rgba(239,68,68,0.15)",
                                            color: "#fca5a5",
                                            fontWeight: 520,
                                            fontSize: 12,
                                            cursor: busy ? "not-allowed" : "pointer",
                                            fontFamily: "inherit",
                                            opacity: busy ? 0.6 : 1,
                                          }}
                                        >
                                          {busy ? "..." : tCommon("reject")}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {greetingServiceCount > 0 && (
                        <div style={{ ...styles.sectionPanel, gap: 0 }}>
                          <button
                            type="button"
                            onClick={() => {
                              const opening = !greetingSectionOpen[g.id];
                              setGreetingSectionOpen((prev) => ({ ...prev, [g.id]: opening }));
                              if (opening) {
                                setJoinSectionOpen((prev) => ({ ...prev, [g.id]: false }));
                                setMeetGreetSectionOpen((prev) => ({ ...prev, [g.id]: false }));
                              }
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "0 6px 0 0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              width: "100%",
                              color: "#fff",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                color: "rgba(255,255,255,0.94)",
                                fontWeight: 550,
                              }}
                            >
                              {tGroups("greetingsAndAdviceSection")}
                            </span>
                            <CountBadge count={greetingServiceCount} tone="pink" />
                          </button>

                          <div
                            style={{
                              maxHeight: greetingListOpen ? "600px" : "0",
                              overflow: "hidden",
                              opacity: greetingListOpen ? 1 : 0,
                              transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
                            }}
                          >
                            <div className="mini-vertical-scroll" style={{ paddingTop: 8 }}>
                              <div style={{ display: "grid", gap: 10 }}>
                                {sortedGreetings.map((r) => {
                                  const req = r.data;
                                  const buyer = userMiniMap[req.buyerId] ?? null;
                                  const buyerLetter = getInitials(buyer?.displayName);

                                  const listEarning = greetingEarningsMap[`${g.id}_${req.type}`] ?? null;
                                  const reviewLabel = req.type === "consejo" ? tWallet("typeLabelAdvice") : req.type === "saludo" ? tWallet("typeLabelGreeting") : tWallet("typeLabelMessage");

                                  return (
                                    <div key={r.id} style={styles.miniItem}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                        {buyer?.photoURL ? (
                                          <Image
                                            src={buyer.photoURL}
                                            alt={buyer.displayName}
                                            width={28} height={28}
                                            style={{
                                              borderRadius: "50%",
                                              objectFit: "cover",
                                              border: "1px solid rgba(255,255,255,0.12)",
                                              flexShrink: 0,
                                            }}
                                          />
                                        ) : (
                                          <div
                                            style={{
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
                                            }}
                                          >
                                            {buyerLetter}
                                          </div>
                                        )}
                                        <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                                          {buyer?.handle ? (
                                            <Link
                                              href={`/u/${buyer.handle}`}
                                              style={{
                                                color: "#fff",
                                                fontWeight: 600,
                                                fontSize: 12,
                                                lineHeight: 1.2,
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
                                            <span style={{ color: "#fff", fontWeight: 600, fontSize: 12, lineHeight: 1.2 }}>
                                              {buyer?.displayName ?? tCommon("user")}
                                            </span>
                                          )}
                                          <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3 }}>
                                            {getRelativeTime(req.createdAt, tCommon)}
                                          </span>
                                        </div>
                                        {listEarning ? (
                                          <span style={{ color: "#86efac", fontSize: 11, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, flexShrink: 0 }}>{listEarning}</span>
                                        ) : null}
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => {
                                          const startIndex = allSortedGreetings.findIndex((item) => item.id === r.id);
                                          setReviewGreetingState({ items: allSortedGreetings, startIndex: startIndex >= 0 ? startIndex : 0 });
                                        }}
                                        style={{
                                          width: "100%",
                                          height: 30,
                                          borderRadius: 8,
                                          border: "none",
                                          background: "rgba(168,85,255,0.18)",
                                          color: "#d8b4fe",
                                          fontWeight: 520,
                                          fontSize: 12,
                                          cursor: "pointer",
                                          fontFamily: "inherit",
                                        }}
                                      >
                                        {reviewLabel}
                                      </button>
                                    </div>
                                  );
                                })}

                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {scheduledServiceRequests.length > 0 && (
                        <div style={{ ...styles.sectionPanel, gap: 0, background: "rgba(59,130,246,0.11)" }}>
                          <button
                            type="button"
                            onClick={() => {
                              const opening = !meetGreetSectionOpen[g.id];
                              setMeetGreetSectionOpen((prev) => ({ ...prev, [g.id]: opening }));
                              if (opening) {
                                setJoinSectionOpen((prev) => ({ ...prev, [g.id]: false }));
                                setGreetingSectionOpen((prev) => ({ ...prev, [g.id]: false }));
                              }
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "0 6px 0 0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              width: "100%",
                              color: "#fff",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                color: "rgba(255,255,255,0.94)",
                                fontWeight: 550,
                              }}
                            >
                              {tGroups("liveSessionsSection")}
                            </span>
                            <CountBadge count={scheduledServiceRequests.length} tone="pink" />
                          </button>
                          <div
                            style={{
                              maxHeight: meetGreetSectionOpen[g.id] === true ? "600px" : "0",
                              overflow: "hidden",
                              opacity: meetGreetSectionOpen[g.id] === true ? 1 : 0,
                              transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
                            }}
                          >
                            <div className="mini-vertical-scroll" style={{ paddingTop: 8 }}>
                              <div style={{ display: "grid", gap: 10 }}>
                                {sortedScheduledServiceRequests.map((r) => {
                                  const req = r.data;
                                  const busy = !!meetGreetBusyMap[r.id];
                                  const sessionEarning =
                                    req.priceSnapshot != null && req.priceSnapshot > 0
                                      ? "$" + new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(req.priceSnapshot * 0.77) + " MXN"
                                      : null;

                                  return (
                                    <div key={`${r.serviceKind}-${r.id}`} style={styles.miniItem}>
                                      {/* Fila resumen */}
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                        {req.buyerAvatarUrl ? (
                                          <Image src={req.buyerAvatarUrl} alt={req.buyerDisplayName ?? ""} width={28} height={28} style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }} />
                                        ) : (
                                          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, color: "#fff", flexShrink: 0 }}>
                                            {getInitials(req.buyerDisplayName)}
                                          </div>
                                        )}
                                        <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                                          <span style={{ color: "#fff", fontWeight: 600, fontSize: 12, lineHeight: 1.2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {req.buyerDisplayName ?? tCommon("user")}
                                          </span>
                                          <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3 }}>
                                            {getRelativeTime(req.createdAt, tCommon)}
                                          </span>
                                        </div>
                                        {sessionEarning ? (
                                          <span style={{ color: "#86efac", fontSize: 11, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, flexShrink: 0 }}>{sessionEarning}</span>
                                        ) : null}
                                      </div>

                                      {/* Botón → abre overlay */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSessionOverlayData({ id: r.id, req, serviceKind: r.serviceKind });
                                          setSessionOverlayOpen(true);
                                        }}
                                        disabled={busy}
                                        style={{ width: "100%", height: 30, borderRadius: 8, border: "none", background: "rgba(59,130,246,0.18)", color: "#93c5fd", fontWeight: 520, fontSize: 12, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}
                                      >
                                        {busy ? tCommon("processing") : req.status === "reschedule_requested" ? tServices("reschedule") : tServices("schedule")}
                                      </button>
                                    </div>
                                  );

                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}


                      <div
                        style={{
                          fontSize: 10,
                          lineHeight: 1.35,
                          color: "rgba(255,255,255,0.36)",
                          padding: "0 2px 2px",
                        }}
                      ></div>
                    </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
{sectionIndex === lastRealGroupSectionIndex && isMobile ? (
  <Link
    href="/groups/new"
    aria-label={tNav("createCommunityLabel")}
    title={tNav("createCommunityLabel")}
    style={{
      width: "100%",
      marginTop: 10,
      borderRadius: 22,
      overflow: "hidden",
      textDecoration: "none",
      display: "block",
      border: "1px solid rgba(255,255,255,0.10)",
      background:
        "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.035))",
      boxShadow: "0 18px 38px rgba(0,0,0,0.28)",
    }}
  >
    <div
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        backgroundImage: "url('/Crear-comunidad.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />

<div
  style={{
    display: "grid",
    gap: 8,
    padding: "13px 13px 14px",
    textAlign: "center",
    justifyItems: "center",
  }}
>
      <div
        style={{
fontSize: 15,
fontWeight: 600,
fontFamily:
  'inherit',
color: "#fff",
letterSpacing: "-0.18px",
lineHeight: 1.15,
        }}
      >
        Crea tu comunidad
      </div>

      <div
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.66)",
          lineHeight: 1.35,
maxWidth: 220,
        }}
      >
        Conecta, comparte y monetiza tu pasión.
      </div>

      <div
        style={{
          width: "100%",
          minHeight: 38,
          borderRadius: 14,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          background:
            "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)",
          boxShadow: "0 12px 28px rgba(147,51,234,0.32)",
          fontFamily:
  'inherit',
        }}
      >
        Crear comunidad
      </div>
    </div>
  </Link>
) : null}
        </div>
      ))}

      {inviteGroupId && (
        <InviteLinkModal
          groupId={inviteGroupId}
          onClose={() => setInviteGroupId(null)}
        />
      )}

      {reviewGreetingState && (
        <GreetingReviewOverlay
          items={reviewGreetingState.items}
          startIndex={reviewGreetingState.startIndex}
          buyers={userMiniMap}
          greetingBusyId={greetingBusyId}
          onAccept={async (id) => {
            await handleGreetingAction(id, "accept");
            setReviewGreetingState(null);
          }}
          onReject={async (id) => {
            await handleGreetingAction(id, "reject");
            setReviewGreetingState(null);
          }}
          onClose={() => setReviewGreetingState(null)}
          getInitials={getInitials}
          typeLabel={typeLabel}
        />
      )}
      {sessionOverlayData && (
        <SessionRequestOverlay
          open={sessionOverlayOpen}
          onClose={() => {
            setSessionOverlayOpen(false);
            setTimeout(() => setSessionOverlayData(null), 300);
          }}
          request={sessionOverlayData.req}
          requestId={sessionOverlayData.id}
          serviceKind={sessionOverlayData.serviceKind}
          earning={
            sessionOverlayData.req.priceSnapshot != null && sessionOverlayData.req.priceSnapshot > 0
              ? "$" + new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(sessionOverlayData.req.priceSnapshot * 0.77) + " MXN"
              : null
          }
          busy={!!meetGreetBusyMap[sessionOverlayData.id]}
          feedbackError={meetGreetErrorMap[sessionOverlayData.id] ?? null}
          feedbackSuccess={meetGreetSuccessMap[sessionOverlayData.id] ?? null}
          ownerCalendarItems={ownerCalendarItems}
          getInitials={getInitials}
          onAccept={() => handleCreatorAccept(sessionOverlayData.id, sessionOverlayData.serviceKind)}
          onReject={(reason) => handleCreatorRejectDirect(sessionOverlayData.id, sessionOverlayData.serviceKind, reason)}
          onSchedule={(scheduledAtIso, note) => handleCreatorScheduleDirect(sessionOverlayData.id, sessionOverlayData.serviceKind, scheduledAtIso, note)}
          onAcceptAndSchedule={(scheduledAtIso, note) => handleCreatorAcceptAndSchedule(sessionOverlayData.id, sessionOverlayData.serviceKind, scheduledAtIso, note)}
          onPrepare={() => handlePrepare(sessionOverlayData.id, "creator", sessionOverlayData.serviceKind)}
          preparationNode={renderPreparationPanel(sessionOverlayData.id, sessionOverlayData.req, (preparationRoleMap[sessionOverlayData.id] as "creator") ?? "creator")}
          onReschedule={(item, scheduledAt) => handleRescheduleConfirm(item, scheduledAt, null)}
          onKeepSchedule={() => handleKeepSchedule(sessionOverlayData.id, sessionOverlayData.serviceKind)}
        />
      )}

      {rescheduleNotification && (() => {
        const d = rescheduleNotification.newScheduledAt ? new Date(rescheduleNotification.newScheduledAt) : null;
        const isExclusive = rescheduleNotification.source === "exclusive_session";
        const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
        const formattedDate = d ? (() => {
          const weekday = cap(d.toLocaleDateString("es-MX", { weekday: "long" }));
          const month = cap(d.toLocaleDateString("es-MX", { month: "long" }));
          return `${weekday} ${d.getDate()} de ${month} ${d.getFullYear()}`;
        })() : null;
        const formattedTime = d ? d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }) + " hrs" : null;

        return (
          <div style={{
            position: "fixed", inset: 0, width: "100vw", height: "100vh",
            zIndex: 1000001, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, background: "rgba(0,0,0,0.88)", fontFamily: "inherit",
          }}>
            <div style={{
              width: "min(420px, 100%)", borderRadius: 18, background: "#0a0a0a",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
              color: "#fff", padding: "28px 24px 24px",
              display: "flex", flexDirection: "column", gap: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                  background: isExclusive ? "rgba(190,24,93,0.22)" : "rgba(29,78,216,0.22)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke={isExclusive ? "#f472b6" : "#60a5fa"} strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>
                    {tServices("rescheduleNotificationTitle")}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.50)" }}>
                    {isExclusive ? tServices("exclusiveSession") : tSessions("meetGreetTitle")}
                  </p>
                </div>
              </div>
              {formattedDate && (
                <div style={{
                  padding: "12px 14px", borderRadius: 12,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{formattedDate}</span>
                  {formattedTime && <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{formattedTime}</span>}
                </div>
              )}
              <button
                type="button"
                onClick={async () => {
                  const uid = auth.currentUser?.uid;
                  if (uid && rescheduleNotification.notifId) {
                    try {
                      await updateDoc(
                        doc(db, "users", uid, "notifications", rescheduleNotification.notifId),
                        { read: true }
                      );
                    } catch { /* no crítico */ }
                  }
                  setRescheduleNotification(null);
                }}
                style={{
                  width: "100%", height: 44, borderRadius: 12, border: "none",
                  background: isExclusive ? "#be185d" : "#1d4ed8",
                  color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
                  letterSpacing: "-0.02em",
                }}
              >
                {tCommon("understood")}
              </button>
            </div>
          </div>
        );
      })()}

      {postScheduleCalendar && (
        <ScheduleCalendarOverlay
          open
          title={tNav("calendar")}
          items={ownerCalendarItems}
          selectedDate={postScheduleCalendar.date}
          selectedVariant={postScheduleCalendar.kind === "exclusive_session" ? "pink" : "blue"}
          onClose={() => setPostScheduleCalendar(null)}
          onReschedule={(item, scheduledAt) => handleRescheduleConfirm(item, scheduledAt, null)}
          topContent={
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Título + círculo verde después del texto */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
                  {postScheduleCalendar.kind === "exclusive_session" ? tServices("exclusiveSessionScheduled") : tServices("liveSessionScheduled")}
                </span>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%", background: "#22c55e",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>

              {/* Avatar + nombre centrado + fecha/hora al final */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                  background: "rgba(255,255,255,0.08)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden",
                }}>
                  {postScheduleCalendar.req.buyerAvatarUrl
                    ? <img src={postScheduleCalendar.req.buyerAvatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{getInitials(postScheduleCalendar.req.buyerDisplayName)}</span>
                  }
                </div>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "#fff", letterSpacing: "-0.01em" }}>
                  {postScheduleCalendar.req.buyerDisplayName ?? postScheduleCalendar.req.buyerUsername ?? tCommon("buyer")}
                </span>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.70)" }}>
                    {(() => {
                      const d = postScheduleCalendar.date;
                      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
                      const weekday = cap(d.toLocaleDateString("es-MX", { weekday: "long" }));
                      const month = cap(d.toLocaleDateString("es-MX", { month: "long" }));
                      return `${weekday} ${d.getDate()} de ${month} ${d.getFullYear()}`;
                    })()}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.45)" }}>
                    {postScheduleCalendar.date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })} hrs
                  </span>
                </div>
              </div>

              {/* Mensaje del comprador */}
              {postScheduleCalendar.req.buyerMessage && (
                <BuyerMessagePlayer message={postScheduleCalendar.req.buyerMessage} />
              )}
            </div>
          }
        />
      )}
      <VibraToast toast={myGroupsToast} />
    </>
  );
}
