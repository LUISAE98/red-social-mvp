"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { playEdgeTTS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import Image from "next/image";
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
import type {
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
} from "./OwnerSidebar";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

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
  preparationNode?: React.ReactNode;
  onReschedule?: (item: WalletServiceItem, scheduledAt: string) => Promise<void>;
  onKeepSchedule?: () => Promise<void>;
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

function formatMoney(value: number, currency?: string | null): string {
  const cur = currency === "USD" ? "USD" : "MXN";
  return "$" + new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + " " + cur;
}

function getRequestCurrency(req: SessionRequest): string {
  return (req as MeetGreetRequestDoc & { currency?: string }).currency ?? "MXN";
}

function getCreatorScheduleNote(req: SessionRequest): string | null {
  return (req as MeetGreetRequestDoc).creatorScheduleNote ?? null;
}

function getRelativeTime(value: unknown): string {
  const date = toDateSafe(value);
  if (!date) return "Hace un momento";
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return `Hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
  if (diffHours >= 1) return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  if (diffMins >= 1) return `Hace ${diffMins} ${diffMins === 1 ? "minuto" : "minutos"}`;
  return "Hace un momento";
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

function getMeetGreetStatusLabel(status: string): string {
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
  preparationNode,
  onReschedule,
  onKeepSchedule,
}: SessionRequestOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ y: number; offset: number } | null>(null);

  // Form state
  const [acceptExpanded, setAcceptExpanded] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleParts, setScheduleParts] = useState<ScheduleParts>(
    getSchedulePartsFromDate(toDateSafe(req.scheduledAt))
  );
  const [scheduleNote, setScheduleNote] = useState(getCreatorScheduleNote(req) ?? "");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarEventKey, setCalendarEventKey] = useState<string | null>(null);

  // TTS state
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechHighlight, setSpeechHighlight] = useState<{ start: number; length: number } | null>(null);
  const [speechRate, setSpeechRate] = useState<1 | 1.4 | 1.8>(1);
  const speechRateRef = useRef<number>(1);
  const speechGenRef = useRef(0);
  const ttsAudioRef = useRef<EdgeTTSHandle | null>(null);
  const speechTextRef = useRef<HTMLParagraphElement>(null);
  const speechCursorRef = useRef<HTMLSpanElement>(null);
  const { toast: rescheduleToast, showToast: showRescheduleToast } = useVibraToast();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsMobile(mq.matches);
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
      setScheduleOpen(false);
      setScheduleParts(getSchedulePartsFromDate(toDateSafe(req.scheduledAt)));
      setScheduleNote(getCreatorScheduleNote(req) ?? "");
      setCalendarOpen(false);
    } else {
      speechGenRef.current++;
      if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
      setSpeechState("idle");
      setSpeechHighlight(null);
      const delay = isMobile ? CLOSE_DELAY_MOBILE : CLOSE_DELAY_DESKTOP;
      const t = setTimeout(() => setVisible(false), delay);
      return () => clearTimeout(t);
    }
  }, [open, isMobile, req]);

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      speechGenRef.current++;
      if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
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

  // TTS functions
  const startSpeechFrom = useCallback((charIndex: number) => {
    const text = req.buyerMessage ?? "";
    if (!text) return;
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    const gen = ++speechGenRef.current;
    const sliceText = text.slice(charIndex);
    if (!sliceText.trim()) return;
    setSpeechHighlight(charIndex > 0 ? { start: charIndex, length: 0 } : null);
    ttsAudioRef.current = playEdgeTTS(sliceText, {
      playbackRate: speechRateRef.current,
      onProgress: (ratio) => {
        if (speechGenRef.current !== gen) return;
        const posInSlice = Math.floor(ratio * sliceText.length);
        const absPos = charIndex + posInSlice;
        const ahead = sliceText.slice(posInSlice);
        const spaceAt = ahead.search(/[\s\n]/);
        const length = spaceAt === -1 ? Math.min(ahead.length, 8) : spaceAt;
        setSpeechHighlight({ start: absPos, length: Math.max(1, length) });
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
  }, [req.buyerMessage]);

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
  const canSchedule = ["accepted_pending_schedule", "reschedule_requested"].includes(status);
  const canPrepare = ["scheduled", "ready_to_prepare", "in_preparation"].includes(status) && prepareWindowOpen && !noShowExpired;

  const selectedScheduleIso = schedulePartsToIso(scheduleParts);
  const selectedScheduleDate = selectedScheduleIso ? new Date(selectedScheduleIso) : null;
  const scheduleConflict = getWalletScheduleConflictResult(
    { id: requestId, source: serviceKind, scheduledAt: selectedScheduleDate, durationMinutes: typeof req.durationMinutes === "number" && req.durationMinutes > 0 ? req.durationMinutes : null },
    ownerCalendarItems
  );

  const isRescheduleRequested = status === "reschedule_requested";
  const panelTitle = isRescheduleRequested
    ? isExclusive ? "Reagendar sesión exclusiva" : "Reagendar sesión en vivo"
    : isExclusive ? "Agendar sesión exclusiva" : "Agendar sesión en vivo";

  if (!mounted || !visible) return null;

  // ── Contenido del panel ───────────────────────────────────────────────────
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
            {req.buyerDisplayName ?? "Usuario"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3, marginTop: 1 }}>
            {getRelativeTime((req as MeetGreetRequestDoc).createdAt)}
          </div>
        </div>
        {earning && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 2 }}>
            <span style={{ color: "#86efac", fontWeight: 500, fontSize: 11, letterSpacing: "0.01em", lineHeight: 1 }}>Tu ganancia</span>
            <span style={{ color: "#86efac", fontWeight: 700, fontSize: 20, letterSpacing: "-0.03em", lineHeight: 1 }}>{earning}</span>
          </div>
        )}
      </div>

      {/* Mensaje del comprador + TTS */}
      {req.buyerMessage ? (
        <div style={{ display: "grid", gap: 6, opacity: isRescheduleRequested ? 0.38 : 1, transition: "opacity 0.2s" }}>
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
              aria-label={speechState === "playing" ? "Pausar lectura" : speechState === "paused" ? "Reanudar lectura" : "Leer mensaje"}
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
          <p
            ref={speechTextRef}
            style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.9)", margin: 0, padding: "2px 0", userSelect: "none" }}
          >
            {(() => {
              const text = req.buyerMessage!;
              if (speechState === "idle" || !speechHighlight) return text;
              const { start, length } = speechHighlight;
              return (
                <>
                  <strong style={{ color: "#fff", fontWeight: 700 }}>{text.slice(0, start + length)}</strong>
                  <span ref={speechCursorRef} />
                  {text.slice(start + length)}
                </>
              );
            })()}
          </p>
        </div>
      ) : null}

      {/* Fecha propuesta */}
      {scheduledAtText && (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Fecha propuesta: {scheduledAtText}</div>
      )}

      {/* Motivo del cambio de fecha (debajo de la fecha propuesta) */}
      {isRescheduleRequested && (() => {
        const lastEntry = req.rescheduleHistory?.at(-1);
        const rescheduleReason = lastEntry?.reason;
        if (!rescheduleReason) return null;
        return (
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.9)" }}>
            {rescheduleReason}
          </p>
        );
      })()}

      {/* Nota del creador */}
      {creatorScheduleNote && !isRescheduleRequested && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(96,165,250,0.18)", background: "rgba(96,165,250,0.08)", padding: "9px 11px", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.4, color: "#bfdbfe" }}>
          Mensaje al comprador: {creatorScheduleNote}
        </div>
      )}

      {/* Motivo de rechazo */}
      {req.rejectionReason && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(248,113,113,0.18)", background: "rgba(248,113,113,0.08)", padding: "9px 11px", fontSize: 13, lineHeight: 1.4, color: "#fecaca" }}>
          Motivo de rechazo: {req.rejectionReason}
        </div>
      )}

      {/* Motivo de devolución */}
      {req.refundReason && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(250,204,21,0.18)", background: "rgba(250,204,21,0.08)", padding: "9px 11px", fontSize: 13, lineHeight: 1.4, color: "#fde68a" }}>
          Motivo de devolución: {req.refundReason}
        </div>
      )}

      {/* Banner preparación */}
      {canPrepare && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(96,165,250,0.18)", background: "rgba(96,165,250,0.08)", padding: "9px 11px", fontSize: 13, lineHeight: 1.4, color: "#bfdbfe" }}>
          🤝 Ya puedes entrar a preparación.
        </div>
      )}

      {/* Botones de acción */}
      {(canAccept || canReject) && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {canAccept && (
            <button
              type="button"
              onClick={() => !acceptExpanded && setAcceptExpanded(true)}
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
              Aceptar y agendar sesión
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
              Rechazar
            </button>
          )}
        </div>
      )}

      {/* Formulario de agendar (expande al aceptar o reagendar) */}
      {(canAccept || isRescheduleRequested) && (
        <div style={{ overflow: "hidden", maxHeight: acceptExpanded ? "700px" : "0", opacity: acceptExpanded ? 1 : 0, transition: "max-height 0.42s cubic-bezier(0.16,1,0.3,1), opacity 0.28s ease" }}>
        <div style={{ display: "grid", gap: 10, paddingTop: 2 }}>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "2px 0" }} />
          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 500, color: isExclusive ? "#f472b6" : "#60a5fa", width: "fit-content" }}
          >
            Ver calendario
          </button>
          <div className="sro-schedule">
            <ScheduleDateTimeSelector value={scheduleParts} onChange={(p) => setScheduleParts(p)} disabled={busy} />
          </div>
          {scheduleConflict.message && (
            <div style={{ borderRadius: 10, border: "1px solid rgba(248,113,113,0.18)", background: "rgba(248,113,113,0.08)", padding: "7px 8px", fontSize: 12, lineHeight: 1.3, color: "#fecaca" }}>
              {scheduleConflict.message}
            </div>
          )}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: 700, lineHeight: 1 }}>Mensaje al comprador</span>
            <textarea
              value={scheduleNote}
              onChange={(e) => setScheduleNote(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: "12px 13px", borderRadius: 12, border: "none", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", fontSize: 13, fontWeight: 600, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
            />
          </label>
          {!isRescheduleRequested && (
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
              {busy ? "Procesando..." : "Confirmar y agendar sesión"}
            </button>
          )}
          <ScheduleCalendarOverlay
            open={calendarOpen}
            title="Calendario del creador"
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
      {(canSchedule || canPrepare) && (
        <div style={{ display: "flex", gap: 8 }}>
          {canSchedule && !isRescheduleRequested && (
            <button type="button" onClick={() => setScheduleOpen((p) => !p)} disabled={busy} style={{ height: 34, borderRadius: 8, border: "1px solid rgba(96,165,250,0.30)", background: "rgba(96,165,250,0.10)", color: "#93c5fd", fontWeight: 500, fontSize: 13, padding: "0 14px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1, fontFamily: "inherit" }}>
              Poner fecha
            </button>
          )}
          {isRescheduleRequested && !acceptExpanded && (
            <>
              <button
                type="button"
                onClick={() => {
                  setScheduleNote(req.buyerMessage ?? "");
                  setAcceptExpanded(true);
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
                Reagendar
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
                No cambiar la fecha
              </button>
            </>
          )}
          {canPrepare && (
            <button type="button" onClick={onPrepare} disabled={busy} style={{ height: 34, borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 600, fontSize: 13, padding: "0 14px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1, fontFamily: "inherit" }}>
              {busy ? "Procesando..." : "Prepararse"}
            </button>
          )}
        </div>
      )}

      {/* Formulario de rechazo */}
      <div style={{ overflow: "hidden", maxHeight: rejectOpen ? "260px" : "0", opacity: rejectOpen ? 1 : 0, transition: "max-height 0.42s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease" }}>
        <div style={{ display: "grid", gap: 10, paddingTop: 2 }}>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Explica por qué rechazas la solicitud..."
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
              {busy ? "Procesando..." : "Confirmar rechazo"}
            </button>
            <button
              type="button"
              onClick={() => setRejectOpen(false)}
              style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.70)", fontWeight: 500, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>

      {/* Formulario de fecha */}
      {scheduleOpen && (
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" onClick={() => setCalendarOpen(true)} style={{ height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.7)", fontSize: 12, padding: "0 12px", cursor: "pointer", fontFamily: "inherit", width: "fit-content" }}>
            Ver calendario
          </button>
          <ScheduleDateTimeSelector value={scheduleParts} onChange={(p) => { setScheduleParts(p); }} disabled={busy} />
          {scheduleConflict.message && (
            <div style={{ borderRadius: 10, border: "1px solid rgba(248,113,113,0.18)", background: "rgba(248,113,113,0.08)", padding: "7px 8px", fontSize: 12, lineHeight: 1.3, color: "#fecaca" }}>
              {scheduleConflict.message}
            </div>
          )}
          <textarea
            value={scheduleNote}
            onChange={(e) => setScheduleNote(e.target.value)}
            placeholder="Mensaje o instrucciones para el comprador sobre esta fecha."
            rows={3}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)", color: "#fff", outline: "none", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => onSchedule(selectedScheduleIso, scheduleNote || null)} disabled={busy || scheduleConflict.hasConflict} style={{ height: 34, borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 600, fontSize: 13, padding: "0 14px", cursor: busy || scheduleConflict.hasConflict ? "not-allowed" : "pointer", opacity: busy || scheduleConflict.hasConflict ? 0.55 : 1, fontFamily: "inherit" }}>
              {busy ? "Procesando..." : "Guardar fecha"}
            </button>
            <button type="button" onClick={() => { setScheduleOpen(false); setCalendarOpen(false); }} style={{ height: 34, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 13, padding: "0 14px", cursor: "pointer", fontFamily: "inherit" }}>
              Cancelar
            </button>
          </div>
          <ScheduleCalendarOverlay
            open={calendarOpen}
            title="Calendario del creador"
            items={ownerCalendarItems}
            excludeId={requestId}
            selectedDate={selectedScheduleDate}
            conflictMessage={scheduleConflict.message}
            onSelectDate={(date) => setScheduleParts(getSchedulePartsFromDate(date))}
            onClose={() => { setCalendarOpen(false); setCalendarEventKey(null); }}
            renderItem={(row) => {
              const key = `${row.source}-${row.id}`;
              return (
                <WalletServiceRow
                  row={row}
                  open={calendarEventKey === key}
                  calendarItems={ownerCalendarItems}
                  onToggle={() => setCalendarEventKey((p) => p === key ? null : key)}
                />
              );
            }}
            footer={
              <div style={{ display: "grid", gap: 8 }}>
                <ScheduleDateTimeSelector value={scheduleParts} onChange={setScheduleParts} disabled={busy} />
                <button type="button" onClick={() => onSchedule(selectedScheduleIso, scheduleNote || null)} disabled={busy || scheduleConflict.hasConflict} style={{ height: 34, borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 600, fontSize: 13, cursor: busy || scheduleConflict.hasConflict ? "not-allowed" : "pointer", opacity: busy || scheduleConflict.hasConflict ? 0.55 : 1, fontFamily: "inherit" }}>
                  {busy ? "Procesando..." : "Guardar fecha"}
                </button>
              </div>
            }
          />
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

  // ── Footer fijo (reagendar) ─────────────────────��─────────────────────────
  const footerNode = isRescheduleRequested && acceptExpanded ? (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        onClick={async () => {
          const currentAt = toDateSafe(req.scheduledAt);
          const newAt = selectedScheduleIso ? new Date(selectedScheduleIso) : null;
          if (currentAt && newAt) {
            const sameMinute = Math.floor(currentAt.getTime() / 60000) === Math.floor(newAt.getTime() / 60000);
            if (sameMinute) {
              showRescheduleToast("No puedes reagendar en la misma fecha y horario", "error");
              return;
            }
          }
          try {
            await onSchedule(selectedScheduleIso, scheduleNote || null);
            showRescheduleToast("✅ Sesión reagendada correctamente.", "success");
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
          background: busy || scheduleConflict.hasConflict
            ? "rgba(255,255,255,0.10)"
            : isExclusive
            ? "#be185d"
            : "#1d4ed8",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          cursor: busy || scheduleConflict.hasConflict ? "not-allowed" : "pointer",
          opacity: busy || scheduleConflict.hasConflict ? 0.55 : 1,
          fontFamily: "inherit",
          letterSpacing: "-0.01em",
        }}
      >
        {busy ? "Procesando..." : "Confirmar nueva fecha"}
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
        Cancelar
      </button>
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
        aria-label="Cerrar"
        style={{ border: "none", background: "none", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4, width: 40, height: 40, fontSize: 28, fontWeight: 300, lineHeight: 1, fontFamily: "inherit" }}
      >
        ×
      </button>
    </header>
  );

  const bgImage = isExclusive ? "/sesionexclusiva.png" : "/encuentroenvivo.png";

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
          style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 999999, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.52)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", fontFamily: "inherit" } as React.CSSProperties}
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
            <div className="sro-z2" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "22px 20px 20px" }}>
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
