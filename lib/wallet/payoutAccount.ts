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
  const fn = httpsCallable<
    { origin: string; locale: string },
    { url: string; accountId: string }
  >(functions, "createPayoutAccountLink");

  // De dónde sale y en qué idioma, para que Stripe lo devuelva al mismo sitio y no a
  // producción en inglés. El backend los valida los dos antes de usarlos.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const locale =
    typeof document !== "undefined" ? document.documentElement.lang || "es" : "es";

  const { data } = await fn({ origin, locale });
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

/**
 * Abre el cuestionario donde el creador declara su cuenta de cobro.
 *
 * El backend elige cuál según su ruta: el de Stripe pide la cuenta que va a dar de alta ahí, y
 * el de Wallbit los datos de su cuenta en dólares. Las respuestas viven en Didit; en Vibra solo
 * quedan los últimos 4 dígitos, para poder compararlos.
 */
export async function createPayoutAccountQuestionnaire(): Promise<{
  url: string;
  route: "stripe" | "wallbit";
}> {
  const fn = httpsCallable<
    { origin: string; locale: string },
    { url: string; route: "stripe" | "wallbit" }
  >(functions, "createPayoutAccountQuestionnaire");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const locale =
    typeof document !== "undefined" ? document.documentElement.lang || "es" : "es";

  const { data } = await fn({ origin, locale });
  return data;
}
