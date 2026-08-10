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

/**
 * Paso de redondeo "bonito" por moneda.
 * ⚠️ DUPLICADO de NICE_STEP en lib/currency/format.ts. Deben coincidir: si difieren, el
 * precio mostrado y el cobrado se separan, que es justo el bug que esto viene a cerrar.
 */
export const NICE_STEP: Readonly<Record<string, number>> = {
  USD: 0.5, MXN: 5, ARS: 100, BOB: 1, BRL: 1, CLP: 100, COP: 100, CRC: 100,
  GTQ: 1, HNL: 5, NIO: 5, PEN: 1, PYG: 500, DOP: 10, UYU: 5,
  // Unión Europea
  EUR: 0.5, CZK: 5, DKK: 1, HUF: 100, PLN: 1, RON: 1, SEK: 5,
  // Europa NO comunitaria
  NOK: 5, ISK: 50, BAM: 0.5,
  // Asia-Pacífico y Medio Oriente
  JPY: 50, SGD: 0.5, AUD: 0.5, NZD: 0.5, HKD: 1, TWD: 5, THB: 5,
  MYR: 0.5, PHP: 5, IDR: 5000, QAR: 0.5, KWD: 0.05, JOD: 0.1,
};

/**
 * Monto mínimo de cargo que exige Stripe por moneda (docs.stripe.com/currencies).
 * Por debajo de esto Stripe RECHAZA el cargo, así que hay que detectarlo antes de crear
 * el intent y no después, con un error genérico.
 */
const STRIPE_MIN_CHARGE: Readonly<Record<string, number>> = {
  USD: 0.5, MXN: 10, EUR: 0.5, CZK: 15, DKK: 2.5, HUF: 175, PLN: 2, RON: 2, SEK: 3,
  ARS: 0.5, BRL: 0.5, COP: 0.5,
  NOK: 3,
  // Asia-Pacífico
  AUD: 0.5, HKD: 4, IDR: 0.5, JPY: 50, MYR: 2, NZD: 0.5, PHP: 0.5, SGD: 0.5, THB: 10,
  // ISK, BAM, TWD, QAR, KWD y JOD no aparecen en la lista publicada de mínimos de Stripe.
  // Sin entrada aquí, `meetsStripeMinimum` los deja pasar y Stripe decide.
};

/** Monedas sin decimales para Stripe: el `amount` va en unidades enteras, no en centavos. */
const ZERO_DECIMAL = new Set(["CLP", "PYG", "JPY", "KRW", "VND"]);

/**
 * Monedas que Stripe trata como SIN decimales pero que, por compatibilidad con importes
 * antiguos, siguen expresándose en centavos con los decimales SIEMPRE en `00`.
 *
 * 🚨 Stripe RECHAZA fracciones: para cobrar 5 ISK hay que mandar `500`, nunca `537`.
 * Hoy el `NICE_STEP` de ISK (50) ya garantiza enteros, pero eso es una coincidencia
 * afortunada, no una garantía: si alguien afina ese paso a 0.5 los cargos islandeses
 * empiezan a fallar sin que nada más cambie. Por eso se fuerza aquí y no se confía en el paso.
 */
const WHOLE_UNIT_ONLY = new Set(["ISK", "UGX"]);

/**
 * Monedas de TRES decimales (dinares y dinares del Golfo). El importe va en MILÉSIMAS
 * (fils/millimes), no en centésimas.
 *
 * 🚨 Con la fórmula genérica `amount * 100` se le cobraría al comprador la DÉCIMA PARTE de
 * lo que debe: 15.778 KWD saldría como 1578 milésimas = 1,578 KWD. Además Stripe exige que
 * el último dígito sea 0, así que se redondea a la decena de fils más cercana.
 */
const THREE_DECIMAL = new Set(["KWD", "JOD", "BHD", "OMR", "TND"]);

function roundNice(amount: number, currency: string): number {
  const step = NICE_STEP[currency] ?? 1;
  if (step <= 0) return amount;
  return Math.round(amount / step) * step;
}

export type Presentment = {
  /** Moneda en la que se le cobra al comprador. */
  currency: string;
  /** Monto en esa moneda, ya redondeado. */
  amount: number;
  /** `amount` en la unidad mínima que espera la API de Stripe (centavos, o entero). */
  amountForStripe: number;
  /** Equivalente en MXN, para conciliar contra `chargedAmount`. */
  settlementEquivalent: number;
  /** true si se cobra en la moneda de liquidación (no hubo conversión). */
  isSettlementCurrency: boolean;
};

/** Convierte a la unidad mínima que espera Stripe. */
export function toStripeAmount(amount: number, currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return Math.round(amount);
  // Enteros obligatorios: se redondea la unidad ANTES de pasar a centavos, para que el
  // resultado termine siempre en `00` como exige Stripe.
  if (WHOLE_UNIT_ONLY.has(code)) return Math.round(amount) * 100;
  // Milésimas, redondeadas a la decena para que el último dígito sea 0.
  if (THREE_DECIMAL.has(code)) return Math.round(amount * 100) * 10;
  return Math.round(amount * 100);
}

/** ¿El monto alcanza el mínimo que Stripe exige para esa moneda? */
export function meetsStripeMinimum(amount: number, currency: string): boolean {
  const min = STRIPE_MIN_CHARGE[currency.toUpperCase()];
  return min === undefined ? true : amount >= min;
}

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
