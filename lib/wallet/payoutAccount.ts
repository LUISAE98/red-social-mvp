// Alta de cuenta de cobro del creador, del lado del navegador.
//
// Dos llamadas y nada más: pedir el enlace del formulario alojado de Stripe, y releer el estado
// al volver. Toda la conversación con Stripe vive en el backend
// (`backend/src/payments/stripe/globalPayoutsRecipient.ts`); aquí solo se abre la puerta.
//
// El estado real lo publica el backend en `creatorTaxProfiles/{uid}.stripeAccountStatus`, que el
// panel ya escucha en vivo por `useCreatorTaxProfile`. Estas funciones no devuelven la verdad,
// la provocan.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/** Estado del alta, en el mismo vocabulario que usa el backend. */
export type EstadoAltaCobro = "none" | "pending" | "verified" | "restricted";

/**
 * Pide el enlace del formulario donde el creador mete su cuenta bancaria.
 *
 * ⚠️ Se llama **al pulsar**, nunca al abrir el panel: el enlace caduca a los 10 minutos y solo
 * sirve una vez, así que uno generado por adelantado llegaría muerto.
 */
export async function createPayoutAccountLink(): Promise<{ url: string; accountId: string }> {
  const fn = httpsCallable<void, { url: string; accountId: string }>(
    functions,
    "createPayoutAccountLink"
  );
  const { data } = await fn();
  return data;
}

/**
 * Relee la cuenta en Stripe y actualiza el perfil.
 *
 * Se llama al volver del formulario. Stripe avisa por webhook, pero son «thin events» que
 * `stripeWebhook` todavía no entiende; mientras tanto se refresca en el momento en que al
 * creador le importa verlo, que es cuando vuelve.
 */
export async function refreshPayoutAccountStatus(): Promise<{
  status: EstadoAltaCobro;
  country: string | null;
}> {
  const fn = httpsCallable<void, { status: EstadoAltaCobro; country: string | null }>(
    functions,
    "refreshPayoutAccountStatus"
  );
  const { data } = await fn();
  return data;
}
