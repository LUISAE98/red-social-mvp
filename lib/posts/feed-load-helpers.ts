import { isTimeoutError, withTimeout } from "@/lib/async/withTimeout";

export type FeedLoadOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Safe feed loader.
 *
 * Goals:
 * - Avoid feeds hanging forever.
 * - Retry only when needed.
 * - Keep Firestore costs low.
 *
 * Recommended:
 * timeoutMs: 12000
 * retries: 1
 */
export async function loadFeedWithRetry<T>(
  loader: () => Promise<T>,
  options: FeedLoadOptions = {}
): Promise<T> {
  const {
    timeoutMs = 12000,
    retries = 1,
    retryDelayMs = 1000,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(loader(), {
        timeoutMs,
        message: `Feed load exceeded ${timeoutMs}ms`,
      });
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt >= retries;

      if (isLastAttempt) {
        throw error;
      }

      // Retry only on timeout or transient failures
      if (
        isTimeoutError(error) ||
        error instanceof Error
      ) {
        await sleep(retryDelayMs);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Determines whether a feed should show
 * a "taking longer than normal" message.
 */
export function createSlowLoadTimer(
  callback: () => void,
  delayMs = 7000
) {
  return setTimeout(callback, delayMs);
}

/**
 * Cleanup helper.
 */
export function clearSlowLoadTimer(
  timer: ReturnType<typeof setTimeout> | null | undefined
) {
  if (timer) {
    clearTimeout(timer);
  }
}