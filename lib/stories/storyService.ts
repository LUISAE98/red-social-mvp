import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc, StoryType } from "./types";

function sortByDate(stories: StoryDoc[]): StoryDoc[] {
  return [...stories].sort((a, b) => {
    const at = a.createdAt?.toMillis() ?? 0;
    const bt = b.createdAt?.toMillis() ?? 0;
    return bt - at;
  });
}

export async function addStoryFromGreeting(params: {
  creatorId: string;
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
    (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
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
    (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
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
    (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as StoryDoc)
        .filter((s) => s.source === "profile");
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
    (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as StoryDoc)
        .filter((s) => s.source === "group");
      callback(sortByDate(docs));
    },
    (err) => console.error("[subscribeToStoriesFromGroups]", err),
  );
}
