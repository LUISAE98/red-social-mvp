import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  GroupDonationSettings,
  GroupMonetizationSettings,
  GroupOffering,
} from "@/types/group";

export type JoinRequestStatus = "pending" | "approved" | "rejected" | string;

export type MemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | "kicked"
  | "expelled"
  | null;

export type MemberRole = "owner" | "mod" | "member" | null;

export type PostingMode = "members" | "owner_only";

export type InteractionBlockedReason = "login" | "join" | "restricted" | null;

export type DonationMode = "none" | "general" | "wedding";

export type DonationSourceScope = "group" | "profile";

export type Visibility = "public" | "private" | "hidden";

export type LegacyServiceVisibility = "hidden" | "members" | "public";

export type LegacyServiceSourceScope = "group" | "profile" | "both";

export type MembershipAccessType =
  | "standard"
  | "subscription"
  | "legacy_free"
  | "unknown";

export type LocalCreatorServiceType = CreatorServiceType;
export type LocalServiceMeta = CreatorServiceMeta | null;

export type GroupDoc = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  visibility?: Visibility | string;
  isActive?: boolean;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  category?: string | null;
  tags?: string[] | null;
  postingMode?: PostingMode | string | null;
  commentsEnabled?: boolean | null;
  greetingsEnabled?: boolean | null;
  welcomeMessage?: string | null;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: string | Currency | null;
    subscriptionsEnabled?: boolean;
    subscriptionPriceMonthly?: number | null;
    subscriptionCurrency?: string | Currency | null;
    paidPostsEnabled?: boolean;
    paidLivesEnabled?: boolean;
    paidVodEnabled?: boolean;
    paidLiveCommentsEnabled?: boolean;
    greetingsEnabled?: boolean;
    adviceEnabled?: boolean;
    customClassEnabled?: boolean;
    digitalMeetGreetEnabled?: boolean;
    transitions?: {
      freeToSubscriptionPolicy?:
        | "legacy_free"
        | "require_subscription"
        | null;
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
      subscriptionPriceChangeCurrency?: string | Currency | null;
      lastMonetizationChangeAt?: unknown;
      lastMonetizationChangeBy?: string | null;
      lastAppliedTransitionKey?: string | null;
      lastAppliedTransitionAt?: unknown;
      lastAppliedTransitionBy?: string | null;
    } | null;
  } | null;
  settings?: {
    membersListVisibility?: "owner_only" | "members" | string;
  };
  permissions?: {
    postingMode?: PostingMode | string | null;
    commentsEnabled?: boolean | null;
  } | null;
  offerings?: Array<{
    type: LocalCreatorServiceType;
    enabled?: boolean;
    visible?: boolean;
    visibility?: LegacyServiceVisibility | string;
    displayOrder?: number | null;
    memberPrice?: number | null;
    publicPrice?: number | null;
    currency?: string | Currency | null;
    requiresApproval?: boolean;
    sourceScope?: LegacyServiceSourceScope | string;
    meta?: LocalServiceMeta;
    price?: number | null;
  }> | null;
  donation?: {
    mode?: DonationMode | string;
    enabled?: boolean;
    visible?: boolean;
    currency?: string | Currency | null;
    sourceScope?: DonationSourceScope | string;
    suggestedAmounts?: number[] | null;
    goalLabel?: string | null;
    title?: string | null;
    description?: string | null;
  } | null;
};

export type CropMode = "avatar" | "cover";

export type Area = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function isGreetingType(t: string): t is "saludo" | "consejo" | "mensaje" {
  return t === "saludo" || t === "consejo" || t === "mensaje";
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function normalizeMemberStatus(raw: unknown): MemberStatus {
  if (raw === "active") return "active";
  if (raw === "subscribed") return "subscribed";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";
  if (raw === "kicked") return "kicked";
  if (raw === "expelled") return "expelled";
  return null;
}

export function normalizeMemberRole(raw: unknown): MemberRole {
  if (raw === "owner") return "owner";
  if (raw === "mod") return "mod";
  if (raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

export function normalizeMembershipAccessType(
  raw: unknown
): MembershipAccessType {
  if (raw === "standard") return "standard";
  if (raw === "subscription") return "subscription";
  if (raw === "legacy_free") return "legacy_free";
  return "unknown";
}

export function normalizeCurrency(raw: unknown): Currency | null {
  if (raw === "MXN") return "MXN";
  if (raw === "USD") return "USD";
  return null;
}

export function normalizeMonetization(
  raw: GroupDoc["monetization"]
): Partial<GroupMonetizationSettings> | undefined {
  if (!raw) return undefined;

  return {
    isPaid: raw.isPaid,
    priceMonthly: raw.priceMonthly ?? raw.subscriptionPriceMonthly ?? null,
    currency:
      normalizeCurrency(raw.currency) ??
      normalizeCurrency(raw.subscriptionCurrency),
    subscriptionsEnabled: raw.subscriptionsEnabled,
    subscriptionPriceMonthly:
      raw.subscriptionPriceMonthly ?? raw.priceMonthly ?? null,
    subscriptionCurrency:
      normalizeCurrency(raw.subscriptionCurrency) ??
      normalizeCurrency(raw.currency),
    paidPostsEnabled: raw.paidPostsEnabled,
    paidLivesEnabled: raw.paidLivesEnabled,
    paidVodEnabled: raw.paidVodEnabled,
    paidLiveCommentsEnabled: raw.paidLiveCommentsEnabled,
    greetingsEnabled: raw.greetingsEnabled,
    adviceEnabled: raw.adviceEnabled,
    customClassEnabled: raw.customClassEnabled,
    digitalMeetGreetEnabled: raw.digitalMeetGreetEnabled,
    transitions: raw.transitions
      ? {
          freeToSubscriptionPolicy:
            raw.transitions.freeToSubscriptionPolicy === "legacy_free" ||
            raw.transitions.freeToSubscriptionPolicy ===
              "require_subscription"
              ? raw.transitions.freeToSubscriptionPolicy
              : null,
          subscriptionToFreePolicy:
            raw.transitions.subscriptionToFreePolicy ===
              "keep_members_free" ||
            raw.transitions.subscriptionToFreePolicy === "remove_all_members"
              ? raw.transitions.subscriptionToFreePolicy
              : null,
          subscriptionPriceIncreasePolicy:
            raw.transitions.subscriptionPriceIncreasePolicy ===
              "keep_legacy_price" ||
            raw.transitions.subscriptionPriceIncreasePolicy ===
              "require_resubscribe_new_price"
              ? raw.transitions.subscriptionPriceIncreasePolicy
              : null,
          previousSubscriptionPriceMonthly:
            typeof raw.transitions.previousSubscriptionPriceMonthly === "number"
              ? raw.transitions.previousSubscriptionPriceMonthly
              : null,
          nextSubscriptionPriceMonthly:
            typeof raw.transitions.nextSubscriptionPriceMonthly === "number"
              ? raw.transitions.nextSubscriptionPriceMonthly
              : null,
          subscriptionPriceChangeCurrency:
            normalizeCurrency(raw.transitions.subscriptionPriceChangeCurrency) ??
            null,
          lastMonetizationChangeAt:
            raw.transitions.lastMonetizationChangeAt ?? null,
          lastMonetizationChangeBy:
            typeof raw.transitions.lastMonetizationChangeBy === "string"
              ? raw.transitions.lastMonetizationChangeBy
              : null,
          lastAppliedTransitionKey:
            typeof raw.transitions.lastAppliedTransitionKey === "string"
              ? raw.transitions.lastAppliedTransitionKey
              : null,
          lastAppliedTransitionAt:
            raw.transitions.lastAppliedTransitionAt ?? null,
          lastAppliedTransitionBy:
            typeof raw.transitions.lastAppliedTransitionBy === "string"
              ? raw.transitions.lastAppliedTransitionBy
              : null,
        }
      : null,
  };
}

export function normalizeDonationInput(
  raw: GroupDoc["donation"]
): Partial<GroupDonationSettings> | undefined {
  if (!raw) return undefined;

  const normalizedMode =
    raw.mode === "general" || raw.mode === "wedding" || raw.mode === "none"
      ? raw.mode
      : undefined;

  const normalizedSourceScope =
    raw.sourceScope === "group" || raw.sourceScope === "profile"
      ? raw.sourceScope
      : undefined;

  return {
    mode: normalizedMode,
    enabled: raw.enabled,
    visible: raw.visible,
    currency: normalizeCurrency(raw.currency),
    sourceScope: normalizedSourceScope,
    suggestedAmounts: Array.isArray(raw.suggestedAmounts)
      ? raw.suggestedAmounts.filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value)
        )
      : undefined,
    goalLabel: raw.goalLabel ?? null,
    title: raw.title ?? null,
    description: raw.description ?? null,
  };
}

export function normalizePostingMode(raw: unknown): PostingMode {
  return raw === "owner_only" ? "owner_only" : "members";
}

export function normalizeCommentsEnabled(raw: unknown): boolean {
  return raw !== false;
}

export function isJoinedStatus(status: MemberStatus) {
  return (
    status === "active" ||
    status === "subscribed" ||
    status === "muted"
  );
}

export function normalizeVisibility(raw: unknown): Visibility | null {
  if (raw === "public" || raw === "private" || raw === "hidden") return raw;
  return null;
}

export function toCatalogOfferings(
  offerings: GroupDoc["offerings"]
): Partial<GroupOffering>[] {
  const arr = Array.isArray(offerings) ? offerings : [];

  return arr
    .filter((item): item is NonNullable<typeof item> => !!item)
    .map((item): Partial<GroupOffering> => ({
      type: item.type,
      enabled: item.enabled,
      visible: item.visible,
      visibility:
        item.visibility === "hidden" ||
        item.visibility === "members" ||
        item.visibility === "public"
          ? item.visibility
          : undefined,
      displayOrder: item.displayOrder ?? undefined,
      memberPrice: item.memberPrice ?? undefined,
      publicPrice: item.publicPrice ?? undefined,
      currency: normalizeCurrency(item.currency) ?? undefined,
      requiresApproval: item.requiresApproval,
      sourceScope:
        item.sourceScope === "group" ||
        item.sourceScope === "profile" ||
        item.sourceScope === "both"
          ? item.sourceScope
          : undefined,
      meta: item.meta ?? null,
      price: item.price ?? undefined,
    }));
}

export function visibilityLabel(v: string) {
  if (v === "public") return "Comunidad pública";
  if (v === "private") return "Comunidad privada";
  if (v === "hidden") return "Comunidad oculta";
  return v ? `Comunidad ${v}` : "";
}

export function formatMoney(value: number, currency: Currency) {
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

export function readMetaNumber(
  meta: LocalServiceMeta,
  key: string
): number | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}