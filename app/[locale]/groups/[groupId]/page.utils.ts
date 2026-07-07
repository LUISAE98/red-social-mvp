// page.utils.ts
// Tipos locales y helpers puros extraídos de la página de grupo (page.tsx).
// No dependen del estado del componente.

import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
} from "@/types/group";

export type PostingMode = "members" | "owner_only";
export type InteractionBlockedReason = "login" | "join" | "restricted" | null;
export type DonationMode = "none" | "general" | "wedding";
export type DonationSourceScope = "group" | "profile";
export type Visibility = "public" | "private" | "hidden";
export type LegacyServiceVisibility = "hidden" | "members" | "public";
export type LegacyServiceSourceScope = "group" | "profile" | "both";
export type LocalCreatorServiceType = CreatorServiceType;
export type LocalServiceMeta = CreatorServiceMeta | null;
export type CropMode = "avatar" | "cover";

export type GroupDoc = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  visibility?: Visibility | string;
  isActive?: boolean;
  isDeleted?: boolean;
  deletedAt?: unknown;
  deletedBy?: string | null;
  deletionReason?: string | null;
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

export function formatDeletedAt(val: unknown): string {
  if (!val) return "fecha desconocida";
  if (
    typeof val === "object" &&
    val !== null &&
    "toDate" in val &&
    typeof (val as { toDate: unknown }).toDate === "function"
  ) {
    return (val as { toDate: () => Date })
      .toDate()
      .toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });
  }
  if (val instanceof Date) {
    return val.toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });
  }
  const n = Number(val);
  if (!isNaN(n) && n > 0) {
    return new Date(n).toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });
  }
  return String(val);
}
