// Catálogo de monedas de Vibra.
//
// Puro: sin dependencias de framework ni Firebase, para poder importarse desde
// middleware (edge), servidor y cliente por igual.
//
// Modelo (dLocal): el precio de referencia se guarda en USD (ancla). El comprador
// SIEMPRE paga en la moneda local de su país; se convierte desde el USD al mostrar
// y al cobrar. La liquidación llega en USD (o MXN si el comprador es de México).

/**
 * Monedas de visualización: 15 de LatAm (17 países; Ecuador, El Salvador y Panamá
 * comparten USD) + 7 de la Unión Europea (27 países; 21 de ellos usan EUR) + 3 de
 * Europa no comunitaria (Noruega, Islandia, Bosnia) + 13 de Asia-Pacífico y Medio Oriente
 * + 3 de Oceanía (Guam usa USD; Nueva Caledonia y Polinesia Francesa comparten XPF)
 * + 2 de África (Sudáfrica y Egipto) + CAD (Canadá) + 5 de Europa no comunitaria.
 * Estados Unidos usa USD y Montenegro usa EUR: ninguno trajo moneda nueva.
 * Total: 78 monedas para 147 jurisdicciones.
 *
 * ⚠️ Que una moneda esté aquí NO habilita vender en ese país. El permiso de venta
 * lo decide COUNTRY_TAX_CONFIG (lib/tax/config.ts), que es una capa aparte y exige
 * alta fiscal en el país. Ver impuestos.md.
 *
 * ⚠️ Esta lista está DUPLICADA a mano en backend/src/exchangeRates.ts. Si agregas
 * una moneda aquí y no allá, la tarea diaria de tasas no la trae y su precio sale
 * en null (buyerPrice devuelve null sin tasa).
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
  // --- Unión Europea ---
  "EUR", // 21 de los 27: AT BE BG HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES
  "CZK", // Chequia
  "DKK", // Dinamarca
  "HUF", // Hungría
  "PLN", // Polonia
  "RON", // Rumania
  "SEK", // Suecia
  // --- Europa NO comunitaria (con umbral: se vende sin alta hasta cruzarlo) ---
  "NOK", // Noruega
  "ISK", // Islandia
  "BAM", // Bosnia y Herzegovina
  // --- Asia-Pacífico y Medio Oriente ---
  "JPY", // Japón
  "SGD", // Singapur
  "AUD", // Australia
  "NZD", // Nueva Zelanda
  "HKD", // Hong Kong
  "TWD", // Taiwán
  "THB", // Tailandia
  "MYR", // Malasia
  "PHP", // Filipinas
  "IDR", // Indonesia
  "QAR", // Qatar
  "KWD", // Kuwait
  "JOD", // Jordania
  // --- Oceanía ---
  "PGK", // Papúa Nueva Guinea
  "XPF", // Nueva Caledonia (y Polinesia Francesa, cuando se habilite)
  "FJD", // Fiyi
  // --- África ---
  "ZAR", // Sudáfrica
  "EGP", // Egipto
  // --- Norteamérica (además de MXN) ---
  "CAD", // Canadá
  // --- Europa NO comunitaria (2ª tanda) ---
  "GBP", // Reino Unido
  "TRY", // Turquía
  "RSD", // Serbia
  "ALL", // Albania
  "MDL", // Moldavia
  // --- Asia y Golfo (2ª tanda) ---
  "KRW", // Corea del Sur
  "VND", // Vietnam
  "AED", // Emiratos Árabes Unidos
  "SAR", // Arabia Saudita
  // --- África (2ª tanda) ---
  "NGN", // Nigeria
  "MAD", // Marruecos
  // --- Microestados del Pacífico ---
  "TOP", // Tonga
  "SBD", // Islas Salomón
  "VUV", // Vanuatu
  "WST", // Samoa
  // --- Caribe ---
  "SRD", // Surinam
  "BZD", // Belice
  "TTD", // Trinidad y Tobago
  "JMD", // Jamaica
  "KYD", // Islas Caimán
  "BMD", // Bermudas
  "XCD", // Caribe oriental (Granada y vecinos)
  "HTG", // Haití
  "GIP", // Gibraltar
  "AZN", // Azerbaiyán
  // --- Asia (3ª tanda) ---
  "LKR", // Sri Lanka
  "KHR", // Camboya
  "NPR", // Nepal
  "BTN", // Bután
  "BND", // Brunéi
  "MNT", // Mongolia
  "MVR", // Maldivas
  // --- África (3ª tanda) ---
  "BWP", // Botsuana
  "XOF", // Franco CFA de África Occidental (Costa de Marfil y vecinos)
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
 * USD desde el corte a Vibra On, LLC (2026-08-18). ⚠️ Mantener en sync con
 * SETTLEMENT_CURRENCY del backend en backend/src/wallet/ledger.ts.
 *
 * Es el default de `baseCurrency` para los montos del wallet, y coincide con
 * ANCHOR_CURRENCY: con liquidación en dólares el ancla de conversión y la moneda de
 * liquidación son la misma, así que `resolvePresentment` ya no pivota — convierte
 * directo de USD a la moneda del comprador.
 *
 * ⚠️ Cambiar esta constante SIN migrar antes los precios guardados multiplica todo
 * por el tipo de cambio: un servicio de "200" pasaría de 200 pesos a 200 dólares.
 */
export const SETTLEMENT_CURRENCY: DisplayCurrency = "USD";

/**
 * Cargo fijo por transacción que ABSORBE EL COMPRADOR (debe coincidir con
 * FIXED_SERVICE_FEE_USD del backend en backend/src/wallet/ledger.ts). El precio
 * PUBLICADO al comprador = precio base del creador + este cargo; sobre ese total va
 * el impuesto. El creador recibe 75% de su base (este cargo y la comisión son de Vibra).
 *
 * 💵 $0.40 cubre el fijo de Stripe en EE. UU.: $0.30 de procesamiento + $0.05 de Radar.
 * No basta con 0.35 porque Stripe cobra su PORCENTAJE también sobre el fijo que le
 * sumas al cobro, así que el mínimo real es 0.35÷(1−tasa) = 0.361 nacional y 0.370
 * internacional. Con 0.40 quedan cubiertos los dos y sigue siendo un número limpio.
 */
export const FIXED_SERVICE_FEE_USD = 0.4;

/**
 * Cargo por CONVERSIÓN DE MONEDA que absorbe el comprador extranjero. 2%.
 *
 * ⚠️ FUENTE ÚNICA. Antes vivía duplicado y DESALINEADO en dos sitios: `FX_BUFFER` (1.5%)
 * en lib/currency/format.ts para el precio mostrado, y `FX_CONVERSION_FEE` (2%) en
 * tax/config.ts para el cobro real. El comprador extranjero veía un número y se le
 * cobraba otro. Unificado en 2% el 2026-08-07 (es el modelo documentado en impuestos.md §1).
 *
 * NO es impuesto: es costo/comisión, y nunca se declara como impuesto.
 * Se aplica solo cuando la moneda de cobro ≠ la de liquidación (USD).
 *
 * 🚨 SU COMPOSICIÓN CAMBIÓ CON EL CORTE A STRIPE USA (2026-08-18). NO LO BAJES A 1%.
 * Con Stripe México el 2% era exactamente el spread de conversión que cobraba Stripe.
 * Stripe USA cobra 1%, así que hoy el 2% son DOS cosas:
 *     1% → spread de conversión de Stripe
 *     1% → COLCHÓN de deriva entre nuestra tasa cacheada (open.er-api.com, refrescada
 *          a diario) y la que Stripe aplica al liquidar. Cuando la matriz de precios
 *          quede congelada (refresco mensual + banda ±3%), esa deriva crece y este
 *          colchón es lo único que la absorbe.
 * "Corregirlo" a 1% porque «Stripe solo cobra 1%» deja la deriva saliendo del margen.
 * Decisión de Luis, 2026-08-18.
 *
 * ⚠️ El backend tiene su propia copia en backend/src/tax/config.ts (no puede importar
 * de lib/). Deben tener el MISMO valor.
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
 * ⚠️ Al agregar una moneda aquí hay que replicarla en backend/src/tax/config.ts (no puede
 *    importar de lib/). Hay un test de paridad que lo vigila.
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
 * Precio MÍNIMO (base, USD) que el creador puede fijar por servicio. Si pone menos,
 * se muestra aviso rojo y no se puede publicar. Donación: mínimo por cada monto sugerido.
 *
 * 💵 Números redondos en dólares, NO la conversión mecánica de los mínimos viejos en
 * pesos: un mínimo de "$2.94" no es un mínimo que alguien escribiría.
 */
export const SERVICE_MIN_PRICE_USD: Record<string, number> = {
  saludo: 3,
  consejo: 3,
  clase_personalizada: 9, // sesión exclusiva
  meet_greet_digital: 9, // tiempo contigo
};
export const DONATION_MIN_AMOUNT_USD = 3;
/** Precio MÍNIMO (base, USD) de un POST premium / VOD premium. Por debajo → aviso rojo. */
export const PREMIUM_MIN_PRICE_USD = 1.5;
/** Precio MÍNIMO (base, USD) del TICKET de acceso a un en vivo. Por debajo → aviso rojo. */
export const LIVE_TICKET_MIN_PRICE_USD = 1.5;
/** Precio MÍNIMO (base, USD) por tier de SÚPER COMENTARIO. Por debajo → aviso rojo. */
export const SUPER_COMMENT_MIN_PRICE_USD = 1.5;
/** Precio MÍNIMO (base, USD) de la SUSCRIPCIÓN mensual de comunidad. Por debajo → aviso rojo. */
export const SUBSCRIPTION_MIN_PRICE_USD = 1.5;

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
 * Los 17 de LatAm (Ecuador, El Salvador y Panamá → USD) + los 27 de la UE.
 *
 * ⚠️ Estar en este mapa solo define EN QUÉ MONEDA SE MUESTRA el precio a quien
 * navega desde ese país. No habilita el cobro: eso lo decide COUNTRY_TAX_CONFIG.
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

  // --- Unión Europea (27) ---
  // Zona euro (21). Bulgaria adoptó el euro el 1-ene-2026: ya no usa BGN.
  AT: "EUR", // Austria
  BE: "EUR", // Bélgica
  BG: "EUR", // Bulgaria
  HR: "EUR", // Croacia
  CY: "EUR", // Chipre
  EE: "EUR", // Estonia
  FI: "EUR", // Finlandia
  FR: "EUR", // Francia
  DE: "EUR", // Alemania
  GR: "EUR", // Grecia
  IE: "EUR", // Irlanda
  IT: "EUR", // Italia
  LV: "EUR", // Letonia
  LT: "EUR", // Lituania
  LU: "EUR", // Luxemburgo
  MT: "EUR", // Malta
  NL: "EUR", // Países Bajos
  PT: "EUR", // Portugal
  SK: "EUR", // Eslovaquia
  SI: "EUR", // Eslovenia
  ES: "EUR", // España
  // Fuera de la zona euro (6).
  CZ: "CZK", // Chequia
  DK: "DKK", // Dinamarca
  HU: "HUF", // Hungría
  PL: "PLN", // Polonia
  RO: "RON", // Rumania
  SE: "SEK", // Suecia
  // Europa NO comunitaria (3). El OSS no las cubre: cada una es trámite aparte.
  NO: "NOK", // Noruega
  IS: "ISK", // Islandia
  BA: "BAM", // Bosnia y Herzegovina
  // Asia-Pacífico y Medio Oriente (13).
  JP: "JPY", // Japón
  SG: "SGD", // Singapur
  AU: "AUD", // Australia
  NZ: "NZD", // Nueva Zelanda
  HK: "HKD", // Hong Kong
  TW: "TWD", // Taiwán
  TH: "THB", // Tailandia
  MY: "MYR", // Malasia
  PH: "PHP", // Filipinas
  ID: "IDR", // Indonesia
  QA: "QAR", // Qatar
  KW: "KWD", // Kuwait
  JO: "JOD", // Jordania
  // Oceanía (4). Australia y Nueva Zelanda ya están arriba, con Asia-Pacífico.
  GU: "USD", // Guam — territorio de EE. UU., usa el dólar
  PG: "PGK", // Papúa Nueva Guinea
  NC: "XPF", // Nueva Caledonia
  FJ: "FJD", // Fiyi
  // África (2).
  ZA: "ZAR", // Sudáfrica
  EG: "EGP", // Egipto
  // Norteamérica.
  US: "USD", // Estados Unidos
  CA: "CAD", // Canadá
  // Europa NO comunitaria (2ª tanda).
  GB: "GBP", // Reino Unido
  TR: "TRY", // Turquía
  RS: "RSD", // Serbia
  AL: "ALL", // Albania
  MD: "MDL", // Moldavia
  // Asia y Golfo (2ª tanda).
  KR: "KRW", // Corea del Sur
  VN: "VND", // Vietnam
  AE: "AED", // Emiratos Árabes Unidos
  SA: "SAR", // Arabia Saudita
  // África (2ª tanda).
  NG: "NGN", // Nigeria
  MA: "MAD", // Marruecos
  // Microestados del Pacífico (13). La mayoría reutiliza monedas que ya estaban.
  TO: "TOP", // Tonga
  SB: "SBD", // Islas Salomón
  VU: "VUV", // Vanuatu
  WS: "WST", // Samoa
  KI: "AUD", // Kiribati
  NR: "AUD", // Nauru
  TV: "AUD", // Tuvalu
  NU: "NZD", // Niue
  WF: "XPF", // Wallis y Futuna
  FM: "USD", // Micronesia
  MH: "USD", // Islas Marshall
  AS: "USD", // Samoa Americana
  MP: "USD", // Marianas del Norte
  // Caribe (9).
  SR: "SRD", // Surinam
  BZ: "BZD", // Belice
  TT: "TTD", // Trinidad y Tobago
  JM: "JMD", // Jamaica
  GD: "XCD", // Granada
  KY: "KYD", // Islas Caimán
  BM: "BMD", // Bermudas
  TC: "USD", // Turcas y Caicos
  VG: "USD", // Islas Vírgenes Británicas
  // Caribe y territorios americanos (13). Solo Haití trajo moneda nueva.
  PR: "USD", // Puerto Rico
  VI: "USD", // Islas Vírgenes de EE. UU.
  BQ: "USD", // Bonaire
  HT: "HTG", // Haití
  GL: "DKK", // Groenlandia
  PM: "EUR", // San Pedro y Miquelón
  LC: "XCD", // Santa Lucía
  VC: "XCD", // San Vicente y las Granadinas
  AG: "XCD", // Antigua y Barbuda
  KN: "XCD", // San Cristóbal y Nieves
  DM: "XCD", // Dominica
  AI: "XCD", // Anguila
  MS: "XCD", // Montserrat
  // Microestados y territorios europeos (9). Solo Gibraltar trajo moneda nueva.
  MC: "EUR", // Mónaco — territorio IVA francés
  AD: "EUR", // Andorra
  SM: "EUR", // San Marino
  VA: "EUR", // Ciudad del Vaticano
  GI: "GIP", // Gibraltar
  GG: "GBP", // Guernsey
  JE: "GBP", // Jersey
  FO: "DKK", // Islas Feroe
  SJ: "NOK", // Svalbard y Jan Mayen
  AZ: "AZN", // Azerbaiyán
  // Asia (3ª tanda).
  LK: "LKR", // Sri Lanka
  KH: "KHR", // Camboya
  NP: "NPR", // Nepal
  BT: "BTN", // Bután
  BN: "BND", // Brunéi
  MN: "MNT", // Mongolia
  MV: "MVR", // Maldivas
  // África (3ª tanda).
  BW: "BWP", // Botsuana
  CI: "XOF", // Costa de Marfil
  // Territorios de Oceanía (5). Ninguno trae moneda nueva.
  NF: "AUD", // Isla Norfolk
  CX: "AUD", // Isla de Navidad
  CC: "AUD", // Islas Cocos
  TK: "NZD", // Tokelau
  PN: "NZD", // Islas Pitcairn
  // Territorios franceses de ultramar FUERA del IVA de la UE. Tienen código ISO propio,
  // así que la geolocalización por IP los distingue de Francia. Ver D-22.
  GF: "EUR", // Guayana Francesa
  YT: "EUR", // Mayotte
  GP: "EUR", // Guadalupe
  MQ: "EUR", // Martinica
  RE: "EUR", // Reunión
  IC: "EUR", // Canarias — se alcanza por corrección de subdivisión (ES-CN)
  EA: "EUR", // Ceuta y Melilla — íd. (ES-CE, ES-ML)
  ME: "EUR", // Montenegro — usa el euro pero NO es UE: registro fiscal aparte, sin OSS
  PF: "XPF", // Polinesia Francesa — moneda lista; la VENTA sigue bloqueada (umbral cero)
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
