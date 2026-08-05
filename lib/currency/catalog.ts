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

/**
 * Moneda de LIQUIDACIÓN de Vibra: en la que se guarda el ledger y se cobra en Stripe.
 * Hoy MXN (billetera Stripe en MXN). ⚠️ ÚNICO punto para cambiar a "USD" en el frontend
 * (mantener en sync con SETTLEMENT_CURRENCY del backend en backend/src/wallet/ledger.ts).
 * Por ahora SOLO MÉXICO: se cobra en MXN. El cobro en moneda local del comprador
 * extranjero (+2%) es "el sistema completo" que se implementará después (ver
 * docs/stripe-integracion.md §13). Es el default de `baseCurrency` para montos del wallet.
 */
export const SETTLEMENT_CURRENCY: DisplayCurrency = "MXN";

/**
 * Cargo fijo por transacción que ABSORBE EL COMPRADOR (debe coincidir con
 * FIXED_SERVICE_FEE_MXN del backend en backend/src/wallet/ledger.ts). El precio
 * PUBLICADO al comprador = precio base del creador + este cargo; sobre ese total va
 * el IVA. El creador recibe 75% de su base (el $3 y la comisión son de Vibra).
 */
export const FIXED_SERVICE_FEE_MXN = 3;

/**
 * Precio MÍNIMO (base, MXN) que el creador puede fijar por servicio. Si pone menos,
 * se muestra aviso rojo y no se puede publicar. Donación: mínimo por cada monto sugerido.
 */
export const SERVICE_MIN_PRICE_MXN: Record<string, number> = {
  saludo: 50,
  consejo: 50,
  clase_personalizada: 150, // sesión exclusiva
  meet_greet_digital: 150, // tiempo contigo
};
export const DONATION_MIN_AMOUNT_MXN = 50;
/** Precio MÍNIMO (base, MXN) de un POST premium / VOD premium. Por debajo → aviso rojo. */
export const PREMIUM_MIN_PRICE_MXN = 25;
/** Precio MÍNIMO (base, MXN) del TICKET de acceso a un en vivo. Por debajo → aviso rojo. */
export const LIVE_TICKET_MIN_PRICE_MXN = 25;

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
