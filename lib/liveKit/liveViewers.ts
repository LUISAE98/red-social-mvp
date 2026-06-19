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

/** Writes the viewer's current HLS playback latency (in seconds) to their presence doc. */
export function updateViewerLatency(postId: string, uid: string, latencySeconds: number): Promise<void> {
  return updateDoc(doc(db, "posts", postId, "liveViewers", uid), {
    latency: latencySeconds,
    latencyUpdatedAt: serverTimestamp(),
  });
}

/**
 * Subscribes to all viewer latency values for a live post.
 * Returns an array of latency values in seconds (only for viewers who have reported latency).
 */
export function subscribeViewerLatencies(
  postId: string,
  onData: (latencies: number[]) => void,
): () => void {
  return onSnapshot(
    collection(db, "posts", postId, "liveViewers"),
    (snap) => {
      const latencies: number[] = [];
      snap.docs.forEach((d) => {
        const l = d.data().latency;
        if (typeof l === "number" && l > 0 && l < 120) latencies.push(l);
      });
      onData(latencies);
    },
  );
}
