import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

type MemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | "kicked"
  | "expelled"
  | string
  | null;

type SidebarMembershipAccessType =
  | "standard"
  | "subscription"
  | "subscribed"
  | "legacy_free"
  | "unknown";

type SidebarState =
  | "joined"
  | "legacy_free"
  | "requires_subscription"
  | "banned"
  | "hidden";

type GroupMonetization = {
  isPaid?: boolean;
  subscriptionsEnabled?: boolean;
  priceMonthly?: number | null;
  subscriptionPriceMonthly?: number | null;
  currency?: "MXN" | "USD" | null;
  subscriptionCurrency?: "MXN" | "USD" | null;
};

type GroupOffering = {
  type: string;
  enabled?: boolean;
  price?: number | null;
  currency?: "MXN" | "USD" | null;
};

type GroupData = {
  ownerId?: string;
  name?: string;
  visibility?: string;
  avatarUrl?: string | null;
  monetization?: GroupMonetization | null;
  offerings?: GroupOffering[] | null;
};

type MemberData = {
  userId?: string;
  roleInGroup?: string;
  status?: string | null;
  accessType?: string | null;
  requiresSubscription?: boolean;
  subscriptionActive?: boolean;
  removedReason?: string | null;
  removedDueToSubscriptionTransition?: boolean;
  transitionPendingAction?: boolean;
  transitionDirection?: string | null;
};

function normalizeSidebarMemberStatus(raw: unknown): MemberStatus {
  if (raw === "active") return "active";
  if (raw === "subscribed") return "subscribed";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";
  if (raw === "kicked") return "kicked";
  if (raw === "expelled") return "expelled";
  return null;
}

function normalizeAccessType(raw: unknown): SidebarMembershipAccessType {
  if (raw === "standard") return "standard";
  if (raw === "subscription") return "subscription";
  if (raw === "subscribed") return "subscribed";
  if (raw === "legacy_free") return "legacy_free";
  return "unknown";
}

function isSubscriptionEnabled(monetization: GroupMonetization | null | undefined) {
  return (
    monetization?.subscriptionsEnabled === true || monetization?.isPaid === true
  );
}

function buildTransitionReason(memberData: MemberData): string | null {
  const removedReason =
    typeof memberData?.removedReason === "string"
      ? memberData.removedReason
      : null;

  if (removedReason) return removedReason;

  if (memberData?.removedDueToSubscriptionTransition === true) {
    return "subscription_transition";
  }

  return null;
}

function isVisibleJoinedStatus(status: MemberStatus) {
  return status === "active" || status === "subscribed" || status === "muted";
}

function isRemovedLikeStatus(status: MemberStatus) {
  return status === "removed" || status === "kicked" || status === "expelled";
}

function resolveSidebarState(params: {
  status: MemberStatus;
  accessType: SidebarMembershipAccessType;
  requiresSubscription: boolean;
  subscriptionActive: boolean;
  transitionPendingAction: boolean;
  transitionReason: string | null;
  groupSubscriptionEnabled: boolean;
}): SidebarState {
  const {
    status,
    accessType,
    requiresSubscription,
    subscriptionActive,
    groupSubscriptionEnabled,
  } = params;

  if (status === "banned") {
    return "banned";
  }

  if (accessType === "legacy_free" && isVisibleJoinedStatus(status)) {
    return "legacy_free";
  }

  if (
    groupSubscriptionEnabled &&
    requiresSubscription &&
    !subscriptionActive &&
    isRemovedLikeStatus(status)
  ) {
    return "requires_subscription";
  }

  if (
    ((accessType === "subscription" || accessType === "subscribed") &&
      subscriptionActive &&
      (status === "subscribed" || isVisibleJoinedStatus(status))) ||
    (accessType === "legacy_free" &&
      (status === "active" || status === "muted")) ||
    (accessType === "standard" && isVisibleJoinedStatus(status)) ||
    (accessType === "unknown" &&
      (status === "active" || status === "subscribed" || status === "muted"))
  ) {
    return "joined";
  }

  return "hidden";
}

export const getMyHiddenJoinedGroups = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const membershipsSnap = await db
    .collectionGroup("members")
    .where("userId", "==", callerUid)
    .get();

  const rows = await Promise.all(
    membershipsSnap.docs.map(async (memberDoc) => {
      const memberData = (memberDoc.data() ?? {}) as MemberData;

      const groupRef = memberDoc.ref.parent.parent;
      if (!groupRef) return null;

      const groupSnap = await groupRef.get();
      if (!groupSnap.exists) return null;

      const groupData = (groupSnap.data() ?? {}) as GroupData;

      if (groupData?.ownerId === callerUid) return null;
      if (groupData?.visibility !== "hidden") return null;

      const memberStatus = normalizeSidebarMemberStatus(
        memberData?.status ?? "active"
      );
      const membershipAccessType = normalizeAccessType(memberData?.accessType);
      const requiresSubscription = memberData?.requiresSubscription === true;
      const subscriptionActive = memberData?.subscriptionActive === true;
      const legacyComplimentary = membershipAccessType === "legacy_free";
      const transitionPendingAction =
        memberData?.transitionPendingAction === true;
      const transitionReason = buildTransitionReason(memberData);
      const groupSubscriptionEnabled = isSubscriptionEnabled(
        groupData?.monetization
      );

      const sidebarState = resolveSidebarState({
        status: memberStatus,
        accessType: membershipAccessType,
        requiresSubscription,
        subscriptionActive,
        transitionPendingAction,
        transitionReason,
        groupSubscriptionEnabled,
      });

      if (sidebarState === "hidden") return null;

            const canDismiss = false;

      return {
        id: groupSnap.id,
        name: groupData?.name ?? null,
        ownerId: groupData?.ownerId ?? null,
        visibility: groupData?.visibility ?? null,
        avatarUrl: groupData?.avatarUrl ?? null,

        memberStatus,
        membershipAccessType,
        requiresSubscription,
        subscriptionActive,
        legacyComplimentary,
        transitionPendingAction,
        transitionReason,
        canDismiss,
        sidebarState,

        monetization: groupData?.monetization ?? null,
        offerings: Array.isArray(groupData?.offerings)
          ? groupData.offerings
          : [],
      };
    })
  );

  return {
    success: true,
    groups: rows.filter(Boolean),
  };
});