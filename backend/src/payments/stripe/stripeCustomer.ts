// Customer de Stripe por comprador. Se crea una vez y se reutiliza para guardar
// tarjetas (PaymentMethods) y cobrar off-session (un clic / recurrente).
//
// Id guardado en `stripeCustomers/{uid}` (backend-only). El cliente nunca lo lee.

import * as admin from "firebase-admin";
import { stripeFetch } from "./stripeClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

type StripeCustomer = { id?: string };

/** Devuelve el Customer de Stripe del comprador (lo crea si no existe). */
export async function getOrCreateStripeCustomer(uid: string, email?: string | null): Promise<string> {
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
