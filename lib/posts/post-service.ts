import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { auth, db, functions } from "@/lib/firebase";
import { getMyHiddenJoinedGroups } from "@/lib/groups/sidebarGroups";
import type {
  Comment,
  CommentReply,
  GroupVisibility,
  Post,
  PostMedia,
} from "./types";
import { httpsCallable } from "firebase/functions";

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

type ToggleCommentFlameResponse = {
  liked: boolean;
  likes: number;
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

function normalizePostMetadata(post: Post): Post {
  const postType = post.postType ?? "text";

  return {
    ...post,
    postType,

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

  const postIds = new Set(
    posts
      .map((post) => post.id)
      .filter(
        (postId): postId is string =>
          typeof postId === "string" && postId.trim().length > 0
      )
  );

  if (postIds.size === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasFlamed: false,
    }));
  }

  const likedPostIds = new Set<string>();

  try {
    const snap = await getDocs(collection(db, "users", uid, "postFlames"));

    snap.docs.forEach((flameDoc) => {
      const postId = flameDoc.id;

      if (postIds.has(postId)) {
        likedPostIds.add(postId);
      }
    });
  } catch {
    return posts.map((post) => ({
      ...post,
      viewerHasFlamed: false,
    }));
  }

  return posts.map((post) => ({
    ...post,
    viewerHasFlamed: likedPostIds.has(post.id),
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

  const commentIds = new Set(comments.map((comment) => comment.id));
  const likedCommentIds = new Set<string>();

  try {
    const snap = await getDocs(collection(db, "users", uid, "commentFlames"));

    snap.docs.forEach((flameDoc) => {
      const data = flameDoc.data() as Record<string, unknown>;

      const flamePostId =
        typeof data.postId === "string" ? data.postId.trim() : "";

      const flameCommentId =
        typeof data.commentId === "string" ? data.commentId.trim() : "";

      if (flamePostId === postId && commentIds.has(flameCommentId)) {
        likedCommentIds.add(flameCommentId);
      }
    });
  } catch {
    return comments.map((comment) => ({
      ...comment,
      viewerHasFlamed: false,
    }));
  }

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

async function fetchVisibleGroupsForMembershipChecks(): Promise<GroupDoc[]> {
  const groupsCol = collection(db, "groups");

  const [publicSnap, privateSnap] = await Promise.all([
    getDocs(query(groupsCol, where("visibility", "==", "public"))),
    getDocs(query(groupsCol, where("visibility", "==", "private"))),
  ]);

  const list: GroupDoc[] = [
    ...publicSnap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })),
    ...privateSnap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })),
  ];

  return Array.from(new Map(list.map((g) => [g.id, g])).values());
}

async function fetchMemberGroupIds(userUid: string): Promise<string[]> {
  const visibleGroups = await fetchVisibleGroupsForMembershipChecks();

  const checks = await Promise.all(
    visibleGroups.map(async (group) => {
      try {
        const memberRef = doc(db, "groups", group.id, "members", userUid);
        const memberSnap = await getDoc(memberRef);

        if (!memberSnap.exists()) return null;

        const memberData = memberSnap.data() as Record<string, unknown>;
        const status = resolveEffectiveMembershipStatus(
          memberData.status,
          memberData.mutedUntil
        );

        return status === "active" || status === "subscribed" || status === "muted"
         ? group.id
         : null;
      } catch {
        return null;
      }
    })
  );

  return checks.filter((id): id is string => !!id);
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

async function fetchPostsByAccessibleGroups(groupIds: string[]): Promise<Post[]> {
  if (groupIds.length === 0) {
    return [];
  }

  const perGroupResults = await Promise.all(
    groupIds.map(async (groupId) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "posts"),
            where("groupId", "==", groupId),
            where("isDeleted", "==", false),
            orderBy("createdAt", "desc"),
            limit(50)
          )
        );

        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Post, "id">),
        })) as Post[];
      } catch {
        return [] as Post[];
      }
    })
  );

  const rawPosts = perGroupResults.flat();

  const deduped = Array.from(
    new Map(rawPosts.map((post) => [post.id, post])).values()
  );

  deduped.sort((a, b) => {
    const aMs = a.createdAt?.toMillis?.() ?? 0;
    const bMs = b.createdAt?.toMillis?.() ?? 0;
    return bMs - aMs;
  });

  return deduped;
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

export async function fetchGroupPosts(
  groupId: string,
  viewerUid?: string | null
): Promise<Post[]> {
  assertValidId(groupId, "groupId");

  const q = query(
    collection(db, "posts"),
    where("groupId", "==", groupId),
    where("isDeleted", "==", false),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);

  const rawPosts: Post[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

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

  return attachViewerFlameState(hydratedPosts, viewerUid);
}

export async function fetchHomePosts(userUid: string): Promise<Post[]> {
  assertValidId(userUid, "userUid");

  const groupIds = await fetchAccessibleGroupIds(userUid);
  const rawPosts = await fetchPostsByAccessibleGroups(groupIds);

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

   return attachViewerFlameState(hydratedPosts, userUid);
}

export async function fetchUserProfilePosts(
  profileUid: string,
  viewerUid?: string | null
): Promise<Post[]> {
  assertValidId(profileUid, "profileUid");

  const profileSnap = await getDoc(doc(db, "users", profileUid));
  if (!profileSnap.exists()) {
    return [];
  }

  const profileData = profileSnap.data() as Record<string, unknown>;
  const showPosts = profileData.showPosts !== false;

  if (!showPosts && viewerUid !== profileUid) {
    return [];
  }

  if (viewerUid === profileUid) {
    const ownPostsSnap = await getDocs(
      query(
        collection(db, "posts"),
        where("authorId", "==", profileUid),
        where("isDeleted", "==", false),
        orderBy("createdAt", "desc"),
        limit(100)
      )
    );

    const ownPosts = ownPostsSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Post, "id">),
    })) as Post[];

    const [userMap, groupMap] = await Promise.all([
      fetchUsersByIds(ownPosts.map((post) => post.authorId)),
      fetchGroupsByIds(ownPosts.map((post) => post.groupId)),
    ]);

    const hydratedPosts = ownPosts.map((post) => {
      const hydrated = hydratePost(post, userMap, groupMap);

      return {
        ...hydrated,
        isLocked: isPostLocked(hydrated),
      };
    });

    return attachViewerFlameState(hydratedPosts, viewerUid || profileUid);
  }

  const visibleGroupIds = await fetchProfileVisibleGroupIds(viewerUid);

  const rawPosts = await fetchPostsByAccessibleGroups(visibleGroupIds);
  const filteredPosts = rawPosts.filter((post) => post.authorId === profileUid);

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(filteredPosts.map((post) => post.authorId)),
    fetchGroupsByIds(filteredPosts.map((post) => post.groupId)),
  ]);

  const hydratedPosts = filteredPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      isLocked: isPostLocked(hydrated),
    };
  });

  return attachViewerFlameState(hydratedPosts, viewerUid);
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

  await addDoc(collection(db, "posts"), {
    groupId: params.groupId,
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deletedAt: null,
    isDeleted: false,
    access: "free",
    media: [],
    counts: {
      comments: 0,
      likes: 0,
    },

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

  if (!cleanText && cleanMedia.length === 0) {
    throw new Error("Agrega texto o una imagen antes de publicar.");
  }

  const author = await getCurrentAuthorSnapshot();
  await ensureUserCanCreatePostInGroup(params.groupId, author.uid);

  await addDoc(collection(db, "posts"), {
    groupId: params.groupId,
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deletedAt: null,
    isDeleted: false,
    access: "free",
    media: cleanMedia,
    counts: {
      comments: 0,
      likes: 0,
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
  });
}

export async function softDeletePost(postId: string): Promise<void> {
  assertValidId(postId, "postId");

  await updateDoc(doc(db, "posts", postId), {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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

await updateDoc(postRef, {
  counts: {
    comments: currentComments + 1,
    likes: currentLikes,
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

await deleteDoc(commentRef);

await updateDoc(postRef, {
  counts: {
    comments: Math.max(0, currentComments - 1),
    likes: currentLikes,
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

  const commentRef = doc(
    db,
    "posts",
    params.postId,
    "comments",
    params.commentId
  );

  const replyRef = doc(
    collection(
      db,
      "posts",
      params.postId,
      "comments",
      params.commentId,
      "replies"
    )
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
      typeof freshPostCounts.comments === "number"
        ? freshPostCounts.comments
        : 0;

    const freshPostLikes =
      typeof freshPostCounts.likes === "number" ? freshPostCounts.likes : 0;

    const freshCommentData = freshCommentSnap.data() as Record<string, unknown>;
    const freshCommentCounts =
      freshCommentData.counts && typeof freshCommentData.counts === "object"
        ? (freshCommentData.counts as Record<string, unknown>)
        : {};

    const freshReplies =
      typeof freshCommentCounts.replies === "number"
        ? freshCommentCounts.replies
        : 0;

    const freshCommentLikes =
      typeof freshCommentCounts.likes === "number"
        ? freshCommentCounts.likes
        : 0;

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

  const commentRef = doc(
    db,
    "posts",
    params.postId,
    "comments",
    params.commentId
  );

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
      typeof freshCommentCounts.replies === "number"
        ? freshCommentCounts.replies
        : 0;

    const freshCommentLikes =
      typeof freshCommentCounts.likes === "number"
        ? freshCommentCounts.likes
        : 0;

    const freshPostData = freshPostSnap.data() as Record<string, unknown>;
    const freshPostCounts =
      freshPostData.counts && typeof freshPostData.counts === "object"
        ? (freshPostData.counts as Record<string, unknown>)
        : {};

    const freshPostComments =
      typeof freshPostCounts.comments === "number"
        ? freshPostCounts.comments
        : 0;

    const freshPostLikes =
      typeof freshPostCounts.likes === "number" ? freshPostCounts.likes : 0;

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

export async function togglePostFlame(postId: string): Promise<TogglePostFlameResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión para reaccionar.");
  }

  const callable = httpsCallable<{ postId: string }, TogglePostFlameResponse>(
    functions,
    "togglePostFlame"
  );

  const result = await callable({ postId });

  return {
    liked: Boolean(result.data.liked),
    likes: Number(result.data.likes ?? 0),
  };
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