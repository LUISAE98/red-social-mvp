import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limitToLast,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { LiveChatMessage } from "./types";

const CHAT_LIMIT = 25;

export function subscribeToLiveChat(
  liveId: string,
  onMessages: (messages: LiveChatMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  // Sin where("isDeleted") para no requerir índice compuesto; filtramos client-side.
  const q = query(
    collection(db, "liveChats", liveId, "messages"),
    orderBy("createdAt", "asc"),
    limitToLast(CHAT_LIMIT)
  );
  return onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as LiveChatMessage)
        .filter((m) => !m.isDeleted);
      onMessages(msgs);
    },
    (err) => onError?.(err)
  );
}

export async function sendLiveChatMessage(params: {
  liveId: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  text: string;
}): Promise<void> {
  await addDoc(collection(db, "liveChats", params.liveId, "messages"), {
    liveId: params.liveId,
    userId: params.userId,
    username: params.username,
    avatarUrl: params.avatarUrl ?? null,
    text: params.text.trim(),
    createdAt: serverTimestamp(),
    type: "message",
    isDeleted: false,
    futureFlags: { isSuperComment: false },
  });
}

export async function deleteLiveChatMessage(
  liveId: string,
  messageId: string,
  deletedBy: string
): Promise<void> {
  await updateDoc(doc(db, "liveChats", liveId, "messages", messageId), {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedBy,
  });
}

export async function updateLiveChatEnabled(
  postId: string,
  chatEnabled: boolean
): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.chatEnabled": chatEnabled,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function muteLiveChatUser(postId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.mutedUsers": arrayUnion(userId),
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function unmuteLiveChatUser(postId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.mutedUsers": arrayRemove(userId),
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function banLiveChatUser(postId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.bannedUsers": arrayUnion(userId),
    "liveData.mutedUsers": arrayUnion(userId),
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function unbanLiveChatUser(postId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.bannedUsers": arrayRemove(userId),
    "liveData.mutedUsers": arrayRemove(userId),
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
