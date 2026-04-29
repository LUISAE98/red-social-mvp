import type {
  Currency,
  GroupDonationSettings,
  GroupOffering,
  GroupServiceCatalog,
} from "@/types/group";

import type {
  ProfileMonetizationSettings,
} from "@/types/profile";

import {
  buildDefaultServiceCatalog,
  deriveMonetizationFlagsFromCatalog,
  isValidCurrency,
  mergeWithDefaultCatalog,
  normalizeBoolean,
  normalizeDonationSettings,
  normalizeServiceCatalog,
} from "@/lib/groups/groupServiceCatalog";

type PartialOffering = Partial<GroupOffering> | null | undefined;
type PartialDonation = Partial<GroupDonationSettings> | null | undefined;
type PartialProfileMonetization =
  | Partial<ProfileMonetizationSettings>
  | null
  | undefined;

const DEFAULT_CURRENCY: Currency = "MXN";

export function buildDefaultProfileServiceCatalog(params?: {
  currency?: Currency | null;
  includeLegacyMessage?: boolean;
}): GroupServiceCatalog {
  return buildDefaultServiceCatalog({
    currency: params?.currency,
    includeLegacyMessage: params?.includeLegacyMessage,
    sourceScope: "profile",
  });
}

export function normalizeProfileServiceCatalog(
  offerings: PartialOffering[] | null | undefined
): GroupServiceCatalog {
  return normalizeServiceCatalog(offerings, "profile");
}

export function mergeWithDefaultProfileCatalog(
  offerings: PartialOffering[] | null | undefined,
  currency?: Currency | null
): GroupServiceCatalog {
  const defaults = buildDefaultProfileServiceCatalog({
    currency: currency ?? DEFAULT_CURRENCY,
    includeLegacyMessage: true,
  });

  const normalizedIncoming = normalizeProfileServiceCatalog(offerings);

  const incomingMap = new Map(
    normalizedIncoming.map((item) => [item.type, item] as const)
  );

  const merged: GroupServiceCatalog = defaults.map((base) => {
    const incoming = incomingMap.get(base.type);
    if (!incoming) return base;

    const sourceScope: GroupOffering["sourceScope"] =
      incoming.sourceScope === "both" ? "both" : "profile";

    return {
      ...base,
      ...incoming,
      sourceScope,
      meta: incoming.meta ?? base.meta,
    };
  });

  for (const item of normalizedIncoming) {
    if (!merged.some((existing) => existing.type === item.type)) {
      const sourceScope: GroupOffering["sourceScope"] =
        item.sourceScope === "both" ? "both" : "profile";

      merged.push({
        ...item,
        sourceScope,
      });
    }
  }

  return merged.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

export function mergeProfileMonetizationWithCatalog(params: {
  monetization?: PartialProfileMonetization;
  catalog?: GroupServiceCatalog | null | undefined;
  donation?: PartialDonation;
}): ProfileMonetizationSettings {
  const monetization = params.monetization ?? null;
  const catalog = Array.isArray(params.catalog) ? params.catalog : [];
  const derived = deriveMonetizationFlagsFromCatalog(catalog);

  return {
    greetingsEnabled:
      typeof monetization?.greetingsEnabled === "boolean"
        ? monetization.greetingsEnabled
        : derived.greetingsEnabled,

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

    donationsEnabled: normalizeBoolean(
      monetization?.donationsEnabled,
      params.donation?.enabled === true
    ),
  };
}

export function normalizeProfileDonationSettings(
  donation?: PartialDonation
): GroupDonationSettings {
  const normalized = normalizeDonationSettings({
    ...donation,
    sourceScope: "profile",
  });

  return {
    ...normalized,
    sourceScope: "profile",
  };
}

export function buildNormalizedProfileCommerceState(params: {
  offerings?: PartialOffering[] | null | undefined;
  monetization?: PartialProfileMonetization;
  donation?: PartialDonation;
  currency?: Currency | null;
}) {
  const currency =
    params.currency && isValidCurrency(params.currency)
      ? params.currency
      : params.donation?.currency && isValidCurrency(params.donation.currency)
        ? params.donation.currency
        : DEFAULT_CURRENCY;

  const offerings = mergeWithDefaultProfileCatalog(params.offerings, currency);

  const donation = normalizeProfileDonationSettings(params.donation);

  const monetization = mergeProfileMonetizationWithCatalog({
    monetization: params.monetization,
    catalog: offerings,
    donation,
  });

  return {
    offerings,
    monetization,
    donation,
  };
}