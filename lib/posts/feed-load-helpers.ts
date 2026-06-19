import { withTimeout, isTimeoutError } from "@/lib/async/withTimeout";

export type FeedLoadOptions = {
  timeoutMs?: number;
};

export async function loadFeedWithRetry<T>(
  loader: () => Promise<T>,
  options: FeedLoadOptions = {}
): Promise<T> {
  const { timeoutMs = 12000 } = options;

  const run = () =>
    withTimeout(loader(), {
      timeoutMs,
      message: `Feed load exceeded ${timeoutMs}ms`,
    });

  try {
    return await run();
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    // One automatic retry — Firestore offline cache may now be warmed up
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    return run();
  }
}
