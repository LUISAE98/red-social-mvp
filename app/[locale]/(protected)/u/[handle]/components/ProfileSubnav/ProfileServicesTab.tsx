"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";

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

type OfferingInput =
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

type DonationInput = Partial<GroupDonationSettings> | null;

type Props = {
  profileUserId: string;
  currentUserId: string;
  currentOfferings?: OfferingInput[] | null;
  currentDonation?: DonationInput;
  onProfileServicesChanged?: (payload: {
    offerings?: GroupOffering[];
    donation?: GroupDonationSettings;
  }) => void;
};

type EditableServiceVisibility = "public" | "members";

type FreeToSubscriptionPolicy = "legacy_free" | "require_subscription" | "";
type SubscriptionToFreePolicy = "keep_members_free" | "remove_all_members" | "";
type SubscriptionPriceIncreasePolicy =
  | "keep_legacy_price"
  | "require_resubscribe_new_price"
  | "";

type ServiceBlockDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
  visible: boolean;
  visibility: EditableServiceVisibility;
};

type SubscriptionDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
};

type MeetGreetDraft = ServiceBlockDraft & {
  durationMinutes: string;
};

type AvailabilitySlotDraft = {
  start: string;
  end: string;
};

type WeeklyAvailabilityDraft = {
  monday: AvailabilitySlotDraft[];
  tuesday: AvailabilitySlotDraft[];
  wednesday: AvailabilitySlotDraft[];
  thursday: AvailabilitySlotDraft[];
  friday: AvailabilitySlotDraft[];
  saturday: AvailabilitySlotDraft[];
  sunday: AvailabilitySlotDraft[];
};

type CustomClassDraft = ServiceBlockDraft & {
  durationMinutes: string;
  availability: WeeklyAvailabilityDraft;
};

type ServiceDraft = {
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

const SERVICE_EMOJIS = {
  saludo: "👋",
  consejo: "💡",
  meetGreet: "🤝",
  customClass: "👑",
  donation: "🎁",
};

function createEmptyWeeklyAvailability(): WeeklyAvailabilityDraft {
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

function createEmptyDraft(): ServiceDraft {
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

function pickOffering(
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

function pickDonation(donation: DonationInput) {
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

function normalizeDurationMeta(
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

function buildServiceBlockDraft(input: {
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

function buildOffering(params: {
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

function calcNetAmount(raw: string) {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return null;
  const net = n * 0.77;
  return { gross: n, net };
}

function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes profileServicesGearSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          animation: "profileServicesGearSpin 0.9s linear infinite",
          transformOrigin: "50% 50%",
          opacity: 0.9,
        }}
      >
        ⚙
      </span>
    </>
  );
}

function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
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
        border: "1px solid rgba(255,255,255,0.18)",
        background: checked
          ? "linear-gradient(100deg, #a855ff, #4f46ff)"
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

function DonationModeButton({
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

function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [active]);
}

function useCloseOnEscape(active: boolean, onClose: () => void, disabled = false) {
  useEffect(() => {
    if (!active || disabled || typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose, disabled]);
}

function OverlayModal({
  open,
  title,
  children,
  confirmLabel: confirmLabelProp,
  cancelLabel: cancelLabelProp,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tCommon = useTranslations("common");
  const confirmLabel = confirmLabelProp ?? tCommon("saveChanges");
  const cancelLabel = cancelLabelProp ?? tCommon("cancel");
  useLockBodyScroll(open);
  useCloseOnEscape(open, onCancel, loading);

  if (!open) return null;

  const fontStack =
    'inherit';

  return createPortal(
  <div
    role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
        overscrollBehavior: "contain",
      }}
      onClick={loading ? undefined : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100%, 640px)",
          maxWidth: 640,
          maxHeight: "min(88dvh, 88vh)",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          borderRadius: 22,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "#111",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <h3
          style={{
            margin: 0,
            color: "#fff",
            fontSize: 18,
            lineHeight: 1.2,
            fontWeight: 800,
            fontFamily: fontStack,
          }}
        >
          {title}
        </h3>

        <div style={{ display: "grid", gap: 12 }}>{children}</div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              minWidth: 120,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 13,
              fontFamily: fontStack,
              opacity: loading ? 0.6 : 1,
              flex: "1 1 160px",
            }}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              minWidth: 180,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.92)",
              background: "#fff",
              color: "#000",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 800,
              fontSize: 13,
              fontFamily: fontStack,
              opacity: loading ? 0.75 : 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              flex: "1 1 220px",
            }}
          >
            {loading ? (
              <>
                <SpinningGear />
                Guardando...
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
        </div>,
    document.body
  );
}

export default function ProfileServicesTab({
  profileUserId,
  currentUserId,
  currentOfferings = null,
  currentDonation = null,
  onProfileServicesChanged,
}: Props) {
  const isOwner = useMemo(
    () => profileUserId === currentUserId,
    [profileUserId, currentUserId]
  );

  const priceFmt = usePriceFormat();
  const formatMoney = (value: number, currency?: string) =>
    priceFmt.format(value, { baseCurrency: (currency ?? "MXN") as DisplayCurrency, code: true });

  const [draft, setDraft] = useState<ServiceDraft>(createEmptyDraft());
  const [, setSavedDraft] = useState<ServiceDraft>(createEmptyDraft());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (err) showToast(err, "error"); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastHydratedProfileIdRef = useRef<string | null>(null);
  const skipHydrationWhileSavingRef = useRef(false);

  useEffect(() => {
    if (!isOwner) return;
    if (skipHydrationWhileSavingRef.current) return;

    const saludo = pickOffering(currentOfferings, "saludo");
    const consejo = pickOffering(currentOfferings, "consejo");
    const meetGreet = pickOffering(currentOfferings, "meet_greet_digital");
    const customClass = pickOffering(currentOfferings, "clase_personalizada");
    const donation = pickDonation(currentDonation);

    const nextDraft: ServiceDraft = {
      subscription: {
        enabled: false,
        price: "",
        currency: "MXN",
      },
      saludo: buildServiceBlockDraft({
        enabled: saludo.enabled,
        price: saludo.price,
        currency: saludo.currency ?? "MXN",
        visible: saludo.enabled,
        visibility: "public",
      }),
      consejo: buildServiceBlockDraft({
        enabled: consejo.enabled,
        price: consejo.price,
        currency: consejo.currency ?? "MXN",
        visible: consejo.enabled,
        visibility: "public",
      }),
      meetGreet: {
        ...buildServiceBlockDraft({
          enabled: meetGreet.enabled,
          price: meetGreet.price,
          currency: meetGreet.currency ?? "MXN",
          visible: meetGreet.enabled,
          visibility: "public",
        }),
        durationMinutes: normalizeDurationMeta(meetGreet.meta, "meetGreet"),
      },
      customClass: {
        ...buildServiceBlockDraft({
          enabled: customClass.enabled,
          price: customClass.price,
          currency: customClass.currency ?? "MXN",
          visible: customClass.enabled,
          visibility: "public",
        }),
        durationMinutes: normalizeDurationMeta(
          customClass.meta,
          "customClass"
        ),
        availability: createEmptyWeeklyAvailability(),
      },
      donationMode: donation.mode,
      donationCurrency: donation.currency ?? "MXN",
      donationMinimumAmount: donation.minimumAmount,
      donationGoalLabel: donation.goalLabel ?? "",
      donationMessage: (donation as { message?: string }).message ?? "",
      donationVideoUrl: donation.videoUrl ?? "",
      donationPlaybackId: donation.playbackId ?? "",
      freeToSubscriptionPolicy: "",
      subscriptionToFreePolicy: "",
      subscriptionPriceIncreasePolicy: "",
    };

    const isFirstHydrationForProfile =
      lastHydratedProfileIdRef.current !== profileUserId;

    if (isFirstHydrationForProfile) {
      lastHydratedProfileIdRef.current = profileUserId;
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setErr(null);
      return;
    }

    setDraft(nextDraft);
    setSavedDraft(nextDraft);
  }, [profileUserId, isOwner, currentOfferings, currentDonation]);

  if (!isOwner) return null;

  const fontStack =
    'inherit';

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 12,
  };

  const panelStyle: React.CSSProperties = {
    padding: "10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    display: "grid",
    gap: 9,
  };

  // Panel con la misma imagen de fondo que se usa al presentar cada servicio
  // (ver CreatorExperiencesSection), sin contorno.
  const makeServicePanelStyle = (
    image: string,
    position: string
  ): React.CSSProperties => ({
    ...panelStyle,
    border: "none",
    padding: "14px",
    background: `linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('${image}') ${position}/cover no-repeat`,
  });

  const saludoPanelStyle = makeServicePanelStyle("/saludo.png", "center 32%");
  const consejoPanelStyle = makeServicePanelStyle("/consejo.png", "center 60%");
  const meetGreetPanelStyle = makeServicePanelStyle(
    "/encuentroenvivo.png",
    "center 60%"
  );
  const customClassPanelStyle = makeServicePanelStyle(
    "/sesionexclusiva.png",
    "center 75%"
  );
  const donationPanelStyle = makeServicePanelStyle("/donacion.png", "center 50%");

  // Panel sin imagen de fondo, para servicios aún no activados.
  const plainPanelStyle: React.CSSProperties = {
    ...panelStyle,
    border: "none",
    padding: "14px",
    background: "transparent",
  };

  const subtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.35,
  };

  // Descripción de cada experiencia: más legible que subtleStyle.
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
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    outline: "none",
    fontSize: 12,
    fontFamily: fontStack,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    minHeight: 42,
  };

  const noticeStyle: React.CSSProperties = {
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "8px 10px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
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
    fontFamily: fontStack,
    lineHeight: 1.1,
    width: "100%",
  };

  async function saveServicesFromDraft(sourceDraft?: ServiceDraft) {
    setSaving(true);
    setErr(null);

    const workingDraft = sourceDraft ?? draft;

    try {
      const saludoPriceNum =
        workingDraft.saludo.price.trim() === ""
          ? null
          : Number(workingDraft.saludo.price);

      const consejoPriceNum =
        workingDraft.consejo.price.trim() === ""
          ? null
          : Number(workingDraft.consejo.price);

      const meetGreetPriceNum =
        workingDraft.meetGreet.price.trim() === ""
          ? null
          : Number(workingDraft.meetGreet.price);

      const customClassPriceNum =
        workingDraft.customClass.price.trim() === ""
          ? null
          : Number(workingDraft.customClass.price);

      const meetGreetDurationNum =
        workingDraft.meetGreet.durationMinutes.trim() === ""
          ? null
          : Number(workingDraft.meetGreet.durationMinutes);

      const customClassDurationNum =
        workingDraft.customClass.durationMinutes.trim() === ""
          ? null
          : Number(workingDraft.customClass.durationMinutes);

      const donationMinimumNum =
        workingDraft.donationMinimumAmount.trim() === ""
          ? null
          : Number(workingDraft.donationMinimumAmount);

      if (
        workingDraft.saludo.enabled &&
        (saludoPriceNum == null ||
          Number.isNaN(saludoPriceNum) ||
          saludoPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para saludos.");
        return;
      }

      if (
        workingDraft.consejo.enabled &&
        (consejoPriceNum == null ||
          Number.isNaN(consejoPriceNum) ||
          consejoPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para consejos.");
        return;
      }

      if (
        workingDraft.meetGreet.enabled &&
        (meetGreetPriceNum == null ||
          Number.isNaN(meetGreetPriceNum) ||
          meetGreetPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para Tiempo contigo.");
        return;
      }

      if (
        workingDraft.customClass.enabled &&
        (customClassPriceNum == null ||
          Number.isNaN(customClassPriceNum) ||
          customClassPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para sesión exclusiva.");
        return;
      }

      if (
        workingDraft.meetGreet.enabled &&
        (meetGreetDurationNum == null ||
          Number.isNaN(meetGreetDurationNum) ||
          meetGreetDurationNum <= 0 ||
          !Number.isInteger(meetGreetDurationNum))
      ) {
        setErr(
          "❌ Debes definir una duración válida en minutos para Tiempo contigo."
        );
        return;
      }

      if (
        workingDraft.customClass.enabled &&
        (customClassDurationNum == null ||
          Number.isNaN(customClassDurationNum) ||
          customClassDurationNum <= 0 ||
          !Number.isInteger(customClassDurationNum))
      ) {
        setErr(
          "❌ Debes definir una duración válida en minutos para la sesión exclusiva."
        );
        return;
      }

      if (
        workingDraft.donationMode !== "none" &&
        (donationMinimumNum == null ||
          Number.isNaN(donationMinimumNum) ||
          donationMinimumNum <= 0)
      ) {
        setErr("❌ Debes definir un monto mínimo válido para la donación.");
        return;
      }

      if (
        workingDraft.donationMode === "wedding" &&
        !workingDraft.donationGoalLabel.trim()
      ) {
        setErr("❌ Debes escribir el texto visible para la donación de boda.");
        return;
      }

      const nextOfferings: GroupOffering[] = [
        buildOffering({
          type: "saludo",
          draft: workingDraft.saludo,
          displayOrder: 1,
        }),
        buildOffering({
          type: "consejo",
          draft: workingDraft.consejo,
          displayOrder: 2,
        }),
        buildOffering({
          type: "meet_greet_digital",
          draft: workingDraft.meetGreet,
          displayOrder: 3,
          meta: {
            meetGreet: {
              durationMinutes: workingDraft.meetGreet.enabled
                ? meetGreetDurationNum
                : null,
            },
          },
        }),
        buildOffering({
          type: "clase_personalizada",
          draft: workingDraft.customClass,
          displayOrder: 4,
          meta: {
            customClass: {
              durationMinutes: workingDraft.customClass.enabled
                ? customClassDurationNum
                : null,
              availability: createEmptyWeeklyAvailability(),
              bufferMinutes: null,
              advanceBookingHours: null,
              maxBookingsPerDay: null,
            },
          },
        }),
      ];

      const nextDonation: GroupDonationSettings = {
        mode: workingDraft.donationMode,
        enabled: workingDraft.donationMode !== "none",
        visible: workingDraft.donationMode !== "none",
        currency:
          workingDraft.donationMode !== "none"
            ? workingDraft.donationCurrency
            : "MXN",
        sourceScope: "profile",
        suggestedAmounts:
          workingDraft.donationMode !== "none" && donationMinimumNum != null
            ? [donationMinimumNum]
            : [],
        goalLabel: workingDraft.donationGoalLabel.trim() || null,
        message: workingDraft.donationMessage.trim() || null,
        videoUrl: workingDraft.donationVideoUrl || null,
        playbackId: workingDraft.donationPlaybackId || null,
      };

      skipHydrationWhileSavingRef.current = true;

      await updateProfileOfferings({
        profileUserId,
        offerings: nextOfferings,
        donation: nextDonation,
        currency: "MXN",
      });

      const nextSaved: ServiceDraft = {
        ...workingDraft,
        subscription: {
          enabled: false,
          price: "",
          currency: "MXN",
        },
        saludo: {
          ...workingDraft.saludo,
          price: workingDraft.saludo.enabled ? workingDraft.saludo.price : "",
          visible: workingDraft.saludo.enabled ? workingDraft.saludo.visible : false,
          visibility: "public",
        },
        consejo: {
          ...workingDraft.consejo,
          price: workingDraft.consejo.enabled ? workingDraft.consejo.price : "",
          visible: workingDraft.consejo.enabled ? workingDraft.consejo.visible : false,
          visibility: "public",
        },
        meetGreet: {
          ...workingDraft.meetGreet,
          price: workingDraft.meetGreet.enabled
            ? workingDraft.meetGreet.price
            : "",
          visible: workingDraft.meetGreet.enabled
            ? workingDraft.meetGreet.visible
            : false,
          visibility: "public",
          durationMinutes: workingDraft.meetGreet.enabled
            ? workingDraft.meetGreet.durationMinutes
            : "",
        },
        customClass: {
          ...workingDraft.customClass,
          price: workingDraft.customClass.enabled
            ? workingDraft.customClass.price
            : "",
          visible: workingDraft.customClass.enabled
            ? workingDraft.customClass.visible
            : false,
          visibility: "public",
          durationMinutes: workingDraft.customClass.enabled
            ? workingDraft.customClass.durationMinutes
            : "",
          availability: createEmptyWeeklyAvailability(),
        },
        donationCurrency:
          workingDraft.donationMode !== "none"
            ? workingDraft.donationCurrency
            : "MXN",
        donationMinimumAmount:
          workingDraft.donationMode !== "none"
            ? workingDraft.donationMinimumAmount
            : "",
        donationGoalLabel:
          workingDraft.donationMode === "wedding"
            ? workingDraft.donationGoalLabel
            : "",
        donationVideoUrl: workingDraft.donationVideoUrl,
        donationPlaybackId: workingDraft.donationPlaybackId,
      };

            setDraft(nextSaved);
      setSavedDraft(nextSaved);

      onProfileServicesChanged?.({
        offerings: nextOfferings,
        donation: nextDonation,
      });

      showToast("Servicios del perfil guardados.", "success");
    } catch (e: unknown) {
      showToast("No se pudieron guardar los servicios del perfil.", "error");
    } finally {
      skipHydrationWhileSavingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div style={contentStyle}>
      <h2
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 1.2,
          color: "#fff",
          fontFamily: fontStack,
        }}
      >
        Configura tus experiencias
      </h2>

      <Greetings
        draft={draft}
        saving={saving}
        saludoEmoji={SERVICE_EMOJIS.saludo}
        showDescription
        descriptionStyle={descriptionStyle}
        panelStyle={draft.saludo.enabled ? saludoPanelStyle : plainPanelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />

      <Advice
        draft={draft}
        saving={saving}
        consejoEmoji={SERVICE_EMOJIS.consejo}
        showDescription
        descriptionStyle={descriptionStyle}
        panelStyle={draft.consejo.enabled ? consejoPanelStyle : plainPanelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />

      <MeetGreet
        draft={draft}
        saving={saving}
        meetGreetEmoji={SERVICE_EMOJIS.meetGreet}
        showDescription
        descriptionStyle={descriptionStyle}
        panelStyle={draft.meetGreet.enabled ? meetGreetPanelStyle : plainPanelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />

      <CustomClass
        draft={draft}
        saving={saving}
        customClassEmoji={SERVICE_EMOJIS.customClass}
        showDescription
        descriptionStyle={descriptionStyle}
        panelStyle={draft.customClass.enabled ? customClassPanelStyle : plainPanelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={(d) => saveServicesFromDraft(d as unknown as ServiceDraft)}
      />

      <ProfileDonation
        draft={draft}
        saving={saving}
        profileUserId={profileUserId}
        panelStyle={draft.donationMode !== "none" ? donationPanelStyle : plainPanelStyle}
        descriptionStyle={descriptionStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        SwitchComponent={Switch}
        DonationModeButtonComponent={DonationModeButton}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={(d) => saveServicesFromDraft(d as ServiceDraft)}
      />

      <VibraToast toast={toast} />
    </div>
  );
}