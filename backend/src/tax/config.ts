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

/**
 * QUIÉN recauda materialmente el impuesto del país del comprador.
 *
 * Es el dato que decide si el checkout SUMA el impuesto o no. Sin él la tabla solo podía
 * expresar dos estados ("sin fila = no cobrable" / "con fila = lo cobro yo"), y países como
 * Argentina —donde el impuesto existe pero lo percibe el banco del comprador— quedaban mal
 * en ambos: omitirlo impedía vender, incluirlo cobraba el impuesto DOS VECES.
 */
export type TaxCollectionMode =
  /** Vibra lo cobra en el checkout y lo entera al fisco local. Ej. MX. */
  | "platform"
  /** Lo percibe la emisora/banco del comprador. Vibra NO lo cobra. Ej. AR, CR, PY. */
  | "issuer"
  /** Sin régimen aplicable → país NO cobrable. */
  | "none";

/**
 * Régimen del IVA MEXICANO sobre la venta de Vibra. Vibra es residente en México, así que
 * por el Art. 16 LIVA la venta SIEMPRE está dentro del objeto del IVA mexicano: lo que
 * cambia es la TASA, nunca "desaparece".
 * Ver docs/legal/fiscal-iva-isr-plataforma.md §0.1.
 */
export type MxVatTreatment =
  /** Comprador en México → 16%. Se cobra vía `buyerTax`; NO se duplica aquí. */
  | "domestic_16"
  /** Comprador fuera → 0% por exportación (Art. 29-IV). Default de todo país extranjero. */
  | "export_zero"
  /**
   * Comprador fuera pero el servicio NO encuadra en ningún inciso del Art. 29-IV → 16%.
   * ⚠️ Ese 16% NO se le traslada al comprador extranjero (ya pagó el impuesto de su país):
   * es un pasivo de Vibra que sale de su margen. Por eso NUNCA suma a `chargedAmount`.
   */
  | "export_taxable";

export type CountryTaxConfig = {
  /** Nombre del impuesto al consumo en ese país (etiqueta UI / CFDI). Ej. "IVA". */
  taxName: string;
  /**
   * Tasa decimal del impuesto (0.16 = 16%).
   * ⚠️ Se guarda SIEMPRE, aun cuando `collectionMode` sea "issuer" y no se cobre: sirve para
   * advertirle al comprador qué le sumará su banco y para reconstruir la operación después.
   */
  taxRate: number;
  /** Moneda LOCAL de cobro del comprador (ISO 4217). Ej. "MXN", "COP". */
  currency: string;
  /** Quién recauda el impuesto local. Decide si el checkout lo suma. */
  collectionMode: TaxCollectionMode;
  /** Régimen del IVA mexicano de la venta de Vibra hacia ese país. */
  mxVatTreatment: MxVatTreatment;
};

/** Moneda de LIQUIDACIÓN de Vibra (mantener en sync con SETTLEMENT_CURRENCY del wallet). */
const SETTLEMENT_CURRENCY = "MXN";
/** Cargo por conversión de divisa que absorbe el comprador extranjero. */
export const FX_CONVERSION_FEE = 0.02;

/**
 * TABLA por país (ISO-3166 alpha-2 → impuesto + moneda de cobro).
 * Agregar un país = agregar una fila (tasa VERIFICADA + moneda + modo de cobro).
 * ⚠️ Además, cada país debe tener su FICHA JUSTIFICADA en `impuestos.md` (raíz del repo).
 */
export const COUNTRY_TAX_CONFIG: Readonly<Record<string, CountryTaxConfig>> = {
  // Operación doméstica: Vibra cobra el 16% y lo entera. Ficha: impuestos.md §6.
  MX: {
    taxName: "IVA", taxRate: 0.16, currency: "MXN",
    collectionMode: "platform", mxVatTreatment: "domestic_16",
  },

  // RG 4240/18 (ARCA): los agentes de percepción son "las entidades del país que faciliten
  // o administren los pagos al exterior". El proveedor del exterior NO se registra, NO cobra
  // y NO ingresa nada en Argentina. Si Vibra cobrara el 21% aquí, el comprador lo pagaría
  // DOS VECES (su emisora ya se lo percibe, junto con un 30% de RG 5617).
  // Ficha completa y fuentes: impuestos.md §6.
  AR: {
    taxName: "IVA", taxRate: 0.21, currency: "ARS",
    collectionMode: "issuer", mxVatTreatment: "export_zero",
  },

  // ── Activar país por país tras validación fiscal. ⚠️ VERIFICAR la tasa Y el modo de cobro
  //    antes de descomentar, y escribir su ficha en impuestos.md. ──
  // BO: { taxName: "IVA",     taxRate: 0.13, currency: "BOB", collectionMode: "none",     mxVatTreatment: "export_zero" },
  // BR: { taxName: "CBS/IBS", taxRate: 0,    currency: "BRL", collectionMode: "none",     mxVatTreatment: "export_zero" }, // reforma 2026-33: 2026 es año de prueba (~1% simbólico); registro obligatorio desde 2027
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
 * ¿El país está habilitado para cobro?
 * Tiene fila en la tabla Y un régimen aplicable. `collectionMode: "none"` significa que el
 * país existe pero no hay régimen digital que permita cobrar ahí todavía.
 */
export function isChargeableCountry(country: string | null | undefined): boolean {
  const cfg = countryTaxConfig(country);
  return !!cfg && cfg.collectionMode !== "none";
}

/** ¿Vibra cobra y entera el impuesto local, o lo percibe la emisora del comprador? */
export function taxCollectionModeForCountry(
  country: string | null | undefined
): TaxCollectionMode {
  return countryTaxConfig(country)?.collectionMode ?? "none";
}

/** Régimen del IVA mexicano de la venta de Vibra hacia ese país. */
export function mxVatTreatmentForCountry(
  country: string | null | undefined
): MxVatTreatment {
  return countryTaxConfig(country)?.mxVatTreatment ?? "export_zero";
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
  /**
   * Tasa VIGENTE del país (0.21 en AR aunque no se cobre). Se guarda siempre: sirve para
   * advertirle al comprador qué le sumará su banco y para reconstruir la operación.
   */
  taxRate: number;
  /** Quién recauda: si no es "platform", `taxAmount` es 0. */
  collectionMode: TaxCollectionMode;
  /** true solo si Vibra cobró el impuesto en el checkout. */
  collectedByPlatform: boolean;
  /** Base (precio del creador, sin impuesto) — lo que cuenta como venta/ganancia. */
  baseAmount: number;
  /** Impuesto SUMADO sobre la base. 0 cuando lo percibe la emisora. */
  taxAmount: number;
  /** Total a cobrar al comprador (base + impuesto efectivamente cobrado). */
  chargedAmount: number;
  /** Régimen del IVA mexicano de esta venta. */
  mxVatTreatment: MxVatTreatment;
  /**
   * IVA mexicano DEVENGADO que Vibra debe al SAT y que NO se le trasladó al comprador.
   * Solo > 0 cuando `mxVatTreatment === "export_taxable"`. Sale del margen de Vibra.
   * ⚠️ NUNCA suma a `chargedAmount`.
   */
  mxVatAccruedAmount: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Tasa del IVA mexicano (constante de ley, no depende del país del comprador). */
const MX_VAT_RATE = 0.16;

/**
 * Calcula el impuesto SUMADO sobre una base según el país del comprador.
 * `base` es el precio del creador ya con el cargo fijo y el FX (sin impuesto).
 *
 * ⚠️ REGLA CENTRAL: solo se COBRA el impuesto cuando `collectionMode === "platform"`.
 * Donde lo percibe la emisora del comprador (Argentina, Costa Rica, Paraguay), sumarlo
 * aquí se lo cobraría DOS VECES. La tasa se conserva en el desglose para poder mostrarla,
 * pero el monto cobrado es 0.
 */
export function applyConsumptionTax(
  base: number,
  country: string | null | undefined
): TaxBreakdown {
  const cfg = countryTaxConfig(country);
  const rate = cfg?.taxRate ?? 0;
  const collectionMode: TaxCollectionMode = cfg?.collectionMode ?? "none";
  const collectedByPlatform = collectionMode === "platform";

  const baseAmount = round2(base);
  const taxAmount = collectedByPlatform ? round2(baseAmount * rate) : 0;

  // IVA mexicano devengado: solo cuando el servicio NO encuadra en el Art. 29-IV y el
  // comprador está fuera. Es pasivo de Vibra, no precio del comprador.
  const mxVatTreatment: MxVatTreatment = cfg?.mxVatTreatment ?? "export_zero";
  const mxVatAccruedAmount =
    mxVatTreatment === "export_taxable" ? round2(baseAmount * MX_VAT_RATE) : 0;

  return {
    taxCountry: cfg ? (country ?? "").toUpperCase() : null,
    taxRate: rate,
    collectionMode,
    collectedByPlatform,
    baseAmount,
    taxAmount,
    chargedAmount: round2(baseAmount + taxAmount),
    mxVatTreatment,
    mxVatAccruedAmount,
  };
}
