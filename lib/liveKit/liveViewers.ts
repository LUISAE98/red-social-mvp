import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Registers the user as an active viewer of the live. */
export function joinLivePresence(postId: string, uid: string): Promise<void> {
  return setDoc(doc(db, "posts", postId, "liveViewers", uid), {
    uid,
    joinedAt: serverTimestamp(),
  });
}

/** Removes the user's viewer presence. */
export function leaveLivePresence(postId: string, uid: string): Promise<void> {
  return deleteDoc(doc(db, "posts", postId, "liveViewers", uid));
}

/**
 * Subscribes to the real-time viewer count for a live post.
 * Returns an unsubscribe function.
 */
export function subscribeToViewerCount(
  postId: string,
  onCount: (count: number) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "posts", postId, "liveViewers"),
    (snap) => onCount(snap.size),
    (err) => onError?.(err),
  );
}

/** Updates the recorded peak concurrent viewer count for the live. */
export function updatePeakViewers(postId: string, peak: number): Promise<void> {
  return updateDoc(doc(db, "posts", postId), {
    "liveData.peakViewers": peak,
    updatedAt: serverTimestamp(),
  });
}
