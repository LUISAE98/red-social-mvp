import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  type Timestamp,
  type Unsubscribe,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { unblockGroupMemberForCurrentUser } from "@/lib/groups/groupMemberBlocks";
import { unblockUser } from "@/lib/social/social-service";

export type BlockedAccountUserSummary = {
  uid: string;
  displayName: string;
  handle: string | null;
  photoURL: string | null;
};

export type BlockedAccountGroupSummary = {
  groupId: string;
  name: string;
  avatarUrl: string | null;
  imageUrl: string | null;
};

export type BlockedProfileAccount = {
  id: string;
  type: "profile";
  blockedUserId: string;
  createdAt: Timestamp | null;
  user: BlockedAccountUserSummary;
};

export type BlockedGroupAccount = {
  id: string;
  type: "group";
  groupId: string;
  blockedUserId: string;
  blockerId: string;
  createdAt: Timestamp | null;
  user: BlockedAccountUserSummary;
  group: BlockedAccountGroupSummary;
};

export type BlockedAccountsState = {
  profileBlocks: BlockedProfileAccount[];
  groupBlocks: BlockedGroupAccount[];
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asTimestamp(value: unknown): Timestamp | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value as Timestamp;
  }

  return null;
}

function getUserDisplayName(data: Record<string, unknown>, fallbackUid: string) {
  return (
    asString(data.displayName) ??
    asString(data.name) ??
    asString(data.username) ??
    asString(data.handle) ??
    fallbackUid
  );
}

function getUserHandle(data: Record<string, unknown>) {
  const rawHandle =
    asString(data.handle) ??
    asString(data.username) ??
    asString(data.slug) ??
    null;

  return rawHandle ? rawHandle.replace(/^@+/, "") : null;
}

function getUserPhotoURL(data: Record<string, unknown>) {
  return (
    asString(data.photoURL) ??
    asString(data.avatarUrl) ??
    asString(data.imageUrl) ??
    null
  );
}

async function getUserSummary(
  uid: string
): Promise<BlockedAccountUserSummary> {
  const normalizedUid = uid.trim();

  if (!normalizedUid) {
    return {
      uid,
      displayName: "Usuario",
      handle: null,
      photoURL: null,
    };
  }

  try {
    const userSnap = await getDoc(doc(db, "users", normalizedUid));

    if (!userSnap.exists()) {
      return {
        uid: normalizedUid,
        displayName: "Usuario",
        handle: null,
        photoURL: null,
      };
    }

    const data = userSnap.data() as Record<string, unknown>;

    return {
      uid: normalizedUid,
      displayName: getUserDisplayName(data, normalizedUid),
      handle: getUserHandle(data),
      photoURL: getUserPhotoURL(data),
    };
  } catch {
    return {
      uid: normalizedUid,
      displayName: "Usuario",
      handle: null,
      photoURL: null,
    };
  }
}

function getGroupName(data: Record<string, unknown>, fallbackGroupId: string) {
  return (
    asString(data.groupName) ??
    asString(data.name) ??
    asString(data.title) ??
    fallbackGroupId
  );
}

function getGroupAvatarUrl(data: Record<string, unknown>) {
  return (
    asString(data.groupAvatarUrl) ??
    asString(data.avatarUrl) ??
    asString(data.imageUrl) ??
    null
  );
}

function getGroupImageUrl(data: Record<string, unknown>) {
  return (
    asString(data.groupImageUrl) ??
    asString(data.imageUrl) ??
    asString(data.coverUrl) ??
    null
  );
}

async function getGroupSummaryFromMembershipOrGroup(params: {
  currentUserId: string;
  groupId: string;
  membershipData?: Record<string, unknown>;
}): Promise<BlockedAccountGroupSummary> {
  const { currentUserId, groupId, membershipData } = params;

  if (membershipData) {
    const name = getGroupName(membershipData, groupId);
    const avatarUrl = getGroupAvatarUrl(membershipData);
    const imageUrl = getGroupImageUrl(membershipData);

    if (name !== groupId || avatarUrl || imageUrl) {
      return {
        groupId,
        name,
        avatarUrl,
        imageUrl,
      };
    }
  }

  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));

    if (!groupSnap.exists()) {
      return {
        groupId,
        name: groupId,
        avatarUrl: null,
        imageUrl: null,
      };
    }

    const groupData = groupSnap.data() as Record<string, unknown>;

    return {
      groupId,
      name: getGroupName(groupData, groupId),
      avatarUrl: getGroupAvatarUrl(groupData),
      imageUrl: getGroupImageUrl(groupData),
    };
  } catch {
    return {
      groupId,
      name: groupId,
      avatarUrl: null,
      imageUrl: null,
    };
  }
}

export function subscribeProfileBlockedAccounts(
  currentUserId: string,
  onChange: (accounts: BlockedProfileAccount[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const uid = currentUserId.trim();

  if (!uid) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    collection(db, "users", uid, "blockedUsers"),
    async (snapshot) => {
      const accounts = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const blockedUserId =
            asString(data.blockedUserId) ?? asString(docSnap.id) ?? docSnap.id;

          return {
            id: docSnap.id,
            type: "profile" as const,
            blockedUserId,
            createdAt: asTimestamp(data.createdAt),
            user: await getUserSummary(blockedUserId),
          };
        })
      );

      accounts.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });

      onChange(accounts);
    },
    (error) => {
      onError?.(error);
      onChange([]);
    }
  );
}

export function subscribeGroupBlockedAccounts(
  currentUserId: string,
  onChange: (accounts: BlockedGroupAccount[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const uid = currentUserId.trim();

  if (!uid) {
    onChange([]);
    return () => undefined;
  }

  let groupBlockUnsubscribes: Unsubscribe[] = [];
  let closed = false;

  const unsubscribeMemberships = onSnapshot(
    collection(db, "users", uid, "groupMemberships"),
    (membershipSnapshot) => {
      groupBlockUnsubscribes.forEach((unsubscribe) => unsubscribe());
      groupBlockUnsubscribes = [];

      if (membershipSnapshot.empty) {
        onChange([]);
        return;
      }

      const groupedResults = new Map<string, BlockedGroupAccount[]>();

      function emitCombinedResults() {
        const combined = Array.from(groupedResults.values()).flat();

        combined.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() ?? 0;
          const bTime = b.createdAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        });

        onChange(combined);
      }

      membershipSnapshot.docs.forEach((membershipDoc) => {
        const groupId = membershipDoc.id;
        const membershipData = membershipDoc.data() as Record<string, unknown>;

        const blocksQuery = query(
          collection(db, "groups", groupId, "memberBlocks"),
          where("blockerId", "==", uid)
        );

        const unsubscribeGroupBlocks = onSnapshot(
          blocksQuery,
          async (blocksSnapshot) => {
            if (closed) return;

            const group = await getGroupSummaryFromMembershipOrGroup({
              currentUserId: uid,
              groupId,
              membershipData,
            });

            const accounts = await Promise.all(
              blocksSnapshot.docs.map(async (blockDoc) => {
                const data = blockDoc.data() as Record<string, unknown>;
                const blockedUserId =
                  asString(data.blockedUserId) ??
                  asString(data.targetUserId) ??
                  "";

                return {
                  id: blockDoc.id,
                  type: "group" as const,
                  groupId,
                  blockedUserId,
                  blockerId: asString(data.blockerId) ?? uid,
                  createdAt: asTimestamp(data.createdAt),
                  user: await getUserSummary(blockedUserId),
                  group,
                };
              })
            );

            groupedResults.set(groupId, accounts);
            emitCombinedResults();
          },
          (error) => {
            groupedResults.set(groupId, []);
            emitCombinedResults();

            if (!error.message.toLowerCase().includes("permission")) {
              onError?.(error);
            }
          }
        );

        groupBlockUnsubscribes.push(unsubscribeGroupBlocks);
      });
    },
    (error) => {
      onError?.(error);
      onChange([]);
    }
  );

  return () => {
    closed = true;
    unsubscribeMemberships();
    groupBlockUnsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

export function subscribeBlockedAccounts(
  currentUserId: string,
  onChange: (state: BlockedAccountsState) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  let profileBlocks: BlockedProfileAccount[] = [];
  let groupBlocks: BlockedGroupAccount[] = [];

  function emit() {
    onChange({
      profileBlocks,
      groupBlocks,
    });
  }

  const unsubscribeProfileBlocks = subscribeProfileBlockedAccounts(
    currentUserId,
    (accounts) => {
      profileBlocks = accounts;
      emit();
    },
    onError
  );

  const unsubscribeGroupBlocks = subscribeGroupBlockedAccounts(
    currentUserId,
    (accounts) => {
      groupBlocks = accounts;
      emit();
    },
    onError
  );

  return () => {
    unsubscribeProfileBlocks();
    unsubscribeGroupBlocks();
  };
}

export async function getProfileBlockedAccounts(
  currentUserId: string
): Promise<BlockedProfileAccount[]> {
  const uid = currentUserId.trim();

  if (!uid) return [];

  const snapshot = await getDocs(collection(db, "users", uid, "blockedUsers"));

  const accounts = await Promise.all(
    snapshot.docs.map(async (docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const blockedUserId =
        asString(data.blockedUserId) ?? asString(docSnap.id) ?? docSnap.id;

      return {
        id: docSnap.id,
        type: "profile" as const,
        blockedUserId,
        createdAt: asTimestamp(data.createdAt),
        user: await getUserSummary(blockedUserId),
      };
    })
  );

  accounts.sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() ?? 0;
    const bTime = b.createdAt?.toMillis?.() ?? 0;
    return bTime - aTime;
  });

  return accounts;
}

export async function unblockProfileBlockedAccount(params: {
  currentUserId: string;
  blockedUserId: string;
}): Promise<void> {
  await unblockUser({
    currentUserId: params.currentUserId,
    targetUserId: params.blockedUserId,
  });
}

export async function unblockGroupBlockedAccount(params: {
  groupId: string;
  blockedUserId: string;
}): Promise<void> {
  await unblockGroupMemberForCurrentUser({
    groupId: params.groupId,
    targetUserId: params.blockedUserId,
  });
}