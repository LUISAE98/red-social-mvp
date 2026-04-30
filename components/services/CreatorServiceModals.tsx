"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GreetingType } from "@/lib/greetings/greetingRequests";
import type { Currency } from "@/types/group";

type CreatorServiceModalsProps = {
  greetOpen: boolean;
  greetSubmitting: boolean;
  greetType: GreetingType;
  toName: string;
  instructions: string;
  greetError: string | null;
  greetSuccess: string | null;
  onCloseGreeting: () => void;
  onSubmitGreeting: () => void;
  onChangeToName: (value: string) => void;
  onChangeInstructions: (value: string) => void;

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

  subtitleStyle: CSSProperties;
  textStyle: CSSProperties;
  microText: CSSProperties;
  labelStyle: CSSProperties;
  primaryButton: CSSProperties;
  secondaryButton: CSSProperties;
  panelStyle: CSSProperties;
  inputStyle: CSSProperties;
  messageBox: CSSProperties;
  serviceModalBackdropStyle: CSSProperties;
  serviceModalCardStyle: CSSProperties;
  serviceToastStyle: CSSProperties;
  formatMoney?: (value: number, currency: Currency) => string;
};

function getGreetingUi(type: GreetingType) {
  if (type === "consejo") {
    return {
      title: "Solicitar consejo",
      intro:
        "Completa tu solicitud con el mayor contexto posible para que el creador entienda bien qué consejo necesitas.",
      recipientLabel: "¿Para quién o para qué situación es el consejo?",
      recipientPlaceholder:
        "Ej. Para mí / Para Ana / Para mi proceso actual",
      instructionsLabel: "Describe tu situación o qué consejo necesitas",
      instructionsPlaceholder:
        "Ej. Necesito consejo sobre disciplina, entrenamiento, motivación, enfoque, relaciones, etc.",
      submitLabel: "Solicitar consejo",
      helperText:
        "Nota: el creador revisará tu solicitud de consejo y podrá aceptarla o rechazarla. Pagos y entrega se integran después.",
    };
  }

  if (type === "mensaje") {
    return {
      title: "Solicitar mensaje",
      intro:
        "Completa tu solicitud con contexto claro para que el creador prepare el mensaje de forma personalizada.",
      recipientLabel: "¿A quién va dirigido el mensaje?",
      recipientPlaceholder: "Ej. Para Juan",
      instructionsLabel: "Indica el contexto del mensaje",
      instructionsPlaceholder:
        "Ej. Mensaje de felicitación, apoyo, ánimo o respuesta personalizada.",
      submitLabel: "Solicitar mensaje",
      helperText:
        "Nota: el creador podrá aceptar o rechazar tu solicitud de mensaje. Pagos y entrega se integran después.",
    };
  }

  return {
    title: "Solicitar saludo",
    intro:
      "Completa tu solicitud con el contexto necesario para que el creador prepare el saludo como lo esperas.",
    recipientLabel: "¿Para quién es el saludo?",
    recipientPlaceholder: "Ej. Para Ana, por su cumpleaños",
    instructionsLabel: "Indica cómo quieres el saludo",
    instructionsPlaceholder:
      "Ej. Que la felicite por su cumpleaños, que mencione su nombre y que sea con tono alegre.",
    submitLabel: "Solicitar saludo",
    helperText:
      "Nota: el creador podrá aceptar o rechazar tu solicitud de saludo. Pagos y entrega de video se integran después.",
  };
}

export default function CreatorServiceModals({
  greetOpen,
  greetSubmitting,
  greetType,
  toName,
  instructions,
  greetError,
  greetSuccess,
  onCloseGreeting,
  onSubmitGreeting,
  onChangeToName,
  onChangeInstructions,

  meetGreetOpen,
  meetGreetSubmitting,
  meetGreetMessage,
  meetGreetError,
  meetGreetPriceLabel,
  meetGreetDurationLabel,
  onCloseMeetGreet,
  onSubmitMeetGreet,
  onChangeMeetGreetMessage,

  exclusiveSessionOpen,
  exclusiveSessionSubmitting,
  exclusiveSessionMessage,
  exclusiveSessionError,
  exclusiveSessionPriceLabel,
  exclusiveSessionDurationLabel,
  onCloseExclusiveSession,
  onSubmitExclusiveSession,
  onChangeExclusiveSessionMessage,

  serviceToast,

  subtitleStyle,
  textStyle,
  microText,
  labelStyle,
  primaryButton,
  secondaryButton,
  panelStyle,
  inputStyle,
  messageBox,
  serviceModalBackdropStyle,
  serviceModalCardStyle,
  serviceToastStyle,
}: CreatorServiceModalsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const anyOpen = greetOpen || meetGreetOpen || exclusiveSessionOpen;

    if (!anyOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      if (greetOpen && !greetSubmitting) onCloseGreeting();

      if (meetGreetOpen && !meetGreetSubmitting) {
        onCloseMeetGreet();
      }

      if (exclusiveSessionOpen && !exclusiveSessionSubmitting) {
        onCloseExclusiveSession();
      }
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.touchAction = previousBodyTouchAction;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [
    greetOpen,
    greetSubmitting,
    meetGreetOpen,
    meetGreetSubmitting,
    exclusiveSessionOpen,
    exclusiveSessionSubmitting,
    onCloseGreeting,
    onCloseMeetGreet,
    onCloseExclusiveSession,
  ]);

    const modalHeaderStyle: CSSProperties = {
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.055)",
  };

  const modalBodyStyle: CSSProperties = {
    padding: 16,
    display: "grid",
    gap: 14,
  };

  const modalActionsStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 10,
  };

  const summaryPanelStyle: CSSProperties = {
    ...panelStyle,
    padding: 14,
    borderRadius: 16,
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025))",
    border: "1px solid rgba(255,255,255,0.12)",
  };
  const greetingUi = getGreetingUi(greetType);

  const greetingModal =
    mounted && greetOpen
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="creator-service-modal-title"
            style={serviceModalBackdropStyle}
            onClick={() => {
              if (!greetSubmitting) onCloseGreeting();
            }}
          >
            <div
              style={serviceModalCardStyle}
              onClick={(e) => e.stopPropagation()}
            >
                            <div style={modalHeaderStyle}>
                <div id="creator-service-modal-title" style={subtitleStyle}>
                  {greetingUi.title}
                </div>

                <button
                  type="button"
                  onClick={onCloseGreeting}
                  disabled={greetSubmitting}
                  style={{
                    ...secondaryButton,
                    opacity: greetSubmitting ? 0.75 : 1,
                    cursor: greetSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  Cerrar
                </button>
              </div>

              <div style={modalBodyStyle}>
                <div
                  style={{
                    ...microText,
                    color: "rgba(255,255,255,0.78)",
                  }}
                >
                  {greetingUi.intro}
                </div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>{greetingUi.recipientLabel}</span>
                  <input
                    autoFocus
                    value={toName}
                    onChange={(e) => onChangeToName(e.target.value)}
                    placeholder={greetingUi.recipientPlaceholder}
                    disabled={greetSubmitting}
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>{greetingUi.instructionsLabel}</span>
                  <textarea
                    value={instructions}
                    onChange={(e) => onChangeInstructions(e.target.value)}
                    placeholder={greetingUi.instructionsPlaceholder}
                    disabled={greetSubmitting}
                    rows={5}
                    style={{
                      ...inputStyle,
                      resize: "vertical",
                      minHeight: 110,
                    }}
                  />
                </label>

                {greetError && <div style={messageBox}>{greetError}</div>}
                {greetSuccess && <div style={messageBox}>{greetSuccess}</div>}

                <div style={modalActionsStyle}>
                  <button
                    type="button"
                    onClick={onSubmitGreeting}
                    disabled={greetSubmitting}
                    style={{
                      ...primaryButton,
                      opacity: greetSubmitting ? 0.75 : 1,
                      cursor: greetSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {greetSubmitting ? "Enviando..." : greetingUi.submitLabel}
                  </button>

                  <button
                    type="button"
                    onClick={onCloseGreeting}
                    disabled={greetSubmitting}
                    style={{
                      ...secondaryButton,
                      opacity: greetSubmitting ? 0.75 : 1,
                      cursor: greetSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>

                <div style={microText}>{greetingUi.helperText}</div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

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
    if (!mounted || !params.open) return null;

    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={params.titleId}
        style={serviceModalBackdropStyle}
        onClick={() => {
          if (!params.submitting) params.onClose();
        }}
      >
        <div style={serviceModalCardStyle} onClick={(e) => e.stopPropagation()}>
          <div style={modalHeaderStyle}>
            <div id={params.titleId} style={subtitleStyle}>
              {params.title}
            </div>

            <button
              type="button"
              onClick={params.onClose}
              disabled={params.submitting}
              style={{
                ...secondaryButton,
                opacity: params.submitting ? 0.75 : 1,
                cursor: params.submitting ? "not-allowed" : "pointer",
              }}
            >
              Cerrar
            </button>
          </div>

          <div style={modalBodyStyle}>
            <div style={textStyle}>{params.description}</div>

            <div style={summaryPanelStyle}>
              <div style={labelStyle}>Resumen del servicio</div>

              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                <div style={microText}>
                  Precio:{" "}
                  <strong style={{ color: "#fff" }}>{params.priceLabel}</strong>
                </div>

                <div style={microText}>
                  Duración:{" "}
                  <strong style={{ color: "#fff" }}>
                    {params.durationLabel}
                  </strong>
                </div>

                <div style={microText}>
                  Pago:{" "}
                  <strong style={{ color: "#fff" }}>
                    Simulado por ahora
                  </strong>
                </div>
              </div>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={labelStyle}>{params.textareaLabel}</span>
              <textarea
                value={params.message}
                onChange={(e) => params.onChangeMessage(e.target.value)}
                placeholder={params.textareaPlaceholder}
                disabled={params.submitting}
                rows={5}
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  minHeight: 110,
                }}
              />
            </label>

            {params.error && <div style={messageBox}>{params.error}</div>}

            <div style={modalActionsStyle}>
              <button
                type="button"
                onClick={params.onSubmit}
                disabled={params.submitting}
                style={{
                  ...primaryButton,
                  opacity: params.submitting ? 0.75 : 1,
                  cursor: params.submitting ? "not-allowed" : "pointer",
                }}
              >
                {params.submitting ? "Enviando..." : params.submitLabel}
              </button>

              <button
                type="button"
                onClick={params.onClose}
                disabled={params.submitting}
                style={{
                  ...secondaryButton,
                  opacity: params.submitting ? 0.75 : 1,
                  cursor: params.submitting ? "not-allowed" : "pointer",
                }}
              >
                Cancelar
              </button>
            </div>

            <div style={microText}>{params.helperText}</div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  const meetGreetModal = renderScheduledRequestModal({
    open: meetGreetOpen,
    submitting: meetGreetSubmitting,
    title: "Solicitar Meet & Greet",
    description:
      "Envía tu solicitud de meet & greet. El creador podrá aceptarla, rechazarla y después proponerte fecha y hora.",
    priceLabel: meetGreetPriceLabel,
    durationLabel: meetGreetDurationLabel,
    message: meetGreetMessage,
    error: meetGreetError,
    textareaLabel: "Cuéntale al creador cualquier detalle importante",
    textareaPlaceholder:
      "Ej. horarios preferidos, zona horaria, motivo del meet & greet o cualquier contexto útil.",
    submitLabel: "Solicitar meet & greet",
    helperText:
      "Esta solicitud aparecerá en el panel del creador, wallet, pendientes, calendario e historial cuando el flujo esté conectado.",
    titleId: "creator-meet-greet-modal-title",
    onClose: onCloseMeetGreet,
    onSubmit: onSubmitMeetGreet,
    onChangeMessage: onChangeMeetGreetMessage,
  });

  const exclusiveSessionModal = renderScheduledRequestModal({
    open: exclusiveSessionOpen,
    submitting: exclusiveSessionSubmitting,
    title: "Solicitar sesión exclusiva",
    description:
      "Envía tu solicitud de sesión exclusiva. El creador podrá aceptarla, rechazarla y después proponerte fecha y hora.",
    priceLabel: exclusiveSessionPriceLabel,
    durationLabel: exclusiveSessionDurationLabel,
    message: exclusiveSessionMessage,
    error: exclusiveSessionError,
    textareaLabel: "Cuéntale al creador cualquier detalle importante",
    textareaPlaceholder:
      "Ej. tema de la sesión, horarios preferidos, zona horaria o cualquier contexto útil.",
    submitLabel: "Solicitar sesión exclusiva",
    helperText:
      "Esta solicitud usará el mismo flujo operativo: panel del creador, wallet, pendientes, calendario e historial.",
    titleId: "creator-exclusive-session-modal-title",
    onClose: onCloseExclusiveSession,
    onSubmit: onSubmitExclusiveSession,
    onChangeMessage: onChangeExclusiveSessionMessage,
  });

  const toastNode =
    mounted && serviceToast
      ? createPortal(
          <div style={serviceToastStyle} role="status" aria-live="polite">
            {serviceToast}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {greetingModal}
      {meetGreetModal}
      {exclusiveSessionModal}
      {toastNode}
    </>
  );
}