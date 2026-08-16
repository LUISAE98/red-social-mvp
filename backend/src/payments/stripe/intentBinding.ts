/**
 * ¿El cobro que llega por webhook es EL cobro vigente de esa compra?
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 * El webhook sacaba `externalReference` de la metadata y materializaba lo que
 * hubiera en `paymentIntents/{externalReference}`, sin comprobar de qué cobro
 * venía el evento.
 *
 * Y de una misma referencia pueden colgar VARIOS cobros de Stripe: al recotizar
 * por el país emisor de la tarjeta cambia el importe, y con él la clave de
 * idempotencia, así que Stripe crea otro. Si el comprador conserva el
 * `client_secret` del primero, puede confirmar el cobro viejo —más barato— y el
 * webhook aprobaba con él la versión nueva y cara de la compra.
 *
 * ── Por qué SOLO se compara el id ────────────────────────────────────────────
 * La auditoría pedía comprobar también importe y moneda. **Hacerlo rechazaría
 * pagos legítimos.** `repriceForCard` corrige el importe —y a veces la moneda—
 * DEL MISMO cobro cuando el país fiscal cambia al leer la tarjeta: el id sigue
 * siendo el mismo y el importe ya no coincide con el que se guardó al crearlo.
 * Comparar contra un importe viejo tumbaría esa compra.
 *
 * El id es exacto y cierra el ataque descrito por completo: un cobro anterior
 * tiene, por definición, otro id. Añadir comprobaciones que fallan solas no hace
 * el sistema más seguro, lo hace más frágil.
 *
 * ⚠️ Si Vibra no tiene id guardado, se acepta. Hay caminos legítimos que
 * confirman antes de persistirlo (tarjeta guardada, pagos 100 % con saldo) y
 * rechazarlos dejaría compras pagadas sin materializar, que es peor que el
 * riesgo que se cierra.
 */

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export type ChargeSnapshot = {
  id: string | null;
  amount: number | null;
  currency: string | null;
};

export async function assertIntentMatchesCharge(
  externalReference: string,
  charge: ChargeSnapshot
): Promise<boolean> {
  const snap = await db.collection("paymentIntents").doc(externalReference).get();
  if (!snap.exists) {
    // Sin documento no hay nada que materializar; que lo resuelva el flujo normal.
    return true;
  }

  const guardado = String(snap.get("stripePaymentIntentId") ?? "").trim();
  if (!guardado || !charge.id) return true;

  if (charge.id !== guardado) {
    logger.warn("intentBinding: cobro que no es el vigente de esta compra", {
      externalReference,
      recibido: charge.id,
      vigente: guardado,
      importeRecibido: charge.amount,
      monedaRecibida: charge.currency,
    });
    return false;
  }

  return true;
}
