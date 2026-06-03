export class TimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

type TimeoutOptions = {
  timeoutMs: number;
  message?: string;
};

/**
 * Limits how long an async operation can wait before failing.
 *
 * Important:
 * - This does NOT add Firestore reads.
 * - This does NOT retry by itself.
 * - This only prevents the UI from getting stuck forever.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, message } = options;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new TimeoutError(
          message ?? `Operation timed out after ${timeoutMs}ms`,
          timeoutMs
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}