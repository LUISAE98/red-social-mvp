// Configuración fiscal + moneda por país (TABLA ÚNICA de cobro) — BACKEND (autoritativa).
//
// El frontend tiene un espejo en lib/tax/config.ts (solo para MOSTRAR el estimado).
// Aquí es donde se calcula el impuesto que se COBRA. Mantener ambas tablas en sync.
//
// 👉 Para agregar un país al cobro = agregar UNA fila a COUNTRY_TAX_CONFIG con su tasa
//    VERIFICADA por fiscalista y su moneda local. El 2% FX se DERIVA (moneda ≠ liquidación),
//    no se pone a mano.
//
// ⚠️ LANZAMIENTO — SOLO MÉXICO: únicamente MX está configurado (IVA 16%, MXN). Un país
//    SIN fila aquí = SIN impuesto y NO cobrable todavía.
//
// 🔁 El país fiscal del COBRO debe determinarlo el backend de forma AUTORITATIVA (IP del
//    request + país de la tarjeta), no confiar en el cliente. Ver useBuyerCountry (solo display).

export type CountryTaxConfig = {
  /** Nombre del impuesto al consumo en ese país (etiqueta UI / CFDI). Ej. "IVA". */
  taxName: string;
  /** Tasa decimal del impuesto (0.16 = 16%). Equivalente al IVA. */
  taxRate: number;
  /** Moneda LOCAL de cobro del comprador (ISO 4217). Ej. "MXN", "COP". */
  currency: string;
};

/** Moneda de LIQUIDACIÓN de Vibra (mantener en sync con SETTLEMENT_CURRENCY del wallet). */
const SETTLEMENT_CURRENCY = "MXN";
/** Cargo por conversión de divisa que absorbe el comprador extranjero. */
export const FX_CONVERSION_FEE = 0.02;

/**
 * TABLA por país (ISO-3166 alpha-2 → impuesto + moneda de cobro).
 * Agregar un país = agregar una fila (tasa VERIFICADA + moneda local).
 */
export const COUNTRY_TAX_CONFIG: Readonly<Record<string, CountryTaxConfig>> = {
  MX: { taxName: "IVA", taxRate: 0.16, currency: "MXN" },
  // ── Activar país por país tras validación fiscal. ⚠️ VERIFICAR la tasa antes de descomentar. ──
  // AR: { taxName: "IVA", taxRate: 0.21, currency: "ARS" },
  // BO: { taxName: "IVA", taxRate: 0.13, currency: "BOB" },
  // BR: { taxName: "IVA", taxRate: 0.17, currency: "BRL" },
  // CL: { taxName: "IVA", taxRate: 0.19, currency: "CLP" },
  // CO: { taxName: "IVA", taxRate: 0.19, currency: "COP" },
  // CR: { taxName: "IVA", taxRate: 0.13, currency: "CRC" },
  // EC: { taxName: "IVA", taxRate: 0.15, currency: "USD" },
  // SV: { taxName: "IVA", taxRate: 0.13, currency: "USD" },
  // GT: { taxName: "IVA", taxRate: 0.12, currency: "GTQ" },
  // HN: { taxName: "ISV", taxRate: 0.15, currency: "HNL" },
  // NI: { taxName: "IVA", taxRate: 0.15, currency: "NIO" },
  // PA: { taxName: "ITBMS", taxRate: 0.07, currency: "USD" },
  // PY: { taxName: "IVA", taxRate: 0.10, currency: "PYG" },
  // PE: { taxName: "IGV", taxRate: 0.18, currency: "PEN" },
  // DO: { taxName: "ITBIS", taxRate: 0.18, currency: "DOP" },
  // UY: { taxName: "IVA", taxRate: 0.22, currency: "UYU" },
};

/** Config completa del país, o null si no está configurado (no cobrable). */
export function countryTaxConfig(country: string | null | undefined): CountryTaxConfig | null {
  if (!country) return null;
  return COUNTRY_TAX_CONFIG[country.toUpperCase()] ?? null;
}

/** Tasa decimal del impuesto (0 si el país no está configurado). */
export function taxRateForCountry(country: string | null | undefined): number {
  return countryTaxConfig(country)?.taxRate ?? 0;
}

/** Nombre del impuesto del país (ej. "IVA") o null. */
export function taxNameForCountry(country: string | null | undefined): string | null {
  return countryTaxConfig(country)?.taxName ?? null;
}

/** Moneda de COBRO del país (su local); la de liquidación (MXN) si no está configurado. */
export function chargeCurrencyForCountry(country: string | null | undefined): string {
  return countryTaxConfig(country)?.currency ?? SETTLEMENT_CURRENCY;
}

/** ¿El país está habilitado para cobro? (tiene fila en la tabla). */
export function isChargeableCountry(country: string | null | undefined): boolean {
  return !!countryTaxConfig(country);
}

/** ¿Se suma el 2% FX? DERIVADO: sí cuando la moneda del país ≠ la de liquidación (todos menos MX). */
export function shouldAddFxFee(country: string | null | undefined): boolean {
  const c = countryTaxConfig(country);
  return !!c && c.currency !== SETTLEMENT_CURRENCY;
}

/** Tasa del cargo FX del país (0.02 o 0). */
export function fxFeeRateForCountry(country: string | null | undefined): number {
  return shouldAddFxFee(country) ? FX_CONVERSION_FEE : 0;
}

export type TaxBreakdown = {
  /** ISO del país cuyo impuesto se aplicó (null si ninguno). */
  taxCountry: string | null;
  /** Tasa aplicada (0 si no aplica). */
  taxRate: number;
  /** Base (precio del creador, sin impuesto) — lo que cuenta como venta/ganancia. */
  baseAmount: number;
  /** Impuesto SUMADO sobre la base (va al fisco, no es del creador). */
  taxAmount: number;
  /** Total a cobrar al comprador (base + impuesto). */
  chargedAmount: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula el impuesto SUMADO sobre una base según el país del comprador.
 * `base` es el precio del creador (sin impuesto). Devuelve el desglose para
 * cobrar `chargedAmount` y guardar el registro fiscal en el paymentIntent.
 */
export function applyConsumptionTax(
  base: number,
  country: string | null | undefined
): TaxBreakdown {
  const cfg = countryTaxConfig(country);
  const rate = cfg?.taxRate ?? 0;
  const baseAmount = round2(base);
  const taxAmount = round2(baseAmount * rate);
  return {
    taxCountry: cfg ? (country ?? "").toUpperCase() : null,
    taxRate: rate,
    baseAmount,
    taxAmount,
    chargedAmount: round2(baseAmount + taxAmount),
  };
}
