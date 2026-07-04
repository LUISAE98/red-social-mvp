"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MeetGreetRequestDoc, ExclusiveSessionRequestDoc } from "./OwnerSidebar";
import { playEdgeTTS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";

type SessionRequest = MeetGreetRequestDoc | ExclusiveSessionRequestDoc;
type ScheduledServiceKind = "meet_greet" | "exclusive_session";

const PANEL_CLOSE_THRESHOLD = 130;

function getSessionStatusLabel(status: string): string {
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

function formatDate(ts: unknown): string {
  const d = toDate(ts);
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(d);
  } catch { return d.toLocaleString("es-MX"); }
}

function getRelativeTime(ts: unknown): string {
  const d = toDate(ts);
  if (!d) return "Hace un momento";
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return `Hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
  if (diffHours >= 1) return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  if (diffMins >= 1) return `Hace ${diffMins} ${diffMins === 1 ? "minuto" : "minutos"}`;
  return "Hace un momento";
}

function formatMoney(amount: number): string {
  return "$" + new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " MXN";
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
  busy: boolean;
  onClose: () => void;
  onRefund: (reason: string) => void;
  onRetry: () => void;
  onReschedule?: (reason: string) => void;
};

export default function BuyerSessionRequestOverlay({
  item, creatorName, creatorAvatar,
  canRefund, canRetry, canReschedule,
  busy, onClose, onRefund, onRetry, onReschedule,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechHighlight, setSpeechHighlight] = useState<{ start: number; length: number } | null>(null);
  const [speechRate, setSpeechRate] = useState<1 | 1.4 | 1.8>(1);
  const speechRateRef = useRef<number>(1);
  const speechOffsetRef = useRef(0);
  const speechGenRef = useRef(0);
  const ttsAudioRef = useRef<EdgeTTSHandle | null>(null);
  const speechTextRef = useRef<HTMLSpanElement | null>(null);
  const pointerStartRef = useRef({ y: 0, offset: 0 });
  const closeRef = useRef<() => void>(() => {});

  const req = item.data;
  const isExclusive = item.serviceKind === "exclusive_session";
  const bgImage = isExclusive ? "/sesionexclusiva.png" : "/encuentroenvivo.png";
  const retryBtnBg = isExclusive ? "rgba(236,72,153,0.85)" : "rgba(59,130,246,0.85)";
  const priceColor = isExclusive ? "#f9a8d4" : "#93c5fd";
  const serviceTitle = isExclusive ? "Sesión exclusiva" : "Meet & Greet";
  const creatorInitial = creatorName.charAt(0).toUpperCase();

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const genRef = speechGenRef;
    const audioRef = ttsAudioRef;
    return () => {
      genRef.current++;
      if (audioRef.current) { audioRef.current.stop(); audioRef.current = null; }
    };
  }, []);

  const startSpeechFrom = useCallback((charIndex: number) => {
    const text = req.buyerMessage ?? "";
    if (!text) return;
    if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    speechOffsetRef.current = charIndex;
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

  function handleClose() {
    if (isMobile) {
      setPanelOffsetY(window.innerHeight);
      setTimeout(() => onClose(), 260);
    } else {
      setClosing(true);
      setTimeout(() => onClose(), 180);
    }
  }
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
          {getSessionStatusLabel(req.status)}
        </span>
      </div>
      {(req.durationMinutes != null || req.priceSnapshot != null) && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          {req.durationMinutes != null && (
            <>
              <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{req.durationMinutes}</span>
                <span style={{ color: "#fff", fontSize: 11, fontWeight: 500 }}>minutos</span>
              </div>
              {req.priceSnapshot != null && (
                <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />
              )}
            </>
          )}
          {req.priceSnapshot != null && (
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
              <span style={{ color: priceColor, fontSize: 10, fontWeight: 500, opacity: 0.8 }}>Pagaste</span>
              <span style={{ color: priceColor, fontWeight: 700, fontSize: 17 }}>{formatMoney(req.priceSnapshot)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const infoFields = (
    <div style={{ display: "grid", gap: 14 }}>
      {req.scheduledAt ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Fecha agendada</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDate(req.scheduledAt)}</span>
        </div>
      ) : null}

      {req.buyerMessage ? (
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, flex: 1 }}>Tu mensaje</span>
            {speechState !== "idle" && (
              <button
                type="button"
                aria-label="Cambiar velocidad de lectura"
                onClick={handleCycleRate}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.55)", padding: "2px 4px", display: "flex", alignItems: "center", flexShrink: 0, fontSize: 11, fontWeight: 700, letterSpacing: "-0.3px" }}
              >
                {speechRate}×
              </button>
            )}
            <button
              type="button"
              aria-label={speechState === "playing" ? "Pausar lectura" : speechState === "paused" ? "Reanudar lectura" : "Leer mensaje"}
              onClick={handleToggleSpeech}
              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", padding: 2, display: "flex", alignItems: "center", flexShrink: 0, transition: "color 0.15s" }}
            >
              {speechState === "playing" ? (
                <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="4" width="4" height="16" rx="1"/>
                  <rect x="15" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
              )}
            </button>
          </div>
          <span
            ref={speechTextRef}
            style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.82)" }}
          >
            {(() => {
              const text = req.buyerMessage;
              if (speechState === "idle" || !speechHighlight) return text;
              const { start, length } = speechHighlight;
              return (
                <>
                  <strong style={{ color: "#fff", fontWeight: 700 }}>{text.slice(0, start + length)}</strong>
                  {text.slice(start + length)}
                </>
              );
            })()}
          </span>
        </div>
      ) : null}

      {req.createdAt ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Solicitado el</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDate(req.createdAt)}</span>
        </div>
      ) : null}

      {(req.status === "rejected" || req.status === "refund_requested" || req.status === "refund_review") && (req.rejectedAt ?? req.updatedAt) ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Rechazado el</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDate(req.rejectedAt ?? req.updatedAt)}</span>
        </div>
      ) : null}

      {req.rejectionReason ? (
        <div style={{
          display: "grid", gap: 4,
          background: "rgba(120,18,18,0.28)", border: "1px solid rgba(255,90,90,0.24)",
          borderRadius: 13, padding: "10px 12px",
        }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Motivo de rechazo</span>
          <span style={{ color: "#ffdada", fontSize: 13, lineHeight: 1.4 }}>{req.rejectionReason}</span>
        </div>
      ) : null}

      {req.autoRejectReason === "creator_no_show_after_15_minutes" ? (
        <div style={{ background: "rgba(120,18,18,0.28)", border: "1px solid rgba(255,90,90,0.24)", borderRadius: 13, padding: "10px 12px" }}>
          <span style={{ color: "#ffdada", fontSize: 13, lineHeight: 1.4 }}>
            El creador no se conectó dentro de los 15 minutos posteriores a la hora agendada.
          </span>
        </div>
      ) : null}

      {req.autoRejectReason === "buyer_no_show_after_15_minutes" ? (
        <div style={{ background: "rgba(120,18,18,0.28)", border: "1px solid rgba(255,90,90,0.24)", borderRadius: 13, padding: "10px 12px" }}>
          <span style={{ color: "#ffdada", fontSize: 13, lineHeight: 1.4 }}>
            No te conectaste dentro de los 15 minutos posteriores a la hora agendada.
          </span>
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
        El creador tiene 60 días para responder tu solicitud. Si no lo hace, se realizará la devolución de manera automática.
      </p>
    </div>
  ) : null;

  const footerContent = refundOpen ? (
    <div style={{ display: "grid", gap: 8 }}>
      <textarea
        value={refundReason}
        onChange={(e) => setRefundReason(e.target.value)}
        placeholder="Explica por qué solicitas devolución."
        style={{
          background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12,
          color: "#fff", fontSize: 13, padding: "10px 12px", resize: "none",
          height: 80, fontFamily: "inherit", lineHeight: 1.5, outline: "none",
          width: "100%", boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button"
          onClick={() => { onRefund(refundReason); setRefundOpen(false); }}
          disabled={busy}
          style={{
            flex: 1, height: 42, borderRadius: 5, border: "none",
            background: busy ? "rgba(255,255,255,0.1)" : "rgba(220,38,38,0.80)",
            color: busy ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
            fontSize: 15, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
            fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
          }}
        >
          {busy ? "Procesando..." : "Confirmar devolución"}
        </button>
        <button type="button" onClick={() => setRefundOpen(false)} style={{
          flex: 1, height: 42, borderRadius: 5, border: "none",
          background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.70)",
          fontSize: 15, fontWeight: 500, cursor: "pointer",
          fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
        }}>
          Cancelar
        </button>
      </div>
    </div>
  ) : rescheduleOpen ? (
    <div style={{ display: "grid", gap: 8 }}>
      <textarea
        value={rescheduleReason}
        onChange={(e) => setRescheduleReason(e.target.value)}
        placeholder="Sugiere un horario o describe cuándo puedes..."
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
          {busy ? "Enviando..." : "Confirmar solicitud"}
        </button>
        <button type="button" onClick={() => setRescheduleOpen(false)} style={{
          flex: 1, height: 42, borderRadius: 5, border: "none",
          background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.70)",
          fontSize: 15, fontWeight: 500, cursor: "pointer",
          fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
        }}>
          Cancelar
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
        Intentar de nuevo
      </button>
      <button type="button" onClick={() => setRefundOpen(true)} disabled={busy} style={{
        flex: 1, height: 42, borderRadius: 5, border: "none",
        background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.70)",
        fontSize: 15, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
        fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
      }}>
        Solicitar devolución
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
              <span style={{ fontSize: 12, color: "#fde047", lineHeight: 1.4 }}>Este es tu último intento de cambio de horario.</span>
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
        Reagendar
      </button>
    </div>
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
          position: "fixed", inset: 0, width: "100vw", height: "100vh",
          zIndex: 999999, display: "flex", alignItems: "flex-end", justifyContent: "center",
          background: "rgba(0,0,0,0.52)", backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)", fontFamily: "inherit",
        }}
      >
        <style>{ANIM_CSS}</style>
        {/* panel outer */}
        <div style={{
          width: "100%", maxHeight: "calc(100vh - 72px)",
          display: "flex", flexDirection: "column",
          background: "rgba(8,9,11,0.96)",
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
              maxHeight: "calc(100vh - 140px)", borderRadius: "22px 22px 0 0",
              background: "rgba(8,9,11,0.96)", boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
              color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column",
              position: "relative",
            }}>
              <div style={{
                position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 0,
                backgroundImage: `url('${bgImage}')`, backgroundSize: "100% auto",
                backgroundPosition: "center bottom", backgroundRepeat: "no-repeat",
                opacity: 0.35, pointerEvents: "none",
              }} />
              <div style={{
                position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1, pointerEvents: "none",
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
            <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.07)", padding: `10px 14px calc(14px + env(safe-area-inset-bottom))` }}>
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
        position: "fixed", inset: 0, width: "100vw", height: "100vh",
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
          position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 0,
          backgroundImage: `url('${bgImage}')`, backgroundSize: "100% auto",
          backgroundPosition: "center bottom", backgroundRepeat: "no-repeat",
          opacity: 0.35, pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1, pointerEvents: "none",
          background: "linear-gradient(to bottom, #0a0a0a 50%, rgba(10,10,10,0.85) 68%, rgba(10,10,10,0.4) 85%, transparent 100%)",
        }} />
        <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <header style={{ ...headerStyle, gridTemplateColumns: "48px 1fr 48px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
            <div aria-hidden="true" />
            <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
              {serviceTitle}
            </h3>
            <button type="button" onClick={handleClose} aria-label="Cerrar" style={{
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
