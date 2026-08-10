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

// Cargo por conversión de divisa: FUENTE ÚNICA en lib/currency/catalog.ts. Se re-exporta
// aquí por compatibilidad con los imports existentes, pero NO se redefine: tenerlo dos
// veces fue justo lo que provocó que el display usara 1.5% y el cobro 2%.
export { FX_CONVERSION_FEE } from "@/lib/currency/catalog";
import { FX_CONVERSION_FEE } from "@/lib/currency/catalog";

/**
 * QUIÉN recauda el impuesto del país del comprador. Espejo de backend/src/tax/config.ts.
 * Decide si el precio mostrado SUMA el impuesto o no.
 */
export type TaxCollectionMode =
  /** Vibra lo cobra en el checkout y lo entera. Ej. MX. */
  | "platform"
  /** Lo percibe la emisora/banco del comprador. Vibra NO lo cobra. */
  | "issuer"
  /**
   * NADIE recauda por esta venta (el país no tiene régimen para proveedores extranjeros).
   * ⚠️ NO impide vender: eso lo decide `registrationStatus`.
   */
  | "none";

/** Régimen del IVA mexicano de la venta de Vibra. Ver docs/legal/fiscal-iva-isr-plataforma.md §0.1. */
export type MxVatTreatment = "domestic_16" | "export_zero" | "export_taxable";

/**
 * Los 11 servicios monetizables. Espejo de `LedgerServiceType` en backend/src/wallet/ledger.ts
 * (el frontend no puede importar del backend). Mantener en sync.
 */
export type ServiceType =
  | "supercomment" | "profile_donation" | "live_donation" | "live_ticket"
  | "premium_post" | "greeting" | "advice" | "exclusive_session"
  | "live_session" | "subscription" | "vod_ticket";

/**
 * 🟢 IVA MEXICANO SOBRE VENTAS AL EXTRANJERO — **0% para todos** (decisión 2026-08-08).
 * Espejo de backend/src/tax/config.ts, donde está la explicación completa del Art. 29-IV.
 *
 * 👉 PARA CAMBIAR UNO: `"export_taxable"` en su línea. Cambiarlo también en el backend.
 */
export const MX_EXPORT_TREATMENT_BY_SERVICE: Readonly<Record<ServiceType, MxVatTreatment>> = {
  supercomment: "export_zero",
  profile_donation: "export_zero",
  live_donation: "export_zero",
  live_ticket: "export_zero",
  premium_post: "export_zero",
  greeting: "export_zero",
  advice: "export_zero",
  exclusive_session: "export_zero",
  live_session: "export_zero",
  subscription: "export_zero",
  vod_ticket: "export_zero",
};

/**
 * Régimen del IVA mexicano de una venta concreta.
 * Comprador en México → doméstico 16%. Fuera → lo decide el SERVICIO, no el país.
 */
export function mxVatTreatmentForSale(
  country: string | null | undefined,
  serviceType?: ServiceType | null
): MxVatTreatment {
  if ((country ?? "").toUpperCase() === "MX") return "domestic_16";
  if (!serviceType) return "export_zero";
  return MX_EXPORT_TREATMENT_BY_SERVICE[serviceType] ?? "export_zero";
}

/**
 * ¿Vibra está dada de alta ante el fisco de ese país? Espejo de backend/src/tax/config.ts.
 * Es lo que decide si se cobra: sin alta no hay forma de enterar el impuesto.
 */
export type RegistrationStatus =
  /** Alta activa → SE COBRA el impuesto. */
  | "registered"
  /** Sin alta pero el país lo permite (bajo umbral / voluntario) → se vende SIN impuesto. */
  | "not_registered"
  /** Sin alta y el país exige registro previo → no se puede vender. */
  | "cannot_sell";

export type CountryTaxConfig = {
  /** Nombre del impuesto al consumo en ese país (etiqueta UI / CFDI). Ej. "IVA". */
  taxName: string;
  /** Tasa decimal del impuesto (0.16 = 16%). Se guarda aunque no se cobre. */
  taxRate: number;
  /** Moneda LOCAL de cobro del comprador (ISO 4217). Ej. "MXN", "COP". */
  currency: string;
  /** Quién recauda el impuesto local. */
  collectionMode: TaxCollectionMode;
  /** Régimen del IVA mexicano hacia ese país. */
  mxVatTreatment: MxVatTreatment;
  /** Si Vibra está dada de alta ahí. Sin alta no se cobra, aunque la tasa esté puesta. */
  registrationStatus: RegistrationStatus;
};

/**
 * TABLA por país (ISO-3166 alpha-2 → impuesto + moneda de cobro).
 * Agregar un país = agregar una fila (tasa VERIFICADA + moneda local).
 * ⚠️ Debe coincidir con backend/src/tax/config.ts.
 */
/**
 * 🟢 INTERRUPTOR ÚNICO DEL ALTA EN LA UE — **ACTIVO** (2026-08-08).
 * Espejo de backend/src/tax/config.ts. Un solo registro (Non-Union OSS) cubre los 27.
 * En `true` los 27 venden y cobran su IVA. Ver impuestos.md §6.1.
 * ⚠️ Debe tener el MISMO valor que la constante del backend.
 * ⚠️ Antes de pasar a llaves `sk_live` hace falta el número de OSS.
 */
const EU_OSS_REGISTERED = true;

const EU_STATUS: RegistrationStatus = EU_OSS_REGISTERED ? "registered" : "cannot_sell";

/**
 * Fila de un país donde NO EXISTE un impuesto al consumo que cobrar.
 *
 * No es "estamos bajo el umbral" ni "no hay régimen para extranjeros": es que el país no tiene
 * IVA/GST en absoluto. No hay reloj corriendo ni umbral que vigilar — nunca va a haber nada que
 * cobrar mientras eso no cambie. Ej. Hong Kong, Qatar, Kuwait.
 *
 * La tasa se guarda en 0 a propósito: si el país legisla un IVA, se cambia aquí y se ve el salto.
 */
function noConsumptionTax(currency: string): CountryTaxConfig {
  return {
    taxName: "N/A",
    taxRate: 0,
    currency,
    collectionMode: "none",
    mxVatTreatment: "export_zero",
    registrationStatus: "not_registered",
  };
}

/**
 * Fila de un país donde Vibra SÍ sería quien recauda, pero todavía está por debajo del umbral
 * que obliga a registrarse. Se vende con normalidad y el checkout suma CERO.
 *
 * Se distingue de `noDigitalRegime` en algo que importa: allá no existe régimen y nunca habrá
 * nada que cobrar; aquí el régimen existe y **la obligación nace sola al cruzar el umbral**.
 *
 * 👉 PARA ENCENDER EL COBRO al cruzarlo: cambiar `registrationStatus` a `"registered"`. Un solo
 *    campo, en los dos espejos. El resto del motor ya lo maneja.
 *
 * 🚨 Un umbral no es permiso permanente: es permiso HASTA que lo cruzas. Hoy nada en el código
 *    cuenta ventas por país (decisión D-13), así que la vigilancia es MANUAL. Ver impuestos.md §6.3.
 */
function belowThreshold(
  taxName: string,
  taxRate: number,
  currency: string
): CountryTaxConfig {
  return {
    taxName,
    taxRate,
    currency,
    // Vibra sería la que recauda aquí — solo que aún no está de alta.
    collectionMode: "platform",
    mxVatTreatment: "export_zero",
    registrationStatus: "not_registered",
  };
}

/**
 * Fila de un país SIN régimen de servicios digitales para proveedores extranjeros.
 *
 * No hay registro posible ni impuesto que enterar: el checkout suma CERO y se vende con
 * normalidad. Se distingue de `issuerCollects` en que allá el impuesto SÍ se recauda
 * (lo hace el banco); aquí simplemente no hay obligación para Vibra.
 *
 * La tasa se guarda como referencia del impuesto general del país, no de algo que se cobre.
 */
function noDigitalRegime(
  taxName: string,
  taxRate: number,
  currency: string
): CountryTaxConfig {
  return {
    taxName,
    taxRate,
    currency,
    // Nadie recauda: ni Vibra ni el banco del comprador. No bloquea la venta.
    collectionMode: "none",
    mxVatTreatment: "export_zero",
    // Sin alta posible → se vende sin cobrar impuesto.
    registrationStatus: "not_registered",
  };
}

/**
 * Fila de un país donde el impuesto lo percibe la EMISORA del comprador, no el proveedor.
 * El precio mostrado suma CERO: se lo agrega su banco en el resumen de tarjeta.
 */
function issuerCollects(
  taxName: string,
  taxRate: number,
  currency: string
): CountryTaxConfig {
  return {
    taxName,
    taxRate,
    currency,
    collectionMode: "issuer",
    mxVatTreatment: "export_zero",
    registrationStatus: "not_registered",
  };
}

/** Fila de un país de la UE. En la UE cobra el proveedor: no hay retención bancaria. */
function eu(taxRate: number, currency: string): CountryTaxConfig {
  return {
    taxName: "IVA",
    taxRate,
    currency,
    collectionMode: "platform",
    mxVatTreatment: "export_zero",
    registrationStatus: EU_STATUS,
  };
}

export const COUNTRY_TAX_CONFIG: Readonly<Record<string, CountryTaxConfig>> = {
  // Operación doméstica: Vibra cobra el 16% y lo entera. Ficha: impuestos.md §6.
  MX: {
    taxName: "IVA", taxRate: 0.16, currency: "MXN",
    collectionMode: "platform", mxVatTreatment: "domestic_16",
    registrationStatus: "registered", // el RFC de Vibra
  },

  // ── UNIÓN EUROPEA — 27 países, 1 solo trámite (Non-Union OSS) ──
  // Tasas de VATcomply (fuente TEDB, Comisión Europea) al 2026-08-07.
  // ⚠️ Grecia es "GR" en ISO; TEDB la publica como "EL". Aquí siempre el ISO.
  AT: eu(0.20, "EUR"),  BE: eu(0.21, "EUR"),  BG: eu(0.20, "EUR"),
  CY: eu(0.19, "EUR"),  CZ: eu(0.21, "CZK"),  DE: eu(0.19, "EUR"),
  DK: eu(0.25, "DKK"),  EE: eu(0.24, "EUR"),  ES: eu(0.21, "EUR"),
  FI: eu(0.255, "EUR"), FR: eu(0.20, "EUR"),  GR: eu(0.24, "EUR"),
  HR: eu(0.25, "EUR"),  HU: eu(0.27, "HUF"),  IE: eu(0.23, "EUR"),
  IT: eu(0.22, "EUR"),  LT: eu(0.21, "EUR"),  LU: eu(0.17, "EUR"),
  LV: eu(0.21, "EUR"),  MT: eu(0.18, "EUR"),  NL: eu(0.21, "EUR"),
  PL: eu(0.23, "PLN"),  PT: eu(0.23, "EUR"),  RO: eu(0.21, "RON"),
  SE: eu(0.25, "SEK"),  SI: eu(0.22, "EUR"),  SK: eu(0.23, "EUR"),

  // ── LATINOAMÉRICA — recauda la EMISORA del comprador, no Vibra ──
  // El checkout suma CERO en los cinco: el banco del comprador percibe el impuesto al
  // procesar el pago al exterior. Cobrarlo aquí se lo cobraría DOS VECES.
  // La tasa se conserva para poder advertirle qué le sumará su banco.
  // Fichas y fuentes: impuestos.md.
  AR: issuerCollects("IVA", 0.21, "ARS"),   // RG 4240/18 (ARCA)
  CR: issuerCollects("IVA", 0.13, "CRC"),   // retienen las emisoras si no te registras
  EC: issuerCollects("IVA", 0.15, "USD"),   // idem, régimen SRI
  PY: issuerCollects("IVA", 0.10, "PYG"),   // RG 76/2020: bancos = agentes de percepción
  DO: issuerCollects("ITBIS", 0.18, "DOP"), // retención 2% por procesadores de tarjeta

  // ── LatAm SIN régimen de servicios digitales: no hay alta ni impuesto que enterar ──
  // El checkout suma CERO. ⚠️ Stripe Tax no los cubre: hay que vigilarlos a mano.
  BO: noDigitalRegime("IVA", 0.13, "BOB"),
  SV: noDigitalRegime("IVA", 0.13, "USD"),
  GT: noDigitalRegime("IVA", 0.12, "GTQ"),
  HN: noDigitalRegime("ISV", 0.15, "HNL"),
  NI: noDigitalRegime("IVA", 0.15, "NIO"),
  // Panamá: el anteproyecto de 2019 nunca se aprobó. La retención de ITBMS que sí existe la
  // hace el cliente panameño que paga (B2B), no el proveedor ni el banco.
  PA: noDigitalRegime("ITBMS", 0.07, "USD"),

  // ── EUROPA NO COMUNITARIA — con umbral, se vende sin alta ──
  //
  // ⚠️ El OSS NO cubre nada de esto: cada país es un trámite propio.
  // ⚠️ VIGILANCIA MANUAL DEL UMBRAL (D-13). Al cruzarlo hay que registrarse y pasar la fila
  //    a "registered". Noruega es el más apretado con diferencia.
  //
  //   NO — NOK 50.000 en 12 meses MÓVILES (~US$4.500). Régimen VOEC.
  //   IS — ISK 2.000.000 al año (~US$14.500). Régimen VOES.
  //   BA — BAM 50.000 al año (~US$28.000). Régimen de la ITA, vigente desde 2023.
  //
  // 🚫 Ucrania queda FUERA a propósito pese a tener umbral: Crimea, Donetsk y Lugansk están
  //    bajo embargo integral de la OFAC y resolveCountry solo distingue PAÍS, no región.
  //    Decisión D-14. No agregar UA sin discriminación regional.
  NO: belowThreshold("MVA", 0.25, "NOK"),  // Noruega
  IS: belowThreshold("VSK", 0.24, "ISK"),  // Islandia
  BA: belowThreshold("PDV", 0.17, "BAM"),  // Bosnia y Herzegovina

  // ── SIN IMPUESTO AL CONSUMO — no existe IVA/GST en el país ──
  // Los únicos de toda la tabla sin reloj corriendo: no hay umbral que cruzar.
  HK: noConsumptionTax("HKD"), // Hong Kong
  QA: noConsumptionTax("QAR"), // Qatar — el CCG lo pactó pero Qatar no lo ha implementado
  KW: noConsumptionTax("KWD"), // Kuwait — íd.

  // ── ASIA-PACÍFICO Y MEDIO ORIENTE — con umbral, se vende sin alta ──
  //
  // ⚠️ VIGILANCIA MANUAL DEL UMBRAL (D-13), igual que NO/IS/BA.
  //
  //   JP — ¥10.000.000/año   (~US$65.000). El más holgado de toda la tabla.
  //   MY — MYR 500.000/año   (~US$106.000) sobre ventas a Malasia.
  //   PH — PHP 3.000.000/12m (~US$51.000). Régimen RA 12023, de 2024.
  //   TH — THB 1.800.000/año (~US$50.000).
  //   AU — A$75.000/año      (~US$49.000).
  //   JO — JOD 30.000/12m    (~US$42.000).
  //   ID — IDR 600.000.000/año (~US$37.000).
  //   NZ — NZ$60.000/12m móviles (~US$36.000).
  //   TW — NTD 600.000/año   (~US$18.500). El más apretado del bloque.
  //   SG — ⚠️ DOS condiciones A LA VEZ: SGD 100.000 de ventas a Singapur **y** SGD 1.000.000
  //        de facturación MUNDIAL. Basta que una no se cumpla para no tener que registrarse.
  JP: belowThreshold("JCT", 0.10, "JPY"),  // Japón
  MY: belowThreshold("SST", 0.08, "MYR"),  // Malasia
  PH: belowThreshold("VAT", 0.12, "PHP"),  // Filipinas
  TH: belowThreshold("VAT", 0.07, "THB"),  // Tailandia
  AU: belowThreshold("GST", 0.10, "AUD"),  // Australia
  JO: belowThreshold("GST", 0.16, "JOD"),  // Jordania
  ID: belowThreshold("PPN", 0.11, "IDR"),  // Indonesia
  NZ: belowThreshold("GST", 0.15, "NZD"),  // Nueva Zelanda
  TW: belowThreshold("VAT", 0.05, "TWD"),  // Taiwán
  SG: belowThreshold("GST", 0.09, "SGD"),  // Singapur


  // ⚠️ Fuera de la UE no se agrega ninguna fila sin su FICHA en impuestos.md.
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
 * ¿Se le puede VENDER a este país? Vender y cobrar impuesto son cosas distintas:
 * `not_registered` sí vende, pero sin impuesto. `cannot_sell` rechaza.
 */
export function isChargeableCountry(country: string | null | undefined): boolean {
  const cfg = countryTaxConfig(country);
  if (!cfg) return false;
  // Lo único que impide vender es no poder estar de alta donde el país lo EXIGE.
  // `collectionMode` NO participa: que nadie recaude ("none") es una razón para no cobrar
  // impuesto, no para rechazar la compra.
  return cfg.registrationStatus !== "cannot_sell";
}

/** ¿Vibra cobra el impuesto local, o lo percibe la emisora del comprador? */
export function taxCollectionModeForCountry(
  country: string | null | undefined
): TaxCollectionMode {
  return countryTaxConfig(country)?.collectionMode ?? "none";
}

/** Estado del alta de Vibra en ese país. */
export function registrationStatusForCountry(
  country: string | null | undefined
): RegistrationStatus {
  return countryTaxConfig(country)?.registrationStatus ?? "cannot_sell";
}

/**
 * ¿El impuesto se le suma al precio mostrado?
 * Hacen falta DOS cosas: que Vibra sea quien recauda ahí (no la emisora del comprador) Y que
 * esté dada de alta. Sin alta no se puede enterar el impuesto, así que no se cobra.
 */
export function platformCollectsTax(country: string | null | undefined): boolean {
  const cfg = countryTaxConfig(country);
  return cfg?.collectionMode === "platform" && cfg.registrationStatus === "registered";
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

  // ⚠️ Se SUMA al precio mostrado solo si se cumplen las DOS condiciones:
  //  1. Vibra es quien recauda ahí (si lo percibe la emisora del comprador, sumarlo aquí
  //     se lo cobraría dos veces: su banco ya se lo agrega en el resumen de tarjeta).
  //  2. Vibra está dada de alta en ese país (sin alta no hay cómo enterarlo).
  const collectedByPlatform =
    cfg?.collectionMode === "platform" && cfg.registrationStatus === "registered";

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
