// Configuración fiscal del BACKEND: impuesto al consumo (IVA) por país.
//
// Copia autoritativa en el backend (el frontend tiene su espejo en lib/tax/config.ts,
// que es solo para MOSTRAR). Aquí es donde se calcula el impuesto que se COBRA.
//
// ⚠️ LANZAMIENTO — SOLO MÉXICO: únicamente MX está configurado (IVA 16%). Los otros
// 16 países se activan país por país DESPUÉS del lanzamiento, tras validación fiscal.
// Un país sin entrada aquí = SIN impuesto (0).
//
// 🔁 DLOCAL-MIGRATION: hoy el país fiscal lo determina el CLIENTE (por IP) y se pasa
// como parámetro. Al migrar a dLocal, la determinación debe ser AUTORITATIVA en el
// backend (IP del request + país de la tarjeta). Ver docs/legal/fiscal-iva-isr-plataforma.md.

export type TaxConfig = { rate: number; name: string };

export const CONSUMPTION_TAX_BY_COUNTRY: Readonly<Record<string, TaxConfig>> = {
  MX: { rate: 0.16, name: "IVA" },
  // Pendientes (activar tras validación fiscal por país):
  // AR, BO, BR, CL, CO, CR, EC, SV, GT, HN, NI, PA, PY, PE, DO, UY
};

export function taxConfigForCountry(country: string | null | undefined): TaxConfig | null {
  if (!country) return null;
  return CONSUMPTION_TAX_BY_COUNTRY[country.toUpperCase()] ?? null;
}

export function taxRateForCountry(country: string | null | undefined): number {
  return taxConfigForCountry(country)?.rate ?? 0;
}

export type TaxBreakdown = {
  /** ISO del país cuyo impuesto se aplicó (null si ninguno). */
  taxCountry: string | null;
  /** Tasa aplicada (0 si no aplica). */
  taxRate: number;
  /** Base (precio del creador, sin impuesto) — lo que cuenta como venta/ganancia. */
  baseAmount: number;
  /** Impuesto SUMADO sobre la base (va al SAT, no es del creador). */
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
  const cfg = taxConfigForCountry(country);
  const rate = cfg?.rate ?? 0;
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
