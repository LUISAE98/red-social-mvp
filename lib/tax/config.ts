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
import { FX_CONVERSION_FEE, fxConversionFeeForCurrency } from "@/lib/currency/catalog";

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
 * INTERRUPTORES DE ALTA FISCAL POR PAÍS
 *
 * Estos países EXIGEN alta antes de la primera venta: su régimen no tiene umbral, así que
 * vender sin registro no es una zona gris sino ilegal. Por eso cada uno tiene interruptor
 * propio: `true` cobra y entera, `false` **bloquea la venta** (`cannot_sell`). No existe el
 * estado intermedio "vender sin cobrar" que sí tienen los países con umbral.
 *
 * ✅ ALTAS COMPLETADAS — confirmado por Luis el 2026-08-13. Hasta esa fecha estaban encendidos
 *    con el alta pendiente, para poder probar el cobro con Stripe en modo prueba; `ALTAS_PENDIENTES`
 *    era la lista de verificación previa a `sk_live` y quedó vacía al completarse.
 *
 * ⚠️ Al agregar un país nuevo con este helper: si su alta todavía no está hecha, **añadirlo a
 *    `ALTAS_PENDIENTES`**. El test que vigila esa lista es lo único que impide que se cuele a
 *    producción un país cobrando un impuesto que no se puede enterar — que es quedárselo.
 */
const BR_CNPJ_REGISTERED = true;  // 🇧🇷 CNPJ ante Receita Federal — alta hecha (2026-08-13)
const CO_DIAN_REGISTERED = true;  // 🇨🇴 RUT + firma electrónica (DIAN) — alta hecha (2026-08-13)
const CL_SII_REGISTERED = true;   // 🇨🇱 Régimen simplificado SII — alta hecha (2026-08-13)
const PE_SUNAT_REGISTERED = true; // 🇵🇪 RUC ante SUNAT — alta hecha (2026-08-13)
const UY_DGI_REGISTERED = true;   // 🇺🇾 Registro de no residentes DGI — alta hecha (2026-08-13)
const GB_HMRC_REGISTERED = true;  // 🇬🇧 HMRC (NETP) — alta hecha (2026-08-13)
const TR_GIB_REGISTERED = true;   // 🇹🇷 VAT No. 3 (GİB) — alta hecha (2026-08-13)
const RS_PURS_REGISTERED = true;  // 🇷🇸 Poreska uprava — alta hecha (2026-08-13)
const AL_TATIME_REGISTERED = true;// 🇦🇱 Drejtoria e Tatimeve — alta hecha (2026-08-13)
const ME_UPC_REGISTERED = true;   // 🇲🇪 Uprava prihoda i carina — alta hecha (2026-08-13)
const MD_SFS_REGISTERED = true;   // 🇲🇩 Serviciul Fiscal de Stat — alta hecha (2026-08-13)
const KR_NTS_REGISTERED = true;   // 🇰🇷 Hometax (NTS) — alta hecha (2026-08-13)
const VN_GDT_REGISTERED = true;   // 🇻🇳 Portal de proveedores extranjeros (GDT) — alta hecha (2026-08-13)
const AE_FTA_REGISTERED = true;   // 🇦🇪 FTA / EmaraTax — alta hecha (2026-08-13)
const SA_ZATCA_REGISTERED = true; // 🇸🇦 ZATCA — alta hecha (2026-08-13)
const NG_FIRS_REGISTERED = true;  // 🇳🇬 FIRS (Nigeria Tax Act 2025) — alta hecha (2026-08-13)
const MA_DGI_REGISTERED = true;   // 🇲🇦 Plataforma DGI Marruecos — alta hecha (2026-08-13)
const PF_DICP_REGISTERED = true;  // 🇵🇫 DICP Polinesia Francesa — alta hecha (2026-08-13)
const FR_DOM_REGISTERED = true;   // 🇬🇵🇲🇶🇷🇪 SIEE (Francia, DOM) — alta hecha (2026-08-13)

/**
 * Países encendidos en el código cuya alta fiscal REAL sigue pendiente.
 *
 * 👉 Lista de verificación previa a `sk_live`. Un país entra aquí cuando se enciende su
 *    interruptor antes de tener el alta, y sale cuando el alta se completa. Vacía = sin deuda.
 *
 * 🚨 No borrar este export aunque esté vacía: el test que la compara es lo que impide que un
 *    país nuevo llegue a producción cobrando un impuesto que Vibra no puede enterar.
 */
export const ALTAS_PENDIENTES: readonly string[] = [
  // ✅ VACÍA desde 2026-08-13: las 21 altas se completaron (BR·CO·CL·PE·UY · GB·TR·RS·AL·ME·MD
  //    · KR·VN·AE·SA · NG·MA · PF · GP·MQ·RE con una sola alta SIEE para los tres DOM).
  //    Mientras siga vacía, no hay deuda fiscal latente y se puede operar en producción.
];

/**
 * Fila de un país donde Vibra recauda el impuesto y lo entera, y cuyo régimen NO tiene umbral:
 * hay que estar de alta desde la primera venta.
 *
 * El interruptor decide entre cobrar (`registered`) y bloquear la venta (`cannot_sell`).
 * NO existe el estado intermedio "vender sin cobrar" que sí tienen los países con umbral:
 * aquí vender sin alta es ilegal, no una zona gris.
 */
function platformCollects(
  taxName: string,
  taxRate: number,
  currency: string,
  registered: boolean
): CountryTaxConfig {
  return {
    taxName,
    taxRate,
    currency,
    collectionMode: "platform",
    mxVatTreatment: "export_zero",
    registrationStatus: registered ? "registered" : "cannot_sell",
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

  // ── OCEANÍA ──
  //
  // Australia y Nueva Zelanda están arriba, con Asia-Pacífico. Aquí van los cuatro que
  // quedaban; el resto de la región son microestados de <300.000 habitantes sin régimen
  // digital, y no compensan la superficie de mantenimiento. Ver impuestos.md §6.6.
  //
  // 🚫 Polinesia Francesa (PF) NO entra: TVA con umbral CERO, alta desde la primera venta.
  //    Su moneda (XPF) sí está en el catálogo, compartida con Nueva Caledonia.
  GU: noConsumptionTax("USD"),             // Guam — territorio de EE. UU., sin IVA ni GST.
                                           // Su Business Privilege Tax del 4% recae en
                                           // negocios ESTABLECIDOS ahí, no en un vendedor
                                           // extranjero.
  PG: noDigitalRegime("GST", 0.10, "PGK"), // Papúa Nueva Guinea — el GST existe, pero el
                                           // reverse charge solo alcanza a clientes
                                           // registrados (B2B). Las ventas a consumidores
                                           // desde el exterior no tienen régimen.
  NC: belowThreshold("TGC", 0.11, "XPF"),  // Nueva Caledonia — umbral XPF 7.500.000/año
                                           // (~US$68.000). Régimen para extranjeros activo.
  FJ: belowThreshold("VAT", 0.125, "FJD"), // Fiyi — umbral FJD 100.000/12m (~US$44.000).
                                           // ⚠️ Tasa 12,5%: bajó desde 15% el 2025-08-01.
                                           // ⚠️ Registrarse exige agente fiscal local o
                                           // establecimiento permanente.

  // ── ÁFRICA ──
  //
  // ⚠️ La región que MÁS rápido está legislando esto: Marruecos entró en vigor en junio de
  // 2026, Nigeria en enero, Malaui en abril, Botsuana en junio. Cualquier fila de aquí
  // caduca antes que las de otras regiones. Ver impuestos.md §6.7.
  //
  // ⚠️ Y hay un SEGUNDO filtro que no existe en otros continentes: Stripe no procesa en
  // Sudán, Sudán del Sur, Somalia, Eritrea ni Libia, y aplica restricciones por riesgo de
  // sanciones en Zimbabue, Burundi, Rep. Centroafricana, RD Congo, Guinea, Guinea-Bisáu y
  // Malí. Que el impuesto lo permita NO significa que se pueda cobrar.
  //
  //   ZA — ZAR 2.300.000 en 12 meses MÓVILES (~US$125.000). Subió desde ZAR 1.000.000 el
  //        2026-04-01. Es el umbral MÁS HOLGADO de toda la tabla, por encima de Japón.
  //   EG — EGP 500.000 en 12 meses (~US$10.000). De los más apretados que tenemos.
  ZA: belowThreshold("VAT", 0.15, "ZAR"), // Sudáfrica
  EG: belowThreshold("VAT", 0.14, "EGP"), // Egipto

  // ── 🇨🇦 CANADÁ ── ⚠️ EL ÚNICO PAÍS QUE NO CABE EN ESTE MODELO ⚠️
  //
  // Canadá no tiene UN impuesto: tiene CINCO registros distintos, cada uno con su regla.
  //
  //   Federal GST/HST     5%–15% según provincia   CAD 30.000/12m móviles   ✅ hay umbral
  //   Québec QST          9,975%                   CAD 30.000/año           ✅ hay umbral
  //   Col. Británica PST  7%                       CAD 10.000/año           ✅ hay umbral
  //   Saskatchewan PST    6%                       CERO                     ❌ desde la venta 1
  //   Manitoba RST        7%                       CERO en la práctica      ❌ desde la venta 1
  //
  // 🚨 EXPOSICIÓN ACEPTADA A CONCIENCIA (decisión de Luis, 2026-08-11):
  //    Se entra cubriendo los tres niveles CON umbral. Saskatchewan y Manitoba NO tienen
  //    umbral, así que la primera venta a esas dos provincias genera obligación de registro
  //    ese mismo día. Son ~2,7 de 41 millones de canadienses (~6,6%). No es un umbral que
  //    vigilar: es incumplimiento técnico desde el minuto uno, asumido a sabiendas.
  //    (El umbral nominal de CAD 30.000 de Manitoba solo aplica a vendedores que pagaron RST
  //     en sus propias compras — cosa que un proveedor extranjero nunca cumple.)
  //
  // 🚨 CRUZAR EL UMBRAL AQUÍ **NO** ES CAMBIAR UN CAMPO.
  //    En los otros 17 países bajo umbral basta con poner `registrationStatus: "registered"`.
  //    En Canadá NO: la tasa efectiva va de 5% (Alberta) a 15% (Nueva Escocia) según dónde
  //    esté el comprador, y `resolveCountry.ts` solo distingue PAÍS, no provincia. Registrarse
  //    exige antes resolver la provincia — un cambio de modelo, no una bandera.
  //    La tasa de abajo es el SUELO federal (5%), no "la tasa de Canadá". Hay un test que
  //    fija esto para que nadie lo tome por un flip normal.
  CA: belowThreshold("GST", 0.05, "CAD"), // Canadá

  // ── 🇺🇸 ESTADOS UNIDOS ──
  //
  // NO existe sales tax federal. El impuesto es ESTATAL: 45 estados + DC lo tienen; New
  // Hampshire, Oregón, Montana, Alaska y Delaware no (Alaska sí permite impuestos locales).
  //
  // Tras *South Dakota v. Wayfair* (2018) cada estado fija su NEXO ECONÓMICO, y —a
  // diferencia de Canadá— **NINGUNO lo tiene en cero**:
  //     41 estados  US$100.000
  //     AL, MS      US$250.000
  //     CA, TX, NY  US$500.000
  // El umbral es POR ESTADO, no nacional: para deber algo en California harían falta
  // US$500.000 vendidos solo en California en 12 meses.
  //
  // ✅ Por eso "vende sin alta" es CIERTO en los 50 estados, sin la excepción que sí hubo
  //    que documentar en Canadá (Saskatchewan y Manitoba, sin umbral). Aquí no hay
  //    exposición desde la venta 1: estar sin registrar es plenamente legal en todas partes.
  //
  // 🚨 LA TASA VA EN 0 A PROPÓSITO, y NO significa "aquí no hay impuesto".
  //    No existe una tasa federal que guardar: van de 2,9% (Colorado) a 7,25% (California)
  //    de base estatal, más locales que pueden sumar varios puntos. Cualquier número aquí
  //    sería falso para 45 jurisdicciones. Es un caso DISTINTO de Hong Kong o Guam, donde
  //    el impuesto de verdad no existe (esos usan `noConsumptionTax`).
  //
  // 🚨 Y como en Canadá, cruzar un umbral aquí NO es cambiar un campo: haría falta resolver
  //    el ESTADO del comprador (D-16), y además decidir si cada servicio es gravable — unos
  //    30 estados gravan productos digitales y ~25 gravan SaaS, con definiciones que
  //    difieren; Florida y Virginia los eximen. Ver impuestos.md §6.9.
  US: belowThreshold("Sales tax", 0, "USD"), // Estados Unidos

  // ── LATAM — ALTA OBLIGATORIA DESDE LA VENTA 1 (sin umbral) ──
  //
  // Los cuatro recaudan por PLATAFORMA: Vibra cobra el impuesto y lo entera. Ninguno funciona
  // como Argentina (donde recauda el banco del comprador).
  //
  // 🚨 Sus altas siguen PENDIENTES. Ver `ALTAS_PENDIENTES` y los interruptores de arriba.
  //
  // 🇧🇷 BRASIL — ⚠️ LA TASA CAMBIA CON EL TIEMPO, es la única de toda la tabla que lo hace.
  //    2026 (hoy): 1,0% — año de prueba (CBS 0,9% + IBS 0,1%)
  //    2027:       ~8,9% — la CBS entra a tasa plena y mueren PIS/COFINS
  //    2029–2032:  el IBS sube gradual mientras bajan ICMS e ISS
  //    2033:       26,5% (CBS 8,8% + IBS 17,7%) — la 2ª tasa más alta de la tabla mundial
  //    Hay un test que fija el 1% de hoy: si alguien lo "corrige" al 26,5% estaría cobrando
  //    de más siete años antes de tiempo. Registro: CNPJ, sin umbral, representante opcional.
  //    ⚠️ Si NO se registra, la CBS/IBS se cobra sobre la remesa al exterior a tasas de
  //       referencia, más multa. No registrarse no es no pagar.
  //
  // 🇨🇴 COLOMBIA — es el único de los cuatro que PODRÍA no recaudar. La Res. DIAN 000049/2019
  //    permite acogerse a que retengan los emisores de tarjeta, y entonces Vibra no declara.
  //    Se deja como `platform` porque esa opción NO está tomada todavía y depende de D-11
  //    (si ese 19% se le suma al comprador o se le descuenta a Vibra).
  //    ⚠️ El cambio de modalidad es por ÚNICA VEZ (Art. 2°): no gastarlo por accidente.
  //
  // 🇵🇪 PERÚ — Vibra queda como agente de percepción. ⚠️ Si no se registra, la SUNAT la publica
  //    por Decreto Supremo en un listado de incumplidos y la responsabilidad pasa a los
  //    facilitadores de pago. Eso NO es "recauda el banco": es la vía del incumplimiento.
  BR: platformCollects("CBS+IBS", 0.01, "BRL", BR_CNPJ_REGISTERED), // Brasil
  CO: platformCollects("IVA", 0.19, "COP", CO_DIAN_REGISTERED),     // Colombia
  CL: platformCollects("IVA", 0.19, "CLP", CL_SII_REGISTERED),      // Chile
  PE: platformCollects("IGV", 0.18, "PEN", PE_SUNAT_REGISTERED),    // Perú

  // 🇺🇾 URUGUAY — ⚠️ AQUÍ HAY UN SEGUNDO IMPUESTO QUE NO APARECE EN ESTA TABLA ⚠️
  //
  // Uruguay cobra DOS impuestos sobre esta venta, y solo uno cabe en el modelo:
  //
  //   · IVA 22%  → impuesto al CONSUMO. Lo paga el comprador. Es el que está aquí abajo.
  //   · IRNR 12% → impuesto a la RENTA del no residente. Lo paga VIBRA de su propio ingreso.
  //                NO se le traslada al comprador, y por eso no tiene lugar en el campo
  //                de tasa: ese campo solo modela lo que se le cobra a quien compra.
  //
  // 🚨 DECISIÓN (Luis, 2026-08-11): se arranca cobrando SOLO el 22% de IVA, sin subir el
  //    precio para cubrir el IRNR. Es decir, **ese 12% sale del margen de Vibra**.
  //    Sobre una venta de $100 de base, el margen pasa de $25 a $13.
  //
  // El Convenio México–Uruguay (vigente desde 2011) puede reducirlo o eliminarlo, pero NO
  // automáticamente: depende de cómo se caracterice cada servicio.
  //    Art. 7  Beneficios empresariales → 0%  (sesión 1-a-1, saludos, consejos)
  //    Art. 12 Regalías, tope 10%       → tickets de live, VOD, post premium (la definición
  //            incluye 'derecho de autor sobre obra artística, incluidas películas')
  //    Art. 20 Otras rentas             → ⚠️ este tratado SÍ deja gravar a Uruguay
  // Reclamarlo exige certificado de residencia fiscal del SAT (Dec. 323/012 + Res. DGI
  // 2.456/2012), normas escritas para retención B2B: autoliquidando, el procedimiento no
  // está claro. Ver impuestos.md §6.11.
  //
  // Lo bueno del régimen: declaración TRIMESTRAL, se puede pagar en DÓLARES (si se opta,
  // hay que mantenerlo 3 años) y no exige representante local.
  UY: platformCollects("IVA", 0.22, "UYU", UY_DGI_REGISTERED),      // Uruguay

  // ── EUROPA NO COMUNITARIA — ALTA OBLIGATORIA DESDE LA VENTA 1 ──
  //
  // El OSS NO cubre nada de esto: cada país es un registro propio. Ninguno tiene umbral.
  //
  // 🇬🇧 REINO UNIDO — el umbral de £90.000 que aparece en toda la documentación es SOLO
  //    para empresas ESTABLECIDAS en UK. Para un extranjero (Non-Established Taxable
  //    Person) el umbral es CERO: alta desde la primera libra. Es el mercado más grande
  //    de la lista y el que menos margen de prueba da.
  //
  // 🇲🇪 MONTENEGRO — ⚠️ usa el EURO pero NO es de la UE. No lo cubre el OSS: necesita su
  //    propio registro. Tener la moneda de la UE no implica estar en su régimen fiscal.
  //
  // 🇹🇷 TURQUÍA — transcontinental; se agrupa aquí por conveniencia. Declaración mensual.
  //
  // 🚫 NO se integraron, a propósito (decisión de Luis, 2026-08-11):
  //    · Macedonia del Norte — exige representante fiscal local SOLIDARIAMENTE responsable
  //      (alguien allá responde con su patrimonio) para un mercado de 1,8 millones.
  //    · Suiza y Liechtenstein — los CHF 100.000 son de facturación MUNDIAL, no suiza, así
  //      que el umbral no protege; además exigen representante fiscal y basta una venta
  //      B2C para que TODAS las ventas suizas queden gravadas.
  GB: platformCollects("VAT", 0.20, "GBP", GB_HMRC_REGISTERED),     // Reino Unido
  TR: platformCollects("KDV", 0.20, "TRY", TR_GIB_REGISTERED),      // Turquía
  RS: platformCollects("PDV", 0.20, "RSD", RS_PURS_REGISTERED),     // Serbia
  AL: platformCollects("TVSH", 0.20, "ALL", AL_TATIME_REGISTERED),  // Albania
  ME: platformCollects("PDV", 0.21, "EUR", ME_UPC_REGISTERED),      // Montenegro
  MD: platformCollects("TVA", 0.20, "MDL", MD_SFS_REGISTERED),      // Moldavia

  // ── ASIA Y GOLFO — ALTA OBLIGATORIA DESDE LA VENTA 1 ──
  //
  // Los cuatro sin representante fiscal obligatorio y con declaración TRIMESTRAL.
  //
  // 🇰🇷 COREA DEL SUR — registro simplificado en Hometax. ⚠️ El alta debe hacerse dentro
  //    de los 20 días desde que se empieza a operar ahí.
  //
  // 🇦🇪 EAU y 🇸🇦 ARABIA SAUDITA — trimestral salvo volúmenes enormes (AED 150 M / SAR 40 M).
  //    En Arabia Saudita la facturación electrónica (Fatoora) NO aplica a no residentes,
  //    que es la parte más pesada de su régimen. ⚠️ El representante fiscal es opcional
  //    desde jul-2025, pero sin él ZATCA pediría garantía bancaria — monto SIN CONFIRMAR.
  //
  // 🇻🇳 VIETNAM — ⚠️ COBRA DOS IMPUESTOS, igual que Uruguay:
  //      · VAT 10% → al comprador. Es el que está en la fila de abajo.
  //      · CIT  5% sobre ingreso BRUTO → sale del margen de Vibra, no se le traslada.
  //    🚨 A diferencia de Uruguay, ese 5% NO se absorbe: se recupera subiendo el cargo de
  //       conversión de VND al 7% (2% estándar + 5% del CIT). Ver la explicación en
  //       FX_CONVERSION_FEE_BY_CURRENCY. No se desglosa al comprador: es precio, no
  //       impuesto. Decisión de Luis, 2026-08-11.
  //    ⚠️ Si NO se registra, los bancos e intermediarios retienen y enteran mensualmente.
  //       Es la vía del incumplimiento, no una alternativa (mismo patrón que Perú).
  KR: platformCollects("VAT", 0.10, "KRW", KR_NTS_REGISTERED),      // Corea del Sur
  VN: platformCollects("VAT", 0.10, "VND", VN_GDT_REGISTERED),      // Vietnam
  AE: platformCollects("VAT", 0.05, "AED", AE_FTA_REGISTERED),      // Emiratos Árabes Unidos
  SA: platformCollects("VAT", 0.15, "SAR", SA_ZATCA_REGISTERED),    // Arabia Saudita

  // ── ÁFRICA — ALTA OBLIGATORIA DESDE LA VENTA 1 ──
  //
  // Los dos únicos mercados africanos que compensan hoy, elegidos por razones opuestas:
  // Marruecos por CALIDAD (~90% de penetración de internet, el doble de ingreso per cápita
  // que Nigeria) y Nigeria por VOLUMEN (~230 M de habitantes, cultura de creadores enorme).
  //
  // ⚠️ Ambos tenían control de cambios que impedía comprar en el extranjero. Los dos se
  //    relajaron y hoy NO son limitantes para el ticket de Vibra:
  //      🇳🇬 Tarjetas naira reactivadas en jul-2025 tras 3 años suspendidas. Los bancos
  //         ponen sus propios topes (GTBank: de US$1.000 a US$6.000 por trimestre).
  //      🇲🇦 Dotación anual de e-commerce subida a 20.000 dirhams (~US$2.000) el 1-ene-2026.
  //         Agotada la cuota, el banco rechaza los pagos internacionales.
  //
  // 🇲🇦 MARRUECOS — su régimen entró en vigor el 11-jun-2026, hace dos meses: se llega A
  //    TIEMPO, no tarde.
  // 🇳🇬 NIGERIA — ⚠️ se llega TARDE: la obligación del Tax Act 2025 arrancó el 1-ene-2026.
  //    Mismo caso que Brasil. Confirmar el régimen de multas antes de dar el alta.
  //
  // 🚫 NO se integraron (decisión de Luis, 2026-08-11):
  //    · Kenia — M-Pesa domina los pagos, no la tarjeta. Mismo problema que India con UPI.
  //    · Tanzania — 18% de IVA MÁS 3% sobre ingreso bruto, que sale del margen.
  //    · Uganda — el más pobre y menos conectado de los seis.
  //    · Ghana — mercado decente, pero exige facturación electrónica certificada (E-VAT).
  NG: platformCollects("VAT", 0.075, "NGN", NG_FIRS_REGISTERED),    // Nigeria
  MA: platformCollects("TVA", 0.20, "MAD", MA_DGI_REGISTERED),      // Marruecos

  // ── OCEANÍA — ALTA OBLIGATORIA DESDE LA VENTA 1 ──
  //
  // 🇵🇫 POLINESIA FRANCESA — cierra Oceanía. Su moneda (XPF) ya estaba en el catálogo por
  //    compartirla con Nueva Caledonia, así que no trajo trabajo de monedas.
  //
  //    ⚠️ Su TVA tiene DOS tasas: 13% para servicios y 16% estándar. Se usa 13% porque los
  //       11 servicios de Vibra son servicios. Si el fisco polinesio llegara a clasificar el
  //       contenido de pago (VOD, post premium, tickets) como bien y no como servicio,
  //       subiría al 16%. Pendiente de confirmar si Polinesia gana volumen.
  //
  //    Contraste con 🇳🇨 Nueva Caledonia, su vecina: allá hay umbral (XPF 7.500.000) y aquí
  //    no. Misma moneda, regímenes distintos — no asumir que se comportan igual.
  PF: platformCollects("TVA", 0.13, "XPF", PF_DICP_REGISTERED),     // Polinesia Francesa

  // ── MICROESTADOS DEL PACÍFICO — SIN RÉGIMEN PARA PROVEEDORES EXTRANJEROS ──
  //
  // 🚨 ESTOS 13 SE INTEGRARON SOBRE UNA PROBABILIDAD, NO SOBRE VERIFICACIÓN. 🚨
  //
  // A diferencia del resto de la tabla, aquí NO se confirmó país por país que no exista
  // régimen para proveedores digitales extranjeros: se buscó y **no hay información pública
  // clara**. Se integran por el mismo razonamiento que Bolivia o Papúa Nueva Guinea —
  // jurisdicciones de 1.900 a 750.000 habitantes no construyen regímenes tipo OSS— pero
  // conviene saber que el fundamento es un prior, no una fuente.
  // Decisión de Luis, 2026-08-11. Ver impuestos.md §6.6.
  //
  // Varios tienen IVA propio (15% en Vanuatu, Samoa y Tonga); lo que no se encontró es que
  // alcance a un vendedor extranjero sin presencia local.
  //
  // 🚫 DOS del Pacífico se dejaron FUERA porque sí hay evidencia positiva de impuesto:
  //    · 🇨🇰 Islas Cook — régimen CONFIRMADO para no residentes, VAT 15%
  //    · 🇵🇼 Palaos — GST 10% desde 2023
  TO: noDigitalRegime("Consumption Tax", 0.15, "TOP"), // Tonga
  SB: noDigitalRegime("GST", 0.15, "SBD"),             // Islas Salomón
  VU: noDigitalRegime("VAT", 0.15, "VUV"),             // Vanuatu
  WS: noDigitalRegime("GST", 0.15, "WST"),             // Samoa
  KI: noDigitalRegime("VAT", 0.125, "AUD"),            // Kiribati
  NR: noConsumptionTax("AUD"),                         // Nauru
  TV: noConsumptionTax("AUD"),                         // Tuvalu
  NU: noConsumptionTax("NZD"),                         // Niue
  WF: noConsumptionTax("XPF"),                         // Wallis y Futuna
  FM: noConsumptionTax("USD"),                         // Micronesia
  MH: noConsumptionTax("USD"),                         // Islas Marshall
  AS: noConsumptionTax("USD"),                         // Samoa Americana — territorio de EE. UU.
  MP: noConsumptionTax("USD"),                         // Marianas del Norte — territorio de EE. UU.

  // ── CARIBE ──
  //
  // 🇸🇷 SURINAM — el único del Caribe con UMBRAL real: SRD 500.000 al año (~US$13.000).
  //    Régimen para extranjeros vigente desde 2023. Vigilancia manual como el resto.
  //
  // Sin régimen para proveedores extranjeros (se vende a cero):
  //   🇧🇿 Belice — el GST del 12,5% solo alcanza a entidades establecidas ahí. VERIFICADO.
  //   🇰🇾 Caimán · 🇧🇲 Bermudas · 🇹🇨 Turcas y Caicos · 🇻🇬 Vírgenes Británicas — no existe
  //      impuesto al consumo. Nunca habrá nada que cobrar.
  //
  // ⚠️ 🇹🇹 TRINIDAD Y TOBAGO — el más AMBIGUO de la tabla. No hay legislación específica
  //    para servicios digitales, pero algunas fuentes sugieren que una empresa extranjera
  //    igual tendría obligación de registro sin importar la facturación. Se integra como
  //    sin régimen porque no se encontró norma que lo exija, pero **si Trinidad gana
  //    volumen hay que consultarlo con un asesor local antes de seguir vendiendo**.
  //
  // 🚨 EN CAMINO — hoy no hay régimen, pero YA TIENEN FECHA. Vigilancia obligatoria:
  //   🇯🇲 JAMAICA — el GCT del 15% sobre servicios digitales del exterior está ANUNCIADO
  //      y sería efectivo a **principios de 2027**. Cuando entre en vigor, esta fila pasa
  //      a `platformCollects` con alta ante la TAJ. Es el único país de toda la tabla con
  //      fecha conocida de cambio de régimen. Ver D-23.
  //   🇬🇩 GRANADA — propuesta de 2026 para gravar a no residentes; aún NO es ley. El umbral
  //      doméstico es XCD 120.000. Vigilar si se aprueba.
  SR: belowThreshold("VAT", 0.10, "SRD"),              // Surinam
  BZ: noDigitalRegime("GST", 0.125, "BZD"),            // Belice
  TT: noDigitalRegime("VAT", 0.125, "TTD"),            // Trinidad y Tobago — ⚠️ ambiguo
  JM: noDigitalRegime("GCT", 0.15, "JMD"),             // Jamaica — ⚠️ cambia en 2027
  GD: noDigitalRegime("VAT", 0.15, "XCD"),             // Granada — ⚠️ propuesta en curso
  KY: noConsumptionTax("KYD"),                         // Islas Caimán
  BM: noConsumptionTax("BMD"),                         // Bermudas
  TC: noConsumptionTax("USD"),                         // Turcas y Caicos
  VG: noConsumptionTax("USD"),                         // Islas Vírgenes Británicas

  // ── CARIBE Y TERRITORIOS AMERICANOS (2ª tanda) ──
  //
  // 🇵🇷 PUERTO RICO — ⚠️ NO es 'territorio de EE. UU. y por eso ya está cubierto'. Tiene su
  //    PROPIO sistema (Hacienda PR) con IVU del 11,5%, y aplica el modelo Wayfair igual que
  //    los estados: umbral de **US$100.000 o 200 transacciones**. Es umbral REAL, así que
  //    se vende sin alta hasta cruzarlo. Son 3,2 M de hispanohablantes.
  //
  // 🇻🇮 ISLAS VÍRGENES DE EE. UU. — tiene un gross receipts tax del 5%, pero **NO adoptó
  //    reglas de nexo económico tipo Wayfair** para vendedores remotos. Sin régimen.
  //
  // 🏝️ CARIBE ORIENTAL (XCD) — se buscó un marco OECS armonizado y **NO EXISTE**: cada país
  //    legisla por su cuenta. El único que se movió fue Granada, con una propuesta que aún
  //    no es ley. Los siete restantes no tienen régimen para proveedores extranjeros.
  //    Todos comparten el dólar del Caribe Oriental, que ya estaba en el catálogo.
  //
  // 🇬🇱 GROENLANDIA y 🇵🇲 SAN PEDRO Y MIQUELÓN — no existe IVA ni impuesto general al consumo.
  //    Ambos están fuera del territorio IVA de la UE pese a su vínculo con Dinamarca y
  //    Francia; no los cubre el OSS ni les aplica el IVA de esos países.
  //
  // 🚫 NO se integraron, porque SÍ tienen régimen para extranjeros con umbral cero:
  //    🇧🇧 Barbados (VAT 17,5%) · 🇧🇸 Bahamas (VAT 10%) · 🇦🇼 Aruba (BBO 7%)
  //    🇨🇼 Curazao (OB 6%, mensual) · 🇸🇽 Sint Maarten (TOT 5%, mensual incluso en cero)
  //    🇬🇾 Guyana (VAT 14% + representante fiscal obligatorio)
  PR: belowThreshold("IVU", 0.115, "USD"),             // Puerto Rico
  VI: noDigitalRegime("Gross Receipts", 0.05, "USD"),  // Islas Vírgenes de EE. UU.
  HT: noDigitalRegime("TCA", 0.10, "HTG"),             // Haití
  BQ: noDigitalRegime("ABB", 0.08, "USD"),             // Bonaire
  LC: noDigitalRegime("VAT", 0.125, "XCD"),            // Santa Lucía
  VC: noDigitalRegime("VAT", 0.16, "XCD"),             // San Vicente y las Granadinas
  AG: noDigitalRegime("ABST", 0.17, "XCD"),            // Antigua y Barbuda
  KN: noDigitalRegime("VAT", 0.17, "XCD"),             // San Cristóbal y Nieves
  DM: noDigitalRegime("VAT", 0.15, "XCD"),             // Dominica
  AI: noDigitalRegime("GST", 0.13, "XCD"),             // Anguila
  MS: noConsumptionTax("XCD"),                         // Montserrat
  GL: noConsumptionTax("DKK"),                         // Groenlandia
  PM: noConsumptionTax("EUR"),                         // San Pedro y Miquelón

  // ── MICROESTADOS Y TERRITORIOS EUROPEOS ──
  //
  // 🇲🇨 MÓNACO — ⚠️ usa `eu()` A PROPÓSITO, aunque NO sea miembro de la Unión Europea.
  //    Para efectos de IVA, Mónaco **es territorio francés**: misma base, misma tasa (20%),
  //    administrado por la DGFiP. El Art. 7 de la Directiva del IVA asimila las operaciones
  //    con Mónaco a operaciones con Francia, así que **el registro OSS YA LO CUBRE** y no
  //    hace falta ningún alta nueva.
  //    Usar `eu()` no es un atajo: si `EU_OSS_REGISTERED` se apaga, Mónaco también debe
  //    dejar de vender, porque depende exactamente del mismo registro.
  //    🚨 Es el CONTRARIO de Montenegro, que usa euro pero NO está en el régimen del IVA
  //       comunitario. Moneda y territorio fiscal son cosas distintas.
  //
  // ✅ Con umbral real:
  //   🇯🇪 JERSEY — GST 5%, umbral **£300.000 en 12 meses móviles** (~US$385.000). Es el
  //      umbral MÁS ALTO de toda la tabla mundial, por encima de Sudáfrica (~US$125.000).
  //   🇦🇩 ANDORRA — IGI 4,5%, la tasa más baja de Europa. Umbral **€40.000/año** con
  //      clientes andorranos. Tiene régimen digital desde 2013.
  //
  // 🟢 Con impuesto que NO alcanza a Vibra:
  //   🇸🇲 SAN MARINO — su imposta monofase del 17% grava importación de BIENES y
  //      **expresamente no se extiende a prestaciones de servicios**. Para lo que vende
  //      Vibra, cero. No es que falte régimen: es que el impuesto no llega hasta aquí.
  //   🇫🇴 ISLAS FEROE — MVG 25% con umbral DKK 50.000, pero la obligación solo alcanza a
  //      negocios con **actividad establecida** en territorio feroés. Sin presencia, no.
  //      Están fuera del IVA danés pese a ser territorio de Dinamarca.
  //
  // 🟢 Sin impuesto al consumo en absoluto: 🇬🇮 Gibraltar · 🇻🇦 Vaticano · 🇬🇬 Guernsey
  //    (tiene un GST propuesto, aún no aprobado) · 🇸🇯 Svalbard (exento del IVA noruego).
  //
  // 🚫 NO se integraron:
  //    🇽🇰 Kosovo — VAT 18% con **representante fiscal obligatorio**.
  //    🇮🇲 Isla de Man — forma parte del área IVA del REINO UNIDO: entra cuando entre UK.
  MC: eu(0.20, "EUR"),                                 // Mónaco — territorio IVA francés
  JE: belowThreshold("GST", 0.05, "GBP"),              // Jersey
  AD: belowThreshold("IGI", 0.045, "EUR"),             // Andorra
  SM: noDigitalRegime("Imposta monofase", 0.17, "EUR"),// San Marino
  FO: noDigitalRegime("MVG", 0.25, "DKK"),             // Islas Feroe
  GI: noConsumptionTax("GIP"),                         // Gibraltar
  VA: noConsumptionTax("EUR"),                         // Ciudad del Vaticano
  GG: noConsumptionTax("GBP"),                         // Guernsey
  SJ: noConsumptionTax("NOK"),                         // Svalbard y Jan Mayen

  // ── AZERBAIYÁN ──
  //
  // ⚠️ Su régimen para no residentes arranca el **1 de septiembre de 2026**, con umbral de
  //    US$10.000 y 30 días para registrarse tras cruzarlo. Portal electrónico del STS.
  //    Identificación del comprador por indicios, igual que Georgia.
  AZ: belowThreshold("VAT", 0.18, "AZN"),              // Azerbaiyán

  // ── ASIA (3ª tanda) ──
  //
  // ✅ Con umbral real:
  //   🇱🇰 SRI LANKA — régimen desde el 1-jul-2026. Umbral LKR 60 M/12 meses o LKR 15 M por
  //      trimestre. ⚠️ Otra fuente da LKR 36 M / LKR 9 M: confirmar si gana volumen.
  //   🇰🇭 CAMBOYA — umbral KHR 250.000.000 (~US$62.000).
  //   🇳🇵 NEPAL — umbral NPR 2.000.000 (~US$15.000), de los más apretados.
  //   🇧🇹 BUTÁN — GST ESTRENADO el 1-ene-2026, umbral Nu. 5.000.000 (~US$58.000).
  //      El registro voluntario arranca en Nu. 2.500.000.
  //
  // 🟢 Sin impuesto que alcance a Vibra:
  //   🇧🇳 BRUNÉI — no existe IVA ni GST. Nunca habrá nada que cobrar.
  //   🇲🇳 MONGOLIA — el VAT del 10% existe, pero los servicios recibidos de un no residente
  //      van por **reverse charge**: autoliquida el receptor mongol. El extranjero NO se
  //      registra. Es el mismo mecanismo que en el B2B europeo.
  //   🇲🇻 MALDIVAS — GST 8%, pero los no residentes **sin establecimiento permanente NO
  //      están obligados a registrarse**. Exención explícita.
  //
  // 🚫 De los 10 pequeños revisados, seis quedaron fuera:
  //    · 🇵🇰 Pakistán — derogó su impuesto digital del 5% retroactivamente (jul-2025), PERO
  //      el Finance Act 2026 metió a los proveedores extranjeros al sales tax con registro
  //      simplificado OBLIGATORIO. Exige alta.
  //    · 🇹🇱 Timor-Leste — Stripe no lo soporta.
  //    · 🇱🇧 Líbano · 🇮🇶 Irak · 🇹🇲 Turkmenistán · 🇲🇲 Myanmar — sin información de régimen;
  //      Myanmar además bajo sanciones.
  LK: belowThreshold("VAT", 0.18, "LKR"),              // Sri Lanka
  KH: belowThreshold("VAT", 0.10, "KHR"),              // Camboya
  NP: belowThreshold("VAT", 0.13, "NPR"),              // Nepal
  BT: belowThreshold("GST", 0.05, "BTN"),              // Bután
  BN: noConsumptionTax("BND"),                         // Brunéi
  MN: noDigitalRegime("VAT", 0.10, "MNT"),             // Mongolia — reverse charge
  MV: noDigitalRegime("GST", 0.08, "MVR"),             // Maldivas — sin EP no hay registro

  // ── ÁFRICA (3ª tanda) ──
  //
  // Los dos únicos africanos con umbral que permita vender sin trámite. África es el
  // continente con menos margen: casi todos sus regímenes tienen umbral CERO.
  //
  // 🇧🇼 BOTSUANA — VAT 14%, umbral **P500.000** (~US$37.000). Los cobros arrancan el
  //    1-oct-2026, así que se llega a tiempo.
  //
  // 🇨🇮 COSTA DE MARFIL — VAT 18%, umbral **XOF 200.000.000** (~US$333.000). Es el tercer
  //    umbral más alto del mundo, tras Jersey (~US$385.000) y Sri Lanka.
  //    ⚠️ Al registrarse exige **representante fiscal local** — pero con ese umbral el
  //       momento queda muy lejos. Si se acerca, revisar antes de cruzarlo.
  //    ⚠️ XOF es moneda SIN decimales para Stripe; ya estaba en ZERO_DECIMAL desde Oceanía.
  //
  // 🚫 El resto de África quedó fuera por umbral cero o representante obligatorio:
  //    🇸🇳 Senegal (18%, representante solidario) · 🇨🇲 Camerún (19,25%, representante)
  //    🇲🇼 Malaui (17,5%, obliga a registrarse AUNQUE no se alcance el umbral)
  //    🇩🇿 Argelia (19%) · 🇲🇺 Mauricio (desde ene-2026) · 🇲🇿 Mozambique (2026)
  //    🇰🇪 Kenia · 🇹🇿 Tanzania · 🇺🇬 Uganda · 🇬🇭 Ghana · 🇿🇲 Zambia · 🇧🇯 Benín
  BW: belowThreshold("VAT", 0.14, "BWP"),              // Botsuana
  CI: belowThreshold("TVA", 0.18, "XOF"),              // Costa de Marfil

  // ── TERRITORIOS DE OCEANÍA — cierran el continente ──
  //
  // 🚨 NORFOLK, NAVIDAD Y COCOS son territorios EXTERNOS de Australia, y el **GST
  //    australiano NO les aplica**: las ventas hacia allá se tratan como exportaciones
  //    exentas. No heredan la fila de `AU` — tienen código ISO propio y tributan distinto.
  //    Es el mismo patrón que Guayana Francesa y Mayotte respecto a Francia.
  //
  // 🇹🇰 Tokelau (Nueva Zelanda) y 🇵🇳 Pitcairn (Reino Unido): sin impuesto al consumo.
  //
  // Ninguno trae moneda nueva: usan AUD y NZD, que ya estaban.
  // Suman ~4.500 habitantes. Se integran para cerrar Oceanía sin huecos, no por mercado.
  //
  // 🚫 Siguen fuera los dos que SÍ tienen régimen para no residentes:
  //    🇨🇰 Islas Cook (VAT 15%) · 🇵🇼 Palaos (GST 10% desde 2023)
  NF: noConsumptionTax("AUD"),                         // Isla Norfolk
  CX: noConsumptionTax("AUD"),                         // Isla de Navidad
  CC: noConsumptionTax("AUD"),                         // Islas Cocos
  TK: noConsumptionTax("NZD"),                         // Tokelau
  PN: noConsumptionTax("NZD"),                         // Islas Pitcairn

  // ── 🚨 TERRITORIOS FRANCESES FUERA DEL IVA DE LA UE (D-22) ──
  //
  // Guayana Francesa y Mayotte son departamentos franceses, pero la TVA **NO les es
  // aplicable** — ni la francesa ni la comunitaria. El OSS no los cubre.
  //
  // ✅ Tienen CÓDIGO ISO PROPIO (`GF`, `YT`), así que la geolocalización por IP los
  //    distingue de Francia y estas filas los atrapan sin necesidad de código postal.
  //
  // 🚨 LIMITACIÓN IMPORTANTE: nuestra regla de resolución da preferencia a la TARJETA sobre
  //    la IP. Un comprador en Mayotte con tarjeta emitida por un banco francés metropolitano
  //    reportará `FR` y se le cobrará el 20% igual. Estas filas solo corrigen el caso en que
  //    la IP manda (fase de display, o tarjeta que reporta el territorio). El arreglo
  //    completo necesita resolución por subdivisión (D-16).
  //
  // ⬜ FALTAN de este bloque, y NO se pueden resolver así:
  //    · 🇬🇵 Guadalupe (GP) · 🇲🇶 Martinica (MQ) · 🇷🇪 Reunión (RE) — tienen código ISO propio
  //      pero su TVA es **8,5%**, no cero: cobrarles requiere alta ante la DGFiP.
  //    · Canarias, Ceuta y Melilla — **NO tienen código ISO**: resuelven como `ES` y
  //      necesitan lógica por código postal (35xxx/38xxx, 51xxx, 52xxx).
  //    · Åland — resuelve como `FI`, mismo problema.
  GF: noConsumptionTax("EUR"),                         // Guayana Francesa — TVA no aplicable
  YT: noConsumptionTax("EUR"),                         // Mayotte — TVA no aplicable

  // ── 🇬🇵🇲🇶🇷🇪 DEPARTAMENTOS FRANCESES CON TVA PROPIA (D-22) ──
  //
  // Guadalupe, Martinica y Reunión están FUERA del territorio IVA de la UE —el OSS no los
  // cubre— pero **sí aplican TVA, al 8,5%** (tasa normal DOM; la reducida es 2,1%).
  // No confundir con Guayana Francesa y Mayotte, donde la TVA NO es aplicable en absoluto.
  //
  // ✅ UN SOLO REGISTRO PARA LOS TRES. El punto de contacto para no residentes de fuera de
  //    la UE es el **SIEE** (Service des Impôts des Entreprises Étrangères) de Noisy-le-
  //    Grand, que da un número de TVA francés y cubre los DOM. Por eso comparten un solo
  //    interruptor: si el alta se hace, se hace para los tres a la vez.
  //
  // ✅ Tienen código ISO propio (`GP`, `MQ`, `RE`), así que la geolocalización por IP los
  //    distingue de Francia y estas filas SÍ se activan.
  //    ⚠️ Con la misma limitación que GF/YT: si la tarjeta reporta `FR`, gana la tarjeta.
  //
  // Sin umbral: Francia no lo tiene para proveedores no establecidos.
  GP: platformCollects("TVA", 0.085, "EUR", FR_DOM_REGISTERED), // Guadalupe
  MQ: platformCollects("TVA", 0.085, "EUR", FR_DOM_REGISTERED), // Martinica
  RE: platformCollects("TVA", 0.085, "EUR", FR_DOM_REGISTERED), // Reunión

  // ── 🇮🇨 CANARIAS (D-22) ──
  //
  // 🚨 ESTA FILA HOY NO SE ACTIVA, y está puesta a propósito.
  //
  // Canarias no tiene código ISO que devuelvan los servicios de geolocalización: un
  // comprador en Tenerife resuelve como `ES`. `IC` es un código ISO 3166-1 EXCEPCIONALMENTE
  // RESERVADO para las Islas Canarias, pero nadie lo emite en la práctica.
  //
  // Se deja la fila con el dato CORRECTO para que el día que exista resolución por
  // subdivisión (D-16) —o detección por código postal `35xxx`/`38xxx`— Canarias funcione
  // sin tener que investigar de nuevo. Mientras tanto, a Canarias se le sigue cobrando el
  // 21% español, que es incorrecto.
  //
  // Los datos verificados (2026-08-11):
  //   · IGIC 7%, y los servicios digitales a consumidores canarios tributan por IGIC
  //     **sin importar dónde esté el prestador**.
  //   · ✅ HAY UMBRAL: **€100.000** de base imponible facturada el año anterior. Por debajo
  //     no hay obligación de presentar el Modelo 400 (alta censal).
  //   · Declaración: **Modelo 420, trimestral**.
  //   · Registro ante la **Agencia Tributaria Canaria**, aparte del OSS y aparte de la AEAT.
  IC: belowThreshold("IGIC", 0.07, "EUR"),             // Canarias                 // Canarias

  // ── 🇪🇦 CEUTA Y MELILLA (D-22) ──
  //
  // Están fuera del territorio IVA de la UE. Su impuesto propio es el **IPSI** (Impuesto
  // sobre la Producción, los Servicios y la Importación), cuya tasa la fija cada ciudad y
  // varía por producto — por eso la tasa de referencia va en 0: no hay una sola.
  //
  // No se encontró régimen que obligue a un proveedor digital extranjero a registrarse
  // ante ninguna de las dos ciudades, así que se vende a cero.
  //
  // `EA` es el código ISO 3166-1 excepcionalmente reservado para Ceuta y Melilla. Se
  // alcanza por la corrección de subdivisión (ES-CE y ES-ML), no por geolocalización
  // directa. Ver SUBDIVISION_TAX_OVERRIDES.
  EA: noDigitalRegime("IPSI", 0, "EUR"),               // Ceuta y Melilla


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
  if (!shouldAddFxFee(country)) return 0;
  // No siempre es el 2%: algunas monedas llevan un ajuste propio (ver catalog.ts).
  return fxConversionFeeForCurrency(chargeCurrencyForCountry(country));
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
