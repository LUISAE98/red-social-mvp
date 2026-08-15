"use client";

// Tipos, helpers y sub-componentes (SpinningGear, Switch, DonationModeButton) de OwnerAdminServices.

import React from "react";
import type {
  Currency,
  GroupOffering,
  CreatorServiceType,
  CreatorServiceMeta,
} from "@/types/group";


// ─── Modelo de borrador ──────────────────────────────────────────────────
//
// Los tipos y las funciones viven en lib/services/serviceDraft, compartidos con
// el panel del perfil. Aquí solo se atan a la superficie "community" las tres
// funciones cuyo comportamiento difiere, para que los consumidores de este
// parts sigan llamándolas igual que siempre.
import {
  buildOffering as buildOfferingShared,
  createEmptyDraft as createEmptyDraftShared,
  createEmptyWeeklyAvailability,
  pickOffering as pickOfferingShared,
  type AvailabilitySlotDraft,
  type DonationInput,
  type FreeToSubscriptionPolicy,
  type SubscriptionPriceIncreasePolicy,
  type SubscriptionToFreePolicy,
  type OfferingInput,
  type ServiceBlockDraft,
  type ServiceBlockDraft as ServiceBlockDraftShared,
  type ServiceDraft,
  type ServiceDraft as ServiceDraftShared,
  type SubscriptionDraft,
  type WeeklyAvailabilityDraft,
} from "@/lib/services/serviceDraft";

export type {
  EditableServiceVisibility,
  FreeToSubscriptionPolicy,
  SubscriptionToFreePolicy,
  SubscriptionPriceIncreasePolicy,
  ServiceBlockDraft,
  SubscriptionDraft,
  MeetGreetDraft,
  AvailabilitySlotDraft,
  WeeklyAvailabilityDraft,
  CustomClassDraft,
  ServiceDraft,
  OfferingInput,
  DonationInput,
} from "@/lib/services/serviceDraft";

export {
  createEmptyWeeklyAvailability,
  pickDonation,
  normalizeDurationMeta,
  buildServiceBlockDraft,
  calcNetAmount,
} from "@/lib/services/serviceDraft";

/** Una comunidad tiene miembros: sus servicios nacen restringidos a ellos. */
export function createEmptyDraft(): ServiceDraftShared {
  return createEmptyDraftShared("community");
}

/** La comunidad cobra a miembros: su precio de referencia es el de miembro. */
export function pickOffering(
  offerings: OfferingInput[] | null | undefined,
  type: CreatorServiceType
) {
  return pickOfferingShared("community", offerings, type);
}

/** Guarda con las reglas de comunidad: respeta la visibilidad elegida. */
export function buildOffering(params: {
  type: CreatorServiceType;
  draft: ServiceBlockDraftShared;
  displayOrder: number;
  meta?: CreatorServiceMeta | null;
}): GroupOffering {
  return buildOfferingShared({ ...params, surface: "community" });
}

export type Visibility = "public" | "private" | "hidden" | string | null;


export type MonetizationTransitionsInput =
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

export type MonetizationInput =
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


export type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;
  currentVisibility?: Visibility;
  currentMonetization?: MonetizationInput;
  currentOfferings?: OfferingInput[] | null;
  currentDonation?: DonationInput;
  /** Cambia la visibilidad del grupo (privada ⇄ pública) desde la card de suscripción. */
  onChangeVisibility?: (next: "public" | "private") => Promise<void>;
};









export const WEEKDAY_OPTIONS: Array<{
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

// Montos sugeridos de donación por defecto (MXN crudo). Cada uno debe ser >= 50.
export const DEFAULT_DONATION_SUGGESTED_AMOUNTS: string[] = ["50", "120", "250", "490"];

// Normaliza cualquier entrada a EXACTAMENTE 4 montos (string): usa el valor
// guardado si es un número válido (> 0), o el default de esa posición.
export function normalizeSuggestedAmounts(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  return DEFAULT_DONATION_SUGGESTED_AMOUNTS.map((def, i) => {
    const n = Number(arr[i]);
    return Number.isFinite(n) && n > 0 ? String(n) : def;
  });
}

export const SERVICE_EMOJIS = {
  subscription: "💎",
  saludo: "👋",
  consejo: "💡",
  meetGreet: "🤝",
  customClass: "👑",
  donation: "🎁",
};


export function isValidTimeValue(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function normalizeWeeklyAvailabilityFromMeta(
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

export function pickSubscription(monetization: MonetizationInput) {
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

export function pickTransitions(monetization: MonetizationInput): {
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






export function buildSubscriptionDraft(input: {
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


export function SpinningGear() {
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

export function Switch({
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

export function sameServiceBlock(a: ServiceBlockDraft, b: ServiceBlockDraft) {
  return (
    a.enabled === b.enabled &&
    a.price === b.price &&
    a.currency === b.currency &&
    a.visible === b.visible &&
    a.visibility === b.visibility
  );
}

export function sameSubscriptionBlock(a: SubscriptionDraft, b: SubscriptionDraft) {
  return (
    a.enabled === b.enabled &&
    a.price === b.price &&
    a.currency === b.currency
  );
}

export function sameWeeklyAvailability(
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

export function sameDraft(a: ServiceDraft, b: ServiceDraft) {
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
    a.donationSuggestedAmounts.join(",") === b.donationSuggestedAmounts.join(",") &&
    a.donationGoalLabel === b.donationGoalLabel &&
    a.donationMessage === b.donationMessage &&
    a.donationVideoUrl === b.donationVideoUrl &&
    a.donationPlaybackId === b.donationPlaybackId &&
    a.freeToSubscriptionPolicy === b.freeToSubscriptionPolicy &&
    a.subscriptionToFreePolicy === b.subscriptionToFreePolicy &&
    a.subscriptionPriceIncreasePolicy === b.subscriptionPriceIncreasePolicy
  );
}


export function buildTransitionSuccessMessage(params: {
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

export function buildManualLegacyRemovalSuccessMessage(params: {
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

