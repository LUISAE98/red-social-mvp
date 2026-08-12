// Formato de importes para Stripe: paso de redondeo, mínimos por moneda y conversión
// a la unidad mínima que exige su API.
//
// Vive SEPARADO de presentment.ts y SIN dependencias a propósito: lo importa un test del
// frontend (test/unit/presentment.test.ts) que compara este paso de redondeo con el de
// lib/currency/format.ts. Si estuviera junto a resolvePresentment, ese test arrastraría
// firebase-admin y firebase-functions al programa del frontend —que no los instala— y
// reventaría el CI y el build de Vercel con ERR_MODULE_NOT_FOUND.
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
  // Oceanía
  PGK: 0.5, XPF: 50, FJD: 0.5,
  // África
  ZAR: 5, EGP: 10,
  // Norteamérica
  CAD: 0.5,
  // Europa NO comunitaria (2ª tanda)
  GBP: 0.5, TRY: 5, RSD: 20, ALL: 10, MDL: 5,
  // Asia y Golfo (2ª tanda)
  KRW: 500, VND: 5000, AED: 1, SAR: 1,
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
  // África
  ZAR: 0.5,
  // Norteamérica
  CAD: 0.5,
  // Europa no comunitaria — GBP es el único con mínimo publicado
  GBP: 0.3,
  // ISK, BAM, TWD, QAR, KWD, JOD, PGK, XPF, FJD y EGP no aparecen en la lista publicada
  // de mínimos de Stripe.
  // Sin entrada aquí, `meetsStripeMinimum` los deja pasar y Stripe decide.
};

/** Monedas sin decimales para Stripe: el `amount` va en unidades enteras, no en centavos. */
const ZERO_DECIMAL = new Set(["CLP", "PYG", "JPY", "KRW", "VND", "XPF", "XAF", "XOF"]);

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

export function roundNice(amount: number, currency: string): number {
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
