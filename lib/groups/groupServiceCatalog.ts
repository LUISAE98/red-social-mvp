import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  CustomClassWeeklyAvailability,
  GroupDonationSettings,
  GroupMonetizationSettings,
  GroupOffering,
  GroupServiceCatalog,
  ServiceSourceScope,
  ServiceVisibility,
  WeeklyAvailabilityDay,
  WeeklyAvailabilitySlot,
} from "@/types/group";

type PartialMonetization = Partial<GroupMonetizationSettings> | null | undefined;
type PartialDonation = Partial<GroupDonationSettings> | null | undefined;
type PartialOffering = Partial<GroupOffering> | null | undefined;

const DEFAULT_CURRENCY: Currency = "MXN";

const DEFAULT_SERVICE_ORDER: Record<CreatorServiceType, number> = {
  saludo: 1,
  consejo: 2,
  meet_greet_digital: 3,
  clase_personalizada: 4,
  mensaje: 99,
};

const ALL_SUPPORTED_SERVICE_TYPES: CreatorServiceType[] = [
  "saludo",
  "consejo",
  "meet_greet_digital",
  "clase_personalizada",
  "mensaje",
];

const WEEKLY_AVAILABILITY_DAYS: WeeklyAvailabilityDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export function isValidCurrency(value: unknown): value is Currency {
  return value === "MXN" || value === "USD";
}

export function isValidServiceType(value: unknown): value is CreatorServiceType {
  return (
    typeof value === "string" &&
    ALL_SUPPORTED_SERVICE_TYPES.includes(value as CreatorServiceType)
  );
}

export function isValidServiceVisibility(
  value: unknown
): value is ServiceVisibility {
  return value === "hidden" || value === "members" || value === "public";
}

export function isValidServiceSourceScope(
  value: unknown
): value is ServiceSourceScope {
  return value === "group" || value === "profile" || value === "both";
}

export function normalizeNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizePositiveNullableNumber(value: unknown): number | null {
  const n = normalizeNullableNumber(value);
  if (n == null) return null;
  return n > 0 ? n : null;
}

export function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeDisplayOrder(
  value: unknown,
  fallback: number
): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

export function normalizeServiceVisibility(
  value: unknown,
  visibleFallback = false
): ServiceVisibility {
  if (isValidServiceVisibility(value)) return value;
  return visibleFallback ? "public" : "hidden";
}

export function normalizeServiceSourceScope(
  value: unknown,
  fallback: ServiceSourceScope = "group"
): ServiceSourceScope {
  if (isValidServiceSourceScope(value)) return value;
  return fallback;
}

export function getDefaultDisplayOrder(type: CreatorServiceType): number {
  return DEFAULT_SERVICE_ORDER[type];
}

function normalizeTimeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;

  return trimmed;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeWeeklyAvailabilitySlot(
  raw: unknown
): WeeklyAvailabilitySlot | null {
  const slot = (raw ?? {}) as Record<string, unknown>;

  const start = normalizeTimeString(slot.start);
  const end = normalizeTimeString(slot.end);

  if (!start || !end) return null;
  if (timeToMinutes(end) <= timeToMinutes(start)) return null;

  const enabled =
    typeof slot.enabled === "boolean" ? slot.enabled : true;

  return {
    start,
    end,
    enabled,
  };
}

function sortAndDeduplicateSlots(
  slots: WeeklyAvailabilitySlot[]
): WeeklyAvailabilitySlot[] {
  const sorted = [...slots].sort(
    (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)
  );

  const deduped: WeeklyAvailabilitySlot[] = [];
  const seen = new Set<string>();

  for (const slot of sorted) {
    const key = `${slot.start}-${slot.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(slot);
  }

  return deduped;
}

export function normalizeCustomClassAvailability(
  rawAvailability: unknown
): CustomClassWeeklyAvailability {
  const availability = (rawAvailability ?? {}) as Record<string, unknown>;
  const normalized: CustomClassWeeklyAvailability = {};

  for (const day of WEEKLY_AVAILABILITY_DAYS) {
    const rawDaySlots = Array.isArray(availability[day]) ? availability[day] : [];

    const normalizedSlots = sortAndDeduplicateSlots(
      rawDaySlots
        .map((slot) => normalizeWeeklyAvailabilitySlot(slot))
        .filter((slot): slot is WeeklyAvailabilitySlot => !!slot)
        .filter((slot) => slot.enabled !== false)
    );

    normalized[day] = normalizedSlots;
  }

  return normalized;
}

export function normalizeServiceMeta(
  type: CreatorServiceType,
  rawMeta: unknown
): CreatorServiceMeta | null {
  const meta = (rawMeta ?? {}) as Record<string, unknown>;

  if (type === "meet_greet_digital") {
    const meetGreet = (meta.meetGreet ?? {}) as Record<string, unknown>;
    const durationMinutes = normalizePositiveNullableNumber(
      meetGreet.durationMinutes
    );

    return {
      meetGreet: {
        durationMinutes,
      },
    };
  }

  if (type === "clase_personalizada") {
    const customClass = (meta.customClass ?? {}) as Record<string, unknown>;

    const durationMinutes = normalizePositiveNullableNumber(
      customClass.durationMinutes
    );

    const availability = normalizeCustomClassAvailability(
      customClass.availability
    );

    const bufferMinutes = normalizePositiveNullableNumber(
      customClass.bufferMinutes
    );

    const advanceBookingHours = normalizePositiveNullableNumber(
      customClass.advanceBookingHours
    );

    const maxBookingsPerDay = normalizePositiveNullableNumber(
      customClass.maxBookingsPerDay
    );

    return {
      customClass: {
        durationMinutes,
        availability,
        bufferMinutes,
        advanceBookingHours,
        maxBookingsPerDay,
      },
    };
  }

  return null;
}

function normalizePriceFields(raw: Record<string, unknown>) {
  const memberPrice = normalizePositiveNullableNumber(
    raw.memberPrice ?? raw.price ?? null
  );
  const publicPrice = normalizePositiveNullableNumber(raw.publicPrice ?? null);

  return {
    memberPrice,
    publicPrice,
    hasAnyPrice: memberPrice != null || publicPrice != null,
  };
}

export function normalizeSingleService(
  offering: PartialOffering,
  fallbackIndex = 0,
  fallbackSourceScope: ServiceSourceScope = "group"
): GroupOffering | null {
  const raw = (offering ?? {}) as Record<string, unknown>;
  const rawType = raw.type;

  if (rawType === "suscripcion") {
    return null;
  }

  if (!isValidServiceType(rawType)) {
    return null;
  }

  const type = rawType as CreatorServiceType;
  const enabled = normalizeBoolean(raw.enabled, false);
  const visible = typeof raw.visible === "boolean" ? raw.visible : enabled;

  const { memberPrice, publicPrice, hasAnyPrice } = normalizePriceFields(raw);

  let currency: Currency | null =
    raw.currency == null
      ? null
      : isValidCurrency(raw.currency)
        ? raw.currency
        : null;

  const requiresApproval =
    typeof raw.requiresApproval === "boolean"
      ? raw.requiresApproval
      : type !== "mensaje";

  const sourceScope = normalizeServiceSourceScope(
    raw.sourceScope,
    fallbackSourceScope
  );

  const visibility = normalizeServiceVisibility(raw.visibility, visible);

  const displayOrder = normalizeDisplayOrder(
    raw.displayOrder,
    getDefaultDisplayOrder(type) ?? fallbackIndex
  );

  const meta = normalizeServiceMeta(type, raw.meta);

  if (enabled && hasAnyPrice && !currency) {
    throw new Error("Si un servicio habilitado tiene precio, debe tener moneda.");
  }

  if (!enabled && !hasAnyPrice) {
    currency = null;
  }

  const normalizedLegacyPrice = normalizePositiveNullableNumber(
    raw.price ?? memberPrice
  );

  return {
    type,
    enabled,
    visible,
    visibility,
    displayOrder,
    memberPrice,
    publicPrice,
    currency,
    requiresApproval,
    sourceScope,
    meta,
    price: normalizedLegacyPrice,
  };
}

export function normalizeServiceCatalog(
  offerings: PartialOffering[] | null | undefined,
  fallbackSourceScope: ServiceSourceScope = "group"
): GroupServiceCatalog {
  const arr = Array.isArray(offerings) ? offerings : [];

  const deduped = new Map<CreatorServiceType, GroupOffering>();

  arr.forEach((offering, index) => {
    const normalized = normalizeSingleService(
      offering,
      index,
      fallbackSourceScope
    );

    if (!normalized) return;

    deduped.set(normalized.type, normalized);
  });

  return Array.from(deduped.values()).sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
  );
}

export function findService(
  catalog: GroupServiceCatalog | null | undefined,
  type: CreatorServiceType
): GroupOffering | null {
  const arr = Array.isArray(catalog) ? catalog : [];
  return arr.find((item) => item.type === type) ?? null;
}

export function hasEnabledService(
  catalog: GroupServiceCatalog | null | undefined,
  type: CreatorServiceType
): boolean {
  const service = findService(catalog, type);
  return service?.enabled === true;
}

export function buildDefaultServiceCatalog(params?: {
  currency?: Currency | null;
  includeLegacyMessage?: boolean;
  sourceScope?: ServiceSourceScope;
}): GroupServiceCatalog {
  const sourceScope = params?.sourceScope ?? "group";

  const base: GroupServiceCatalog = [
    {
      type: "saludo",
      enabled: false,
      visible: false,
      visibility: "hidden",
      displayOrder: 1,
      memberPrice: null,
      publicPrice: null,
      currency: null,
      requiresApproval: true,
      sourceScope,
      meta: null,
      price: null,
    },
    {
      type: "consejo",
      enabled: false,
      visible: false,
      visibility: "hidden",
      displayOrder: 2,
      memberPrice: null,
      publicPrice: null,
      currency: null,
      requiresApproval: true,
      sourceScope,
      meta: null,
      price: null,
    },
    {
      type: "meet_greet_digital",
      enabled: false,
      visible: false,
      visibility: "hidden",
      displayOrder: 3,
      memberPrice: null,
      publicPrice: null,
      currency: null,
      requiresApproval: true,
      sourceScope,
      meta: {
        meetGreet: {
          durationMinutes: null,
        },
      },
      price: null,
    },
    {
      type: "clase_personalizada",
      enabled: false,
      visible: false,
      visibility: "hidden",
      displayOrder: 4,
      memberPrice: null,
      publicPrice: null,
      currency: null,
      requiresApproval: true,
      sourceScope,
      meta: {
        customClass: {
          durationMinutes: null,
          availability: {
            monday: [],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
            sunday: [],
          },
          bufferMinutes: null,
          advanceBookingHours: null,
          maxBookingsPerDay: null,
        },
      },
      price: null,
    },
  ];

  if (params?.includeLegacyMessage === true) {
    base.push({
      type: "mensaje",
      enabled: false,
      visible: false,
      visibility: "hidden",
      displayOrder: 99,
      memberPrice: null,
      publicPrice: null,
      currency: null,
      requiresApproval: true,
      sourceScope,
      meta: null,
      price: null,
    });
  }

  return base;
}

export function buildDefaultGroupServiceCatalog(params?: {
  currency?: Currency | null;
  includeLegacyMessage?: boolean;
}): GroupServiceCatalog {
  return buildDefaultServiceCatalog({
    currency: params?.currency,
    includeLegacyMessage: params?.includeLegacyMessage,
    sourceScope: "group",
  });
}

export function mergeWithDefaultCatalog(
  offerings: PartialOffering[] | null | undefined,
  currency?: Currency | null
): GroupServiceCatalog {
  const defaults = buildDefaultGroupServiceCatalog({
    currency: currency ?? DEFAULT_CURRENCY,
    includeLegacyMessage: true,
  });

  const normalizedIncoming = normalizeServiceCatalog(offerings, "group");

  const incomingMap = new Map(
    normalizedIncoming.map((item) => [item.type, item] as const)
  );

  const merged = defaults.map((base) => {
    const incoming = incomingMap.get(base.type);
    if (!incoming) return base;

    return {
      ...base,
      ...incoming,
      meta: incoming.meta ?? base.meta,
    };
  });

  for (const item of normalizedIncoming) {
    if (!merged.some((existing) => existing.type === item.type)) {
      merged.push(item);
    }
  }

  return merged.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

export function deriveMonetizationFlagsFromCatalog(
  catalog: GroupServiceCatalog | null | undefined
) {
  return {
    greetingsEnabled: hasEnabledService(catalog, "saludo"),
    adviceEnabled: hasEnabledService(catalog, "consejo"),
    customClassEnabled: hasEnabledService(catalog, "clase_personalizada"),
    digitalMeetGreetEnabled: hasEnabledService(catalog, "meet_greet_digital"),
  };
}

export function mergeMonetizationWithCatalog(params: {
  monetization?: PartialMonetization;
  catalog?: GroupServiceCatalog | null | undefined;
  legacyGreetingsEnabled?: boolean | null | undefined;
}): GroupMonetizationSettings {
  const monetization = params.monetization ?? null;
  const catalog = Array.isArray(params.catalog) ? params.catalog : [];
  const derived = deriveMonetizationFlagsFromCatalog(catalog);

  const subscriptionsEnabled = normalizeBoolean(
    monetization?.subscriptionsEnabled,
    normalizeBoolean(monetization?.isPaid, false)
  );

  const subscriptionPriceMonthly = normalizePositiveNullableNumber(
    monetization?.subscriptionPriceMonthly ?? monetization?.priceMonthly ?? null
  );

  const subscriptionCurrency =
    monetization?.subscriptionCurrency &&
    isValidCurrency(monetization.subscriptionCurrency)
      ? monetization.subscriptionCurrency
      : monetization?.currency && isValidCurrency(monetization.currency)
        ? monetization.currency
        : null;

  const isPaid =
    typeof monetization?.isPaid === "boolean"
      ? monetization.isPaid
      : subscriptionsEnabled;

  const greetingsEnabled =
    typeof monetization?.greetingsEnabled === "boolean"
      ? monetization.greetingsEnabled
      : typeof params.legacyGreetingsEnabled === "boolean"
        ? params.legacyGreetingsEnabled
        : derived.greetingsEnabled;

  return {
    isPaid,
    priceMonthly: isPaid ? subscriptionPriceMonthly : null,
    currency: isPaid ? subscriptionCurrency : null,
    subscriptionsEnabled,
    subscriptionPriceMonthly: subscriptionsEnabled
      ? subscriptionPriceMonthly
      : null,
    subscriptionCurrency: subscriptionsEnabled ? subscriptionCurrency : null,
    paidPostsEnabled: normalizeBoolean(monetization?.paidPostsEnabled, false),
    paidLivesEnabled: normalizeBoolean(monetization?.paidLivesEnabled, false),
    paidVodEnabled: normalizeBoolean(monetization?.paidVodEnabled, false),
    paidLiveCommentsEnabled: normalizeBoolean(
      monetization?.paidLiveCommentsEnabled,
      false
    ),
    greetingsEnabled,
    adviceEnabled:
      typeof monetization?.adviceEnabled === "boolean"
        ? monetization.adviceEnabled
        : derived.adviceEnabled,
    customClassEnabled:
      typeof monetization?.customClassEnabled === "boolean"
        ? monetization.customClassEnabled
        : derived.customClassEnabled,
    digitalMeetGreetEnabled:
      typeof monetization?.digitalMeetGreetEnabled === "boolean"
        ? monetization.digitalMeetGreetEnabled
        : derived.digitalMeetGreetEnabled,
  };
}

export function normalizeDonationSettings(
  donation?: PartialDonation
): GroupDonationSettings {
  const mode =
    donation?.mode === "general" || donation?.mode === "wedding"
      ? donation.mode
      : "none";

  const currency =
    donation?.currency && isValidCurrency(donation.currency)
      ? donation.currency
      : DEFAULT_CURRENCY;

  const sourceScope =
    donation?.sourceScope === "profile" ? "profile" : "group";

  const suggestedAmounts = Array.isArray(donation?.suggestedAmounts)
    ? Array.from(
        new Set(
          donation.suggestedAmounts
            .map((item) => Number(item))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
      ).slice(0, 12)
    : [];

  if (mode === "none") {
    return {
      mode: "none",
      enabled: false,
      visible: false,
      currency,
      sourceScope,
      title: null,
      description: null,
      suggestedAmounts: [],
      goalLabel: null,
    };
  }

  return {
    mode,
    enabled: typeof donation?.enabled === "boolean" ? donation.enabled : true,
    visible: typeof donation?.visible === "boolean" ? donation.visible : true,
    currency,
    sourceScope,
    title:
      typeof donation?.title === "string" && donation.title.trim()
        ? donation.title.trim()
        : null,
    description:
      typeof donation?.description === "string" && donation.description.trim()
        ? donation.description.trim()
        : null,
    suggestedAmounts,
    goalLabel:
      mode === "wedding" &&
      typeof donation?.goalLabel === "string" &&
      donation.goalLabel.trim()
        ? donation.goalLabel.trim()
        : null,
  };
}

export function buildNormalizedGroupCommerceState(params: {
  offerings?: PartialOffering[] | null | undefined;
  monetization?: PartialMonetization;
  donation?: PartialDonation;
  legacyGreetingsEnabled?: boolean | null | undefined;
  currency?: Currency | null;
}) {
  const mergedCatalog = mergeWithDefaultCatalog(
    params.offerings,
    params.currency ??
      (params.monetization?.subscriptionCurrency &&
      isValidCurrency(params.monetization.subscriptionCurrency)
        ? params.monetization.subscriptionCurrency
        : params.monetization?.currency &&
            isValidCurrency(params.monetization.currency)
          ? params.monetization.currency
          : DEFAULT_CURRENCY)
  );

  const monetization = mergeMonetizationWithCatalog({
    monetization: params.monetization,
    catalog: mergedCatalog,
    legacyGreetingsEnabled: params.legacyGreetingsEnabled,
  });

  const donation = normalizeDonationSettings(params.donation);

  return {
    offerings: mergedCatalog,
    monetization,
    donation,
  };
}