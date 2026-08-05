// Cobro "un clic" con tarjeta guardada (off-session, sin CVV) — COMPARTIDO por todos los
// callables de intent de Stripe. Resuelve el payment_method guardado del comprador y
// confirma el PaymentIntent server-side; el webhook materializa la compra vía el
// `externalReference` de la metadata (idéntico al flujo de tarjeta nueva). El precio SIGUE
// siendo server-authoritative — este helper solo recibe el monto ya calculado.
//
// La tarjeta se persiste en `users/{uid}/paymentMethods/{pmId}` (doc id = payment_method de
// Stripe) desde el webhook, cuando una compra previa se pagó con `setup_future_usage`. Así,
// una tarjeta guardada en CUALQUIER pasarela queda disponible para todos los servicios.

import { HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { stripeFetch } from "./stripeClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

type StripePaymentIntent = { id: string; client_secret: string; status?: string };

/**
 * Confirma un PaymentIntent off-session con la tarjeta guardada del comprador.
 * Lanza HttpsError si la tarjeta no existe/ no es suya, o si el cargo se rechaza.
 * Devuelve el id, el status (p. ej. "succeeded") y el client_secret (por si el
 * cliente debe completar una autenticación SCA).
 */
export async function chargeSavedCardOffSession(opts: {
  uid: string;
  savedCardDocId: string;
  customerId: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; status: string; clientSecret: string }> {
  const { uid, savedCardDocId, customerId, amountCents, currency, metadata } = opts;

  const pmSnap = await db.doc(`users/${uid}/paymentMethods/${savedCardDocId}`).get();
  const pm = pmSnap.data() ?? {};
  const stripePaymentMethodId = typeof pm.stripePaymentMethodId === "string" ? pm.stripePaymentMethodId : null;
  if (!pmSnap.exists || pm.buyerId !== uid || !stripePaymentMethodId) {
    throw new HttpsError("not-found", "Tarjeta guardada no encontrada.");
  }

  const res = await stripeFetch<StripePaymentIntent>("/payment_intents", {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    form: {
      amount: amountCents,
      currency: currency.toLowerCase(),
      customer: customerId,
      payment_method: stripePaymentMethodId,
      payment_method_types: ["card"],
      confirm: true,
      off_session: true,
      metadata,
    },
  });
  // Rechazo off-session (fondos, autenticación requerida, etc.): el intent queda
  // awaiting_payment (inofensivo). El cliente muestra el error / cae a la pasarela.
  if (!res.ok) throw new HttpsError("failed-precondition", "No se pudo cobrar tu tarjeta guardada. Intenta con otra.");
  return { id: res.data.id, status: res.data.status ?? "succeeded", clientSecret: res.data.client_secret };
}
