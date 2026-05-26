import type { Post } from "@/lib/posts/types";

type FeedCacheListener = {
  removePost?: (postId: string) => void;
  patchPost?: (postId: string, patch: Partial<Post>) => void;
  clear?: () => void;
};

const listeners = new Set<FeedCacheListener>();

export function registerPostFeedCacheListener(listener: FeedCacheListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function removePostFromAllFeedCaches(postId: string) {
  if (!postId.trim()) return;

  listeners.forEach((listener) => {
    listener.removePost?.(postId);
  });
}

export function patchPostInAllFeedCaches(postId: string, patch: Partial<Post>) {
  if (!postId.trim()) return;

  listeners.forEach((listener) => {
    listener.patchPost?.(postId, patch);
  });
}

export function clearAllPostFeedCaches() {
  listeners.forEach((listener) => {
    listener.clear?.();
  });
}
