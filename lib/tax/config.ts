// Configuración fiscal + moneda por país (TABLA ÚNICA de cobro) — espejo FRONTEND.
//
// Puro: sin dependencias de framework ni Firebase, importable desde middleware (edge),
// servidor y cliente por igual (igual que lib/currency/catalog.ts). Aquí es SOLO para
// MOSTRAR el estimado; el cobro real lo calcula el backend (backend/src/tax/config.ts).
// Mantener AMBAS tablas en sync.
//
// 👉 Para agregar un país al cobro = agregar UNA fila a COUNTRY_TAX_CONFIG con su tasa
//    VERIFICADA por fiscalista y su moneda local. El 2% FX se DERIVA (moneda ≠ liquidación),
//    no se pone a mano.
//
// MODELO (decisión de producto 2026-07-27): el impuesto se SUMA sobre el precio base del
// creador. El creador recibe siempre sobre la base, sin importar el país del comprador.
// Fundamento y matriz completa: docs/legal/fiscal-iva-isr-plataforma.md
//
// ⚠️ LANZAMIENTO — SOLO MÉXICO: únicamente MX está configurado (IVA 16%, MXN). Un país SIN
//    fila aquí = SIN impuesto y NO cobrable todavía.
//
// Regla de aplicación (Art. 18-C LIVA): el impuesto lo determina DÓNDE ESTÁ EL COMPRADOR al
// comprar, no su nacionalidad. Ver lib/tax/useBuyerCountry.ts para la señal (por IP).

/** Moneda de LIQUIDACIÓN de Vibra (mantener en sync con SETTLEMENT_CURRENCY del catálogo/wallet). */
const SETTLEMENT_CURRENCY = "MXN";
/** Cargo por conversión de divisa que absorbe el comprador extranjero. */
export const FX_CONVERSION_FEE = 0.02;

/**
 * QUIÉN recauda el impuesto del país del comprador. Espejo de backend/src/tax/config.ts.
 * Decide si el precio mostrado SUMA el impuesto o no.
 */
export type TaxCollectionMode =
  /** Vibra lo cobra en el checkout y lo entera. Ej. MX. */
  | "platform"
  /** Lo percibe la emisora/banco del comprador. Vibra NO lo cobra. Ej. AR, CR, PY. */
  | "issuer"
  /** Sin régimen aplicable → país NO cobrable. */
  | "none";

/** Régimen del IVA mexicano de la venta de Vibra. Ver docs/legal/fiscal-iva-isr-plataforma.md §0.1. */
export type MxVatTreatment = "domestic_16" | "export_zero" | "export_taxable";

export type CountryTaxConfig = {
  /** Nombre del impuesto al consumo en ese país (etiqueta UI / CFDI). Ej. "IVA". */
  taxName: string;
  /** Tasa decimal del impuesto (0.16 = 16%). Se guarda aunque no se cobre (AR: 0.21). */
  taxRate: number;
  /** Moneda LOCAL de cobro del comprador (ISO 4217). Ej. "MXN", "COP". */
  currency: string;
  /** Quién recauda el impuesto local. */
  collectionMode: TaxCollectionMode;
  /** Régimen del IVA mexicano hacia ese país. */
  mxVatTreatment: MxVatTreatment;
};

/**
 * TABLA por país (ISO-3166 alpha-2 → impuesto + moneda de cobro).
 * Agregar un país = agregar una fila (tasa VERIFICADA + moneda local).
 * ⚠️ Debe coincidir con backend/src/tax/config.ts.
 */
export const COUNTRY_TAX_CONFIG: Readonly<Record<string, CountryTaxConfig>> = {
  // Operación doméstica: Vibra cobra el 16% y lo entera. Ficha: impuestos.md §6.
  MX: {
    taxName: "IVA", taxRate: 0.16, currency: "MXN",
    collectionMode: "platform", mxVatTreatment: "domestic_16",
  },

  // RG 4240/18 (ARCA): la emisora argentina percibe el 21% (más un 30% de RG 5617). Vibra NO
  // se registra, NO cobra y NO ingresa nada en Argentina. Cobrarlo aquí sería DOBLE cobro.
  // Ficha completa y fuentes: impuestos.md §6.
  AR: {
    taxName: "IVA", taxRate: 0.21, currency: "ARS",
    collectionMode: "issuer", mxVatTreatment: "export_zero",
  },

  // ── Activar país por país tras validación fiscal. ⚠️ VERIFICAR la tasa Y el modo de cobro
  //    antes de descomentar, y escribir su ficha en impuestos.md. ──
  // BO: { taxName: "IVA",     taxRate: 0.13, currency: "BOB", collectionMode: "none",     mxVatTreatment: "export_zero" },
  // BR: { taxName: "CBS/IBS", taxRate: 0,    currency: "BRL", collectionMode: "none",     mxVatTreatment: "export_zero" }, // reforma 2026-33: 2026 es año de prueba; registro obligatorio desde 2027
  // CL: { taxName: "IVA",     taxRate: 0.19, currency: "CLP", collectionMode: "platform", mxVatTreatment: "export_zero" },
  // CO: { taxName: "IVA",     taxRate: 0.19, currency: "COP", collectionMode: "platform", mxVatTreatment: "export_zero" },
  // CR: { taxName: "IVA",     taxRate: 0.13, currency: "CRC", collectionMode: "issuer",   mxVatTreatment: "export_zero" },
  // EC: { taxName: "IVA",     taxRate: 0.15, currency: "USD", collectionMode: "platform", mxVatTreatment: "export_zero" },
  // SV: { taxName: "IVA",     taxRate: 0.13, currency: "USD", collectionMode: "none",     mxVatTreatment: "export_zero" },
  // GT: { taxName: "IVA",     taxRate: 0.12, currency: "GTQ", collectionMode: "none",     mxVatTreatment: "export_zero" },
  // HN: { taxName: "ISV",     taxRate: 0.15, currency: "HNL", collectionMode: "none",     mxVatTreatment: "export_zero" },
  // NI: { taxName: "IVA",     taxRate: 0.15, currency: "NIO", collectionMode: "none",     mxVatTreatment: "export_zero" },
  // PA: { taxName: "ITBMS",   taxRate: 0.07, currency: "USD", collectionMode: "platform", mxVatTreatment: "export_zero" },
  // PY: { taxName: "IVA",     taxRate: 0.10, currency: "PYG", collectionMode: "issuer",   mxVatTreatment: "export_zero" },
  // PE: { taxName: "IGV",     taxRate: 0.18, currency: "PEN", collectionMode: "platform", mxVatTreatment: "export_zero" },
  // DO: { taxName: "ITBIS",   taxRate: 0.18, currency: "DOP", collectionMode: "none",     mxVatTreatment: "export_zero" },
  // UY: { taxName: "IVA",     taxRate: 0.22, currency: "UYU", collectionMode: "platform", mxVatTreatment: "export_zero" },
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

/**
 * ¿El país está habilitado para cobro? Tiene fila Y régimen aplicable.
 * `collectionMode: "none"` = el país existe pero todavía no se puede cobrar ahí.
 */
export function isChargeableCountry(country: string | null | undefined): boolean {
  const cfg = countryTaxConfig(country);
  return !!cfg && cfg.collectionMode !== "none";
}

/** ¿Vibra cobra el impuesto local, o lo percibe la emisora del comprador? */
export function taxCollectionModeForCountry(
  country: string | null | undefined
): TaxCollectionMode {
  return countryTaxConfig(country)?.collectionMode ?? "none";
}

/**
 * ¿El impuesto se le suma al precio mostrado?
 * Solo cuando Vibra es quien lo entera. En Argentina (y CR/PY) el precio mostrado NO lo
 * incluye porque lo percibe la emisora: sumarlo aquí sería cobrárselo dos veces.
 */
export function platformCollectsTax(country: string | null | undefined): boolean {
  return taxCollectionModeForCountry(country) === "platform";
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
  rate: number;
  /** Nombre del impuesto (ej. "IVA") o null. */
  taxName: string | null;
  /** Quién recauda. Si no es "platform", `tax` es 0 y `applies` es false. */
  collectionMode: TaxCollectionMode;
  /** true solo si Vibra suma el impuesto al precio mostrado. */
  collectedByPlatform: boolean;
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
  const cfg = countryTaxConfig(country);
  const rate = cfg?.taxRate ?? 0;
  const collectedByPlatform = cfg?.collectionMode === "platform";

  // ⚠️ Solo se SUMA al precio mostrado cuando Vibra es quien entera el impuesto. Donde lo
  // percibe la emisora del comprador (AR, CR, PY), el precio mostrado NO lo incluye: se lo
  // agrega su banco en el resumen de tarjeta. Mostrarlo aquí implicaría cobrarlo dos veces.
  const tax = collectedByPlatform ? base * rate : 0;

  return {
    taxCountry: cfg ? (country ?? "").toUpperCase() : null,
    rate,
    taxName: cfg?.taxName ?? null,
    collectionMode: cfg?.collectionMode ?? "none",
    collectedByPlatform,
    base,
    tax,
    total: base + tax,
    applies: collectedByPlatform && tax > 0,
  };
}
