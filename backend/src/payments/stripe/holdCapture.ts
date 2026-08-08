// Captura / cancelación de HOLDS (auth-hold) de Stripe para las 4 EXPERIENCIAS
// (saludo, consejo, sesión exclusiva, tiempo contigo). Modelo de devoluciones:
//   - El comprador AUTORIZA (hold, `capture_method: "manual"`) al confirmar; NO se cobra.
//   - El creador ACEPTA (≤5 días) → se CAPTURA el hold (recién ahí entra el ledger y se
//     paga la comisión de Stripe).
//   - El creador NO responde / RECHAZA → se CANCELA el hold → $0 comisión, sin refund.
//
// Ambas operaciones son TOLERANTES al estado real del PaymentIntent (idempotentes ante
// reintentos y ante el webhook): capturar algo ya capturado o cancelar algo ya cancelado
// no es un error. Fuente única para no repartir llamadas a Stripe por los handlers.

import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { stripeFetch } from "./stripeClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

type StripePI = { id?: string; status?: string };

/** Lee el PaymentIntent de Stripe asociado a un paymentIntents/{externalReference}. */
async function getStripePiId(externalReference: string): Promise<string | null> {
  const snap = await db.collection("paymentIntents").doc(externalReference).get();
  const id = snap.exists ? snap.get("stripePaymentIntentId") : null;
  return typeof id === "string" && id ? id : null;
}

/**
 * Captura el hold (cobra de verdad). Devuelve el status final del PI.
 * Tolerante: si ya estaba capturado ("succeeded") lo trata como éxito. Lanza Error solo
 * si Stripe rechaza la captura por un estado inesperado (p. ej. hold ya expirado/cancelado).
 */
export async function capturePaymentIntentForRef(
  externalReference: string
): Promise<{ status: string }> {
  const piId = await getStripePiId(externalReference);
  if (!piId) throw new Error(`hold: sin PaymentIntent para ${externalReference}`);

  // Estado actual: si ya está capturado, nada que hacer (idempotente).
  const cur = await stripeFetch<StripePI>(`/payment_intents/${piId}`);
  if (cur.ok && cur.data.status === "succeeded") {
    return { status: "succeeded" };
  }

  const res = await stripeFetch<StripePI>(`/payment_intents/${piId}/capture`, {
    method: "POST",
    idempotencyKey: `capture_${externalReference}`,
  });
  if (!res.ok) {
    // Reintento carrera: si entretanto quedó capturado, éxito.
    const after = await stripeFetch<StripePI>(`/payment_intents/${piId}`);
    if (after.ok && after.data.status === "succeeded") return { status: "succeeded" };
    logger.error("hold_capture_failed", { externalReference, piId, err: res.error.slice(0, 300) });
    throw new Error(`No se pudo capturar el pago (${res.status}).`);
  }
  return { status: res.data.status ?? "succeeded" };
}

/**
 * Cancela el hold (libera la retención, $0 comisión). Devuelve:
 *   - canceled: true  → el hold se liberó (o ya estaba liberado).
 *   - alreadyCaptured: true → el PI ya se había CAPTURADO (no se puede cancelar): el
 *     llamador debe tratarlo como cobrado (la devolución, si aplica, es vía refund → B5/B6).
 * Nunca lanza: la cancelación es best-effort (no debe bloquear el rechazo/expiración).
 */
export async function cancelPaymentIntentForRef(
  externalReference: string
): Promise<{ canceled: boolean; alreadyCaptured: boolean }> {
  const piId = await getStripePiId(externalReference);
  if (!piId) return { canceled: false, alreadyCaptured: false };

  const cur = await stripeFetch<StripePI>(`/payment_intents/${piId}`);
  if (cur.ok) {
    if (cur.data.status === "canceled") return { canceled: true, alreadyCaptured: false };
    if (cur.data.status === "succeeded") {
      logger.warn("hold_cancel_skipped_already_captured", { externalReference, piId });
      return { canceled: false, alreadyCaptured: true };
    }
  }

  const res = await stripeFetch<StripePI>(`/payment_intents/${piId}/cancel`, {
    method: "POST",
    idempotencyKey: `cancel_${externalReference}`,
  });
  if (!res.ok) {
    logger.warn("hold_cancel_failed", { externalReference, piId, err: res.error.slice(0, 300) });
    return { canceled: false, alreadyCaptured: false };
  }
  return { canceled: true, alreadyCaptured: false };
}
