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
  // África (2ª tanda)
  NGN: 200, MAD: 2,
  // Microestados del Pacífico
  TOP: 0.5, SBD: 2, VUV: 20, WST: 0.5,
  // Caribe
  SRD: 5, BZD: 0.5, TTD: 1, JMD: 20, KYD: 0.25, BMD: 0.5, XCD: 0.5, HTG: 20,
  // Europa — microestados
  GIP: 0.5,
  // Cáucaso
  AZN: 0.5,
  // Asia (3ª tanda)
  LKR: 50, KHR: 500, NPR: 20, BTN: 10, BND: 0.5, MNT: 500, MVR: 2,
  // África (3ª tanda)
  BWP: 2, XOF: 100,
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
const ZERO_DECIMAL = new Set([
  "CLP", "PYG", "JPY", "KRW", "VND", "XPF", "XAF", "XOF", "VUV",
]);

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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Redondea a los decimales que la moneda admite de verdad: ninguno en las de unidad entera,
 * tres en los dinares, dos en el resto. No es un redondeo "comercial" ni a un paso — solo
 * quita los decimales que la moneda no puede representar.
 */
export function roundToCurrencyPrecision(amount: number, currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code) || WHOLE_UNIT_ONLY.has(code)) return Math.round(amount);
  if (THREE_DECIMAL.has(code)) return Math.round(amount * 1000) / 1000;
  return round2(amount);
}

/**
 * Redondeo COMERCIAL del total que se le cobra al comprador: deja el precio en `.99` o
 * `.00` en vez de en un importe crudo como 108.65.
 *
 * Regla: el MENOR de (siguiente `.99`, siguiente `.00`) que sea ≥ al monto.
 *   108.65 → 108.99   ·   108.995 → 109.00   ·   109.00 → 109.00   ·   109.50 → 109.99
 *
 * 🚨 SIEMPRE HACIA ARRIBA, nunca hacia abajo. Redondear a la baja puede dejar el cobro por
 * debajo del costo de la transacción, y en cobros chicos eso se come el margen entero. El
 * sobrante del redondeo es de Vibra y va DENTRO de la base gravable (ver composeCharge).
 *
 * A diferencia de `roundNice` —que redondea al múltiplo más cercano del paso de la moneda y
 * sirve para que el precio MOSTRADO no tenga decimales feos— este se aplica al TOTAL final,
 * después del impuesto, y por eso el impuesto hay que despejarlo hacia atrás desde el
 * resultado: si no, el desglose no cuadra con lo que se cobró.
 */
/**
 * Escalón del redondeo comercial, por moneda.
 *
 * ⚠️ Es la QUINTA parte de `NICE_STEP`, y ese divisor no es arbitrario: `NICE_STEP` ya
 * está calibrado para valer lo mismo en poder adquisitivo en las 78 monedas (~0.05–0.50
 * USD), así que dividirlo mantiene esa calibración y deja el escalón en ~0.01–0.10 USD
 * en todas.
 *
 * POR QUÉ SE BAJÓ (2026-08-20). El escalón era 1 unidad de la moneda. En pesos eso son
 * 6 céntimos de dólar y no molestaba, pero en dólares o euros es la unidad entera: un
 * servicio de 2.40 USD saltaba a 2.99, un 49.5% encima del precio del creador. El daño
 * era REGRESIVO — cuanto más barata la experiencia, más se encarecía — y caía justo sobre
 * las compras por impulso.
 *
 * El colchón de variación del tipo de cambio NO depende de esto: lo da el vigilante de
 * deriva, que refresca la tasa congelada en cuanto se desvía un 0.5%.
 *
 * ⚠️ El resultado sigue cumpliendo las dos restricciones de Stripe: entero en las monedas
 * sin decimales y múltiplo de 10 milésimas en las de tres.
 */
function charmStep(code: string): number {
  const nice = NICE_STEP[code] ?? 1;
  return nice / 5;
}

export function roundCharm(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount <= 0) return amount;
  const code = currency.toUpperCase();

  // Sin parte decimal: el ",99" no existe. Se sube al siguiente escalón y se le resta 1
  // para conservar la terminación en 9 (JPY, paso 10: 10.865 → 10.870 → 10.869).
  if (ZERO_DECIMAL.has(code)) {
    const step = Math.max(1, Math.round(charmStep(code)));
    if (step <= 1) return Math.ceil(amount);
    const arriba = Math.ceil(amount / step) * step;
    // ⚠️ Restar 1 puede caer POR DEBAJO del monto cuando ya es múltiplo exacto del paso.
    // Ahí hay que irse al siguiente escalón: cobrar de menos por redondear sería lo
    // contrario de lo que se busca, y puede quedar bajo el mínimo de Stripe.
    const charm = arriba - 1;
    return charm >= amount ? charm : arriba + step - 1;
  }

  // Stripe exige que el último dígito sea 0 en las monedas de tres decimales, así que la
  // terminación comercial es imposible: se sube al escalón y se deja ahí.
  if (THREE_DECIMAL.has(code)) {
    const step = charmStep(code);
    return Math.ceil(amount / step) * step;
  }

  const step = charmStep(code);
  // Sube al siguiente múltiplo del escalón y resta un céntimo: 2.40 con paso 0.10 → 2.49.
  const arriba = Math.ceil(round2(amount + 0.01) / step) * step;
  return round2(arriba - 0.01);
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
