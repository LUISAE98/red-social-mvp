// Catálogo de monedas de Vibra.
//
// Puro: sin dependencias de framework ni Firebase, para poder importarse desde
// middleware (edge), servidor y cliente por igual.
//
// Modelo: MXN es el ANCLA. Todo precio base y toda la contabilidad viven en MXN.
// Las demás monedas son solo de visualización (conversión encima del MXN).

/**
 * Monedas con cobro nativo previsto en Mercado Pago (operación local por país).
 * SOLO estas pueden vivir en un ledger u orden. Nunca se ensancha a las de visualización.
 */
export const CHARGE_CURRENCIES = [
  "MXN",
  "ARS",
  "BRL",
  "CLP",
  "COP",
  "PEN",
  "UYU",
] as const;
export type ChargeCurrency = (typeof CHARGE_CURRENCIES)[number];

/** Las 26 monedas de visualización (incluye las 7 de cobro). */
export const DISPLAY_CURRENCIES = [
  // Cobro real (7)
  "MXN",
  "ARS",
  "BRL",
  "CLP",
  "COP",
  "PEN",
  "UYU",
  // Solo visualización — se cobran en MXN (19)
  "USD",
  "CAD",
  "BSD",
  "BBD",
  "BZD",
  "BOB",
  "CRC",
  "CUP",
  "XCD",
  "GTQ",
  "GYD",
  "HTG",
  "HNL",
  "JMD",
  "NIO",
  "PYG",
  "DOP",
  "TTD",
  "VES",
] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** Moneda ancla: precio base y contabilidad se guardan aquí. */
export const ANCHOR_CURRENCY: ChargeCurrency = "MXN";

const CHARGE_SET: ReadonlySet<string> = new Set(CHARGE_CURRENCIES);
const DISPLAY_SET: ReadonlySet<string> = new Set(DISPLAY_CURRENCIES);

export function isChargeCurrency(c: string | null | undefined): c is ChargeCurrency {
  return !!c && CHARGE_SET.has(c);
}
export function isDisplayCurrency(c: string | null | undefined): c is DisplayCurrency {
  return !!c && DISPLAY_SET.has(c);
}

/**
 * Monedas de cobro con operación local de Mercado Pago YA activa.
 * Vacío por ahora: hasta integrar MP local, TODO se cobra en MXN.
 * Al activar un país, agrega su moneda aquí y el cobro local se resuelve solo
 * (la regla "≈ solo si visualización ≠ cobro real" no requiere tocar componentes).
 */
export const MP_LIVE_CURRENCIES: ReadonlySet<ChargeCurrency> = new Set<ChargeCurrency>([]);

/**
 * País ISO-3166 alpha-2 → moneda de visualización.
 * 34 países del lanzamiento (continente americano, sin Surinam).
 */
export const COUNTRY_TO_CURRENCY: Readonly<Record<string, DisplayCurrency>> = {
  MX: "MXN",
  AR: "ARS",
  BR: "BRL",
  CL: "CLP",
  CO: "COP",
  PE: "PEN",
  UY: "UYU",
  // USD
  US: "USD",
  EC: "USD",
  SV: "USD",
  PA: "USD",
  // Resto (cobro MXN)
  CA: "CAD",
  BS: "BSD",
  BB: "BBD",
  BZ: "BZD",
  BO: "BOB",
  CR: "CRC",
  CU: "CUP",
  // Dólar del Caribe Oriental (XCD)
  AG: "XCD",
  DM: "XCD",
  GD: "XCD",
  KN: "XCD",
  LC: "XCD",
  VC: "XCD",
  GT: "GTQ",
  GY: "GYD",
  HT: "HTG",
  HN: "HNL",
  JM: "JMD",
  NI: "NIO",
  PY: "PYG",
  DO: "DOP",
  TT: "TTD",
  VE: "VES",
};

/** Moneda de visualización por defecto según país (fallback MXN). */
export function displayCurrencyForCountry(country: string | null | undefined): DisplayCurrency {
  if (!country) return ANCHOR_CURRENCY;
  return COUNTRY_TO_CURRENCY[country.toUpperCase()] ?? ANCHOR_CURRENCY;
}

/**
 * Moneda de COBRO real para un comprador de ese país.
 * Hoy: MXN para todos (MP local no activo). Futuro: su moneda local si está viva.
 */
export function chargeCurrencyForCountry(country: string | null | undefined): ChargeCurrency {
  const cur = displayCurrencyForCountry(country);
  return isChargeCurrency(cur) && MP_LIVE_CURRENCIES.has(cur) ? cur : ANCHOR_CURRENCY;
}
