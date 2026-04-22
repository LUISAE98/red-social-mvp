"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GreetingType } from "@/lib/greetings/greetingRequests";
import type { Currency } from "@/types/group";

type GroupServiceModalsProps = {
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

  subscriptionOpen: boolean;
  subscriptionSubmitting: boolean;
  subscriptionError: string | null;
  subscriptionPrice: number | null;
  subscriptionCurrencyLabel: Currency;
  onCloseSubscription: () => void;
  onSubmitSubscription: () => void;

  meetGreetOpen: boolean;
  meetGreetSubmitting: boolean;
  meetGreetMessage: string;
  meetGreetError: string | null;
  meetGreetPriceLabel: string;
  meetGreetDurationLabel: string;
  onCloseMeetGreet: () => void;
  onSubmitMeetGreet: () => void;
  onChangeMeetGreetMessage: (value: string) => void;

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
  formatMoney: (value: number, currency: Currency) => string;
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

export default function GroupServiceModals({
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

  subscriptionOpen,
  subscriptionSubmitting,
  subscriptionError,
  subscriptionPrice,
  subscriptionCurrencyLabel,
  onCloseSubscription,
  onSubmitSubscription,

  meetGreetOpen,
  meetGreetSubmitting,
  meetGreetMessage,
  meetGreetError,
  meetGreetPriceLabel,
  meetGreetDurationLabel,
  onCloseMeetGreet,
  onSubmitMeetGreet,
  onChangeMeetGreetMessage,

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
  formatMoney,
}: GroupServiceModalsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!greetOpen && !subscriptionOpen && !meetGreetOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (greetOpen && !greetSubmitting) onCloseGreeting();
        if (subscriptionOpen && !subscriptionSubmitting) onCloseSubscription();
        if (meetGreetOpen && !meetGreetSubmitting) onCloseMeetGreet();
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
    subscriptionOpen,
    subscriptionSubmitting,
    meetGreetOpen,
    meetGreetSubmitting,
    onCloseGreeting,
    onCloseSubscription,
    onCloseMeetGreet,
  ]);

  const greetingUi = getGreetingUi(greetType);

  const greetingModal =
    mounted && greetOpen
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-service-modal-title"
            style={serviceModalBackdropStyle}
            onClick={() => {
              if (!greetSubmitting) onCloseGreeting();
            }}
          >
            <div
              style={serviceModalCardStyle}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div id="group-service-modal-title" style={subtitleStyle}>
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

              <div
                style={{
                  marginTop: 8,
                  ...microText,
                  color: "rgba(255,255,255,0.78)",
                }}
              >
                {greetingUi.intro}
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gap: 10,
                }}
              >
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

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
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

  const subscriptionModal =
    mounted && subscriptionOpen
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-subscription-modal-title"
            style={serviceModalBackdropStyle}
            onClick={() => {
              if (!subscriptionSubmitting) onCloseSubscription();
            }}
          >
            <div
              style={serviceModalCardStyle}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div id="group-subscription-modal-title" style={subtitleStyle}>
                  Suscripción mensual
                </div>

                <button
                  type="button"
                  onClick={onCloseSubscription}
                  disabled={subscriptionSubmitting}
                  style={{
                    ...secondaryButton,
                    opacity: subscriptionSubmitting ? 0.75 : 1,
                    cursor: subscriptionSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  Cerrar
                </button>
              </div>

              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div style={textStyle}>
                  Esta comunidad requiere suscripción para unirte.
                </div>

                <div style={panelStyle}>
                  <div style={labelStyle}>Costo mensual</div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 24,
                      fontWeight: 800,
                      color: "#fff",
                    }}
                  >
                    {subscriptionPrice != null
                      ? formatMoney(subscriptionPrice, subscriptionCurrencyLabel)
                      : `Precio no disponible (${subscriptionCurrencyLabel})`}
                  </div>
                  <div style={{ marginTop: 8, ...microText }}>
                    Al continuar, el flujo intenta darte acceso inmediato a la
                    comunidad. La conexión completa del backend se termina en el
                    siguiente bloque.
                  </div>
                </div>

                {subscriptionError && (
                  <div style={messageBox}>{subscriptionError}</div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={onSubmitSubscription}
                    disabled={subscriptionSubmitting}
                    style={{
                      ...primaryButton,
                      opacity: subscriptionSubmitting ? 0.75 : 1,
                      cursor: subscriptionSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {subscriptionSubmitting ? "Procesando..." : "Pagar y unirme"}
                  </button>

                  <button
                    type="button"
                    onClick={onCloseSubscription}
                    disabled={subscriptionSubmitting}
                    style={{
                      ...secondaryButton,
                      opacity: subscriptionSubmitting ? 0.75 : 1,
                      cursor: subscriptionSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const meetGreetModal =
    mounted && meetGreetOpen
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-meet-greet-modal-title"
            style={serviceModalBackdropStyle}
            onClick={() => {
              if (!meetGreetSubmitting) onCloseMeetGreet();
            }}
          >
            <div
              style={serviceModalCardStyle}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div id="group-meet-greet-modal-title" style={subtitleStyle}>
                  Solicitar Meet & Greet
                </div>

                <button
                  type="button"
                  onClick={onCloseMeetGreet}
                  disabled={meetGreetSubmitting}
                  style={{
                    ...secondaryButton,
                    opacity: meetGreetSubmitting ? 0.75 : 1,
                    cursor: meetGreetSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  Cerrar
                </button>
              </div>

              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div style={textStyle}>
                  Envía tu solicitud de meet & greet. El creador podrá aceptarla,
                  rechazarla y después proponerte fecha y hora.
                </div>

                <div style={panelStyle}>
                  <div style={labelStyle}>Resumen del servicio</div>

                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    <div style={microText}>
                      Precio:{" "}
                      <strong style={{ color: "#fff" }}>
                        {meetGreetPriceLabel}
                      </strong>
                    </div>

                    <div style={microText}>
                      Duración:{" "}
                      <strong style={{ color: "#fff" }}>
                        {meetGreetDurationLabel}
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
                  <span style={labelStyle}>
                    Cuéntale al creador cualquier detalle importante
                  </span>
                  <textarea
                    value={meetGreetMessage}
                    onChange={(e) => onChangeMeetGreetMessage(e.target.value)}
                    placeholder="Ej. horarios preferidos, zona horaria, motivo del meet & greet o cualquier contexto útil."
                    disabled={meetGreetSubmitting}
                    rows={5}
                    style={{
                      ...inputStyle,
                      resize: "vertical",
                      minHeight: 110,
                    }}
                  />
                </label>

                {meetGreetError && <div style={messageBox}>{meetGreetError}</div>}

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={onSubmitMeetGreet}
                    disabled={meetGreetSubmitting}
                    style={{
                      ...primaryButton,
                      opacity: meetGreetSubmitting ? 0.75 : 1,
                      cursor: meetGreetSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {meetGreetSubmitting
                      ? "Enviando..."
                      : "Solicitar meet & greet"}
                  </button>

                  <button
                    type="button"
                    onClick={onCloseMeetGreet}
                    disabled={meetGreetSubmitting}
                    style={{
                      ...secondaryButton,
                      opacity: meetGreetSubmitting ? 0.75 : 1,
                      cursor: meetGreetSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>

                <div style={microText}>
                  El flujo de agenda, aceptación, rechazo, cambio de fecha y
                  preparación se mostrará después en OwnerSidebar.
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

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
      {subscriptionModal}
      {meetGreetModal}
      {toastNode}
    </>
  );
}