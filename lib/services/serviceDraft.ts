/**
 * Modelo de borrador de la configuración de experiencias.
 *
 * Sin "use client" a propósito: aquí no hay React ni acceso al navegador, solo
 * tipos y funciones puras. Así se puede probar sin montar nada.
 *
 * Lo comparten los DOS paneles que configuran servicios: el del perfil
 * (`ProfileServicesTab`) y el de la comunidad (`OwnerAdminServices`). Antes vivía
 * duplicado carácter por carácter en los `.parts` de cada uno, con el riesgo
 * evidente: es lógica de dinero —precios, monedas, visibilidad de servicios de
 * pago— y dos copias divergen en cuanto alguien arregla un lado y olvida el otro.
 *
 * 🚨 PERFIL Y COMUNIDAD NO SON IGUALES 🚨
 * Al fusionar aparecieron tres diferencias que NO son copia-pega descuidado, sino
 * reglas distintas de verdad. Todas nacen del mismo hecho: una comunidad tiene
 * miembros y un perfil no. Se modelan con el eje `ServiceSurface` en vez de
 * quedar implícitas en dos archivos:
 *
 *   1. Visibilidad por omisión — perfil "public", comunidad "members".
 *   2. Precedencia de precio al leer — perfil mira `publicPrice` primero;
 *      comunidad, `memberPrice`.
 *   3. Al guardar — el perfil DESCARTA la visibilidad elegida y escribe
 *      "public"/"hidden" según esté activo, porque no hay a quién restringir;
 *      la comunidad la respeta. Y el perfil fuerza `visible: false` cuando el
 *      servicio está apagado, cosa que la comunidad no hace.
 *
 * Cambiar cualquiera de esas tres cosas cambia lo que se escribe en Firestore.
 */

import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  DonationMode,
  GroupDonationSettings,
  GroupOffering,
} from "@/types/group";
import { WALLET_NET_RATE } from "@/lib/wallet/walletRates";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";

/** Los cuatro montos sugeridos de donación por omisión. 💵 En USD desde el corte a Vibra On, LLC. */
export const DEFAULT_DONATION_SUGGESTED_AMOUNTS: string[] = [
  "3",
  "7",
  "15",
  "30",
];

/**
 * Normaliza cualquier entrada a EXACTAMENTE 4 montos (string): usa el valor
 * guardado si es un número válido (> 0), o el default de esa posición.
 */
export function normalizeSuggestedAmounts(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  return DEFAULT_DONATION_SUGGESTED_AMOUNTS.map((def, i) => {
    const n = Number(arr[i]);
    return Number.isFinite(n) && n > 0 ? String(n) : def;
  });
}

/** Dónde se está configurando. Decide las tres reglas divergentes de arriba. */
export type ServiceSurface = "profile" | "community";

export type EditableServiceVisibility = "public" | "members";

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

/**
 * Lo que llega guardado de Firestore. Deliberadamente laxo: son datos que
 * pueden venir de versiones anteriores del esquema, con campos ausentes o de
 * otro tipo. Es la misma forma que usaban los dos paneles antes de fusionarse.
 */
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

export type FreeToSubscriptionPolicy =
  | "legacy_free"
  | "require_subscription"
  | "";
export type SubscriptionToFreePolicy =
  | "keep_members_free"
  | "remove_all_members"
  | "";
export type SubscriptionPriceIncreasePolicy =
  | "keep_legacy_price"
  | "require_resubscribe_new_price"
  | "";

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

/** Visibilidad con la que nace un servicio recién creado, según la superficie. */
function defaultVisibility(surface: ServiceSurface): EditableServiceVisibility {
  return surface === "community" ? "members" : "public";
}

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

export function createEmptyDraft(surface: ServiceSurface): ServiceDraft {
  const visibility = defaultVisibility(surface);

  const emptyBlock = (): ServiceBlockDraft => ({
    enabled: false,
    price: "",
    currency: SETTLEMENT_CURRENCY,
    visible: false,
    visibility,
  });

  return {
    subscription: { enabled: false, price: "", currency: SETTLEMENT_CURRENCY },
    saludo: emptyBlock(),
    consejo: emptyBlock(),
    meetGreet: { ...emptyBlock(), durationMinutes: "" },
    customClass: {
      ...emptyBlock(),
      durationMinutes: "",
      availability: createEmptyWeeklyAvailability(),
    },
    donationMode: "none",
    donationCurrency: SETTLEMENT_CURRENCY,
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
  surface: ServiceSurface,
  offerings: OfferingInput[] | null | undefined,
  type: CreatorServiceType
) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === type);

  // La comunidad cobra a miembros, así que su precio de referencia es el de
  // miembro; el perfil vende a cualquiera y mira primero el público.
  const resolvedPrice =
    surface === "community"
      ? (found?.memberPrice ?? found?.publicPrice ?? found?.price ?? null)
      : (found?.publicPrice ?? found?.memberPrice ?? found?.price ?? null);

  return {
    enabled: found?.enabled === true,
    price: resolvedPrice,
    currency: (found?.currency ?? SETTLEMENT_CURRENCY) as Currency,
    visible:
      typeof found?.visible === "boolean"
        ? found.visible
        : found?.enabled === true,
    visibility:
      found?.visibility === "members" || found?.visibility === "public"
        ? found.visibility
        : "public",
    meta: found?.meta ?? null,
  };
}

export function pickDonation(donation: DonationInput) {
  const mode: DonationMode =
    donation?.mode === "general" || donation?.mode === "wedding"
      ? donation.mode
      : "none";

  return {
    mode,
    currency: (donation?.currency ?? SETTLEMENT_CURRENCY) as Currency,
    suggestedAmounts: normalizeSuggestedAmounts(donation?.suggestedAmounts),
    goalLabel: typeof donation?.goalLabel === "string" ? donation.goalLabel : "",
    message: typeof donation?.message === "string" ? donation.message : "",
    videoUrl: typeof donation?.videoUrl === "string" ? donation.videoUrl : "",
    playbackId:
      typeof donation?.playbackId === "string" ? donation.playbackId : "",
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
  surface: ServiceSurface;
  type: CreatorServiceType;
  draft: ServiceBlockDraft;
  displayOrder: number;
  meta?: CreatorServiceMeta | null;
}): GroupOffering {
  const { surface, type, draft, displayOrder, meta = null } = params;

  const priceNum = draft.price.trim() === "" ? null : Number(draft.price);
  const isProfile = surface === "profile";

  return {
    type,
    enabled: draft.enabled,
    // El perfil apaga la vitrina junto con el servicio; la comunidad conserva
    // la marca de "visible" aunque el servicio esté desactivado.
    visible: isProfile ? (draft.enabled ? draft.visible : false) : draft.visible,
    // Un perfil no tiene miembros: la elección public/members no significa nada
    // ahí, y se traduce a "se ve" o "no se ve".
    visibility: isProfile
      ? draft.enabled
        ? "public"
        : "hidden"
      : draft.visibility,
    displayOrder,
    memberPrice: draft.enabled ? priceNum : null,
    publicPrice: draft.enabled ? priceNum : null,
    // La moneda de liquidación es MXN (Mexico-first). Los precios se guardan
    // SIEMPRE en MXN — nunca en el ancla USD legacy (evita el bug del
    // ×tipo-de-cambio).
    currency: draft.enabled ? SETTLEMENT_CURRENCY : null,
    requiresApproval: true,
    sourceScope: isProfile ? "profile" : "group",
    meta,
    price: draft.enabled ? priceNum : null,
  };
}

/** Los siete días, en orden. La clave es la del borrador; la etiqueta se traduce aparte. */
export const WEEKDAY_KEYS: Array<keyof WeeklyAvailabilityDraft> = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/**
 * Comparadores de borrador.
 *
 * Sirven para UNA cosa concreta: cuando llega un snapshot de Firestore mientras
 * el creador está editando, decidir si se puede refrescar el formulario o si
 * hay cambios sin guardar que no deben pisarse. Sin esto, escribir un precio y
 * que entre un snapshot a medias te borra lo tecleado.
 *
 * Se comparan campo a campo en vez de con JSON.stringify porque el orden de las
 * claves no está garantizado y daría falsos "cambió" que reiniciarían el
 * formulario sin motivo.
 */
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
  return a.enabled === b.enabled && a.price === b.price && a.currency === b.currency;
}

export function sameWeeklyAvailability(
  a: WeeklyAvailabilityDraft,
  b: WeeklyAvailabilityDraft
) {
  return WEEKDAY_KEYS.every((key) => {
    const aSlots = a[key];
    const bSlots = b[key];
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

export function calcNetAmount(raw: string) {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return null;
  const net = n * WALLET_NET_RATE;
  return { gross: n, net };
}
