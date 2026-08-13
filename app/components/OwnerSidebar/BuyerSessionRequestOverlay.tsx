"use client";

import Image from "next/image";
import { formatDateLong, formatDateTimeLong, formatWeekdayTime } from "@/lib/i18n/dateTime";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import type { MeetGreetRequestDoc, ExclusiveSessionRequestDoc } from "./OwnerSidebar";
import { playEdgeTTS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import type { DisplayCurrency } from "@/lib/currency/catalog";

type SessionRequest = MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
type ScheduledServiceKind = "meet_greet" | "exclusive_session";

const PANEL_CLOSE_THRESHOLD = 130;

function getSessionStatusLabel(status: string, t?: (k: string) => string): string {
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
    case "pending_creator_response": return "Pendiente";
    case "accepted_pending_schedule": return "Aceptado";
    case "scheduled": return "Agendado";
    case "reschedule_requested": return "Cambio de fecha";
    case "rejected": return "Rechazado";
    case "refund_requested":
    case "refund_review": return "En proceso de devolución";
    case "ready_to_prepare": return "Ya casi inicia";
    case "in_preparation": return "En preparación";
    case "completed": return "Completado";
    case "cancelled": return "Cancelado";
    default: return status || "Pendiente";
  }
}

function getSessionStatusStyle(status: string): React.CSSProperties {
  if (status === "rejected" || status === "cancelled" || status === "refund_requested" || status === "refund_review")
    return { background: "rgba(244,63,94,0.14)", color: "#fda4af", border: "1px solid rgba(244,63,94,0.22)" };
  if (status === "scheduled" || status === "accepted_pending_schedule" || status === "completed")
    return { background: "rgba(34,197,94,0.12)", color: "#86efac", border: "1px solid rgba(34,197,94,0.24)" };
  if (status === "in_preparation")
    return { background: "rgba(96,165,250,0.16)", color: "#93c5fd", border: "1px solid rgba(96,165,250,0.30)" };
  if (status === "reschedule_requested" || status === "ready_to_prepare")
    return { background: "rgba(250,204,21,0.12)", color: "#fde047", border: "1px solid rgba(250,204,21,0.26)" };
  return { background: "rgba(168,85,255,0.14)", color: "#d8b4fe", border: "1px solid rgba(168,85,255,0.22)" };
}

function applyPanelOffset(raw: number): number {
  if (raw >= 0) return Math.min(window.innerHeight, raw);
  return raw * 0.2;
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (
    typeof ts === "object" && ts !== null && "toDate" in ts &&
    typeof (ts as { toDate?: unknown }).toDate === "function"
  ) return (ts as { toDate: () => Date }).toDate();
  return null;
}

function formatDate(ts: unknown, locale: string): string {
  return formatDateTimeLong(toDate(ts), locale) ?? "";
}

function fmtDateSplit(ts: unknown, locale: string): { dayTime: string; dateStr: string } | null {
  const d = toDate(ts);
  if (!d) return null;
  const dayTime = formatWeekdayTime(d, locale);
  const dateStr = formatDateLong(d, locale);
  return dayTime && dateStr ? { dayTime, dateStr } : null;
}

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

function getRelativeTime(ts: unknown, t?: (k: string, params?: Record<string, string | number | Date>) => string): string {
  const d = toDate(ts);
  if (!d) return t ? t("relativeTimeNow") : "Hace un momento";
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (t) {
    if (diffDays >= 1) return t("relativeTimeDays", { count: diffDays });
    if (diffHours >= 1) return t("relativeTimeHours", { count: diffHours });
    if (diffMins >= 1) return t("relativeTimeMinutes", { count: diffMins });
    return t("relativeTimeNow");
  }
  if (diffDays >= 1) return `Hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
  if (diffHours >= 1) return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  if (diffMins >= 1) return `Hace ${diffMins} ${diffMins === 1 ? "minuto" : "minutos"}`;
  return "Hace un momento";
}

const ANIM_CSS = `
@keyframes vibraComposerDesktopIn {
  from { opacity:0; transform:scale(0.94) translateY(10px); }
  to   { opacity:1; transform:scale(1)    translateY(0);    }
}
@keyframes vibraComposerDesktopOut {
  from { opacity:1; transform:scale(1)    translateY(0);    }
  to   { opacity:0; transform:scale(0.94) translateY(10px); }
}
.vibra-panel-scroll::-webkit-scrollbar,.vibra-panel-mobile-scroll::-webkit-scrollbar{width:7px;height:7px}
.vibra-panel-scroll::-webkit-scrollbar-track,.vibra-panel-mobile-scroll::-webkit-scrollbar-track{background:transparent}
.vibra-panel-scroll::-webkit-scrollbar-thumb,.vibra-panel-mobile-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:999px}
`;

type Props = {
  item: { id: string; data: SessionRequest; serviceKind: ScheduledServiceKind };
  creatorName: string;
  creatorAvatar: string | null;
  canRefund: boolean;
  canRetry: boolean;
  canReschedule?: boolean;
  canPrepare?: boolean;
  busy: boolean;
  onClose: () => void;
  onRefund: (reason: string) => void;
  onRetry: () => void;
  onReschedule?: (reason: string) => void;
  onPrepare?: () => void;
};

export default function BuyerSessionRequestOverlay({
  item, creatorName, creatorAvatar,
  canRefund, canRetry, canReschedule, canPrepare,
  busy, onClose, onRefund, onRetry, onReschedule, onPrepare,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleReason, setRescheduleReason] = useState("");
  // TTS — unified chat
  const [chatTtsIdx, setChatTtsIdx] = useState<number | null>(null);
  const [chatTtsState, setChatTtsState] = useState<"idle" | "playing" | "paused">("idle");
  const [chatTtsHighlight, setChatTtsHighlight] = useState<{ start: number; length: number } | null>(null);
  const [chatTtsRate, setChatTtsRate] = useState<1 | 1.4 | 1.8>(1);
  const chatTtsRateRef = useRef<number>(1);
  const chatTtsGenRef = useRef(0);
  const chatTtsAudioRef = useRef<EdgeTTSHandle | null>(null);
  const pointerStartRef = useRef({ y: 0, offset: 0 });
  const closeRef = useRef<() => void>(() => {});

  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const tSessions = useTranslations("sessions");
  const locale = useLocale();
  const { format: formatMoney } = usePriceFormat();

  const req = item.data;
  const isExclusive = item.serviceKind === "exclusive_session";
  const bgImage = isExclusive ? "/sesionexclusiva.webp" : "/encuentroenvivo.webp";
  const retryBtnBg = isExclusive ? "rgba(236,72,153,0.85)" : "rgba(59,130,246,0.85)";
  const priceColor = isExclusive ? "#f9a8d4" : "#93c5fd";
  const serviceTitle = isExclusive ? tServices("exclusiveSession") : tServices("liveSession");
  const creatorInitial = creatorName.charAt(0).toUpperCase();

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const genRef = chatTtsGenRef;
    const audioRef = chatTtsAudioRef;
    return () => {
      genRef.current++;
      if (audioRef.current) { audioRef.current.stop(); audioRef.current = null; }
    };
  }, []);

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

  function handleClose() {
    if (isMobile) {
      setPanelOffsetY(window.innerHeight);
      setTimeout(() => onClose(), 260);
    } else {
      setClosing(true);
      setTimeout(() => onClose(), 180);
    }
  }
  // eslint-disable-next-line react-hooks/refs
  closeRef.current = handleClose;

  function handlePanelPointerDown(e: React.PointerEvent) {
    pointerStartRef.current = { y: e.clientY, offset: panelOffsetY };
    setIsPanelDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function handlePanelPointerMove(e: React.PointerEvent) {
    if (!isPanelDragging) return;
    setPanelOffsetY(applyPanelOffset(pointerStartRef.current.offset + (e.clientY - pointerStartRef.current.y)));
  }
  function handlePanelPointerUp() {
    setIsPanelDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) { handleClose(); } else { setPanelOffsetY(0); }
  }

  if (!mounted) return null;

  const divider = <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />;

  const creatorRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {creatorAvatar ? (
        <Image src={creatorAvatar} alt={creatorName} width={40} height={40}
          style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}
        />
      ) : (
        <div style={{
          width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center",
          justifyContent: "center", fontWeight: 700, fontSize: 14, color: "#fff", flexShrink: 0,
        }}>
          {creatorInitial}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {creatorName}
        </span>
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3 }}>
          {getSessionStatusLabel(req.status, tSessions)}
        </span>
      </div>
      {(req.durationMinutes != null || req.priceSnapshot != null) && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          {req.durationMinutes != null && (
            <>
              <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{req.durationMinutes}</span>
                <span style={{ color: "#fff", fontSize: 11, fontWeight: 500 }}>{tCommon("minutes")}</span>
              </div>
              {req.priceSnapshot != null && (
                <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />
              )}
            </>
          )}
          {req.priceSnapshot != null && (
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
              <span style={{ color: priceColor, fontSize: 10, fontWeight: 500, opacity: 0.8, lineHeight: 1 }}>{tServices("paidLabel")}</span>
              <span style={{ color: priceColor, fontWeight: 700, fontSize: 24, lineHeight: 1 }}>{formatMoney(req.priceSnapshot, { baseCurrency: (req.currency ?? "MXN") as DisplayCurrency, code: true })}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const infoFields = (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Fechas: agendada + solicitud */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={priceColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("scheduledDateLabel")}</span>
            {(() => { const p = fmtDateSplit(req.scheduledAt, locale); return p ? (
              <>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{p.dayTime}</span>
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 400, lineHeight: 1.2 }}>{p.dateStr}</span>
              </>
            ) : <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{tServices("noDateLabel")}</span>; })()}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={priceColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("requestedDateLabel")}</span>
            {(() => { const p = fmtDateSplit(req.createdAt, locale); return p ? (
              <>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{p.dayTime}</span>
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 400, lineHeight: 1.2 }}>{p.dateStr}</span>
              </>
            ) : <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>—</span>; })()}
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
              const avatarUrl = isBuyer ? req.buyerAvatarUrl : creatorAvatar;
              const displayName = isBuyer ? (req.buyerDisplayName ?? null) : creatorName;
              const initial = isBuyer ? (req.buyerDisplayName ?? "U").charAt(0).toUpperCase() : creatorInitial;
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
                        <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>
                      ) : (
                        <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                      )}
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    {avatarUrl ? (
                      <Image src={avatarUrl} alt={displayName ?? ""} width={28} height={28} style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, color: "#fff", flexShrink: 0 }}>
                        {initial}
                      </div>
                    )}
                    <span style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.82)", flex: 1, display: "block", paddingTop: 4 }}>
                      {isActive && chatTtsHighlight ? (
                        <>
                          <strong style={{ color: "#fff", fontWeight: 700 }}>{entry.text.slice(0, chatTtsHighlight.start + chatTtsHighlight.length)}</strong>
                          {entry.text.slice(chatTtsHighlight.start + chatTtsHighlight.length)}
                        </>
                      ) : entry.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {(req.status === "rejected" || req.status === "refund_requested" || req.status === "refund_review") && (req.rejectedAt ?? req.updatedAt) ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{tServices("rejectedOn")}</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDate(req.rejectedAt ?? req.updatedAt, locale)}</span>
        </div>
      ) : null}

      {req.rejectionReason ? (
        <div style={{
          display: "grid", gap: 4,
          background: "rgba(120,18,18,0.28)", border: "1px solid rgba(255,90,90,0.24)",
          borderRadius: 13, padding: "10px 12px",
        }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{tServices("rejectionLabel")}</span>
          <span style={{ color: "#ffdada", fontSize: 13, lineHeight: 1.4 }}>{req.rejectionReason}</span>
        </div>
      ) : null}

      {req.autoRejectReason === "creator_no_show_after_15_minutes" ? (
        <div style={{ background: "rgba(120,18,18,0.28)", border: "1px solid rgba(255,90,90,0.24)", borderRadius: 13, padding: "10px 12px" }}>
          <span style={{ color: "#ffdada", fontSize: 13, lineHeight: 1.4 }}>
            {tServices("creatorNoShowMessage")}
          </span>
        </div>
      ) : null}

      {req.autoRejectReason === "buyer_no_show_after_15_minutes" ? (
        <div style={{ background: "rgba(120,18,18,0.28)", border: "1px solid rgba(255,90,90,0.24)", borderRadius: 13, padding: "10px 12px" }}>
          <span style={{ color: "#ffdada", fontSize: 13, lineHeight: 1.4 }}>
            {tServices("buyerNoShowMessage")}
          </span>
        </div>
      ) : null}

      {(req.rescheduleRequestsUsed ?? 0) >= 2 && !["rejected", "refund_requested", "refund_review", "completed", "cancelled"].includes(req.status) ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={priceColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4" />
            <circle cx="12" cy="8" r="0.5" fill={priceColor} />
          </svg>
          <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
            Ya no tienes más intentos disponibles para solicitar un cambio de horario.
          </p>
        </div>
      ) : null}
    </div>
  );

  const isTerminal = ["rejected", "refund_requested", "refund_review", "completed", "cancelled"].includes(req.status);

  const noticeBlock = !isTerminal ? (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={priceColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4" />
        <circle cx="12" cy="8" r="0.5" fill={priceColor} />
      </svg>
      <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
        {tServices("creatorResponseNotice")}
      </p>
    </div>
  ) : null;

  const footerContent = rescheduleOpen ? (
    <div style={{ display: "grid", gap: 8 }}>
      <textarea
        value={rescheduleReason}
        onChange={(e) => setRescheduleReason(e.target.value)}
        placeholder={tServices("rescheduleReasonPlaceholder")}
        style={{
          background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12,
          color: "#fff", fontSize: 13, padding: "10px 12px", resize: "none",
          height: 80, fontFamily: "inherit", lineHeight: 1.5, outline: "none",
          width: "100%", boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button"
          onClick={() => { onReschedule?.(rescheduleReason); setRescheduleOpen(false); }}
          disabled={busy}
          style={{
            flex: 1, height: 42, borderRadius: 5, border: "none",
            background: busy ? "rgba(255,255,255,0.1)" : retryBtnBg,
            color: busy ? "rgba(255,255,255,0.36)" : "#fff",
            fontSize: 15, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
            fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
          }}
        >
          {busy ? tServices("submitting") : tServices("confirmReschedule")}
        </button>
        <button type="button" onClick={() => setRescheduleOpen(false)} style={{
          flex: 1, height: 42, borderRadius: 5, border: "none",
          background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.70)",
          fontSize: 15, fontWeight: 500, cursor: "pointer",
          fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
        }}>
          {tCommon("cancel")}
        </button>
      </div>
    </div>
  ) : req.status === "rejected" ? (
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" onClick={onRetry} disabled={busy} style={{
        flex: 1, height: 42, borderRadius: 5, border: "none",
        background: busy ? "rgba(255,255,255,0.1)" : retryBtnBg,
        color: busy ? "rgba(255,255,255,0.36)" : "#fff",
        fontSize: 15, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
        fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
      }}>
        {tCommon("retry")}
      </button>
      <button type="button" onClick={() => onRefund("")} disabled={busy} style={{
        flex: 1, height: 42, borderRadius: 5, border: "none",
        background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.70)",
        fontSize: 15, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
        fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
      }}>
        {tServices("requestRefund")}
      </button>
    </div>
  ) : canReschedule ? (
    <div style={{ display: "grid", gap: 8 }}>
      {(() => {
        const used = item.data.rescheduleRequestsUsed ?? 0;
        const remaining = Math.max(0, 2 - used);
        if (remaining === 1) {
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(250,204,21,0.24)", background: "rgba(250,204,21,0.08)" }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" stroke="#fde047" strokeWidth="2"/>
                <path d="M12 7v5" stroke="#fde047" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="12" cy="16" r="1" fill="#fde047"/>
              </svg>
              <span style={{ fontSize: 12, color: "#fde047", lineHeight: 1.4 }}>{tServices("lastRescheduleAttempt")}</span>
            </div>
          );
        }
        return null;
      })()}
      <button type="button" onClick={() => setRescheduleOpen(true)} style={{
        width: "100%", height: 42, borderRadius: 5, border: "none",
        background: retryBtnBg, color: "#fff",
        fontSize: 15, fontWeight: 500, cursor: "pointer",
        fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
      }}>
        {tServices("reschedule")}
      </button>
    </div>
  ) : canPrepare ? (
    <button type="button" onClick={() => onPrepare?.()} disabled={busy} style={{
      width: "100%", height: 42, borderRadius: 5, border: "none",
      background: busy ? "rgba(255,255,255,0.1)" : retryBtnBg,
      color: busy ? "rgba(255,255,255,0.36)" : "#fff",
      fontSize: 15, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
      fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
    }}>
      {busy ? tCommon("processing") : tServices("prepareButton")}
    </button>
  ) : null;

  const headerStyle: React.CSSProperties = {
    height: 56,
    display: "grid",
    alignItems: "center",
    padding: "0 12px",
    flexShrink: 0,
  };

  // ── MOBILE ────────────────────────────────────────────────────────────────
  if (isMobile) {
    return createPortal(
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        style={{
          position: "fixed", inset: 0,
          zIndex: 999999, display: "flex", alignItems: "flex-end", justifyContent: "center",
          // safe-area como padding interno del panel (abajo), no aquí: así el fondo
          // del panel llena el home-indicator sin dejar el backdrop como barra negra.
          padding: 0,
          background: "rgba(0,0,0,0.52)", backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)", fontFamily: "inherit",
        }}
      >
        <style>{ANIM_CSS}</style>
        {/* panel outer */}
        <div style={{
          width: "100%", maxHeight: "calc(100dvh - 72px)",
          display: "flex", flexDirection: "column",
          background: "rgba(8,9,11,0.96)",
          paddingBottom: "var(--vb-safe-bottom, 0px)",
          transform: `translateY(${Math.max(0, panelOffsetY)}px)`,
          transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}>
          {/* section wrapper (rubber band) */}
          <div style={{
            transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
            transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}>
            <div style={{
              maxHeight: "calc(100dvh - 140px)", borderRadius: "22px 22px 0 0",
              background: "rgba(8,9,11,0.96)", boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
              color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column",
              position: "relative",
            }}>
              <div style={{
                position: "absolute", top: 0, insetInlineEnd: 0, bottom: 0, insetInlineStart: 0, zIndex: 0,
                backgroundImage: `url('${bgImage}')`, backgroundSize: "100% auto",
                backgroundPosition: "center bottom", backgroundRepeat: "no-repeat",
                opacity: 0.35, pointerEvents: "none",
              }} />
              <div style={{
                position: "absolute", top: 0, insetInlineEnd: 0, bottom: 0, insetInlineStart: 0, zIndex: 1, pointerEvents: "none",
                background: "linear-gradient(to bottom, #0a0a0a 0%, #0a0a0a 52%, rgba(10,10,10,0.9) 68%, rgba(10,10,10,0.6) 84%, rgba(10,10,10,0.28) 100%)",
              }} />
              <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <header
                  onPointerDown={handlePanelPointerDown}
                  onPointerMove={handlePanelPointerMove}
                  onPointerUp={handlePanelPointerUp}
                  onPointerCancel={handlePanelPointerUp}
                  style={{
                    ...headerStyle,
                    gridTemplateColumns: "72px 1fr 72px",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
                  }}
                >
                  <div aria-hidden="true" />
                  <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
                    {serviceTitle}
                  </h3>
                  <button type="button" onClick={handleClose} style={{
                    width: 40, height: 40, border: "none", background: "transparent",
                    color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid",
                    placeItems: "center", fontSize: 32, fontWeight: 300, lineHeight: 1, justifySelf: "end",
                  }}>×</button>
                </header>
                <div className="vibra-panel-mobile-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "12px 14px 8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {creatorRow}
                    {infoFields}
                    {noticeBlock}
                    <div style={{ height: 4 }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* footer — outside section-wrapper, not subject to rubber band */}
          {footerContent && (
            <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.07)", padding: `10px 14px 14px` }}>
              {footerContent}
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  }

  // ── DESKTOP ───────────────────────────────────────────────────────────────
  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      style={{
        position: "fixed", inset: 0,
        zIndex: 999999, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, background: "rgba(0,0,0,0.88)", fontFamily: "inherit",
      }}
    >
      <style>{ANIM_CSS}</style>
      <section style={{
        width: "min(100%, 540px)", maxHeight: "min(88vh, 680px)",
        display: "flex", flexDirection: "column",
        borderRadius: 18, background: "#0a0a0a",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
        color: "#fff", overflow: "hidden", position: "relative",
        animation: closing
          ? "vibraComposerDesktopOut 180ms ease-in forwards"
          : "vibraComposerDesktopIn 180ms ease-out",
      }}>
        <div style={{
          position: "absolute", top: 0, insetInlineEnd: 0, bottom: 0, insetInlineStart: 0, zIndex: 0,
          backgroundImage: `url('${bgImage}')`, backgroundSize: "100% auto",
          backgroundPosition: "center bottom", backgroundRepeat: "no-repeat",
          opacity: 0.35, pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", top: 0, insetInlineEnd: 0, bottom: 0, insetInlineStart: 0, zIndex: 1, pointerEvents: "none",
          background: "linear-gradient(to bottom, #0a0a0a 50%, rgba(10,10,10,0.85) 68%, rgba(10,10,10,0.4) 85%, transparent 100%)",
        }} />
        <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <header style={{ ...headerStyle, gridTemplateColumns: "48px 1fr 48px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
            <div aria-hidden="true" />
            <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
              {serviceTitle}
            </h3>
            <button type="button" onClick={handleClose} aria-label={tCommon("close")} style={{
              border: "none", background: "none", color: "#fff", cursor: "pointer",
              display: "grid", placeItems: "center", justifySelf: "end", padding: 4,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div className="vibra-panel-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {creatorRow}
              {infoFields}
              {noticeBlock}
            </div>
          </div>

          {footerContent && (
            <div style={{ padding: "14px 20px 18px", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
              {footerContent}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
