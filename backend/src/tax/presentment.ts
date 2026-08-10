// Moneda de PRESENTACIÓN: en qué moneda se le cobra realmente al comprador.
//
// EL PROBLEMA QUE RESUELVE
// Hasta ahora todos los intents cobraban en MXN (`SETTLEMENT_CURRENCY`) sin importar el país.
// Un alemán veía un precio en euros y su tarjeta recibía un cargo en pesos mexicanos: el
// monto de su estado de cuenta no coincidía con el que vio, su banco le sumaba SU comisión de
// conversión, y el 2% de FX de Vibra cobraba por un cambio que Vibra no estaba haciendo.
//
// Stripe distingue dos monedas (docs.stripe.com/currencies):
//   · PRESENTACIÓN — la del cargo. Se le cobra al comprador en la suya.
//   · LIQUIDACIÓN  — la de la cuenta bancaria. Stripe convierte y deposita en MXN.
// Stripe acepta las 7 monedas de la UE como moneda de presentación.
//
// El LEDGER NO cambia: la ganancia del creador se sigue calculando sobre `baseAmount` en MXN.
// La moneda de presentación solo afecta con qué divisa se le cobra al comprador.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { SETTLEMENT_CURRENCY } from "../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// El formato de importes vive en un módulo puro (lo comparte un test del frontend).
// Se re-exporta para no romper a quien lo importe desde aquí.
import { NICE_STEP, roundNice, toStripeAmount, meetsStripeMinimum, type Presentment } from "./presentmentFormat";
export { NICE_STEP, roundNice, toStripeAmount, meetsStripeMinimum, type Presentment };

/**
 * Resuelve en qué moneda y por cuánto se le cobra al comprador.
 *
 * `chargedMxn` es el total ya compuesto por `composeCharge` (base + $3 + 2% FX + impuesto),
 * en MXN. Si la moneda de presentación es la de liquidación, se devuelve tal cual.
 *
 * La conversión usa las tasas cacheadas en `config/exchangeRates` (base USD, refrescadas a
 * diario por `updateExchangeRates`), y redondea con el MISMO paso que el frontend para que
 * el precio mostrado y el cobrado coincidan.
 *
 * Si falta la tasa NO se rompe el cobro: se cae a MXN. Es preferible cobrar en pesos a no
 * cobrar, y queda registrado en el log.
 */
export async function resolvePresentment(
  chargedMxn: number,
  presentmentCurrency: string
): Promise<Presentment> {
  const target = presentmentCurrency.toUpperCase();

  if (target === SETTLEMENT_CURRENCY) {
    return {
      currency: SETTLEMENT_CURRENCY,
      amount: chargedMxn,
      amountForStripe: toStripeAmount(chargedMxn, SETTLEMENT_CURRENCY),
      settlementEquivalent: chargedMxn,
      isSettlementCurrency: true,
    };
  }

  const fallback = (reason: string): Presentment => {
    logger.warn("resolvePresentment: se cobra en MXN por falta de tasa", { target, reason });
    return {
      currency: SETTLEMENT_CURRENCY,
      amount: chargedMxn,
      amountForStripe: toStripeAmount(chargedMxn, SETTLEMENT_CURRENCY),
      settlementEquivalent: chargedMxn,
      isSettlementCurrency: true,
    };
  };

  const snap = await db.doc("config/exchangeRates").get();
  const rates = (snap.data()?.rates ?? {}) as Record<string, number>;

  const mxnPerUsd = rates[SETTLEMENT_CURRENCY];
  const targetPerUsd = rates[target];
  if (!mxnPerUsd || !targetPerUsd || mxnPerUsd <= 0 || targetPerUsd <= 0) {
    return fallback("tasa ausente o inválida");
  }

  // MXN → USD (el ancla) → moneda destino.
  const usd = chargedMxn / mxnPerUsd;
  const converted = usd * targetPerUsd;
  const amount = roundNice(converted, target);

  // El redondeo "bonito" mueve el monto unos céntimos; se recalcula el equivalente en MXN
  // para que la conciliación cuadre con lo que de verdad se cobró.
  const settlementEquivalent = Math.round(((amount / targetPerUsd) * mxnPerUsd) * 100) / 100;

  return {
    currency: target,
    amount,
    amountForStripe: toStripeAmount(amount, target),
    settlementEquivalent,
    isSettlementCurrency: false,
  };
}
