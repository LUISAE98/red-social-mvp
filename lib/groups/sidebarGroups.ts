import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type MembershipAccessType =
  | "standard"
  | "subscription"
  | "legacy_free"
  | "requires_subscription";

export type HiddenJoinedGroup = {
  id: string;
  name?: string | null;
  ownerId?: string | null;
  visibility?: "hidden" | string | null;
  avatarUrl?: string | null;

  memberStatus?: "active" | "muted" | "banned" | "removed" | null;

  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: "MXN" | "USD" | null;

    // compatibilidad nueva
    subscriptionsEnabled?: boolean;
    subscriptionPriceMonthly?: number | null;
    subscriptionCurrency?: "MXN" | "USD" | null;
  } | null;

  offerings?: Array<{
    type: string;
    enabled?: boolean;
    price?: number | null;
    currency?: "MXN" | "USD" | null;
  }>;

  // metadata de membresía/acceso preparada para transición
  membershipAccessType?: MembershipAccessType | null;
  requiresSubscription?: boolean | null;
  subscriptionActive?: boolean | null;
};

type GetMyHiddenJoinedGroupsResult = {
  success: boolean;
  groups: HiddenJoinedGroup[];
};

export async function getMyHiddenJoinedGroups(): Promise<HiddenJoinedGroup[]> {
  const fn = httpsCallable<any, GetMyHiddenJoinedGroupsResult>(
    functions,
    "getMyHiddenJoinedGroups"
  );

  const res = await fn({});
  return Array.isArray(res.data?.groups) ? res.data.groups : [];
}

/**
 * Helpers locales para no depender todavía de types/group.ts
 * mientras consolidamos el tipado central.
 */

export function hiddenGroupHasSubscription(group: HiddenJoinedGroup): boolean {
  return (
    group.monetization?.subscriptionsEnabled === true ||
    group.monetization?.isPaid === true
  );
}

export function hiddenGroupSubscriptionPrice(
  group: HiddenJoinedGroup
): number | null {
  if (typeof group.monetization?.subscriptionPriceMonthly === "number") {
    return group.monetization.subscriptionPriceMonthly;
  }

  if (typeof group.monetization?.priceMonthly === "number") {
    return group.monetization.priceMonthly;
  }

  return null;
}

export function hiddenGroupSubscriptionCurrency(
  group: HiddenJoinedGroup
): "MXN" | "USD" {
  return (
    group.monetization?.subscriptionCurrency ||
    group.monetization?.currency ||
    "MXN"
  );
}

export function resolveHiddenGroupAccessState(
  group: HiddenJoinedGroup
):
  | "standard"
  | "legacy_free"
  | "subscribed"
  | "group_now_paid"
  | "requires_subscription" {
  if (group.membershipAccessType === "legacy_free") {
    return "legacy_free";
  }

  if (
    group.membershipAccessType === "subscription" ||
    group.subscriptionActive === true
  ) {
    return "subscribed";
  }

  if (
    group.membershipAccessType === "requires_subscription" ||
    group.requiresSubscription === true
  ) {
    return "requires_subscription";
  }

  if (hiddenGroupHasSubscription(group)) {
    return "group_now_paid";
  }

  return "standard";
}