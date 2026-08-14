// Idempotencia de webhooks: reclamo ATÓMICO de un evento antes de procesarlo.
//
// El patrón `get()` → procesar → `set()` tiene una ventana de carrera: dos
// entregas concurrentes del mismo evento leen "no existe" a la vez y las dos
// procesan. En un webhook de pagos eso es un asiento de ledger duplicado o un
// acceso otorgado dos veces. `create()` no tiene esa ventana: falla si el doc ya
// existe, y esa falla ES la señal de duplicado.
//
// El reclamo se LIBERA si el manejador revienta, para que el reintento del
// proveedor pueda volver a procesarlo. Sin liberarlo, un fallo transitorio
// convertiría el evento en irrecuperable.

import * as admin from "firebase-admin";

// Los docs de reclamo se limpian solos con una política de TTL sobre `expiresAt`.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type WebhookClaim =
  | { claimed: true; release: () => Promise<void>; confirm: () => Promise<void> }
  | { claimed: false; release?: undefined; confirm?: undefined };

/**
 * Intenta reclamar `eventId` en `collection`.
 *
 * - `claimed: false` → ya lo procesó (o lo está procesando) otra entrega.
 * - `claimed: true`  → seguir; llamar a `confirm()` al terminar bien y a
 *   `release()` si el manejador falla.
 */
export async function claimWebhookEvent(
  collection: string,
  eventId: string,
  meta: Record<string, unknown> = {}
): Promise<WebhookClaim> {
  const ref = admin.firestore().collection(collection).doc(eventId);

  try {
    await ref.create({
      ...meta,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + RETENTION_MS),
    });
  } catch {
    // ALREADY_EXISTS — entrega duplicada.
    return { claimed: false };
  }

  return {
    claimed: true,
    confirm: async () => {
      await ref
        .set({ processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        .catch(() => {});
    },
    release: async () => {
      await ref.delete().catch(() => {});
    },
  };
}
