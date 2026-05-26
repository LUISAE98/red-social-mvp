import {
  addDoc,
  collection,
  setDoc,
  collectionGroup,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
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
  GroupVisibility,
  Post,
  PostMedia,
} from "./types";
import { httpsCallable } from "firebase/functions";
import { buildPostSearchIndex } from "./postSearchIndex";

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

type GroupDoc = {
  id: string;
  ownerId?: string;
  visibility?: GroupVisibility | string;
};

type GroupLookup = {
  name: string | null;
  avatarUrl: string | null;
  visibility: GroupVisibility | null;
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

function getTimestampDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate instanceof Function) {
    const d = value.toDate();
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
  mutedUntil: any
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

  const entries = await Promise.all(
    uniqueIds.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) {
          return [
            uid,
            { displayName: null, avatarUrl: null, username: null },
          ] as const;
        }

        const data = snap.data() as Record<string, unknown>;

        return [
          uid,
          {
            displayName:
              pickString(data.displayName) || pickString(data.name) || null,
            avatarUrl:
              pickString(data.avatarUrl) || pickString(data.photoURL) || null,
            username:
              pickString(data.username) || pickString(data.handle) || null,
          },
        ] as const;
      } catch {
        return [
          uid,
          { displayName: null, avatarUrl: null, username: null },
        ] as const;
      }
    })
  );

  return Object.fromEntries(entries);
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

  const entries = await Promise.all(
    uniqueIds.map(async (groupId) => {
      try {
        const snap = await getDoc(doc(db, "groups", groupId));
        if (!snap.exists()) {
          return [
            groupId,
            { name: null, avatarUrl: null, visibility: null },
          ] as const;
        }

        const data = snap.data() as Record<string, unknown>;

        return [
          groupId,
          {
            name: readGroupName(data),
            avatarUrl: readGroupAvatarUrl(data),
            visibility: normalizeGroupVisibility(data.visibility),
          },
        ] as const;
      } catch {
        return [
          groupId,
          { name: null, avatarUrl: null, visibility: null },
        ] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

function hydratePost(
  raw: Post,
  userMap: Record<string, UserProfileLookup>,
  groupMap: Record<string, GroupLookup>
): Post {
  const profile = userMap[raw.authorId];
  const group = groupMap[raw.groupId];

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
  groupVisibility?: GroupVisibility | null;
  accessModel?: Post["accessModel"];
  requiresPayment?: boolean;
  requiresSubscription?: boolean;
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

  const isPublicGroup = params.groupVisibility === "public";

  const cleanText = params.text.trim();

  return {
    isShareable: isFree && isPublicGroup,
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

  const shareMetadata = buildShareMetadata({
    text: post.text,
    media: post.media,
    authorName: post.authorName,
    groupVisibility: post.groupVisibility,
    accessModel: post.accessModel,
    requiresPayment: post.requiresPayment,
    requiresSubscription: post.requiresSubscription,
    videoData: post.videoData,
    playback: post.playback,
  });

  return {
    ...post,
    postType,

    isShareable: post.isShareable ?? shareMetadata.isShareable,
    publicSlug: post.publicSlug ?? shareMetadata.publicSlug,
    shareTitle: post.shareTitle ?? shareMetadata.shareTitle,
    shareDescription: post.shareDescription ?? shareMetadata.shareDescription,
    shareImageUrl: post.shareImageUrl ?? shareMetadata.shareImageUrl,

    access: post.access ?? "free",
    accessModel: post.accessModel ?? "free",
    accessScope: post.accessScope ?? "group",
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
  const chunks = chunkArray(uniquePostIds, 10);

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

  const savedPostIds = new Set<string>();

  await Promise.all(
    uniquePostIds.map(async (postId) => {
      try {
        const snap = await getDoc(doc(db, "users", uid, "savedPosts", postId));
        if (snap.exists()) {
          savedPostIds.add(postId);
        }
      } catch {
        // Si falla una lectura puntual, no rompemos el feed.
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
  const withFlameState = await attachViewerFlameState(posts, viewerUid);
  return attachViewerSavedState(withFlameState, viewerUid);
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
  const chunks = chunkArray(commentIds, 10);

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
  };
}

async function fetchOwnedGroupIds(userUid: string): Promise<string[]> {
  const q = query(collection(db, "groups"), where("ownerId", "==", userUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

async function fetchPublicGroupIds(): Promise<string[]> {
  const q = query(collection(db, "groups"), where("visibility", "==", "public"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

async function fetchMemberGroupIds(userUid: string): Promise<string[]> {
  if (!userUid.trim()) return [];

  const snap = await getDocs(
    query(
      collectionGroup(db, "members"),
      where("userId", "==", userUid)
    )
  );

  const groupIds = snap.docs
    .map((memberDoc) => {
      const data = memberDoc.data() as Record<string, unknown>;

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

      return memberDoc.ref.parent.parent?.id ?? null;
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

async function fetchProfileVisibleGroupIds(
  viewerUid?: string | null
): Promise<string[]> {
  const publicGroupIds = await fetchPublicGroupIds();

  if (!viewerUid) {
    return Array.from(new Set(publicGroupIds));
  }

  const viewerAccessibleGroupIds = await fetchAccessibleGroupIds(viewerUid);

  return Array.from(
    new Set([...publicGroupIds, ...viewerAccessibleGroupIds])
  );
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

async function ensureUserCanCreatePostInGroup(groupId: string, userUid: string) {
  const access = await getGroupWriteAccess(groupId, userUid);

  if (!access.isActive) {
    throw new Error("Esta comunidad está inactiva.");
  }

  if (access.ownerId === userUid) {
    return;
  }

  assertMembershipCanInteract(access.membershipStatus);

  if (access.postingMode === "owner_only") {
    throw new Error("Solo el owner puede publicar en esta comunidad.");
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
    fetchGroupsByIds(rawPosts.map((post) => post.groupId)),
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

  if (homeFeedSnap.empty) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  const feedRows = homeFeedSnap.docs.map((feedDoc) => {
    const data = feedDoc.data() as Record<string, any>;
    const postId =
      typeof data.postId === "string" && data.postId.trim().length > 0
        ? data.postId.trim()
        : feedDoc.id;

    return {
      feedDoc,
      postId,
      canModerateGroupAuthor: data.canModerateGroupAuthor ?? false,
      authorMemberStatus: data.authorMemberStatus ?? null,
      authorMutedUntil: data.authorMutedUntil ?? null,
    };
  });

  const uniquePostIds = Array.from(
    new Set(
      feedRows
        .map((row) => row.postId)
        .filter((postId) => postId.trim().length > 0)
    )
  );

  const postsById = new Map<string, Post>();

  await Promise.all(
    chunkArray(uniquePostIds, 10).map(async (chunk) => {
      try {
        const postsSnap = await getDocs(
          query(collection(db, "posts"), where(documentId(), "in", chunk))
        );

        postsSnap.docs.forEach((postDoc) => {
          const post = {
            id: postDoc.id,
            ...(postDoc.data() as Omit<Post, "id">),
          } as Post;

          if (post.isDeleted !== true) {
            postsById.set(postDoc.id, post);
          }
        });
      } catch {
        // Si falla un bloque, no rompemos todo el feed.
      }
    })
  );

  const rawPosts = feedRows
    .map((row) => {
      const livePost = postsById.get(row.postId);

      if (!livePost || livePost.isDeleted === true) {
        return null;
      }

      return {
        ...livePost,
        canModerateGroupAuthor: row.canModerateGroupAuthor,
        authorMemberStatus: row.authorMemberStatus,
        authorMutedUntil: row.authorMutedUntil,
      } as Post;
    })
    .filter((post): post is Post => post !== null);

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(rawPosts.map((post) => post.groupId)),
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

  const lastDoc = homeFeedSnap.docs[homeFeedSnap.docs.length - 1] ?? null;
  const hasMore = homeFeedSnap.docs.length === safePageSize;

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
  mode: "owner" | "public" | "groupIds";
  groupIds?: string[];
}): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const profileFeedRef = collection(
    db,
    "users",
    params.profileUid,
    "profileFeed"
  );

  const cursorParts =
    params.cursor?.lastCreatedAt && params.cursor?.lastPostId
      ? [startAfter(params.cursor.lastCreatedAt, params.cursor.lastPostId)]
      : [];

  if (params.mode === "owner") {
    const snap = await getDocs(
      query(
        profileFeedRef,
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
        profileFeedRef,
        where("authorId", "==", params.profileUid),
        where("isDeleted", "==", false),
        where("groupVisibility", "==", "public"),
        where("isShareable", "==", true),
        where("accessModel", "==", "free"),
        where("requiresPayment", "==", false),
        where("requiresSubscription", "==", false),
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

  const chunks = chunkArray(groupIds, 10);

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(
        query(
          profileFeedRef,
          where("authorId", "==", params.profileUid),
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
    feedDocs = await fetchProfileFeedDocs({
      profileUid: params.profileUid,
      pageSize: safePageSize + 1,
      cursor: params.cursor,
      mode: "owner",
    });
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

    const [publicDocs, privateDocs] = await Promise.all([
      publicDocsPromise,
      privateDocsPromise,
    ]);

    feedDocs = [...publicDocs, ...privateDocs];
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
    fetchGroupsByIds(rawPosts.map((post) => post.groupId)),
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

export async function createTextPost(params: {
  groupId: string;
  text: string;
}): Promise<void> {
  assertValidId(params.groupId, "groupId");

  const cleanText = params.text.trim();
  if (!cleanText) {
    throw new Error("Escribe un texto antes de publicar.");
  }

  const author = await getCurrentAuthorSnapshot();
  await ensureUserCanCreatePostInGroup(params.groupId, author.uid);

  const groupMap = await fetchGroupsByIds([params.groupId]);
  const groupVisibility = groupMap[params.groupId]?.visibility ?? null;
  if (!groupVisibility) {
  throw new Error("No se pudo resolver la visibilidad del grupo.");
}


  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media: [],
    authorName: author.authorName,
    groupVisibility,
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
    groupId: params.groupId,
    groupVisibility,
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
    media: [],
counts: {
  comments: 0,
  likes: 0,
  saves: 0,
},
      search: buildPostSearchIndex({
      text: cleanText,
      groupId: params.groupId,
      authorId: author.uid,
      groupVisibility,
      accessScope: "group",
      isDeleted: false,
createdAt: searchTimestamp,
updatedAt: searchTimestamp,
    }),
    postType: "text",

accessModel: "free",
accessScope: "group",
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
}

export async function createImagePost(params: {
  groupId: string;
  text?: string;
  media: PostMedia[];
}): Promise<void> {
  assertValidId(params.groupId, "groupId");

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
  await ensureUserCanCreatePostInGroup(params.groupId, author.uid);

  const groupMap = await fetchGroupsByIds([params.groupId]);
  const groupVisibility = groupMap[params.groupId]?.visibility ?? null;
  if (!groupVisibility) {
  throw new Error("No se pudo resolver la visibilidad del grupo.");
}

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media: cleanMedia,
    authorName: author.authorName,
    groupVisibility,
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
    groupId: params.groupId,
    groupVisibility,
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
    media: cleanMedia,
counts: {
  comments: 0,
  likes: 0,
  saves: 0,
},

    postType: cleanMedia.length > 0 ? "image" : "text",

    accessModel: "free",
    accessScope: "group",
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
        search: buildPostSearchIndex({
      text: cleanText,
groupId: params.groupId,
groupVisibility,
authorId: author.uid,
      accessScope: "group",
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
}): Promise<void> {
  assertValidId(params.groupId, "groupId");

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
  await ensureUserCanCreatePostInGroup(params.groupId, author.uid);

  const groupMap = await fetchGroupsByIds([params.groupId]);
  const groupVisibility = groupMap[params.groupId]?.visibility ?? null;

  if (!groupVisibility) {
    throw new Error("No se pudo resolver la visibilidad del grupo.");
  }

  const videoMedia: PostMedia[] = cleanVideoUploads.map((item) => ({
    type: "video",
    id: item.mediaId,
    index: item.mediaIndex,
    url: `mux://uploads/${item.uploadId}`,
    thumbnailUrl:
      typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim().length > 0
        ? item.thumbnailUrl.trim()
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
    groupVisibility,
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    videoData,
    playback,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  const postPayload = {
    groupId: params.groupId,
    groupVisibility,
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
    media,

    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },

    postType: hasVideos ? "video" : hasImages ? "image" : "text",

    accessModel: "free",
    accessScope: "group",
    requiresPayment: false,
    requiresSubscription: false,
    oneTimePrice: null,
    currency: null,
    purchaseType: hasVideos ? "video" : null,

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

    search: buildPostSearchIndex({
      text: cleanText,
      groupId: params.groupId,
      groupVisibility,
      authorId: author.uid,
      accessScope: "group",
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
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
}): Promise<void> {
  assertValidId(params.groupId, "groupId");
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
  await ensureUserCanCreatePostInGroup(params.groupId, author.uid);

  const groupMap = await fetchGroupsByIds([params.groupId]);
  const groupVisibility = groupMap[params.groupId]?.visibility ?? null;

  if (!groupVisibility) {
    throw new Error("No se pudo resolver la visibilidad del grupo.");
  }

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

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media: [],
    authorName: author.authorName,
    groupVisibility,
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    videoData,
    playback,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  await setDoc(doc(db, "posts", params.postId), {
    groupId: params.groupId,
    groupVisibility,
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
    media: [
      {
        type: "video",
        url: `mux://uploads/${params.uploadId}`,
        thumbnailUrl: cleanThumbnailUrl,
        altText: null,
      },
    ],

    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },

    postType: "video",

    accessModel: "free",
    accessScope: "group",
    requiresPayment: false,
    requiresSubscription: false,
    oneTimePrice: null,
    currency: null,
    purchaseType: "video",

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

    search: buildPostSearchIndex({
      text: cleanText,
      groupId: params.groupId,
      groupVisibility,
      authorId: author.uid,
      accessScope: "group",
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
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

const commentsWithViewerState = await attachViewerCommentFlameState(
  postId,
  hydratedComments,
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
  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error("La publicación no existe.");
  }

  const postData = postSnap.data() as Record<string, unknown>;
  const groupId = pickString(postData.groupId);

  if (!groupId) {
    throw new Error("La publicación no pertenece a una comunidad válida.");
  }

  await ensureUserCanCommentInGroup(groupId, author.uid);

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
});

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

await updateDoc(postRef, {
  counts: {
    comments: currentComments + 1,
    likes: currentLikes,
    saves: currentSaves,
  },
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

  const cacheKey = getCommentRepliesCacheKey(params.postId, params.commentId);
  const cached = COMMENT_REPLIES_CACHE.get(cacheKey);

  if (cached) {
    return cached;
  }

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

  COMMENT_REPLIES_CACHE.set(cacheKey, hydratedReplies);

  return hydratedReplies;
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
  const groupId = pickString(postData.groupId);

  if (!groupId) {
    throw new Error("La publicación no pertenece a una comunidad válida.");
  }

  await ensureUserCanCommentInGroup(groupId, author.uid);

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);

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

  const rawPosts = await Promise.all(
    savedSnap.docs.map(async (savedDoc) => {
      try {
        const postSnap = await getDoc(doc(db, "posts", savedDoc.id));

        if (!postSnap.exists()) {
          return null;
        }

        const post = {
          id: postSnap.id,
          ...(postSnap.data() as Omit<Post, "id">),
        } as Post;

        if (post.isDeleted === true) {
          return null;
        }

        return post;
      } catch {
        return null;
      }
    })
  );

  const visiblePosts = rawPosts.filter((post): post is Post => Boolean(post));

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(visiblePosts.map((post) => post.authorId)),
    fetchGroupsByIds(visiblePosts.map((post) => post.groupId)),
  ]);

  const hydratedPosts = visiblePosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      viewerHasSaved: true,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithFlameState = await attachViewerFlameState(
    hydratedPosts,
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