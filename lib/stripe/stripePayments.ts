"use client";

// Wrappers cliente de los callables de pago de Stripe.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/** Crea un PaymentIntent (devuelve el client_secret para confirmar con Elements). */
export async function createStripePaymentIntent(input: {
  amount: number; // MXN (pesos)
  saveCard: boolean;
}): Promise<{ clientSecret: string; customerId: string }> {
  const fn = httpsCallable<{ amount: number; saveCard: boolean }, { clientSecret: string; customerId: string }>(
    functions,
    "createStripePaymentIntent"
  );
  const res = await fn(input);
  return res.data;
}
