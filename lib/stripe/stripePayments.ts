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

/** Respuesta de los callables de intent (solo México por ahora: cobro en MXN). */
export type StripeChargeResult = {
  clientSecret: string;
};

/** Crea el PaymentIntent de un SALUDO/CONSEJO (precio del servidor + IVA + metadata). */
export async function createGreetingStripeIntent(input: {
  greetingRequestId: string;
  saveCard: boolean;
  taxCountry: string | null;
}): Promise<StripeChargeResult> {
  const fn = httpsCallable<typeof input, StripeChargeResult>(functions, "createGreetingStripeIntent");
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
}): Promise<StripeChargeResult> {
  const fn = httpsCallable<typeof input, StripeChargeResult>(functions, "createServiceStripeIntent");
  const res = await fn(input);
  return res.data;
}

/** Crea el PaymentIntent de una DONACIÓN a perfil (monto dinámico + $3 + IVA, MXN). */
export async function createDonationStripeIntent(input: {
  creatorId: string;
  amount: number;
  saveCard: boolean;
  taxCountry: string | null;
  groupId?: string | null;
  groupName?: string | null;
}): Promise<StripeChargeResult> {
  const fn = httpsCallable<typeof input, StripeChargeResult>(functions, "createDonationStripeIntent");
  const res = await fn(input);
  return res.data;
}

/** Crea el PaymentIntent del TICKET de un en vivo (acceso pagado; base + $3 + IVA, MXN). */
export async function createLiveAccessStripeIntent(input: {
  postId: string;
  saveCard: boolean;
  taxCountry: string | null;
}): Promise<StripeChargeResult> {
  const fn = httpsCallable<typeof input, StripeChargeResult>(functions, "createLiveAccessStripeIntent");
  const res = await fn(input);
  return res.data;
}

/** Crea el PaymentIntent del desbloqueo de un POST premium / VOD (base + $3 + IVA, MXN). */
export async function createPremiumPostStripeIntent(input: {
  postId: string;
  saveCard: boolean;
  taxCountry: string | null;
}): Promise<StripeChargeResult> {
  const fn = httpsCallable<typeof input, StripeChargeResult>(functions, "createPremiumPostStripeIntent");
  const res = await fn(input);
  return res.data;
}
