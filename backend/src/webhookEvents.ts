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

/**
 * Código gRPC de ALREADY_EXISTS, el único fallo de `create()` que significa
 * "otra entrega ya reclamó este evento". El Admin SDK lo expone como número.
 */
const ALREADY_EXISTS = 6;

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
  } catch (error) {
    // ⚠️ Aquí antes se tragaba CUALQUIER error como "duplicado", y esa confusión
    // costaba pagos. Si Firestore parpadeaba —indisponible, permisos, un fallo
    // pasajero—, el webhook respondía "ya estaba hecho" y 200. El proveedor daba
    // la entrega por buena y NO reintentaba, así que ese evento se perdía para
    // siempre: un cobro sin acceso, una membresía sin activar, un video sin
    // publicar. Y en silencio.
    //
    // Solo ALREADY_EXISTS (código gRPC 6) significa duplicado de verdad. Todo lo
    // demás se propaga: el manejador devolverá un 5xx, el proveedor reintentará,
    // y como el reclamo es atómico el reintento no duplica nada.
    if ((error as { code?: number })?.code === ALREADY_EXISTS) {
      return { claimed: false };
    }
    throw error;
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
