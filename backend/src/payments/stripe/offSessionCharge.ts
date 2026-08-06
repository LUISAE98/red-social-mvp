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
import * as admin from "firebase-admin";
import { stripeFetch } from "./stripeClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

type StripePaymentIntent = { id: string; client_secret: string; status?: string };

/**
 * Si el cobro off-session falla porque el emisor pide autenticación (3DS), Stripe
 * responde 402 con el PaymentIntent DENTRO del cuerpo de error. Lo extraemos para
 * devolver `requires_action` + client_secret y que el cliente complete el 3DS, en vez
 * de tratar la tarjeta como rechazada. Devuelve null si el error no es de autenticación.
 */
export function extractAuthRequiredPI(errorText: string): { id: string; status: string; clientSecret: string } | null {
  try {
    const parsed = JSON.parse(errorText) as {
      error?: { code?: string; payment_intent?: { id?: string; client_secret?: string; status?: string } };
    };
    const pi = parsed.error?.payment_intent;
    if (parsed.error?.code === "authentication_required" && pi?.id && pi.client_secret) {
      return { id: pi.id, status: pi.status ?? "requires_action", clientSecret: pi.client_secret };
    }
  } catch {
    /* el error no era JSON o no traía PaymentIntent */
  }
  return null;
}

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
    // Clave de idempotencia ESTABLE por externalReference: si el callable se reintenta
    // con la MISMA referencia (reintento de red tras un cobro que sí pasó, doble clic),
    // Stripe devuelve el MISMO PaymentIntent en vez de cobrar dos veces.
    idempotencyKey: `offsession_${metadata.externalReference}`,
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
  if (!res.ok) {
    // 3DS: el emisor pide autenticación → devolvemos requires_action + client_secret
    // para que el cliente complete el 3DS (no tratar la tarjeta como rechazada).
    const recovered = extractAuthRequiredPI(res.error);
    if (recovered) return recovered;
    // Rechazo real (fondos, tarjeta inválida, etc.): el cliente muestra el error.
    throw new HttpsError("failed-precondition", "No se pudo cobrar tu tarjeta guardada. Intenta con otra.");
  }
  return { id: res.data.id, status: res.data.status ?? "succeeded", clientSecret: res.data.client_secret };
}
