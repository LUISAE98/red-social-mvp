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

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { stripeFetch } from "./stripeClient";
import { getExistingStripeCustomerId } from "./stripeCustomer";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

type StripePaymentMethod = {
  id?: string;
  /** Cliente de Stripe al que está adjunta. `null` si aún no se adjuntó a ninguno. */
  customer?: string | null;
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
  paymentMethodId: string | null | undefined,
  /**
   * Si se pasa, la tarjeta tiene que ser de este usuario.
   *
   * ⚠️ `/payment_methods/{id}` devuelve cualquier método visible para la cuenta
   * de Stripe de Vibra, no solo los del comprador. Sin comprobar el dueño, quien
   * conociera un `pm_...` ajeno podía hacer que el país fiscal —y con él el
   * impuesto— saliera del de OTRA tarjeta. La vía de tarjeta guardada ya validaba
   * el dueño; la de tarjeta nueva no.
   */
  expectedUid?: string | null
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

  // Una tarjeta recién tecleada aún no está adjunta a ningún cliente
  // (`customer: null`), y ese es el caso normal al pagar con tarjeta nueva: para
  // conocer su id hay que haberla creado uno mismo en el navegador. Lo que se
  // descarta es una adjunta a OTRO cliente.
  const pmCustomer = res.data.customer ?? null;
  if (pmCustomer && expectedUid) {
    const propio = await getExistingStripeCustomerId(expectedUid);
    if (pmCustomer !== propio) {
      // No se lanza: este módulo nunca tumba un cobro. Se ignora la tarjeta y el
      // país cae a la IP, que es el comportamiento por defecto de siempre.
      logger.warn("cardOrigin: método de pago de otro cliente", { uid: expectedUid });
      return EMPTY;
    }
  }

  return {
    cardCountry: res.data.card?.country ?? null,
    billingCountry: res.data.billing_details?.address?.country ?? null,
  };
}

/**
 * Origen de la tarjeta para un cobro, mirando las DOS vías por las que puede llegar:
 *
 *  · `paymentMethodId` (`pm_...`) — tarjeta NUEVA, ya materializada por la pasarela al
 *    terminar de escribirla.
 *  · `savedCardDocId` — tarjeta GUARDADA. Es un id de Firestore, no de Stripe, así que
 *    primero se resuelve a su `pm_...` en `users/{uid}/paymentMethods/{id}`.
 *
 * Sin esto, un comprador RECURRENTE (que paga con tarjeta guardada) quedaba con el país
 * decidido solo por su IP — y esa es justo la señal que se puede falsear con una VPN.
 */
export async function cardOriginForCharge(params: {
  uid: string;
  paymentMethodId?: string | null;
  savedCardDocId?: string | null;
}): Promise<CardOrigin> {
  const direct = String(params.paymentMethodId ?? "").trim();
  if (direct) return cardOriginFromPaymentMethod(direct, params.uid);

  const savedId = String(params.savedCardDocId ?? "").trim();
  if (!savedId || !params.uid) return EMPTY;

  try {
    const snap = await db.doc(`users/${params.uid}/paymentMethods/${savedId}`).get();
    const data = snap.data() ?? {};
    // Se valida el dueño: sin esto, un id ajeno podría hacer leer la tarjeta de otro.
    if (!snap.exists || data.buyerId !== params.uid) return EMPTY;

    const stripePmId =
      typeof data.stripePaymentMethodId === "string" ? data.stripePaymentMethodId : null;
    if (!stripePmId) return EMPTY;

    // Aquí el dueño ya se validó contra Firestore justo arriba.
    return cardOriginFromPaymentMethod(stripePmId);
  } catch (err) {
    logger.warn("cardOriginForCharge: no se pudo resolver la tarjeta guardada", {
      err: err instanceof Error ? err.message : String(err),
    });
    return EMPTY;
  }
}
