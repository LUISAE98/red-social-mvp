//post-service

import {
  addDoc,
  collection,
  setDoc,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db, functions } from "@/lib/firebase";
import { getMyHiddenJoinedGroups } from "@/lib/groups/sidebarGroups";
import {
  MAX_POST_IMAGES,
  MAX_POST_VIDEOS,
} from "./types";

import type {
  Comment,
  CommentReply,
  GroupMemberBlockRelationship,
  GroupVisibility,
  LiveVisibilityMode,
  Post,
  PostContextType,
  PostLiveData,
  PostMedia,
  PostPremium,
} from "./types";
import { httpsCallable } from "firebase/functions";
import { buildPostSearchIndex } from "./postSearchIndex";
import { buildPremiumAccessFields } from "./premium";

type AuthorSnapshot = {
  uid: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorUsername: string | null;
};

type UserProfileLookup = {
  displayName: string | null;
  avatarUrl: string | null;
  username: string | null;
};

type GroupLookup = {
  name: string | null;
  avatarUrl: string | null;
  visibility: GroupVisibility | null;
};

type ProfileLookup = {
  displayName: string | null;
  avatarUrl: string | null;
  username: string | null;
  profileRestricted: boolean;
  profileCommentsEnabled: boolean;
};

type PostCreationContext = {
  contextType: PostContextType;
  groupId: string | null;
  groupVisibility: GroupVisibility | null;
  groupName: string | null;
  groupAvatarUrl: string | null;
  profileId: string | null;
  profileName: string | null;
  profileAvatarUrl: string | null;
  profileUsername: string | null;
  profileRestricted: boolean | null;
};

type GroupMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;
type PostingMode = "members" | "owner_only";

type GroupWriteAccess = {
  ownerId: string | null;
  isActive: boolean;
  postingMode: PostingMode;
  commentsEnabled: boolean;
  membershipStatus: GroupMemberStatus;
};

type TogglePostFlameResponse = {
  liked: boolean;
  likes: number;
};

type TogglePostSaveResponse = {
  saved: boolean;
  delta: number;
  postId: string;
};

type ToggleCommentFlameResponse = {
  liked: boolean;
  likes: number;
};
type ToggleGroupPostPinResponse = {
  ok: boolean;
  postId: string;
  isPinnedInGroup: boolean;
};

type ToggleProfilePostPinResponse = {
  ok: boolean;
  postId: string;
  isPinnedOnProfile: boolean;
};

export type HomePostsPageCursor = {
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
};

export type HomePostsPageResult = {
  posts: Post[];
  cursor: HomePostsPageCursor | null;
  hasMore: boolean;
};

export type UserProfilePostsPageCursor = {
  lastCreatedAt: Timestamp | null;
  lastPostId: string | null;
};

export type UserProfilePostsPageResult = {
  posts: Post[];
  cursor: UserProfilePostsPageCursor | null;
  hasMore: boolean;
};

export type GroupPostsPageCursor = {
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
};

export type GroupPostsPageResult = {
  posts: Post[];
  cursor: GroupPostsPageCursor | null;
  hasMore: boolean;
};

export type SavedPostsPageCursor = {
  lastSavedDoc: QueryDocumentSnapshot<DocumentData> | null;
};

export type SavedPostsPageResult = {
  posts: Post[];
  cursor: SavedPostsPageCursor | null;
  hasMore: boolean;
};

export type PostFlameUser = {
  userId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
};

const POST_COMMENTS_CACHE = new Map<string, Comment[]>();
const COMMENT_REPLIES_CACHE = new Map<string, CommentReply[]>();

const PROFILE_COMMENT_FOLLOW_WAIT_MS = 24 * 60 * 60 * 1000;

async function userHasBlockedUser(
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

function getGroupMemberBlockDocId(blockerUid: string, blockedUid: string): string {
  return `${blockerUid}_${blockedUid}`;
}

async function groupMemberBlockExists(params: {
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

const blockRelationshipCache = new Map<
  string,
  { hasBlocked: boolean; isBlockedBy: boolean; expiresAt: number }
>();
const BLOCK_CACHE_TTL_MS = 2 * 60 * 1000;

async function fetchGroupMemberBlockRelationship(params: {
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

async function assertNoGroupMemberBlockBetween(params: {
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

async function attachViewerGroupMemberBlockState(
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

function filterPostsForViewerGroupMemberBlocks(posts: Post[]): Post[] {
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

async function attachViewerGroupMemberBlockStateToComments(params: {
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

function filterCommentsForViewerGroupMemberBlocks(comments: Comment[]): Comment[] {
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

async function attachViewerGroupMemberBlockStateToReplies(params: {
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

function filterRepliesForViewerGroupMemberBlocks(
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

async function assertNoProfileCommentBlock(
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

function readTimestampMillis(value: unknown): number | null {
  if (!value) return null;

  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as Timestamp).toMillis === "function"
  ) {
    const millis = (value as Timestamp).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    const millis = date.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const millis = new Date(value).getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  return null;
}

async function assertUserCanCommentOnProfilePost(params: {
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

function getCommentRepliesCacheKey(postId: string, commentId: string): string {
  return `${postId}__${commentId}`;
}

function clearPostCommentsCache(postId: string) {
  Array.from(POST_COMMENTS_CACHE.keys()).forEach((key) => {
    if (key.startsWith(`${postId}__`)) {
      POST_COMMENTS_CACHE.delete(key);
    }
  });
}

function clearCommentRepliesCache(postId: string, commentId: string) {
  COMMENT_REPLIES_CACHE.delete(getCommentRepliesCacheKey(postId, commentId));
}

function getPostCommentsCacheKey(postId: string, viewerUid?: string | null): string {
  return `${postId}__${viewerUid || "anon"}`;
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function assertValidId(value: string, label: string) {
  if (!value || !value.trim()) {
    throw new Error(`Falta ${label}.`);
  }
}

function normalizeGroupVisibility(value: unknown): GroupVisibility | null {
  if (value === "public" || value === "private" || value === "hidden") {
    return value;
  }
  return null;
}

function normalizePostingMode(value: unknown): PostingMode {
  return value === "owner_only" ? "owner_only" : "members";
}

function normalizeCommentsEnabled(value: unknown): boolean {
  return value !== false;
}

function readGroupName(data: Record<string, unknown>): string | null {
  return (
    pickString(data.name) ||
    pickString(data.title) ||
    pickString(data.groupName) ||
    pickString(data.displayName) ||
    null
  );
}

function readGroupAvatarUrl(data: Record<string, unknown>): string | null {
  return (
    pickString(data.avatarUrl) ||
    pickString(data.photoURL) ||
    pickString(data.imageUrl) ||
    pickString(data.groupAvatarUrl) ||
    null
  );
}

function getTimestampDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    const d = (value as { toDate: () => unknown }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function resolveEffectiveMembershipStatus(
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

async function getCurrentAuthorSnapshot(): Promise<AuthorSnapshot> {
  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error("Debes iniciar sesión para realizar esta acción.");
  }

  const uid = user.uid;
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

  return {
    uid,
    authorName,
    authorAvatarUrl,
    authorUsername,
  };
}

async function fetchUsersByIds(
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

async function fetchGroupsByIds(
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


function getPostGroupIds(posts: Post[]): string[] {
  return posts
    .map((post) => post.groupId)
    .filter(
      (groupId): groupId is string =>
        typeof groupId === "string" && groupId.trim().length > 0
    );
}

function readProfileDisplayName(data: Record<string, unknown>): string | null {
  return (
    pickString(data.displayName) ||
    pickString(data.name) ||
    [pickString(data.firstName), pickString(data.lastName)]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    pickString(data.username) ||
    pickString(data.handle) ||
    null
  );
}

function readProfileAvatarUrl(data: Record<string, unknown>): string | null {
  return (
    pickString(data.avatarUrl) ||
    pickString(data.photoURL) ||
    pickString(data.imageUrl) ||
    null
  );
}

async function fetchProfileById(profileId: string): Promise<ProfileLookup> {
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

async function resolvePostCreationContext(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  author: AuthorSnapshot;
}): Promise<PostCreationContext> {
  const contextType: PostContextType = params.contextType === "profile" ? "profile" : "group";

  if (contextType === "profile") {
    const profileId = pickString(params.profileId) || params.author.uid;

    if (profileId !== params.author.uid) {
      throw new Error("Solo puedes publicar en tu propio perfil.");
    }

    const profile = await fetchProfileById(profileId);

    return {
      contextType: "profile",
      groupId: null,
      groupVisibility: null,
      groupName: null,
      groupAvatarUrl: null,
      profileId,
      profileName: profile.displayName || params.author.authorName,
      profileAvatarUrl: profile.avatarUrl ?? params.author.authorAvatarUrl,
      profileUsername: profile.username ?? params.author.authorUsername,
      profileRestricted: profile.profileRestricted,
    };
  }

  const groupId = pickString(params.groupId);
  if (!groupId) {
    throw new Error("Falta groupId.");
  }

  // Una sola lectura paralela — antes eran 3 lecturas seriales (grupo → miembro → grupo de nuevo)
  const [groupSnap, memberSnap] = await Promise.all([
    getDoc(doc(db, "groups", groupId)),
    getDoc(doc(db, "groups", groupId, "members", params.author.uid)),
  ]);

  if (!groupSnap.exists()) {
    throw new Error("La comunidad no existe.");
  }

  const groupData = groupSnap.data() as Record<string, unknown>;
  const ownerId = pickString(groupData.ownerId);
  const isActive = groupData.isActive !== false;
  const permissions =
    groupData.permissions && typeof groupData.permissions === "object"
      ? (groupData.permissions as Record<string, unknown>)
      : null;
  const postingMode = normalizePostingMode(
    permissions?.postingMode ?? groupData.postingMode,
  );
  const groupVisibility = normalizeGroupVisibility(groupData.visibility);

  if (!isActive) {
    throw new Error("Esta comunidad está inactiva.");
  }

  if (ownerId !== params.author.uid) {
    if (!memberSnap.exists()) {
      throw new Error("Debes pertenecer a la comunidad para realizar esta acción.");
    }
    const memberData = memberSnap.data() as Record<string, unknown>;
    const membershipStatus = resolveEffectiveMembershipStatus(
      memberData.status,
      memberData.mutedUntil,
    );
    assertMembershipCanInteract(membershipStatus);

    if (postingMode === "owner_only") {
      throw new Error("Solo el owner puede publicar en esta comunidad.");
    }
  }

  if (!groupVisibility) {
    throw new Error("No se pudo resolver la visibilidad del grupo.");
  }

  return {
    contextType: "group",
    groupId,
    groupVisibility,
    groupName: readGroupName(groupData),
    groupAvatarUrl: readGroupAvatarUrl(groupData),
    profileId: null,
    profileName: null,
    profileAvatarUrl: null,
    profileUsername: null,
    profileRestricted: null,
  };
}

function buildPostContextPayload(context: PostCreationContext) {
  return {
    contextType: context.contextType,
    groupId: context.groupId,
    groupName: context.groupName,
    groupAvatarUrl: context.groupAvatarUrl,
    groupVisibility: context.groupVisibility,
    profileId: context.profileId,
    profileName: context.profileName,
    profileAvatarUrl: context.profileAvatarUrl,
    profileUsername: context.profileUsername,
    profileRestricted: context.profileRestricted,
  };
}

function buildPostSearchIndexForContext(params: {
  text: string;
  authorId: string;
  context: PostCreationContext;
  isDeleted: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  premium?: PostPremium | null;
}) {
  const premium = params.premium?.enabled === true ? params.premium : null;

  if (params.context.contextType === "group") {
    if (!params.context.groupId || !params.context.groupVisibility) {
      return null;
    }

    const groupSearch = buildPostSearchIndex({
      text: params.text,
      groupId: params.context.groupId,
      groupVisibility: params.context.groupVisibility,
      authorId: params.authorId,
      accessScope: "group",
      isDeleted: params.isDeleted,
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
    });

    return {
      ...groupSearch,
      contextType: "group" as const,
      premiumEnabled: premium?.enabled === true,
      premiumAccessMode: premium?.accessMode ?? null,
      premiumFreeFor: premium?.freeFor ?? null,
    };
  }

  const profileSearch = buildPostSearchIndex({
    text: params.text,
    groupId: "__profile__",
    groupVisibility: "public",
    authorId: params.authorId,
    accessScope: "profile",
    isDeleted: params.isDeleted,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  });

  return {
    ...profileSearch,
    contextType: "profile" as const,
    groupId: null,
    profileId: params.context.profileId,
    visibility: "public",
    accessScope: "profile" as const,
    premiumEnabled: premium?.enabled === true,
    premiumAccessMode: premium?.accessMode ?? null,
    premiumFreeFor: premium?.freeFor ?? null,
  };
}
function hydratePost(
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

function truncateForShare(value: string, maxLength = 160): string {
  const cleanValue = value.trim().replace(/\s+/g, " ");

  if (cleanValue.length <= maxLength) {
    return cleanValue;
  }

  return `${cleanValue.slice(0, maxLength - 1).trim()}…`;
}

function getPostPrimaryShareImageUrl(post: {
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

function buildShareMetadata(params: {
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

function normalizePostMetadata(post: Post): Post {
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

async function attachViewerFlameState(
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


async function attachViewerSavedState(
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

async function attachViewerPostState(
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

function hydrateComment(
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

async function attachViewerCommentFlameState(
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


function hydrateCommentReply(
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

async function fetchOwnedGroupIds(userUid: string): Promise<string[]> {
  const q = query(collection(db, "groups"), where("ownerId", "==", userUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

async function fetchMemberGroupIds(userUid: string): Promise<string[]> {
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
async function fetchHiddenMemberGroupIds(userUid: string): Promise<string[]> {
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

async function fetchAccessibleGroupIds(userUid: string): Promise<string[]> {
  const [ownedIds, memberIds, hiddenMemberIds] = await Promise.all([
    fetchOwnedGroupIds(userUid),
    fetchMemberGroupIds(userUid),
    fetchHiddenMemberGroupIds(userUid),
  ]);

  return Array.from(new Set([...ownedIds, ...memberIds, ...hiddenMemberIds]));
}

async function getGroupWriteAccess(
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

function assertMembershipCanInteract(status: GroupMemberStatus) {
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

async function ensureUserCanCommentInGroup(groupId: string, userUid: string) {
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

async function ensureUserCanCommentOnPost(
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

export async function fetchGroupPostsPage(params: {
  groupId: string;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.groupId, "groupId");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;
  const isFirstPage = !previousLastDoc;

  const [postsSnap, pinnedSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, "posts"),
        where("groupId", "==", params.groupId),
        where("isDeleted", "==", false),
        orderBy("createdAt", "desc"),
        ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
        limit(isFirstPage ? safePageSize + 1 : safePageSize)
      )
    ),
    isFirstPage
      ? getDocs(
          query(
            collection(db, "posts"),
            where("groupId", "==", params.groupId),
            where("isDeleted", "==", false),
            where("isPinnedInGroup", "==", true),
            orderBy("groupPinnedAt", "desc"),
            limit(1)
          )
        )
      : Promise.resolve(null),
  ]);

  const normalPosts: Post[] = postsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

  const pinnedPosts: Post[] =
    pinnedSnap?.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Post, "id">),
    })) ?? [];

  const rawPosts = Array.from(
    new Map([...pinnedPosts, ...normalPosts].map((post) => [post.id, post]))
      .values()
  );

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    params.viewerUid
  );

  const sortedPosts = sortPostsWithPinnedPriority(postsWithViewerState);

  const lastDoc = postsSnap.docs[postsSnap.docs.length - 1] ?? null;
  const hasMore = postsSnap.docs.length === safePageSize;

  return {
    posts: sortedPosts,
    cursor:
      hasMore && lastDoc
        ? {
            lastDoc,
          }
        : null,
    hasMore,
  };
}

export async function fetchGroupPublicPremiumPostsPage(params: {
  groupId: string;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.groupId, "groupId");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  const postsSnap = await getDocs(
    query(
      collection(db, "posts"),
      where("groupId", "==", params.groupId),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      where("premium.enabled", "==", true),
      where("premium.accessMode", "==", "public"),
      orderBy("createdAt", "desc"),
      ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
      limit(safePageSize + 1)
    )
  );

  const rawPosts: Post[] = postsSnap.docs.slice(0, safePageSize).map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);
    return { ...hydrated, isLocked: isPostLocked(hydrated) };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    params.viewerUid
  );

  const hasMore = postsSnap.docs.length > safePageSize;
  const lastDoc = postsSnap.docs[safePageSize - 1] ?? null;

  return {
    posts: postsWithViewerState,
    cursor: hasMore && lastDoc ? { lastDoc } : null,
    hasMore,
  };
}

export async function fetchGroupPublicPostsPage(params: {
  groupId: string;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.groupId, "groupId");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  const postsSnap = await getDocs(
    query(
      collection(db, "posts"),
      where("groupId", "==", params.groupId),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      orderBy("createdAt", "desc"),
      ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
      limit(safePageSize + 1)
    )
  );

  const rawPosts: Post[] = postsSnap.docs.slice(0, safePageSize).map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);
    return { ...hydrated, isLocked: isPostLocked(hydrated) };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    params.viewerUid
  );

  const hasMore = postsSnap.docs.length > safePageSize;
  const lastDoc = postsSnap.docs[safePageSize - 1] ?? null;

  return {
    posts: postsWithViewerState,
    cursor: hasMore && lastDoc ? { lastDoc } : null,
    hasMore,
  };
}

export async function fetchGroupPosts(
  groupId: string,
  viewerUid?: string | null
): Promise<Post[]> {
  const page = await fetchGroupPostsPage({
    groupId,
    viewerUid,
    pageSize: 10,
    cursor: null,
  });

  return page.posts;
}

function normalizeHomeFeedPostSnapshot(params: {
  feedDocId: string;
  feedData: Record<string, any>;
}): Post | null {
  const { feedDocId, feedData } = params;

  if (feedData.isVisible !== true) {
    return null;
  }

  const snapshot =
    feedData.postSnapshot && typeof feedData.postSnapshot === "object"
      ? (feedData.postSnapshot as Record<string, unknown>)
      : null;

  if (!snapshot) {
    return null;
  }

  const postId =
    pickString(feedData.postId) ||
    pickString((snapshot as Record<string, unknown>).id) ||
    feedDocId;

  if (!postId) {
    return null;
  }

  if (
    snapshot.isDeleted === true ||
    feedData.isDeleted === true ||
    Boolean(snapshot.deletedAt)
  ) {
    return null;
  }

  const authorId = pickString(snapshot.authorId) || pickString(feedData.authorId);

  if (!authorId) {
    return null;
  }

  const contextType: PostContextType =
    snapshot.contextType === "profile" ||
    feedData.sourceType === "profile" ||
    pickString(snapshot.profileId) ||
    pickString(feedData.profileId)
      ? "profile"
      : "group";

  const groupId =
    contextType === "group"
      ? pickString(snapshot.groupId) || pickString(feedData.groupId)
      : null;

  const profileId =
    contextType === "profile"
      ? pickString(snapshot.profileId) || pickString(feedData.profileId) || authorId
      : null;

  if (contextType === "group" && !groupId) {
    return null;
  }

  if (contextType === "profile" && !profileId) {
    return null;
  }

  return {
    id: postId,
    ...(snapshot as Omit<Post, "id">),
    contextType,
    groupId,
    profileId,
    authorId,
    canModerateGroupAuthor: feedData.canModerateGroupAuthor ?? false,
    authorMemberStatus: feedData.authorMemberStatus ?? null,
    authorMutedUntil: feedData.authorMutedUntil ?? null,
  } as Post;
}

export async function fetchHomePostsPage(params: {
  userUid: string;
  pageSize?: number;
  cursor?: HomePostsPageCursor | null;
}): Promise<HomePostsPageResult> {
  assertValidId(params.userUid, "userUid");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  const homeFeedSnap = await getDocs(
    query(
      collection(db, "users", params.userUid, "homeFeed"),
      where("isVisible", "==", true),
      orderBy("createdAt", "desc"),
      ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
      limit(safePageSize)
    )
  );

  const rawPosts = homeFeedSnap.docs
    .map((feedDoc) =>
      normalizeHomeFeedPostSnapshot({
        feedDocId: feedDoc.id,
        feedData: feedDoc.data() as Record<string, any>,
      })
    )
    .filter((post): post is Post => post !== null);

  const lastDoc = homeFeedSnap.docs[homeFeedSnap.docs.length - 1] ?? null;
  const hasMore =
    !homeFeedSnap.empty && homeFeedSnap.docs.length === safePageSize;

  if (rawPosts.length === 0) {
    return {
      posts: [],
      cursor:
        hasMore && lastDoc
          ? {
              lastDoc,
            }
          : null,
      hasMore,
    };
  }

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    params.userUid
  );

  return {
    posts: postsWithViewerState,
    cursor:
      hasMore && lastDoc
        ? {
            lastDoc,
          }
        : null,
    hasMore,
  };
}

export async function fetchHomePosts(userUid: string): Promise<Post[]> {
  const page = await fetchHomePostsPage({
    userUid,
    pageSize: 10,
    cursor: null,
  });

  return page.posts;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function isProfileRestricted(data: Record<string, unknown>): boolean {
  return data.profileRestricted === true;
}

function normalizeProfileFeedPost(
  snap: QueryDocumentSnapshot<DocumentData>
): Post {
  const data = snap.data() as Omit<Post, "id">;

  return {
    id: snap.id,
    ...data,
  } as Post;
}

async function fetchProfileFeedDocs(params: {
  profileUid: string;
  pageSize: number;
  cursor?: UserProfilePostsPageCursor | null;
  mode: "owner" | "public" | "groupIds" | "shareable_group_posts";
  groupIds?: string[];
}): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const postsRef = collection(db, "posts");

  const cursorParts =
    params.cursor?.lastCreatedAt && params.cursor?.lastPostId
      ? [startAfter(params.cursor.lastCreatedAt, params.cursor.lastPostId)]
      : [];

  if (params.mode === "owner") {
    const snap = await getDocs(
      query(
        postsRef,
        where("contextType", "==", "profile"),
        where("profileId", "==", params.profileUid),
        where("authorId", "==", params.profileUid),
        where("isDeleted", "==", false),
        orderBy("createdAt", "desc"),
        orderBy(documentId(), "desc"),
        ...cursorParts,
        limit(params.pageSize)
      )
    );

    return snap.docs;
  }

  if (params.mode === "public") {
    const snap = await getDocs(
      query(
        postsRef,
        where("contextType", "==", "profile"),
        where("profileId", "==", params.profileUid),
        where("authorId", "==", params.profileUid),
        where("isDeleted", "==", false),
        orderBy("createdAt", "desc"),
        orderBy(documentId(), "desc"),
        ...cursorParts,
        limit(params.pageSize)
      )
    );

    return snap.docs;
  }

  if (params.mode === "shareable_group_posts") {
    const snap = await getDocs(
      query(
        postsRef,
        where("authorId", "==", params.profileUid),
        where("contextType", "==", "group"),
        where("isDeleted", "==", false),
        where("isShareable", "==", true),
        orderBy("createdAt", "desc"),
        orderBy(documentId(), "desc"),
        ...cursorParts,
        limit(params.pageSize)
      )
    );
    return snap.docs;
  }

  const groupIds = Array.from(
    new Set(
      (params.groupIds || [])
        .map((groupId) => groupId.trim())
        .filter(Boolean)
    )
  );

  if (groupIds.length === 0) {
    return [];
  }

  const chunks = chunkArray(groupIds, 30);

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(
        query(
          postsRef,
          where("authorId", "==", params.profileUid),
          where("contextType", "==", "group"),
          where("isDeleted", "==", false),
          where("groupId", "in", chunk),
          orderBy("createdAt", "desc"),
          orderBy(documentId(), "desc"),
          ...cursorParts,
          limit(params.pageSize)
        )
      )
    )
  );

  return snaps.flatMap((snap) => snap.docs);
}

export async function fetchUserProfilePostsPage(params: {
  profileUid: string;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: UserProfilePostsPageCursor | null;
}): Promise<UserProfilePostsPageResult> {
  assertValidId(params.profileUid, "profileUid");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const viewerUid = params.viewerUid ?? auth.currentUser?.uid ?? null;
  const isOwner = viewerUid === params.profileUid;

  const profileSnap = await getDoc(doc(db, "users", params.profileUid));

  if (!profileSnap.exists()) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  const profileData = profileSnap.data() as Record<string, unknown>;
  const showPosts = profileData.showPosts !== false;
  const restricted = isProfileRestricted(profileData);

  if (!isOwner && (!showPosts || restricted)) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  let feedDocs: QueryDocumentSnapshot<DocumentData>[] = [];

  if (isOwner) {
    const profileDocsPromise = fetchProfileFeedDocs({
      profileUid: params.profileUid,
      pageSize: safePageSize + 1,
      cursor: params.cursor,
      mode: "owner",
    });

    const groupDocsPromise = fetchAccessibleGroupIds(params.profileUid)
      .then((groupIds) =>
        fetchProfileFeedDocs({
          profileUid: params.profileUid,
          pageSize: safePageSize + 1,
          cursor: params.cursor,
          mode: "groupIds",
          groupIds,
        })
      )
      .catch((error) => {
        console.warn("[ProfileFeed] owner group lane failed", error);
        return [];
      });

    const [profileDocs, groupDocs] = await Promise.all([
      profileDocsPromise,
      groupDocsPromise,
    ]);

    feedDocs = [...profileDocs, ...groupDocs];
  } else {
    const publicDocsPromise = fetchProfileFeedDocs({
      profileUid: params.profileUid,
      pageSize: safePageSize + 1,
      cursor: params.cursor,
      mode: "public",
    });

const privateDocsPromise = viewerUid
  ? Promise.allSettled([
  fetchOwnedGroupIds(viewerUid),
  fetchMemberGroupIds(viewerUid),
  fetchHiddenMemberGroupIds(viewerUid),
]).then((results) => {
  const ownedGroupIds =
    results[0].status === "fulfilled" ? results[0].value : [];

  const memberGroupIds =
    results[1].status === "fulfilled" ? results[1].value : [];

  const hiddenMemberGroupIds =
    results[2].status === "fulfilled" ? results[2].value : [];

  console.log("[ProfileFeed] accessible groupIds debug", {
    viewerUid,
    profileUid: params.profileUid,
    ownedGroupIds,
    memberGroupIds,
    hiddenMemberGroupIds,
    results,
  });

  const groupIds = Array.from(
    new Set([
      ...ownedGroupIds,
      ...memberGroupIds,
      ...hiddenMemberGroupIds,
    ])
  );

  return fetchProfileFeedDocs({
    profileUid: params.profileUid,
    pageSize: safePageSize + 1,
    cursor: params.cursor,
    mode: "groupIds",
    groupIds,
  });
})
.catch((error) => {
  console.warn("[ProfileFeed] private group lane failed", error);
  return [];
})
  : Promise.resolve([]);

    const shareableGroupDocsPromise = fetchProfileFeedDocs({
      profileUid: params.profileUid,
      pageSize: safePageSize + 1,
      cursor: params.cursor,
      mode: "shareable_group_posts",
    }).catch((error) => {
      console.warn("[ProfileFeed] shareable group lane failed", error);
      return [];
    });

    const [publicDocs, privateDocs, shareableGroupDocs] = await Promise.all([
      publicDocsPromise,
      privateDocsPromise,
      shareableGroupDocsPromise,
    ]);

    feedDocs = [...publicDocs, ...privateDocs, ...shareableGroupDocs];
  }

  const uniqueDocs = Array.from(
    new Map(feedDocs.map((feedDoc) => [feedDoc.id, feedDoc])).values()
  );

  uniqueDocs.sort((a, b) => {
    const aData = a.data() as Record<string, unknown>;
    const bData = b.data() as Record<string, unknown>;

    const aPinned = aData.isPinnedOnProfile === true;
    const bPinned = bData.isPinnedOnProfile === true;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    if (aPinned && bPinned) {
      const aPinnedMs =
        (aData.profilePinnedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      const bPinnedMs =
        (bData.profilePinnedAt as Timestamp | undefined)?.toMillis?.() ?? 0;

      if (aPinnedMs !== bPinnedMs) {
        return bPinnedMs - aPinnedMs;
      }
    }

    const aCreatedMs =
      (aData.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    const bCreatedMs =
      (bData.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;

    if (aCreatedMs !== bCreatedMs) {
      return bCreatedMs - aCreatedMs;
    }

    return b.id.localeCompare(a.id);
  });

  const pageDocs = uniqueDocs.slice(0, safePageSize);
  const hasMore = uniqueDocs.length > safePageSize;

  const rawPosts = pageDocs.map(normalizeProfileFeedPost);

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    viewerUid
  );

  const lastDoc = pageDocs[pageDocs.length - 1] ?? null;
  const lastData = lastDoc?.data() as Record<string, unknown> | undefined;
  const lastCreatedAt =
    lastData?.createdAt instanceof Timestamp ? lastData.createdAt : null;

  return {
    posts: postsWithViewerState,
    cursor:
      hasMore && lastDoc && lastCreatedAt
        ? {
            lastCreatedAt,
            lastPostId: lastDoc.id,
          }
        : null,
    hasMore,
  };
}

export async function fetchUserProfilePosts(
  profileUid: string,
  viewerUid?: string | null
): Promise<Post[]> {
  const page = await fetchUserProfilePostsPage({
    profileUid,
    viewerUid,
    pageSize: 10,
    cursor: null,
  });

  return page.posts;
}

async function enforcePostRateLimit(): Promise<void> {
  const fn = httpsCallable(functions, "checkRateLimitPost");
  try {
    await fn();
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Demasiadas publicaciones. Intenta más tarde.";
    throw new Error(msg);
  }
}

async function enforceCommentRateLimit(): Promise<void> {
  const fn = httpsCallable(functions, "checkRateLimitComment");
  try {
    await fn();
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Demasiados comentarios. Intenta más tarde.";
    throw new Error(msg);
  }
}

export async function createTextPost(params: {
  groupId: string;
  text: string;
}): Promise<string>;
export async function createTextPost(params: {
  contextType: "profile";
  profileId: string;
  text: string;
}): Promise<string>;
export async function createTextPost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  text: string;
}): Promise<string> {
  const cleanText = params.text.trim();
  if (!cleanText) {
    throw new Error("Escribe un texto antes de publicar.");
  }

  // Arrancar el rate limit inmediatamente — no necesita datos del autor
  const rateLimitPromise = enforcePostRateLimit();
  const author = await getCurrentAuthorSnapshot();
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    rateLimitPromise,
  ]);

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media: [],
    authorName: author.authorName,
    contextType: context.contextType,
    groupVisibility: context.groupVisibility,
    profileRestricted: context.profileRestricted,
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    videoData: null,
    playback: null,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  const ref = await addDoc(collection(db, "posts"), {
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,
    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,

    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,
    isShareable: shareMetadata.isShareable,
    publicSlug: shareMetadata.publicSlug,
    shareTitle: shareMetadata.shareTitle,
    shareDescription: shareMetadata.shareDescription,
    shareImageUrl: shareMetadata.shareImageUrl,
    access: "free",
    premium: null,
    media: [],
    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },
    search: buildPostSearchIndexForContext({
      text: cleanText,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
    }),
    postType: "text",

    accessModel: "free",
    accessScope: context.contextType,
    requiresPayment: false,
    requiresSubscription: false,
    oneTimePrice: null,
    currency: null,
    purchaseType: null,

    liveData: null,
    videoData: null,
    scheduledData: null,
    playback: null,

    processing: {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
  });
  return ref.id;
}

export async function createLivePost(params: {
  groupId: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  scheduledStartAt?: Date | null;
  visibilityMode?: LiveVisibilityMode | null;
  allowLoggedOutViewers?: boolean | null;
  accessType?: "free" | "paid" | null;
  ticketPrice?: number | null;
  currency?: "MXN" | "USD" | null;
  paidAccessMode?: "everyone_pays" | "members_free_non_members_pay" | null;
}): Promise<string>;
export async function createLivePost(params: {
  contextType: "profile";
  profileId: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  scheduledStartAt?: Date | null;
  visibilityMode?: LiveVisibilityMode | null;
  allowLoggedOutViewers?: boolean | null;
  accessType?: "free" | "paid" | null;
  ticketPrice?: number | null;
  currency?: "MXN" | "USD" | null;
  paidAccessMode?: "everyone_pays" | "members_free_non_members_pay" | null;
}): Promise<string>;
export async function createLivePost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  scheduledStartAt?: Date | null;
  visibilityMode?: LiveVisibilityMode | null;
  allowLoggedOutViewers?: boolean | null;
  accessType?: "free" | "paid" | null;
  ticketPrice?: number | null;
  currency?: "MXN" | "USD" | null;
  paidAccessMode?: "everyone_pays" | "members_free_non_members_pay" | null;
}): Promise<string> {
  const cleanTitle = params.title.trim();
  if (!cleanTitle) {
    throw new Error("El título del live es obligatorio.");
  }

  const rateLimitPromise = enforcePostRateLimit();
  const author = await getCurrentAuthorSnapshot();
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    rateLimitPromise,
  ]);

  const createdFrom: "profile" | "group" =
    context.contextType === "profile" ? "profile" : "group";

  const scheduledStartAt = params.scheduledStartAt
    ? Timestamp.fromDate(params.scheduledStartAt)
    : null;

  const effectiveMode: LiveVisibilityMode = params.visibilityMode ?? "everyone";
  const effectiveAccessType = params.accessType ?? "free";
  const isPaidLive = effectiveAccessType === "paid";

  const liveData: PostLiveData = {
    status: "upcoming",
    title: cleanTitle,
    description: params.description?.trim() || null,
    coverUrl: params.coverUrl ?? null,
    scheduledStartAt,
    startedAt: null,
    endedAt: null,
    streamProvider: null,
    liveStreamId: null,
    playbackId: null,
    streamKey: null,
    ingestUrl: null,
    createdFrom,
    visibilityMode: effectiveMode,
    allowLoggedOutViewers: effectiveMode === "everyone",
    accessType: effectiveAccessType,
    ticketPrice: isPaidLive ? (params.ticketPrice ?? null) : null,
    currency: isPaidLive ? (params.currency ?? "MXN") : null,
    paidAccessMode: isPaidLive ? (params.paidAccessMode ?? "everyone_pays") : null,
  };

  const isGroupLive = context.contextType !== "profile";
  const isProfileLive = context.contextType === "profile";
  const pinnedAt = serverTimestamp();

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  const ref = await addDoc(collection(db, "posts"), {
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanTitle,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,
    isPinnedInGroup: isGroupLive,
    groupPinnedAt: isGroupLive ? pinnedAt : null,
    groupPinnedBy: isGroupLive ? author.uid : null,
    isPinnedOnProfile: isProfileLive,
    profilePinnedAt: isProfileLive ? pinnedAt : null,
    profilePinnedBy: isProfileLive ? author.uid : null,
    isShareable: effectiveMode !== "members_only",
    publicSlug: null,
    shareTitle: cleanTitle,
    shareDescription: params.description?.trim() || null,
    shareImageUrl: params.coverUrl ?? null,
    access: "free",
    premium: null,
    media: [],
    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },
    search: buildPostSearchIndexForContext({
      text: cleanTitle,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
    }),
    postType: "live",
    accessModel: isPaidLive ? "paid" : "free",
    accessScope: context.contextType,
    requiresPayment: isPaidLive,
    requiresSubscription: false,
    oneTimePrice: isPaidLive ? (params.ticketPrice ?? null) : null,
    currency: isPaidLive ? (params.currency ?? "MXN") : null,
    purchaseType: isPaidLive ? "one_time" : null,
    liveData,
    videoData: null,
    scheduledData: null,
    playback: null,
    processing: {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
  });

  const postId = ref.id;

  // Auto-pin: desfijar cualquier post previamente fijado en el mismo contexto
  if (isGroupLive && params.groupId) {
    const prevPinnedSnap = await getDocs(
      query(
        collection(db, "posts"),
        where("groupId", "==", params.groupId),
        where("isDeleted", "==", false),
        where("isPinnedInGroup", "==", true),
        limit(5),
      ),
    );
    const toUnpin = prevPinnedSnap.docs.filter((d) => d.id !== postId);
    if (toUnpin.length > 0) {
      const batch = writeBatch(db);
      for (const d of toUnpin) {
        batch.update(d.ref, {
          isPinnedInGroup: false,
          groupPinnedAt: null,
          groupPinnedBy: null,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } else if (isProfileLive) {
    const profileId = params.profileId ?? author.uid;
    try {
      await setDoc(
        doc(db, "users", profileId, "profileFeed", postId),
        {
          postId,
          authorId: author.uid,
          isPinnedOnProfile: true,
          profilePinnedAt: Timestamp.now(),
          profilePinnedBy: author.uid,
          updatedAt: Timestamp.now(),
          syncedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } catch {
      // profileFeed is managed by Cloud Functions; client write may be denied
    }
  }

  return postId;
}

export async function createImagePost(params: {
  groupId: string;
  text?: string;
  media: PostMedia[];
}): Promise<void>;
export async function createImagePost(params: {
  contextType: "profile";
  profileId: string;
  text?: string;
  media: PostMedia[];
}): Promise<void>;
export async function createImagePost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  text?: string;
  media: PostMedia[];
}): Promise<void> {
  const cleanText = params.text?.trim() ?? "";
  const cleanMedia = Array.isArray(params.media)
    ? params.media.filter(
        (item) =>
          item.type === "image" &&
          typeof item.url === "string" &&
          item.url.trim().length > 0
      )
    : [];

  if (cleanMedia.length > MAX_POST_IMAGES) {
    throw new Error(`Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`);
  }

  if (!cleanText && cleanMedia.length === 0) {
    throw new Error("Agrega texto o una imagen antes de publicar.");
  }

  const author = await getCurrentAuthorSnapshot();
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    enforcePostRateLimit(),
  ]);

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media: cleanMedia,
    authorName: author.authorName,
    contextType: context.contextType,
    groupVisibility: context.groupVisibility,
    profileRestricted: context.profileRestricted,
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    videoData: null,
    playback: null,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  await addDoc(collection(db, "posts"), {
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,
    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,

    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,
    isShareable: shareMetadata.isShareable,
    publicSlug: shareMetadata.publicSlug,
    shareTitle: shareMetadata.shareTitle,
    shareDescription: shareMetadata.shareDescription,
    shareImageUrl: shareMetadata.shareImageUrl,
    access: "free",
    premium: null,
    media: cleanMedia,
    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },

    postType: cleanMedia.length > 0 ? "image" : "text",

    accessModel: "free",
    accessScope: context.contextType,
    requiresPayment: false,
    requiresSubscription: false,
    oneTimePrice: null,
    currency: null,
    purchaseType: null,

    liveData: null,
    videoData: null,
    scheduledData: null,
    playback: null,

    processing: {
      status: "ready",
      provider: "firebase_storage",
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
    search: buildPostSearchIndexForContext({
      text: cleanText,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
    }),
  });
}

export async function createMediaPost(params: {
  groupId: string;
  postId?: string;
  text?: string;
  imageMedia?: PostMedia[];
  videoUploads?: Array<{
    uploadId: string;
    mediaId: string;
    mediaIndex: number;
    thumbnailUrl?: string | null;
    thumbnailPath?: string | null;
  }>;
  premium?: PostPremium | null;
}): Promise<void>;
export async function createMediaPost(params: {
  contextType: "profile";
  profileId: string;
  postId?: string;
  text?: string;
  imageMedia?: PostMedia[];
  videoUploads?: Array<{
    uploadId: string;
    mediaId: string;
    mediaIndex: number;
    thumbnailUrl?: string | null;
    thumbnailPath?: string | null;
  }>;
  premium?: PostPremium | null;
}): Promise<void>;
export async function createMediaPost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  postId?: string;
  text?: string;
  imageMedia?: PostMedia[];
  videoUploads?: Array<{
    uploadId: string;
    mediaId: string;
    mediaIndex: number;
    thumbnailUrl?: string | null;
    thumbnailPath?: string | null;
  }>;
  premium?: PostPremium | null;
}): Promise<void> {
  if (params.postId) {
    assertValidId(params.postId, "postId");
  }

  const cleanText = params.text?.trim() ?? "";

  const cleanImageMedia = Array.isArray(params.imageMedia)
    ? params.imageMedia.filter(
        (item) =>
          item.type === "image" &&
          typeof item.url === "string" &&
          item.url.trim().length > 0
      )
    : [];

  const cleanVideoUploads = Array.isArray(params.videoUploads)
    ? params.videoUploads.filter(
        (item) =>
          typeof item.uploadId === "string" &&
          item.uploadId.trim().length > 0 &&
          typeof item.mediaId === "string" &&
          item.mediaId.trim().length > 0 &&
          Number.isInteger(item.mediaIndex) &&
          item.mediaIndex >= 0
      )
    : [];

  if (cleanImageMedia.length > MAX_POST_IMAGES) {
    throw new Error(`Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`);
  }

  if (cleanVideoUploads.length > MAX_POST_VIDEOS) {
    throw new Error("Puedes agregar máximo 3 videos por publicación.");
  }

  if (!cleanText && cleanImageMedia.length === 0 && cleanVideoUploads.length === 0) {
    throw new Error("Agrega texto, imagen o video antes de publicar.");
  }

  const author = await getCurrentAuthorSnapshot();
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    enforcePostRateLimit(),
  ]);

  const videoMedia: PostMedia[] = cleanVideoUploads.map((item) => ({
    type: "video",
    id: item.mediaId,
    index: item.mediaIndex,
    url: `mux://uploads/${item.uploadId}`,
    thumbnailUrl:
      typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim().length > 0
        ? item.thumbnailUrl.trim()
        : null,
    thumbnailPath:
      typeof item.thumbnailPath === "string" && item.thumbnailPath.trim().length > 0
        ? item.thumbnailPath.trim()
        : null,
    altText: null,
    provider: "mux",
    status: "uploading",
    uploadId: item.uploadId,
    assetId: null,
    playbackId: null,
    hlsUrl: null,
    duration: null,
  }));

  const media = [...cleanImageMedia, ...videoMedia].sort((a, b) => {
    const aIndex = typeof a.index === "number" ? a.index : Number.MAX_SAFE_INTEGER;
    const bIndex = typeof b.index === "number" ? b.index : Number.MAX_SAFE_INTEGER;

    return aIndex - bIndex;
  });

  const hasVideos = videoMedia.length > 0;
  const hasImages = cleanImageMedia.length > 0;

  const premiumAccessFields = buildPremiumAccessFields({
    premium: params.premium,
    hasVideos,
    context,
  });

  const firstVideo = videoMedia[0] ?? null;

  const videoData: Post["videoData"] = firstVideo
    ? {
        provider: "mux",
        status: "uploading",
        assetId: null,
        uploadId: firstVideo.uploadId ?? null,
        playbackId: null,
        duration: null,
        thumbnailUrl: firstVideo.thumbnailUrl ?? null,
        sourceUrl: null,
        sourcePath:
          typeof cleanVideoUploads[0]?.thumbnailPath === "string" &&
          cleanVideoUploads[0].thumbnailPath.trim().length > 0
            ? cleanVideoUploads[0].thumbnailPath.trim()
            : null,
      }
    : null;

  const playback: Post["playback"] = firstVideo
    ? {
        url: null,
        hlsUrl: null,
        thumbnailUrl: firstVideo.thumbnailUrl ?? null,
        provider: "mux",
        playbackId: null,
        duration: null,
        isReady: false,
      }
    : null;

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media,
    authorName: author.authorName,
    contextType: context.contextType,
    groupVisibility: context.groupVisibility,
    profileRestricted: context.profileRestricted,
    accessModel: premiumAccessFields.accessModel,
    requiresPayment: premiumAccessFields.requiresPayment,
    requiresSubscription: premiumAccessFields.requiresSubscription,
    premium: params.premium,
    videoData,
    playback,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  const postPayload = {
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,

    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,

    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,

    isShareable: shareMetadata.isShareable,
    publicSlug: shareMetadata.publicSlug,
    shareTitle: shareMetadata.shareTitle,
    shareDescription: shareMetadata.shareDescription,
    shareImageUrl: shareMetadata.shareImageUrl,

    ...premiumAccessFields,
    media,

    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },

    postType: hasVideos ? "video" : hasImages ? "image" : "text",

    accessScope: context.contextType,

    liveData: null,
    videoData,
    scheduledData: null,
    playback,

    processing: {
      status: hasVideos ? "uploading" : "ready",
      provider: hasVideos ? "mux" : hasImages ? "firebase_storage" : null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },

    search: buildPostSearchIndexForContext({
      text: cleanText,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
      premium: premiumAccessFields.premium,
    }),
  };

  if (params.postId) {
    await setDoc(doc(db, "posts", params.postId), postPayload, { merge: true });
    return;
  }

  await addDoc(collection(db, "posts"), postPayload);
}
export async function createVideoPost(params: {
  groupId: string;
  postId: string;
  uploadId: string;
  text?: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  premium?: PostPremium | null;
}): Promise<void>;
export async function createVideoPost(params: {
  contextType: "profile";
  profileId: string;
  postId: string;
  uploadId: string;
  text?: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  premium?: PostPremium | null;
}): Promise<void>;
export async function createVideoPost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  postId: string;
  uploadId: string;
  text?: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  premium?: PostPremium | null;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.uploadId, "uploadId");

  const cleanText = params.text?.trim() ?? "";
  const cleanThumbnailUrl =
    typeof params.thumbnailUrl === "string" && params.thumbnailUrl.trim().length > 0
      ? params.thumbnailUrl.trim()
      : null;
  const cleanThumbnailPath =
    typeof params.thumbnailPath === "string" && params.thumbnailPath.trim().length > 0
      ? params.thumbnailPath.trim()
      : null;

  const author = await getCurrentAuthorSnapshot();
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    enforcePostRateLimit(),
  ]);

  const premiumAccessFields = buildPremiumAccessFields({
    premium: params.premium,
    hasVideos: true,
    context,
  });

  const videoData: Post["videoData"] = {
    provider: "mux",
    status: "uploading",
    assetId: null,
    uploadId: params.uploadId,
    playbackId: null,
    duration: null,
    thumbnailUrl: cleanThumbnailUrl,
    sourceUrl: null,
    sourcePath: cleanThumbnailPath,
  };

  const playback: Post["playback"] = {
    url: null,
    hlsUrl: null,
    thumbnailUrl: cleanThumbnailUrl,
    provider: "mux",
    playbackId: null,
    duration: null,
    isReady: false,
  };

  const media: PostMedia[] = [
    {
      type: "video",
      id: params.postId,
      index: 0,
      url: `mux://uploads/${params.uploadId}`,
      thumbnailUrl: cleanThumbnailUrl,
      thumbnailPath: cleanThumbnailPath,
      altText: null,
      provider: "mux",
      status: "uploading",
      uploadId: params.uploadId,
      assetId: null,
      playbackId: null,
      hlsUrl: null,
      duration: null,
    },
  ];

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media,
    authorName: author.authorName,
    contextType: context.contextType,
    groupVisibility: context.groupVisibility,
    profileRestricted: context.profileRestricted,
    accessModel: premiumAccessFields.accessModel,
    requiresPayment: premiumAccessFields.requiresPayment,
    requiresSubscription: premiumAccessFields.requiresSubscription,
    premium: params.premium,
    videoData,
    playback,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  await setDoc(doc(db, "posts", params.postId), {
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,

    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,

    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,

    isShareable: shareMetadata.isShareable,
    publicSlug: shareMetadata.publicSlug,
    shareTitle: shareMetadata.shareTitle,
    shareDescription: shareMetadata.shareDescription,
    shareImageUrl: shareMetadata.shareImageUrl,

    ...premiumAccessFields,
    media,

    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },

    postType: "video",

    accessScope: context.contextType,

    liveData: null,
    videoData,
    scheduledData: null,
    playback,

    processing: {
      status: "uploading",
      provider: "mux",
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },

    search: buildPostSearchIndexForContext({
      text: cleanText,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
      premium: premiumAccessFields.premium,
    }),
  }, { merge: true });
}
export async function softDeletePost(postId: string): Promise<void> {
  assertValidId(postId, "postId");

  const user = auth.currentUser;

  if (!user?.uid) {
    throw new Error("Debes iniciar sesión para eliminar una publicación.");
  }

  const postRef = doc(db, "posts", postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error("La publicación no existe.");
  }

  const postData = postSnap.data() as Record<string, unknown>;

  if (postData.isDeleted === true) {
    return;
  }

  const updatedAt = serverTimestamp();

  await updateDoc(postRef, {
    isDeleted: true,
    deletedAt: updatedAt,
    deletedBy: user.uid,
    updatedAt,
    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,
    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,
    "search.isDeleted": true,
    "search.updatedAt": updatedAt,
  });
}

export async function fetchPostComments(postId: string): Promise<Comment[]> {
  assertValidId(postId, "postId");

  const viewerUid = auth.currentUser?.uid ?? null;
  const cacheKey = getPostCommentsCacheKey(postId, viewerUid);

  const cached = POST_COMMENTS_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const postSnap = await getDoc(doc(db, "posts", postId));

  if (!postSnap.exists()) {
    return [];
  }

  const postData = postSnap.data() as Record<string, unknown>;
  const groupId =
    postData.contextType === "profile" ? null : pickString(postData.groupId);

  const q = query(
    collection(db, "posts", postId, "comments"),
    orderBy("createdAt", "asc"),
    limit(30)
  );

  const snap = await getDocs(q);

  const rawComments: Comment[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Comment, "id">),
  }));

  const userMap = await fetchUsersByIds(
    rawComments.map((comment) => comment.authorId)
  );

  const hydratedComments = rawComments.map((comment) =>
    hydrateComment(comment, userMap)
  );

  const commentsWithGroupBlockState =
    await attachViewerGroupMemberBlockStateToComments({
      groupId,
      viewerUid,
      comments: hydratedComments,
    });

  const visibleComments = filterCommentsForViewerGroupMemberBlocks(
    commentsWithGroupBlockState
  );

  const commentsWithViewerState = await attachViewerCommentFlameState(
    postId,
    visibleComments,
    viewerUid
  );

  POST_COMMENTS_CACHE.set(cacheKey, commentsWithViewerState);

  return commentsWithViewerState;
}

export async function createPostComment(params: {
  postId: string;
  text: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");

  const cleanText = params.text.trim();
  if (!cleanText) {
    throw new Error("Escribe un comentario antes de enviar.");
  }

  const author = await getCurrentAuthorSnapshot();
  await enforceCommentRateLimit();
  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error("La publicación no existe.");
  }

  const postData = postSnap.data() as Record<string, unknown>;

  if (postData.isDeleted === true) {
    throw new Error("La publicación ya no está disponible.");
  }

  await ensureUserCanCommentOnPost(postData, author.uid);

  const postGroupId =
    postData.contextType !== "profile" ? pickString(postData.groupId) : null;
  const premiumData =
    postData.premium && typeof postData.premium === "object"
      ? (postData.premium as Record<string, unknown>)
      : null;

  let authorIsGroupMember: boolean | undefined;
  if (postGroupId && premiumData?.enabled === true) {
    if (author.uid === pickString(postData.authorId)) {
      authorIsGroupMember = true;
    } else {
      const memberSnap = await getDoc(
        doc(db, "groups", postGroupId, "members", author.uid)
      );
      const memberStatus = memberSnap.exists()
        ? pickString(memberSnap.data()?.status)
        : null;
      authorIsGroupMember =
        memberStatus === "active" || memberStatus === "subscribed";
    }
  }

await addDoc(collection(db, "posts", params.postId, "comments"), {
  authorId: author.uid,
  authorName: author.authorName,
  authorAvatarUrl: author.authorAvatarUrl,
  authorUsername: author.authorUsername,
  text: cleanText,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  counts: {
    replies: 0,
    likes: 0,
  },
  ...(authorIsGroupMember !== undefined ? { authorIsGroupMember } : {}),
});

await updateDoc(postRef, {
  "counts.comments": increment(1),
  updatedAt: serverTimestamp(),
});

clearPostCommentsCache(params.postId);
}

export async function deletePostComment(params: {
  postId: string;
  commentId: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);
  const commentSnap = await getDoc(commentRef);

  if (!commentSnap.exists()) {
    return;
  }

const postRef = doc(db, "posts", params.postId);
const postSnap = await getDoc(postRef);

if (!postSnap.exists()) {
  return;
}

const postData = postSnap.data() as Record<string, unknown>;
const currentCounts =
  postData.counts && typeof postData.counts === "object"
    ? (postData.counts as Record<string, unknown>)
    : {};

const currentComments =
  typeof currentCounts.comments === "number" ? currentCounts.comments : 0;

const currentLikes =
  typeof currentCounts.likes === "number" ? currentCounts.likes : 0;

const currentSaves =
  typeof currentCounts.saves === "number" ? currentCounts.saves : 0;

await deleteDoc(commentRef);

await updateDoc(postRef, {
  counts: {
    comments: Math.max(0, currentComments - 1),
    likes: currentLikes,
    saves: currentSaves,
  },
  updatedAt: serverTimestamp(),
});

clearPostCommentsCache(params.postId);
clearCommentRepliesCache(params.postId, params.commentId);
}

export async function fetchCommentReplies(params: {
  postId: string;
  commentId: string;
}): Promise<CommentReply[]> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const viewerUid = auth.currentUser?.uid ?? null;
  const cacheKey = getCommentRepliesCacheKey(params.postId, params.commentId);
  const cached = COMMENT_REPLIES_CACHE.get(cacheKey);

  if (cached) {
    return cached;
  }

  const postSnap = await getDoc(doc(db, "posts", params.postId));

  if (!postSnap.exists()) {
    return [];
  }

  const postData = postSnap.data() as Record<string, unknown>;
  const groupId =
    postData.contextType === "profile" ? null : pickString(postData.groupId);

  const q = query(
    collection(
      db,
      "posts",
      params.postId,
      "comments",
      params.commentId,
      "replies"
    ),
    orderBy("createdAt", "asc"),
    limit(30)
  );

  const snap = await getDocs(q);

  const rawReplies: CommentReply[] = snap.docs.map((d) => ({
    id: d.id,
    postId: params.postId,
    commentId: params.commentId,
    ...(d.data() as Omit<CommentReply, "id" | "postId" | "commentId">),
  }));

  const userMap = await fetchUsersByIds(
    rawReplies.map((reply) => reply.authorId)
  );

  const hydratedReplies = rawReplies.map((reply) =>
    hydrateCommentReply(reply, userMap)
  );

  const repliesWithGroupBlockState =
    await attachViewerGroupMemberBlockStateToReplies({
      groupId,
      viewerUid,
      replies: hydratedReplies,
    });

  const visibleReplies = filterRepliesForViewerGroupMemberBlocks(
    repliesWithGroupBlockState
  );

  COMMENT_REPLIES_CACHE.set(cacheKey, visibleReplies);

  return visibleReplies;
}


export async function createPostCommentReply(params: {
  postId: string;
  commentId: string;
  text: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const cleanText = params.text.trim();
  if (!cleanText) {
    throw new Error("Escribe una respuesta antes de enviar.");
  }

  const author = await getCurrentAuthorSnapshot();

  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error("La publicación no existe.");
  }

  const postData = postSnap.data() as Record<string, unknown>;

  if (postData.isDeleted === true) {
    throw new Error("La publicación ya no está disponible.");
  }

  await ensureUserCanCommentOnPost(postData, author.uid);

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);
  const commentSnap = await getDoc(commentRef);

  if (!commentSnap.exists()) {
    throw new Error("El comentario ya no existe.");
  }

  const commentData = commentSnap.data() as Record<string, unknown>;

  const groupId =
    postData.contextType === "profile" ? null : pickString(postData.groupId);

  const commentAuthorId = pickString(commentData.authorId);

  if (groupId && commentAuthorId && commentAuthorId !== author.uid) {
    await assertNoGroupMemberBlockBetween({
      groupId,
      viewerUid: author.uid,
      targetUid: commentAuthorId,
      message: "No puedes responder este comentario.",
    });
  }

  const replyPremiumData =
    postData.premium && typeof postData.premium === "object"
      ? (postData.premium as Record<string, unknown>)
      : null;

  let replyAuthorIsGroupMember: boolean | undefined;
  if (groupId && replyPremiumData?.enabled === true) {
    if (author.uid === pickString(postData.authorId)) {
      replyAuthorIsGroupMember = true;
    } else {
      const memberSnap = await getDoc(
        doc(db, "groups", groupId, "members", author.uid)
      );
      const memberStatus = memberSnap.exists()
        ? pickString(memberSnap.data()?.status)
        : null;
      replyAuthorIsGroupMember =
        memberStatus === "active" || memberStatus === "subscribed";
    }
  }

  const replyRef = doc(
    collection(db, "posts", params.postId, "comments", params.commentId, "replies")
  );

  await runTransaction(db, async (transaction) => {
    const freshPostSnap = await transaction.get(postRef);
    const freshCommentSnap = await transaction.get(commentRef);

    if (!freshPostSnap.exists()) {
      throw new Error("La publicación ya no existe.");
    }

    if (!freshCommentSnap.exists()) {
      throw new Error("El comentario ya no existe.");
    }

    const freshPostData = freshPostSnap.data() as Record<string, unknown>;
    const freshPostCounts =
      freshPostData.counts && typeof freshPostData.counts === "object"
        ? (freshPostData.counts as Record<string, unknown>)
        : {};

    const freshPostComments =
      typeof freshPostCounts.comments === "number" ? freshPostCounts.comments : 0;

    const freshPostLikes =
      typeof freshPostCounts.likes === "number" ? freshPostCounts.likes : 0;

    const freshPostSaves =
      typeof freshPostCounts.saves === "number" ? freshPostCounts.saves : 0;

    const freshCommentData = freshCommentSnap.data() as Record<string, unknown>;
    const freshCommentCounts =
      freshCommentData.counts && typeof freshCommentData.counts === "object"
        ? (freshCommentData.counts as Record<string, unknown>)
        : {};

    const freshReplies =
      typeof freshCommentCounts.replies === "number" ? freshCommentCounts.replies : 0;

    const freshCommentLikes =
      typeof freshCommentCounts.likes === "number" ? freshCommentCounts.likes : 0;

    transaction.set(replyRef, {
      postId: params.postId,
      commentId: params.commentId,
      authorId: author.uid,
      authorName: author.authorName,
      authorAvatarUrl: author.authorAvatarUrl,
      authorUsername: author.authorUsername,
      text: cleanText,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(replyAuthorIsGroupMember !== undefined
        ? { authorIsGroupMember: replyAuthorIsGroupMember }
        : {}),
    });

    transaction.update(commentRef, {
      counts: {
        replies: freshReplies + 1,
        likes: freshCommentLikes,
      },
      updatedAt: serverTimestamp(),
    });

    transaction.update(postRef, {
      counts: {
        comments: freshPostComments + 1,
        likes: freshPostLikes,
        saves: freshPostSaves,
      },
      updatedAt: serverTimestamp(),
    });
  });

  clearPostCommentsCache(params.postId);
  clearCommentRepliesCache(params.postId, params.commentId);
}

export async function deletePostCommentReply(params: {
  postId: string;
  commentId: string;
  replyId: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");
  assertValidId(params.replyId, "replyId");

  const replyRef = doc(
    db,
    "posts",
    params.postId,
    "comments",
    params.commentId,
    "replies",
    params.replyId
  );

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);
  const postRef = doc(db, "posts", params.postId);

  await runTransaction(db, async (transaction) => {
    const freshReplySnap = await transaction.get(replyRef);
    const freshCommentSnap = await transaction.get(commentRef);
    const freshPostSnap = await transaction.get(postRef);

    if (!freshReplySnap.exists()) {
      return;
    }

    if (!freshCommentSnap.exists()) {
      throw new Error("El comentario ya no existe.");
    }

    if (!freshPostSnap.exists()) {
      throw new Error("La publicación ya no existe.");
    }

    const freshCommentData = freshCommentSnap.data() as Record<string, unknown>;
    const freshCommentCounts =
      freshCommentData.counts && typeof freshCommentData.counts === "object"
        ? (freshCommentData.counts as Record<string, unknown>)
        : {};

    const freshReplies =
      typeof freshCommentCounts.replies === "number" ? freshCommentCounts.replies : 0;

    const freshCommentLikes =
      typeof freshCommentCounts.likes === "number" ? freshCommentCounts.likes : 0;

    const freshPostData = freshPostSnap.data() as Record<string, unknown>;
    const freshPostCounts =
      freshPostData.counts && typeof freshPostData.counts === "object"
        ? (freshPostData.counts as Record<string, unknown>)
        : {};

    const freshPostComments =
      typeof freshPostCounts.comments === "number" ? freshPostCounts.comments : 0;

    const freshPostLikes =
      typeof freshPostCounts.likes === "number" ? freshPostCounts.likes : 0;

    const freshPostSaves =
      typeof freshPostCounts.saves === "number" ? freshPostCounts.saves : 0;

    transaction.delete(replyRef);

    transaction.update(commentRef, {
      counts: {
        replies: Math.max(0, freshReplies - 1),
        likes: freshCommentLikes,
      },
      updatedAt: serverTimestamp(),
    });

    transaction.update(postRef, {
      counts: {
        comments: Math.max(0, freshPostComments - 1),
        likes: freshPostLikes,
        saves: freshPostSaves,
      },
      updatedAt: serverTimestamp(),
    });
  });

  clearPostCommentsCache(params.postId);
  clearCommentRepliesCache(params.postId, params.commentId);
}

export async function fetchPostFlameUsers(
  postId: string
): Promise<PostFlameUser[]> {
  assertValidId(postId, "postId");

  const snap = await getDocs(
    query(
      collection(db, "posts", postId, "reactions"),
      orderBy("createdAt", "desc"),
      limit(100)
    )
  );

  const userIds = snap.docs
    .map((reactionDoc) => {
      const data = reactionDoc.data() as Record<string, unknown>;
      return typeof data.userId === "string" ? data.userId.trim() : "";
    })
    .filter(Boolean);

  const userMap = await fetchUsersByIds(userIds);

  return userIds.map((userId) => {
    const profile = userMap[userId];

    return {
      userId,
      displayName: profile?.displayName || userId || "Usuario",
      username: profile?.username ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    };
  });
}

export async function togglePostFlame(
  postId: string
): Promise<TogglePostFlameResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión para reaccionar.");
  }

  const callable = httpsCallable<{ postId: string }, TogglePostFlameResponse>(
    functions,
    "togglePostFlame"
  );

  const result = await callable({ postId });

  const likes = Number(result.data?.likes ?? 0);

  return {
    liked: result.data?.liked === true,
    likes: Number.isFinite(likes) ? Math.max(0, likes) : 0,
  };
}

export async function togglePostSave(postId: string): Promise<TogglePostSaveResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión para guardar publicaciones.");
  }

  const callable = httpsCallable<{ postId: string }, TogglePostSaveResponse>(
    functions,
    "togglePostSave"
  );

  const result = await callable({ postId });

  return {
    saved: Boolean(result.data.saved),
    delta: Number(result.data.delta ?? 0),
    postId: String(result.data.postId || postId),
  };
}

export async function toggleGroupPostPin(
  postId: string
): Promise<ToggleGroupPostPinResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión.");
  }

  const callable = httpsCallable<
    { postId: string },
    ToggleGroupPostPinResponse
  >(functions, "toggleGroupPostPin");

  const result = await callable({ postId });

  return {
    ok: Boolean(result.data.ok),
    postId: String(result.data.postId || postId),
    isPinnedInGroup: Boolean(result.data.isPinnedInGroup),
  };
}

export async function toggleProfilePostPin(
  postId: string
): Promise<ToggleProfilePostPinResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión.");
  }

  const callable = httpsCallable<
    { postId: string },
    ToggleProfilePostPinResponse
  >(functions, "toggleProfilePostPin");

  const result = await callable({ postId });

  return {
    ok: Boolean(result.data.ok),
    postId: String(result.data.postId || postId),
    isPinnedOnProfile: Boolean(result.data.isPinnedOnProfile),
  };
}

export async function fetchSavedPostsPage(params: {
  userUid: string;
  pageSize?: number;
  cursor?: SavedPostsPageCursor | null;
}): Promise<SavedPostsPageResult> {
  assertValidId(params.userUid, "userUid");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastSavedDoc = params.cursor?.lastSavedDoc ?? null;

  const savedSnap = await getDocs(
    query(
      collection(db, "users", params.userUid, "savedPosts"),
      orderBy("savedAt", "desc"),
      ...(previousLastSavedDoc ? [startAfter(previousLastSavedDoc)] : []),
      limit(safePageSize)
    )
  );

  if (savedSnap.empty) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  const savedPostIds = savedSnap.docs
    .map((savedDoc) => {
      const data = savedDoc.data() as Record<string, unknown>;

      const postIdFromData =
        typeof data.postId === "string" && data.postId.trim().length > 0
          ? data.postId.trim()
          : null;

      return postIdFromData || savedDoc.id;
    })
    .filter((postId) => postId.trim().length > 0);

  const postsByIdMap = new Map<string, Post>();

  const savedChunks = chunkArray(savedPostIds, 30);
  await Promise.all(
    savedChunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(collection(db, "posts"), where(documentId(), "in", chunk))
        );
        snap.docs.forEach((postDoc) => {
          const post = {
            id: postDoc.id,
            ...(postDoc.data() as Omit<Post, "id">),
          } as Post;
          if (post.isDeleted !== true) {
            postsByIdMap.set(postDoc.id, post);
          }
        });
      } catch {
        // Si un chunk falla, se omite silenciosamente
      }
    })
  );

  // Preservar el orden de savedAt del cursor
  const visiblePosts = savedPostIds
    .map((postId) => postsByIdMap.get(postId) ?? null)
    .filter((post): post is Post => Boolean(post));

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(visiblePosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(visiblePosts)),
  ]);

  const hydratedPosts = visiblePosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      viewerHasSaved: true,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithGroupMemberBlockState = await attachViewerGroupMemberBlockState(
    hydratedPosts,
    params.userUid
  );

  const visibleSavedPosts = filterPostsForViewerGroupMemberBlocks(
    postsWithGroupMemberBlockState
  );

  const postsWithFlameState = await attachViewerFlameState(
    visibleSavedPosts,
    params.userUid
  );

  const lastSavedDoc = savedSnap.docs[savedSnap.docs.length - 1] ?? null;
  const hasMore = savedSnap.docs.length === safePageSize;

  return {
    posts: postsWithFlameState,
    cursor:
      hasMore && lastSavedDoc
        ? {
            lastSavedDoc,
          }
        : null,
    hasMore,
  };
}

export async function fetchSavedPosts(userUid: string): Promise<Post[]> {
  assertValidId(userUid, "userUid");

  const allPosts: Post[] = [];
  let cursor: SavedPostsPageCursor | null = null;
  let hasMore = true;

  while (hasMore && allPosts.length < 100) {
    const page = await fetchSavedPostsPage({
      userUid,
      pageSize: 20,
      cursor,
    });

    allPosts.push(...page.posts);
    cursor = page.cursor;
    hasMore = page.hasMore;
  }

  return allPosts.slice(0, 100);
}

export async function toggleCommentFlame(params: {
  postId: string;
  commentId: string;
}): Promise<ToggleCommentFlameResponse> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión para reaccionar.");
  }

  const callable = httpsCallable<
    { postId: string; commentId: string },
    ToggleCommentFlameResponse
  >(functions, "toggleCommentFlame");

  const result = await callable({
    postId: params.postId,
    commentId: params.commentId,
  });

  clearPostCommentsCache(params.postId);

  return {
    liked: Boolean(result.data.liked),
    likes: Number(result.data.likes ?? 0),
  };
}

function sortPostsWithPinnedPriority(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const aPinned = a.isPinnedInGroup === true || a.isPinnedOnProfile === true;
    const bPinned = b.isPinnedInGroup === true || b.isPinnedOnProfile === true;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    const aPinnedAt =
      a.groupPinnedAt?.toMillis?.() ??
      a.profilePinnedAt?.toMillis?.() ??
      0;

    const bPinnedAt =
      b.groupPinnedAt?.toMillis?.() ??
      b.profilePinnedAt?.toMillis?.() ??
      0;

    if (aPinned && bPinned && aPinnedAt !== bPinnedAt) {
      return bPinnedAt - aPinnedAt;
    }

    const aCreatedAt = a.createdAt?.toMillis?.() ?? 0;
    const bCreatedAt = b.createdAt?.toMillis?.() ?? 0;

    return bCreatedAt - aCreatedAt;
  });
}

function isPostLocked(post: Post): boolean {
  if (!post.accessModel) return false;

  if (post.accessModel === "free") {
    return false;
  }

  if (post.accessModel === "one_time_purchase") {
    return true;
  }

  return false;
}

// ─── Edición de posts ──────────────────────────────────────────────────────────

export async function updatePost(params: {
  postId: string;
  text: string;
  media: PostMedia[];
  premium?: PostPremium | null;
}): Promise<void> {
  const author = auth.currentUser;
  if (!author) throw new Error("Debes iniciar sesión para editar publicaciones.");

  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) throw new Error("La publicación no existe.");

  const postData = postSnap.data() as Post;

  if (postData.authorId !== author.uid) {
    throw new Error("Solo el autor puede editar esta publicación.");
  }

  if (postData.isDeleted) {
    throw new Error("No se puede editar una publicación eliminada.");
  }

  // Guardar historial antes de modificar
  const historyRef = doc(collection(db, "posts", params.postId, "editHistory"));
  await setDoc(historyRef, {
    editedAt: serverTimestamp(),
    editedBy: author.uid,
    previousText: postData.text ?? "",
    previousMedia: Array.isArray(postData.media) ? postData.media : [],
  });

  const cleanText = typeof params.text === "string" ? params.text.trim() : "";
  const cleanMedia = Array.isArray(params.media)
    ? params.media.filter(
        (item) => typeof item.url === "string" && item.url.trim().length > 0,
      )
    : [];

  const updatePayload: Record<string, unknown> = {
    text: cleanText,
    media: cleanMedia,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (params.premium !== undefined) {
    updatePayload.premium = params.premium ?? null;
  }

  await updateDoc(postRef, updatePayload);
}

export async function updateLivePost(params: {
  postId: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  scheduledStartAt?: Date | null;
  visibilityMode?: LiveVisibilityMode | null;
  accessType?: "free" | "paid" | null;
  ticketPrice?: number | null;
  currency?: "MXN" | "USD" | null;
  paidAccessMode?: "everyone_pays" | "members_free_non_members_pay" | null;
}): Promise<void> {
  const author = auth.currentUser;
  if (!author) throw new Error("Debes iniciar sesión para editar el live.");

  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);
  if (!postSnap.exists()) throw new Error("El live no existe.");
  const postData = postSnap.data() as Post;

  if (postData.authorId !== author.uid) throw new Error("Solo el autor puede editar este live.");
  if (postData.isDeleted) throw new Error("No se puede editar un live eliminado.");

  const cleanTitle = params.title.trim();
  if (!cleanTitle) throw new Error("El título del live es obligatorio.");

  const effectiveMode: LiveVisibilityMode = params.visibilityMode ?? "everyone";
  const effectiveAccessType = params.accessType ?? "free";
  const isPaidLive = effectiveAccessType === "paid";
  const scheduledStartAt = params.scheduledStartAt
    ? Timestamp.fromDate(params.scheduledStartAt)
    : null;

  await updateDoc(postRef, {
    text: cleanTitle,
    shareTitle: cleanTitle,
    shareDescription: params.description?.trim() || null,
    shareImageUrl: params.coverUrl ?? null,
    isShareable: effectiveMode !== "members_only",
    requiresPayment: isPaidLive,
    accessModel: isPaidLive ? "paid" : "free",
    oneTimePrice: isPaidLive ? (params.ticketPrice ?? null) : null,
    currency: isPaidLive ? (params.currency ?? "MXN") : null,
    purchaseType: isPaidLive ? "one_time" : null,
    "liveData.title": cleanTitle,
    "liveData.description": params.description?.trim() || null,
    "liveData.coverUrl": params.coverUrl ?? null,
    "liveData.scheduledStartAt": scheduledStartAt,
    "liveData.visibilityMode": effectiveMode,
    "liveData.allowLoggedOutViewers": effectiveMode === "everyone",
    "liveData.accessType": effectiveAccessType,
    "liveData.ticketPrice": isPaidLive ? (params.ticketPrice ?? null) : null,
    "liveData.currency": isPaidLive ? (params.currency ?? "MXN") : null,
    "liveData.paidAccessMode": isPaidLive ? (params.paidAccessMode ?? "everyone_pays") : null,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ─── Edición de comentarios y respuestas ───────────────────────────────────────

export async function updatePostComment(params: {
  postId: string;
  commentId: string;
  text: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const cleanText = params.text.trim();
  if (!cleanText) throw new Error("El comentario no puede estar vacío.");
  if (cleanText.length > 2000) throw new Error("El comentario es demasiado largo.");

  const author = auth.currentUser;
  if (!author) throw new Error("Debes iniciar sesión para editar comentarios.");

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);
  const commentSnap = await getDoc(commentRef);

  if (!commentSnap.exists()) throw new Error("El comentario no existe.");

  const commentData = commentSnap.data() as Record<string, unknown>;
  if (commentData.authorId !== author.uid) {
    throw new Error("Solo el autor puede editar este comentario.");
  }

  const historyRef = doc(
    collection(db, "posts", params.postId, "comments", params.commentId, "editHistory")
  );
  await setDoc(historyRef, {
    editedAt: serverTimestamp(),
    editedBy: author.uid,
    previousText: commentData.text ?? "",
  });

  await updateDoc(commentRef, {
    text: cleanText,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  clearPostCommentsCache(params.postId);
}

export async function updatePostCommentReply(params: {
  postId: string;
  commentId: string;
  replyId: string;
  text: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");
  assertValidId(params.replyId, "replyId");

  const cleanText = params.text.trim();
  if (!cleanText) throw new Error("La respuesta no puede estar vacía.");
  if (cleanText.length > 2000) throw new Error("La respuesta es demasiado larga.");

  const author = auth.currentUser;
  if (!author) throw new Error("Debes iniciar sesión para editar respuestas.");

  const replyRef = doc(
    db,
    "posts", params.postId,
    "comments", params.commentId,
    "replies", params.replyId
  );
  const replySnap = await getDoc(replyRef);

  if (!replySnap.exists()) throw new Error("La respuesta no existe.");

  const replyData = replySnap.data() as Record<string, unknown>;
  if (replyData.authorId !== author.uid) {
    throw new Error("Solo el autor puede editar esta respuesta.");
  }

  const historyRef = doc(
    collection(
      db,
      "posts", params.postId,
      "comments", params.commentId,
      "replies", params.replyId,
      "editHistory"
    )
  );
  await setDoc(historyRef, {
    editedAt: serverTimestamp(),
    editedBy: author.uid,
    previousText: replyData.text ?? "",
  });

  await updateDoc(replyRef, {
    text: cleanText,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  clearCommentRepliesCache(params.postId, params.commentId);
}
// ─── Live streams (Mux) ───────────────────────────────────────────────────────

export async function callCreateMuxLiveStream(postId: string): Promise<{
  liveStreamId: string;
  playbackId: string | null;
}> {
  const callable = httpsCallable<
    { postId: string },
    { liveStreamId: string; playbackId: string | null }
  >(functions, "createMuxLiveStream");
  const result = await callable({ postId });
  return result.data;
}

export async function fetchLiveStreamCredentials(postId: string): Promise<{
  streamKey: string;
  ingestUrl: string;
  liveStreamId: string;
} | null> {
  const snap = await getDoc(doc(db, "posts", postId, "liveStream", "credentials"));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    streamKey: data.streamKey ?? "",
    ingestUrl: data.ingestUrl ?? "rtmps://global-live.mux.com:443/app",
    liveStreamId: data.liveStreamId ?? "",
  };
}

export async function saveLiveBroadcastMode(
  postId: string,
  mode: "direct" | "rtmp",
): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.broadcastMode": mode,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
