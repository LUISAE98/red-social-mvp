"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
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

type SessionRequest = MeetGreetRequestDoc | ExclusiveSessionRequestDoc;

export type SessionRequestOverlayProps = {
  open: boolean;
  onClose: () => void;
  request: SessionRequest;
  requestId: string;
  serviceKind: "meet_greet" | "exclusive_session";
  earning: string | null;
  busy: boolean;
  feedbackError: string | null;
  feedbackSuccess: string | null;
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

function toDateSafe(value: unknown): Date | null {
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

function formatUnknownDate(value: unknown): string | null {
  const date = toDateSafe(value);
  return date ? date.toLocaleString("es-MX") : null;
}

function formatScheduledDate(value: unknown): string | null {
  const date = toDateSafe(value);
  if (!date) return null;
  const day = date.getDate();
  const month = date.toLocaleString("es-MX", { month: "long" });
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${day} de ${month.charAt(0).toUpperCase() + month.slice(1)} del ${year} a las ${hh}:${mm} horas`;
}

function getRequestCurrency(req: SessionRequest): string {
  return (req as MeetGreetRequestDoc & { currency?: string }).currency ?? "MXN";
}

function getCreatorScheduleNote(req: SessionRequest): string | null {
  return (req as MeetGreetRequestDoc).creatorScheduleNote ?? null;
}

function getRelativeTime(value: unknown, tc: (k: string, v?: Record<string, unknown>) => string): string {
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

function isPrepareWindowOpen(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;
  return Date.now() >= date.getTime() - 10 * 60 * 1000;
}

function isNoShowExpired(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;
  return Date.now() >= date.getTime() + 15 * 60 * 1000;
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

function getMeetGreetStatusStyle(status: string): React.CSSProperties {
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

function getTypeChipStyle(type: string): React.CSSProperties {
  if (type === "meet_greet_digital")
    return { border: "1px solid rgba(96,165,250,0.30)", background: "rgba(96,165,250,0.16)", color: "#93c5fd" };
  if (["digital_exclusive_session", "exclusive_session", "clase_personalizada"].includes(type))
    return { border: "1px solid rgba(168,85,247,0.32)", background: "rgba(168,85,247,0.16)", color: "#d8b4fe" };
  return { border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fff" };
}

// ── Chat history ─────────────────────────────────────────────────────────────
type ChatEntry = { role: "buyer" | "creator"; text: string; ts: unknown };

function buildChatEntries(req: SessionRequest): ChatEntry[] {
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
const OVERLAY_CSS = `
  @keyframes sroDesktopIn  { from { opacity:0; transform:scale(0.94) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
  @keyframes sroDesktopOut { from { opacity:1; transform:scale(1) translateY(0); } to { opacity:0; transform:scale(0.94) translateY(10px); } }
  .sro-bg-img {
    position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
    background-size: cover; background-position: center 40%; background-repeat: no-repeat;
    opacity: 0.52;
  }
  .sro-bg-grad {
    position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 1;
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

const CLOSE_DELAY_DESKTOP = 180;
const CLOSE_DELAY_MOBILE  = 260;
const SWIPE_THRESHOLD = 130;

// ── Componente ────────────────────────────────────────────────────────────────

export default function SessionRequestOverlay({
  open,
  onClose,
  request: req,
  requestId,
  serviceKind,
  earning,
  busy,
  feedbackError,
  feedbackSuccess,
  ownerCalendarItems,
  getInitials,
  onAccept,
  onReject,
  onSchedule,
  onAcceptAndSchedule,
  onPrepare,
  readOnly = false,
  preparationNode,
  onReschedule,
  onKeepSchedule,
  ownerAvatarUrl,
  ownerDisplayName,
}: SessionRequestOverlayProps) {
  const tCommon = useTranslations("common");
  const tFeed = useTranslations("feed");
  const tServices = useTranslations("services");
  const tSessions = useTranslations("sessions");
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Espejo en ref del breakpoint: el efecto de reset del form NO debe depender
  // de `isMobile` (si lo hace, al pasar de desktop→móvil tras montar re-resetea
  // el horario a hoy-00:00 y rompe "confirmar" en celular). Se lee por ref donde
  // hace falta (delay de cierre) sin meterlo en dependencias.
  const isMobileRef = useRef(false);
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ y: number; offset: number } | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const scheduleSectionRef = useRef<HTMLDivElement>(null);

  // Al expandir la forma de agendar, revelamos el SELECTOR DE FECHA (arriba de
  // la forma), no el fondo. Se espera a que termine la animación de expansión
  // (max-height 0.42s) para que el scroll llegue a la posición correcta.
  function revealScheduleForm() {
    setTimeout(() => {
      scheduleSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 460);
  }

  // Form state
  const [acceptExpanded, setAcceptExpanded] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [scheduleParts, setScheduleParts] = useState<ScheduleParts>(
    getSchedulePartsFromDate(toDateSafe(req.scheduledAt))
  );
  const [scheduleNote, setScheduleNote] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarEventKey, setCalendarEventKey] = useState<string | null>(null);

  // TTS state — unified chat
  const [chatTtsIdx, setChatTtsIdx] = useState<number | null>(null);
  const [chatTtsState, setChatTtsState] = useState<"idle" | "playing" | "paused">("idle");
  const [chatTtsHighlight, setChatTtsHighlight] = useState<{ start: number; length: number } | null>(null);
  const [chatTtsRate, setChatTtsRate] = useState<1 | 1.4 | 1.8>(1);
  const chatTtsRateRef = useRef<number>(1);
  const chatTtsGenRef = useRef(0);
  const chatTtsAudioRef = useRef<EdgeTTSHandle | null>(null);
  const { toast: rescheduleToast, showToast: showRescheduleToast } = useVibraToast();

  const [ownerPhotoFromDb, setOwnerPhotoFromDb] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, "users", uid)).then(snap => {
      if (snap.exists()) setOwnerPhotoFromDb((snap.data().photoURL as string | null) ?? null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => { isMobileRef.current = mq.matches; setIsMobile(mq.matches); };
    sync();
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", sync);
    return () => { if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", sync); };
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
      setPanelOffsetY(0);
      // Reset form state on open
      setAcceptExpanded(false);
      setRejectOpen(false);
      setRejectReason("");
      setScheduleParts(getSchedulePartsFromDate(toDateSafe(req.scheduledAt)));
      setScheduleNote("");
      setCalendarOpen(false);
    } else {
      chatTtsGenRef.current++;
      if (chatTtsAudioRef.current) { chatTtsAudioRef.current.stop(); chatTtsAudioRef.current = null; }
      setChatTtsState("idle");
      setChatTtsHighlight(null);
      setChatTtsIdx(null);
      const delay = isMobileRef.current ? CLOSE_DELAY_MOBILE : CLOSE_DELAY_DESKTOP;
      const t = setTimeout(() => setVisible(false), delay);
      return () => clearTimeout(t);
    }
  }, [open, req]);

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      chatTtsGenRef.current++;
      if (chatTtsAudioRef.current) { chatTtsAudioRef.current.stop(); chatTtsAudioRef.current = null; }
    };
  }, []);

  // Swipe-to-close (mobile)
  function handlePointerDown(e: React.PointerEvent) {
    dragStart.current = { y: e.clientY, offset: panelOffsetY };
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const raw = dragStart.current.offset + (e.clientY - dragStart.current.y);
    setPanelOffsetY(raw >= 0 ? Math.min(window.innerHeight, raw) : raw * 0.2);
  }
  function handlePointerUp() {
    dragStart.current = null;
    setIsDragging(false);
    if (panelOffsetY >= SWIPE_THRESHOLD) onClose();
    else setPanelOffsetY(0);
  }

  // TTS functions — unified chat
  const playChatTts = useCallback((idx: number, text: string) => {
    if (chatTtsAudioRef.current) { chatTtsAudioRef.current.stop(); chatTtsAudioRef.current = null; }
    if (!text.trim()) return;
    const gen = ++chatTtsGenRef.current;
    setChatTtsIdx(idx);
    setChatTtsHighlight(null);
    chatTtsAudioRef.current = playEdgeTTS(text, {
      playbackRate: chatTtsRateRef.current,
      onProgress: (ratio) => {
        if (chatTtsGenRef.current !== gen) return;
        const pos = Math.floor(ratio * text.length);
        const ahead = text.slice(pos);
        const spaceAt = ahead.search(/[\s\n]/);
        setChatTtsHighlight({ start: pos, length: Math.max(1, spaceAt === -1 ? Math.min(ahead.length, 8) : spaceAt) });
      },
      onEnded: () => { if (chatTtsGenRef.current !== gen) return; chatTtsAudioRef.current = null; setChatTtsState("idle"); setChatTtsHighlight(null); setChatTtsIdx(null); },
      onError: () => { if (chatTtsGenRef.current !== gen) return; chatTtsAudioRef.current = null; setChatTtsState("idle"); setChatTtsHighlight(null); setChatTtsIdx(null); },
    });
    setChatTtsState("playing");
  }, []);

  const handleToggleChatTts = useCallback((idx: number, text: string) => {
    if (chatTtsIdx === idx) {
      if (chatTtsState === "playing") { chatTtsAudioRef.current?.audio.pause(); setChatTtsState("paused"); return; }
      if (chatTtsState === "paused") { chatTtsAudioRef.current?.audio.play().catch(() => {}); setChatTtsState("playing"); return; }
    }
    playChatTts(idx, text);
  }, [chatTtsIdx, chatTtsState, playChatTts]);

  const handleCycleChatRate = useCallback(() => {
    const next: 1 | 1.4 | 1.8 = chatTtsRate === 1 ? 1.4 : chatTtsRate === 1.4 ? 1.8 : 1;
    chatTtsRateRef.current = next;
    setChatTtsRate(next);
    if (chatTtsAudioRef.current) chatTtsAudioRef.current.audio.playbackRate = next;
  }, [chatTtsRate]);

  // Derived
  const isExclusive = serviceKind === "exclusive_session";
  const chipType = isExclusive ? "digital_exclusive_session" : "meet_greet_digital";
  const status = req.status;
  const creatorScheduleNote = getCreatorScheduleNote(req);
  const scheduledAtText = formatScheduledDate(req.scheduledAt);
  const prepareWindowOpen = isPrepareWindowOpen(req.scheduledAt);
  const noShowExpired = isNoShowExpired(req.scheduledAt);
  const canAccept = status === "pending_creator_response";
  const canReject = ["pending_creator_response", "accepted_pending_schedule", "reschedule_requested"].includes(status);
  const canSchedule =
    ["accepted_pending_schedule", "reschedule_requested", "scheduled", "ready_to_prepare", "auto_rejected_no_show"].includes(status) ||
    // in_preparation solo se puede reprogramar una vez vencida la tolerancia
    // (caso no-show); en preparación activa no se ofrece reagenda.
    (status === "in_preparation" && noShowExpired);
  const canPrepare = ["scheduled", "ready_to_prepare", "in_preparation"].includes(status) && prepareWindowOpen && !noShowExpired;

  const _mg = req as MeetGreetRequestDoc;
  const _schedLen = (_mg.scheduleHistory ?? []).length;
  const _reschedLen = (_mg.rescheduleHistory ?? []).length;
  const creatorOwnRescheduleCount = Math.max(0, _schedLen - _reschedLen - 1);
  const canCreatorInitiateReschedule =
    status === "scheduled" ? creatorOwnRescheduleCount < 2 : false;

  const selectedScheduleIso = schedulePartsToIso(scheduleParts);
  const selectedScheduleDate = selectedScheduleIso ? new Date(selectedScheduleIso) : null;
  const scheduleConflict = getWalletScheduleConflictResult(
    { id: requestId, source: serviceKind, scheduledAt: selectedScheduleDate, durationMinutes: typeof req.durationMinutes === "number" && req.durationMinutes > 0 ? req.durationMinutes : null },
    ownerCalendarItems
  );

  const isRescheduleRequested = status === "reschedule_requested";
  const sessionTypeLabel = isExclusive ? tServices("exclusiveSession") : tServices("liveSession");
  const panelTitle = readOnly
    ? tServices("viewRequest")
    : isRescheduleRequested
    ? `${tServices("reschedule")} ${sessionTypeLabel}`
    : `${tServices("schedule")} ${sessionTypeLabel}`;

  if (!mounted || !visible) return null;

  // ── Contenido del panel ───────────────────────────────────────────────────
  const resolvedOwnerAvatarUrl = ownerAvatarUrl ?? ownerPhotoFromDb ?? auth.currentUser?.photoURL ?? null;
  const resolvedOwnerDisplayName = ownerDisplayName ?? auth.currentUser?.displayName ?? null;
  const accentColor = isExclusive ? "#f9a8d4" : "#93c5fd";

  function fmtDateSplit(value: unknown): { dayTime: string; dateStr: string } | null {
    const d = toDateSafe(value);
    if (!d) return null;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d);
    const dateStr = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", year: "numeric" }).format(d);
    return {
      dayTime: `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${hh}:${mm} ${tWallet("hoursAbbr")}`,
      dateStr,
    };
  }

  const scheduledParts = fmtDateSplit(req.scheduledAt);
  const createdParts = fmtDateSplit((req as MeetGreetRequestDoc).createdAt);

  const bodyContent = (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Buyer */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {req.buyerAvatarUrl ? (
          <Image src={req.buyerAvatarUrl} alt={req.buyerDisplayName ?? ""} width={38} height={38} style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#fff", flexShrink: 0 }}>
            {getInitials(req.buyerDisplayName)}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {req.buyerDisplayName ?? tCommon("user")}
          </div>
          <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3, marginTop: 4 }}>
            {getMeetGreetStatusLabel(status, tSessions)}
          </div>
        </div>
        {earning && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 2 }}>
            <span style={{ color: "#86efac", fontWeight: 500, fontSize: 11, letterSpacing: "0.01em", lineHeight: 1 }}>{tWallet("yourEarning")}</span>
            <span style={{ color: "#86efac", fontWeight: 700, fontSize: 20, letterSpacing: "-0.03em", lineHeight: 1 }}>{earning}</span>
          </div>
        )}
      </div>

      {/* Fechas: agendada + solicitud */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("scheduledDateLabel")}</span>
            {scheduledParts ? (
              <>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{scheduledParts.dayTime}</span>
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 400, lineHeight: 1.2 }}>{scheduledParts.dateStr}</span>
              </>
            ) : <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{tServices("noDateLabel")}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("requestedDateLabel")}</span>
            {createdParts ? (
              <>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{createdParts.dayTime}</span>
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 400, lineHeight: 1.2 }}>{createdParts.dateStr}</span>
              </>
            ) : <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>—</span>}
          </div>
        </div>
      </div>

      {/* Historial de mensajes (buyer + creator, cronológico) */}
      {(() => {
        const chatEntries = buildChatEntries(req);
        if (chatEntries.length === 0) return null;
        return (
          <div style={{ display: "grid", gap: 12 }}>
            {chatEntries.map((entry, idx) => {
              const isBuyer = entry.role === "buyer";
              const avatarUrl = isBuyer ? req.buyerAvatarUrl : resolvedOwnerAvatarUrl;
              const displayName = isBuyer ? (req.buyerDisplayName ?? null) : resolvedOwnerDisplayName;
              const isActive = chatTtsIdx === idx;
              const isPlaying = isActive && chatTtsState === "playing";
              return (
                <div key={idx} style={{ display: "grid", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    {isActive && chatTtsState !== "idle" && (
                      <button type="button" onClick={handleCycleChatRate} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.55)", padding: "2px 4px", fontSize: 11, fontWeight: 700, letterSpacing: "-0.3px", fontFamily: "inherit" }}>
                        {chatTtsRate}×
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleChatTts(idx, entry.text)}
                      aria-label={isPlaying ? tServices("pauseReading") : isActive && chatTtsState === "paused" ? tServices("resumeReading") : tServices("readMessage")}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", padding: 2, display: "flex", alignItems: "center", flexShrink: 0, transition: "color 0.15s" }}
                    >
                      {isPlaying ? (
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>
                      ) : (
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                      )}
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    {avatarUrl ? (
                      <Image src={avatarUrl} alt={displayName ?? ""} width={28} height={28} style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, color: "#fff", flexShrink: 0 }}>
                        {getInitials(displayName)}
                      </div>
                    )}
                    <p style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.9)", margin: 0, padding: "4px 0 2px", flex: 1 }}>
                      {isActive && chatTtsHighlight ? (
                        <>
                          <strong style={{ color: "#fff", fontWeight: 700 }}>{entry.text.slice(0, chatTtsHighlight.start + chatTtsHighlight.length)}</strong>
                          {entry.text.slice(chatTtsHighlight.start + chatTtsHighlight.length)}
                        </>
                      ) : entry.text}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Motivo de rechazo */}
      {req.rejectionReason && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(248,113,113,0.18)", background: "rgba(248,113,113,0.08)", padding: "9px 11px", fontSize: 13, lineHeight: 1.4, color: "#fecaca" }}>
          {tServices("rejectionLabel")}: {req.rejectionReason}
        </div>
      )}

      {/* Motivo de devolución */}
      {req.refundReason && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(250,204,21,0.18)", background: "rgba(250,204,21,0.08)", padding: "9px 11px", fontSize: 13, lineHeight: 1.4, color: "#fde68a" }}>
          {tServices("refundReasonLabel")}: {req.refundReason}
        </div>
      )}

      {/* Banner preparación */}
      {canPrepare && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(96,165,250,0.18)", background: "rgba(96,165,250,0.08)", padding: "9px 11px", fontSize: 13, lineHeight: 1.4, color: "#bfdbfe" }}>
          {tServices("canPrepareMessage")}
        </div>
      )}

      {/* Botones de acción */}
      {!readOnly && (canAccept || canReject) && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {canAccept && (
            <button
              type="button"
              onClick={() => { if (!acceptExpanded) { setAcceptExpanded(true); revealScheduleForm(); } }}
              disabled={acceptExpanded}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 6,
                border: "none",
                background: isExclusive
                  ? "linear-gradient(100deg, #be185d, #f9a8d4)"
                  : "linear-gradient(100deg, #1d4ed8, #38bdf8)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                cursor: acceptExpanded ? "default" : "pointer",
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
            >
              {tCommon("accept")}
            </button>
          )}
          {canReject && !isRescheduleRequested && (
            <button
              type="button"
              onClick={() => setRejectOpen((p) => !p)}
              disabled={busy}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 6,
                border: "none",
                background: "rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.70)",
                fontWeight: 500,
                fontSize: 13,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.7 : 1,
                fontFamily: "inherit",
              }}
            >
              {tCommon("reject")}
            </button>
          )}
        </div>
      )}

      {/* Formulario de agendar (expande al aceptar, poner fecha o reagendar) */}
      {!readOnly && (canAccept || canSchedule) && (
        <div style={{ overflow: "hidden", maxHeight: acceptExpanded ? "700px" : "0", opacity: acceptExpanded ? 1 : 0, transition: "max-height 0.42s cubic-bezier(0.16,1,0.3,1), opacity 0.28s ease" }}>
        <div ref={scheduleSectionRef} style={{ display: "grid", gap: 10, paddingTop: 2, scrollMarginTop: 12 }}>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "2px 0" }} />
          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 500, color: isExclusive ? "#f472b6" : "#60a5fa", width: "fit-content" }}
          >
            {tWallet("viewCalendarAriaLabel")}
          </button>
          <div className="sro-schedule">
            <ScheduleDateTimeSelector value={scheduleParts} onChange={(p) => setScheduleParts(p)} disabled={busy} />
            <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.38)" }}>
              {tSessions("schedulingLocalTime", { timezone: getTimezoneLabel(getViewerTimezone()) })}
            </div>
          </div>
          {scheduleConflict.message && (
            <div style={{ borderRadius: 10, border: "1px solid rgba(248,113,113,0.18)", background: "rgba(248,113,113,0.08)", padding: "7px 8px", fontSize: 12, lineHeight: 1.3, color: "#fecaca" }}>
              {scheduleConflict.message}
            </div>
          )}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: 700, lineHeight: 1 }}>{tSessions("scheduleBuyerMessage")}</span>
            <textarea
              value={scheduleNote}
              onChange={(e) => setScheduleNote(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: "12px 13px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", fontSize: 13, fontWeight: 600, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
            />
          </label>
          {canAccept && (
            <button
              type="button"
              onClick={() => onAcceptAndSchedule(selectedScheduleIso, scheduleNote || null)}
              disabled={busy || scheduleConflict.hasConflict}
              style={{
                height: 36,
                borderRadius: 6,
                border: "none",
                background: busy || scheduleConflict.hasConflict
                  ? "rgba(255,255,255,0.10)"
                  : isExclusive
                  ? "#be185d"
                  : "#1d4ed8",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                cursor: busy || scheduleConflict.hasConflict ? "not-allowed" : "pointer",
                opacity: busy || scheduleConflict.hasConflict ? 0.55 : 1,
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
            >
              {busy ? tFeed("processing") : tServices("confirmReschedule")}
            </button>
          )}
          <ScheduleCalendarOverlay
            open={calendarOpen}
            title={tWallet("calendarTitle")}
            items={ownerCalendarItems}
            excludeId={requestId}
            selectedDate={selectedScheduleDate}
            onSelectDate={(date) => { setScheduleParts(getSchedulePartsFromDate(date)); setCalendarEventKey(null); }}
            onClose={() => setCalendarOpen(false)}
            onReschedule={onReschedule}
          />
        </div>
        </div>
      )}
      {!readOnly && (canSchedule || canPrepare) && (
        <div style={{ display: "flex", gap: 8 }}>
          {isRescheduleRequested && !acceptExpanded && (
            <>
              <button
                type="button"
                onClick={() => {
                  setAcceptExpanded(true);
                  revealScheduleForm();
                }}
                disabled={busy}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 6,
                  border: "none",
                  background: isExclusive
                    ? "linear-gradient(100deg, #be185d, #f9a8d4)"
                    : "linear-gradient(100deg, #1d4ed8, #38bdf8)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.7 : 1,
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                }}
              >
                {tServices("reschedule")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (onKeepSchedule) {
                    await onKeepSchedule();
                  }
                  onClose();
                }}
                disabled={busy}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 6,
                  border: "none",
                  background: "rgba(255,255,255,0.10)",
                  color: "rgba(255,255,255,0.70)",
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.7 : 1,
                  fontFamily: "inherit",
                }}
              >
                {tCommon("no")}
              </button>
            </>
          )}
          {canPrepare && (
            <button type="button" onClick={onPrepare} disabled={busy} style={{ height: 34, borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 600, fontSize: 13, padding: "0 14px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1, fontFamily: "inherit" }}>
              {busy ? tFeed("processing") : tServices("prepareButton")}
            </button>
          )}
        </div>
      )}

      {/* Formulario de rechazo */}
      {!readOnly && (
        <div style={{ overflow: "hidden", maxHeight: rejectOpen ? "260px" : "0", opacity: rejectOpen ? 1 : 0, transition: "max-height 0.42s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease" }}>
          <div style={{ display: "grid", gap: 10, paddingTop: 2 }}>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={tServices("rejectReasonPlaceholder")}
              rows={3}
              style={{ width: "100%", padding: "12px 13px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", fontSize: 13, fontWeight: 500, fontFamily: "inherit", resize: "none", boxSizing: "border-box", lineHeight: 1.5 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={async () => {
                  try { await onReject(rejectReason || null); onClose(); } catch {}
                }}
                disabled={busy}
                style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: "rgba(220,38,38,0.62)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: "inherit" }}
              >
                {busy ? tFeed("processing") : tServices("confirmReject")}
              </button>
              <button
                type="button"
                onClick={() => setRejectOpen(false)}
                style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.70)", fontWeight: 500, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
              >
                {tCommon("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedbackError && (
        <div style={{ borderRadius: 13, border: "1px solid rgba(255,90,90,0.24)", background: "rgba(120,18,18,0.28)", color: "#ffdada", padding: "10px 12px", fontSize: 13, lineHeight: 1.4 }}>
          {feedbackError}
        </div>
      )}
      {feedbackSuccess && (
        <div style={{ borderRadius: 13, border: "1px solid rgba(34,197,94,0.24)", background: "rgba(10,40,20,0.30)", color: "#bbf7d0", padding: "10px 12px", fontSize: 13, lineHeight: 1.4 }}>
          {feedbackSuccess}
        </div>
      )}

      {/* Panel de preparación */}
      {preparationNode}
    </div>
  );

  // ── Footer fijo ───────────────────────────────────────────────────────────
  const showScheduleFooter = !readOnly && canSchedule && !canAccept && (status !== "scheduled" || canCreatorInitiateReschedule);

  const downloadDaysLeft = status === "completed" ? (() => {
    const ref = toDateSafe(req.scheduledAt);
    if (!ref) return 30;
    const elapsed = Math.floor((Date.now() - ref.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, 30 - elapsed);
  })() : null;
  const canDownload = downloadDaysLeft !== null && downloadDaysLeft > 0;

  const footerNode = readOnly ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {status === "completed" && (
        <>
          <div style={{
            fontSize: 12,
            textAlign: "center",
            color: canDownload ? "rgba(255,255,255,0.5)" : "#fca5a5",
            fontWeight: 500,
          }}>
            {canDownload
              ? tServices("downloadDaysLeft", { days: downloadDaysLeft })
              : tServices("downloadExpired")}
          </div>
          {downloadError && (
            <div style={{ fontSize: 12, color: "#fca5a5", textAlign: "center" }}>{downloadError}</div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={!canDownload || downloadBusy}
              onClick={async () => {
                setDownloadBusy(true);
                setDownloadError(null);
                try {
                  const url = await callGetRecordingDownloadUrl({ sessionId: requestId, sessionType: serviceKind });
                  window.location.href = url;
                } catch {
                  setDownloadError(tCommon("generalError"));
                } finally {
                  setDownloadBusy(false);
                }
              }}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 10,
                border: "none",
                background: !canDownload
                  ? "rgba(255,255,255,0.08)"
                  : isExclusive ? "rgba(236,72,153,0.18)" : "rgba(59,130,246,0.18)",
                color: !canDownload
                  ? "rgba(255,255,255,0.3)"
                  : isExclusive ? "#f9a8d4" : "#93c5fd",
                fontWeight: 600,
                fontSize: 14,
                cursor: !canDownload || downloadBusy ? "not-allowed" : "pointer",
                opacity: downloadBusy ? 0.7 : 1,
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
            >
              {downloadBusy ? tCommon("processing") : tServices("downloadVideo")}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 10,
                border: "none",
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
            >
              {tCommon("close")}
            </button>
          </div>
        </>
      )}
      {status !== "completed" && (
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            height: 44,
            borderRadius: 10,
            border: "none",
            background: "rgba(255,255,255,0.08)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "-0.01em",
          }}
        >
          {tCommon("close")}
        </button>
      )}
    </div>
  ) : showScheduleFooter ? (
    <div style={{ display: "flex", gap: 8 }}>
      {!acceptExpanded && !isRescheduleRequested ? (
        <button
          type="button"
          onClick={() => {
            setAcceptExpanded(true);
            revealScheduleForm();
          }}
          disabled={busy}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 10,
            border: "none",
            background: isExclusive
              ? "linear-gradient(100deg, #be185d, #f9a8d4)"
              : "linear-gradient(100deg, #1d4ed8, #38bdf8)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
            fontFamily: "inherit",
            letterSpacing: "-0.01em",
          }}
        >
          {status === "scheduled" ? tServices("reschedule") : tServices("setDate")}
        </button>
      ) : acceptExpanded ? (
        <>
          <button
            type="button"
            onClick={async () => {
              const currentAt = toDateSafe(req.scheduledAt);
              const newAt = selectedScheduleIso ? new Date(selectedScheduleIso) : null;
              if (currentAt && newAt) {
                const sameMinute = Math.floor(currentAt.getTime() / 60000) === Math.floor(newAt.getTime() / 60000);
                if (sameMinute) {
                  showRescheduleToast(tServices("sameSlotError"), "error");
                  return;
                }
              }
              try {
                await onSchedule(selectedScheduleIso, scheduleNote || null);
                showRescheduleToast(
                  isRescheduleRequested || status === "scheduled"
                    ? tServices("successRescheduled")
                    : tServices("successDateProposed"),
                  "success"
                );
                onClose();
              } catch {
                // el error ya lo muestra handleCreatorScheduleDirect
              }
            }}
            disabled={busy || scheduleConflict.hasConflict}
            style={{
              flex: 1,
              height: 44,
              borderRadius: 10,
              border: "none",
              background: busy || scheduleConflict.hasConflict ? "rgba(255,255,255,0.10)" : isExclusive ? "#be185d" : "#1d4ed8",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              cursor: busy || scheduleConflict.hasConflict ? "not-allowed" : "pointer",
              opacity: busy || scheduleConflict.hasConflict ? 0.55 : 1,
              fontFamily: "inherit",
              letterSpacing: "-0.01em",
            }}
          >
            {busy ? tFeed("processing") : tCommon("confirm")}
          </button>
          <button
            type="button"
            onClick={() => { setAcceptExpanded(false); setCalendarOpen(false); }}
            disabled={busy}
            style={{
              flex: 1,
              height: 44,
              borderRadius: 10,
              border: "none",
              background: "rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.70)",
              fontWeight: 500,
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {tCommon("cancel")}
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  // ── Header compartido ─────────────────────────────────────────────────────
  const headerNode = (
    <header
      onPointerDown={isMobile ? handlePointerDown : undefined}
      onPointerMove={isMobile ? handlePointerMove : undefined}
      onPointerUp={isMobile ? handlePointerUp : undefined}
      onPointerCancel={isMobile ? handlePointerUp : undefined}
      style={{
        height: 56,
        display: "grid",
        gridTemplateColumns: isMobile ? "72px 1fr 72px" : "48px 1fr 48px",
        alignItems: "center",
        padding: "0 12px",
        borderBottom: "1px solid rgba(255,255,255,0.10)",
        flexShrink: 0,
        touchAction: isMobile ? "none" : undefined,
        userSelect: "none",
        WebkitUserSelect: "none",
      } as React.CSSProperties}
    >
      <div aria-hidden="true" />
      <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
        {panelTitle}
      </h3>
      <button
        type="button"
        onClick={onClose}
        aria-label={tCommon("close")}
        style={{ border: "none", background: "none", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4, width: 40, height: 40, fontSize: 28, fontWeight: 300, lineHeight: 1, fontFamily: "inherit" }}
      >
        ×
      </button>
    </header>
  );

  const bgImage = isExclusive ? "/sesionexclusiva.webp" : "/encuentroenvivo.webp";

  // ── Render ────────────────────────────────────────────────────────────────
  const panel = (
    <>
      <style>{OVERLAY_CSS}</style>
      <VibraToast toast={rescheduleToast} />
      {isMobile ? (
        // Bottom sheet
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 999999, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 env(safe-area-inset-bottom)", background: "rgba(0,0,0,0.52)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", fontFamily: "inherit" } as React.CSSProperties}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              maxHeight: "calc(100vh - 72px)",
              display: "flex",
              flexDirection: "column",
              background: "#0a0a0a",
              borderRadius: "22px 22px 0 0",
              boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
              overflow: "hidden",
              transform: open ? `translateY(${Math.max(0, panelOffsetY)}px)` : "translateY(100%)",
              transition: isDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "transform",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sro-bg-img" style={{ backgroundImage: `url('${bgImage}')` }} />
            <div className="sro-bg-grad" />
            {/* Handle pill */}
            <div className="sro-z2" style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
              <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
            </div>
            <div className="sro-z2" style={{ flexShrink: 0 }}>{headerNode}</div>
            <div className="sro-z2" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "22px 18px 24px" }}>
              {bodyContent}
            </div>
            {footerNode && (
              <div className="sro-z2" style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.08)", padding: "12px 18px 28px" }}>
                {footerNode}
              </div>
            )}
          </div>
        </div>
      ) : (
        // Desktop modal
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 999999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(0,0,0,0.88)", fontFamily: "inherit" } as React.CSSProperties}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
          <section
            style={{
              position: "relative",
              width: "min(100%, 540px)",
              maxHeight: acceptExpanded ? "min(88vh, 920px)" : "min(88vh, 680px)",
              transition: "max-height 0.35s cubic-bezier(0.16,1,0.3,1)",
              display: "flex",
              flexDirection: "column",
              borderRadius: 18,
              background: "#0a0a0a",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
              color: "#fff",
              overflow: "hidden",
              animation: open ? "sroDesktopIn 180ms ease-out" : "sroDesktopOut 180ms ease-in forwards",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sro-bg-img" style={{ backgroundImage: `url('${bgImage}')` }} />
            <div className="sro-bg-grad" />
            <div className="sro-z2" style={{ flexShrink: 0 }}>{headerNode}</div>
            <div ref={bodyScrollRef} className="sro-z2" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "22px 20px 20px" }}>
              {bodyContent}
            </div>
            {footerNode && (
              <div className="sro-z2" style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.08)", padding: "12px 20px 16px" }}>
                {footerNode}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );

  return createPortal(panel, document.body);
}
