"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildNormalizedGroupCommerceState } from "@/lib/groups/groupServiceCatalog";
import {
  applyGroupSubscriptionTransition,
  removeLegacyFreeMembersAfterSubscriptionTransition,
} from "@/lib/groups/subscriptionTransitions";
import type {
  Currency,
  GroupOffering,
  CreatorServiceType,
  GroupDonationSettings,
  DonationMode,
  CreatorServiceMeta,
} from "@/types/group";

import Subscription from "./services/Subscription";
import Greetings from "./services/Greetings";
import Advice from "./services/Advice";
import MeetGreet from "./services/MeetGreet";
import CustomClass from "./services/CustomClass";
import Donation from "./services/Donation";

type Visibility = "public" | "private" | "hidden" | string | null;

type FreeToSubscriptionPolicy = "legacy_free" | "require_subscription" | "";
type SubscriptionToFreePolicy = "keep_members_free" | "remove_all_members" | "";
type SubscriptionPriceIncreasePolicy =
  | "keep_legacy_price"
  | "require_resubscribe_new_price"
  | "";

type MonetizationTransitionsInput =
  | {
      freeToSubscriptionPolicy?: "legacy_free" | "require_subscription" | null;
      subscriptionToFreePolicy?:
        | "keep_members_free"
        | "remove_all_members"
        | null;
      subscriptionPriceIncreasePolicy?:
        | "keep_legacy_price"
        | "require_resubscribe_new_price"
        | null;
      previousSubscriptionPriceMonthly?: number | null;
      nextSubscriptionPriceMonthly?: number | null;
      subscriptionPriceChangeCurrency?: Currency | null;
      lastMonetizationChangeAt?: unknown;
      lastMonetizationChangeBy?: string | null;
    }
  | null;

type MonetizationInput =
  | {
      isPaid?: boolean;
      priceMonthly?: number | null;
      currency?: Currency | null;
      subscriptionsEnabled?: boolean;
      paidPostsEnabled?: boolean;
      paidLivesEnabled?: boolean;
      paidVodEnabled?: boolean;
      paidLiveCommentsEnabled?: boolean;
      greetingsEnabled?: boolean;
      adviceEnabled?: boolean;
      customClassEnabled?: boolean;
      digitalMeetGreetEnabled?: boolean;
      subscriptionPriceMonthly?: number | null;
      subscriptionCurrency?: Currency | null;
      transitions?: MonetizationTransitionsInput;
    }
  | null;

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
  groupId: string;
  ownerId: string;
  currentUserId: string;
  currentVisibility?: Visibility;
  currentMonetization?: MonetizationInput;
  currentOfferings?: OfferingInput[] | null;
  currentDonation?: DonationInput;
};

type EditableServiceVisibility = "public" | "members";

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
  freeToSubscriptionPolicy: FreeToSubscriptionPolicy;
  subscriptionToFreePolicy: SubscriptionToFreePolicy;
  subscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy;
};

const WEEKDAY_OPTIONS: Array<{
  key: keyof WeeklyAvailabilityDraft;
  label: string;
}> = [
  { key: "monday", label: "Lunes" },
  { key: "tuesday", label: "Martes" },
  { key: "wednesday", label: "Miércoles" },
  { key: "thursday", label: "Jueves" },
  { key: "friday", label: "Viernes" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0")
);

const MINUTE_OPTIONS = ["00", "15", "30", "45"];

const SERVICE_EMOJIS = {
  subscription: "💎",
  saludo: "👋",
  consejo: "💡",
  meetGreet: "🤝",
  customClass: "🎓",
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

function isValidTimeValue(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function normalizeWeeklyAvailabilityFromMeta(
  meta: CreatorServiceMeta | null | undefined
): WeeklyAvailabilityDraft {
  const rawAvailability = meta?.customClass?.availability;
  const next = createEmptyWeeklyAvailability();

  if (!rawAvailability) return next;

  for (const day of WEEKDAY_OPTIONS) {
    const rawSlots = Array.isArray(rawAvailability[day.key])
      ? (rawAvailability[day.key] as Array<{
          start?: unknown;
          end?: unknown;
        }>)
      : [];

    next[day.key] = rawSlots
      .map((slot) => {
        const start = isValidTimeValue(slot?.start) ? slot.start : "";
        const end = isValidTimeValue(slot?.end) ? slot.end : "";

        if (!start || !end) return null;

        return { start, end };
      })
      .filter((slot): slot is AvailabilitySlotDraft => slot !== null);
  }

  return next;
}

function pickSubscription(monetization: MonetizationInput) {
  const enabled =
    typeof monetization?.subscriptionsEnabled === "boolean"
      ? monetization.subscriptionsEnabled
      : monetization?.isPaid === true;

  const price =
    monetization?.subscriptionPriceMonthly ??
    monetization?.priceMonthly ??
    null;

  const currency =
    monetization?.subscriptionCurrency ??
    monetization?.currency ??
    "MXN";

  return {
    enabled,
    price,
    currency,
  };
}

function pickTransitions(monetization: MonetizationInput): {
  freeToSubscriptionPolicy: FreeToSubscriptionPolicy;
  subscriptionToFreePolicy: SubscriptionToFreePolicy;
  subscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy;
} {
  const transitions = monetization?.transitions ?? null;

  const freeToSubscriptionPolicy: FreeToSubscriptionPolicy =
    transitions?.freeToSubscriptionPolicy === "legacy_free" ||
    transitions?.freeToSubscriptionPolicy === "require_subscription"
      ? transitions.freeToSubscriptionPolicy
      : "";

  const subscriptionToFreePolicy: SubscriptionToFreePolicy =
    transitions?.subscriptionToFreePolicy === "keep_members_free" ||
    transitions?.subscriptionToFreePolicy === "remove_all_members"
      ? transitions.subscriptionToFreePolicy
      : "";

  const subscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy =
    transitions?.subscriptionPriceIncreasePolicy === "keep_legacy_price" ||
    transitions?.subscriptionPriceIncreasePolicy ===
      "require_resubscribe_new_price"
      ? transitions.subscriptionPriceIncreasePolicy
      : "";

  return {
    freeToSubscriptionPolicy,
    subscriptionToFreePolicy,
    subscriptionPriceIncreasePolicy,
  };
}

function pickOffering(
  offerings: OfferingInput[] | null | undefined,
  type: CreatorServiceType
) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === type);

  const resolvedPrice =
    found?.memberPrice ?? found?.publicPrice ?? found?.price ?? null;

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
  };
}

function calcNetAmount(raw: string) {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return null;
  const net = n * 0.77;
  return { gross: n, net };
}

function formatMoney(value: number, currency: Currency) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
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

function buildSubscriptionDraft(input: {
  enabled: boolean;
  price: number | null;
  currency: Currency;
}): SubscriptionDraft {
  return {
    enabled: input.enabled,
    price: input.price == null ? "" : String(input.price),
    currency: input.currency,
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
      visibility: "members",
    },
    consejo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "members",
    },
    meetGreet: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "members",
      durationMinutes: "",
    },
    customClass: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "members",
      durationMinutes: "",
      availability: createEmptyWeeklyAvailability(),
    },
    donationMode: "none",
    donationCurrency: "MXN",
    donationMinimumAmount: "",
    donationGoalLabel: "",
    freeToSubscriptionPolicy: "",
    subscriptionToFreePolicy: "",
    subscriptionPriceIncreasePolicy: "",
  };
}

function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes ownerServicesGearSpin {
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
          animation: "ownerServicesGearSpin 0.9s linear infinite",
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
      title={label}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: checked ? "#ffffff" : "rgba(255,255,255,0.08)",
        padding: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 160ms ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked ? "#000" : "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          transition: "all 160ms ease",
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
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        transition: "all 160ms ease",
        minHeight: 42,
      }}
    >
      {label}
    </button>
  );
}

function sameServiceBlock(a: ServiceBlockDraft, b: ServiceBlockDraft) {
  return (
    a.enabled === b.enabled &&
    a.price === b.price &&
    a.currency === b.currency &&
    a.visible === b.visible &&
    a.visibility === b.visibility
  );
}

function sameSubscriptionBlock(a: SubscriptionDraft, b: SubscriptionDraft) {
  return (
    a.enabled === b.enabled &&
    a.price === b.price &&
    a.currency === b.currency
  );
}

function sameWeeklyAvailability(
  a: WeeklyAvailabilityDraft,
  b: WeeklyAvailabilityDraft
) {
  return WEEKDAY_OPTIONS.every((day) => {
    const aSlots = a[day.key];
    const bSlots = b[day.key];
    if (aSlots.length !== bSlots.length) return false;

    return aSlots.every(
      (slot, index) =>
        slot.start === bSlots[index]?.start && slot.end === bSlots[index]?.end
    );
  });
}

function sameDraft(a: ServiceDraft, b: ServiceDraft) {
  return (
    sameSubscriptionBlock(a.subscription, b.subscription) &&
    sameServiceBlock(a.saludo, b.saludo) &&
    sameServiceBlock(a.consejo, b.consejo) &&
    sameServiceBlock(a.meetGreet, b.meetGreet) &&
    a.meetGreet.durationMinutes === b.meetGreet.durationMinutes &&
    sameServiceBlock(a.customClass, b.customClass) &&
    a.customClass.durationMinutes === b.customClass.durationMinutes &&
    sameWeeklyAvailability(a.customClass.availability, b.customClass.availability) &&
    a.donationMode === b.donationMode &&
    a.donationCurrency === b.donationCurrency &&
    a.donationMinimumAmount === b.donationMinimumAmount &&
    a.donationGoalLabel === b.donationGoalLabel &&
    a.freeToSubscriptionPolicy === b.freeToSubscriptionPolicy &&
    a.subscriptionToFreePolicy === b.subscriptionToFreePolicy &&
    a.subscriptionPriceIncreasePolicy === b.subscriptionPriceIncreasePolicy
  );
}

function buildOffering(params: {
  type: CreatorServiceType;
  draft: ServiceBlockDraft;
  displayOrder: number;
  meta?: CreatorServiceMeta | null;
}): GroupOffering {
  const { type, draft, displayOrder, meta = null } = params;
  const priceNum = draft.price.trim() === "" ? null : Number(draft.price);

  return {
    type,
    enabled: draft.enabled,
    visible: draft.visible,
    visibility: draft.visibility,
    displayOrder,
    memberPrice: draft.enabled ? priceNum : null,
    publicPrice: draft.enabled ? priceNum : null,
    currency: draft.enabled ? draft.currency : null,
    requiresApproval: true,
    sourceScope: "group",
    meta,
    price: draft.enabled ? priceNum : null,
  };
}

function buildTransitionSuccessMessage(params: {
  direction:
    | "free_to_subscription"
    | "subscription_to_free"
    | "subscription_price_increase";
  policy:
    | "legacy_free"
    | "require_subscription"
    | "keep_members_free"
    | "remove_all_members"
    | "keep_legacy_price"
    | "require_resubscribe_new_price";
  alreadyApplied: boolean;
  updatedMembers: number;
  legacyGrantedMembers: number;
  legacyPricedMembers?: number;
  removedMembers: number;
  skippedMembers: number;
}) {
  const {
    direction,
    policy,
    alreadyApplied,
    updatedMembers,
    legacyGrantedMembers,
    legacyPricedMembers = 0,
    removedMembers,
    skippedMembers,
  } = params;

  if (alreadyApplied) {
    return "✅ Configuración guardada. Esta transición ya había sido aplicada anteriormente y no se duplicó.";
  }

  if (direction === "free_to_subscription" && policy === "legacy_free") {
    return `✅ Configuración guardada. Se mantuvo gratis a ${legacyGrantedMembers} integrante(s) existentes. Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  if (direction === "free_to_subscription" && policy === "require_subscription") {
    return `✅ Configuración guardada. Se retiró el acceso a ${removedMembers} integrante(s) para que deban suscribirse de nuevo. Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  if (
    direction === "subscription_to_free" &&
    policy === "keep_members_free"
  ) {
    return `✅ Configuración guardada. La comunidad volvió a gratis y ${updatedMembers} integrante(s) conservaron acceso normal. Omitidos: ${skippedMembers}.`;
  }

  if (
    direction === "subscription_to_free" &&
    policy === "remove_all_members"
  ) {
    return `✅ Configuración guardada. La comunidad volvió a gratis y se retiró el acceso a ${removedMembers} integrante(s). Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  if (
    direction === "subscription_price_increase" &&
    policy === "keep_legacy_price"
  ) {
    return `✅ Configuración guardada. Se aumentó el precio para nuevas suscripciones y ${legacyPricedMembers} suscriptor(es) actuales conservaron su precio anterior. Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  if (
    direction === "subscription_price_increase" &&
    policy === "require_resubscribe_new_price"
  ) {
    return `✅ Configuración guardada. Se retiró el acceso a ${removedMembers} suscriptor(es) actuales para que deban suscribirse de nuevo con el nuevo precio. Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  return "✅ Configuración guardada.";
}

function buildManualLegacyRemovalSuccessMessage(params: {
  removedMembers: number;
  reminderMembers: number;
  skippedMembers: number;
}) {
  const { removedMembers, reminderMembers, skippedMembers } = params;

  if (removedMembers <= 0) {
    return "✅ No había miembros gratuitos activos para retirar en este momento.";
  }

  return `✅ Se retiró a ${removedMembers} miembro(s) gratuito(s) y se generó el recordatorio correspondiente para ${reminderMembers} cuenta(s). Omitidos: ${skippedMembers}.`;
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
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose, disabled]);
}

function ModalPortal({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(children, document.body);
}

function parseTimeValue(value: string): { hour: string; minute: string } {
  if (!value || !value.includes(":")) {
    return { hour: "", minute: "" };
  }

  const [hour, minute] = value.split(":");
  return {
    hour: hour ?? "",
    minute: minute ?? "",
  };
}

function DarkSelect({
  value,
  placeholder,
  options,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        width: 110,
        minWidth: 110,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: "100%",
          minHeight: 42,
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.04)",
          color: "#fff",
          textAlign: "left",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.2,
          boxSizing: "border-box",
        }}
      >
        {value || placeholder}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            width: "100%",
            maxHeight: 220,
            overflowY: "auto",
            background: "#0B0B0C",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            zIndex: 999999,
            boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
          }}
        >
          {options.map((opt) => {
            const isSelected = value === opt;

            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  background: isSelected ? "rgba(255,255,255,0.08)" : "#0B0B0C",
                  color: "#FFFFFF",
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: 1.2,
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimeSelectRow({
  value,
  onChange,
  inputStyle,
}: {
  value: string;
  onChange: (next: string) => void;
  inputStyle: React.CSSProperties;
}) {
  const parsed = parseTimeValue(value);

  const [localHour, setLocalHour] = useState(parsed.hour);
  const [localMinute, setLocalMinute] = useState(parsed.minute);

  useEffect(() => {
    setLocalHour(parsed.hour);
    setLocalMinute(parsed.minute);
  }, [parsed.hour, parsed.minute]);

  function commitNext(nextHour: string, nextMinute: string) {
    if (nextHour && nextMinute) {
      onChange(`${nextHour}:${nextMinute}`);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <DarkSelect
        value={localHour}
        placeholder="Hora"
        options={HOUR_OPTIONS}
        onChange={(nextHour) => {
          setLocalHour(nextHour);
          commitNext(nextHour, localMinute);
        }}
      />

      <DarkSelect
        value={localMinute}
        placeholder="Minuto"
        options={MINUTE_OPTIONS}
        onChange={(nextMinute) => {
          setLocalMinute(nextMinute);
          commitNext(localHour, nextMinute);
        }}
      />
    </div>
  );
}

function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useLockBodyScroll(open);
  useCloseOnEscape(open, onCancel, loading);

  if (!open) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  return (
    <ModalPortal open={open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-services-confirm-title"
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
            width: "100%",
            maxWidth: 520,
            maxHeight: "min(88dvh, 88vh)",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "#111",
            boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            padding: 18,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <h3
              id="owner-services-confirm-title"
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

            <div
              style={{
                color: "rgba(255,255,255,0.72)",
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: fontStack,
              }}
            >
              {description}
            </div>
          </div>

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
                minWidth: 190,
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
                  Procesando...
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function OverlayModal({
  open,
  title,
  children,
  confirmLabel = "Guardar cambios",
  cancelLabel = "Cancelar",
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
  useLockBodyScroll(open);
  useCloseOnEscape(open, onCancel, loading);

  if (!open) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  return (
    <ModalPortal open={open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-services-overlay-title"
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
            id="owner-services-overlay-title"
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
      </div>
    </ModalPortal>
  );
}

export default function OwnerSidebar({
  groupId,
  ownerId,
  currentUserId,
  currentVisibility = null,
  currentMonetization = null,
  currentOfferings = null,
  currentDonation = null,
}: Props) {
  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const isPublic = currentVisibility === "public";

  const [draft, setDraft] = useState<ServiceDraft>(createEmptyDraft());
  const [savedDraft, setSavedDraft] = useState<ServiceDraft>(createEmptyDraft());

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [removingLegacyMembers, setRemovingLegacyMembers] = useState(false);
  const [activeLegacyFreeMembersCount, setActiveLegacyFreeMembersCount] =
    useState(0);

  const hasActiveLegacyFreeMembers = activeLegacyFreeMembersCount > 0;

  const canRemoveLegacyFreeMembersLater =
    !isPublic &&
    (currentMonetization?.subscriptionsEnabled === true ||
      currentMonetization?.isPaid === true) &&
    hasActiveLegacyFreeMembers;

  const lastHydratedGroupIdRef = useRef<string | null>(null);
  const skipHydrationWhileSavingRef = useRef(false);

  useEffect(() => {
    if (!isOwner) return;
    if (skipHydrationWhileSavingRef.current) return;

    const sub = pickSubscription(currentMonetization);
    const transitions = pickTransitions(currentMonetization);
    const saludo = pickOffering(currentOfferings, "saludo");
    const consejo = pickOffering(currentOfferings, "consejo");
    const meetGreet = pickOffering(currentOfferings, "meet_greet_digital");
    const customClass = pickOffering(currentOfferings, "clase_personalizada");
    const donation = pickDonation(currentDonation);

    const nextDraft: ServiceDraft = {
      subscription: buildSubscriptionDraft({
        enabled: isPublic ? false : sub.enabled,
        price: isPublic ? null : sub.price,
        currency: sub.currency ?? "MXN",
      }),
      saludo: buildServiceBlockDraft({
        enabled: saludo.enabled,
        price: saludo.price,
        currency: saludo.currency ?? "MXN",
        visible: saludo.enabled,
        visibility: "members",
      }),
      consejo: buildServiceBlockDraft({
        enabled: consejo.enabled,
        price: consejo.price,
        currency: consejo.currency ?? "MXN",
        visible: consejo.enabled,
        visibility: "members",
      }),
      meetGreet: {
        ...buildServiceBlockDraft({
          enabled: meetGreet.enabled,
          price: meetGreet.price,
          currency: meetGreet.currency ?? "MXN",
          visible: meetGreet.enabled,
          visibility: "members",
        }),
        durationMinutes: normalizeDurationMeta(meetGreet.meta, "meetGreet"),
      },
      customClass: {
        ...buildServiceBlockDraft({
          enabled: customClass.enabled,
          price: customClass.price,
          currency: customClass.currency ?? "MXN",
          visible: customClass.enabled,
          visibility: "members",
        }),
        durationMinutes: normalizeDurationMeta(
          customClass.meta,
          "customClass"
        ),
        availability: normalizeWeeklyAvailabilityFromMeta(customClass.meta),
      },
      donationMode: donation.mode,
      donationCurrency: donation.currency ?? "MXN",
      donationMinimumAmount: donation.minimumAmount,
      donationGoalLabel: donation.goalLabel ?? "",
      freeToSubscriptionPolicy: transitions.freeToSubscriptionPolicy,
      subscriptionToFreePolicy: transitions.subscriptionToFreePolicy,
      subscriptionPriceIncreasePolicy:
        transitions.subscriptionPriceIncreasePolicy,
    };

    const isFirstHydrationForGroup = lastHydratedGroupIdRef.current !== groupId;

    if (isFirstHydrationForGroup) {
      lastHydratedGroupIdRef.current = groupId;
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setMsg(null);
      setErr(null);
      return;
    }

    setSavedDraft((prevSaved) => {
      if (sameDraft(prevSaved, nextDraft)) return prevSaved;
      return nextDraft;
    });

    setDraft((prevDraft) => {
      const hasUnsavedChanges = !sameDraft(prevDraft, savedDraft);
      if (hasUnsavedChanges) return prevDraft;
      return nextDraft;
    });
  }, [
    groupId,
    isOwner,
    isPublic,
    currentMonetization,
    currentOfferings,
    currentDonation,
    savedDraft,
  ]);

  useEffect(() => {
    if (!isOwner) {
      setActiveLegacyFreeMembersCount(0);
      return;
    }

    const subscriptionIsPersistedActive =
      currentMonetization?.subscriptionsEnabled === true ||
      currentMonetization?.isPaid === true;

    if (isPublic || !subscriptionIsPersistedActive) {
      setActiveLegacyFreeMembersCount(0);
      return;
    }

    const membersRef = collection(db, "groups", groupId, "members");

    const unsubscribe = onSnapshot(
      membersRef,
      (snapshot) => {
        let count = 0;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as {
            status?: string;
            roleInGroup?: string;
            role?: string;
            accessType?: string | null;
            legacyComplimentary?: boolean;
            subscriptionActive?: boolean;
            requiresSubscription?: boolean;
          };

          const roleRaw =
            typeof data.roleInGroup === "string"
              ? data.roleInGroup
              : typeof data.role === "string"
                ? data.role
                : "";

          const normalizedRole = roleRaw.trim().toLowerCase();

          if (
            normalizedRole === "owner" ||
            normalizedRole === "mod" ||
            normalizedRole === "moderator"
          ) {
            return;
          }

          const status =
            typeof data.status === "string"
              ? data.status.trim().toLowerCase()
              : "active";

          if (status !== "active") return;

          const accessType =
            typeof data.accessType === "string"
              ? data.accessType.trim().toLowerCase()
              : "";

          const isLegacyFree =
            accessType === "legacy_free" ||
            data.legacyComplimentary === true ||
            (accessType !== "subscription" &&
              data.subscriptionActive !== true &&
              data.requiresSubscription !== true);

          if (isLegacyFree) {
            count += 1;
          }
        });

        setActiveLegacyFreeMembersCount(count);
      },
      () => {
        setActiveLegacyFreeMembersCount(0);
      }
    );

    return () => unsubscribe();
  }, [
    groupId,
    isOwner,
    isPublic,
    currentMonetization?.subscriptionsEnabled,
    currentMonetization?.isPaid,
  ]);

  if (!isOwner) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

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

  const subtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.35,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#fff",
    fontWeight: 700,
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

  async function handleConfirmRemoveLegacyFreeMembersLater() {
    if (!canRemoveLegacyFreeMembersLater) return;

    setRemovingLegacyMembers(true);
    setMsg(null);
    setErr(null);

    try {
      const response =
        await removeLegacyFreeMembersAfterSubscriptionTransition({
          groupId,
        });

      setMsg(
        buildManualLegacyRemovalSuccessMessage({
          removedMembers: response.removedMembers,
          reminderMembers: response.reminderMembers,
          skippedMembers: response.skippedMembers,
        })
      );
    } catch (e: any) {
      setErr(
        e?.message ??
          "❌ No se pudo retirar a los miembros gratuitos."
      );
    } finally {
      setRemovingLegacyMembers(false);
    }
  }

  async function saveServicesFromDraft(sourceDraft?: ServiceDraft) {
    setSaving(true);
    setMsg(null);
    setErr(null);

    const workingDraft = sourceDraft ?? draft;

    try {
      const subscriptionPriceNum =
        workingDraft.subscription.price.trim() === ""
          ? null
          : Number(workingDraft.subscription.price);

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
        workingDraft.subscription.enabled &&
        (subscriptionPriceNum == null ||
          Number.isNaN(subscriptionPriceNum) ||
          subscriptionPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para la suscripción mensual.");
        return;
      }

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
        setErr("❌ Precio inválido para meet & greet digital.");
        return;
      }

      if (
        workingDraft.customClass.enabled &&
        (customClassPriceNum == null ||
          Number.isNaN(customClassPriceNum) ||
          customClassPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para clase personalizada.");
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
          "❌ Debes definir una duración válida en minutos para meet & greet."
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
          "❌ Debes definir una duración válida en minutos para la clase personalizada."
        );
        return;
      }

      const hasAnyAvailability =
        WEEKDAY_OPTIONS.some(
          (day) => workingDraft.customClass.availability[day.key].length > 0
        );

      if (workingDraft.customClass.enabled && !hasAnyAvailability) {
        setErr(
          "❌ Debes definir al menos un día y horario disponible para la clase personalizada."
        );
        return;
      }

      for (const day of WEEKDAY_OPTIONS) {
        const slots = workingDraft.customClass.availability[day.key];
        for (const slot of slots) {
          if (!slot.start || !slot.end) {
            setErr(
              `❌ Completa todos los horarios de ${day.label.toLowerCase()}.`
            );
            return;
          }

          const [startHour, startMinute] = slot.start.split(":").map(Number);
          const [endHour, endMinute] = slot.end.split(":").map(Number);

          const startTotal = startHour * 60 + startMinute;
          const endTotal = endHour * 60 + endMinute;

          if (startTotal >= endTotal) {
            setErr(
              `❌ En ${day.label.toLowerCase()} la hora inicial debe ser menor a la final.`
            );
            return;
          }
        }
      }

      if (isPublic && workingDraft.subscription.enabled) {
        setErr(
          "❌ Las comunidades públicas no pueden activar suscripción mensual."
        );
        return;
      }

      const savedWasSubscriptionEnabled = savedDraft.subscription.enabled;
      const localWillEnableSubscription =
        !savedWasSubscriptionEnabled &&
        workingDraft.subscription.enabled &&
        !isPublic;
      const localWillDisableSubscription =
        savedWasSubscriptionEnabled && !workingDraft.subscription.enabled;

      const savedPrevSubscriptionPrice =
        savedDraft.subscription.price.trim() === ""
          ? null
          : Number(savedDraft.subscription.price);

      const localNextSubscriptionPrice =
        workingDraft.subscription.price.trim() === ""
          ? null
          : Number(workingDraft.subscription.price);

      const localWillIncreaseSubscriptionPrice =
        !isPublic &&
        savedWasSubscriptionEnabled &&
        workingDraft.subscription.enabled &&
        savedDraft.subscription.currency === workingDraft.subscription.currency &&
        savedPrevSubscriptionPrice != null &&
        localNextSubscriptionPrice != null &&
        !Number.isNaN(savedPrevSubscriptionPrice) &&
        !Number.isNaN(localNextSubscriptionPrice) &&
        localNextSubscriptionPrice > savedPrevSubscriptionPrice;

      if (localWillEnableSubscription && !workingDraft.freeToSubscriptionPolicy) {
        setErr(
          "❌ Debes definir qué pasa con los miembros actuales al cambiar de gratis a suscripción."
        );
        return;
      }

      if (localWillDisableSubscription && !workingDraft.subscriptionToFreePolicy) {
        setErr(
          "❌ Debes definir qué pasa con los integrantes al cambiar de suscripción a gratis."
        );
        return;
      }

      if (
        localWillIncreaseSubscriptionPrice &&
        !workingDraft.subscriptionPriceIncreasePolicy
      ) {
        setErr(
          "❌ Debes definir qué pasa con los suscriptores actuales al subir el precio."
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
              availability: workingDraft.customClass.enabled
                ? workingDraft.customClass.availability
                : createEmptyWeeklyAvailability(),
            } as any,
          },
        }),
      ];

      const nextDonation: GroupDonationSettings = {
        mode: workingDraft.donationMode,
        enabled: workingDraft.donationMode !== "none",
        visible: workingDraft.donationMode !== "none",
        currency:
          workingDraft.donationMode !== "none" ? workingDraft.donationCurrency : "MXN",
        sourceScope: "group",
        suggestedAmounts:
          workingDraft.donationMode !== "none" && donationMinimumNum != null
            ? [donationMinimumNum]
            : [],
        goalLabel:
          workingDraft.donationMode === "wedding"
            ? workingDraft.donationGoalLabel.trim() || null
            : null,
      };

      const preservedPaidPostsEnabled =
        typeof currentMonetization?.paidPostsEnabled === "boolean"
          ? currentMonetization.paidPostsEnabled
          : false;

      const preservedPaidLivesEnabled =
        typeof currentMonetization?.paidLivesEnabled === "boolean"
          ? currentMonetization.paidLivesEnabled
          : false;

      const preservedPaidVodEnabled =
        typeof currentMonetization?.paidVodEnabled === "boolean"
          ? currentMonetization.paidVodEnabled
          : false;

      const preservedPaidLiveCommentsEnabled =
        typeof currentMonetization?.paidLiveCommentsEnabled === "boolean"
          ? currentMonetization.paidLiveCommentsEnabled
          : false;

      const isTransitioningSubscriptionModel =
        localWillEnableSubscription ||
        localWillDisableSubscription ||
        localWillIncreaseSubscriptionPrice;

      const nextTransitions = {
        freeToSubscriptionPolicy:
          localWillEnableSubscription && workingDraft.freeToSubscriptionPolicy
            ? workingDraft.freeToSubscriptionPolicy
            : currentMonetization?.transitions?.freeToSubscriptionPolicy ?? null,
        subscriptionToFreePolicy:
          localWillDisableSubscription && workingDraft.subscriptionToFreePolicy
            ? workingDraft.subscriptionToFreePolicy
            : currentMonetization?.transitions?.subscriptionToFreePolicy ?? null,
        subscriptionPriceIncreasePolicy:
          localWillIncreaseSubscriptionPrice &&
          workingDraft.subscriptionPriceIncreasePolicy
            ? workingDraft.subscriptionPriceIncreasePolicy
            : currentMonetization?.transitions?.subscriptionPriceIncreasePolicy ??
              null,
        previousSubscriptionPriceMonthly: localWillIncreaseSubscriptionPrice
          ? savedPrevSubscriptionPrice
          : currentMonetization?.transitions?.previousSubscriptionPriceMonthly ??
            null,
        nextSubscriptionPriceMonthly: localWillIncreaseSubscriptionPrice
          ? localNextSubscriptionPrice
          : currentMonetization?.transitions?.nextSubscriptionPriceMonthly ??
            null,
        subscriptionPriceChangeCurrency: localWillIncreaseSubscriptionPrice
          ? workingDraft.subscription.currency
          : currentMonetization?.transitions?.subscriptionPriceChangeCurrency ??
            null,
        lastMonetizationChangeAt: isTransitioningSubscriptionModel
          ? Date.now()
          : currentMonetization?.transitions?.lastMonetizationChangeAt ?? null,
        lastMonetizationChangeBy: isTransitioningSubscriptionModel
          ? currentUserId
          : currentMonetization?.transitions?.lastMonetizationChangeBy ?? null,
      };

      const nextMonetization = {
        isPaid: isPublic ? false : workingDraft.subscription.enabled,
        priceMonthly:
          isPublic || !workingDraft.subscription.enabled ? null : subscriptionPriceNum,
        currency:
          isPublic || !workingDraft.subscription.enabled
            ? null
            : workingDraft.subscription.currency,

        subscriptionsEnabled: isPublic ? false : workingDraft.subscription.enabled,
        subscriptionPriceMonthly:
          isPublic || !workingDraft.subscription.enabled ? null : subscriptionPriceNum,
        subscriptionCurrency:
          isPublic || !workingDraft.subscription.enabled
            ? null
            : workingDraft.subscription.currency,

        paidPostsEnabled: preservedPaidPostsEnabled,
        paidLivesEnabled: preservedPaidLivesEnabled,
        paidVodEnabled: preservedPaidVodEnabled,
        paidLiveCommentsEnabled: preservedPaidLiveCommentsEnabled,

        greetingsEnabled: workingDraft.saludo.enabled,
        adviceEnabled: workingDraft.consejo.enabled,
        customClassEnabled: workingDraft.customClass.enabled,
        digitalMeetGreetEnabled: workingDraft.meetGreet.enabled,

        transitions: nextTransitions,
      };

      const commerce = buildNormalizedGroupCommerceState({
        offerings: nextOfferings,
        monetization: nextMonetization,
        donation: nextDonation,
        legacyGreetingsEnabled: workingDraft.saludo.enabled,
        currency:
          (!isPublic && workingDraft.subscription.enabled
            ? workingDraft.subscription.currency
            : workingDraft.saludo.currency) ?? "MXN",
      });

      skipHydrationWhileSavingRef.current = true;

      await updateDoc(doc(db, "groups", groupId), {
        monetization: {
          ...commerce.monetization,
          transitions: nextTransitions,
        },
        offerings: commerce.offerings,
        donation: commerce.donation,
        greetingsEnabled: commerce.monetization.greetingsEnabled,
      });

      let successMessage =
        "✅ Configuración de suscripción, catálogo y donación guardados.";

      if (isTransitioningSubscriptionModel) {
        try {
          const transitionResponse = await applyGroupSubscriptionTransition({
            groupId,
            nextSubscriptionEnabled: !isPublic && workingDraft.subscription.enabled,
            freeToSubscriptionPolicy:
              localWillEnableSubscription && workingDraft.freeToSubscriptionPolicy
                ? workingDraft.freeToSubscriptionPolicy
                : undefined,
            subscriptionToFreePolicy:
              localWillDisableSubscription && workingDraft.subscriptionToFreePolicy
                ? workingDraft.subscriptionToFreePolicy
                : undefined,
            subscriptionPriceIncreasePolicy:
              localWillIncreaseSubscriptionPrice &&
              workingDraft.subscriptionPriceIncreasePolicy
                ? workingDraft.subscriptionPriceIncreasePolicy
                : undefined,
            previousSubscriptionPriceMonthly:
              localWillIncreaseSubscriptionPrice
                ? savedPrevSubscriptionPrice
                : undefined,
            nextSubscriptionPriceMonthly:
              localWillIncreaseSubscriptionPrice
                ? localNextSubscriptionPrice
                : undefined,
            subscriptionPriceChangeCurrency:
              localWillIncreaseSubscriptionPrice
                ? workingDraft.subscription.currency
                : undefined,
          });

          successMessage = buildTransitionSuccessMessage(transitionResponse);
        } catch (transitionError: any) {
          const transitionMessage =
            transitionError?.message ??
            "La transición de miembros no pudo completarse.";

          const nextSavedAfterPartialSuccess: ServiceDraft = {
            subscription: {
              enabled: isPublic ? false : workingDraft.subscription.enabled,
              price:
                isPublic || !workingDraft.subscription.enabled
                  ? ""
                  : workingDraft.subscription.price,
              currency:
                isPublic || !workingDraft.subscription.enabled
                  ? "MXN"
                  : workingDraft.subscription.currency,
            },
            saludo: {
              ...workingDraft.saludo,
              price: workingDraft.saludo.enabled ? workingDraft.saludo.price : "",
              visible: workingDraft.saludo.enabled ? workingDraft.saludo.visible : false,
              visibility: "members",
            },
            consejo: {
              ...workingDraft.consejo,
              price: workingDraft.consejo.enabled ? workingDraft.consejo.price : "",
              visible: workingDraft.consejo.enabled ? workingDraft.consejo.visible : false,
              visibility: "members",
            },
            meetGreet: {
              ...workingDraft.meetGreet,
              price: workingDraft.meetGreet.enabled ? workingDraft.meetGreet.price : "",
              visible: workingDraft.meetGreet.enabled ? workingDraft.meetGreet.visible : false,
              visibility: "members",
              durationMinutes: workingDraft.meetGreet.enabled
                ? workingDraft.meetGreet.durationMinutes
                : "",
            },
            customClass: {
              ...workingDraft.customClass,
              price: workingDraft.customClass.enabled ? workingDraft.customClass.price : "",
              visible: workingDraft.customClass.enabled
                ? workingDraft.customClass.visible
                : false,
              visibility: "members",
              durationMinutes: workingDraft.customClass.enabled
                ? workingDraft.customClass.durationMinutes
                : "",
              availability: workingDraft.customClass.enabled
                ? workingDraft.customClass.availability
                : createEmptyWeeklyAvailability(),
            },
            donationMode: workingDraft.donationMode,
            donationCurrency:
              workingDraft.donationMode !== "none" ? workingDraft.donationCurrency : "MXN",
            donationMinimumAmount:
              workingDraft.donationMode !== "none"
                ? workingDraft.donationMinimumAmount
                : "",
            donationGoalLabel:
              workingDraft.donationMode === "wedding"
                ? workingDraft.donationGoalLabel
                : "",
            freeToSubscriptionPolicy: workingDraft.freeToSubscriptionPolicy,
            subscriptionToFreePolicy: workingDraft.subscriptionToFreePolicy,
            subscriptionPriceIncreasePolicy:
              workingDraft.subscriptionPriceIncreasePolicy,
          };

          setDraft(nextSavedAfterPartialSuccess);
          setSavedDraft(nextSavedAfterPartialSuccess);
          setErr(
            `⚠️ La configuración del grupo sí se guardó, pero la transición de miembros no terminó correctamente: ${transitionMessage}`
          );
          return;
        }
      }

      const nextSaved: ServiceDraft = {
        subscription: {
          enabled: isPublic ? false : workingDraft.subscription.enabled,
          price:
            isPublic || !workingDraft.subscription.enabled
              ? ""
              : workingDraft.subscription.price,
          currency:
            isPublic || !workingDraft.subscription.enabled
              ? "MXN"
              : workingDraft.subscription.currency,
        },
        saludo: {
          ...workingDraft.saludo,
          price: workingDraft.saludo.enabled ? workingDraft.saludo.price : "",
          visible: workingDraft.saludo.enabled ? workingDraft.saludo.visible : false,
          visibility: "members",
        },
        consejo: {
          ...workingDraft.consejo,
          price: workingDraft.consejo.enabled ? workingDraft.consejo.price : "",
          visible: workingDraft.consejo.enabled ? workingDraft.consejo.visible : false,
          visibility: "members",
        },
        meetGreet: {
          ...workingDraft.meetGreet,
          price: workingDraft.meetGreet.enabled ? workingDraft.meetGreet.price : "",
          visible: workingDraft.meetGreet.enabled ? workingDraft.meetGreet.visible : false,
          visibility: "members",
          durationMinutes: workingDraft.meetGreet.enabled
            ? workingDraft.meetGreet.durationMinutes
            : "",
        },
        customClass: {
          ...workingDraft.customClass,
          price: workingDraft.customClass.enabled ? workingDraft.customClass.price : "",
          visible: workingDraft.customClass.enabled ? workingDraft.customClass.visible : false,
          visibility: "members",
          durationMinutes: workingDraft.customClass.enabled
            ? workingDraft.customClass.durationMinutes
            : "",
          availability: workingDraft.customClass.enabled
            ? workingDraft.customClass.availability
            : createEmptyWeeklyAvailability(),
        },
        donationMode: workingDraft.donationMode,
        donationCurrency:
          workingDraft.donationMode !== "none" ? workingDraft.donationCurrency : "MXN",
        donationMinimumAmount:
          workingDraft.donationMode !== "none" ? workingDraft.donationMinimumAmount : "",
        donationGoalLabel:
          workingDraft.donationMode === "wedding" ? workingDraft.donationGoalLabel : "",
        freeToSubscriptionPolicy: workingDraft.freeToSubscriptionPolicy,
        subscriptionToFreePolicy: workingDraft.subscriptionToFreePolicy,
        subscriptionPriceIncreasePolicy:
          workingDraft.subscriptionPriceIncreasePolicy,
      };

      setDraft(nextSaved);
      setSavedDraft(nextSaved);
      setMsg(successMessage);
    } catch (e: any) {
      setErr(e?.message ?? "❌ No se pudieron guardar los servicios.");
    } finally {
      skipHydrationWhileSavingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div style={contentStyle}>
      <Subscription
        draft={draft}
        savedDraft={savedDraft}
        isPublic={isPublic}
        saving={saving}
        removingLegacyMembers={removingLegacyMembers}
        activeLegacyFreeMembersCount={activeLegacyFreeMembersCount}
        canRemoveLegacyFreeMembersLater={canRemoveLegacyFreeMembersLater}
        subscriptionEmoji={SERVICE_EMOJIS.subscription}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        ConfirmModalComponent={ConfirmModal}
        SpinningGearComponent={SpinningGear}
        onSaveDraft={saveServicesFromDraft}
       onRemoveLegacyMembers={handleConfirmRemoveLegacyFreeMembersLater}
      />

      <Greetings
        draft={draft}
        saving={saving}
        saludoEmoji={SERVICE_EMOJIS.saludo}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={saveServicesFromDraft}
      />

      <Advice
        draft={draft}
        saving={saving}
        consejoEmoji={SERVICE_EMOJIS.consejo}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={saveServicesFromDraft}
      />

      <MeetGreet
        draft={draft}
        saving={saving}
        meetGreetEmoji={SERVICE_EMOJIS.meetGreet}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        onSaveDraft={saveServicesFromDraft}
      />

      <CustomClass
        draft={draft}
        saving={saving}
        customClassEmoji={SERVICE_EMOJIS.customClass}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        SwitchComponent={Switch}
        OverlayModalComponent={OverlayModal}
        TimeSelectRowComponent={TimeSelectRow}
        weekdayOptions={WEEKDAY_OPTIONS}
        createEmptyWeeklyAvailability={createEmptyWeeklyAvailability}
        onSaveDraft={saveServicesFromDraft}
      />

      <Donation
        draft={draft}
        savedDraft={savedDraft}
        saving={saving}
        removingLegacyMembers={removingLegacyMembers}
        donationEmoji={SERVICE_EMOJIS.donation}
        panelStyle={panelStyle}
        titleStyle={titleStyle}
        subtleStyle={subtleStyle}
        inputStyle={inputStyle}
        buttonSecondaryStyle={buttonSecondaryStyle}
        calcNetAmount={calcNetAmount}
        formatMoney={formatMoney}
        OverlayModalComponent={OverlayModal}
        DonationModeButtonComponent={DonationModeButton}
        onSaveDraft={saveServicesFromDraft}
      />

      {err && <div style={noticeStyle}>{err}</div>}
      {msg && <div style={noticeStyle}>{msg}</div>}
    </div>
  );
}