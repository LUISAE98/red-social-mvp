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
  type ServiceBlockDraft as ServiceBlockDraftShared,
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
  sameDraft,
  sameServiceBlock,
  sameSubscriptionBlock,
  sameWeeklyAvailability,
  pickDonation,
  normalizeDurationMeta,
  buildServiceBlockDraft,
  calcNetAmount,
} from "@/lib/services/serviceDraft";

// Primitivos visuales y de datos: viven en el kit compartido y en
// lib/services/serviceDraft. Se reexportan para que OwnerAdminServices y sus
// modales sigan importándolos desde este parts, como siempre.
//
// El Switch local se eliminó sin sustituto: nadie lo importaba. El panel usa
// el del kit (RichSwitch) desde hace tiempo, así que era código muerto.
export {
  DonationModeButton,
  SERVICE_EMOJIS,
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  normalizeSuggestedAmounts,
} from "@/components/services/config/serviceConfigKit";

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

