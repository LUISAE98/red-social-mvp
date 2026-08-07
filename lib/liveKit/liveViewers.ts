import {
  collection,
  doc,
  getDoc,
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

export type ViewerSample = { t: number; v: number };

/**
 * Registers the user as an active viewer of the live.
 *
 * `uid` puede ser el de una cuenta real o el de una identidad ANÓNIMA de invitado
 * (la misma que usan los pagos sin login, ver `ensureGuestAuth`). `isGuest` marca
 * cuál es cuál para poder segmentar la audiencia (registrados vs invitados) sin
 * tener que resolver cada uid contra `users/`.
 */
export function joinLivePresence(postId: string, uid: string, isGuest = false): Promise<void> {
  return setDoc(doc(db, "posts", postId, "liveViewers", uid), {
    uid,
    isGuest,
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
export function registerUniqueViewer(postId: string, uid: string, isGuest = false): Promise<void> {
  // merge: no debe pisar el `watchSeconds` acumulado si el espectador vuelve a entrar.
  return setDoc(doc(db, "posts", postId, "liveUniqueViewers", uid), { uid, isGuest }, { merge: true });
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

/**
 * Persiste el historial de espectadores (muestras tiempo→cantidad) para conservar
 * la gráfica después de que el live termina. Se guarda en una subcolección propia
 * (NO en el doc del post) para no disparar el fan-out de home-feed en cada muestra.
 */
export function saveViewerHistory(
  postId: string,
  points: ViewerSample[],
): Promise<void> {
  return setDoc(doc(db, "posts", postId, "liveStats", "viewerHistory"), {
    points,
    updatedAt: serverTimestamp(),
  });
}

/** Lee el historial de espectadores persistido (vacío si aún no existe). */
export async function fetchViewerHistory(postId: string): Promise<ViewerSample[]> {
  try {
    const snap = await getDoc(doc(db, "posts", postId, "liveStats", "viewerHistory"));
    const pts = snap.exists() ? (snap.data() as { points?: unknown }).points : null;
    if (!Array.isArray(pts)) return [];
    return pts.filter(
      (p): p is ViewerSample =>
        !!p && typeof p.t === "number" && typeof p.v === "number",
    );
  } catch {
    return [];
  }
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
