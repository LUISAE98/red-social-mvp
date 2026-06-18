import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc, StoryType } from "./types";

// Resolves muxPlaybackId for stories that don't have it by reading the
// greetingRequest doc. Mutates the story objects in-place so the caller
// can pass them directly to the callback without a second render cycle.
// Also writes back to Firestore so future loads are instant.
async function patchMissingPlaybackIds(stories: StoryDoc[]): Promise<void> {
  const unresolved = stories.filter((s) => !s.muxPlaybackId && s.greetingRequestId);
  if (unresolved.length === 0) return;
  await Promise.all(
    unresolved.map(async (s) => {
      try {
        const snap = await getDoc(doc(db, "greetingRequests", s.greetingRequestId));
        const pid = snap.data()?.muxPlaybackId as string | null | undefined;
        if (!pid) return;
        // Mutate in-place so the callback renders with the image on first call
        s.muxPlaybackId = pid;
        s.thumbnailUrl = `https://image.mux.com/${pid}/thumbnail.jpg?time=0`;
        // Background write — future loads won't need resolution
        updateDoc(doc(db, "stories", s.id), {
          muxPlaybackId: pid,
          thumbnailUrl: `https://image.mux.com/${pid}/thumbnail.jpg?time=0`,
        }).catch(() => {});
      } catch {
        // best-effort — silently skip
      }
    }),
  );
}

function sortByDate(stories: StoryDoc[]): StoryDoc[] {
  return [...stories].sort((a, b) => {
    const at = a.createdAt?.toMillis() ?? 0;
    const bt = b.createdAt?.toMillis() ?? 0;
    return bt - at;
  });
}

export async function addStoryFromGreeting(params: {
  creatorId: string;
  greetingCreatorId?: string;
  instructions?: string;
  type: StoryType;
  muxPlaybackId: string | null;
  thumbnailUrl: string | null;
  videoDuration: number | null;
  greetingRequestId: string;
  source: "profile" | "group";
  groupId: string | null;
}): Promise<string> {
  const docRef = await addDoc(collection(db, "stories"), {
    ...params,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

// Stories belonging to a creator's profile (source = "profile")
export function subscribeToCreatorStories(
  creatorId: string,
  callback: (stories: StoryDoc[]) => void,
): () => void {
  const q = query(
    collection(db, "stories"),
    where("creatorId", "==", creatorId),
    where("source", "==", "profile"),
  );
  return onSnapshot(
    q,
    async (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
      await patchMissingPlaybackIds(docs);
      callback(sortByDate(docs));
    },
    (err) => console.error("[subscribeToCreatorStories]", err),
  );
}

// Stories belonging to a community/group (source = "group")
export function subscribeToGroupStories(
  groupId: string,
  callback: (stories: StoryDoc[]) => void,
): () => void {
  const q = query(
    collection(db, "stories"),
    where("groupId", "==", groupId),
  );
  return onSnapshot(
    q,
    async (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
      await patchMissingPlaybackIds(docs);
      callback(sortByDate(docs));
    },
    (err) => console.error("[subscribeToGroupStories]", err),
  );
}

// Check if a specific greeting already has a story (for viewMode/buyerViewMode toggle)
// filterCreatorId narrows to the story added by that user (creator or buyer)
export function subscribeToStoryByGreeting(
  greetingRequestId: string,
  callback: (story: StoryDoc | null) => void,
  filterCreatorId?: string,
): () => void {
  const q = query(
    collection(db, "stories"),
    where("greetingRequestId", "==", greetingRequestId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
      const filtered = filterCreatorId
        ? docs.filter((s) => s.creatorId === filterCreatorId)
        : docs;
      callback(filtered.length > 0 ? (filtered[0] ?? null) : null);
    },
    (err) => console.error("[subscribeToStoryByGreeting]", err),
  );
}

export async function deleteStory(storyId: string): Promise<void> {
  await deleteDoc(doc(db, "stories", storyId));
}

// ─── View tracking ────────────────────────────────────────────────────────────

export async function recordStoryView(userId: string, storyId: string): Promise<void> {
  await setDoc(doc(db, "userStoryViews", userId, "views", storyId), {
    storyId,
    viewedAt: serverTimestamp(),
  });
}

// Returns Map<storyId, viewedAtMs> so callers can apply time-window logic
export function subscribeToViewedStories(
  userId: string,
  callback: (views: Map<string, number>) => void,
): () => void {
  const ref = collection(db, "userStoryViews", userId, "views");
  return onSnapshot(
    ref,
    (snap) => {
      const map = new Map<string, number>();
      for (const d of snap.docs) {
        const ts = d.data().viewedAt;
        map.set(d.id, ts?.toMillis?.() ?? Date.now());
      }
      callback(map);
    },
    (err) => console.error("[subscribeToViewedStories]", err),
  );
}

// ─── Home feed story queries ──────────────────────────────────────────────────

// Stories from a list of profile creators (for home feed)
export function subscribeToStoriesFromCreators(
  creatorIds: string[],
  callback: (stories: StoryDoc[]) => void,
): () => void {
  if (creatorIds.length === 0) {
    callback([]);
    return () => {};
  }
  // Firestore `in` supports up to 30 items; callers are responsible for batching if needed
  const ids = creatorIds.slice(0, 30);
  const q = query(collection(db, "stories"), where("creatorId", "in", ids));
  return onSnapshot(
    q,
    async (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as StoryDoc)
        .filter((s) => s.source === "profile");
      await patchMissingPlaybackIds(docs);
      callback(sortByDate(docs));
    },
    (err) => console.error("[subscribeToStoriesFromCreators]", err),
  );
}

// Stories from a list of groups (for home feed)
export function subscribeToStoriesFromGroups(
  groupIds: string[],
  callback: (stories: StoryDoc[]) => void,
): () => void {
  if (groupIds.length === 0) {
    callback([]);
    return () => {};
  }
  const ids = groupIds.slice(0, 30);
  const q = query(collection(db, "stories"), where("groupId", "in", ids));
  return onSnapshot(
    q,
    async (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as StoryDoc)
        .filter((s) => s.source === "group");
      await patchMissingPlaybackIds(docs);
      callback(sortByDate(docs));
    },
    (err) => console.error("[subscribeToStoriesFromGroups]", err),
  );
}

// ─── Story cover (portada) ────────────────────────────────────────────────────

export async function setProfileStoryCover(
  creatorId: string,
  key: string,
  storyId: string | null,
): Promise<void> {
  await updateDoc(doc(db, "users", creatorId), {
    [`storyCovers.${key}`]: storyId ?? deleteField(),
  });
}

export async function setGroupStoryCover(
  groupId: string,
  type: StoryType,
  storyId: string | null,
): Promise<void> {
  await updateDoc(doc(db, "groups", groupId), {
    [`storyCovers.${type}`]: storyId ?? deleteField(),
  });
}

export async function setProfileStoryCoverPhoto(
  creatorId: string,
  key: string,
  url: string | null,
): Promise<void> {
  await updateDoc(doc(db, "users", creatorId), {
    [`storyCoverPhoto.${key}`]: url ?? deleteField(),
  });
}

export async function setGroupStoryCoverPhoto(
  groupId: string,
  type: StoryType,
  url: string | null,
): Promise<void> {
  await updateDoc(doc(db, "groups", groupId), {
    [`storyCoverPhoto.${type}`]: url ?? deleteField(),
  });
}

// ─── Recommended stories (one-shot fetch) ────────────────────────────────────

// Fetches active profile stories from a specific list of creator UIDs.
// Used by HomeStoriesRow to load stories from recommended creators without
// setting up a real-time listener. cutoffMs filters out stories older than 24h.
export async function fetchStoriesFromCreatorIds(
  creatorIds: string[],
  cutoffMs: number,
): Promise<StoryDoc[]> {
  if (creatorIds.length === 0) return [];
  const ids = creatorIds.slice(0, 30);
  try {
    const snap = await getDocs(
      query(collection(db, "stories"), where("creatorId", "in", ids)),
    );
    const docs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as StoryDoc)
      .filter((s) => s.source === "profile" && (s.createdAt?.toMillis() ?? 0) >= cutoffMs);
    await patchMissingPlaybackIds(docs);
    return sortByDate(docs);
  } catch (err) {
    console.error("[fetchStoriesFromCreatorIds]", err);
    return [];
  }
}
