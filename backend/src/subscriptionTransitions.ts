import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type WriteBatch,
} from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

type TransitionDirection =
  | "free_to_subscription"
  | "subscription_to_free"
  | "subscription_price_increase";

type FreeToSubscriptionPolicy = "legacy_free" | "require_subscription";
type SubscriptionToFreePolicy = "keep_members_free" | "remove_all_members";
type SubscriptionPriceIncreasePolicy =
  | "keep_legacy_price"
  | "require_resubscribe_new_price";

type CanonicalMemberStatus = "active" | "muted" | "banned" | "removed";

type ApplySubscriptionTransitionData = {
  groupId?: unknown;
  nextSubscriptionEnabled?: unknown;
  freeToSubscriptionPolicy?: unknown;
  subscriptionToFreePolicy?: unknown;
  subscriptionPriceIncreasePolicy?: unknown;
  previousSubscriptionPriceMonthly?: unknown;
  nextSubscriptionPriceMonthly?: unknown;
  subscriptionPriceChangeCurrency?: unknown;
};

type DismissHiddenGroupTransitionData = {
  groupId?: unknown;
};

type RemoveLegacyFreeMembersAfterSubscriptionTransitionData = {
  groupId?: unknown;
};

type GroupMonetizationTransitions = {
  freeToSubscriptionPolicy?: FreeToSubscriptionPolicy | null;
  subscriptionToFreePolicy?: SubscriptionToFreePolicy | null;
  subscriptionPriceIncreasePolicy?: SubscriptionPriceIncreasePolicy | null;
  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: string | null;
  lastMonetizationChangeAt?: unknown;
  lastMonetizationChangeBy?: string | null;
  lastAppliedTransitionKey?: string | null;
  lastAppliedTransitionAt?: unknown;
  lastAppliedTransitionBy?: string | null;
};

type GroupMonetization = {
  isPaid?: boolean;
  subscriptionsEnabled?: boolean;
  subscriptionPriceMonthly?: number | null;
  subscriptionCurrency?: string | null;
  priceMonthly?: number | null;
  currency?: string | null;
  transitions?: GroupMonetizationTransitions | null;
};

type GroupDocShape = {
  ownerId?: string;
  name?: string;
  visibility?: string;
  avatarUrl?: string | null;
  monetization?: GroupMonetization | null;
};

type MemberDocShape = {
  userId?: string;
  roleInGroup?: string;
  role?: string;
  status?: string;
  accessType?: string | null;
  requiresSubscription?: boolean;
  subscriptionActive?: boolean;
  legacyComplimentary?: boolean;
};

type HiddenGroupTransitionDoc = {
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
  lastTransitionKey?: string | null;
  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: string | null;
};

type TransitionPlan =
  | {
      direction: "free_to_subscription";
      policy: FreeToSubscriptionPolicy;
      transitionKey: string;
      nextSubscriptionEnabled: true;
    }
  | {
      direction: "subscription_to_free";
      policy: SubscriptionToFreePolicy;
      transitionKey: string;
      nextSubscriptionEnabled: false;
    }
  | {
      direction: "subscription_price_increase";
      policy: SubscriptionPriceIncreasePolicy;
      transitionKey: string;
      nextSubscriptionEnabled: true;
      previousSubscriptionPriceMonthly: number;
      nextSubscriptionPriceMonthly: number;
      subscriptionPriceChangeCurrency: string | null;
    };

const MAX_BATCH_WRITES = 400;

function requireAuth(request: unknown): string {
  const uid =
    typeof request === "object" &&
    request !== null &&
    "auth" in request &&
    typeof (request as { auth?: { uid?: string } }).auth?.uid === "string"
      ? (request as { auth?: { uid?: string } }).auth!.uid!
      : "";

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  return uid;
}

function normalizeString(value: unknown, fieldName: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new HttpsError("invalid-argument", `${fieldName} es requerido.`);
  }
  return normalized;
}

function normalizeBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} debe ser boolean.`
    );
  }
  return value;
}

function normalizeFreeToSubscriptionPolicy(
  value: unknown
): FreeToSubscriptionPolicy | null {
  if (value === "legacy_free" || value === "require_subscription") {
    return value;
  }
  return null;
}

function normalizeSubscriptionToFreePolicy(
  value: unknown
): SubscriptionToFreePolicy | null {
  if (value === "keep_members_free" || value === "remove_all_members") {
    return value;
  }
  return null;
}

function normalizeSubscriptionPriceIncreasePolicy(
  value: unknown
): SubscriptionPriceIncreasePolicy | null {
  if (
    value === "keep_legacy_price" ||
    value === "require_resubscribe_new_price"
  ) {
    return value;
  }
  return null;
}

function normalizePositiveNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return null;
  }
  return value;
}

function normalizeCurrencyOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function normalizeMemberStatus(raw: unknown): CanonicalMemberStatus {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (value === "muted") return "muted";
  if (value === "banned") return "banned";
  if (value === "removed" || value === "kicked" || value === "expelled") {
    return "removed";
  }

  return "active";
}

function isSubscriptionEnabledFromGroup(group: GroupDocShape): boolean {
  return (
    group?.monetization?.subscriptionsEnabled === true ||
    group?.monetization?.isPaid === true
  );
}

function buildTransitionKey(params: {
  direction: TransitionDirection;
  policy:
    | FreeToSubscriptionPolicy
    | SubscriptionToFreePolicy
    | SubscriptionPriceIncreasePolicy;
  changeAt: unknown;
  actorUid: string;
}) {
  const rawChangeAt =
    typeof params.changeAt === "number" || typeof params.changeAt === "string"
      ? String(params.changeAt)
      : "no_change_timestamp";

  return [
    params.direction,
    params.policy,
    rawChangeAt,
    params.actorUid,
  ].join("__");
}

function resolveTransitionPlan(params: {
  group: GroupDocShape;
  actorUid: string;
  requestedNextSubscriptionEnabled: boolean;
  requestedFreeToSubscriptionPolicy: FreeToSubscriptionPolicy | null;
  requestedSubscriptionToFreePolicy: SubscriptionToFreePolicy | null;
  requestedSubscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy | null;
  requestedPreviousSubscriptionPriceMonthly: number | null;
  requestedNextSubscriptionPriceMonthly: number | null;
  requestedSubscriptionPriceChangeCurrency: string | null;
}): TransitionPlan {
  const groupMonetization = params.group.monetization ?? null;
  const transitions = groupMonetization?.transitions ?? null;

  const currentSubscriptionEnabled = isSubscriptionEnabledFromGroup(params.group);
  const nextSubscriptionEnabled = params.requestedNextSubscriptionEnabled;

  if (currentSubscriptionEnabled !== nextSubscriptionEnabled) {
    throw new HttpsError(
      "failed-precondition",
      "El documento del grupo aún no refleja el estado final de suscripción. Guarda primero el grupo y luego ejecuta la transición."
    );
  }

  const requestedPreviousPrice = params.requestedPreviousSubscriptionPriceMonthly;
  const requestedNextPrice = params.requestedNextSubscriptionPriceMonthly;

  const isPriceIncreaseTransition =
    currentSubscriptionEnabled === true &&
    nextSubscriptionEnabled === true &&
    requestedPreviousPrice != null &&
    requestedNextPrice != null &&
    requestedNextPrice > requestedPreviousPrice;

  if (isPriceIncreaseTransition) {
    const policy =
      params.requestedSubscriptionPriceIncreasePolicy ??
      normalizeSubscriptionPriceIncreasePolicy(
        transitions?.subscriptionPriceIncreasePolicy
      );

    if (!policy) {
      throw new HttpsError(
        "failed-precondition",
        "Falta subscriptionPriceIncreasePolicy para aplicar el aumento de precio."
      );
    }

    return {
      direction: "subscription_price_increase",
      policy,
      transitionKey: buildTransitionKey({
        direction: "subscription_price_increase",
        policy,
        changeAt: transitions?.lastMonetizationChangeAt ?? Date.now(),
        actorUid: params.actorUid,
      }),
      nextSubscriptionEnabled: true,
      previousSubscriptionPriceMonthly: requestedPreviousPrice,
      nextSubscriptionPriceMonthly: requestedNextPrice,
      subscriptionPriceChangeCurrency:
        params.requestedSubscriptionPriceChangeCurrency ??
        normalizeCurrencyOrNull(transitions?.subscriptionPriceChangeCurrency),
    };
  }

  if (nextSubscriptionEnabled) {
    const policy =
      params.requestedFreeToSubscriptionPolicy ??
      normalizeFreeToSubscriptionPolicy(transitions?.freeToSubscriptionPolicy);

    if (!policy) {
      throw new HttpsError(
        "failed-precondition",
        "Falta freeToSubscriptionPolicy para aplicar la transición."
      );
    }

    return {
      direction: "free_to_subscription",
      policy,
      transitionKey: buildTransitionKey({
        direction: "free_to_subscription",
        policy,
        changeAt: transitions?.lastMonetizationChangeAt ?? Date.now(),
        actorUid: params.actorUid,
      }),
      nextSubscriptionEnabled: true,
    };
  }

  const policy =
    params.requestedSubscriptionToFreePolicy ??
    normalizeSubscriptionToFreePolicy(transitions?.subscriptionToFreePolicy);

  if (!policy) {
    throw new HttpsError(
      "failed-precondition",
      "Falta subscriptionToFreePolicy para aplicar la transición."
    );
  }

  return {
    direction: "subscription_to_free",
    policy,
    transitionKey: buildTransitionKey({
      direction: "subscription_to_free",
      policy,
      changeAt: transitions?.lastMonetizationChangeAt ?? Date.now(),
      actorUid: params.actorUid,
    }),
    nextSubscriptionEnabled: false,
  };
}

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function commitBatches(batches: WriteBatch[]) {
  for (const batch of batches) {
    await batch.commit();
  }
}

function shouldSkipMember(member: MemberDocShape, ownerId: string): boolean {
  const userId =
    typeof member.userId === "string" ? member.userId.trim() : "";

  if (!userId) return false;
  if (userId === ownerId) return true;

  const roleRaw =
    typeof member.roleInGroup === "string"
      ? member.roleInGroup
      : typeof member.role === "string"
      ? member.role
      : "";

  const normalizedRole = roleRaw.trim().toLowerCase();

  return (
    normalizedRole === "owner" ||
    normalizedRole === "mod" ||
    normalizedRole === "moderator"
  );
}

function normalizeAccessType(member: MemberDocShape): string {
  return typeof member.accessType === "string"
    ? member.accessType.trim().toLowerCase()
    : "";
}

function isLegacyComplimentaryMember(member: MemberDocShape): boolean {
  const accessType = normalizeAccessType(member);

  if (accessType === "legacy_free") return true;
  if (member.legacyComplimentary === true) return true;

  // Compatibilidad con miembros antiguos gratis dentro de un grupo ya de suscripción
  if (
    accessType !== "subscription" &&
    member.subscriptionActive !== true &&
    member.requiresSubscription !== true
  ) {
    return true;
  }

  return false;
}

function isLegacyFreeActiveMember(member: MemberDocShape): boolean {
  const status = normalizeMemberStatus(member.status);
  return status === "active" && isLegacyComplimentaryMember(member);
}

function isPaidSubscriberMember(member: MemberDocShape): boolean {
  const accessType = normalizeAccessType(member);

  if (isLegacyComplimentaryMember(member)) return false;
  if (accessType === "subscription" || accessType === "subscribed") return true;
  if (member.subscriptionActive === true) return true;

  return false;
}

function buildEnableSubscriptionPatch(params: {
  actorUid: string;
  memberStatus: CanonicalMemberStatus;
  policy: FreeToSubscriptionPolicy;
}) {
  if (params.policy === "legacy_free") {
    return {
      status: params.memberStatus === "banned" ? "banned" : "active",
      accessType: "legacy_free",
      requiresSubscription: false,
      subscriptionActive: false,
      legacyGrantedAt: FieldValue.serverTimestamp(),
      legacyGrantedBy: params.actorUid,
      removedReason: FieldValue.delete(),
      removedAt: FieldValue.delete(),
      removedBy: FieldValue.delete(),
      removedDueToSubscriptionTransition: false,
      transitionPendingAction: false,
      transitionDirection: "free_to_subscription",
      transitionResolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  return null;
}

function buildDisableSubscriptionPatch(params: {
  actorUid: string;
  memberStatus: CanonicalMemberStatus;
  policy: SubscriptionToFreePolicy;
}) {
  if (params.policy === "keep_members_free") {
    return {
      status: params.memberStatus === "banned" ? "banned" : "active",
      accessType: "standard",
      requiresSubscription: false,
      subscriptionActive: false,
      subscriptionEndedAt: FieldValue.serverTimestamp(),
      subscriptionEndedBy: params.actorUid,
      removedReason: FieldValue.delete(),
      removedAt: FieldValue.delete(),
      removedBy: FieldValue.delete(),
      removedDueToSubscriptionTransition: false,
      transitionPendingAction: false,
      transitionDirection: "subscription_to_free",
      transitionResolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  return null;
}

function buildPriceIncreasePatch(params: {
  actorUid: string;
  member: MemberDocShape;
  memberStatus: CanonicalMemberStatus;
  policy: SubscriptionPriceIncreasePolicy;
  previousSubscriptionPriceMonthly: number;
  nextSubscriptionPriceMonthly: number;
  subscriptionPriceChangeCurrency: string | null;
}) {
  if (params.policy !== "keep_legacy_price") {
    return null;
  }

  if (params.memberStatus === "banned") {
    return {
      status: "banned",
      transitionPendingAction: false,
      transitionDirection: "subscription_price_increase",
      transitionResolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  if (isLegacyComplimentaryMember(params.member)) {
    return {
      status: params.memberStatus === "muted" ? "muted" : "active",
      accessType: "legacy_free",
      legacyComplimentary: true,
      requiresSubscription: false,
      subscriptionActive: false,
      legacySubscriptionPriceMonthly: FieldValue.delete(),
      legacySubscriptionCurrency: FieldValue.delete(),
      nextSubscriptionPriceMonthly: FieldValue.delete(),
      subscriptionPriceIncreasedAt: FieldValue.serverTimestamp(),
      subscriptionPriceIncreasedBy: params.actorUid,
      removedReason: FieldValue.delete(),
      removedAt: FieldValue.delete(),
      removedBy: FieldValue.delete(),
      removedDueToSubscriptionTransition: false,
      transitionPendingAction: false,
      transitionDirection: "subscription_price_increase",
      transitionResolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  if (isPaidSubscriberMember(params.member)) {
    return {
      status: "subscribed",
      accessType: "subscription",
      legacyComplimentary: false,
      requiresSubscription: false,
      subscriptionActive: true,
      legacySubscriptionPriceMonthly: params.previousSubscriptionPriceMonthly,
      legacySubscriptionCurrency: params.subscriptionPriceChangeCurrency,
      nextSubscriptionPriceMonthly: params.nextSubscriptionPriceMonthly,
      subscriptionPriceIncreasedAt: FieldValue.serverTimestamp(),
      subscriptionPriceIncreasedBy: params.actorUid,
      removedReason: FieldValue.delete(),
      removedAt: FieldValue.delete(),
      removedBy: FieldValue.delete(),
      removedDueToSubscriptionTransition: false,
      transitionPendingAction: false,
      transitionDirection: "subscription_price_increase",
      transitionResolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  return {
    status: params.memberStatus === "muted" ? "muted" : "active",
    accessType:
      normalizeAccessType(params.member) === "subscription" ? "subscription" : "standard",
    legacyComplimentary: false,
    requiresSubscription:
      normalizeAccessType(params.member) === "subscription"
        ? false
        : params.member.requiresSubscription === true,
    subscriptionActive: params.member.subscriptionActive === true,
    legacySubscriptionPriceMonthly: FieldValue.delete(),
    legacySubscriptionCurrency: FieldValue.delete(),
    nextSubscriptionPriceMonthly: FieldValue.delete(),
    subscriptionPriceIncreasedAt: FieldValue.serverTimestamp(),
    subscriptionPriceIncreasedBy: params.actorUid,
    removedReason: FieldValue.delete(),
    removedAt: FieldValue.delete(),
    removedBy: FieldValue.delete(),
    removedDueToSubscriptionTransition: false,
    transitionPendingAction: false,
    transitionDirection: "subscription_price_increase",
    transitionResolvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildManualLegacyRemovalPatch(params: {
  actorUid: string;
}) {
  return {
    status: "removed",
    accessType: "subscription_required",
    requiresSubscription: true,
    subscriptionActive: false,
    legacyComplimentary: false,
    legacyGrantedAt: FieldValue.delete(),
    legacyGrantedBy: FieldValue.delete(),
    legacySubscriptionPriceMonthly: FieldValue.delete(),
    legacySubscriptionCurrency: FieldValue.delete(),
    nextSubscriptionPriceMonthly: FieldValue.delete(),
    subscriptionEndedAt: FieldValue.serverTimestamp(),
    subscriptionEndedBy: params.actorUid,
    removedReason: "subscription_required_after_transition",
    removedAt: FieldValue.serverTimestamp(),
    removedBy: params.actorUid,
    removedDueToSubscriptionTransition: true,
    transitionPendingAction: true,
    transitionDirection: "free_to_subscription",
    transitionResolvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function hiddenTransitionRef(userId: string, groupId: string): DocumentReference {
  return db
    .collection("users")
    .doc(userId)
    .collection("hiddenGroupTransitions")
    .doc(groupId);
}

function buildHiddenTransitionReminder(params: {
  userId: string;
  actorUid: string;
  groupId: string;
  group: GroupDocShape;
  transitionKey: string;
  direction: "free_to_subscription" | "subscription_price_increase";
  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: string | null;
}) {
  return {
    userId: params.userId,
    groupId: params.groupId,
    ownerId:
      typeof params.group.ownerId === "string" ? params.group.ownerId : null,
    groupName:
      typeof params.group.name === "string" ? params.group.name : null,
    visibility:
      typeof params.group.visibility === "string"
        ? params.group.visibility
        : null,
    avatarUrl:
      typeof params.group.avatarUrl === "string"
        ? params.group.avatarUrl
        : null,
    reason:
      params.direction === "subscription_price_increase"
        ? "subscription_price_increase_requires_resubscribe"
        : "subscription_required_after_transition",
    canDismiss: true,
    requiresSubscription: true,
    transitionPendingAction: true,
    transitionDirection: params.direction,
    transitionResolvedAt: FieldValue.serverTimestamp(),
    removedDueToSubscriptionTransition: true,
    subscriptionActive: false,
    previousSubscriptionPriceMonthly:
      params.previousSubscriptionPriceMonthly ?? null,
    nextSubscriptionPriceMonthly:
      params.nextSubscriptionPriceMonthly ?? null,
    subscriptionPriceChangeCurrency:
      params.subscriptionPriceChangeCurrency ?? null,
    lastTransitionKey: params.transitionKey,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: params.actorUid,
  };
}

export const applyGroupSubscriptionTransition = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const actorUid = requireAuth(request);
    const data = (request.data ?? {}) as ApplySubscriptionTransitionData;

    const groupId = normalizeString(data.groupId, "groupId");
    const requestedNextSubscriptionEnabled = normalizeBoolean(
      data.nextSubscriptionEnabled,
      "nextSubscriptionEnabled"
    );

    const requestedFreeToSubscriptionPolicy =
      normalizeFreeToSubscriptionPolicy(data.freeToSubscriptionPolicy);
    const requestedSubscriptionToFreePolicy =
      normalizeSubscriptionToFreePolicy(data.subscriptionToFreePolicy);
    const requestedSubscriptionPriceIncreasePolicy =
      normalizeSubscriptionPriceIncreasePolicy(
        data.subscriptionPriceIncreasePolicy
      );
    const requestedPreviousSubscriptionPriceMonthly =
      normalizePositiveNumberOrNull(data.previousSubscriptionPriceMonthly);
    const requestedNextSubscriptionPriceMonthly =
      normalizePositiveNumberOrNull(data.nextSubscriptionPriceMonthly);
    const requestedSubscriptionPriceChangeCurrency =
      normalizeCurrencyOrNull(data.subscriptionPriceChangeCurrency);

    const groupRef = db.collection("groups").doc(groupId);
    const groupSnap = await groupRef.get();

    if (!groupSnap.exists) {
      throw new HttpsError("not-found", "La comunidad no existe.");
    }

    const group = (groupSnap.data() ?? {}) as GroupDocShape;
    const ownerId =
      typeof group.ownerId === "string" ? group.ownerId.trim() : "";

    if (!ownerId) {
      throw new HttpsError(
        "failed-precondition",
        "La comunidad no tiene ownerId válido."
      );
    }

    if (ownerId !== actorUid) {
      throw new HttpsError(
        "permission-denied",
        "Solo el owner puede aplicar esta transición."
      );
    }

    const plan = resolveTransitionPlan({
      group,
      actorUid,
      requestedNextSubscriptionEnabled,
      requestedFreeToSubscriptionPolicy,
      requestedSubscriptionToFreePolicy,
      requestedSubscriptionPriceIncreasePolicy,
      requestedPreviousSubscriptionPriceMonthly,
      requestedNextSubscriptionPriceMonthly,
      requestedSubscriptionPriceChangeCurrency,
    });

    const transitions = group.monetization?.transitions ?? null;
    const lastAppliedTransitionKey =
      typeof transitions?.lastAppliedTransitionKey === "string"
        ? transitions.lastAppliedTransitionKey
        : null;

    if (lastAppliedTransitionKey === plan.transitionKey) {
      logger.info("subscription transition already applied", {
        groupId,
        actorUid,
        transitionKey: plan.transitionKey,
      });

      return {
        ok: true,
        alreadyApplied: true,
        direction: plan.direction,
        policy: plan.policy,
        transitionKey: plan.transitionKey,
        updatedMembers: 0,
        legacyGrantedMembers: 0,
        legacyPricedMembers: 0,
        removedMembers: 0,
        skippedMembers: 0,
        reminderMembers: 0,
      };
    }

    const membersSnap = await groupRef.collection("members").get();

    let updatedMembers = 0;
    let legacyGrantedMembers = 0;
    let legacyPricedMembers = 0;
    let removedMembers = 0;
    let skippedMembers = 0;
    let reminderMembers = 0;

    const memberDocs = membersSnap.docs.filter((docSnap) => {
      const member = (docSnap.data() ?? {}) as MemberDocShape;
      if (shouldSkipMember(member, ownerId)) {
        skippedMembers += 1;
        return false;
      }
      return true;
    });

    const chunks = splitIntoChunks(memberDocs, MAX_BATCH_WRITES);
    const batches: WriteBatch[] = [];

    for (const chunk of chunks) {
      const batch = db.batch();

      for (const memberDoc of chunk) {
        const member = (memberDoc.data() ?? {}) as MemberDocShape;
        const memberStatus = normalizeMemberStatus(member.status);
        const targetUserId =
          typeof member.userId === "string" ? member.userId.trim() : "";

        if (!targetUserId) {
          continue;
        }

        const reminderRef = hiddenTransitionRef(targetUserId, groupId);

        const patch =
          plan.direction === "free_to_subscription"
            ? buildEnableSubscriptionPatch({
                actorUid,
                memberStatus,
                policy: plan.policy,
              })
            : plan.direction === "subscription_to_free"
            ? buildDisableSubscriptionPatch({
                actorUid,
                memberStatus,
                policy: plan.policy,
              })
            : buildPriceIncreasePatch({
                actorUid,
                member,
                memberStatus,
                policy: plan.policy,
                previousSubscriptionPriceMonthly:
              plan.previousSubscriptionPriceMonthly,
                nextSubscriptionPriceMonthly: plan.nextSubscriptionPriceMonthly,
                subscriptionPriceChangeCurrency:
              plan.subscriptionPriceChangeCurrency,
              });
        if (patch === null) {
          if (memberStatus === "banned") {
            batch.delete(reminderRef);
            continue;
          }

          batch.delete(memberDoc.ref);

          if (
            (plan.direction === "free_to_subscription" &&
              plan.policy === "require_subscription") ||
            (plan.direction === "subscription_price_increase" &&
              plan.policy === "require_resubscribe_new_price")
          ) {
            batch.set(
              reminderRef,
              buildHiddenTransitionReminder({
                userId: targetUserId,
                actorUid,
                groupId,
                group,
                transitionKey: plan.transitionKey,
                direction: plan.direction,
                previousSubscriptionPriceMonthly:
                  plan.direction === "subscription_price_increase"
                    ? plan.previousSubscriptionPriceMonthly
                    : null,
                nextSubscriptionPriceMonthly:
                  plan.direction === "subscription_price_increase"
                    ? plan.nextSubscriptionPriceMonthly
                    : null,
                subscriptionPriceChangeCurrency:
                  plan.direction === "subscription_price_increase"
                    ? plan.subscriptionPriceChangeCurrency
                    : null,
              }),
              { merge: true }
            );
            reminderMembers += 1;
          } else {
            batch.delete(reminderRef);
          }

          removedMembers += 1;
          updatedMembers += 1;
          continue;
        }

        batch.set(memberDoc.ref, patch, { merge: true });
        batch.delete(reminderRef);

        if (
          plan.direction === "free_to_subscription" &&
          plan.policy === "legacy_free" &&
          memberStatus !== "banned"
        ) {
          legacyGrantedMembers += 1;
        }

        if (
          plan.direction === "subscription_price_increase" &&
          plan.policy === "keep_legacy_price" &&
          memberStatus !== "banned" &&
          isPaidSubscriberMember(member)
        ) {
          legacyPricedMembers += 1;
        }

        updatedMembers += 1;
      }

      batches.push(batch);
    }

    await commitBatches(batches);

    await groupRef.set(
      {
        monetization: {
          ...(group.monetization ?? {}),
          transitions: {
            ...(group.monetization?.transitions ?? {}),
            subscriptionPriceIncreasePolicy:
              plan.direction === "subscription_price_increase"
                ? plan.policy
                : group.monetization?.transitions?.subscriptionPriceIncreasePolicy ??
                  null,
            previousSubscriptionPriceMonthly:
              plan.direction === "subscription_price_increase"
                ? plan.previousSubscriptionPriceMonthly
                : group.monetization?.transitions?.previousSubscriptionPriceMonthly ??
                  null,
            nextSubscriptionPriceMonthly:
              plan.direction === "subscription_price_increase"
                ? plan.nextSubscriptionPriceMonthly
                : group.monetization?.transitions?.nextSubscriptionPriceMonthly ??
                  null,
            subscriptionPriceChangeCurrency:
              plan.direction === "subscription_price_increase"
                ? plan.subscriptionPriceChangeCurrency
                : group.monetization?.transitions?.subscriptionPriceChangeCurrency ??
                  null,
            lastAppliedTransitionKey: plan.transitionKey,
            lastAppliedTransitionAt: FieldValue.serverTimestamp(),
            lastAppliedTransitionBy: actorUid,
          },
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("subscription transition applied", {
      groupId,
      actorUid,
      direction: plan.direction,
      policy: plan.policy,
      transitionKey: plan.transitionKey,
      updatedMembers,
      legacyGrantedMembers,
      legacyPricedMembers,
      removedMembers,
      skippedMembers,
      reminderMembers,
    });

    return {
      ok: true,
      alreadyApplied: false,
      direction: plan.direction,
      policy: plan.policy,
      transitionKey: plan.transitionKey,
      updatedMembers,
      legacyGrantedMembers,
      legacyPricedMembers,
      removedMembers,
      skippedMembers,
      reminderMembers,
    };
  }
);

export const removeLegacyFreeMembersAfterSubscriptionTransition = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const actorUid = requireAuth(request);
    const data =
      (request.data ?? {}) as RemoveLegacyFreeMembersAfterSubscriptionTransitionData;

    const groupId = normalizeString(data.groupId, "groupId");
    const groupRef = db.collection("groups").doc(groupId);
    const groupSnap = await groupRef.get();

    if (!groupSnap.exists) {
      throw new HttpsError("not-found", "La comunidad no existe.");
    }

    const group = (groupSnap.data() ?? {}) as GroupDocShape;
    const ownerId =
      typeof group.ownerId === "string" ? group.ownerId.trim() : "";

    if (!ownerId) {
      throw new HttpsError(
        "failed-precondition",
        "La comunidad no tiene ownerId válido."
      );
    }

    if (ownerId !== actorUid) {
      throw new HttpsError(
        "permission-denied",
        "Solo el owner puede ejecutar esta acción."
      );
    }

    if (!isSubscriptionEnabledFromGroup(group)) {
      throw new HttpsError(
        "failed-precondition",
        "La comunidad debe seguir con suscripción activa para ejecutar esta acción."
      );
    }

    const transitions = group.monetization?.transitions ?? null;
    const freeToSubscriptionPolicy = normalizeFreeToSubscriptionPolicy(
      transitions?.freeToSubscriptionPolicy
    );

    const transitionKey =
      typeof transitions?.lastAppliedTransitionKey === "string" &&
      transitions.lastAppliedTransitionKey.trim()
        ? transitions.lastAppliedTransitionKey.trim()
        : buildTransitionKey({
            direction: "free_to_subscription",
            policy: "legacy_free",
            changeAt: transitions?.lastMonetizationChangeAt ?? Date.now(),
            actorUid,
          });

    const membersSnap = await groupRef.collection("members").get();

    let updatedMembers = 0;
    let removedMembers = 0;
    let reminderMembers = 0;
    let skippedMembers = 0;

    const memberDocs = membersSnap.docs.filter((docSnap) => {
      const member = (docSnap.data() ?? {}) as MemberDocShape;

      if (shouldSkipMember(member, ownerId)) {
        skippedMembers += 1;
        return false;
      }

      if (!isLegacyFreeActiveMember(member)) {
        skippedMembers += 1;
        return false;
      }

      return true;
    });

    if (memberDocs.length === 0) {
      logger.info("no legacy_free active members to remove", {
        groupId,
        actorUid,
        freeToSubscriptionPolicy,
      });

      return {
        ok: true,
        groupId,
        transitionKey,
        updatedMembers: 0,
        removedMembers: 0,
        reminderMembers: 0,
        skippedMembers,
      };
    }

    const chunks = splitIntoChunks(memberDocs, MAX_BATCH_WRITES);
    const batches: WriteBatch[] = [];

    for (const chunk of chunks) {
      const batch = db.batch();

      for (const memberDoc of chunk) {
        const member = (memberDoc.data() ?? {}) as MemberDocShape;
        const targetUserId =
          typeof member.userId === "string" ? member.userId.trim() : "";

        if (!targetUserId) {
          skippedMembers += 1;
          continue;
        }

        batch.set(
          memberDoc.ref,
          buildManualLegacyRemovalPatch({ actorUid }),
          { merge: true }
        );

        batch.set(
          hiddenTransitionRef(targetUserId, groupId),
          buildHiddenTransitionReminder({
            userId: targetUserId,
            actorUid,
            groupId,
            group,
            transitionKey,
            direction: "free_to_subscription",
          }),
          { merge: true }
        );

        updatedMembers += 1;
        removedMembers += 1;
        reminderMembers += 1;
      }

      batches.push(batch);
    }

    await commitBatches(batches);

    await groupRef.set(
      {
        monetization: {
          ...(group.monetization ?? {}),
          transitions: {
            ...(group.monetization?.transitions ?? {}),
            freeToSubscriptionPolicy:
              freeToSubscriptionPolicy ?? "legacy_free",
            lastAppliedTransitionKey: transitionKey,
            lastAppliedTransitionAt: FieldValue.serverTimestamp(),
            lastAppliedTransitionBy: actorUid,
          },
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("legacy_free members removed after transition", {
      groupId,
      actorUid,
      transitionKey,
      freeToSubscriptionPolicy,
      updatedMembers,
      removedMembers,
      reminderMembers,
      skippedMembers,
    });

    return {
      ok: true,
      groupId,
      transitionKey,
      updatedMembers,
      removedMembers,
      reminderMembers,
      skippedMembers,
    };
  }
);

export const dismissHiddenGroupTransition = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const actorUid = requireAuth(request);
    const data = (request.data ?? {}) as DismissHiddenGroupTransitionData;

    const groupId = normalizeString(data.groupId, "groupId");
    const reminderRef = hiddenTransitionRef(actorUid, groupId);
    const reminderSnap = await reminderRef.get();

    if (!reminderSnap.exists) {
      return {
        ok: true,
        alreadyDismissed: true,
        groupId,
      };
    }

    const reminder = (reminderSnap.data() ?? {}) as HiddenGroupTransitionDoc;

    if (reminder.canDismiss !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Esta comunidad no se puede olvidar desde el sidebar."
      );
    }

    await reminderRef.delete();

    logger.info("hidden group transition dismissed", {
      actorUid,
      groupId,
      reason: reminder.reason ?? null,
      transitionDirection: reminder.transitionDirection ?? null,
    });

    return {
      ok: true,
      alreadyDismissed: false,
      groupId,
    };
  }
);