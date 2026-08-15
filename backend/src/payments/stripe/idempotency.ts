/**
 * Claves de idempotencia ESTABLES para crear objetos en Stripe.
 *
 * El problema que resuelve: los intentos de pago se creaban con
 * `crypto.randomUUID()`. Una clave aleatoria le dice a Stripe "esto es una
 * operación nueva" **cada vez**, así que no deduplica nada. Y el flujo es
 * leer estado → crear el objeto en Stripe → guardar su id: dos ejecuciones
 * concurrentes de la misma compra —doble clic, reintento del cliente, dos
 * pestañas— creaban DOS PaymentIntents o DOS suscripciones, y la segunda
 * sobrescribía el id guardado en Firestore. El objeto huérfano se queda en
 * Stripe, cobrable, sin que nada en Vibra lo conozca.
 *
 * Que la materialización del acceso sea idempotente no arregla esto: el objeto
 * externo ya existe. La convención correcta ya estaba en el repositorio
 * (`capture_${externalReference}` en `holdCapture.ts`), solo que los que CREAN
 * los cobros no la seguían.
 *
 * ⚠️ La clave incluye los parámetros que pueden cambiar legítimamente, no solo
 * la referencia. Stripe devuelve un error si se reusa una clave con parámetros
 * distintos, y el importe sí cambia por motivos válidos: aplicar saldo a favor,
 * un impuesto distinto según el país de la tarjeta, un cambio de moneda. Con el
 * importe dentro de la clave, repetir la MISMA petición deduplica, y una
 * petición de verdad distinta obtiene su propia clave en vez de un error.
 *
 * Las claves de Stripe caducan a las 24 h, que es de sobra para la ventana en la
 * que un doble clic o un reintento pueden solaparse.
 */

import * as crypto from "crypto";

/**
 * @param externalReference Identifica la operación de negocio. Ya es único por
 *   compra (`liveAccess__{liveId}_{uid}`, `greeting__{requestId}`, …).
 * @param partes Lo que puede variar entre intentos legítimos de esa misma
 *   operación. Normalmente importe y moneda.
 */
export function stripeIdempotencyKey(
  externalReference: string,
  ...partes: Array<string | number | null | undefined>
): string {
  const huella = crypto
    .createHash("sha256")
    .update([externalReference, ...partes.map((p) => String(p ?? ""))].join("|"))
    .digest("hex")
    .slice(0, 32);

  return `vibra_${externalReference}_${huella}`.slice(0, 255);
}
