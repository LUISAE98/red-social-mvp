import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Comment, Post } from "./types";

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

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
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

async function fetchUsersByIds(userIds: string[]): Promise<Record<string, UserProfileLookup>> {
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
          return [uid, { displayName: null, avatarUrl: null, username: null }] as const;
        }

        const data = snap.data() as Record<string, unknown>;

        return [
          uid,
          {
            displayName:
              pickString(data.displayName) ||
              pickString(data.name) ||
              null,
            avatarUrl:
              pickString(data.avatarUrl) ||
              pickString(data.photoURL) ||
              null,
            username:
              pickString(data.username) ||
              pickString(data.handle) ||
              null,
          },
        ] as const;
      } catch {
        return [uid, { displayName: null, avatarUrl: null, username: null }] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

function hydratePost(raw: Post, userMap: Record<string, UserProfileLookup>): Post {
  const profile = userMap[raw.authorId];

  return {
    ...raw,
    authorName:
      profile?.displayName ||
      raw.authorName ||
      raw.authorId ||
      "Usuario",
    authorAvatarUrl:
      profile?.avatarUrl ??
      raw.authorAvatarUrl ??
      null,
    authorUsername:
      profile?.username ??
      raw.authorUsername ??
      null,
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
      profile?.displayName ||
      raw.authorName ||
      raw.authorId ||
      "Usuario",
    authorAvatarUrl:
      profile?.avatarUrl ??
      raw.authorAvatarUrl ??
      null,
    authorUsername:
      profile?.username ??
      raw.authorUsername ??
      null,
  };
}

export async function fetchGroupPosts(groupId: string): Promise<Post[]> {
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

  const userMap = await fetchUsersByIds(rawPosts.map((post) => post.authorId));

  return rawPosts.map((post) => hydratePost(post, userMap));
}

export async function createTextPost(params: {
  groupId: string;
  text: string;
}): Promise<void> {
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
  await updateDoc(doc(db, "posts", postId), {
    isDeleted: true,
  });
}

export async function fetchPostComments(postId: string): Promise<Comment[]> {
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
  const cleanText = params.text.trim();

  if (!cleanText) {
    throw new Error("Escribe un comentario antes de enviar.");
  }

  const author = await getCurrentAuthorSnapshot();

  await addDoc(collection(db, "posts", params.postId, "comments"), {
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt: serverTimestamp(),
  });
}

export async function deletePostComment(params: {
  postId: string;
  commentId: string;
}): Promise<void> {
  await deleteDoc(doc(db, "posts", params.postId, "comments", params.commentId));
}
