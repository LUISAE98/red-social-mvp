"use client";

// Tipos, helpers y sub-componentes (Switch, DonationModeButton, OverlayModal)
// de ProfileServicesTab, aislados a nivel de módulo.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { createPortal } from "react-dom";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { BRAND_DOMAIN } from "@/lib/brand";

import Greetings from "@/app/groups/[groupId]/components/owner-admin-panel/services/Greetings";
import Advice from "@/app/groups/[groupId]/components/owner-admin-panel/services/Advice";
import MeetGreet from "@/app/groups/[groupId]/components/owner-admin-panel/services/MeetGreet";
import CustomClass from "@/app/groups/[groupId]/components/owner-admin-panel/services/CustomClass";
import ProfileDonation from "./ProfileDonation";

import { updateProfileOfferings } from "@/lib/profile/updateProfileOfferings";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import type { DisplayCurrency } from "@/lib/currency/catalog";

import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  DonationMode,
  GroupDonationSettings,
  GroupOffering,
} from "@/types/group";

export type OfferingInput =
  | {
      type?: CreatorServiceType | string;
      enabled?: boolean;
      visible?: boolean;
      visibility?: string;
      displayOrder?: number | null;
      memberPrice?: number | null;
      publicPrice?: number | null;
      currency?: Currency | null;
      requiresApproval?: boolean;
      sourceScope?: string;
      meta?: CreatorServiceMeta | null;
      price?: number | null;
    }
  | null;

export type DonationInput = Partial<GroupDonationSettings> | null;

export type Props = {
  profileUserId: string;
  currentUserId: string;
  currentOfferings?: OfferingInput[] | null;
  currentDonation?: DonationInput;
  onProfileServicesChanged?: (payload: {
    offerings?: GroupOffering[];
    donation?: GroupDonationSettings;
  }) => void;
};

export type EditableServiceVisibility = "public" | "members";

export type FreeToSubscriptionPolicy = "legacy_free" | "require_subscription" | "";
export type SubscriptionToFreePolicy = "keep_members_free" | "remove_all_members" | "";
export type SubscriptionPriceIncreasePolicy =
  | "keep_legacy_price"
  | "require_resubscribe_new_price"
  | "";

export type ServiceBlockDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
  visible: boolean;
  visibility: EditableServiceVisibility;
};

export type SubscriptionDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
};

export type MeetGreetDraft = ServiceBlockDraft & {
  durationMinutes: string;
};

export type AvailabilitySlotDraft = {
  start: string;
  end: string;
};

export type WeeklyAvailabilityDraft = {
  monday: AvailabilitySlotDraft[];
  tuesday: AvailabilitySlotDraft[];
  wednesday: AvailabilitySlotDraft[];
  thursday: AvailabilitySlotDraft[];
  friday: AvailabilitySlotDraft[];
  saturday: AvailabilitySlotDraft[];
  sunday: AvailabilitySlotDraft[];
};

export type CustomClassDraft = ServiceBlockDraft & {
  durationMinutes: string;
  availability: WeeklyAvailabilityDraft;
};

export type ServiceDraft = {
  subscription: SubscriptionDraft;
  saludo: ServiceBlockDraft;
  consejo: ServiceBlockDraft;
  meetGreet: MeetGreetDraft;
  customClass: CustomClassDraft;
  donationMode: DonationMode;
  donationCurrency: Currency;
  donationMinimumAmount: string;
  donationGoalLabel: string;
  donationMessage: string;
  donationVideoUrl: string;
  donationPlaybackId: string;
  freeToSubscriptionPolicy: FreeToSubscriptionPolicy;
  subscriptionToFreePolicy: SubscriptionToFreePolicy;
  subscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy;
};

export const SERVICE_EMOJIS = {
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
  meetGreet: "#2563eb", // azul oscuro (tiempo contigo, color de su flujo de sesión)
  customClass: "#f472b6", // rosa (sesión exclusiva)
  donation: "#b23a5b", // vino
};

// Rangos de duración permitidos (minutos) por tipo de servicio.
export const MEET_GREET_MIN_MINUTES = 5; // Tiempo contigo
export const MEET_GREET_MAX_MINUTES = 25;
export const CUSTOM_CLASS_MIN_MINUTES = 5; // Sesión exclusiva
export const CUSTOM_CLASS_MAX_MINUTES = 90;

export function createEmptyWeeklyAvailability(): WeeklyAvailabilityDraft {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

export function createEmptyDraft(): ServiceDraft {
  return {
    subscription: {
      enabled: false,
      price: "",
      currency: "MXN",
    },
    saludo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "public",
    },
    consejo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "public",
    },
    meetGreet: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "public",
      durationMinutes: "",
    },
    customClass: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "public",
      durationMinutes: "",
      availability: createEmptyWeeklyAvailability(),
    },
    donationMode: "none",
    donationCurrency: "MXN",
    donationMinimumAmount: "",
    donationGoalLabel: "",
    donationMessage: "",
    donationVideoUrl: "",
    donationPlaybackId: "",
    freeToSubscriptionPolicy: "",
    subscriptionToFreePolicy: "",
    subscriptionPriceIncreasePolicy: "",
  };
}

export function pickOffering(
  offerings: OfferingInput[] | null | undefined,
  type: CreatorServiceType
) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === type);

  const resolvedPrice =
    found?.publicPrice ?? found?.memberPrice ?? found?.price ?? null;

  const meta = found?.meta ?? null;

  return {
    enabled: found?.enabled === true,
    price: resolvedPrice,
    currency: (found?.currency ?? "MXN") as Currency,
    visible:
      typeof found?.visible === "boolean"
        ? found.visible
        : found?.enabled === true,
    visibility:
      found?.visibility === "members" || found?.visibility === "public"
        ? found.visibility
        : "public",
    meta,
  };
}

export function pickDonation(donation: DonationInput) {
  const mode: DonationMode =
    donation?.mode === "general" || donation?.mode === "wedding"
      ? donation.mode
      : "none";

  const minimumAmount =
    Array.isArray(donation?.suggestedAmounts) &&
    donation.suggestedAmounts.length > 0 &&
    Number(donation.suggestedAmounts[0]) > 0
      ? String(Number(donation.suggestedAmounts[0]))
      : "";

  return {
    mode,
    currency: (donation?.currency ?? "MXN") as Currency,
    minimumAmount,
    goalLabel: typeof donation?.goalLabel === "string" ? donation.goalLabel : "",
    videoUrl: typeof donation?.videoUrl === "string" ? donation.videoUrl : "",
    playbackId: typeof donation?.playbackId === "string" ? donation.playbackId : "",
  };
}

export function normalizeDurationMeta(
  meta: CreatorServiceMeta | null | undefined,
  mode: "meetGreet" | "customClass"
): string {
  const raw =
    mode === "meetGreet"
      ? meta?.meetGreet?.durationMinutes
      : meta?.customClass?.durationMinutes;

  if (raw == null) return "";

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

export function buildServiceBlockDraft(input: {
  enabled: boolean;
  price: number | null;
  currency: Currency;
  visible: boolean;
  visibility: EditableServiceVisibility;
}): ServiceBlockDraft {
  return {
    enabled: input.enabled,
    price: input.price == null ? "" : String(input.price),
    currency: input.currency,
    visible: input.visible,
    visibility: input.visibility,
  };
}

export function buildOffering(params: {
  type: CreatorServiceType;
  draft: ServiceBlockDraft;
  displayOrder: number;
  meta?: CreatorServiceMeta | null;
}): GroupOffering {
  const priceNum = params.draft.price.trim() === "" ? null : Number(params.draft.price);

  return {
    type: params.type,
    enabled: params.draft.enabled,
    visible: params.draft.enabled ? params.draft.visible : false,
    visibility: params.draft.enabled ? "public" : "hidden",
    displayOrder: params.displayOrder,
    memberPrice: params.draft.enabled ? priceNum : null,
    publicPrice: params.draft.enabled ? priceNum : null,
    currency: params.draft.enabled ? params.draft.currency : null,
    requiresApproval: true,
    sourceScope: "profile",
    meta: params.meta ?? null,
    price: params.draft.enabled ? priceNum : null,
  };
}

export function calcNetAmount(raw: string) {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return null;
  const net = n * 0.77;
  return { gross: n, net };
}

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
          left: checked ? 18 : 2,
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
        fontFamily:
          'inherit',
        transition: "all 160ms ease",
        minHeight: 42,
      }}
    >
      {label}
    </button>
  );
}

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
          left: 0;
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
          width: "100vw",
          height: "100dvh",
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
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              aria-label={tCommon("cancel")}
              style={{
                border: "none",
                background: "none",
                color: "#fff",
                cursor: loading ? "not-allowed" : "pointer",
                display: "grid",
                placeItems: "center",
                justifySelf: "end",
                padding: 4,
                opacity: loading ? 0.5 : 1,
              }}
            >
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
            </button>

            {/* Barra de carga indeterminada, sobre la línea del título. */}
            {loading && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
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
// remonte en cada render del formulario y no pierda foco/estado. La posición
// del recorte reutiliza la misma de las cards (makeServicePanelStyle).
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

