"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import type { GreetingType } from "@/lib/greetings/greetingRequests";
import type { Currency } from "@/types/group";
import type { CSSProperties } from "react";

// ─── Props ───────────────────────────────────────────────────────────────────

type CreatorServiceModalsProps = {
  greetOpen: boolean;
  greetSubmitting: boolean;
  greetType: GreetingType;
  creatorName?: string;
  toName: string;
  instructions: string;
  greetError: string | null;
  greetSuccess: string | null;
  onCloseGreeting: () => void;
  onSubmitGreeting: () => void;
  onChangeToName: (value: string) => void;
  onChangeInstructions: (value: string) => void;
  allowCreatorStory: boolean;
  onChangeAllowCreatorStory: (value: boolean) => void;
  greetPriceLabel?: string;

  meetGreetOpen: boolean;
  meetGreetSubmitting: boolean;
  meetGreetMessage: string;
  meetGreetError: string | null;
  meetGreetPriceLabel: string;
  meetGreetDurationLabel: string;
  onCloseMeetGreet: () => void;
  onSubmitMeetGreet: () => void;
  onChangeMeetGreetMessage: (value: string) => void;

  exclusiveSessionOpen: boolean;
  exclusiveSessionSubmitting: boolean;
  exclusiveSessionMessage: string;
  exclusiveSessionError: string | null;
  exclusiveSessionPriceLabel: string;
  exclusiveSessionDurationLabel: string;
  onCloseExclusiveSession: () => void;
  onSubmitExclusiveSession: () => void;
  onChangeExclusiveSessionMessage: (value: string) => void;

  serviceToast: string | null;
  isRetry?: boolean;

  // Legacy style props — kept for API compat, styles handled internally now
  subtitleStyle?: CSSProperties;
  textStyle?: CSSProperties;
  microText?: CSSProperties;
  labelStyle?: CSSProperties;
  primaryButton?: CSSProperties;
  secondaryButton?: CSSProperties;
  panelStyle?: CSSProperties;
  inputStyle?: CSSProperties;
  messageBox?: CSSProperties;
  serviceModalBackdropStyle?: CSSProperties;
  serviceModalCardStyle?: CSSProperties;
  serviceToastStyle?: CSSProperties;
  formatMoney?: (value: number, currency: Currency) => string;
};

// ─── Greeting copy ────────────────────────────────────────────────────────────

function getGreetingUi(type: GreetingType, tServices: ReturnType<typeof useTranslations>, creatorName?: string) {
  if (type === "consejo") {
    const name = creatorName ?? tServices("creatorFallback");
    return {
      title: tServices("greetTitleConsejoWith", { name }),
      intro: tServices("greetIntroConsejoWith", { name }),
      recipientLabel: tServices("greetRecipientConsejo"),
      recipientPlaceholder: "",
      instructionsLabel: tServices("greetInstructionsConsejo"),
      instructionsPlaceholder: "",
      submitLabel: tServices("requestAdvice"),
      helperText: tServices("greetHelperConsejo"),
    };
  }
  const name = creatorName ?? tServices("creatorFallback");
  return {
    title: tServices("greetTitleSaludoWith", { name }),
    intro: tServices("greetIntroSaludoWith", { name }),
    recipientLabel: tServices("greetRecipientSaludo"),
    recipientPlaceholder: "",
    instructionsLabel: tServices("greetInstructionsSaludoWith"),
    instructionsPlaceholder: "",
    submitLabel: tServices("continueToPayment"),
    helperText: tServices("greetHelperSaludo"),
  };
}

// ─── Panel shell (desktop modal + mobile bottom sheet) ────────────────────────

const PANEL_CSS = `
  @keyframes vibraSvcDesktopIn  { from { opacity:0; transform:scale(0.94) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
  @keyframes vibraSvcDesktopOut { from { opacity:1; transform:scale(1)    translateY(0);    } to { opacity:0; transform:scale(0.94) translateY(10px); } }
  @keyframes vibraSvcMobileIn   { from { transform:translateY(100%); } to { transform:translateY(0); } }
  @keyframes vibraSvcMobileOut  { from { transform:translateY(0);    } to { transform:translateY(100%); } }

  .vibra-svc-backdrop {
    position: fixed; inset: 0;
    z-index: 2147483646;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    background: rgba(0,0,0,0.88);
    font-family: inherit;
  }
  .vibra-svc-panel {
    width: min(100%, 540px);
    max-height: min(88vh, 680px);
    display: flex; flex-direction: column;
    border-radius: 18px;
    background: #0a0a0a;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9);
    color: #fff;
    overflow: hidden;
  }
  .vibra-svc-panel.is-open   { animation: vibraSvcDesktopIn  180ms ease-out; }
  .vibra-svc-panel.is-closed { animation: vibraSvcDesktopOut 180ms ease-in forwards; }

  .vibra-svc-header {
    height: 56px; flex-shrink: 0;
    display: grid; grid-template-columns: 48px 1fr 48px;
    align-items: center; padding: 0 12px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
  }
  .vibra-svc-body {
    flex: 1; overflow-y: auto; min-height: 0;
    padding: 18px 20px 8px;
    display: grid; gap: 14px;
  }
  .vibra-svc-body::-webkit-scrollbar { width: 7px; }
  .vibra-svc-body::-webkit-scrollbar-track { background: transparent; }
  .vibra-svc-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 999px; }
  .vibra-svc-footer {
    flex-shrink: 0;
    padding: 14px 20px calc(18px + var(--vb-safe-bottom, 0px));
    border-top: 1px solid rgba(255,255,255,0.12);
    display: grid; gap: 10px;
  }
  .vibra-svc-handle { display: none; }
  .vibra-svc-panel { position: relative; }
  .vibra-svc-handle, .vibra-svc-header, .vibra-svc-body, .vibra-svc-footer { position: relative; z-index: 2; }

  .vibra-svc-bg-img {
    position: absolute; top: 0; inset-inline-end: 0; bottom: 0; inset-inline-start: 0; z-index: 0;
    background-size: 100% auto;
    background-position: center bottom;
    background-repeat: no-repeat;
    opacity: 0.35;
  }
  .vibra-svc-bg-grad {
    position: absolute; top: 0; inset-inline-end: 0; bottom: 0; inset-inline-start: 0; z-index: 1;
    background: linear-gradient(to bottom, #0a0a0a 50%, rgba(10,10,10,0.85) 68%, rgba(10,10,10,0.4) 85%, transparent 100%);
    -webkit-transform: translateZ(0); transform: translateZ(0);
    will-change: opacity;
  }

  /* Portatiles BAJOS (no estrechos): el panel estaba pensado para pantallas
     altas y ahi se comia la ventana entera. Se encoge y respira menos. */
  @media (min-width: 560px) and (max-height: 780px) {
    .vibra-svc-backdrop { padding: 12px; }
    .vibra-svc-panel { width: min(100%, 460px); max-height: 94vh; }
    .vibra-svc-body { padding-top: 10px; padding-bottom: 10px; }
  }

  @media (max-width: 559px) {
    .vibra-svc-bg-img { opacity: 0.35; }
    .vibra-svc-bg-grad {
      background: linear-gradient(to bottom, #0a0a0a 0%, #0a0a0a 52%, rgba(10,10,10,0.9) 68%, rgba(10,10,10,0.6) 84%, rgba(10,10,10,0.28) 100%);
    }
  }

  @media (max-width: 559px) {
    .vibra-svc-handle {
      display: flex; justify-content: center; padding-top: 10px; flex-shrink: 0;
    }
    .vibra-svc-backdrop {
      align-items: flex-end; padding: 0;
      background: rgba(0,0,0,0.52);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    }
    .vibra-svc-panel {
      width: 100%; max-height: calc(var(--vb-alto-pantalla) - 72px);
      border-radius: 22px 22px 0 0;
      box-shadow: 0 -24px 80px rgba(0,0,0,0.56);
    }
    .vibra-svc-panel.is-open   { animation: vibraSvcMobileIn  260ms cubic-bezier(0.22,1,0.36,1); }
    .vibra-svc-panel.is-closed { animation: vibraSvcMobileOut 260ms cubic-bezier(0.22,1,0.36,1) forwards; }
    .vibra-svc-header { grid-template-columns: 72px 1fr 72px; }
  }
`;

const CLOSE_DELAY_DESKTOP = 180;
const CLOSE_DELAY_MOBILE  = 260;
const SWIPE_CLOSE_THRESHOLD = 130;

function Panel({
  open,
  title,
  titleId,
  submitting,
  onClose,
  children,
  footer,
  bgImage,
}: {
  open: boolean;
  title: string;
  titleId: string;
  submitting: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  bgImage?: string;
}) {
  const tCommon = useTranslations("common");
  const [visible, setVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ y: number; offset: number } | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 559);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
      setPanelOffsetY(0);
    } else {
      const delay = isMobile ? CLOSE_DELAY_MOBILE : CLOSE_DELAY_DESKTOP;
      const t = setTimeout(() => setVisible(false), delay);
      return () => clearTimeout(t);
    }
  }, [open, isMobile]);

  function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
    if (!isMobile) return;
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, offset: panelOffsetY };
    setIsDragging(true);
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const raw = dragStart.current.offset + (e.clientY - dragStart.current.y);
    setPanelOffsetY(raw >= 0 ? Math.min(window.innerHeight, raw) : raw * 0.2);
  }
  function handlePointerUp() {
    if (!dragStart.current) return;
    if (panelOffsetY >= SWIPE_CLOSE_THRESHOLD && !submitting) {
      onClose();
    } else {
      setPanelOffsetY(0);
    }
    dragStart.current = null;
    setIsDragging(false);
  }

  if (!visible && !open) return null;

  // On mobile: apply drag offset directly to panel; on desktop: CSS animation handles everything
  const panelStyle: React.CSSProperties = isMobile && open ? {
    transform: `translateY(${panelOffsetY}px)`,
    transition: isDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
  } : {};

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="vibra-svc-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !submitting) onClose();
        }}
      >
        <section
          className={`vibra-svc-panel ${open ? "is-open" : "is-closed"}`}
          style={panelStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Background image — subtle, bottom-anchored */}
          {bgImage && (
            <>
              <div className="vibra-svc-bg-img" style={{ backgroundImage: `url('${bgImage}')` }} />
              <div className="vibra-svc-bg-grad" />
            </>
          )}

          {/* Pill handle — visible on mobile only via CSS */}
          <div className="vibra-svc-handle">
            <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
          </div>

          <header
            className="vibra-svc-header"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
          >
            <div aria-hidden="true" />
            <h3
              id={titleId}
              style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}
            >
              {title}
            </h3>
            <button
              type="button"
              onClick={() => { if (!submitting) onClose(); }}
              aria-label={tCommon("close")}
              style={{ border: "none", background: "none", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4, width: 40, height: 40, fontSize: 28, fontWeight: 300, lineHeight: 1 }}
            >
              ×
            </button>
          </header>

          <div className="vibra-svc-body">
            {children}
          </div>

          <div className="vibra-svc-footer">
            {footer}
          </div>
        </section>
      </div>
    </>
  );
}

// ─── Internal style constants ─────────────────────────────────────────────────

const s = {
  label: { fontSize: 14, fontWeight: 500, lineHeight: 1.3, color: "#fff" } as CSSProperties,
  text: { fontSize: 12, fontWeight: 400, lineHeight: 1.5, color: "rgba(255,255,255,0.82)" } as CSSProperties,
  micro: { fontSize: 12, fontWeight: 400, lineHeight: 1.45, color: "rgba(255,255,255,0.70)" } as CSSProperties,
  input: {
    width: "100%", padding: "12px 13px", borderRadius: 12,
    border: "none", background: "rgba(255,255,255,0.06)",
    color: "#fff", outline: "none", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
    boxSizing: "border-box", appearance: "none", WebkitAppearance: "none",
  } as CSSProperties,
  summaryPanel: {
    padding: 14, borderRadius: 16,
    background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025))",
    border: "1px solid rgba(255,255,255,0.12)",
    display: "grid", gap: 6,
  } as CSSProperties,
  primaryBtn: {
    width: "100%", height: 42, borderRadius: 5, border: "none",
    background: "#a855f7", color: "rgba(255,255,255,0.98)",
    fontSize: 15, fontWeight: 500, fontFamily: "inherit",
    cursor: "pointer", letterSpacing: "-0.02em",
    display: "flex", alignItems: "center", justifyContent: "center",
    whiteSpace: "nowrap",
  } as CSSProperties,
  primaryBtnDisabled: {
    background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.36)", cursor: "not-allowed",
  } as CSSProperties,
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function CreatorServiceModals({
  greetOpen, greetSubmitting, greetType, creatorName,
  toName, instructions, greetError, greetSuccess,
  onCloseGreeting, onSubmitGreeting, onChangeToName, onChangeInstructions,
  allowCreatorStory, onChangeAllowCreatorStory,
  greetPriceLabel,

  meetGreetOpen, meetGreetSubmitting, meetGreetMessage, meetGreetError,
  meetGreetPriceLabel, meetGreetDurationLabel,
  onCloseMeetGreet, onSubmitMeetGreet, onChangeMeetGreetMessage,

  exclusiveSessionOpen, exclusiveSessionSubmitting, exclusiveSessionMessage, exclusiveSessionError,
  exclusiveSessionPriceLabel, exclusiveSessionDurationLabel,
  onCloseExclusiveSession, onSubmitExclusiveSession, onChangeExclusiveSessionMessage,

  serviceToast,
  isRetry,
}: CreatorServiceModalsProps) {
  const tServices = useTranslations("services");
  const [mounted, setMounted] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [meetGreetAcceptedTerms, setMeetGreetAcceptedTerms] = useState(false);
  const [exclusiveSessionAcceptedTerms, setExclusiveSessionAcceptedTerms] = useState(false);
  const { toast: serviceModalToast, showToast: showServiceModalToast } = useVibraToast();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const id = "vibra-svc-panel-css";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = PANEL_CSS;
      document.head.appendChild(el);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!greetOpen) setAcceptedTerms(false); }, [greetOpen]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!meetGreetOpen) setMeetGreetAcceptedTerms(false); }, [meetGreetOpen]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!exclusiveSessionOpen) setExclusiveSessionAcceptedTerms(false); }, [exclusiveSessionOpen]);
  useEffect(() => { if (greetError)            showServiceModalToast(greetError, "error"); }, [greetError]);           // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (greetSuccess)          showServiceModalToast(greetSuccess, "success"); }, [greetSuccess]);     // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (meetGreetError)        showServiceModalToast(meetGreetError, "error"); }, [meetGreetError]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (exclusiveSessionError) showServiceModalToast(exclusiveSessionError, "error"); }, [exclusiveSessionError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (serviceToast) showServiceModalToast(serviceToast, serviceToast.startsWith("No puedes") ? "warning" : "success"); }, [serviceToast]); // eslint-disable-line react-hooks/exhaustive-deps

  useBodyScrollLock(greetOpen || meetGreetOpen || exclusiveSessionOpen);

  useEffect(() => {
    const anyOpen = greetOpen || meetGreetOpen || exclusiveSessionOpen;
    if (!anyOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (greetOpen && !greetSubmitting) onCloseGreeting();
      if (meetGreetOpen && !meetGreetSubmitting) onCloseMeetGreet();
      if (exclusiveSessionOpen && !exclusiveSessionSubmitting) onCloseExclusiveSession();
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [greetOpen, greetSubmitting, meetGreetOpen, meetGreetSubmitting, exclusiveSessionOpen, exclusiveSessionSubmitting, onCloseGreeting, onCloseMeetGreet, onCloseExclusiveSession]);

  if (!mounted) return null;

  const greetingUi = getGreetingUi(greetType, tServices, creatorName);

  const greetAccent = greetType === "consejo" ? "#f7c948" : "#a855f7";
  const greetAccentDim = greetType === "consejo" ? "rgba(247,201,72,0.78)" : "rgba(168,85,247,0.78)";
  const greetGradient = greetType === "consejo"
    ? "linear-gradient(100deg, #f7c948, #f59e0b)"
    : "linear-gradient(100deg, #a855f7, #4f46ff)";
  const greetBgImage = greetType === "saludo" ? "/saludo.webp"
    : greetType === "consejo" ? "/consejo.webp"
    : undefined;

  // ── Greeting modal ────────────────────────────────────────────────────────

  // Lo minimo para poder encargar: a quien va y que decir. El flujo se corta si
  // falta alguno, asi que el boton no debe invitar a pulsarlo.
  const greetReady = toName.trim().length > 0 && instructions.trim().length > 0;

  const greetingModal = createPortal(
    <Panel
      open={greetOpen}
      title={greetingUi.title}
      titleId="vibra-svc-greet-title"
      submitting={greetSubmitting}
      onClose={onCloseGreeting}
      bgImage={greetBgImage}
      footer={
        <button
          type="button"
          onClick={onSubmitGreeting}
          // ⚠️ Tambien se desactiva si falta el destinatario o el contexto.
          //
          // Antes solo miraba los terminos, asi que con un campo vacio el boton
          // se veia activo, se pulsaba, y el flujo se cortaba en silencio: el
          // clic no hacia absolutamente nada y parecia que la pasarela estaba
          // rota.
          disabled={greetSubmitting || !acceptedTerms || !greetReady}
          style={{ ...s.primaryBtn, background: greetAccent, ...((greetSubmitting || !acceptedTerms || !greetReady) ? s.primaryBtnDisabled : {}) }}
        >
          {greetSubmitting ? tServices("submitting") : isRetry ? tServices("retryLabel") : greetPriceLabel ? <>{tServices("continueToPayment")} <span style={{ color: "#fff", opacity: 0.5, margin: "0 4px" }}>·</span> {greetPriceLabel}</> : tServices("continueToPayment")}
        </button>
      }
    >
      <p style={{ ...s.text, margin: 0 }}>{greetingUi.intro}</p>

      {(greetType === "saludo" || greetType === "consejo") && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {/* Check — Saludo personalizado */}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={greetAccent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l3 3 5-5.5" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{greetType === "consejo" ? tServices("greetBadgeConsejo") : tServices("greetBadgeSaludo")}</span>
              <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.4 }}>
                {greetType === "consejo"
                  ? tServices("greetBadgeConsejoDesc", { name: creatorName ?? tServices("creatorFallback") })
                  : tServices("greetBadgeSaludoDesc", { name: creatorName ?? tServices("creatorFallback") })}
              </span>
            </div>
          </div>
          {/* Download — Descargable */}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={greetAccent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M12 3v12M7 11l5 5 5-5" />
              <path d="M4 19h16" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("downloadableLabel")}</span>
              <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.4 }}>
                {greetType === "consejo" ? tServices("downloadableDescConsejo") : tServices("downloadableDescSaludo")}
              </span>
            </div>
          </div>
        </div>
      )}

      <label style={{ display: "grid", gap: 6 }}>
        <span style={s.label}>{greetingUi.recipientLabel}</span>
        <input
          autoFocus
          value={toName}
          onChange={(e) => onChangeToName(e.target.value)}
          placeholder={greetingUi.recipientPlaceholder}
          disabled={greetSubmitting}
          style={s.input}
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        <span style={s.label}>{greetingUi.instructionsLabel}</span>
        <textarea
          value={instructions}
          onChange={(e) => onChangeInstructions(e.target.value)}
          placeholder={greetingUi.instructionsPlaceholder}
          disabled={greetSubmitting}
          maxLength={greetType === "saludo" ? 500 : 900}
          rows={2}
          style={{ ...s.input, resize: "vertical", minHeight: 56 }}
          onFocus={(e) => { setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 80); }}
        />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "end" }}>
          {tServices("charsRemaining", { count: String((greetType === "saludo" ? 500 : 900) - instructions.length) })}
        </span>
      </label>

      {(greetType === "saludo" || greetType === "consejo") && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
            <span style={{ ...s.label, fontSize: 13, fontWeight: 600, color: greetAccentDim }}>{greetType === "consejo" ? tServices("allowInspireConsejoLabel") : tServices("allowInspireSaludoLabel")}</span>
            <span style={{ ...s.micro, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
              {greetType === "consejo" ? tServices("allowInspireConsejoDesc") : tServices("allowInspireSaludoDesc")}
            </span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
              {tServices("allowPrivacyNote")}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={allowCreatorStory}
            aria-label={tServices("allowStories")}
            onClick={() => { if (!greetSubmitting) onChangeAllowCreatorStory(!allowCreatorStory); }}
            disabled={greetSubmitting}
            style={{
              position: "relative", flexShrink: 0,
              width: 36, height: 20, borderRadius: 999, padding: 0,
              border: "1px solid rgba(255,255,255,0.18)",
              background: allowCreatorStory
                ? greetGradient
                : "rgba(255,255,255,0.10)",
              cursor: greetSubmitting ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <span style={{
              position: "absolute", top: 2,
              insetInlineStart: allowCreatorStory ? 18 : 2,
              width: 14, height: 14, borderRadius: "50%",
              background: "#fff", transition: "all 0.2s ease",
              display: "block",
            }} />
          </button>
        </div>
      )}

      {/* T&C switch */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <span style={{ ...s.label, fontSize: 13, fontWeight: 600, color: greetAccentDim }}>{tServices("termsTitle")}</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
            {tServices("termsDesc")}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={acceptedTerms}
          aria-label={tServices("termsAriaLabel")}
          onClick={() => { if (!greetSubmitting) setAcceptedTerms(!acceptedTerms); }}
          disabled={greetSubmitting}
          style={{
            position: "relative", flexShrink: 0,
            width: 36, height: 20, borderRadius: 999, padding: 0,
            border: "1px solid rgba(255,255,255,0.18)",
            background: acceptedTerms
              ? greetGradient
              : "rgba(255,255,255,0.10)",
            cursor: greetSubmitting ? "not-allowed" : "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <span style={{
            position: "absolute", top: 2,
            insetInlineStart: acceptedTerms ? 18 : 2,
            width: 14, height: 14, borderRadius: "50%",
            background: "#fff", transition: "all 0.2s ease",
            display: "block",
          }} />
        </button>
      </div>

    </Panel>,
    document.body
  );

  // ── Shared: scheduled request modal (meet & greet / exclusive session) ─────

  function renderScheduledRequestModal(params: {
    open: boolean;
    submitting: boolean;
    title: string;
    description: string;
    priceLabel: string;
    durationLabel: string;
    message: string;
    error: string | null;
    textareaLabel: string;
    textareaPlaceholder: string;
    submitLabel: string;
    helperText: string;
    titleId: string;
    sectionLabel?: string;
    showDetailIcons?: boolean;
    extraDetailIconSlot?: React.ReactNode;
    extraDetailIconSlot2?: React.ReactNode;
    includesItems?: string[];
    maxLength?: number;
    bgImage?: string;
    accentColor?: string;
    accentGradient?: string;
    accentDimColor?: string;
    termsAccepted?: boolean;
    onToggleTerms?: () => void;
    onClose: () => void;
    onSubmit: () => void;
    onChangeMessage: (value: string) => void;
    isRetry?: boolean;
  }) {
    const maxLen = params.maxLength ?? 500;
    const remaining = maxLen - params.message.length;
    const hasTerms = typeof params.termsAccepted === "boolean";
    const isDisabled = params.submitting || (hasTerms && !params.termsAccepted);
    const btnBg = params.accentGradient ?? "#a855f7";

    return (
      <Panel
        open={params.open}
        title={params.title}
        titleId={params.titleId}
        submitting={params.submitting}
        onClose={params.onClose}
        bgImage={params.bgImage}
        footer={
          <button
            type="button"
            onClick={params.onSubmit}
            disabled={isDisabled}
            style={{ ...s.primaryBtn, background: btnBg, ...(isDisabled ? s.primaryBtnDisabled : {}) }}
          >
            {params.submitting ? tServices("submitting") : params.isRetry ? tServices("retryLabel") : params.priceLabel
              ? <>{tServices("continueToPayment")} <span style={{ color: "#fff", opacity: 0.5, margin: "0 4px" }}>·</span> {params.priceLabel}</>
              : params.submitLabel}
          </button>
        }
      >
        <p style={{ ...s.text, margin: 0 }}>{params.description}</p>

        <div style={{ display: "grid", gap: 10 }}>
          <span style={{ ...s.label, fontWeight: 600 }}>{params.sectionLabel ?? tServices("serviceResume")}</span>

          {params.showDetailIcons ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {/* Reloj */}
              <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={params.accentColor ?? "#3b82f6"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("duration")}</span>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{params.durationLabel}</span>
                  <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.4 }}>{tServices("timeFullyDedicatedDesc")}</span>
                </div>
              </div>
              {/* Cámara */}
              <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={params.accentColor ?? "#3b82f6"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <rect x="2" y="6" width="14" height="12" rx="2" />
                  <path d="M16 10l6-3v10l-6-3V10Z" />
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("modalityLabel")}</span>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{tServices("onlineLabel")}</span>
                  <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.4 }}>{tServices("fromAnywhereDesc")}</span>
                </div>
              </div>
              {params.extraDetailIconSlot ?? null}
              {params.extraDetailIconSlot2 ?? null}
              {/* Palomita en círculo */}
              <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={params.accentColor ?? "#3b82f6"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12.5l3 3 5-5" />
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("whatIncludesLabel")}</span>
                  {(params.includesItems ?? [
                    tServices("defaultIncludeConversation"),
                    tServices("defaultIncludeDQ"),
                    tServices("defaultIncludeIdeas"),
                    tServices("defaultIncludeAttentionWith", { name: creatorName ?? tServices("creatorFallback") }),
                  ]).map((item) => (
                    <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={params.accentColor ?? "#3b82f6"} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
                        <path d="M4 12.5l5 5 11-11" />
                      </svg>
                      <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, lineHeight: 1.4 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Calendario */}
              <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={params.accentColor ?? "#3b82f6"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <rect x="3" y="4" width="18" height="17" rx="2" />
                  <path d="M3 10h18M8 2v4M16 2v4" />
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("scheduleDateTimeLabel")}</span>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 400, lineHeight: 1.2 }}>{tServices("scheduleToBeAgreed")}</span>
                  <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.4 }}>{tServices("scheduleContactForOptions")}</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <span style={s.micro}>{tServices("duration")}: {params.durationLabel}</span>
              <span style={s.micro}>{tServices("scheduleSimpleText")}</span>
            </>
          )}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ ...s.label, fontSize: 12 }}>{params.textareaLabel}</span>
          <textarea
            value={params.message}
            onChange={(e) => params.onChangeMessage(e.target.value)}
            disabled={params.submitting}
            maxLength={maxLen}
            rows={2}
            style={{ ...s.input, resize: "vertical" }}
            onFocus={(e) => { setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 80); }}
          />
          <span style={{ ...s.micro, textAlign: "end" }}>
            {tServices("charsRemaining", { count: String(remaining) })}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={params.accentColor ?? "#3b82f6"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4" />
            <circle cx="12" cy="8" r="0.5" fill={params.accentColor ?? "#3b82f6"} />
          </svg>
          <p style={{ ...s.micro, margin: 0 }}>{params.helperText}</p>
        </div>

        {hasTerms && params.onToggleTerms && (
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
              <span style={{ ...s.label, fontSize: 13, fontWeight: 600, color: params.accentDimColor ?? "rgba(255,255,255,0.78)" }}>
                {tServices("termsTitle")}
              </span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
                {tServices("termsDesc")}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={params.termsAccepted}
              aria-label={tServices("termsAriaLabel")}
              onClick={() => { if (!params.submitting) params.onToggleTerms!(); }}
              disabled={params.submitting}
              style={{
                position: "relative", flexShrink: 0,
                width: 36, height: 20, borderRadius: 999, padding: 0,
                border: "1px solid rgba(255,255,255,0.18)",
                background: params.termsAccepted ? (params.accentGradient ?? "#a855f7") : "rgba(255,255,255,0.10)",
                cursor: params.submitting ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <span style={{
                position: "absolute", top: 2,
                insetInlineStart: params.termsAccepted ? 18 : 2,
                width: 14, height: 14, borderRadius: "50%",
                background: "#fff", transition: "all 0.2s ease",
                display: "block",
              }} />
            </button>
          </div>
        )}
      </Panel>
    );
  }

  const meetGreetModal = createPortal(
    renderScheduledRequestModal({
      open: meetGreetOpen,
      submitting: meetGreetSubmitting,
      title: tServices("meetGreetTitleWith", { name: creatorName ?? tServices("creatorFallback") }),
      description: tServices("meetGreetDescWith", { name: creatorName ?? tServices("creatorFallback") }),
      priceLabel: meetGreetPriceLabel,
      durationLabel: meetGreetDurationLabel,
      message: meetGreetMessage,
      error: meetGreetError,
      textareaLabel: tServices("meetGreetTextareaLabel"),
      textareaPlaceholder: "",
      submitLabel: tServices("meetGreetSubmitLabel"),
      sectionLabel: tServices("meetGreetSectionLabel"),
      showDetailIcons: true,
      maxLength: 700,
      bgImage: "/encuentroenvivo.webp",
      accentColor: "#3b82f6",
      accentGradient: "linear-gradient(100deg, #3b82f6, #1d4ed8)",
      accentDimColor: "rgba(96,165,250,0.9)",
      termsAccepted: meetGreetAcceptedTerms,
      onToggleTerms: () => setMeetGreetAcceptedTerms(!meetGreetAcceptedTerms),
      helperText: tServices("meetGreetHelperTextFull"),
      titleId: "vibra-svc-meetgreet-title",
      onClose: onCloseMeetGreet,
      onSubmit: onSubmitMeetGreet,
      onChangeMessage: onChangeMeetGreetMessage,
      isRetry,
    }),
    document.body
  );

  const exclusiveSessionModal = createPortal(
    renderScheduledRequestModal({
      open: exclusiveSessionOpen,
      submitting: exclusiveSessionSubmitting,
      title: tServices("exclusiveSessionTitleWith", { name: creatorName ?? tServices("creatorFallback") }),
      description: tServices("exclusiveSessionDescWith", { name: creatorName ?? tServices("creatorFallback"), duration: exclusiveSessionDurationLabel }),
      priceLabel: exclusiveSessionPriceLabel,
      durationLabel: exclusiveSessionDurationLabel,
      message: exclusiveSessionMessage,
      error: exclusiveSessionError,
      textareaLabel: tServices("exclusiveSessionTextareaLabel"),
      textareaPlaceholder: "",
      submitLabel: tServices("requestExclusiveSessionSubmit"),
      sectionLabel: tServices("exclusiveSessionSectionLabel"),
      showDetailIcons: true,
      maxLength: 700,
      bgImage: "/sesionexclusiva.webp",
      accentColor: "#ec4899",
      accentGradient: "linear-gradient(100deg, #ec4899, #be185d)",
      extraDetailIconSlot: (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#ec4899" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1.5" fill="#ec4899" stroke="none" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("exclusiveSessionFocusedLabel")}</span>
            <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.4 }}>{tServices("exclusiveSessionFocusedDesc")}</span>
          </div>
        </div>
      ),
      extraDetailIconSlot2: (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, padding: "12px 10px", borderRadius: 12 }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#ec4899" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            <circle cx="12" cy="16" r="1" fill="#ec4899" stroke="none" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{tServices("exclusiveSessionPrivateLabel")}</span>
            <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.4 }}>{tServices("exclusiveSessionPrivateDesc")}</span>
          </div>
        </div>
      ),
      accentDimColor: "rgba(236,72,153,0.9)",
      termsAccepted: exclusiveSessionAcceptedTerms,
      onToggleTerms: () => setExclusiveSessionAcceptedTerms(!exclusiveSessionAcceptedTerms),
      helperText: tServices("exclusiveSessionHelperTextFull"),
      titleId: "vibra-svc-exclusive-title",
      onClose: onCloseExclusiveSession,
      onSubmit: onSubmitExclusiveSession,
      onChangeMessage: onChangeExclusiveSessionMessage,
      isRetry,
    }),
    document.body
  );

  return (
    <>
      {greetingModal}
      {meetGreetModal}
      {exclusiveSessionModal}
      <VibraToast toast={serviceModalToast} />
    </>
  );
}
