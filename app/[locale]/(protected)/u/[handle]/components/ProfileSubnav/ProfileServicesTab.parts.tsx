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
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import type { DisplayCurrency } from "@/lib/currency/catalog";

import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  DonationMode,
  GroupDonationSettings,
  GroupOffering,
} from "@/types/group";

// El kit visual (OverlayModal rico, variantes, Switch, colores, constantes,
// helpers de montos) vive ahora en components/services/config para compartirlo
// con la comunidad. Se importa aquí (para uso interno) y se re-exporta (para los
// consumidores actuales de este parts, que no cambian).
import {
  useLockBodyScroll,
  useCloseOnEscape,
  Switch,
  DonationModeButton,
  OverlayModal,
  makeOverlayWithBg,
  SaludoOverlay,
  ConsejoOverlay,
  MeetGreetOverlay,
  CustomClassOverlay,
  DonationOverlay,
  SERVICE_EMOJIS,
  SERVICE_COLORS,
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  normalizeSuggestedAmounts,
  MEET_GREET_MIN_MINUTES,
  MEET_GREET_MAX_MINUTES,
  CUSTOM_CLASS_MIN_MINUTES,
  CUSTOM_CLASS_MAX_MINUTES,
} from "@/components/services/config/serviceConfigKit";

export {
  useLockBodyScroll,
  useCloseOnEscape,
  Switch,
  DonationModeButton,
  OverlayModal,
  makeOverlayWithBg,
  SaludoOverlay,
  ConsejoOverlay,
  MeetGreetOverlay,
  CustomClassOverlay,
  DonationOverlay,
  SERVICE_EMOJIS,
  SERVICE_COLORS,
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  normalizeSuggestedAmounts,
  MEET_GREET_MIN_MINUTES,
  MEET_GREET_MAX_MINUTES,
  CUSTOM_CLASS_MIN_MINUTES,
  CUSTOM_CLASS_MAX_MINUTES,
};

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
  donationSuggestedAmounts: string[];
  donationGoalLabel: string;
  donationMessage: string;
  donationVideoUrl: string;
  donationPlaybackId: string;
  freeToSubscriptionPolicy: FreeToSubscriptionPolicy;
  subscriptionToFreePolicy: SubscriptionToFreePolicy;
  subscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy;
};


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
    donationSuggestedAmounts: [...DEFAULT_DONATION_SUGGESTED_AMOUNTS],
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

  const suggestedAmounts = normalizeSuggestedAmounts(donation?.suggestedAmounts);

  return {
    mode,
    currency: (donation?.currency ?? "MXN") as Currency,
    suggestedAmounts,
    goalLabel: typeof donation?.goalLabel === "string" ? donation.goalLabel : "",
    message: typeof donation?.message === "string" ? donation.message : "",
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
    // La moneda de liquidación es MXN (Mexico-first). Los precios de perfil se guardan
    // SIEMPRE en MXN — nunca en el ancla USD legacy (evita el bug del ×tipo-de-cambio).
    currency: params.draft.enabled ? "MXN" : null,
    requiresApproval: true,
    sourceScope: "profile",
    meta: params.meta ?? null,
    price: params.draft.enabled ? priceNum : null,
  };
}

export function calcNetAmount(raw: string) {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return null;
  const net = n * WALLET_NET_RATE;
  return { gross: n, net };
}


