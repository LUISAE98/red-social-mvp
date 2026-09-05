import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { invalidarComunidadesOcultas } from "@/lib/groups/sidebarGroups";

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
  const groupName = params.groupSummary?.name ?? null;
  const groupDescription = params.groupSummary?.description ?? null;
  const groupImageUrl = params.groupSummary?.imageUrl ?? null;
  const groupAvatarUrl = params.groupSummary?.avatarUrl ?? null;
  const groupCoverUrl = params.groupSummary?.coverUrl ?? null;
  const groupOwnerId = params.groupSummary?.ownerId ?? null;
  const groupVisibility = params.groupSummary?.visibility ?? null;
  const groupDiscoverable = params.groupSummary?.discoverable ?? null;
  const groupIsActive = params.groupSummary?.isActive ?? null;
  const groupCategory = params.groupSummary?.category ?? null;

  return {
    groupId: params.groupId,
    userId: params.uid,

    roleInGroup: "member",
    status: params.status,
    accessType: params.accessType,
    requiresSubscription: params.requiresSubscription,
    subscriptionActive: params.subscriptionActive,

    groupName,
    groupDescription,
    groupImageUrl,
    groupAvatarUrl,
    groupCoverUrl,
    groupOwnerId,
    groupVisibility,
    groupDiscoverable,
    groupIsActive,
    groupCategory,

    name: groupName,
    description: groupDescription,
    imageUrl: groupImageUrl,
    avatarUrl: groupAvatarUrl,
    coverUrl: groupCoverUrl,
    ownerId: groupOwnerId,
    visibility: groupVisibility,
    discoverable: groupDiscoverable,
    isActive: groupIsActive,
    category: groupCategory,

    removedAt: deleteField(),
    removedBy: deleteField(),
    removedReason: deleteField(),
    removedDueToSubscriptionTransition: deleteField(),
    transitionPendingAction: false,
    transitionDirection: deleteField(),
    transitionResolvedAt: deleteField(),

    subscriptionEndedAt: deleteField(),
    subscriptionEndedBy: deleteField(),

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

  await batch.commit();
}

export async function joinGroupWithSubscription(
  groupId: string,
  uid: string,
  options?: JoinWithSubscriptionOptions
) {
  const memberRef = doc(db, "groups", groupId, "members", uid);
  const userMembershipRef = doc(db, "users", uid, "groupMemberships", groupId);
  const hiddenTransitionRef = doc(db, "users", uid, "hiddenGroupTransitions", groupId);

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
      subscriptionCurrency: options?.currency ?? SETTLEMENT_CURRENCY,
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
      subscriptionCurrency: options?.currency ?? SETTLEMENT_CURRENCY,
      subscribedAt: serverTimestamp(),
      joinedAt: serverTimestamp(),

      legacyGrantedAt: deleteField(),
      legacyGrantedBy: deleteField(),
      legacyComplimentary: deleteField(),
    },
    { merge: true }
  );

  // Limpia el recordatorio de transición pendiente si existía
  batch.delete(hiddenTransitionRef);

  await batch.commit();
}

export async function joinGroupAsLegacyFree(groupId: string, uid: string) {
  const memberRef = doc(db, "groups", groupId, "members", uid);
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


  await batch.commit();
}

export async function leaveGroup(groupId: string, uid: string) {
  const memberRef = doc(db, "groups", groupId, "members", uid);
  const userMembershipRef = doc(db, "users", uid, "groupMemberships", groupId);

  const batch = writeBatch(db);

  batch.delete(memberRef);
  batch.delete(userMembershipRef);

  await batch.commit();

  // Salir de una comunidad cambia la lista de ocultas a las que se pertenece, y
  // esa lista alimenta las consultas del feed. Sin esto habría que esperar a que
  // caduque su minuto para dejar de pedir publicaciones de un sitio del que ya
  // se salió.
  invalidarComunidadesOcultas();
}