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

/** Respuesta de los callables de intent (solo México por ahora: cobro en MXN).
 *  `status` viene sólo en el cobro "un clic" off-session (tarjeta guardada); en el flujo
 *  de tarjeta nueva sólo viene `clientSecret` para confirmar con Elements. */
export type StripeChargeResult = {
  clientSecret?: string;
  status?: string;
};

/** Crea el PaymentIntent de un SALUDO/CONSEJO (precio del servidor + IVA + metadata).
 *  Con `savedPaymentMethodId` → cobro "un clic" off-session (sin CVV; devuelve `status`). */
export async function createGreetingStripeIntent(input: {
  greetingRequestId: string;
  saveCard: boolean;
  taxCountry: string | null;
  savedPaymentMethodId?: string;
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
  savedPaymentMethodId?: string;
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
  savedPaymentMethodId?: string;
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
  savedPaymentMethodId?: string;
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
  savedPaymentMethodId?: string;
}): Promise<StripeChargeResult> {
  const fn = httpsCallable<typeof input, StripeChargeResult>(functions, "createPremiumPostStripeIntent");
  const res = await fn(input);
  return res.data;
}

/** Crea el PaymentIntent de una DONACIÓN en un en vivo (monto dinámico base + $3 + IVA, MXN). */
export async function createLiveDonationStripeIntent(input: {
  postId: string;
  amount: number;
  saveCard: boolean;
  taxCountry: string | null;
  savedPaymentMethodId?: string;
}): Promise<StripeChargeResult> {
  const fn = httpsCallable<typeof input, StripeChargeResult>(functions, "createLiveDonationStripeIntent");
  const res = await fn(input);
  return res.data;
}

/**
 * Crea el PaymentIntent de un SÚPER COMENTARIO (precio fijo del tier + $3 + IVA, MXN; con texto).
 * Si se pasa `savedPaymentMethodId`, el cobro es "un clic" off-session (sin CVV): se confirma
 * server-side y `status` indica el resultado ("succeeded" = cobrado). Sin él, devuelve
 * `clientSecret` para confirmar la tarjeta nueva con Elements.
 */
export async function createSuperCommentStripeIntent(input: {
  postId: string;
  tierId: string;
  text: string;
  saveCard: boolean;
  taxCountry: string | null;
  savedPaymentMethodId?: string;
}): Promise<StripeChargeResult> {
  const fn = httpsCallable<typeof input, StripeChargeResult>(functions, "createSuperCommentStripeIntent");
  const res = await fn(input);
  return res.data;
}

/**
 * Crea la SUSCRIPCIÓN MENSUAL a una comunidad (Stripe Subscriptions nativas; (base+$3)×IVA/mes).
 * Devuelve el `clientSecret` de la 1ª factura para confirmar (tarjeta nueva), o `status`
 * ("succeeded"/"requires_action") si se cobró una tarjeta guardada off-session. La membresía
 * la concede el webhook al aprobarse el cobro. `inviteToken` es obligatorio en comunidades ocultas.
 */
export async function createGroupSubscription(input: {
  groupId: string;
  taxCountry: string | null;
  inviteToken?: string;
  savedPaymentMethodId?: string;
}): Promise<StripeChargeResult & { subscriptionId?: string }> {
  const fn = httpsCallable<typeof input, StripeChargeResult & { subscriptionId?: string }>(functions, "createGroupSubscription");
  const res = await fn(input);
  return res.data;
}

/** Cancela la suscripción a una comunidad (conserva acceso hasta fin del periodo pagado). */
export async function cancelGroupSubscriptionStripe(groupId: string): Promise<{ ok: boolean }> {
  const fn = httpsCallable<{ groupId: string }, { ok: boolean }>(functions, "cancelGroupSubscriptionStripe");
  const res = await fn({ groupId });
  return res.data;
}
