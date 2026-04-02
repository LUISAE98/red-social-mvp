import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  GroupDonationSettings,
  GroupMonetizationSettings,
  GroupOffering,
  GroupServiceCatalog,
  ServiceSourceScope,
  ServiceVisibility,
} from "@/types/group";

type PartialMonetization = Partial<GroupMonetizationSettings> | null | undefined;
type PartialDonation = Partial<GroupDonationSettings> | null | undefined;
type PartialOffering = Partial<GroupOffering> | null | undefined;

const DEFAULT_CURRENCY: Currency = "MXN";

const DEFAULT_SERVICE_ORDER: Record<
  Exclude<CreatorServiceType, "mensaje">,
  number
> = {
  suscripcion: 0,
  saludo: 1,
  consejo: 2,
  meet_greet_digital: 3,
  clase_personalizada: 4,
};

const ALL_SUPPORTED_SERVICE_TYPES: CreatorServiceType[] = [
  "suscripcion",
  "saludo",
  "consejo",
  "meet_greet_digital",
  "clase_personalizada",
  "mensaje",
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
  value: unknown
): ServiceSourceScope {
  if (isValidServiceSourceScope(value)) return value;
  return "group";
}

export function getDefaultDisplayOrder(type: CreatorServiceType): number {
  if (type === "mensaje") return 99;
  return DEFAULT_SERVICE_ORDER[type];
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

  if (type === "suscripcion") {
    return {
      subscription: {
        billingPeriod: "monthly",
      },
    };
  }

  if (type === "clase_personalizada") {
    const customClass = (meta.customClass ?? {}) as Record<string, unknown>;
    const durationMinutes = normalizePositiveNullableNumber(
      customClass.durationMinutes
    );

    return {
      customClass: {
        durationMinutes,
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
  fallbackIndex = 0
): GroupOffering {
  const raw = (offering ?? {}) as Record<string, unknown>;
  const rawType = raw.type;

  if (!isValidServiceType(rawType)) {
    throw new Error("Tipo de servicio inválido.");
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
      : type !== "suscripcion";

  const sourceScope = normalizeServiceSourceScope(raw.sourceScope);
  const visibility = normalizeServiceVisibility(raw.visibility, visible);
  const displayOrder = normalizeDisplayOrder(
    raw.displayOrder,
    getDefaultDisplayOrder(type) ?? fallbackIndex
  );
  const meta = normalizeServiceMeta(type, raw.meta);

  // Regla importante:
  // - si el servicio está apagado, toleramos currency sin precio
  // - si está encendido y tiene precio, debe tener moneda
  // - si está encendido y no tiene precio, currency puede quedar null
  if (enabled && hasAnyPrice && !currency) {
    throw new Error("Si un servicio habilitado tiene precio, debe tener moneda.");
  }

  if (!enabled && !hasAnyPrice) {
    // Permitimos que la UI conserve currency/defaults, pero no la persistimos
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
  offerings: PartialOffering[] | null | undefined
): GroupServiceCatalog {
  const arr = Array.isArray(offerings) ? offerings : [];

  const deduped = new Map<CreatorServiceType, GroupOffering>();

  arr.forEach((offering, index) => {
    const normalized = normalizeSingleService(offering, index);
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

export function buildDefaultGroupServiceCatalog(params?: {
  currency?: Currency | null;
  includeLegacyMessage?: boolean;
}): GroupServiceCatalog {
  const currency = params?.currency ?? DEFAULT_CURRENCY;
  const includeLegacyMessage = params?.includeLegacyMessage ?? false;

  const base: GroupServiceCatalog = [
    {
      type: "suscripcion",
      enabled: false,
      visible: false,
      visibility: "hidden",
      displayOrder: 0,
      memberPrice: null,
      publicPrice: null,
      currency: null,
      requiresApproval: false,
      sourceScope: "group",
      meta: {
        subscription: {
          billingPeriod: "monthly",
        },
      },
      price: null,
    },
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
      sourceScope: "group",
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
      sourceScope: "group",
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
      sourceScope: "group",
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
      sourceScope: "group",
      meta: {
        customClass: {
          durationMinutes: null,
        },
      },
      price: null,
    },
  ];

  if (includeLegacyMessage) {
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
      sourceScope: "group",
      meta: null,
      price: null,
    });
  }

  return base;
}

export function mergeWithDefaultCatalog(
  offerings: PartialOffering[] | null | undefined,
  currency?: Currency | null
): GroupServiceCatalog {
  const defaults = buildDefaultGroupServiceCatalog({
    currency: currency ?? DEFAULT_CURRENCY,
    includeLegacyMessage: true,
  });

  const normalizedIncoming = normalizeServiceCatalog(offerings);

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
  const subscription = findService(catalog, "suscripcion");

  return {
    isPaid:
      subscription?.enabled === true &&
      normalizePositiveNullableNumber(subscription.memberPrice) != null,
    subscriptionsEnabled: hasEnabledService(catalog, "suscripcion"),
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
  const subscription = findService(catalog, "suscripcion");

  const isPaid =
    typeof monetization?.isPaid === "boolean"
      ? monetization.isPaid
      : derived.isPaid;

  const priceMonthly = normalizePositiveNullableNumber(
    monetization?.priceMonthly ??
      subscription?.memberPrice ??
      subscription?.price ??
      null
  );

  const currency =
    monetization?.currency && isValidCurrency(monetization.currency)
      ? monetization.currency
      : subscription?.currency && isValidCurrency(subscription.currency)
      ? subscription.currency
      : null;

  const greetingsEnabled =
    typeof monetization?.greetingsEnabled === "boolean"
      ? monetization.greetingsEnabled
      : typeof params.legacyGreetingsEnabled === "boolean"
      ? params.legacyGreetingsEnabled
      : derived.greetingsEnabled;

  return {
    isPaid,
    priceMonthly: isPaid ? priceMonthly : null,
    currency: isPaid ? currency : null,
    subscriptionsEnabled:
      typeof monetization?.subscriptionsEnabled === "boolean"
        ? monetization.subscriptionsEnabled
        : derived.subscriptionsEnabled,
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

export function buildSubscriptionOfferingFromMonetization(
  monetization?: PartialMonetization
): GroupOffering {
  const enabled =
    normalizeBoolean(monetization?.subscriptionsEnabled, false) ||
    normalizeBoolean(monetization?.isPaid, false);

  const priceMonthly = normalizePositiveNullableNumber(
    monetization?.priceMonthly ?? null
  );

  const currency =
    monetization?.currency && isValidCurrency(monetization.currency)
      ? monetization.currency
      : enabled && priceMonthly != null
      ? DEFAULT_CURRENCY
      : null;

  return {
    type: "suscripcion",
    enabled,
    visible: enabled,
    visibility: enabled ? "public" : "hidden",
    displayOrder: 0,
    memberPrice: enabled ? priceMonthly : null,
    publicPrice: null,
    currency: enabled ? currency : null,
    requiresApproval: false,
    sourceScope: "group",
    meta: {
      subscription: {
        billingPeriod: "monthly",
      },
    },
    price: enabled ? priceMonthly : null,
  };
}

export function syncCatalogWithMonetization(
  catalog: GroupServiceCatalog | null | undefined,
  monetization?: PartialMonetization
): GroupServiceCatalog {
  const merged = mergeWithDefaultCatalog(catalog ?? []);
  const subscription = buildSubscriptionOfferingFromMonetization(monetization);

  const withoutSubscription = merged.filter(
    (item) => item.type !== "suscripcion"
  );

  return [subscription, ...withoutSubscription].sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
  );
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
      (params.monetization?.currency && isValidCurrency(params.monetization.currency)
        ? params.monetization.currency
        : DEFAULT_CURRENCY)
  );

  const syncedCatalog = syncCatalogWithMonetization(
    mergedCatalog,
    params.monetization
  );

  const monetization = mergeMonetizationWithCatalog({
    monetization: params.monetization,
    catalog: syncedCatalog,
    legacyGreetingsEnabled: params.legacyGreetingsEnabled,
  });

  const donation = normalizeDonationSettings(params.donation);

  return {
    offerings: syncedCatalog,
    monetization,
    donation,
  };
}