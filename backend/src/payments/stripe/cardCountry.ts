// País emisor de una tarjeta, leído de Stripe con el id del método de pago.
//
// POR QUÉ ASÍ Y NO RECIBIENDO EL PAÍS DEL CLIENTE
// El frontend crea el PaymentMethod (sin cobrar) en cuanto el comprador termina de escribir
// la tarjeta, y manda al backend solo el `pm_...`. El backend consulta a Stripe cuál es el país
// emisor. El cliente nunca envía un país: envía un identificador que el servidor verifica.
//
// Si el frontend mandara `cardCountry` directamente, volveríamos al agujero que cerramos en
// `resolveCountry.ts`: un comprador mexicano diría "mi tarjeta es de Argentina" y evadiría el
// 16%. Con el `pm_...` eso es imposible — el dato sale de Stripe, no del navegador.
//
// Ver impuestos.md §3.4.

import { logger } from "firebase-functions";
import { stripeFetch } from "./stripeClient";

type StripePaymentMethod = {
  id?: string;
  card?: { country?: string | null } | null;
  billing_details?: { address?: { country?: string | null } | null } | null;
};

export type CardOrigin = {
  /** País emisor de la tarjeta (BIN). El indicio más difícil de falsificar. */
  cardCountry: string | null;
  /** País del domicilio de facturación, si el comprador lo capturó. Sirve de desempate. */
  billingCountry: string | null;
};

const EMPTY: CardOrigin = { cardCountry: null, billingCountry: null };

/**
 * Lee el origen de la tarjeta a partir del id del método de pago.
 *
 * Nunca lanza: si Stripe falla o el id es inválido devuelve nulos, y el resolutor de país cae
 * a la IP. Un problema leyendo el BIN no debe tumbar un cobro.
 */
export async function cardOriginFromPaymentMethod(
  paymentMethodId: string | null | undefined
): Promise<CardOrigin> {
  const id = String(paymentMethodId ?? "").trim();
  if (!id) return EMPTY;

  // Sanidad: los ids de método de pago de Stripe empiezan con `pm_`.
  if (!id.startsWith("pm_")) {
    logger.warn("cardOriginFromPaymentMethod: id con formato inesperado", { id: id.slice(0, 12) });
    return EMPTY;
  }

  const res = await stripeFetch<StripePaymentMethod>(`/payment_methods/${id}`);
  if (!res.ok) {
    logger.warn("cardOriginFromPaymentMethod: no se pudo leer el método de pago", {
      status: res.status,
    });
    return EMPTY;
  }

  return {
    cardCountry: res.data.card?.country ?? null,
    billingCountry: res.data.billing_details?.address?.country ?? null,
  };
}
