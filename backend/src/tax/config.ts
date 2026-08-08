// Configuración fiscal + moneda por país (TABLA ÚNICA de cobro) — BACKEND (autoritativa).
//
// `import type` a propósito: se borra al compilar, así que este módulo sigue siendo PURO
// (sin firebase-admin) y se puede importar desde tests y desde código sin Admin SDK.
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

import type { LedgerServiceType } from "../wallet/ledger";

/**
 * QUIÉN recauda materialmente el impuesto del país del comprador.
 *
 * Es el dato que decide si el checkout SUMA el impuesto o no. Sin él la tabla solo podía
 * expresar dos estados ("sin fila = no cobrable" / "con fila = lo cobro yo"), y países como
 * los países donde el impuesto existe pero lo percibe el banco del comprador quedaban mal
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

/**
 * ¿Vibra está dada de alta ante el fisco de ese país?
 *
 * Es lo que decide de verdad si se cobra el impuesto. Sin alta no hay número de
 * contribuyente, no hay forma de enterar el dinero, y cobrar un impuesto que no se puede
 * remitir es ilegal. Por eso no basta con saber la tasa: hay que saber si estás registrado.
 */
export type RegistrationStatus =
  /** Alta activa → SE COBRA el impuesto y se entera. */
  | "registered"
  /**
   * Sin alta, pero el país lo permite (estás por debajo de su umbral, o el registro es
   * voluntario) → **se vende SIN cobrar impuesto**. Ej. Australia, Canadá, USA.
   */
  | "not_registered"
  /**
   * Sin alta y el país EXIGE registro previo a la primera venta → no se puede vender.
   * El checkout rechaza. Ej. LatAm y la UE mientras no se complete el alta.
   */
  | "cannot_sell";

export type CountryTaxConfig = {
  /** Nombre del impuesto al consumo en ese país (etiqueta UI / CFDI). Ej. "IVA". */
  taxName: string;
  /**
   * Tasa decimal del impuesto (0.16 = 16%).
   * ⚠️ Se guarda SIEMPRE, aun cuando no se cobre (por `collectionMode: "issuer"` o por no
   * estar registrado): sirve para advertirle al comprador y para reconstruir la operación.
   */
  taxRate: number;
  /** Moneda LOCAL de cobro del comprador (ISO 4217). Ej. "MXN", "COP". */
  currency: string;
  /** Quién recauda el impuesto local. Decide si el checkout lo suma. */
  collectionMode: TaxCollectionMode;
  /** Régimen del IVA mexicano de la venta de Vibra hacia ese país. */
  mxVatTreatment: MxVatTreatment;
  /** Si Vibra está dada de alta ahí. Sin alta no se cobra, aunque la tasa esté puesta. */
  registrationStatus: RegistrationStatus;
};

/**
 * 🟢 IVA MEXICANO SOBRE VENTAS AL EXTRANJERO — **0% para todos** (decisión 2026-08-08).
 *
 * Vibra es residente en México, así que por el Art. 16 LIVA su venta SIEMPRE está dentro
 * del objeto del IVA mexicano, incluso vendiéndole a un alemán. Lo que cambia es la tasa:
 * **0% por exportación** (Art. 29-IV) o **16%** si el servicio no encuadra.
 *
 * ⚠️ El Art. 29-IV tiene una **lista CERRADA** de servicios exportables:
 *   a) asistencia técnica · b) maquila · c) publicidad · d) comisiones y mediaciones
 *   e) seguros · f) financiamiento · g) FILMACIÓN O GRABACIÓN · h) call centers
 *   i) TECNOLOGÍAS DE LA INFORMACIÓN
 *
 * Al pasar de intermediario a vendedor directo, Vibra salió del inciso d) —que era el
 * encaje natural de una comisión— y ahora el 0% se apoya en g) o i). Mapear cada servicio
 * a su inciso es la decisión **D-08**, pendiente de fiscalista.
 *
 * 👉 PARA CAMBIAR UNO: pon `"export_taxable"` en su línea de abajo. Nada más.
 *    Ese 16% NO se le traslada al comprador extranjero (ya pagó el impuesto de su país):
 *    es un pasivo de Vibra que sale de su margen, y por eso nunca suma a `chargedAmount`.
 */
export const MX_EXPORT_TREATMENT_BY_SERVICE: Readonly<
  Record<LedgerServiceType, MxVatTreatment>
> = {
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

/** Régimen por defecto cuando el cobro no informa de qué servicio se trata. */
const MX_EXPORT_DEFAULT: MxVatTreatment = "export_zero";

/**
 * Régimen del IVA mexicano de UNA venta concreta.
 *
 * Dos capas, en este orden:
 *  1. Comprador en México → siempre `domestic_16` (es operación doméstica, no exportación).
 *  2. Comprador fuera → lo decide el SERVICIO (tabla de arriba), no el país. La lista del
 *     Art. 29-IV clasifica por tipo de servicio; el destino es irrelevante.
 */
export function mxVatTreatmentForSale(
  country: string | null | undefined,
  serviceType?: LedgerServiceType | null
): MxVatTreatment {
  if ((country ?? "").toUpperCase() === "MX") return "domestic_16";
  if (!serviceType) return MX_EXPORT_DEFAULT;
  return MX_EXPORT_TREATMENT_BY_SERVICE[serviceType] ?? MX_EXPORT_DEFAULT;
}

/** Moneda de LIQUIDACIÓN de Vibra (mantener en sync con SETTLEMENT_CURRENCY del wallet). */
const SETTLEMENT_CURRENCY = "MXN";
/** Cargo por conversión de divisa que absorbe el comprador extranjero. */
/**
 * ⚠️ Debe tener el MISMO valor que FX_CONVERSION_FEE de lib/currency/catalog.ts (el backend
 * no puede importar de lib/). Si se desalinean, el comprador extranjero ve un precio y se le
 * cobra otro — que es exactamente lo que pasaba cuando el display usaba 1.5% y esto 2%.
 */
export const FX_CONVERSION_FEE = 0.02;

/**
 * TABLA por país (ISO-3166 alpha-2 → impuesto + moneda de cobro).
 * Agregar un país = agregar una fila (tasa VERIFICADA + moneda + modo de cobro).
 * ⚠️ Además, cada país debe tener su FICHA JUSTIFICADA en `impuestos.md` (raíz del repo).
 */
/**
 * 🟢 INTERRUPTOR ÚNICO DEL ALTA EN LA UNIÓN EUROPEA — **ACTIVO** (2026-08-08).
 *
 * La UE se cubre con **un solo registro**: el esquema **Non-Union OSS**, que un negocio de
 * fuera de la UE tramita en línea en el país que elija y que habilita los 27 de golpe.
 * Ver `impuestos.md` §6.1.
 *
 * En `true` los 27 países VENDEN y COBRAN su IVA, cada uno a su tasa y en su moneda.
 *
 * ⚠️ ANTES DE PASAR A LLAVES `sk_live`: hay que tener el número de OSS (`EUxxxyyyyyz`).
 * En modo prueba no se mueve dinero real ni se recauda impuesto de nadie, así que esto es
 * inofensivo; en producción, cobrar IVA europeo sin OSS sería recaudar un impuesto que no
 * se puede enterar. El trámite es el paso pendiente, no el código.
 */
const EU_OSS_REGISTERED = true;

const EU_STATUS: RegistrationStatus = EU_OSS_REGISTERED ? "registered" : "cannot_sell";

/**
 * Fila de un país donde el impuesto lo percibe la EMISORA del comprador, no el proveedor.
 *
 * El checkout suma CERO. La tasa se guarda solo para poder mostrarle al comprador qué le
 * va a sumar su banco. Como Vibra no se registra ahí, tampoco hay nada que enterar.
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
    // Se VENDE (el país no exige alta previa), pero sin cobrar impuesto.
    registrationStatus: "not_registered",
  };
}

/** Fila de un país de la UE. Todos comparten mecanismo: Vibra cobra y entera vía OSS. */
function eu(taxRate: number, currency: string): CountryTaxConfig {
  return {
    taxName: "IVA",
    taxRate,
    currency,
    // En la UE el impuesto lo cobra el PROVEEDOR. No hay retención bancaria como en
    // Argentina: se cobra en el checkout, se declara trimestralmente al país de
    // identificación, y ese país reparte a los otros 26.
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
  // Tasas estándar tomadas de VATcomply (fuente: TEDB, la base oficial de la Comisión
  // Europea) el 2026-08-07. La tarea diaria `updateVatRates` vigila que sigan vigentes y
  // avisa si alguna cambia; NUNCA las reescribe sola (ver backend/src/vatRates.ts).
  //
  // ⚠️ Grecia es "GR" en ISO-3166; TEDB y VATcomply la publican como "EL". El feed hace
  // la traducción. Aquí siempre va el ISO.
  AT: eu(0.20, "EUR"),  // Austria
  BE: eu(0.21, "EUR"),  // Bélgica
  BG: eu(0.20, "EUR"),  // Bulgaria — euro desde el 1-ene-2026 (ya no BGN)
  CY: eu(0.19, "EUR"),  // Chipre
  CZ: eu(0.21, "CZK"),  // Chequia
  DE: eu(0.19, "EUR"),  // Alemania
  DK: eu(0.25, "DKK"),  // Dinamarca
  EE: eu(0.24, "EUR"),  // Estonia
  ES: eu(0.21, "EUR"),  // España
  FI: eu(0.255, "EUR"), // Finlandia — 25.5%, la más alta junto con Hungría
  FR: eu(0.20, "EUR"),  // Francia
  GR: eu(0.24, "EUR"),  // Grecia   (TEDB la publica como "EL")
  HR: eu(0.25, "EUR"),  // Croacia
  HU: eu(0.27, "HUF"),  // Hungría — 27%, la más alta de la UE
  IE: eu(0.23, "EUR"),  // Irlanda
  IT: eu(0.22, "EUR"),  // Italia
  LT: eu(0.21, "EUR"),  // Lituania
  LU: eu(0.17, "EUR"),  // Luxemburgo — 17%, la más baja de la UE
  LV: eu(0.21, "EUR"),  // Letonia
  MT: eu(0.18, "EUR"),  // Malta
  NL: eu(0.21, "EUR"),  // Países Bajos
  PL: eu(0.23, "PLN"),  // Polonia
  PT: eu(0.23, "EUR"),  // Portugal
  RO: eu(0.21, "RON"),  // Rumania
  SE: eu(0.25, "SEK"),  // Suecia
  SI: eu(0.22, "EUR"),  // Eslovenia
  SK: eu(0.23, "EUR"),  // Eslovaquia

  // ── LATINOAMÉRICA — países donde RECAUDA LA EMISORA del comprador ──
  //
  // En estos cinco el impuesto lo percibe el banco/emisora de la tarjeta al procesar el
  // pago al exterior, NO el proveedor. Por eso `collectionMode: "issuer"` y el checkout
  // suma CERO: si Vibra cobrara la tasa, el comprador la pagaría DOS VECES (una a Vibra
  // y otra a su banco en el resumen de tarjeta).
  //
  // La tasa se conserva para poder advertirle al comprador qué le sumará su banco.
  // Ninguno exige alta previa de Vibra → `not_registered` (se vende, sin cobrar impuesto).
  // Fichas y fuentes: impuestos.md.

  // RG 4240/18 (ARCA): agentes de percepción son "las entidades del país que faciliten o
  // administren los pagos al exterior". El proveedor extranjero no se registra ni ingresa nada.
  AR: issuerCollects("IVA", 0.21, "ARS"),

  // Recaudación directa del proveedor SOLO si se registra (voluntario); si no, retienen las
  // emisoras de tarjeta locales. Vibra no se registra → recauda la emisora.
  CR: issuerCollects("IVA", 0.13, "CRC"),

  // Las emisoras retienen el IVA de servicios digitales de no residentes NO registrados ante
  // el SRI. El registro es voluntario y Vibra no se registra → recauda la emisora.
  EC: issuerCollects("IVA", 0.15, "USD"),

  // RG 76/2020: bancos, procesadores y cooperativas son agentes de PERCEPCIÓN del IVA (10%)
  // cuando el titular paga con tarjeta o transferencia un servicio digital del exterior.
  PY: issuerCollects("IVA", 0.10, "PYG"),

  // Retención del 2% de ITBIS por parte de los procesadores de tarjeta.
  // ⚠️ El régimen de servicios digitales de la DGII sigue en desarrollo: revisar antes de
  // pasar a producción por si cambia a recaudación por plataforma.
  DO: issuerCollects("ITBIS", 0.18, "DOP"),

  // ⚠️ Para agregar países fuera de la UE hace falta su FICHA en `impuestos.md`: tasa
  // confirmada contra la autoridad del país, quién recauda (`collectionMode`) y si el país
  // exige alta previa. Sin ficha no se agrega la fila.
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
 * ¿Se le puede VENDER a este país?
 *
 * Ojo: vender y cobrar impuesto son cosas distintas.
 *  · `registered`     → se vende y se cobra el impuesto.
 *  · `not_registered` → **se vende SIN impuesto** (bajo umbral o registro voluntario).
 *  · `cannot_sell`    → el país exige alta previa y no la hay → rechazar.
 *  · sin fila         → no hay ficha en impuestos.md → rechazar.
 */
export function isChargeableCountry(country: string | null | undefined): boolean {
  const cfg = countryTaxConfig(country);
  if (!cfg) return false;
  if (cfg.collectionMode === "none") return false;
  return cfg.registrationStatus !== "cannot_sell";
}

/** Estado del alta de Vibra en ese país. */
export function registrationStatusForCountry(
  country: string | null | undefined
): RegistrationStatus {
  return countryTaxConfig(country)?.registrationStatus ?? "cannot_sell";
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
 * Donde lo percibe la emisora del comprador, sumarlo
 * aquí se lo cobraría DOS VECES. La tasa se conserva en el desglose para poder mostrarla,
 * pero el monto cobrado es 0.
 */
export function applyConsumptionTax(
  base: number,
  country: string | null | undefined,
  serviceType?: LedgerServiceType | null
): TaxBreakdown {
  const cfg = countryTaxConfig(country);
  const rate = cfg?.taxRate ?? 0;
  const collectionMode: TaxCollectionMode = cfg?.collectionMode ?? "none";

  // Se cobra SOLO si se cumplen las dos cosas: que Vibra sea quien recauda en ese país
  // (y no la emisora del comprador), Y que Vibra esté dada de alta ahí. Sin alta no hay
  // forma de enterar el dinero, así que cobrarlo sería quedárselo.
  const registered = (cfg?.registrationStatus ?? "cannot_sell") === "registered";
  const collectedByPlatform = collectionMode === "platform" && registered;

  const baseAmount = round2(base);
  const taxAmount = collectedByPlatform ? round2(baseAmount * rate) : 0;

  // IVA mexicano devengado: solo cuando el servicio NO encuadra en el Art. 29-IV y el
  // comprador está fuera. Es pasivo de Vibra, no precio del comprador.
  //
  // El régimen lo decide el SERVICIO, no el país: la lista del Art. 29-IV clasifica por tipo
  // de servicio. Si el cobro no informa cuál es, cae al default (0% por exportación).
  const mxVatTreatment: MxVatTreatment = mxVatTreatmentForSale(country, serviceType);
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
