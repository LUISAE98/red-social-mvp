import { withTimeout, isTimeoutError } from "@/lib/async/withTimeout";

export type FeedLoadOptions = {
  timeoutMs?: number;
};

/**
 * ¿El fallo fue el corte por tiempo del feed (y no un error real)?
 *
 * El timeout es una red de seguridad para que la UI no se quede colgada, NO un
 * problema que el usuario deba resolver: `loadFeedWithRetry` ya reintenta solo,
 * y quedan el pull-to-refresh y la caché de Firestore. Por eso los feeds lo
 * silencian en vez de sacar un toast (antes se mostraba el mensaje crudo
 * "Feed load exceeded 12000ms": en inglés, con milisegundos y sin acción posible).
 */
export function isFeedLoadTimeout(error: unknown): boolean {
  return isTimeoutError(error);
}

export async function loadFeedWithRetry<T>(
  loader: () => Promise<T>,
  options: FeedLoadOptions = {}
): Promise<T> {
  const { timeoutMs = 12000 } = options;

  const run = () =>
    withTimeout(loader(), {
      timeoutMs,
      // Mensaje interno: nunca se muestra al usuario (ver isFeedLoadTimeout).
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
