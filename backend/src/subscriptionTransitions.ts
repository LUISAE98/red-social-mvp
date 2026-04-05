import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type WriteBatch,
} from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

type TransitionDirection = "free_to_subscription" | "subscription_to_free";
type FreeToSubscriptionPolicy = "legacy_free" | "require_subscription";
type SubscriptionToFreePolicy = "keep_members_free" | "remove_all_members";
type CanonicalMemberStatus =
  | "active"
  | "muted"
  | "banned"
  | "removed";

type ApplySubscriptionTransitionData = {
  groupId?: unknown;
  nextSubscriptionEnabled?: unknown;
  freeToSubscriptionPolicy?: unknown;
  subscriptionToFreePolicy?: unknown;
};

type GroupMonetizationTransitions = {
  freeToSubscriptionPolicy?: FreeToSubscriptionPolicy | null;
  subscriptionToFreePolicy?: SubscriptionToFreePolicy | null;
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
  visibility?: string;
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
  policy: FreeToSubscriptionPolicy | SubscriptionToFreePolicy;
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

  return roleRaw.trim().toLowerCase() === "owner";
}

function buildEnableSubscriptionPatch(params: {
  actorUid: string;
  memberStatus: CanonicalMemberStatus;
  policy: FreeToSubscriptionPolicy;
}) {
  if (params.policy === "legacy_free") {
    return {
      status:
        params.memberStatus === "banned" ? "banned" : "active",
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
      status:
        params.memberStatus === "banned" ? "banned" : "active",
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
        removedMembers: 0,
        skippedMembers: 0,
      };
    }

    const membersSnap = await groupRef.collection("members").get();

    let updatedMembers = 0;
    let legacyGrantedMembers = 0;
    let removedMembers = 0;
    let skippedMembers = 0;

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

        const patch =
          plan.direction === "free_to_subscription"
            ? buildEnableSubscriptionPatch({
                actorUid,
                memberStatus,
                policy: plan.policy,
              })
            : buildDisableSubscriptionPatch({
                actorUid,
                memberStatus,
                policy: plan.policy,
              });

        if (patch === null) {
          if (memberStatus === "banned") {
            continue;
          }

          batch.delete(memberDoc.ref);
          removedMembers += 1;
          updatedMembers += 1;
          continue;
        }

        batch.set(memberDoc.ref, patch, { merge: true });

        if (
          plan.direction === "free_to_subscription" &&
          plan.policy === "legacy_free" &&
          memberStatus !== "banned"
        ) {
          legacyGrantedMembers += 1;
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
      removedMembers,
      skippedMembers,
    });

    return {
      ok: true,
      alreadyApplied: false,
      direction: plan.direction,
      policy: plan.policy,
      transitionKey: plan.transitionKey,
      updatedMembers,
      legacyGrantedMembers,
      removedMembers,
      skippedMembers,
    };
  }
);