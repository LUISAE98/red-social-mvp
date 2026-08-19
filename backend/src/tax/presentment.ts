// Moneda de PRESENTACIÓN: en qué moneda se le cobra realmente al comprador.
//
// EL PROBLEMA QUE RESUELVE
// Hasta ahora todos los intents cobraban en la moneda de liquidación sin importar el país.
// Un alemán veía un precio en euros y su tarjeta recibía un cargo en la moneda de liquidación: el
// monto de su estado de cuenta no coincidía con el que vio, su banco le sumaba SU comisión de
// conversión, y el 2% de FX de Vibra cobraba por un cambio que Vibra no estaba haciendo.
//
// Stripe distingue dos monedas (docs.stripe.com/currencies):
//   · PRESENTACIÓN — la del cargo. Se le cobra al comprador en la suya.
//   · LIQUIDACIÓN  — la de la cuenta bancaria. Stripe convierte y deposita en USD.
// Stripe acepta las 7 monedas de la UE como moneda de presentación.
//
// El LEDGER NO cambia: la ganancia del creador se sigue calculando sobre `baseAmount`.
// La moneda de presentación solo afecta con qué divisa se le cobra al comprador.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { SETTLEMENT_CURRENCY } from "../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Cuánto puede envejecer la tabla de cambio antes de dejar de usarla.
 *
 * La tarea que la actualiza corre a diario, así que 48 h deja margen para un
 * fallo puntual sin dejar de cobrar en moneda local, pero corta en seco si la
 * tarea lleva días rota.
 */
const MAX_ANTIGUEDAD_TASAS_MS = 48 * 60 * 60 * 1000;

// El formato de importes vive en un módulo puro (lo comparte un test del frontend).
// Se re-exporta para no romper a quien lo importe desde aquí.
import { NICE_STEP, roundNice, roundCharm, roundToCurrencyPrecision, toStripeAmount, meetsStripeMinimum, type Presentment } from "./presentmentFormat";
export { NICE_STEP, roundNice, roundCharm, roundToCurrencyPrecision, toStripeAmount, meetsStripeMinimum, type Presentment };
import { recomposeWithCharged, type ChargeComposition } from "./composeCharge";

/**
 * Deja el TOTAL en un precio comercial (`.99` / `.00`) **en la moneda del comprador**, y
 * recompone el desglose desde ahí.
 *
 * Por qué en la moneda del comprador y no en la de liquidación: el precio que él ve y decide
 * es el suyo. Redondear los dólares dejaría 12.99 USD, que para un mexicano son 221.22 —
 * exactamente el número feo que esto viene a quitar.
 *
 * El viaje es ida y vuelta: total en USD → moneda local → se redondea → de vuelta a USD.
 * El desglose se recompone desde ese USD final (`recomposeWithCharged`), así que lo que se
 * guarda en el `paymentIntent` cuadra con lo que de verdad se cobra.
 *
 * Si falta la tasa de cambio NO se redondea y se devuelve la composición intacta: es
 * preferible un total con decimales que uno inventado con una cotización que no se tiene.
 */
export async function applyCharmRounding(c: ChargeComposition): Promise<ChargeComposition> {
  const target = c.displayCurrency.toUpperCase();

  if (target === SETTLEMENT_CURRENCY) {
    return recomposeWithCharged(c, roundCharm(c.chargedAmount, SETTLEMENT_CURRENCY));
  }

  const snap = await db.doc("config/exchangeRates").get();
  const rates = (snap.data()?.rates ?? {}) as Record<string, number>;
  const actualizadaMs =
    typeof snap.get("updatedAt")?.toMillis === "function" ? snap.get("updatedAt").toMillis() : 0;
  if (!actualizadaMs || Date.now() - actualizadaMs > MAX_ANTIGUEDAD_TASAS_MS) {
    logger.warn("applyCharmRounding: sin tasas frescas, no se redondea", { target });
    return c;
  }

  const porUsd = rates[SETTLEMENT_CURRENCY];
  const porDestino = rates[target];
  if (!porUsd || !porDestino || porUsd <= 0 || porDestino <= 0) return c;

  const local = (c.chargedAmount / porUsd) * porDestino;
  const localCharm = roundCharm(local, target);
  const deVuelta = Math.round(((localCharm / porDestino) * porUsd) * 100) / 100;

  // El viaje de ida y vuelta puede devolver un céntimo MENOS por el redondeo de la
  // conversión. Cobrar de menos por redondear sería justo lo contrario de lo que se busca.
  if (deVuelta < c.chargedAmount) return c;
  return recomposeWithCharged(c, deVuelta);
}

/**
 * Resuelve en qué moneda y por cuánto se le cobra al comprador.
 *
 * `chargedSettlement` es el total ya compuesto por `composeCharge` (base + cargo fijo + FX +
 * impuesto), en la moneda de liquidación. Si la de presentación es la misma, se devuelve tal cual.
 *
 * La conversión usa las tasas cacheadas en `config/exchangeRates` (base USD, refrescadas a
 * diario por `updateExchangeRates`), y redondea con el MISMO paso que el frontend para que
 * el precio mostrado y el cobrado coincidan.
 *
 * Si falta la tasa NO se rompe el cobro: se cae a MXN. Es preferible cobrar en pesos a no
 * cobrar, y queda registrado en el log.
 */
export async function resolvePresentment(
  chargedSettlement: number,
  presentmentCurrency: string
): Promise<Presentment> {
  const target = presentmentCurrency.toUpperCase();

  if (target === SETTLEMENT_CURRENCY) {
    return {
      currency: SETTLEMENT_CURRENCY,
      amount: chargedSettlement,
      amountForStripe: toStripeAmount(chargedSettlement, SETTLEMENT_CURRENCY),
      settlementEquivalent: chargedSettlement,
      isSettlementCurrency: true,
    };
  }

  const fallback = (reason: string): Presentment => {
    logger.warn("resolvePresentment: se cobra en la moneda de liquidación por falta de tasa", { target, reason });
    return {
      currency: SETTLEMENT_CURRENCY,
      amount: chargedSettlement,
      amountForStripe: toStripeAmount(chargedSettlement, SETTLEMENT_CURRENCY),
      settlementEquivalent: chargedSettlement,
      isSettlementCurrency: true,
    };
  };

  const snap = await db.doc("config/exchangeRates").get();
  const rates = (snap.data()?.rates ?? {}) as Record<string, number>;

  // ⚠️ Una tasa vieja es peor que ninguna tasa.
  //
  // Antes solo se comprobaba que la tasa EXISTIERA. La actualiza una tarea diaria;
  // si esa tarea se rompe —el proveedor cae, cambia de formato, expira algo— el
  // documento se queda congelado y Vibra sigue cobrando en moneda extranjera con
  // la cotización de hace semanas, sin que nada avise. Cobrar de menos es pérdida
  // directa; cobrar de más es una queja del comprador.
  //
  // Pasado el margen se cae a la de liquidación, que es el comportamiento que ya existía cuando
  // falta la tasa: se cobra en la moneda de liquidación y no se inventa un cambio.
  const actualizadaMs =
    typeof snap.get("updatedAt")?.toMillis === "function" ? snap.get("updatedAt").toMillis() : 0;

  if (!actualizadaMs || Date.now() - actualizadaMs > MAX_ANTIGUEDAD_TASAS_MS) {
    return fallback(
      actualizadaMs
        ? `tasas caducadas (${Math.round((Date.now() - actualizadaMs) / 3_600_000)} h)`
        : "tasas sin fecha de actualización"
    );
  }

  const porUsdLiq = rates[SETTLEMENT_CURRENCY];
  const targetPerUsd = rates[target];
  if (!porUsdLiq || !targetPerUsd || porUsdLiq <= 0 || targetPerUsd <= 0) {
    return fallback("tasa ausente o inválida");
  }

  // Liquidación → USD (el ancla) → moneda destino.
  const usd = chargedSettlement / porUsdLiq;
  const converted = usd * targetPerUsd;

  // ⚠️ AQUÍ NO SE REDONDEA A UN PASO, y es deliberado.
  //
  // Antes se aplicaba `roundNice`, que sube al múltiplo más cercano del paso de la moneda.
  // Desde que el TOTAL se redondea comercialmente en `applyCharmRounding`, eso hacía dos daños:
  //   1. DESTRUÍA el precio comercial: 108.99 MXN, con paso 5, volvía a 110.
  //   2. SOBRECOBRABA al aplicar saldo a favor. Lo que llega aquí es el RESTANTE
  //      (total − crédito), que no es un precio sino un residuo; subirlo hacía que
  //      crédito + tarjeta sumaran MÁS que el total que el comprador aceptó.
  // El precio ya viene limpio desde el total; esto solo convierte con la precisión de la moneda.
  const amount = roundToCurrencyPrecision(converted, target);

  // La precisión de la moneda mueve el monto unos céntimos; se recalcula el equivalente en la
  // de liquidación para que la conciliación cuadre con lo que de verdad se cobró.
  const settlementEquivalent = Math.round(((amount / targetPerUsd) * porUsdLiq) * 100) / 100;

  return {
    currency: target,
    amount,
    amountForStripe: toStripeAmount(amount, target),
    settlementEquivalent,
    isSettlementCurrency: false,
  };
}
