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

/** Crea el PaymentIntent de un SALUDO/CONSEJO (precio del servidor + IVA + metadata). */
export async function createGreetingStripeIntent(input: {
  greetingRequestId: string;
  saveCard: boolean;
  taxCountry: string | null;
}): Promise<{ clientSecret: string }> {
  const fn = httpsCallable<typeof input, { clientSecret: string }>(functions, "createGreetingStripeIntent");
  const res = await fn(input);
  return res.data;
}

/**
 * Crea el PaymentIntent de un servicio "pagar-luego-crear" genérico, por su
 * `externalReference` (`exclusiveSessionRequest__{id}`, `meetGreetRequest__{id}`, …).
 * Precio + IVA los pone el servidor a partir del paymentIntent ya creado.
 */
export async function createServiceStripeIntent(input: {
  externalReference: string;
  saveCard: boolean;
  taxCountry: string | null;
}): Promise<{ clientSecret: string }> {
  const fn = httpsCallable<typeof input, { clientSecret: string }>(functions, "createServiceStripeIntent");
  const res = await fn(input);
  return res.data;
}
