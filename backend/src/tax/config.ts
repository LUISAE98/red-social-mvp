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
  /**
   * NADIE recauda por esta venta: el país no tiene régimen de servicios digitales para
   * proveedores extranjeros, así que no hay dónde darse de alta ni qué enterar.
   *
   * ⚠️ Esto NO impide vender. La venta la decide `registrationStatus`, no este campo.
   * Ej. Bolivia, El Salvador, Guatemala, Honduras, Nicaragua.
   */
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
 * Monedas con un cargo de conversión ELEVADO, por encima del 2% estándar.
 *
 * 🚨 NO es impuesto y NO se desglosa al comprador: es un ajuste de PRECIO. Existe para
 *    hacer viable vender en países donde un impuesto a la RENTA nos sale del margen y
 *    no se le puede trasladar al comprador como línea aparte.
 *
 *   🇻🇳 VND — 7% = 2% de conversión + 5% que cubre el CIT vietnamita. *
 * 🚫 URUGUAY se probó y se DESCARTÓ (Luis, 2026-08-11). Con UYU al 14% el total de una venta
 *    de $100 de base subía a $143 —el país más caro de toda la tabla, 36% por encima de
 *    Argentina— porque el IVA del 22% se calcula DESPUÉS del ajuste y lo amplifica.
 *    Se prefirió absorber el IRNR del 12% antes que cobrarle eso al comprador uruguayo.
 *    No volver a agregar UYU aquí sin revisar ese número.
 *      Vietnam cobra VAT 10% (al comprador, ese sí va en la tabla fiscal) **y** CIT 5%
 *      sobre ingreso BRUTO, que sale del margen de Vibra. Sin este ajuste, cada venta
 *      vietnamita dejaría $20 de margen en vez de $25.
 *      Decisión de Luis, 2026-08-11: el comprador vietnamita paga un poco más y el
 *      servicio se puede ofrecer, en vez de no ofrecerlo.
 *
 * ⚠️ COPIA de lib/currency/catalog.ts. Deben tener los MISMOS valores: si difieren, el
 *    comprador ve un precio y se le cobra otro. Hay un test de paridad que lo vigila.
 */
const FX_CONVERSION_FEE_BY_CURRENCY: Readonly<Record<string, number>> = {
  VND: 0.07,
};

/**
 * Cargo de conversión que aplica a una moneda concreta. Devuelve el 2% estándar salvo
 * que la moneda tenga un ajuste propio.
 */
export function fxConversionFeeForCurrency(currency: string | null | undefined): number {
  if (!currency) return FX_CONVERSION_FEE;
  return FX_CONVERSION_FEE_BY_CURRENCY[currency.toUpperCase()] ?? FX_CONVERSION_FEE;
}

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
 * 🚨 ALTAS PENDIENTES — INTERRUPTORES POR PAÍS 🚨
 *
 * Estos cuatro países EXIGEN alta antes de la primera venta: no tienen umbral. El código ya
 * está listo para cobrar, pero el alta ante su fisco **todavía no está hecha**.
 *
 * Están en `true` a propósito, para poder **probar el cobro con Stripe en modo prueba**, donde
 * no hay dinero real ni obligación fiscal. Es la misma decisión que se tomó con la UE.
 *
 * ⚠️⚠️ ANTES DE PASAR A LLAVES `sk_live`: cada uno de estos debe tener su alta REAL hecha, o
 *      ponerse en `false`. Cobrar un impuesto que no se puede enterar es quedárselo.
 *      La lista viva está en `ALTAS_PENDIENTES` (abajo) y hay un test que la vigila.
 */
const BR_CNPJ_REGISTERED = true;  // 🇧🇷 CNPJ ante Receita Federal — PENDIENTE
const CO_DIAN_REGISTERED = true;  // 🇨🇴 RUT + firma electrónica (DIAN) — PENDIENTE
const CL_SII_REGISTERED = true;   // 🇨🇱 Régimen simplificado SII — PENDIENTE
const PE_SUNAT_REGISTERED = true; // 🇵🇪 RUC ante SUNAT — PENDIENTE
const UY_DGI_REGISTERED = true;   // 🇺🇾 Registro de no residentes DGI — PENDIENTE
const GB_HMRC_REGISTERED = true;  // 🇬🇧 HMRC (NETP) — PENDIENTE
const TR_GIB_REGISTERED = true;   // 🇹🇷 VAT No. 3 (GİB) — PENDIENTE
const RS_PURS_REGISTERED = true;  // 🇷🇸 Poreska uprava — PENDIENTE
const AL_TATIME_REGISTERED = true;// 🇦🇱 Drejtoria e Tatimeve — PENDIENTE
const ME_UPC_REGISTERED = true;   // 🇲🇪 Uprava prihoda i carina — PENDIENTE
const MD_SFS_REGISTERED = true;   // 🇲🇩 Serviciul Fiscal de Stat — PENDIENTE
const KR_NTS_REGISTERED = true;   // 🇰🇷 Hometax (NTS) — PENDIENTE
const VN_GDT_REGISTERED = true;   // 🇻🇳 Portal de proveedores extranjeros (GDT) — PENDIENTE
const AE_FTA_REGISTERED = true;   // 🇦🇪 FTA / EmaraTax — PENDIENTE
const SA_ZATCA_REGISTERED = true; // 🇸🇦 ZATCA — PENDIENTE
const NG_FIRS_REGISTERED = true;  // 🇳🇬 FIRS (Nigeria Tax Act 2025) — PENDIENTE
const MA_DGI_REGISTERED = true;   // 🇲🇦 Plataforma DGI Marruecos — PENDIENTE
const PF_DICP_REGISTERED = true;  // 🇵🇫 DICP Polinesia Francesa — PENDIENTE
const FR_DOM_REGISTERED = true;   // 🇬🇵🇲🇶🇷🇪 SIEE (Francia, DOM) — PENDIENTE

/**
 * Países encendidos en el código cuya alta fiscal REAL sigue pendiente.
 *
 * 👉 Es la lista de verificación previa a `sk_live`. Cuando una alta se complete, se borra su
 *    entrada de aquí. Cuando esta lista quede vacía, se puede pasar a producción sin deuda.
 */
export const ALTAS_PENDIENTES: readonly string[] = [
  "BR", "CO", "CL", "PE", "UY",
  "GB", "TR", "RS", "AL", "ME", "MD",  // Europa no comunitaria
  "KR", "VN", "AE", "SA",              // Asia y Golfo
  "NG", "MA",                          // África
  "PF",                                // Oceanía
  "GP", "MQ", "RE",                    // DOM franceses (una sola alta: SIEE)
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

  // ── LATINOAMÉRICA — países SIN régimen de servicios digitales ──
  //
  // Bolivia, El Salvador, Guatemala, Honduras y Nicaragua no han creado un régimen que
  // obligue a un proveedor extranjero a registrarse ni a cobrar su impuesto. No hay dónde
  // darse de alta ni qué enterar, así que el checkout suma CERO.
  //
  // ⚠️ El impuesto puede EXISTIR como "importación de servicios" a cargo del COMPRADOR
  // (reverse charge), pero ahí el contribuyente no es Vibra. Para el cobro es indiferente.
  //
  // ⚠️ VIGILAR A MANO: son los rezagados de LatAm (Colombia 2018, Chile 2020, Ecuador 2020,
  // Paraguay 2021, Perú 2024 ya lo adoptaron; Bolivia tuvo un proyecto en 2024 sin aprobar).
  // Stripe Tax NO cubre ninguno de los cinco, así que su monitoreo no avisará si cambian.
  // Fuentes: despachos regionales, no autoridades fiscales. Ver impuestos.md.
  BO: noDigitalRegime("IVA", 0.13, "BOB"),   // Bolivia
  SV: noDigitalRegime("IVA", 0.13, "USD"),   // El Salvador
  GT: noDigitalRegime("IVA", 0.12, "GTQ"),   // Guatemala
  HN: noDigitalRegime("ISV", 0.15, "HNL"),   // Honduras
  NI: noDigitalRegime("IVA", 0.15, "NIO"),   // Nicaragua
  // Panamá va en este bloque, pero por un camino distinto: el Anteproyecto de Ley 229 (2019),
  // que habría obligado a las plataformas extranjeras a registrarse, NUNCA se aprobó.
  //
  // Sí existe una retención del 100% del ITBMS sobre servicios de no domiciliados — pero la
  // practica el CLIENTE panameño que paga, no el proveedor. Es una obligación B2B: una empresa
  // panameña que le compre a Vibra retiene y entera. Un consumidor con tarjeta no retiene nada
  // y Vibra no tiene nada que cobrar. (Es lo contrario de AR, donde recauda el banco emisor.)
  //
  // ⚠️ El más probable de moverse de los seis que faltan: la DGI reabrió la evaluación del
  // anteproyecto en 2023 y lleva desde entonces. Ver impuestos.md.
  PA: noDigitalRegime("ITBMS", 0.07, "USD"), // Panamá

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
  // Lo único que impide vender es no poder estar de alta donde el país lo EXIGE.
  // `collectionMode` NO participa: que nadie recaude ("none") es una razón para no cobrar
  // impuesto, no para rechazar la compra.
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
  if (!shouldAddFxFee(country)) return 0;
  // No siempre es el 2%: algunas monedas llevan un ajuste propio (ver el mapa de arriba).
  return fxConversionFeeForCurrency(chargeCurrencyForCountry(country));
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
