import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  increment,
  query,
  where,
  type Timestamp,
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

/**
 * Registers the viewer in the permanent unique-viewer log (idempotent).
 * Unlike liveViewers, this subcollection is never deleted — it's the historical record.
 */
export function registerUniqueViewer(postId: string, uid: string): Promise<void> {
  return setDoc(doc(db, "posts", postId, "liveUniqueViewers", uid), { uid });
}

/** Subscribes to the total unique viewer count (ever connected) for a live post. */
export function subscribeToUniqueViewerCount(
  postId: string,
  onCount: (count: number) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "posts", postId, "liveUniqueViewers"),
    (snap) => onCount(snap.size),
    (err) => onError?.(err),
  );
}

/**
 * Accumulates the viewer's watch time in their unique-viewer doc (idempotent, uses server increment).
 * Safe to call even on the first join (setDoc with merge creates the doc if it doesn't exist yet).
 */
export function addWatchTime(postId: string, uid: string, seconds: number): Promise<void> {
  return setDoc(
    doc(db, "posts", postId, "liveUniqueViewers", uid),
    { uid, watchSeconds: increment(seconds) },
    { merge: true },
  );
}

/** Subscribes to the average watch time (in seconds) across all unique viewers. */
export function subscribeToAverageWatchTime(
  postId: string,
  onAvg: (avgSeconds: number) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "posts", postId, "liveUniqueViewers"),
    (snap) => {
      let total = 0;
      let count = 0;
      snap.docs.forEach((d) => {
        const ws = d.data().watchSeconds;
        if (typeof ws === "number" && ws > 0) { total += ws; count++; }
      });
      onAvg(count > 0 ? Math.round(total / count) : 0);
    },
    (err) => onError?.(err),
  );
}

/**
 * Subscribes to the count of new followers gained since the live started.
 * Only works when called by the live's author (Firestore rules restrict followers listing to the owner).
 */
export function subscribeToNewFollowersDuringLive(
  authorId: string,
  startedAt: Timestamp,
  onCount: (count: number) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    query(
      collection(db, "users", authorId, "followers"),
      where("createdAt", ">=", startedAt),
    ),
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

/**
 * Records that a viewer has watched 20%+ of the VOD (idempotent — one doc per viewer).
 * The subcollection size is used as the view counter.
 */
export function recordVodView(postId: string, viewerId: string): Promise<void> {
  return setDoc(
    doc(db, "posts", postId, "vodViewers", viewerId),
    { viewedAt: serverTimestamp() },
  );
}

/** Subscribes to the count of viewers who have watched 20%+ of the VOD. */
export function subscribeToVodViewCount(
  postId: string,
  onCount: (count: number) => void,
): () => void {
  return onSnapshot(
    collection(db, "posts", postId, "vodViewers"),
    (snap) => onCount(snap.size),
  );
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
