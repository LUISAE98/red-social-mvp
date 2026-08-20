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
import { getFxQuote, type FxQuote } from "./fxQuotes";

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
/**
 * Cuántas unidades de `target` vale 1 de la moneda de liquidación, y con qué cotización.
 *
 * Prefiere la tasa de STRIPE (FX Quotes, congelada una hora). Si su API falla —está en
 * preview— cae a la tabla cacheada de `config/exchangeRates`: es preferible cobrar con una
 * tasa aproximada a no cobrar. Devuelve `null` si tampoco hay tabla utilizable.
 */
async function tasaDestino(
  target: string
): Promise<{ porUnidadLiquidacion: number; quote: FxQuote | null } | null> {
  // 🚨 MANDA LA TABLA CONGELADA, no la cotización viva. Y es el corazón del diseño.
  //
  // El precio que el comprador VE se calcula en el frontend con esta misma tabla. Si aquí
  // se usara la tasa del momento, el importe cobrado saldría de una cotización distinta a
  // la del precio mostrado y los dos números se separarían — que es exactamente el bug que
  // el congelamiento viene a cerrar.
  //
  // La cotización de Stripe se sigue pidiendo, pero para OTRA cosa: adjuntarla al
  // PaymentIntent y garantizar a qué tasa liquida. La diferencia entre la tasa congelada y
  // la de liquidación es la ganancia o pérdida del día, y la cubre el colchón del 2%.
  const quote = await getFxQuote(target, SETTLEMENT_CURRENCY);

  const snap = await db.doc("config/exchangeRates").get();
  const rates = (snap.data()?.rates ?? {}) as Record<string, number>;
  const actualizadaMs =
    typeof snap.get("updatedAt")?.toMillis === "function" ? snap.get("updatedAt").toMillis() : 0;
  const tablaFresca = actualizadaMs > 0 && Date.now() - actualizadaMs <= MAX_ANTIGUEDAD_TASAS_MS;

  const porUsd = rates[SETTLEMENT_CURRENCY];
  const porDestino = rates[target];
  if (tablaFresca && porUsd > 0 && porDestino > 0) {
    return { porUnidadLiquidacion: porDestino / porUsd, quote };
  }

  // 🛟 Sin tabla utilizable se cae a la cotización viva. El precio mostrado y el cobrado
  // pueden separarse unos céntimos, pero es preferible a no poder cobrar.
  if (quote) {
    logger.warn("tasaDestino: tabla congelada inservible, se usa la cotización viva", { target });
    return { porUnidadLiquidacion: 1 / quote.baseRate, quote };
  }
  return null;
}

export async function applyCharmRounding(
  c: ChargeComposition
): Promise<{ charge: ChargeComposition; quote: FxQuote | null; displayAmount: number | null }> {
  const target = c.displayCurrency.toUpperCase();

  if (target === SETTLEMENT_CURRENCY) {
    const redondeado = roundCharm(c.chargedAmount, SETTLEMENT_CURRENCY);
    return { charge: recomposeWithCharged(c, redondeado), quote: null, displayAmount: redondeado };
  }

  const t = await tasaDestino(target);
  if (!t) {
    logger.warn("applyCharmRounding: sin tasa, no se redondea", { target });
    return { charge: c, quote: null, displayAmount: null };
  }

  const local = c.chargedAmount * t.porUnidadLiquidacion;
  const localCharm = roundCharm(local, target);
  const deVuelta = Math.round((localCharm / t.porUnidadLiquidacion) * 100) / 100;

  // El viaje de ida y vuelta puede devolver un céntimo MENOS por el redondeo de la
  // conversión. Cobrar de menos por redondear sería justo lo contrario de lo que se busca.
  if (deVuelta < c.chargedAmount) return { charge: c, quote: t.quote, displayAmount: null };
  // `localCharm` ES el precio que ve el comprador (…,99). Se devuelve para poder cobrar
  // EXACTAMENTE eso: reconvertirlo desde la moneda de liquidación devolvía un par de
  // céntimos de más (411.99 mostrado → 412.01 cobrado) y rompía el precio comercial.
  return { charge: recomposeWithCharged(c, deVuelta), quote: t.quote, displayAmount: localCharm };
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
  presentmentCurrency: string,
  /** Importe EXACTO en la moneda del comprador (el precio comercial ya redondeado). Solo
   *  se usa cuando lo que se cobra es el total íntegro; con saldo a favor de por medio lo
   *  que llega es un residuo y no debe redondearse. */
  exactDisplayAmount?: number | null
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

  const t = await tasaDestino(target);
  if (!t) return fallback("tasa ausente o inválida");

  // Se usa la MISMA tasa que `applyCharmRounding` (la cotización de Stripe, cacheada la
  // misma hora). Si aquí se resolviera por otro camino, el total redondeado y el importe
  // que se le cobra a la tarjeta saldrían de dos cotizaciones distintas.
  const converted = chargedSettlement * t.porUnidadLiquidacion;

  // ⚠️ AQUÍ NO SE REDONDEA A UN PASO, y es deliberado.
  //
  // Antes se aplicaba `roundNice`, que sube al múltiplo más cercano del paso de la moneda.
  // Desde que el TOTAL se redondea comercialmente en `applyCharmRounding`, eso hacía dos daños:
  //   1. DESTRUÍA el precio comercial: 108.99 MXN, con paso 5, volvía a 110.
  //   2. SOBRECOBRABA al aplicar saldo a favor. Lo que llega aquí es el RESTANTE
  //      (total − crédito), que no es un precio sino un residuo; subirlo hacía que
  //      crédito + tarjeta sumaran MÁS que el total que el comprador aceptó.
  // El precio ya viene limpio desde el total; esto solo convierte con la precisión de la moneda.
  const amount = exactDisplayAmount != null && exactDisplayAmount > 0
    ? exactDisplayAmount
    : roundToCurrencyPrecision(converted, target);

  // La precisión de la moneda mueve el monto unos céntimos; se recalcula el equivalente en la
  // de liquidación para que la conciliación cuadre con lo que de verdad se cobró.
  const settlementEquivalent = Math.round((amount / t.porUnidadLiquidacion) * 100) / 100;

  return {
    currency: target,
    amount,
    amountForStripe: toStripeAmount(amount, target),
    settlementEquivalent,
    isSettlementCurrency: false,
  };
}
