// Núcleo interno compartido del servicio de posts.
//
// Helpers "hoja": los usan varios dominios (queries, comentarios, creación) y no
// llaman de vuelta a las funciones de dominio, por eso viven aparte y se importan
// desde post-service.ts. Extraído para reducir el tamaño de ese módulo.
//
// Lote 1 — relaciones de bloqueo (usuario↔usuario y miembro↔miembro de comunidad)
// y su caché. La caché es un singleton de módulo (una sola instancia importada).

import {
  doc,
  getDoc,
  getDocs,
  query,
  collection,
  where,
  documentId,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getMyHiddenJoinedGroups } from "@/lib/groups/sidebarGroups";
import {
  pickString,
  chunkArray,
  truncateForShare,
  readGroupName,
  readGroupAvatarUrl,
  normalizeGroupVisibility,
  readProfileDisplayName,
  readProfileAvatarUrl,
  getTimestampDate,
  readTimestampMillis,
  normalizeCommentsEnabled,
  normalizePostingMode,
  type PostingMode,
} from "./post-service.helpers";
import type {
  Post,
  Comment,
  CommentReply,
  GroupMemberBlockRelationship,
  PostContextType,
  PostMedia,
} from "./types";
import type { GroupVisibility } from "@/types/group";

export type AuthorSnapshot = {
  uid: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorUsername: string | null;
};

export type UserProfileLookup = {
  displayName: string | null;
  avatarUrl: string | null;
  username: string | null;
};

export type GroupLookup = {
  name: string | null;
  avatarUrl: string | null;
  visibility: GroupVisibility | null;
};

export type ProfileLookup = {
  displayName: string | null;
  avatarUrl: string | null;
  username: string | null;
  profileRestricted: boolean;
  profileCommentsEnabled: boolean;
};

export async function userHasBlockedUser(
  blockerUid: string,
  blockedUid: string
): Promise<boolean> {
  if (!blockerUid.trim() || !blockedUid.trim()) {
    return false;
  }

  try {
    const snap = await getDoc(
      doc(db, "users", blockerUid, "blockedUsers", blockedUid)
    );

    return snap.exists();
  } catch {
    return false;
  }
}

export function getGroupMemberBlockDocId(blockerUid: string, blockedUid: string): string {
  return `${blockerUid}_${blockedUid}`;
}

export async function groupMemberBlockExists(params: {
  groupId: string;
  blockerUid: string;
  blockedUid: string;
}): Promise<boolean> {
  const groupId = params.groupId.trim();
  const blockerUid = params.blockerUid.trim();
  const blockedUid = params.blockedUid.trim();

  if (!groupId || !blockerUid || !blockedUid || blockerUid === blockedUid) {
    return false;
  }

  try {
    const snap = await getDoc(
      doc(
        db,
        "groups",
        groupId,
        "memberBlocks",
        getGroupMemberBlockDocId(blockerUid, blockedUid)
      )
    );

    return snap.exists();
  } catch {
    return false;
  }
}

export const blockRelationshipCache = new Map<
  string,
  { hasBlocked: boolean; isBlockedBy: boolean; expiresAt: number }
>();
export const BLOCK_CACHE_TTL_MS = 2 * 60 * 1000;

export async function fetchGroupMemberBlockRelationship(params: {
  groupId: string;
  viewerUid: string;
  targetUid: string;
}): Promise<GroupMemberBlockRelationship> {
  const groupId = params.groupId.trim();
  const viewerUid = params.viewerUid.trim();
  const targetUid = params.targetUid.trim();

  if (!groupId || !viewerUid || !targetUid || viewerUid === targetUid) {
    return {
      hasBlocked: false,
      isBlockedBy: false,
    };
  }

  const cacheKey = `${groupId}:${viewerUid}:${targetUid}`;
  const cached = blockRelationshipCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { hasBlocked: cached.hasBlocked, isBlockedBy: cached.isBlockedBy };
  }

  const [hasBlocked, isBlockedBy] = await Promise.all([
    groupMemberBlockExists({
      groupId,
      blockerUid: viewerUid,
      blockedUid: targetUid,
    }),
    groupMemberBlockExists({
      groupId,
      blockerUid: targetUid,
      blockedUid: viewerUid,
    }),
  ]);

  blockRelationshipCache.set(cacheKey, {
    hasBlocked,
    isBlockedBy,
    expiresAt: Date.now() + BLOCK_CACHE_TTL_MS,
  });

  return {
    hasBlocked,
    isBlockedBy,
  };
}

export async function assertNoGroupMemberBlockBetween(params: {
  groupId: string;
  viewerUid: string;
  targetUid: string;
  message?: string;
}): Promise<void> {
  const relationship = await fetchGroupMemberBlockRelationship({
    groupId: params.groupId,
    viewerUid: params.viewerUid,
    targetUid: params.targetUid,
  });

  if (relationship.hasBlocked || relationship.isBlockedBy) {
    throw new Error(
      params.message ?? "No puedes interactuar con este usuario en esta comunidad."
    );
  }
}

export async function attachViewerGroupMemberBlockState(
  posts: Post[],
  viewerUid?: string | null
): Promise<Post[]> {
  const uid = viewerUid || auth.currentUser?.uid || null;

  if (!uid || posts.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasBlockedAuthorInGroup: false,
      viewerIsBlockedByAuthorInGroup: false,
    }));
  }

  const relationshipKeys = Array.from(
    new Set(
      posts
        .map((post) => {
          const groupId =
            typeof post.groupId === "string" && post.groupId.trim().length > 0
              ? post.groupId.trim()
              : null;

          const authorId =
            typeof post.authorId === "string" && post.authorId.trim().length > 0
              ? post.authorId.trim()
              : null;

          if (
            post.contextType === "profile" ||
            !groupId ||
            !authorId ||
            authorId === uid
          ) {
            return null;
          }

          return `${groupId}__${authorId}`;
        })
        .filter((key): key is string => Boolean(key))
    )
  );

  const relationshipEntries = await Promise.all(
    relationshipKeys.map(async (key) => {
      const separatorIndex = key.indexOf("__");
      const groupId = key.slice(0, separatorIndex);
      const authorId = key.slice(separatorIndex + 2);

      const relationship = await fetchGroupMemberBlockRelationship({
        groupId,
        viewerUid: uid,
        targetUid: authorId,
      });

      return [key, relationship] as const;
    })
  );

  const relationshipMap = new Map(relationshipEntries);

  return posts.map((post) => {
    const groupId =
      typeof post.groupId === "string" && post.groupId.trim().length > 0
        ? post.groupId.trim()
        : null;

    const authorId =
      typeof post.authorId === "string" && post.authorId.trim().length > 0
        ? post.authorId.trim()
        : null;

    const relationship =
      groupId && authorId
        ? relationshipMap.get(`${groupId}__${authorId}`)
        : null;

    return {
      ...post,
      viewerHasBlockedAuthorInGroup: relationship?.hasBlocked ?? false,
      viewerIsBlockedByAuthorInGroup: relationship?.isBlockedBy ?? false,
    };
  });
}

export function filterPostsForViewerGroupMemberBlocks(posts: Post[]): Post[] {
  return posts.filter((post) => {
    if (post.contextType === "profile") {
      return true;
    }

    if (post.viewerHasBlockedAuthorInGroup === true) {
      return false;
    }

    if (post.viewerIsBlockedByAuthorInGroup === true) {
      return false;
    }

    return true;
  });
}

export async function attachViewerGroupMemberBlockStateToComments(params: {
  groupId: string | null;
  viewerUid?: string | null;
  comments: Comment[];
}): Promise<Comment[]> {
  const uid = params.viewerUid || auth.currentUser?.uid || null;
  const groupId = params.groupId?.trim() || null;

  if (!uid || !groupId || params.comments.length === 0) {
    return params.comments.map((comment) => ({
      ...comment,
      viewerHasBlockedAuthorInGroup: false,
      viewerIsBlockedByAuthorInGroup: false,
    }));
  }

  const relationshipEntries = await Promise.all(
    params.comments.map(async (comment) => {
      const authorId =
        typeof comment.authorId === "string" && comment.authorId.trim().length > 0
          ? comment.authorId.trim()
          : null;

      if (!authorId || authorId === uid) {
        return [
          comment.id,
          {
            hasBlocked: false,
            isBlockedBy: false,
          },
        ] as const;
      }

      const relationship = await fetchGroupMemberBlockRelationship({
        groupId,
        viewerUid: uid,
        targetUid: authorId,
      });

      return [comment.id, relationship] as const;
    })
  );

  const relationshipMap = new Map(relationshipEntries);

  return params.comments.map((comment) => {
    const relationship = relationshipMap.get(comment.id) ?? {
      hasBlocked: false,
      isBlockedBy: false,
    };

    return {
      ...comment,
      viewerHasBlockedAuthorInGroup: relationship.hasBlocked,
      viewerIsBlockedByAuthorInGroup: relationship.isBlockedBy,
    };
  });
}

export function filterCommentsForViewerGroupMemberBlocks(comments: Comment[]): Comment[] {
  return comments.filter((comment) => {
    if (comment.viewerHasBlockedAuthorInGroup === true) {
      return false;
    }

    if (comment.viewerIsBlockedByAuthorInGroup === true) {
      return false;
    }

    return true;
  });
}

export async function attachViewerGroupMemberBlockStateToReplies(params: {
  groupId: string | null;
  viewerUid?: string | null;
  replies: CommentReply[];
}): Promise<CommentReply[]> {
  const uid = params.viewerUid || auth.currentUser?.uid || null;
  const groupId = params.groupId?.trim() || null;

  if (!uid || !groupId || params.replies.length === 0) {
    return params.replies.map((reply) => ({
      ...reply,
      viewerHasBlockedAuthorInGroup: false,
      viewerIsBlockedByAuthorInGroup: false,
    }));
  }

  const relationshipEntries = await Promise.all(
    params.replies.map(async (reply) => {
      const authorId =
        typeof reply.authorId === "string" && reply.authorId.trim().length > 0
          ? reply.authorId.trim()
          : null;

      if (!authorId || authorId === uid) {
        return [
          reply.id,
          {
            hasBlocked: false,
            isBlockedBy: false,
          },
        ] as const;
      }

      const relationship = await fetchGroupMemberBlockRelationship({
        groupId,
        viewerUid: uid,
        targetUid: authorId,
      });

      return [reply.id, relationship] as const;
    })
  );

  const relationshipMap = new Map(relationshipEntries);

  return params.replies.map((reply) => {
    const relationship = relationshipMap.get(reply.id) ?? {
      hasBlocked: false,
      isBlockedBy: false,
    };

    return {
      ...reply,
      viewerHasBlockedAuthorInGroup: relationship.hasBlocked,
      viewerIsBlockedByAuthorInGroup: relationship.isBlockedBy,
    };
  });
}

export function filterRepliesForViewerGroupMemberBlocks(
  replies: CommentReply[]
): CommentReply[] {
  return replies.filter((reply) => {
    if (reply.viewerHasBlockedAuthorInGroup === true) {
      return false;
    }

    if (reply.viewerIsBlockedByAuthorInGroup === true) {
      return false;
    }

    return true;
  });
}

// ─── Lote 2 — lookups compartidos (autor actual, usuarios, grupos, perfil) ────
let _authorCache: { uid: string; data: AuthorSnapshot; expiresAt: number } | null = null;

export async function getCurrentAuthorSnapshot(): Promise<AuthorSnapshot> {
  // Esperar a que Auth complete su check inicial (carga desde IndexedDB).
  // Evita la carrera donde Firestore envía el request antes de que el token esté disponible.
  await auth.authStateReady();

  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error("Debes iniciar sesión para realizar esta acción.");
  }

  const uid = user.uid;

  if (_authorCache && _authorCache.uid === uid && _authorCache.expiresAt > Date.now()) {
    return _authorCache.data;
  }

  let userDocData: Record<string, unknown> | null = null;

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      userDocData = userSnap.data() as Record<string, unknown>;
    }
  } catch {
    userDocData = null;
  }

  const authorName =
    pickString(userDocData?.displayName) ||
    pickString(userDocData?.name) ||
    pickString(user.displayName) ||
    pickString(userDocData?.username) ||
    pickString(userDocData?.handle) ||
    "Usuario";

  const authorAvatarUrl =
    pickString(userDocData?.avatarUrl) ||
    pickString(userDocData?.photoURL) ||
    pickString(user.photoURL) ||
    null;

  const authorUsername =
    pickString(userDocData?.username) ||
    pickString(userDocData?.handle) ||
    null;

  const snapshot: AuthorSnapshot = { uid, authorName, authorAvatarUrl, authorUsername };
  _authorCache = { uid, data: snapshot, expiresAt: Date.now() + 5 * 60 * 1000 };
  return snapshot;
}

export async function fetchUsersByIds(
  userIds: string[]
): Promise<Record<string, UserProfileLookup>> {
  const uniqueIds = Array.from(
    new Set(userIds.map((id) => id.trim()).filter(Boolean))
  );

  if (uniqueIds.length === 0) {
    return {};
  }

  const result: Record<string, UserProfileLookup> = {};
  const chunks = chunkArray(uniqueIds, 30);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where(documentId(), "in", chunk))
        );
        snap.docs.forEach((userDoc) => {
          const data = userDoc.data() as Record<string, unknown>;
          result[userDoc.id] = {
            displayName: pickString(data.displayName) || pickString(data.name) || null,
            avatarUrl: pickString(data.avatarUrl) || pickString(data.photoURL) || null,
            username: pickString(data.username) || pickString(data.handle) || null,
          };
        });
      } catch {
        // Si un chunk falla, hydratePost cae en los datos del snapshot del post
      }
    })
  );

  return result;
}

export async function fetchGroupsByIds(
  groupIds: string[]
): Promise<Record<string, GroupLookup>> {
  const uniqueIds = Array.from(
    new Set(groupIds.map((id) => id.trim()).filter(Boolean))
  );

  if (uniqueIds.length === 0) {
    return {};
  }

  const result: Record<string, GroupLookup> = {};
  const chunks = chunkArray(uniqueIds, 30);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(collection(db, "groups"), where(documentId(), "in", chunk))
        );
        snap.docs.forEach((groupDoc) => {
          const data = groupDoc.data() as Record<string, unknown>;
          result[groupDoc.id] = {
            name: readGroupName(data),
            avatarUrl: readGroupAvatarUrl(data),
            visibility: normalizeGroupVisibility(data.visibility),
          };
        });
      } catch {
        // Si un chunk falla, hydratePost cae en los datos del snapshot del post
      }
    })
  );

  return result;
}


export function getPostGroupIds(posts: Post[]): string[] {
  return posts
    .map((post) => post.groupId)
    .filter(
      (groupId): groupId is string =>
        typeof groupId === "string" && groupId.trim().length > 0
    );
}
export async function fetchProfileById(profileId: string): Promise<ProfileLookup> {
  const snap = await getDoc(doc(db, "users", profileId));

  if (!snap.exists()) {
    throw new Error("El perfil no existe.");
  }

  const data = snap.data() as Record<string, unknown>;

  return {
    displayName: readProfileDisplayName(data),
    avatarUrl: readProfileAvatarUrl(data),
    username: pickString(data.username) || pickString(data.handle) || null,
    profileRestricted: data.profileRestricted === true,
    profileCommentsEnabled: data.profileCommentsEnabled !== false,
  };
}


// ─── Estado de acceso de un post (compartido por queries y saved) ─────────────
export function isPostLocked(post: Post): boolean {
  if (!post.accessModel) return false;
  if (post.accessModel === "free") {
    return false;
  }
  if (post.accessModel === "one_time_purchase") {
    return true;
  }
  return false;
}
