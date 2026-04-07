import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type MembershipAccessType =
  | "standard"
  | "subscription"
  | "subscribed"
  | "legacy_free"
  | "unknown";

export type SidebarGroupState =
  | "joined"
  | "legacy_free"
  | "requires_subscription"
  | "banned";

export type SidebarGroup = {
  id: string;
  name?: string | null;
  ownerId?: string | null;
  visibility?: "public" | "private" | "hidden" | string | null;
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
  sidebarState?: SidebarGroupState | null;
};

type GetMyHiddenJoinedGroupsResult = {
  success: boolean;
  groups: SidebarGroup[];
};

type DismissHiddenGroupTransitionParams = {
  groupId: string;
};

type DismissHiddenGroupTransitionResult = {
  ok: boolean;
  alreadyDismissed?: boolean;
  groupId: string;
};

export async function getMyHiddenJoinedGroups(): Promise<SidebarGroup[]> {
  const fn = httpsCallable<any, GetMyHiddenJoinedGroupsResult>(
    functions,
    "getMyHiddenJoinedGroups"
  );

  const res = await fn({});
  return Array.isArray(res.data?.groups) ? res.data.groups : [];
}

export async function dismissHiddenGroupTransition(
  groupId: string
): Promise<DismissHiddenGroupTransitionResult> {
  const normalizedGroupId = groupId.trim();

  if (!normalizedGroupId) {
    throw new Error("groupId es requerido.");
  }

  const fn = httpsCallable<
    DismissHiddenGroupTransitionParams,
    DismissHiddenGroupTransitionResult
  >(functions, "dismissHiddenGroupTransition");

  const res = await fn({ groupId: normalizedGroupId });

  return {
    ok: res.data?.ok === true,
    alreadyDismissed: res.data?.alreadyDismissed === true,
    groupId: res.data?.groupId ?? normalizedGroupId,
  };
}

/**
 * Helpers locales para no depender todavía de types/group.ts
 * mientras consolidamos el tipado central.
 */

export function sidebarGroupHasSubscription(group: SidebarGroup): boolean {
  return (
    group.monetization?.subscriptionsEnabled === true ||
    group.monetization?.isPaid === true
  );
}

export function sidebarGroupSubscriptionPrice(
  group: SidebarGroup
): number | null {
  if (typeof group.monetization?.subscriptionPriceMonthly === "number") {
    return group.monetization.subscriptionPriceMonthly;
  }

  if (typeof group.monetization?.priceMonthly === "number") {
    return group.monetization.priceMonthly;
  }

  return null;
}

export function sidebarGroupSubscriptionCurrency(
  group: SidebarGroup
): "MXN" | "USD" {
  return (
    group.monetization?.subscriptionCurrency ||
    group.monetization?.currency ||
    "MXN"
  );
}

export function resolveSidebarGroupAccessState(
  group: SidebarGroup
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

  if (
    group.membershipAccessType === "legacy_free" ||
    group.legacyComplimentary === true
  ) {
    return "legacy_free";
  }

  if (
    group.requiresSubscription === true ||
    sidebarGroupWasRemovedBySubscriptionTransition(group)
  ) {
    return "requires_subscription";
  }

  return "joined";
}

export function sidebarGroupCanBeDismissed(group: SidebarGroup): boolean {
  return group.canDismiss === true;
}

export function sidebarGroupIsLegacyFree(group: SidebarGroup): boolean {
  return (
    group.sidebarState === "legacy_free" ||
    group.membershipAccessType === "legacy_free" ||
    group.legacyComplimentary === true
  );
}

export function sidebarGroupRequiresSubscription(
  group: SidebarGroup
): boolean {
  return (
    group.sidebarState === "requires_subscription" ||
    group.requiresSubscription === true
  );
}

export function sidebarGroupWasRemovedBySubscriptionTransition(
  group: SidebarGroup
): boolean {
  return (
    group.requiresSubscription === true &&
    group.canDismiss === true &&
    (group.transitionReason === "subscription_required_after_transition" ||
      group.transitionReason === "subscription_transition")
  );
}

/**
 * Compat helpers temporales para no romper imports existentes
 * mientras migramos el resto del sidebar.
 */

export type HiddenSidebarState = SidebarGroupState;
export type HiddenJoinedGroup = SidebarGroup;

export const hiddenGroupHasSubscription = sidebarGroupHasSubscription;
export const hiddenGroupSubscriptionPrice = sidebarGroupSubscriptionPrice;
export const hiddenGroupSubscriptionCurrency = sidebarGroupSubscriptionCurrency;
export const resolveHiddenGroupAccessState = resolveSidebarGroupAccessState;
export const hiddenGroupCanBeDismissed = sidebarGroupCanBeDismissed;
export const hiddenGroupIsLegacyFree = sidebarGroupIsLegacyFree;
export const hiddenGroupRequiresSubscription =
  sidebarGroupRequiresSubscription;
export const hiddenGroupWasRemovedBySubscriptionTransition =
  sidebarGroupWasRemovedBySubscriptionTransition;