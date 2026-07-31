// Cliente único de Stripe (SDK oficial). Fuente única de acceso a Stripe para todo
// el backend, igual que facturapiClient / mpClient.
//
// Credenciales en Firebase Secrets (nunca hardcodeadas). El MODO (prueba/producción)
// lo define el TIPO de llave: `sk_test_...` = prueba, `sk_live_...` = producción.
//
// Modelo (ver docs/stripe-integracion.md): Connect + Vibra vendedor de registro,
// agregador (separate charges & transfers). El cutover a live es el último paso.

import Stripe from "stripe";
import { defineSecret } from "firebase-functions/params";

export const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");

// Cliente cacheado por valor de llave (el secreto es estable en runtime; si cambia
// —p.ej. test→live— se reconstruye).
let cached: { key: string; client: Stripe } | null = null;

/** Devuelve el cliente de Stripe. Requiere declarar `stripeSecretKey` en los secrets. */
export function getStripe(): Stripe {
  const key = stripeSecretKey.value().trim();
  if (!key) throw new Error("Falta el secreto STRIPE_SECRET_KEY.");
  if (!cached || cached.key !== key) {
    cached = { key, client: new Stripe(key) };
  }
  return cached.client;
}

/** true si la llave es de PRUEBA (sk_test_...). */
export function isStripeTestMode(): boolean {
  return stripeSecretKey.value().trim().startsWith("sk_test");
}
