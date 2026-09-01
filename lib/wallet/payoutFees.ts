// Lo que Stripe cobra por enviarle el dinero al creador — MODELO DE COSTE.
//
// 🚨 ESTO NO DECIDE NINGÚN PAGO. La cifra autoritativa de un retiro concreto sale de un
//    `OutboundPaymentQuote` contra Stripe, que devuelve `payout_fee`, `cross_border_fee` y
//    `fx_fee` reales. Esta tabla existe para PREVER el margen —cuánto nos cuesta operar en
//    cada país— y para poder generar la documentación desde el código en vez de a mano.
//
//    Si algún día una de estas cifras se usa para validar saldo o para prometerle algo al
//    creador, está mal usada: pide la cotización.
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────
//
// Durante dos semanas los tres documentos financieros dijeron que el coste transfronterizo
// era «0.25% en México, Estados Unidos, Reino Unido y Canadá, 1% en el resto y 1.25% en Perú».
// Eso salió de una frase suelta de nuestra propia documentación, no de la tabla de Stripe, y
// estaba mal en **once** de nuestros países: Polonia y Dinamarca son 0.50%, Rumanía y Turquía
// 0.75%, y así. El FX tampoco es plano: entre USD, EUR y GBP es 0.50%, no 1%.
//
// Ahora la tabla vive aquí, copiada de la fuente oficial, y la documentación se genera de
// ella. Ese es el único modo de que no vuelvan a separarse.
//
// Fuente: https://docs.stripe.com/global-payouts/pricing (consultada 2026-08-31).
//
// ⚠️ VIVE SOLO EN `lib/`, sin espejo en el backend, y es a propósito. El backend no calcula
//    comisiones de payout: se las pregunta a Stripe. Un espejo aquí sería una segunda fuente
//    de verdad para un dato que ya tiene dueño.

/** Emisor de los pagos. Vibra On, LLC paga desde Estados Unidos. */
export const PAIS_EMISOR = "US";

/** Fijo por envío, en USD, para un emisor estadounidense. */
export const FIJO_TRANSFERENCIA_LOCAL = 1.5;
export const FIJO_WIRE = 25;

/**
 * Comisión transfronteriza por país de DESTINO, para un emisor estadounidense.
 *
 * ⚠️ Los países de la eurozona figuran en Stripe como «0% para emisores de la eurozona, 0.25%
 * para los demás». Vibra emite desde Estados Unidos, así que les toca **0.25%**. Si algún día
 * Vibra abre entidad en la eurozona, esta tabla cambia entera para ellos.
 */
export const TRANSFRONTERIZA: Readonly<Record<string, number>> = Object.freeze({
  // 0.25% — eurozona (desde EE. UU.), más los mercados grandes
  AT: 0.0025, BE: 0.0025, BG: 0.0025, CY: 0.0025, CZ: 0.0025, DE: 0.0025, EE: 0.0025,
  ES: 0.0025, FI: 0.0025, FR: 0.0025, GR: 0.0025, HR: 0.0025, HU: 0.0025, IE: 0.0025,
  IS: 0.0025, IT: 0.0025, LI: 0.0025, LT: 0.0025, LU: 0.0025, LV: 0.0025, MT: 0.0025,
  MX: 0.0025, NL: 0.0025, NO: 0.0025, PT: 0.0025, SE: 0.0025, SI: 0.0025, SK: 0.0025,
  CH: 0.0025, GB: 0.0025, CA: 0.0025, US: 0.0025,

  // 0.50%
  DK: 0.005, HK: 0.005, ID: 0.005, IL: 0.005, JM: 0.005, MA: 0.005, NZ: 0.005,
  PL: 0.005, SG: 0.005, ZA: 0.005, TH: 0.005, TT: 0.005, TN: 0.005,

  // 0.75%
  IN: 0.0075, KE: 0.0075, RO: 0.0075, TR: 0.0075,

  // 1.00%
  AL: 0.01, DZ: 0.01, AG: 0.01, AM: 0.01, AU: 0.01, BS: 0.01, BH: 0.01, BJ: 0.01,
  BA: 0.01, BW: 0.01, BT: 0.01, BN: 0.01, CI: 0.01, EC: 0.01, SV: 0.01, ET: 0.01,
  GM: 0.01, GT: 0.01, GY: 0.01, JO: 0.01, KW: 0.01, MG: 0.01, MY: 0.01, MU: 0.01,
  MD: 0.01, MN: 0.01, MZ: 0.01, NA: 0.01, MK: 0.01, OM: 0.01, PA: 0.01, PH: 0.01,
  QA: 0.01, RW: 0.01, LC: 0.01, SN: 0.01, RS: 0.01, LK: 0.01, TW: 0.01, TZ: 0.01,
  AE: 0.01, VN: 0.01,

  // 1.25%
  PE: 0.0125,
});

/**
 * Países a los que Vibra puede pagar y que **Stripe no lista** en su tabla de comisiones.
 *
 * 🔴 No es que sean gratis: es que no sabemos qué cobran. Ocho de los 85 pagables.
 * Hasta confirmarlo con Stripe se les modela el **peor caso (1%)** y se marcan aparte, para
 * que ningún cálculo de margen los dé por baratos por descuido.
 */
export const SIN_TARIFA_PUBLICADA: readonly string[] = [
  "CR", "DO", "MC", "SM", "JP", "EG", "NG", "KH",
];

/** Las tres monedas entre las que Stripe cobra FX reducido. */
const FX_BARATO = new Set(["USD", "EUR", "GBP"]);

/** Moneda de liquidación de Vibra. Sin conversión no hay comisión de conversión. */
const MONEDA_EMISOR = "USD";

/**
 * Comisión de conversión, para un emisor estadounidense.
 *
 * `0` si el creador cobra en dólares (no hay nada que convertir), `0.005` entre USD, EUR y
 * GBP, `0.01` en cualquier otro caso. Un emisor NO estadounidense pagaría el 2%.
 */
export function comisionConversion(monedaDestino: string | null | undefined): number {
  const m = (monedaDestino ?? "").toUpperCase();
  if (!m || m === MONEDA_EMISOR) return 0;
  return FX_BARATO.has(m) ? 0.005 : 0.01;
}

/**
 * Comisión transfronteriza del país de destino.
 *
 * `0` cuando el destino es el propio país del emisor —no es transfronterizo—, y el peor caso
 * del 1% para los países sin tarifa publicada.
 */
export function comisionTransfronteriza(paisDestino: string | null | undefined): number {
  const c = (paisDestino ?? "").toUpperCase();
  if (!c) return 0.01;
  if (c === PAIS_EMISOR) return 0;
  const t = TRANSFRONTERIZA[c];
  if (typeof t === "number") return t;
  return 0.01; // sin tarifa publicada: peor caso
}

export type CosteRetiro = {
  /** Fijo por envío. */
  fijo: number;
  /** Comisión transfronteriza en dinero. */
  transfronteriza: number;
  /** Comisión de conversión en dinero. */
  conversion: number;
  /** Suma de las tres. */
  total: number;
  /** Las tasas aplicadas, para poder enseñarlas. */
  tasaTransfronteriza: number;
  tasaConversion: number;
  /** Si el país no tiene tarifa publicada y se está modelando el peor caso. */
  estimado: boolean;
};

/**
 * Lo que cuesta enviarle `importe` a un creador de `paisDestino` que cobra en `monedaDestino`.
 *
 * Wallbit no pasa por aquí: su envío se hace a mano y no tenemos su tarifa.
 */
export function costeRetiro(params: {
  importe: number;
  paisDestino: string | null | undefined;
  monedaDestino: string | null | undefined;
  wire?: boolean;
}): CosteRetiro {
  const { importe, paisDestino, monedaDestino, wire } = params;
  const tasaTransfronteriza = comisionTransfronteriza(paisDestino);
  const tasaConversion = comisionConversion(monedaDestino);
  const fijo = wire ? FIJO_WIRE : FIJO_TRANSFERENCIA_LOCAL;
  const transfronteriza = round2(importe * tasaTransfronteriza);
  const conversion = round2(importe * tasaConversion);
  return {
    fijo,
    transfronteriza,
    conversion,
    total: round2(fijo + transfronteriza + conversion),
    tasaTransfronteriza,
    tasaConversion,
    estimado:
      !!paisDestino && SIN_TARIFA_PUBLICADA.includes(paisDestino.toUpperCase()),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Lo que Vibra absorbe del COBRO, como fracción del importe cobrado a la tarjeta.
 *
 * El 1% de conversión que cobra Stripe no está aquí: lo cubre el 2% que paga el comprador,
 * junto con el candado de la FX Quotes API y el colchón contra la deriva del dólar. Ese 2%
 * está COMPROMETIDO — restárselo a estas tasas sería gastar el mismo dinero dos veces.
 */
export const PAYIN_TARJETA_ESTADOUNIDENSE = 0.029;
export const PAYIN_TARJETA_INTERNACIONAL = 0.044;

/** Fijo de Stripe por cobro (0.30 de procesamiento + 0.05 de Radar). Lo cubre el comprador. */
export const PAYIN_FIJO_STRIPE = 0.35;
