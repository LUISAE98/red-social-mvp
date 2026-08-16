"use client";

// Fachada de ProfileServicesTab.
//
// Ya casi no contiene lógica propia: el modelo de borrador se comparte con el
// panel de comunidad (lib/services/serviceDraft) y los primitivos visuales con
// el kit (components/services/config/serviceConfigKit). Lo que queda aquí son
// los re-exports que mantienen estable la API para ProfileServicesTab, y los
// tres envoltorios atados a la superficie "profile".

import {
  buildOffering as buildOfferingShared,
  createEmptyDraft as createEmptyDraftShared,
  pickOffering as pickOfferingShared,
  type DonationInput,
  type OfferingInput,
  type ServiceBlockDraft as ServiceBlockDraftShared,
  type ServiceDraft as ServiceDraftShared,
} from "@/lib/services/serviceDraft";

import type {
  CreatorServiceMeta,
  CreatorServiceType,
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

// OfferingInput y DonationInput viven en lib/services/serviceDraft.
export type { OfferingInput, DonationInput } from "@/lib/services/serviceDraft";

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

// ─── Modelo de borrador ──────────────────────────────────────────────────
//
// Los tipos y las funciones viven en lib/services/serviceDraft, compartidos con
// el panel de comunidad. Aquí solo se atan a la superficie "profile" las tres
// funciones cuyo comportamiento difiere entre perfil y comunidad, para que los
// consumidores de este parts sigan llamándolas igual que siempre.

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

/** Un perfil no tiene miembros: sus servicios nacen públicos. */
export function createEmptyDraft(): ServiceDraftShared {
  return createEmptyDraftShared("profile");
}

/** El perfil vende a cualquiera, así que su precio de referencia es el público. */
export function pickOffering(
  offerings: OfferingInput[] | null | undefined,
  type: CreatorServiceType
) {
  return pickOfferingShared("profile", offerings, type);
}

/** Guarda con las reglas del perfil: sourceScope propio y visibilidad public/hidden. */
export function buildOffering(params: {
  type: CreatorServiceType;
  draft: ServiceBlockDraftShared;
  displayOrder: number;
  meta?: CreatorServiceMeta | null;
}): GroupOffering {
  return buildOfferingShared({ ...params, surface: "profile" });
}


