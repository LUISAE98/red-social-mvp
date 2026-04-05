import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type MembershipAccessType =
  | "standard"
  | "subscription"
  | "subscribed"
  | "legacy_free"
  | "unknown";

export type HiddenSidebarState =
  | "joined"
  | "legacy_free"
  | "requires_subscription"
  | "banned";

export type HiddenJoinedGroup = {
  id: string;
  name?: string | null;
  ownerId?: string | null;
  visibility?: "hidden" | string | null;
  avatarUrl?: string | null;

    memberStatus?:
    | "active"
    | "subscribed"
    | "muted"
    | "banned"
    | "removed"
    | "kicked"
    | "expelled"
    | null;

  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: "MXN" | "USD" | null;

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

  membershipAccessType?: MembershipAccessType | null;
  requiresSubscription?: boolean | null;
  subscriptionActive?: boolean | null;
  legacyComplimentary?: boolean | null;
  transitionPendingAction?: boolean | null;
  transitionReason?: string | null;
  canDismiss?: boolean | null;
  sidebarState?: HiddenSidebarState | null;
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
  | "joined"
  | "legacy_free"
  | "subscribed"
  | "requires_subscription"
  | "banned" {
  if (group.sidebarState === "legacy_free") {
    return "legacy_free";
  }

  if (group.sidebarState === "requires_subscription") {
    return "requires_subscription";
  }

  if (group.sidebarState === "banned") {
    return "banned";
  }

  if (
    group.membershipAccessType === "subscription" ||
    group.membershipAccessType === "subscribed" ||
    group.memberStatus === "subscribed" ||
    group.subscriptionActive === true
  ) {
    return "subscribed";
  }

  if (group.membershipAccessType === "legacy_free") {
    return "legacy_free";
  }

  if (group.requiresSubscription === true) {
    return "requires_subscription";
  }

  return "joined";
}

export function hiddenGroupCanBeDismissed(group: HiddenJoinedGroup): boolean {
  return false;
}

export function hiddenGroupIsLegacyFree(group: HiddenJoinedGroup): boolean {
  return (
    group.sidebarState === "legacy_free" ||
    group.membershipAccessType === "legacy_free" ||
    group.legacyComplimentary === true
  );
}

export function hiddenGroupRequiresSubscription(
  group: HiddenJoinedGroup
): boolean {
  return group.sidebarState === "requires_subscription";
}

export function hiddenGroupWasRemovedBySubscriptionTransition(
  group: HiddenJoinedGroup
): boolean {
  return false;
}