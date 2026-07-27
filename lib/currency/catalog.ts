// Catálogo de monedas de Vibra.
//
// Puro: sin dependencias de framework ni Firebase, para poder importarse desde
// middleware (edge), servidor y cliente por igual.
//
// Modelo (dLocal): el precio de referencia se guarda en USD (ancla). El comprador
// SIEMPRE paga en la moneda local de su país; se convierte desde el USD al mostrar
// y al cobrar. La liquidación llega en USD (o MXN si el comprador es de México).

/**
 * Las 15 monedas de los 17 países de lanzamiento (Ecuador, El Salvador y Panamá
 * comparten USD, por eso son 17 países pero 15 monedas distintas).
 */
export const DISPLAY_CURRENCIES = [
  "MXN", // México
  "ARS", // Argentina
  "BOB", // Bolivia
  "BRL", // Brasil
  "CLP", // Chile
  "COP", // Colombia
  "CRC", // Costa Rica
  "GTQ", // Guatemala
  "HNL", // Honduras
  "NIO", // Nicaragua
  "PEN", // Perú
  "PYG", // Paraguay
  "DOP", // República Dominicana
  "UYU", // Uruguay
  "USD", // Ecuador, El Salvador, Panamá
] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/**
 * Con dLocal, el comprador paga en su moneda local: las 15 son de cobro. La
 * distinción "cobro vs visualización" (artefacto de Mercado Pago) ya no aplica.
 */
export const CHARGE_CURRENCIES = DISPLAY_CURRENCIES;
export type ChargeCurrency = DisplayCurrency;

/** Moneda ancla: el precio de referencia se guarda aquí (USD). */
export const ANCHOR_CURRENCY: DisplayCurrency = "USD";

const CHARGE_SET: ReadonlySet<string> = new Set(CHARGE_CURRENCIES);
const DISPLAY_SET: ReadonlySet<string> = new Set(DISPLAY_CURRENCIES);

export function isChargeCurrency(c: string | null | undefined): c is ChargeCurrency {
  return !!c && CHARGE_SET.has(c);
}
export function isDisplayCurrency(c: string | null | undefined): c is DisplayCurrency {
  return !!c && DISPLAY_SET.has(c);
}

/**
 * País ISO-3166 alpha-2 → moneda de visualización.
 * Los 17 países de lanzamiento (Ecuador, El Salvador y Panamá → USD).
 */
export const COUNTRY_TO_CURRENCY: Readonly<Record<string, DisplayCurrency>> = {
  AR: "ARS", // Argentina
  BO: "BOB", // Bolivia
  BR: "BRL", // Brasil
  CL: "CLP", // Chile
  CO: "COP", // Colombia
  CR: "CRC", // Costa Rica
  EC: "USD", // Ecuador
  SV: "USD", // El Salvador
  GT: "GTQ", // Guatemala
  HN: "HNL", // Honduras
  MX: "MXN", // México
  NI: "NIO", // Nicaragua
  PA: "USD", // Panamá
  PY: "PYG", // Paraguay
  PE: "PEN", // Perú
  DO: "DOP", // República Dominicana
  UY: "UYU", // Uruguay
};

/** Moneda de visualización por defecto según país (fallback USD, el ancla). */
export function displayCurrencyForCountry(country: string | null | undefined): DisplayCurrency {
  if (!country) return ANCHOR_CURRENCY;
  return COUNTRY_TO_CURRENCY[country.toUpperCase()] ?? ANCHOR_CURRENCY;
}

/**
 * Moneda de COBRO del comprador (dLocal): siempre su moneda local.
 * (La liquidación a Vibra llega en USD, o MXN si el comprador es de México.)
 */
export function chargeCurrencyForCountry(country: string | null | undefined): ChargeCurrency {
  return displayCurrencyForCountry(country);
}
