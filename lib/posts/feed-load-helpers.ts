import { withTimeout } from "@/lib/async/withTimeout";

export type FeedLoadOptions = {
  timeoutMs?: number;
};

/**
 * Thin timeout wrapper for feed fetches.
 * No retry — a retry would re-read Firestore and double the cost.
 * Callers should show a stable error message and let the user
 * manually refresh if needed.
 */
export async function loadFeedWithRetry<T>(
  loader: () => Promise<T>,
  options: FeedLoadOptions = {}
): Promise<T> {
  const { timeoutMs = 25000 } = options;
  return withTimeout(loader(), {
    timeoutMs,
    message: `Feed load exceeded ${timeoutMs}ms`,
  });
}
