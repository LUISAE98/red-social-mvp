import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type MembershipAccessType =
  | "standard"
  | "subscription"
  | "legacy_free";

type MembershipStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed";

type JoinWithSubscriptionOptions = {
  priceMonthly?: number;
  currency?: string;
};

type GroupMembershipSummary = {
  groupId: string;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  ownerId?: string | null;
  visibility?: string | null;
  discoverable?: boolean | null;
  isActive?: boolean | null;
  category?: string | null;
};

function buildBaseMemberFields(uid: string, status: MembershipStatus) {
  return {
    userId: uid,
    roleInGroup: "member",
    status,
    updatedAt: serverTimestamp(),

    removedAt: deleteField(),
    removedBy: deleteField(),
    removedReason: deleteField(),
    removedDueToSubscriptionTransition: deleteField(),
    transitionPendingAction: false,
    transitionDirection: deleteField(),
    transitionResolvedAt: deleteField(),

    subscriptionEndedAt: deleteField(),
    subscriptionEndedBy: deleteField(),
  };
}

function buildUserMembershipBaseFields(params: {
  groupId: string;
  uid: string;
  status: MembershipStatus;
  accessType: MembershipAccessType;
  requiresSubscription: boolean;
  subscriptionActive: boolean;
  groupSummary: GroupMembershipSummary | null;
}) {
  return {
    groupId: params.groupId,
    userId: params.uid,

    roleInGroup: "member",
    status: params.status,
    accessType: params.accessType,
    requiresSubscription: params.requiresSubscription,
    subscriptionActive: params.subscriptionActive,

    groupName: params.groupSummary?.name ?? null,
    groupDescription: params.groupSummary?.description ?? null,
    groupImageUrl: params.groupSummary?.imageUrl ?? null,
    groupAvatarUrl: params.groupSummary?.avatarUrl ?? null,
    groupCoverUrl: params.groupSummary?.coverUrl ?? null,
    groupOwnerId: params.groupSummary?.ownerId ?? null,
    groupVisibility: params.groupSummary?.visibility ?? null,
    groupDiscoverable: params.groupSummary?.discoverable ?? null,
    groupIsActive: params.groupSummary?.isActive ?? null,
    groupCategory: params.groupSummary?.category ?? null,

    updatedAt: serverTimestamp(),
  };
}

async function getGroupMembershipSummary(
  groupId: string
): Promise<GroupMembershipSummary | null> {
  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));

    if (!groupSnap.exists()) return null;

    const data = groupSnap.data() as Record<string, unknown>;

    return {
      groupId,
      name: typeof data.name === "string" ? data.name : null,
      description: typeof data.description === "string" ? data.description : null,
      imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : null,
      avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
      coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : null,
      ownerId: typeof data.ownerId === "string" ? data.ownerId : null,
      visibility: typeof data.visibility === "string" ? data.visibility : null,
      discoverable:
        typeof data.discoverable === "boolean" ? data.discoverable : null,
      isActive: typeof data.isActive === "boolean" ? data.isActive : null,
      category: typeof data.category === "string" ? data.category : null,
    };
  } catch {
    return null;
  }
}

export async function joinGroup(groupId: string, uid: string) {
  const memberRef = doc(db, "groups", groupId, "members", uid);
  const joinRequestRef = doc(db, "groups", groupId, "joinRequests", uid);
  const userMembershipRef = doc(db, "users", uid, "groupMemberships", groupId);

  const groupSummary = await getGroupMembershipSummary(groupId);
  const batch = writeBatch(db);

  batch.set(
    memberRef,
    {
      ...buildBaseMemberFields(uid, "active"),

      accessType: "standard" as MembershipAccessType,
      requiresSubscription: false,
      subscriptionActive: false,

      joinedAt: serverTimestamp(),

      subscribedAt: deleteField(),
      subscriptionPriceMonthly: deleteField(),
      subscriptionCurrency: deleteField(),
      legacyGrantedAt: deleteField(),
      legacyGrantedBy: deleteField(),
      legacyComplimentary: deleteField(),
    },
    { merge: true }
  );

  batch.set(
    userMembershipRef,
    {
      ...buildUserMembershipBaseFields({
        groupId,
        uid,
        status: "active",
        accessType: "standard",
        requiresSubscription: false,
        subscriptionActive: false,
        groupSummary,
      }),

      joinedAt: serverTimestamp(),

      subscribedAt: deleteField(),
      subscriptionPriceMonthly: deleteField(),
      subscriptionCurrency: deleteField(),
      legacyGrantedAt: deleteField(),
      legacyGrantedBy: deleteField(),
      legacyComplimentary: deleteField(),
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);

  await batch.commit();
}

export async function joinGroupWithSubscription(
  groupId: string,
  uid: string,
  options?: JoinWithSubscriptionOptions
) {
  const memberRef = doc(db, "groups", groupId, "members", uid);
  const joinRequestRef = doc(db, "groups", groupId, "joinRequests", uid);
  const userMembershipRef = doc(db, "users", uid, "groupMemberships", groupId);

  const groupSummary = await getGroupMembershipSummary(groupId);
  const batch = writeBatch(db);

  batch.set(
    memberRef,
    {
      ...buildBaseMemberFields(uid, "subscribed"),

      accessType: "subscription" as MembershipAccessType,
      requiresSubscription: true,
      subscriptionActive: true,

      subscriptionPriceMonthly: options?.priceMonthly ?? null,
      subscriptionCurrency: options?.currency ?? "MXN",
      subscribedAt: serverTimestamp(),
      joinedAt: serverTimestamp(),

      legacyGrantedAt: deleteField(),
      legacyGrantedBy: deleteField(),
      legacyComplimentary: deleteField(),
    },
    { merge: true }
  );

  batch.set(
    userMembershipRef,
    {
      ...buildUserMembershipBaseFields({
        groupId,
        uid,
        status: "subscribed",
        accessType: "subscription",
        requiresSubscription: true,
        subscriptionActive: true,
        groupSummary,
      }),

      subscriptionPriceMonthly: options?.priceMonthly ?? null,
      subscriptionCurrency: options?.currency ?? "MXN",
      subscribedAt: serverTimestamp(),
      joinedAt: serverTimestamp(),

      legacyGrantedAt: deleteField(),
      legacyGrantedBy: deleteField(),
      legacyComplimentary: deleteField(),
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);

  await batch.commit();
}

export async function joinGroupAsLegacyFree(groupId: string, uid: string) {
  const memberRef = doc(db, "groups", groupId, "members", uid);
  const joinRequestRef = doc(db, "groups", groupId, "joinRequests", uid);
  const userMembershipRef = doc(db, "users", uid, "groupMemberships", groupId);

  const groupSummary = await getGroupMembershipSummary(groupId);
  const batch = writeBatch(db);

  batch.set(
    memberRef,
    {
      ...buildBaseMemberFields(uid, "active"),

      accessType: "legacy_free" as MembershipAccessType,
      requiresSubscription: false,
      subscriptionActive: false,
      legacyComplimentary: true,

      legacyGrantedAt: serverTimestamp(),
      joinedAt: serverTimestamp(),

      subscribedAt: deleteField(),
      subscriptionPriceMonthly: deleteField(),
      subscriptionCurrency: deleteField(),
    },
    { merge: true }
  );

  batch.set(
    userMembershipRef,
    {
      ...buildUserMembershipBaseFields({
        groupId,
        uid,
        status: "active",
        accessType: "legacy_free",
        requiresSubscription: false,
        subscriptionActive: false,
        groupSummary,
      }),

      legacyComplimentary: true,
      legacyGrantedAt: serverTimestamp(),
      joinedAt: serverTimestamp(),

      subscribedAt: deleteField(),
      subscriptionPriceMonthly: deleteField(),
      subscriptionCurrency: deleteField(),
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);

  await batch.commit();
}

export async function leaveGroup(groupId: string, uid: string) {
  const memberRef = doc(db, "groups", groupId, "members", uid);
  const userMembershipRef = doc(db, "users", uid, "groupMemberships", groupId);

  const batch = writeBatch(db);

  batch.delete(memberRef);
  batch.delete(userMembershipRef);

  await batch.commit();
}