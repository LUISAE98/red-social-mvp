import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Comment, GroupVisibility, Post } from "./types";

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

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function normalizeGroupVisibility(value: unknown): GroupVisibility | null {
  if (value === "public" || value === "private" || value === "hidden") {
    return value;
  }

  return null;
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

  return {
    ...raw,
    authorName:
      profile?.displayName || raw.authorName || raw.authorId || "Usuario",
    authorAvatarUrl: profile?.avatarUrl ?? raw.authorAvatarUrl ?? null,
    authorUsername: profile?.username ?? raw.authorUsername ?? null,
    groupName: group?.name ?? raw.groupName ?? null,
    groupAvatarUrl: group?.avatarUrl ?? raw.groupAvatarUrl ?? null,
    groupVisibility: group?.visibility ?? raw.groupVisibility ?? null,
  };
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
  };
}

async function fetchOwnedGroupIds(userUid: string): Promise<string[]> {
  const q = query(collection(db, "groups"), where("ownerId", "==", userUid));
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
        return memberSnap.exists() ? group.id : null;
      } catch {
        return null;
      }
    })
  );

  return checks.filter((id): id is string => !!id);
}

async function fetchAccessibleGroupIds(userUid: string): Promise<string[]> {
  const [ownedIds, memberIds] = await Promise.all([
    fetchOwnedGroupIds(userUid),
    fetchMemberGroupIds(userUid),
  ]);

  return Array.from(new Set([...ownedIds, ...memberIds]));
}

async function fetchPostsByAccessibleGroups(groupIds: string[]): Promise<Post[]> {
  if (groupIds.length === 0) {
    return [];
  }

  const chunks = chunkArray(groupIds, 10);

  const snaps = await Promise.all(
    chunks.map((ids) =>
      getDocs(
        query(
          collection(db, "posts"),
          where("groupId", "in", ids),
          where("isDeleted", "==", false),
          orderBy("createdAt", "desc"),
          limit(50)
        )
      )
    )
  );

  const rawPosts: Post[] = snaps.flatMap((snap) =>
    snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Post, "id">),
    }))
  );

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

export async function fetchGroupPosts(groupId: string): Promise<Post[]> {
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

  return rawPosts.map((post) => hydratePost(post, userMap, groupMap));
}

export async function fetchHomePosts(userUid: string): Promise<Post[]> {
  assertValidId(userUid, "userUid");

  const groupIds = await fetchAccessibleGroupIds(userUid);
  const rawPosts = await fetchPostsByAccessibleGroups(groupIds);

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(rawPosts.map((post) => post.groupId)),
  ]);

  return rawPosts.map((post) => hydratePost(post, userMap, groupMap));
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

  let accessibleGroupIds: string[] = [];

  if (viewerUid === profileUid) {
    accessibleGroupIds = await fetchAccessibleGroupIds(profileUid);
  } else if (viewerUid) {
    accessibleGroupIds = await fetchAccessibleGroupIds(viewerUid);
  } else {
    accessibleGroupIds = [];
  }

  const rawPosts = await fetchPostsByAccessibleGroups(accessibleGroupIds);
  const filteredPosts = rawPosts.filter((post) => post.authorId === profileUid);

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(filteredPosts.map((post) => post.authorId)),
    fetchGroupsByIds(filteredPosts.map((post) => post.groupId)),
  ]);

  return filteredPosts.map((post) => hydratePost(post, userMap, groupMap));
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

  const q = query(
    collection(db, "posts", postId, "comments"),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(q);

  const rawComments: Comment[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Comment, "id">),
  }));

  const userMap = await fetchUsersByIds(
    rawComments.map((comment) => comment.authorId)
  );

  return rawComments.map((comment) => hydrateComment(comment, userMap));
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
  const commentRef = doc(collection(db, "posts", params.postId, "comments"));

  const batch = writeBatch(db);

  batch.set(commentRef, {
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(postRef, {
    "counts.comments": increment(1),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function deletePostComment(params: {
  postId: string;
  commentId: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const postRef = doc(db, "posts", params.postId);
  const commentRef = doc(
    db,
    "posts",
    params.postId,
    "comments",
    params.commentId
  );

  const commentSnap = await getDoc(commentRef);

  if (!commentSnap.exists()) {
    return;
  }

  const batch = writeBatch(db);

  batch.delete(commentRef);
  batch.update(postRef, {
    "counts.comments": increment(-1),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

