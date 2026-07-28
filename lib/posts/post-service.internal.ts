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

// ─── Lote 3 — hydration (mapeo de docs → Post/Comment + estado por-viewer) ────
export function hydratePost(
  raw: Post,
  userMap: Record<string, UserProfileLookup>,
  groupMap: Record<string, GroupLookup>
): Post {
  const profile = userMap[raw.authorId];
  const group = raw.groupId ? groupMap[raw.groupId] : undefined;

  return normalizePostMetadata({
    ...raw,
    authorName:
      profile?.displayName || raw.authorName || raw.authorId || "Usuario",
    authorAvatarUrl: profile?.avatarUrl ?? raw.authorAvatarUrl ?? null,
    authorUsername: profile?.username ?? raw.authorUsername ?? null,
    groupName: group?.name ?? raw.groupName ?? null,
    groupAvatarUrl: group?.avatarUrl ?? raw.groupAvatarUrl ?? null,
    groupVisibility: group?.visibility ?? raw.groupVisibility ?? null,
  });
}


export function getPostPrimaryShareImageUrl(post: {
  media?: PostMedia[];
  videoData?: { thumbnailUrl?: string | null } | null;
  playback?: { thumbnailUrl?: string | null } | null;
}): string | null {
  const firstMedia = Array.isArray(post.media) ? post.media[0] : null;

  return (
    firstMedia?.thumbnailUrl ||
    firstMedia?.url ||
    post.videoData?.thumbnailUrl ||
    post.playback?.thumbnailUrl ||
    null
  );
}

export function buildShareMetadata(params: {
  text: string;
  media?: PostMedia[];
  authorName?: string | null;
  contextType?: PostContextType | null;
  groupVisibility?: GroupVisibility | null;
  profileRestricted?: boolean | null;
  accessModel?: Post["accessModel"];
  requiresPayment?: boolean;
  requiresSubscription?: boolean;
  premium?: Post["premium"];
  videoData?: Post["videoData"];
  playback?: Post["playback"];
}): Pick<
  Post,
  | "isShareable"
  | "publicSlug"
  | "shareTitle"
  | "shareDescription"
  | "shareImageUrl"
> {
  const isFree =
    (params.accessModel ?? "free") === "free" &&
    params.requiresPayment !== true &&
    params.requiresSubscription !== true;

  const isPublicGroup =
    params.contextType !== "profile" && params.groupVisibility === "public";

  const isPublicProfile =
    params.contextType === "profile" && params.profileRestricted !== true;

  // Post premium con accessMode "public": visible fuera del grupo aunque sea privado
  const isPremiumPublic =
    params.premium?.enabled === true &&
    params.premium?.accessMode === "public" &&
    params.contextType !== "profile";

  const cleanText = params.text.trim();

  return {
    isShareable: (isFree && (isPublicGroup || isPublicProfile)) || isPremiumPublic,
    publicSlug: null,
    shareTitle: cleanText
      ? truncateForShare(cleanText, 80)
      : params.authorName
        ? `Publicación de ${params.authorName}`
        : "Publicación",
    shareDescription: cleanText ? truncateForShare(cleanText, 180) : null,
    shareImageUrl: getPostPrimaryShareImageUrl({
      media: params.media,
      videoData: params.videoData,
      playback: params.playback,
    }),
  };
}

export function normalizePostMetadata(post: Post): Post {
  const postType = post.postType ?? "text";

  const contextType: PostContextType =
    post.contextType === "profile" || post.profileId ? "profile" : "group";

  const shareMetadata = buildShareMetadata({
    text: post.text,
    media: post.media,
    authorName: post.authorName,
    contextType,
    groupVisibility: post.groupVisibility,
    profileRestricted: post.profileRestricted,
    accessModel: post.accessModel,
    requiresPayment: post.requiresPayment,
    requiresSubscription: post.requiresSubscription,
    premium: post.premium,
    videoData: post.videoData,
    playback: post.playback,
  });

  return {
    ...post,
    postType,
    contextType,

    groupId: post.groupId ?? null,
    groupName: post.groupName ?? null,
    groupAvatarUrl: post.groupAvatarUrl ?? null,
    groupVisibility: post.groupVisibility ?? null,

    profileId: post.profileId ?? null,
    profileName: post.profileName ?? null,
    profileAvatarUrl: post.profileAvatarUrl ?? null,
    profileUsername: post.profileUsername ?? null,
    profileRestricted: post.profileRestricted ?? null,

    isShareable:
      contextType === "profile"
        ? shareMetadata.isShareable
        : post.isShareable ?? shareMetadata.isShareable,
    publicSlug: post.publicSlug ?? shareMetadata.publicSlug,
    shareTitle: post.shareTitle ?? shareMetadata.shareTitle,
    shareDescription: post.shareDescription ?? shareMetadata.shareDescription,
    shareImageUrl: post.shareImageUrl ?? shareMetadata.shareImageUrl,

    premium: post.premium ?? null,

    access: post.access ?? "free",
    accessModel: post.accessModel ?? "free",
    accessScope: post.accessScope ?? contextType,
    requiresPayment: post.requiresPayment ?? false,
    requiresSubscription: post.requiresSubscription ?? false,
    oneTimePrice: post.oneTimePrice ?? null,
    currency: post.currency ?? null,
    purchaseType: post.purchaseType ?? null,

    media: Array.isArray(post.media) ? post.media : [],

counts: {
  comments: post.counts?.comments ?? 0,
  likes: post.counts?.likes ?? 0,
  saves: post.counts?.saves ?? 0,
},

    liveData: post.liveData ?? null,
    videoData: post.videoData ?? null,
    scheduledData: post.scheduledData ?? null,
    playback: post.playback ?? null,

processing: post.processing ?? {
  status: "none",
  provider: null,
  errorCode: null,
  errorMessage: null,
  updatedAt: null,
},

isPinnedInGroup: post.isPinnedInGroup ?? false,
groupPinnedAt: post.groupPinnedAt ?? null,
groupPinnedBy: post.groupPinnedBy ?? null,

isPinnedOnProfile: post.isPinnedOnProfile ?? false,
profilePinnedAt: post.profilePinnedAt ?? null,
profilePinnedBy: post.profilePinnedBy ?? null,
  };
}

export async function attachViewerFlameState(
  posts: Post[],
  viewerUid?: string | null
): Promise<Post[]> {
  const uid = viewerUid || auth.currentUser?.uid || null;

  if (!uid || posts.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasFlamed: false,
    }));
  }

  const uniquePostIds = Array.from(
    new Set(
      posts
        .map((post) => post.id)
        .filter(
          (postId): postId is string =>
            typeof postId === "string" && postId.trim().length > 0
        )
    )
  );

  if (uniquePostIds.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasFlamed: false,
    }));
  }

  const likedPostIds = new Set<string>();
  const chunks = chunkArray(uniquePostIds, 30);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "users", uid, "postFlames"),
            where(documentId(), "in", chunk)
          )
        );

        snap.docs.forEach((flameDoc) => {
          likedPostIds.add(flameDoc.id);
        });
      } catch {
        // Si falla una lectura por bloque, no rompemos el feed.
      }
    })
  );

  return posts.map((post) => ({
    ...post,
    viewerHasFlamed: likedPostIds.has(post.id),
  }));
}


export async function attachViewerSavedState(
  posts: Post[],
  viewerUid?: string | null
): Promise<Post[]> {
  const uid = viewerUid || auth.currentUser?.uid || null;

  if (!uid || posts.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasSaved: false,
    }));
  }

  const uniquePostIds = Array.from(
    new Set(
      posts
        .map((post) => post.id)
        .filter(
          (postId): postId is string =>
            typeof postId === "string" && postId.trim().length > 0
        )
    )
  );

  if (uniquePostIds.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasSaved: false,
    }));
  }

  const savedPostIds = new Set<string>();
  const chunks = chunkArray(uniquePostIds, 30);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "users", uid, "savedPosts"),
            where(documentId(), "in", chunk)
          )
        );

        snap.docs.forEach((savedDoc) => {
          savedPostIds.add(savedDoc.id);
        });
      } catch {
        // Si falla una lectura por bloque, no rompemos el feed.
      }
    })
  );

  return posts.map((post) => ({
    ...post,
    viewerHasSaved: savedPostIds.has(post.id),
  }));
}

export async function attachViewerPostState(
  posts: Post[],
  viewerUid?: string | null
): Promise<Post[]> {
  const withGroupMemberBlockState = await attachViewerGroupMemberBlockState(
    posts,
    viewerUid
  );

  const visiblePosts = filterPostsForViewerGroupMemberBlocks(
    withGroupMemberBlockState
  );

  // Flame y saved son independientes — se resuelven en paralelo
  const [withFlameState, withSavedState] = await Promise.all([
    attachViewerFlameState(visiblePosts, viewerUid),
    attachViewerSavedState(visiblePosts, viewerUid),
  ]);

  return withFlameState.map((post, i) => ({
    ...post,
    viewerHasSaved: withSavedState[i]?.viewerHasSaved ?? false,
  }));
}

export function hydrateComment(
  raw: Comment,
  userMap: Record<string, UserProfileLookup>
): Comment {
  const profile = userMap[raw.authorId];

  return {
    ...raw,
    authorName:
      profile?.displayName || raw.authorName || raw.authorId || "Usuario",
    authorAvatarUrl: profile?.avatarUrl ?? raw.authorAvatarUrl ?? null,
    authorUsername: profile?.username ?? raw.authorUsername ?? null,
    counts: {
      replies: raw.counts?.replies ?? 0,
      likes: raw.counts?.likes ?? 0,
    },
    viewerHasFlamed: raw.viewerHasFlamed ?? false,
    viewerHasBlockedAuthorInGroup: raw.viewerHasBlockedAuthorInGroup ?? false,
    viewerIsBlockedByAuthorInGroup: raw.viewerIsBlockedByAuthorInGroup ?? false,
  };
}

export async function attachViewerCommentFlameState(
  postId: string,
  comments: Comment[],
  viewerUid?: string | null
): Promise<Comment[]> {
  const uid = viewerUid || auth.currentUser?.uid || null;

  if (!uid || comments.length === 0) {
    return comments.map((comment) => ({
      ...comment,
      viewerHasFlamed: false,
    }));
  }

  const commentIds = Array.from(
    new Set(
      comments
        .map((comment) => comment.id)
        .filter(
          (commentId): commentId is string =>
            typeof commentId === "string" && commentId.trim().length > 0
        )
    )
  );

  if (commentIds.length === 0) {
    return comments.map((comment) => ({
      ...comment,
      viewerHasFlamed: false,
    }));
  }

  const likedCommentIds = new Set<string>();
  const chunks = chunkArray(commentIds, 30);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "users", uid, "commentFlames"),
            where("postId", "==", postId),
            where("commentId", "in", chunk)
          )
        );

        snap.docs.forEach((flameDoc) => {
          const data = flameDoc.data() as Record<string, unknown>;
          const flameCommentId =
            typeof data.commentId === "string" ? data.commentId.trim() : "";

          if (flameCommentId) {
            likedCommentIds.add(flameCommentId);
          }
        });
      } catch {
        // Si falla una lectura por bloque, no rompemos los comentarios.
      }
    })
  );

  return comments.map((comment) => ({
    ...comment,
    viewerHasFlamed: likedCommentIds.has(comment.id),
  }));
}


export function hydrateCommentReply(
  raw: CommentReply,
  userMap: Record<string, UserProfileLookup>
): CommentReply {
  const profile = userMap[raw.authorId];

  return {
    ...raw,
    authorName:
      profile?.displayName || raw.authorName || raw.authorId || "Usuario",
    authorAvatarUrl: profile?.avatarUrl ?? raw.authorAvatarUrl ?? null,
    authorUsername: profile?.username ?? raw.authorUsername ?? null,
    viewerHasBlockedAuthorInGroup: raw.viewerHasBlockedAuthorInGroup ?? false,
    viewerIsBlockedByAuthorInGroup: raw.viewerIsBlockedByAuthorInGroup ?? false,
  };
}


// ─── Lote 4 — acceso a grupos y permisos de comentario ───────────────────────
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
    throw new Error("Solo el dueño puede comentar en este perfil.");
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
    throw new Error("Solo el owner puede comentar en esta comunidad.");
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

