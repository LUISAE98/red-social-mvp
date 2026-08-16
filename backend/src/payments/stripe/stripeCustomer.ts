// Customer de Stripe por comprador. Se crea una vez y se reutiliza para guardar
// tarjetas (PaymentMethods) y cobrar off-session (un clic / recurrente).
//
// Id guardado en `stripeCustomers/{uid}` (backend-only). El cliente nunca lo lee.

import * as admin from "firebase-admin";
import { stripeFetch } from "./stripeClient";
import { assertAccountNotBanned } from "../../accountStatus";
import { consumeQuota } from "../../quotas";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

type StripeCustomer = { id?: string };

/**
 * Customer de Stripe ya existente, o `null`. NO lo crea.
 *
 * Sirve para comprobar de quién es un método de pago: `/payment_methods/{id}`
 * devuelve cualquier método visible para la cuenta de Vibra, no solo los del
 * comprador, así que hay que contrastar su `customer` con el de quien pide.
 */
export async function getExistingStripeCustomerId(uid: string): Promise<string | null> {
  const snap = await db.collection("stripeCustomers").doc(uid).get();
  const existing = String(snap.data()?.customerId ?? "").trim();
  return existing || null;
}

/**
 * Devuelve el Customer de Stripe del comprador (lo crea si no existe).
 *
 * ⚠️ Aquí va el gate de cuenta suspendida, y no en cada callable de cobro, porque
 * este es el paso por el que pasan TODAS: las ocho creaciones de intent más la
 * herramienta de prueba. Un sitio en vez de nueve, y ninguno que se olvide al
 * añadir el siguiente servicio de pago.
 */
export async function getOrCreateStripeCustomer(uid: string, email?: string | null): Promise<string> {
  await assertAccountNotBanned(uid);
  // Mismo motivo que el gate de arriba: por aquí pasan todos los intentos de
  // pago, así que es donde su techo diario cuenta bien.
  await consumeQuota(uid, "paymentAttempt");

  const ref = db.collection("stripeCustomers").doc(uid);
  const snap = await ref.get();
  const existing = String(snap.data()?.customerId ?? "").trim();
  if (existing) return existing;

  const res = await stripeFetch<StripeCustomer>("/customers", {
    method: "POST",
    idempotencyKey: `cust_${uid}`,
    form: {
      metadata: { uid },
      ...(email ? { email } : {}),
    },
  });
  if (!res.ok || !res.data.id) {
    throw new Error(`No se pudo crear el Customer de Stripe: ${res.ok ? "sin id" : res.error.slice(0, 150)}`);
  }
  const customerId = res.data.id;
  await ref.set(
    { uid, customerId, createdAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return customerId;
}
