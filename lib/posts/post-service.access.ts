// Acceso a grupos y permisos de comentario del servicio de posts.
// Extraído de post-service.internal.ts para mantenerlo bajo 1000 líneas.
// Importa de ./post-service.internal (blocks, que es hoja) → sin ciclo.

import {
  doc,
  getDoc,
  getDocs,
  query,
  collection,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getMyHiddenJoinedGroups } from "@/lib/groups/sidebarGroups";
import {
  pickString,
  getTimestampDate,
  readTimestampMillis,
  readGroupName,
  normalizeCommentsEnabled,
  normalizePostingMode,
  type PostingMode,
} from "./post-service.helpers";
import type { Post } from "./types";
import type { GroupVisibility } from "@/types/group";
import {
  assertNoGroupMemberBlockBetween,
  userHasBlockedUser,
  fetchProfileById,
} from "./post-service.internal";

export type GroupMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

export type GroupWriteAccess = {
  ownerId: string | null;
  isActive: boolean;
  postingMode: PostingMode;
  commentsEnabled: boolean;
  membershipStatus: GroupMemberStatus;
};
export const PROFILE_COMMENT_FOLLOW_WAIT_MS = 24 * 60 * 60 * 1000;


export async function assertNoProfileCommentBlock(
  viewerUid: string,
  profileId: string
): Promise<void> {
  const [viewerBlockedProfile, profileBlockedViewer] = await Promise.all([
    userHasBlockedUser(viewerUid, profileId),
    userHasBlockedUser(profileId, viewerUid),
  ]);

  if (viewerBlockedProfile || profileBlockedViewer) {
    throw new Error("No puedes comentar en este perfil.");
  }
}


export async function assertUserCanCommentOnProfilePost(params: {
  profileId: string;
  viewerUid: string;
}): Promise<void> {
  const profileId = params.profileId.trim();
  const viewerUid = params.viewerUid.trim();

  if (!profileId || !viewerUid) {
    throw new Error("No puedes comentar en este perfil.");
  }

  await assertNoProfileCommentBlock(viewerUid, profileId);

  if (profileId === viewerUid) {
    return;
  }

  const profile = await fetchProfileById(profileId);

  if (profile.profileRestricted) {
    throw new Error("No puedes comentar en este perfil.");
  }

  if (!profile.profileCommentsEnabled) {
    throw new Error("Solo el creador puede comentar en este perfil.");
  }

  const followSnap = await getDoc(
    doc(db, "users", viewerUid, "following", profileId)
  );

  if (!followSnap.exists()) {
    throw new Error("Debes seguir este perfil para comentar.");
  }

  const followData = followSnap.data() as Record<string, unknown>;
  const followedAtMillis = readTimestampMillis(followData.createdAt);

  if (!followedAtMillis) {
    throw new Error("Podrás comentar 24 horas después de seguir este perfil.");
  }

  const canCommentAt = followedAtMillis + PROFILE_COMMENT_FOLLOW_WAIT_MS;

  if (Date.now() < canCommentAt) {
    throw new Error("Podrás comentar 24 horas después de seguir este perfil.");
  }
}

export function resolveEffectiveMembershipStatus(
  rawStatus: unknown,
  mutedUntil: unknown
): GroupMemberStatus {
  const status =
    typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";

  if (status === "banned") return "banned";
  if (status === "removed") return "removed";
  if (status === "kicked") return "removed";
  if (status === "expelled") return "removed";

  if (status === "muted") {
    const until = getTimestampDate(mutedUntil);
    if (until && until.getTime() <= Date.now()) {
      return "active";
    }
    return "muted";
  }

  if (status === "subscribed") return "subscribed";
  if (status === "active") return "active";

  return "active";
}
export async function fetchOwnedGroupIds(userUid: string): Promise<string[]> {
  const q = query(collection(db, "groups"), where("ownerId", "==", userUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

export async function fetchMemberGroupIds(userUid: string): Promise<string[]> {
  if (!userUid.trim()) return [];

  const snap = await getDocs(
    collection(db, "users", userUid, "groupMemberships")
  );

  const groupIds = snap.docs
    .map((membershipDoc) => {
      const data = membershipDoc.data() as Record<string, unknown>;

      const status = resolveEffectiveMembershipStatus(
        data.status,
        data.mutedUntil
      );

      if (
        status !== "active" &&
        status !== "subscribed" &&
        status !== "muted"
      ) {
        return null;
      }

      return pickString(data.groupId) || membershipDoc.id;
    })
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  return Array.from(new Set(groupIds));
}
export async function fetchHiddenMemberGroupIds(userUid: string): Promise<string[]> {
  try {
    if (!userUid.trim()) return [];

    const rows = await getMyHiddenJoinedGroups();

    return rows
      .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function fetchAccessibleGroupIds(userUid: string): Promise<string[]> {
  const [ownedIds, memberIds, hiddenMemberIds] = await Promise.all([
    fetchOwnedGroupIds(userUid),
    fetchMemberGroupIds(userUid),
    fetchHiddenMemberGroupIds(userUid),
  ]);

  return Array.from(new Set([...ownedIds, ...memberIds, ...hiddenMemberIds]));
}

export async function getGroupWriteAccess(
  groupId: string,
  userUid: string
): Promise<GroupWriteAccess> {
  const groupRef = doc(db, "groups", groupId);
  const groupSnap = await getDoc(groupRef);

  if (!groupSnap.exists()) {
    throw new Error("La comunidad no existe.");
  }

  const groupData = groupSnap.data() as Record<string, unknown>;
  const ownerId = pickString(groupData.ownerId);

  const permissions =
    groupData.permissions && typeof groupData.permissions === "object"
      ? (groupData.permissions as Record<string, unknown>)
      : null;

  const postingMode = normalizePostingMode(
    permissions?.postingMode ?? groupData.postingMode
  );
  const commentsEnabled = normalizeCommentsEnabled(
    permissions?.commentsEnabled ?? groupData.commentsEnabled
  );
  const isActive = groupData.isActive !== false;

  if (ownerId === userUid) {
    return {
      ownerId,
      isActive,
      postingMode,
      commentsEnabled,
      membershipStatus: "active",
    };
  }

  const memberRef = doc(db, "groups", groupId, "members", userUid);
  const memberSnap = await getDoc(memberRef);

  if (!memberSnap.exists()) {
    throw new Error("Debes pertenecer a la comunidad para realizar esta acción.");
  }

  const memberData = memberSnap.data() as Record<string, unknown>;
  const membershipStatus = resolveEffectiveMembershipStatus(
    memberData.status,
    memberData.mutedUntil
  );

  return {
    ownerId,
    isActive,
    postingMode,
    commentsEnabled,
    membershipStatus,
  };
}

export function assertMembershipCanInteract(status: GroupMemberStatus) {
  if (status === "banned") {
    throw new Error(
      "No puedes realizar esta acción porque estás baneado de esta comunidad."
    );
  }

  if (status === "removed") {
    throw new Error(
      "No puedes realizar esta acción porque ya no perteneces a esta comunidad."
    );
  }

  if (status === "muted") {
    throw new Error(
      "No puedes realizar esta acción porque estás muteado en esta comunidad."
    );
  }

if (status !== "active" && status !== "subscribed") {
  throw new Error("No puedes realizar esta acción en esta comunidad.");
}
}

export async function ensureUserCanCommentInGroup(groupId: string, userUid: string) {
  const access = await getGroupWriteAccess(groupId, userUid);

  if (!access.isActive) {
    throw new Error("Esta comunidad está inactiva.");
  }

  if (access.ownerId === userUid) {
    return;
  }

  assertMembershipCanInteract(access.membershipStatus);

  if (!access.commentsEnabled) {
    throw new Error("Solo el creador puede comentar en esta comunidad.");
  }
}

export async function ensureUserCanCommentOnPost(
  postData: Record<string, unknown>,
  userUid: string
) {
  const contextType =
    postData.contextType === "profile" || pickString(postData.profileId)
      ? "profile"
      : "group";

  if (contextType === "group") {
    const groupId = pickString(postData.groupId);
    const postAuthorId = pickString(postData.authorId);

    if (!groupId) {
      throw new Error("La publicación no pertenece a una comunidad válida.");
    }

    await ensureUserCanCommentInGroup(groupId, userUid);

    if (postAuthorId && postAuthorId !== userUid) {
      await assertNoGroupMemberBlockBetween({
        groupId,
        viewerUid: userUid,
        targetUid: postAuthorId,
        message: "No puedes comentar esta publicación.",
      });
    }

    return;
  }

  const profileId = pickString(postData.profileId);

  if (!profileId) {
    throw new Error("La publicación no pertenece a un perfil válido.");
  }

  await assertUserCanCommentOnProfilePost({
    profileId,
    viewerUid: userUid,
  });
}

