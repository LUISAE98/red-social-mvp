"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
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

function getGreetingUi(type: GreetingType, creatorName?: string) {
  if (type === "consejo") {
    const name = creatorName ?? "el creador";
    return {
      title: `Tu consejo personal con ${name}`,
      intro: `Cuéntale a ${name} cuál es tu situación o qué decisión necesitas tomar. Mientras más contexto compartas, más útil y personalizado podrá ser su consejo.`,
      recipientLabel: "¿Sobre qué tema te gustaría recibir un consejo?",
      recipientPlaceholder: "",
      instructionsLabel: "Cuéntale tu situación con el mayor detalle posible",
      instructionsPlaceholder: "",
      submitLabel: "Solicitar consejo",
      helperText: "Nota: el creador revisará tu solicitud de consejo y podrá aceptarla o rechazarla. Pagos y entrega se integran después.",
    };
  }
  if (type === "mensaje") {
    return {
      title: "Solicitar mensaje",
      intro: "Completa tu solicitud con contexto claro para que el creador prepare el mensaje de forma personalizada.",
      recipientLabel: "¿A quién va dirigido el mensaje?",
      recipientPlaceholder: "Ej. Para Juan",
      instructionsLabel: "Indica el contexto del mensaje",
      instructionsPlaceholder: "Ej. Mensaje de felicitación, apoyo, ánimo o respuesta personalizada.",
      submitLabel: "Solicitar mensaje",
      helperText: "Nota: el creador podrá aceptar o rechazar tu solicitud de mensaje. Pagos y entrega se integran después.",
    };
  }
  const name = creatorName ?? "el creador";
  return {
    title: `Tu saludo personalizado con ${name}`,
    intro: `Cuéntale a ${name} para quién es el saludo y qué te gustaría que dijera. Mientras más detalles compartas, más especial será el video.`,
    recipientLabel: "¿Para quién es el saludo?",
    recipientPlaceholder: "",
    instructionsLabel: "Cuéntanos cómo te gustaría que fuera el saludo",
    instructionsPlaceholder: "",
    submitLabel: "Continuar al pago",
    helperText: "Nota: el creador podrá aceptar o rechazar tu solicitud de saludo. Pagos y entrega de video se integran después.",
  };
}

// ─── Panel shell (desktop modal + mobile bottom sheet) ────────────────────────

const PANEL_CSS = `
  @keyframes vibraSvcDesktopIn  { from { opacity:0; transform:scale(0.94) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
  @keyframes vibraSvcDesktopOut { from { opacity:1; transform:scale(1)    translateY(0);    } to { opacity:0; transform:scale(0.94) translateY(10px); } }
  @keyframes vibraSvcMobileIn   { from { transform:translateY(100%); } to { transform:translateY(0); } }
  @keyframes vibraSvcMobileOut  { from { transform:translateY(0);    } to { transform:translateY(100%); } }

  .vibra-svc-backdrop {
    position: fixed; inset: 0; width: 100vw; height: 100vh;
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
    padding: 14px 20px 18px;
    border-top: 1px solid rgba(255,255,255,0.12);
    display: grid; gap: 10px;
  }
  .vibra-svc-handle { display: none; }
  .vibra-svc-panel { position: relative; }
  .vibra-svc-handle, .vibra-svc-header, .vibra-svc-body, .vibra-svc-footer { position: relative; z-index: 1; }

  .vibra-svc-bg-img {
    position: absolute; inset: 0; z-index: 0;
    background-size: 100% auto;
    background-position: center bottom;
    background-repeat: no-repeat;
    opacity: 0.35;
  }
  .vibra-svc-bg-grad {
    position: absolute; inset: 0; z-index: 0;
    background: linear-gradient(to bottom, #0a0a0a 50%, rgba(10,10,10,0.85) 68%, rgba(10,10,10,0.4) 85%, transparent 100%);
  }

  @media (max-width: 559px) {
    .vibra-svc-bg-img { opacity: 0.35; }
    .vibra-svc-bg-grad {
      background: linear-gradient(to bottom, #0a0a0a 55%, rgba(10,10,10,0.88) 72%, rgba(10,10,10,0.55) 87%, rgba(10,10,10,0.25) 100%);
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
      width: 100%; max-height: calc(100vh - 72px);
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
              aria-label="Cerrar"
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
    width: "100%", padding: "10px 12px", borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.09)", background: "transparent",
    color: "#fff", outline: "none", fontSize: 14, fontFamily: "inherit",
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
    background: "#a855ff", color: "rgba(255,255,255,0.98)",
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
}: CreatorServiceModalsProps) {
  const [mounted, setMounted] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const { toast: serviceModalToast, showToast: showServiceModalToast } = useVibraToast();

  useEffect(() => {
    setMounted(true);
    const id = "vibra-svc-panel-css";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = PANEL_CSS;
      document.head.appendChild(el);
    }
  }, []);

  useEffect(() => { if (!greetOpen) setAcceptedTerms(false); }, [greetOpen]);
  useEffect(() => { if (greetError)            showServiceModalToast(greetError, "error"); }, [greetError]);           // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (greetSuccess)          showServiceModalToast(greetSuccess, "success"); }, [greetSuccess]);     // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (meetGreetError)        showServiceModalToast(meetGreetError, "error"); }, [meetGreetError]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (exclusiveSessionError) showServiceModalToast(exclusiveSessionError, "error"); }, [exclusiveSessionError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (serviceToast) showServiceModalToast(serviceToast, serviceToast.startsWith("No puedes") ? "warning" : "success"); }, [serviceToast]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const anyOpen = greetOpen || meetGreetOpen || exclusiveSessionOpen;
    if (!anyOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (greetOpen && !greetSubmitting) onCloseGreeting();
      if (meetGreetOpen && !meetGreetSubmitting) onCloseMeetGreet();
      if (exclusiveSessionOpen && !exclusiveSessionSubmitting) onCloseExclusiveSession();
    }
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [greetOpen, greetSubmitting, meetGreetOpen, meetGreetSubmitting, exclusiveSessionOpen, exclusiveSessionSubmitting, onCloseGreeting, onCloseMeetGreet, onCloseExclusiveSession]);

  if (!mounted) return null;

  const greetingUi = getGreetingUi(greetType, creatorName);

  const greetAccent = greetType === "consejo" ? "#f7c948" : "#a855f7";
  const greetAccentDim = greetType === "consejo" ? "rgba(247,201,72,0.78)" : "rgba(168,85,247,0.78)";
  const greetGradient = greetType === "consejo"
    ? "linear-gradient(100deg, #f7c948, #f59e0b)"
    : "linear-gradient(100deg, #a855ff, #4f46ff)";
  const greetBgImage = greetType === "saludo" ? "/saludo.png"
    : greetType === "consejo" ? "/consejo.png"
    : undefined;

  // ── Greeting modal ────────────────────────────────────────────────────────

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
          disabled={greetSubmitting || !acceptedTerms}
          style={{ ...s.primaryBtn, background: greetAccent, ...((greetSubmitting || !acceptedTerms) ? s.primaryBtnDisabled : {}) }}
        >
          {greetSubmitting ? "Enviando..." : greetPriceLabel ? <>Continuar al pago <span style={{ color: "#fff", opacity: 0.5, margin: "0 4px" }}>·</span> {greetPriceLabel}</> : "Continuar al pago"}
        </button>
      }
    >
      <p style={{ ...s.text, margin: 0 }}>{greetingUi.intro}</p>

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
        />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "right" }}>
          {(greetType === "saludo" ? 500 : 900) - instructions.length} caracteres restantes
        </span>
      </label>

      {(greetType === "saludo" || greetType === "consejo") && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
            <span style={{ ...s.label, fontSize: 13, fontWeight: 600, color: greetAccentDim }}>Permite que este {greetType === "consejo" ? "consejo" : "saludo"} inspire a más personas</span>
            <span style={{ ...s.micro, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
              Permite que el creador publique este {greetType === "consejo" ? "consejo" : "saludo"} en historias para que otros usuarios puedan verlo.
            </span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
              No mostraremos tu nombre ni tu información personal, solo podrá compartirse el video.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={allowCreatorStory}
            aria-label="Permitir publicación en historias"
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
              left: allowCreatorStory ? 18 : 2,
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
          <span style={{ ...s.label, fontSize: 13, fontWeight: 600, color: greetAccentDim }}>Acepta nuestros términos y condiciones</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
            Asegúrate de leer los términos y condiciones antes de aceptarlos.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={acceptedTerms}
          aria-label="Aceptar términos y condiciones"
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
            left: acceptedTerms ? 18 : 2,
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
    onClose: () => void;
    onSubmit: () => void;
    onChangeMessage: (value: string) => void;
  }) {
    return (
      <Panel
        open={params.open}
        title={params.title}
        titleId={params.titleId}
        submitting={params.submitting}
        onClose={params.onClose}
        footer={
          <button
            type="button"
            onClick={params.onSubmit}
            disabled={params.submitting}
            style={{ ...s.primaryBtn, ...(params.submitting ? s.primaryBtnDisabled : {}) }}
          >
            {params.submitting ? "Enviando..." : params.submitLabel}
          </button>
        }
      >
        <p style={{ ...s.text, margin: 0 }}>{params.description}</p>

        <div style={s.summaryPanel}>
          <span style={{ ...s.label, fontWeight: 600 }}>Resumen del servicio</span>
          <span style={s.micro}>Precio: <strong style={{ color: "#fff" }}>{params.priceLabel}</strong></span>
          <span style={s.micro}>Duración: <strong style={{ color: "#fff" }}>{params.durationLabel}</strong></span>
          <span style={s.micro}>Pago: <strong style={{ color: "#fff" }}>Simulado por ahora</strong></span>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={s.label}>{params.textareaLabel}</span>
          <textarea
            value={params.message}
            onChange={(e) => params.onChangeMessage(e.target.value)}
            placeholder={params.textareaPlaceholder}
            disabled={params.submitting}
            rows={5}
            style={{ ...s.input, resize: "vertical", minHeight: 110 }}
          />
        </label>

        <p style={{ ...s.micro, margin: 0 }}>{params.helperText}</p>
      </Panel>
    );
  }

  const meetGreetModal = createPortal(
    renderScheduledRequestModal({
      open: meetGreetOpen,
      submitting: meetGreetSubmitting,
      title: "Solicitar encuentro en vivo",
      description: "Envía tu solicitud de encuentro en vivo. El creador podrá aceptarla, rechazarla y después proponerte fecha y hora.",
      priceLabel: meetGreetPriceLabel,
      durationLabel: meetGreetDurationLabel,
      message: meetGreetMessage,
      error: meetGreetError,
      textareaLabel: "Cuéntale al creador cualquier detalle importante",
      textareaPlaceholder: "Ej. horarios preferidos, zona horaria, motivo del encuentro o cualquier contexto útil.",
      submitLabel: "Solicitar encuentro en vivo",
      helperText: "Esta solicitud aparecerá en el panel del creador, wallet, pendientes, calendario e historial cuando el flujo esté conectado.",
      titleId: "vibra-svc-meetgreet-title",
      onClose: onCloseMeetGreet,
      onSubmit: onSubmitMeetGreet,
      onChangeMessage: onChangeMeetGreetMessage,
    }),
    document.body
  );

  const exclusiveSessionModal = createPortal(
    renderScheduledRequestModal({
      open: exclusiveSessionOpen,
      submitting: exclusiveSessionSubmitting,
      title: "Solicitar sesión exclusiva",
      description: "Envía tu solicitud de sesión exclusiva. El creador podrá aceptarla, rechazarla y después proponerte fecha y hora.",
      priceLabel: exclusiveSessionPriceLabel,
      durationLabel: exclusiveSessionDurationLabel,
      message: exclusiveSessionMessage,
      error: exclusiveSessionError,
      textareaLabel: "Cuéntale al creador cualquier detalle importante",
      textareaPlaceholder: "Ej. tema de la sesión, horarios preferidos, zona horaria o cualquier contexto útil.",
      submitLabel: "Solicitar sesión exclusiva",
      helperText: "Esta solicitud usará el mismo flujo operativo: panel del creador, wallet, pendientes, calendario e historial.",
      titleId: "vibra-svc-exclusive-title",
      onClose: onCloseExclusiveSession,
      onSubmit: onSubmitExclusiveSession,
      onChangeMessage: onChangeExclusiveSessionMessage,
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
