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
  const cleanPostId = postId.trim();

  if (!cleanPostId) return;

  Array.from(listeners).forEach((listener) => {
    try {
      listener.removePost?.(cleanPostId);
    } catch {
      // No permitimos que un listener roto impida limpiar otros feeds.
    }
  });
}

export function patchPostInAllFeedCaches(postId: string, patch: Partial<Post>) {
  const cleanPostId = postId.trim();

  if (!cleanPostId) return;

  Array.from(listeners).forEach((listener) => {
    try {
      listener.patchPost?.(cleanPostId, patch);
    } catch {
      // No permitimos que un listener roto impida actualizar otros feeds.
    }
  });
}

export function clearAllPostFeedCaches() {
  Array.from(listeners).forEach((listener) => {
    try {
      listener.clear?.();
    } catch {
      // No permitimos que un listener roto impida limpiar otros feeds.
    }
  });
}