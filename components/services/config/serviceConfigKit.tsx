"use client";

// Kit visual COMPARTIDO de configuración de servicios (perfil ⇄ comunidad).
//
// Estas piezas eran del perfil (ProfileServicesTab.parts.tsx). Se movieron aquí para
// que la comunidad use EXACTAMENTE el mismo modal, switch, colores y helpers → los
// paneles de configuración quedan idénticos en ambos lados (antes/durante/después).
// El perfil las re-exporta desde su parts; la comunidad las importa directo.

import React, { useEffect, useState } from "react";
import { IconButton } from "@/components/ui";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { formatCurrency, roundReference } from "@/lib/currency/format";

export const useLockBodyScroll = useBodyScrollLock;

export function useCloseOnEscape(active: boolean, onClose: () => void, disabled = false) {
  useEffect(() => {
    if (!active || disabled || typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose, disabled]);
}

// Emoji por servicio (título de cada card).
// Estos dos viven ahora en lib/services/serviceDraft (lógica pura, testeable
// sin React). Se reexportan aquí para no romper a quien los importaba del kit.
export {
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  normalizeSuggestedAmounts,
} from "@/lib/services/serviceDraft";

export const SERVICE_EMOJIS = {
  // Solo lo usa la comunidad —un perfil no tiene suscripción—, pero el mapa vive
  // completo en un único sitio en vez de tener dos versiones que se desincronizan.
  subscription: "💎",
  saludo: "👋",
  consejo: "💡",
  meetGreet: "🤝",
  customClass: "👑",
  donation: "🎁",
};

// Color de acento por servicio. Cuando el servicio está inactivo se muestra un
// ícono info (i en círculo) con este color en lugar del emoji.
export const SERVICE_COLORS = {
  saludo: "#b45cff", // morado
  consejo: "#f7c948", // amarillo
  meetGreet: "#2563eb", // azul oscuro (tiempo contigo)
  customClass: "#f472b6", // rosa (sesión exclusiva)
  donation: "#b23a5b", // vino
};

/**
 * Traduce el precio que el creador está tecleando —que se guarda en la moneda de
 * LIQUIDACIÓN— a la moneda en la que él mira la plataforma.
 *
 * 🚨 Por qué existe. El input tenía al lado la moneda del QUE MIRA (`displayCurrency`),
 * pero el número se guarda en la de liquidación. Un creador mexicano tecleaba 200, leía
 * "MXN" junto al campo y publicaba un servicio de 200 DÓLARES. La etiqueta ahora dice la
 * moneda real y esta línea da la referencia que el creador necesita para no perderse.
 *
 * No se muestra cuando el creador ya mira en la moneda de liquidación: ahí sobraría.
 */
/**
 * Referencia en la moneda del creador: "≈ 1,700 MXN · ganarás ≈ 1,280 MXN".
 *
 * El precio SIEMPRE se fija en la moneda de liquidación, mire el creador lo que mire. Esta
 * línea es solo para que se ubique, y por eso:
 *
 *  · Usa `fromAnchor` (tipo de cambio pelado) y NO `format`, que calcula el precio de cara
 *    al COMPRADOR — le suma el 2% y lo redondea al paso de la moneda. Como referencia daba
 *    números absurdos: 1 USD salía "15 MXN" (17.03 → +2% = 17.37 → paso de 5 → 15).
 *  · Redondea con `roundReference` (escalón grueso), no con el redondeo comercial. Terminar
 *    en `.99` la haría parecer un precio y el creador se fijaría en el decimal; y un escalón
 *    fino cambiaría el número con cualquier movimiento del tipo de cambio.
 *
 * No se muestra si el creador ya mira en la moneda de liquidación: ahí sobraría.
 */
export function LocalPriceHint({
  value,
  netRate,
}: {
  value: number | null | undefined;
  /** Proporción que se queda el creador (0.75). Si se omite, no se muestra la ganancia. */
  netRate?: number;
}) {
  const pf = usePriceFormat();
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (pf.currency === SETTLEMENT_CURRENCY) return null;

  const local = pf.fromAnchor(n);
  if (local == null) return null;
  const fmt = (v: number) =>
    formatCurrency(roundReference(v, pf.currency), pf.currency, pf.locale, { code: true });

  return (
    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 2 }}>
      ≈ {fmt(local)}
      {netRate ? ` · ganarás ≈ ${fmt(local * netRate)}` : ""}
    </div>
  );
}

// Rangos de duración permitidos (minutos) por tipo de servicio.
export const MEET_GREET_MIN_MINUTES = 5; // Tiempo contigo
export const MEET_GREET_MAX_MINUTES = 25;
export const CUSTOM_CLASS_MIN_MINUTES = 5; // Sesión exclusiva
export const CUSTOM_CLASS_MAX_MINUTES = 90;


export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  activeColor,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={label}
      title={label}
      style={{
        position: "relative",
        width: 36,
        minWidth: 36,
        maxWidth: 36,
        height: 20,
        minHeight: 20,
        maxHeight: 20,
        borderRadius: 999,
        border: "none",
        background: checked
          ? (activeColor ?? "linear-gradient(100deg, #a855f7, #4f46ff)")
          : "rgba(255,255,255,0.10)",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 0.2s ease",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          insetInlineStart: checked ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          transition: "all 0.2s ease",
        }}
      />
    </button>
  );
}

export function DonationModeButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: active
          ? "1px solid rgba(255,255,255,0.92)"
          : "1px solid rgba(255,255,255,0.12)",
        background: active ? "#fff" : "rgba(255,255,255,0.04)",
        color: active ? "#000" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        fontSize: 12,
        fontFamily: "inherit",
        transition: "all 160ms ease",
        minHeight: 42,
      }}
    >
      {label}
    </button>
  );
}

export function OverlayModal({
  open,
  title,
  children,
  confirmLabel: confirmLabelProp,
  loading = false,
  confirmDisabled = false,
  hideFooter = false,
  onConfirm,
  onCancel,
  bgImage,
  bgPosition = "center",
  accentColor,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  /** Deshabilita el botón de acción (sin spinner) hasta que sea válido publicar. */
  confirmDisabled?: boolean;
  /** Oculta el footer (botón de acción). Se usa en la vista de éxito. */
  hideFooter?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Imagen de fondo del panel (misma del servicio). Se atenúa para legibilidad. */
  bgImage?: string;
  bgPosition?: string;
  /** Color de acento del servicio (color de sus items). Tiñe el botón de acción. */
  accentColor?: string;
}) {
  const tCommon = useTranslations("common");
  const confirmLabel = confirmLabelProp ?? tCommon("saveChanges");

  // Entrada/salida animada: se mantiene montado 180ms para que la salida
  // complete antes de desmontar (spec Panel base, vibra_style.md).
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (rendered) {
      setClosing(true);
      const t = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, 180);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useLockBodyScroll(rendered);
  useCloseOnEscape(open, onCancel, loading);

  if (!rendered) return null;

  return createPortal(
    <>
      <style jsx global>{`
        @keyframes vibraServicePanelIn {
          from {
            opacity: 0;
            transform: scale(0.94) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        @keyframes vibraServicePanelOut {
          from {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          to {
            opacity: 0;
            transform: scale(0.94) translateY(10px);
          }
        }
        .vibra-panel-scroll::-webkit-scrollbar {
          width: 7px;
          height: 7px;
        }
        .vibra-panel-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .vibra-panel-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 999px;
        }
        /* Puntos parpadeantes del botón "Publicando..." */
        @keyframes vibraPublishDotBlink {
          0%,
          80%,
          100% {
            opacity: 0.2;
          }
          40% {
            opacity: 1;
          }
        }
        .vibraPublishDots span {
          animation: vibraPublishDotBlink 1.4s infinite both;
        }
        .vibraPublishDots span:nth-child(2) {
          animation-delay: 0.2s;
        }
        .vibraPublishDots span:nth-child(3) {
          animation-delay: 0.4s;
        }
        /* Barra de carga bajo el título: se llena de 0 a 100% del ancho. */
        @keyframes vibraPublishBarFill {
          0% {
            width: 0%;
          }
          100% {
            width: 100%;
          }
        }
        .vibraPublishBar {
          position: absolute;
          inset-inline-start: 0;
          top: 0;
          height: 100%;
          width: 0%;
          background: #fff;
          border-radius: 999px;
          animation: vibraPublishBarFill 1.1s ease-in-out infinite;
        }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => {
          if (!loading && e.target === e.currentTarget) onCancel();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "rgba(0,0,0,0.88)",
          fontFamily: "inherit",
          overscrollBehavior: "contain",
        }}
      >
        <section
          style={{
            width: "min(100%, 540px)",
            maxHeight: "min(88vh, 680px)",
            display: "flex",
            flexDirection: "column",
            borderRadius: 18,
            background: bgImage
              ? `linear-gradient(rgba(10,10,10,0.88), rgba(10,10,10,0.94)), url('${bgImage}') ${bgPosition}/cover no-repeat`
              : "#0a0a0a",
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
            color: "#fff",
            overflow: "hidden",
            animation: closing
              ? "vibraServicePanelOut 180ms ease-in forwards"
              : "vibraServicePanelIn 180ms ease-out",
          }}
        >
          {/* Header: [vacío | título centrado | X] */}
          <div
            style={{
              height: 56,
              display: "grid",
              gridTemplateColumns: "48px 1fr 48px",
              alignItems: "center",
              padding: "0 12px",
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              flexShrink: 0,
              position: "relative",
            }}
          >
            <div aria-hidden="true" />
            <span
              style={{
                fontSize: 17,
                fontWeight: 500,
                color: "#fff",
                lineHeight: 1.2,
                textAlign: "center",
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </span>
            <IconButton label={tCommon("cancel")} size="sm" tone="bare" shape="square" style={{ placeItems: "center", justifySelf: "end" }} onClick={onCancel} disabled={loading}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>

            {/* Barra de carga indeterminada, sobre la línea del título. */}
            {loading && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  insetInlineStart: 0,
                  insetInlineEnd: 0,
                  bottom: -1,
                  height: 2,
                  overflow: "hidden",
                }}
              >
                <div className="vibraPublishBar" />
              </div>
            )}
          </div>

          {/* Área de contenido con scroll */}
          <div
            className="vibra-panel-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
              padding: "18px 20px 8px",
            }}
          >
            <div style={{ display: "grid", gap: 12 }}>{children}</div>
          </div>

          {/* Footer: botón de acción principal (a lo ancho) */}
          {!hideFooter && (
          <div
            style={{
              padding: "14px 20px 18px",
              borderTop: "1px solid rgba(255,255,255,0.12)",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading || confirmDisabled}
              style={{
                width: "100%",
                height: 42,
                borderRadius: 5,
                border: "none",
                background:
                  loading || confirmDisabled
                    ? "rgba(255,255,255,0.1)"
                    : accentColor ?? "#a855f7",
                color:
                  loading || confirmDisabled
                    ? "rgba(255,255,255,0.36)"
                    : "rgba(255,255,255,0.98)",
                fontSize: 17,
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: loading || confirmDisabled ? "not-allowed" : "pointer",
                letterSpacing: "-0.02em",
                display: "grid",
                placeItems: "center",
              }}
            >
              {loading ? (
                <span style={{ display: "inline-flex", alignItems: "baseline" }}>
                  {tCommon("publishing")}
                  <span className="vibraPublishDots" aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                </span>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
          )}
        </section>
      </div>
    </>,
    document.body
  );
}

// Variantes de OverlayModal con la imagen de fondo de cada experiencia. Se
// definen a nivel de módulo (identidad estable) para que el panel no se
// remonte en cada render del formulario y no pierda foco/estado.
// accentColor = color de los items de ese servicio; tiñe el botón de acción.
export const makeOverlayWithBg = (
  bgImage: string,
  bgPosition: string,
  accentColor: string
) => {
  function OverlayWithBg(props: React.ComponentProps<typeof OverlayModal>) {
    return (
      <OverlayModal
        {...props}
        bgImage={bgImage}
        bgPosition={bgPosition}
        accentColor={accentColor}
      />
    );
  }
  return OverlayWithBg;
};
export const SaludoOverlay = makeOverlayWithBg("/saludo.webp", "center 32%", "#b45cff");
export const ConsejoOverlay = makeOverlayWithBg("/consejo.webp", "center 60%", "#f7c948");
export const MeetGreetOverlay = makeOverlayWithBg(
  "/encuentroenvivo.webp",
  "center 60%",
  "#2563eb"
);
export const CustomClassOverlay = makeOverlayWithBg(
  "/sesionexclusiva.webp",
  "center 75%",
  "#f472b6"
);
export const DonationOverlay = makeOverlayWithBg(
  "/donacion-perfil.webp",
  "center 50%",
  "#7dd3fc"
);
export const SubscriptionOverlay = makeOverlayWithBg(
  "/suscripciones.webp",
  "center",
  "#38bdf8"
);

// Estilos de panel compartidos (mismos valores en perfil y comunidad).
export function makeServicePanelStyle(
  basePanelStyle: React.CSSProperties,
  image: string,
  position: string
): React.CSSProperties {
  return {
    ...basePanelStyle,
    border: "none",
    padding: "14px",
    background: `linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('${image}') ${position}/cover no-repeat`,
  };
}

export function makePlainPanelStyle(basePanelStyle: React.CSSProperties): React.CSSProperties {
  return {
    ...basePanelStyle,
    border: "none",
    padding: "14px",
    background: "transparent",
  };
}

// Imagen de fondo por servicio (misma que las variantes de OverlayModal / cards del perfil).
const SERVICE_PANEL_BG: Record<"saludo" | "consejo" | "meetGreet" | "customClass" | "donation", { image: string; position: string }> = {
  saludo: { image: "/saludo.webp", position: "center 32%" },
  consejo: { image: "/consejo.webp", position: "center 60%" },
  meetGreet: { image: "/encuentroenvivo.webp", position: "center 60%" },
  customClass: { image: "/sesionexclusiva.webp", position: "center 75%" },
  donation: { image: "/donacion-perfil.webp", position: "center 50%" },
};

export type ServiceConfigStyles = {
  contentStyle: React.CSSProperties;
  panelStyle: React.CSSProperties;
  plainPanelStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  descriptionStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;
  servicePanelStyles: Record<"saludo" | "consejo" | "meetGreet" | "customClass" | "donation", React.CSSProperties>;
};

// Fábrica ÚNICA de estilos de los paneles de configuración de servicios.
// Se usa en perfil y comunidad para que ambos se vean EXACTAMENTE igual.
export function makeServiceConfigStyles(): ServiceConfigStyles {
  const panelStyle: React.CSSProperties = {
    // Los hijos de una rejilla usan min-width:auto: sin esto, cualquier contenido
    // ancho estira la pista y saca el panel por la derecha en pantallas angostas.
    minWidth: 0,
    padding: "10px",
    borderRadius: 0,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    display: "grid",
    gap: 9,
  };

  const subtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.35,
  };

  const descriptionStyle: React.CSSProperties = {
    fontSize: 12.5,
    color: "rgba(255,255,255,0.82)",
    lineHeight: 1.4,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 15,
    color: "#fff",
    fontWeight: 500,
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "none",
    borderRadius: 12,
    padding: "10px 12px",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: "inherit",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    minHeight: 42,
  };

  const buttonSecondaryStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    fontFamily: "inherit",
    lineHeight: 1.1,
    width: "100%",
  };

  const servicePanelStyles = {
    saludo: makeServicePanelStyle(panelStyle, SERVICE_PANEL_BG.saludo.image, SERVICE_PANEL_BG.saludo.position),
    consejo: makeServicePanelStyle(panelStyle, SERVICE_PANEL_BG.consejo.image, SERVICE_PANEL_BG.consejo.position),
    meetGreet: makeServicePanelStyle(panelStyle, SERVICE_PANEL_BG.meetGreet.image, SERVICE_PANEL_BG.meetGreet.position),
    customClass: makeServicePanelStyle(panelStyle, SERVICE_PANEL_BG.customClass.image, SERVICE_PANEL_BG.customClass.position),
    donation: makeServicePanelStyle(panelStyle, SERVICE_PANEL_BG.donation.image, SERVICE_PANEL_BG.donation.position),
  };

  return {
    contentStyle: { display: "grid", gap: 8, minWidth: 0 },
    panelStyle,
    plainPanelStyle: makePlainPanelStyle(panelStyle),
    subtleStyle,
    descriptionStyle,
    titleStyle,
    inputStyle,
    buttonSecondaryStyle,
    servicePanelStyles,
  };
}
