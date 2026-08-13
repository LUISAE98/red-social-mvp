"use client";

import Image from "next/image";
import { formatDateTimeLong } from "@/lib/i18n/dateTime";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations, useLocale } from "next-intl";
import { createPortal } from "react-dom";
import type { GreetingRequestDoc } from "./OwnerSidebar";
import { playEdgeTTS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

const btnPrimary: React.CSSProperties = {
  width: "100%", height: 42, borderRadius: 5, border: "none",
  background: "#a855f7", color: "rgba(255,255,255,0.98)",
  fontSize: 17, fontWeight: 500, cursor: "pointer",
  fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
};
const btnSecondary: React.CSSProperties = {
  width: "100%", height: 42, borderRadius: 5, border: "none",
  background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.70)",
  fontSize: 15, fontWeight: 500, cursor: "pointer",
  fontFamily: "inherit", letterSpacing: "-0.02em", display: "grid", placeItems: "center",
};

const PANEL_CLOSE_THRESHOLD = 130;

function applyPanelOffset(raw: number): number {
  if (raw >= 0) return Math.min(window.innerHeight, raw);
  return raw * 0.2;
}

function formatDate(ts: { toDate: () => Date } | undefined, locale: string): string {
  return formatDateTimeLong(ts, locale) ?? "";
}

function getRelativeTime(ts: { toDate: () => Date } | null | undefined, tCommon: (key: string, params?: Record<string, number>) => string): string {
  if (!ts) return tCommon("relativeTimeNow");
  const diffMs = Date.now() - ts.toDate().getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return tCommon("relativeTimeDays", { count: diffDays });
  if (diffHours >= 1) return tCommon("relativeTimeHours", { count: diffHours });
  if (diffMins >= 1) return tCommon("relativeTimeMinutes", { count: diffMins });
  return tCommon("relativeTimeNow");
}

function getTypeLabel(type: string, t: (key: string) => string): string {
  if (type === "consejo") return t("typeLabelAdvice");
  return t("typeLabelGreeting");
}

function getStatusLabel(status: string, t: (key: string) => string): string {
  if (status === "accepted") return t("statusInProgress");
  if (status === "delivered") return t("statusDelivered");
  if (status === "rejected") return t("statusRejected");
  return t("statusPending");
}

function getStatusStyle(status: string): React.CSSProperties {
  if (status === "delivered") return { background: "rgba(34,197,94,0.14)", color: "#86efac", border: "1px solid rgba(34,197,94,0.22)" };
  if (status === "rejected") return { background: "rgba(244,63,94,0.14)", color: "#fda4af", border: "1px solid rgba(244,63,94,0.22)" };
  if (status === "accepted") return { background: "rgba(59,130,246,0.14)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.22)" };
  return { background: "rgba(168,85,255,0.14)", color: "#d8b4fe", border: "1px solid rgba(168,85,255,0.22)" };
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
  item: { id: string; data: GreetingRequestDoc };
  sourceName: string;
  sourceAvatar: string | null;
  onClose: () => void;
  onRefund?: (reason: string) => void;
  onRetry?: () => void;
};

export default function BuyerGreetingRequestOverlay({ item, sourceName, sourceAvatar, onClose, onRefund, onRetry }: Props) {
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const { format: formatMoney } = usePriceFormat();
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
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
  const typeLabel = getTypeLabel(req.type, tWallet);
  const bgImage = req.type === "consejo" ? "/consejo.webp" : "/saludo.webp";
  const retryBtnBg = req.type === "consejo" ? "rgba(250,204,21,0.85)" : "#a855f7";
  const retryBtnColor = req.type === "consejo" ? "#111" : "#fff";
  const priceColor = req.type === "consejo" ? "#fde047" : "#d8b4fe";
  const createdAt = req.createdAt as { toDate: () => Date } | undefined;
  const sourceInitial = sourceName.charAt(0).toUpperCase();
  const instructionsLabel =
    req.type === "consejo" ? tServices("contextAdvice") :
    tServices("contextGreeting");

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
    const genRef = speechGenRef;
    const audioRef = ttsAudioRef;
    return () => {
      genRef.current++;
      if (audioRef.current) { audioRef.current.stop(); audioRef.current = null; }
    };
  }, []);

  const startSpeechFrom = useCallback((charIndex: number) => {
    const text = req.instructions ?? "";
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
  }, [req.instructions]);

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

  const sourceRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {sourceAvatar ? (
        <Image src={sourceAvatar} alt={sourceName} width={40} height={40}
          style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}
        />
      ) : (
        <div style={{
          width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center",
          justifyContent: "center", fontWeight: 700, fontSize: 14, color: "#fff", flexShrink: 0,
        }}>
          {sourceInitial}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sourceName}
        </span>
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3 }}>
          {getStatusLabel(req.status, tServices)}
        </span>
      </div>
      {req.priceSnapshot != null && (
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
          <span style={{ color: priceColor, fontSize: 10, fontWeight: 500, opacity: 0.8, lineHeight: 1 }}>{tServices("paidLabel")}</span>
          <span style={{ color: priceColor, fontWeight: 700, fontSize: 24, lineHeight: 1 }}>{formatMoney(req.priceSnapshot, { baseCurrency: req.currency ?? "MXN", code: true })}</span>
        </div>
      )}
    </div>
  );

  const infoFields = (
    <div style={{ display: "grid", gap: 14 }}>
      {req.toName ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{tServices("toWhomLabel")}</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{req.toName}</span>
        </div>
      ) : null}

      {req.instructions ? (
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, flex: 1 }}>{instructionsLabel}</span>
            {speechState !== "idle" && (
              <button
                type="button"
                aria-label={tServices("changeReadingSpeed")}
                onClick={handleCycleRate}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.55)", padding: "2px 4px", display: "flex", alignItems: "center", flexShrink: 0, fontSize: 11, fontWeight: 700, letterSpacing: "-0.3px" }}
              >
                {speechRate}×
              </button>
            )}
            <button
              type="button"
              aria-label={speechState === "playing" ? tServices("pauseReading") : speechState === "paused" ? tServices("resumeReading") : tServices("readContext")}
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
              const text = req.instructions;
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

      {createdAt ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{tServices("requestedOn")}</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDate(createdAt, locale)}</span>
        </div>
      ) : null}

      {(req.status === "rejected" || req.status === "refund_requested" || req.status === "refund_review") && req.updatedAt ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{tServices("rejectedOn")}</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{formatDate(req.updatedAt as { toDate: () => Date }, locale)}</span>
        </div>
      ) : null}
    </div>
  );

  const isTerminal = ["rejected", "refund_requested", "refund_review", "delivered"].includes(req.status);

  const noticeBlock = !isTerminal ? (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={priceColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4" />
        <circle cx="12" cy="8" r="0.5" fill={priceColor} />
      </svg>
      <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
        {tServices("greetingResponseNotice")}
      </p>
    </div>
  ) : null;

  // Devolución SIN preguntar el motivo: un clic → el padre llama al callable y muestra el
  // panel verde de éxito (con el crédito acreditado).
  const footerContent = req.status === "rejected" ? (
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" onClick={onRetry} style={{ ...btnPrimary, flex: 1, width: "auto", background: retryBtnBg, color: retryBtnColor }}>
        {tCommon("retry")}
      </button>
      <button type="button" onClick={() => onRefund?.("")} style={{ ...btnSecondary, flex: 1, width: "auto" }}>
        {tServices("requestRefund")}
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
                    {tServices("typeRequested", { type: typeLabel })}
                  </h3>
                  <button type="button" onClick={handleClose} style={{
                    width: 40, height: 40, border: "none", background: "transparent",
                    color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid",
                    placeItems: "center", fontSize: 32, fontWeight: 300, lineHeight: 1, justifySelf: "end",
                  }}>×</button>
                </header>
                <div className="vibra-panel-mobile-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "12px 14px 8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {sourceRow}
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
              {tServices("typeRequested", { type: typeLabel })}
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
              {sourceRow}
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
