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

type HiddenGroupTransitionData = {
  userId?: string;
  groupId?: string;
  ownerId?: string | null;
  groupName?: string | null;
  visibility?: string | null;
  avatarUrl?: string | null;
  reason?: string | null;
  canDismiss?: boolean;
  requiresSubscription?: boolean;
  transitionPendingAction?: boolean;
  transitionDirection?: string | null;
  subscriptionActive?: boolean;
  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: "MXN" | "USD" | string | null;
};

type SidebarGroupRow = {
  id: string;
  name?: string | null;
  ownerId?: string | null;
  visibility?: string | null;
  avatarUrl?: string | null;

  memberStatus?: MemberStatus;
  membershipAccessType?: SidebarMembershipAccessType | null;
  requiresSubscription?: boolean;
  subscriptionActive?: boolean;
  legacyComplimentary?: boolean;
  transitionPendingAction?: boolean;
  transitionReason?: string | null;
  canDismiss?: boolean;
  sidebarState?: SidebarState;

  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: "MXN" | "USD" | string | null;

  monetization?: GroupMonetization | null;
  offerings?: GroupOffering[];
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

function isSubscriptionEnabled(
  monetization: GroupMonetization | null | undefined
) {
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

function resolveReminderSidebarState(
  reminder: HiddenGroupTransitionData
): SidebarState {
  if (reminder.requiresSubscription === true) {
    return "requires_subscription";
  }

  return "hidden";
}

function buildReminderSidebarRow(params: {
  groupId: string;
  group: GroupData | null;
  reminder: HiddenGroupTransitionData;
}): SidebarGroupRow | null {
  const visibility =
    typeof params.group?.visibility === "string"
      ? params.group.visibility
      : typeof params.reminder.visibility === "string"
      ? params.reminder.visibility
      : null;

  const sidebarState = resolveReminderSidebarState(params.reminder);

  if (sidebarState !== "requires_subscription") {
    return null;
  }

  return {
    id: params.groupId,
    name:
      typeof params.group?.name === "string"
        ? params.group.name
        : typeof params.reminder.groupName === "string"
        ? params.reminder.groupName
        : null,
    ownerId:
      typeof params.group?.ownerId === "string"
        ? params.group.ownerId
        : typeof params.reminder.ownerId === "string"
        ? params.reminder.ownerId
        : null,
    visibility,
    avatarUrl:
      typeof params.group?.avatarUrl === "string"
        ? params.group.avatarUrl
        : typeof params.reminder.avatarUrl === "string"
        ? params.reminder.avatarUrl
        : null,

    memberStatus: null,
    membershipAccessType: "unknown",
    requiresSubscription: params.reminder.requiresSubscription === true,
    subscriptionActive: params.reminder.subscriptionActive === true,
    legacyComplimentary: false,
    transitionPendingAction: params.reminder.transitionPendingAction === true,
    transitionReason:
      typeof params.reminder.reason === "string" ? params.reminder.reason : null,
    canDismiss: params.reminder.canDismiss === true,
    sidebarState,

    previousSubscriptionPriceMonthly:
      typeof params.reminder.previousSubscriptionPriceMonthly === "number"
        ? params.reminder.previousSubscriptionPriceMonthly
        : null,
    nextSubscriptionPriceMonthly:
      typeof params.reminder.nextSubscriptionPriceMonthly === "number"
        ? params.reminder.nextSubscriptionPriceMonthly
        : null,
    subscriptionPriceChangeCurrency:
      typeof params.reminder.subscriptionPriceChangeCurrency === "string"
        ? params.reminder.subscriptionPriceChangeCurrency
        : null,

    monetization: params.group?.monetization ?? null,
    offerings: Array.isArray(params.group?.offerings)
      ? params.group.offerings
      : [],
  };
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

  const membershipRows = await Promise.all(
    membershipsSnap.docs.map(async (memberDoc) => {
      const memberData = (memberDoc.data() ?? {}) as MemberData;

      const groupRef = memberDoc.ref.parent.parent;
      if (!groupRef) return null;

      const groupSnap = await groupRef.get();
      if (!groupSnap.exists) return null;

      const groupData = (groupSnap.data() ?? {}) as GroupData;

      if (groupData?.ownerId === callerUid) return null;

      // Mantiene el comportamiento original:
      // memberships reales de comunidades hidden dentro de "other groups".
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

        previousSubscriptionPriceMonthly: null,
        nextSubscriptionPriceMonthly: null,
        subscriptionPriceChangeCurrency: null,

        monetization: groupData?.monetization ?? null,
        offerings: Array.isArray(groupData?.offerings)
          ? groupData.offerings
          : [],
      } satisfies SidebarGroupRow;
    })
  );

  const remindersSnap = await db
    .collection("users")
    .doc(callerUid)
    .collection("hiddenGroupTransitions")
    .get();

  const reminderRows = await Promise.all(
    remindersSnap.docs.map(async (reminderDoc) => {
      const reminderData = (reminderDoc.data() ??
        {}) as HiddenGroupTransitionData;
      const groupId = reminderDoc.id;

      const groupSnap = await db.collection("groups").doc(groupId).get();
      const groupData = groupSnap.exists
        ? ((groupSnap.data() ?? {}) as GroupData)
        : null;

      if (groupData?.ownerId === callerUid) return null;

      const memberSnap = await db
        .collection("groups")
        .doc(groupId)
        .collection("members")
        .doc(callerUid)
        .get();

      if (memberSnap.exists) {
        const memberData = (memberSnap.data() ?? {}) as MemberData;
        const memberStatus = normalizeSidebarMemberStatus(
          memberData?.status ?? "active"
        );
        const membershipAccessType = normalizeAccessType(memberData?.accessType);
        const requiresSubscription = memberData?.requiresSubscription === true;
        const subscriptionActive = memberData?.subscriptionActive === true;
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

        // Si el usuario ya volvió a tener acceso real al grupo,
        // el reminder quedó obsoleto y ya no debe mostrarse.
        if (
          sidebarState === "joined" ||
          sidebarState === "legacy_free" ||
          sidebarState === "banned"
        ) {
          await reminderDoc.ref.delete();
          return null;
        }
      }

      return buildReminderSidebarRow({
        groupId,
        group: groupData,
        reminder: reminderData,
      });
    })
  );

  const merged = new Map<string, SidebarGroupRow>();

  for (const row of membershipRows) {
    if (row) {
      merged.set(row.id, row);
    }
  }

  for (const row of reminderRows) {
    if (!row) continue;

    const existing = merged.get(row.id);

    if (!existing) {
      merged.set(row.id, row);
      continue;
    }

    if (
      row.sidebarState === "requires_subscription" &&
      existing.sidebarState !== "requires_subscription"
    ) {
      merged.set(row.id, {
        ...existing,
        ...row,
      });
    }
  }

  return {
    success: true,
    groups: Array.from(merged.values()),
  };
});