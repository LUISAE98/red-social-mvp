// Configuración fiscal: impuesto al consumo (IVA y equivalentes) por país.
//
// Puro: sin dependencias de framework ni Firebase, importable desde middleware
// (edge), servidor y cliente por igual (igual que lib/currency/catalog.ts).
//
// MODELO (decisión de producto 2026-07-27): el impuesto se SUMA sobre el precio
// base del creador. El precio que fija el creador es la BASE (sin impuesto); el
// comprador ve el precio y, debajo, "+impuestos", y paga base + impuesto. El
// creador recibe siempre sobre la base, sin importar el país del comprador.
// Fundamento y matriz completa: docs/legal/fiscal-iva-isr-plataforma.md
//
// ⚠️ LANZAMIENTO — SOLO MÉXICO: únicamente MX está configurado (IVA 16%). Los
// otros 16 países de LatAm se activarán país por país DESPUÉS del lanzamiento,
// tras validación de un fiscalista. Un país sin entrada aquí = SIN impuesto al
// comprador (0), hasta que se configure explícitamente.
//
// Regla de aplicación (Art. 18-C LIVA): el impuesto lo determina DÓNDE ESTÁ EL
// COMPRADOR al comprar, no su nacionalidad. Un extranjero consumiendo desde
// México paga IVA (es correcto). Ver lib/tax/useBuyerCountry.ts para la señal.

export type TaxConfig = {
  /** Tasa decimal (0.16 = 16%). */
  rate: number;
  /** Nombre del impuesto en ese país (etiqueta de UI y futuros CFDI). */
  name: string;
};

/** País ISO-3166 alpha-2 → configuración de impuesto al consumo. */
export const CONSUMPTION_TAX_BY_COUNTRY: Readonly<Record<string, TaxConfig>> = {
  MX: { rate: 0.16, name: "IVA" },
  // ── Pendientes (activar uno por uno tras validación fiscal por país): ──
  // AR, BO, BR, CL, CO, CR, EC, SV, GT, HN, NI, PA, PY, PE, DO, UY
};

/** Devuelve la config de impuesto del país, o null si el país no tiene impuesto configurado. */
export function taxConfigForCountry(country: string | null | undefined): TaxConfig | null {
  if (!country) return null;
  return CONSUMPTION_TAX_BY_COUNTRY[country.toUpperCase()] ?? null;
}

/** Tasa decimal del país (0 si no hay impuesto configurado). */
export function taxRateForCountry(country: string | null | undefined): number {
  return taxConfigForCountry(country)?.rate ?? 0;
}

export type TaxBreakdown = {
  /** ISO del país cuyo impuesto se aplicó (null si ninguno). */
  taxCountry: string | null;
  /** Tasa aplicada (0 si no aplica). */
  rate: number;
  /** Nombre del impuesto (ej. "IVA") o null. */
  taxName: string | null;
  /** Monto base (sin impuesto), en la moneda que se pasó. */
  base: number;
  /** Monto del impuesto. */
  tax: number;
  /** Total a pagar (base + impuesto). */
  total: number;
  /** true si hay impuesto (> 0) que mostrar/cobrar. */
  applies: boolean;
};

/**
 * Desglose de impuesto SUMADO sobre una base, en la moneda ya resuelta que se pase
 * (por eso es agnóstico de moneda). El impuesto se calcula como `base * tasa`, así
 * que base + impuesto = total exactamente (sin drift de redondeo).
 */
export function computeConsumptionTax(
  base: number,
  country: string | null | undefined
): TaxBreakdown {
  const cfg = taxConfigForCountry(country);
  const rate = cfg?.rate ?? 0;
  const tax = base * rate;
  return {
    taxCountry: cfg ? (country ?? "").toUpperCase() : null,
    rate,
    taxName: cfg?.name ?? null,
    base,
    tax,
    total: base + tax,
    applies: rate > 0 && tax > 0,
  };
}
