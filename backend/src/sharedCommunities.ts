import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

const MAX_SHARED_COMMUNITIES = 50;

type MembershipData = {
  groupId?: string | null;
  status?: string | null;
  roleInGroup?: string | null;
  role?: string | null;
};

type GroupData = {
  name?: string | null;
  avatarUrl?: string | null;
  imageUrl?: string | null;
  coverUrl?: string | null;
  visibility?: string | null;
  ownerId?: string | null;
  isActive?: boolean | null;
};

type SharedCommunity = {
  id: string;
  name: string;
  avatarUrl: string | null;
  imageUrl: string | null;
  coverUrl: string | null;
  visibility: string | null;
  ownerId: string | null;
  viewerRole: string | null;
  profileRole: string | null;
};

function normalizeString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isSharedVisibleMembershipStatus(value: unknown): boolean {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "active";
  return status === "active" || status === "subscribed" || status === "muted";
}

function getRole(data: MembershipData): string | null {
  return normalizeNullableString(data.roleInGroup ?? data.role);
}

async function getUserVisibleCommunityMap(
  uid: string
): Promise<Map<string, MembershipData>> {
  const communities = new Map<string, MembershipData>();

  const indexedMembershipsSnap = await db
    .collection("users")
    .doc(uid)
    .collection("groupMemberships")
    .get();

  indexedMembershipsSnap.docs.forEach((doc) => {
    const data = (doc.data() ?? {}) as MembershipData;
    const groupId = normalizeString(data.groupId) || doc.id;

    if (!groupId) return;
    if (!isSharedVisibleMembershipStatus(data.status)) return;

    communities.set(groupId, {
      ...data,
      groupId,
    });
  });

  const ownedGroupsSnap = await db
    .collection("groups")
    .where("ownerId", "==", uid)
    .get();

  ownedGroupsSnap.docs.forEach((doc) => {
    const data = (doc.data() ?? {}) as GroupData;

    if (data.isActive === false) return;

    communities.set(doc.id, {
      groupId: doc.id,
      status: "active",
      roleInGroup: "owner",
      role: "owner",
    });
  });

  return communities;
}

export const getSharedCommunitiesWithProfile = onCall(
  {
    region: "us-central1",
    // Ver la nota extensa en sidebarGroups.ts: con la CPU por defecto la
    // concurrencia queda forzada a 1 y cada petición simultánea arranca una
    // instancia nueva, en frío. Esto NO es minInstances: no mantiene nada
    // encendido, solo deja que una instancia caliente sirva a muchos.
    cpu: 1,
    concurrency: 80,
  },
  async (request): Promise<{ communities: SharedCommunity[]; total: number }> => {
    const viewerUid = request.auth?.uid;

    if (!viewerUid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const profileUid = normalizeString(request.data?.profileUid);

    if (!profileUid) {
      throw new HttpsError("invalid-argument", "Falta profileUid.");
    }

    if (profileUid === viewerUid) {
      return {
        communities: [],
        total: 0,
      };
    }

    const [viewerCommunities, profileCommunities] = await Promise.all([
      getUserVisibleCommunityMap(viewerUid),
      getUserVisibleCommunityMap(profileUid),
    ]);

    const sharedGroupIds = Array.from(viewerCommunities.keys()).filter((groupId) =>
      profileCommunities.has(groupId)
    );

    if (sharedGroupIds.length === 0) {
      return {
        communities: [],
        total: 0,
      };
    }

    const limitedGroupIds = sharedGroupIds.slice(0, MAX_SHARED_COMMUNITIES);

    const groupSnaps = await Promise.all(
      limitedGroupIds.map((groupId) => db.collection("groups").doc(groupId).get())
    );

    const communities: SharedCommunity[] = [];

    groupSnaps.forEach((groupSnap) => {
      if (!groupSnap.exists) return;

      const groupData = (groupSnap.data() ?? {}) as GroupData;

      if (groupData.isActive === false) return;

      const viewerMembership = viewerCommunities.get(groupSnap.id);
      const profileMembership = profileCommunities.get(groupSnap.id);

      if (!viewerMembership || !profileMembership) return;

      communities.push({
        id: groupSnap.id,
        name: normalizeNullableString(groupData.name) ?? "Comunidad",
        avatarUrl:
          normalizeNullableString(groupData.avatarUrl) ??
          normalizeNullableString(groupData.imageUrl),
        imageUrl: normalizeNullableString(groupData.imageUrl),
        coverUrl: normalizeNullableString(groupData.coverUrl),
        visibility: normalizeNullableString(groupData.visibility),
        ownerId: normalizeNullableString(groupData.ownerId),
        viewerRole:
          normalizeString(groupData.ownerId) === viewerUid
            ? "owner"
            : getRole(viewerMembership),
        profileRole:
          normalizeString(groupData.ownerId) === profileUid
            ? "owner"
            : getRole(profileMembership),
      });
    });

    communities.sort((a, b) => a.name.localeCompare(b.name, "es"));

    return {
      communities,
      total: communities.length,
    };
  }
);