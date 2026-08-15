// Fuente única de verdad de los idiomas de Vibra.
//
// Antes esta lista estaba duplicada a mano en 6 sitios (routing, LanguageSwitcher,
// localeFromCountry, FORMAT_LOCALE, NotificationList y dos sets del backend). Cada
// idioma nuevo exigía tocarlos todos y el que se olvidara fallaba EN SILENCIO.
// Ahora todo el frontend deriva de aquí.
//
// Cobertura: los 24 idiomas OFICIALES de la Unión Europea + pt-BR (Brasil).
//
// ⚠️ `ready` es la bandera de despliegue: un idioma solo se sirve cuando su archivo
// messages/{code}.json existe y está completo. Mientras esté en false, el país que
// lo tendría cae al fallback en inglés (que siempre funciona). Encender un idioma
// sin su archivo rompe la app para ese locale: el import dinámico de i18n/request.ts
// no lo encuentra. El test test/unit/i18n.test.ts lo impide.

export type LocaleMeta = {
  /** Código del locale = nombre del archivo en messages/. */
  code: string;
  /** Etiqueta corta del selector (2 letras, mayúsculas). */
  label: string;
  /** Nombre del idioma EN ese idioma (nunca traducido). */
  name: string;
  /**
   * Locale BCP-47 para Intl (fechas, monedas, tiempo relativo). Casi siempre igual
   * al code; se separa porque "pt-BR" ya existe y porque los genéricos de 2 letras
   * a veces formatean distinto al esperado (ver FORMAT_LOCALE en lib/currency).
   */
  intl: string;
  /** ¿Tiene su archivo messages/{code}.json completo? */
  ready: boolean;
};

/**
 * Los 24 oficiales de la UE + pt-BR. Orden alfabético por código.
 * `es`, `en` y `pt-BR` son los que ya existían.
 */
export const LOCALE_META: readonly LocaleMeta[] = [
  // ⚠️ ÚNICO locale RTL de momento. Ver RTL_LOCALES y localeDir al final del
  // archivo: la dirección NO se deduce del código, sale de una tabla explícita.
  // 6 categorías de plural (zero/one/two/few/many/other), el máximo de CLDR.
  { code: "ar", label: "AR", name: "العربية", intl: "ar", ready: true },
  // Aglutinante con armonía vocálica como el turco y emparentado con él, pero NO
  // mutuamente inteligible: se escribió aparte. Alfabeto latino (Azerbaiyán lo usa
  // desde 1991) y con la letra ə, que el turco no tiene.
  { code: "az", label: "AZ", name: "Azərbaycan dili", intl: "az-AZ", ready: true },
  { code: "bg", label: "BG", name: "Български", intl: "bg-BG", ready: true },
  // Mutuamente inteligible con el croata, pero NO es croata: se derivó de `hr` y se
  // corrigieron los croatismos (link, nivo, sedmica, meses latinos, ko/niko/svako).
  { code: "bs", label: "BS", name: "Bosanski", intl: "bs-BA", ready: true },
  // Andorra. NO se deriva del español: son lenguas distintas, no variantes.
  { code: "ca", label: "CA", name: "Català", intl: "ca-ES", ready: true },
  { code: "cs", label: "CS", name: "Čeština", intl: "cs-CZ", ready: true },
  { code: "da", label: "DA", name: "Dansk", intl: "da-DK", ready: true },
  { code: "de", label: "DE", name: "Deutsch", intl: "de-DE", ready: true },
  // Escritura thaana y RTL, como el árabe. Maldivas.
  { code: "dv", label: "DV", name: "ދިވެހި", intl: "dv", ready: true },
  { code: "el", label: "EL", name: "Ελληνικά", intl: "el-GR", ready: true },
  { code: "en", label: "EN", name: "English", intl: "en-US", ready: true },
  { code: "es", label: "ES", name: "Español", intl: "es-MX", ready: true },
  { code: "et", label: "ET", name: "Eesti", intl: "et-EE", ready: true },
  // Alfabeto latino y plurales one/other. En Filipinas el inglés es cooficial y de
  // uso corriente, así que este idioma es una mejora, no un rescate.
  { code: "fil", label: "FIL", name: "Filipino", intl: "fil", ready: true },
  { code: "fi", label: "FI", name: "Suomi", intl: "fi-FI", ready: true },
  { code: "fr", label: "FR", name: "Français", intl: "fr-FR", ready: true },
  { code: "ga", label: "GA", name: "Gaeilge", intl: "ga-IE", ready: true },
  { code: "hr", label: "HR", name: "Hrvatski", intl: "hr-HR", ready: true },
  { code: "hu", label: "HU", name: "Magyar", intl: "hu-HU", ready: true },
  { code: "id", label: "ID", name: "Bahasa Indonesia", intl: "id-ID", ready: true },
  // Íslenska: sin pariente cercano entre los locales servidos (el danés y el noruego
  // son nórdicos, pero el islandés no es mutuamente inteligible con ellos), así que
  // está escrito, no derivado. Plurales one/other.
  { code: "is", label: "IS", name: "Íslenska", intl: "is-IS", ready: true },
  { code: "it", label: "IT", name: "Italiano", intl: "it-IT", ready: true },
  // Primer idioma FUERA de la UE. Japón no está en EU_COUNTRY_TO_LOCALE: lo mapea
  // NON_EU_COUNTRY_TO_LOCALE, más abajo.
  { code: "ja", label: "JA", name: "日本語", intl: "ja-JP", ready: true },
  // Sin plural gramatical (solo `other`) y con contadores como el japonés: 명 para
  // personas, 장 para tickets, 개 para cosas. Va pegado al número, no al sustantivo.
  // Jemer. Única categoría de plural ("other"), como el japonés: las ramas
  // plurales son de una sola forma, pero el # sigue haciendo falta.
  { code: "km", label: "KM", name: "ខ្មែរ", intl: "km", ready: true },
  { code: "ko", label: "KO", name: "한국어", intl: "ko-KR", ready: true },
  { code: "lt", label: "LT", name: "Lietuvių", intl: "lt-LT", ready: true },
  { code: "lv", label: "LV", name: "Latviešu", intl: "lv-LV", ready: true },
  // Cirílico mongol (no la escritura tradicional vertical, que Intl no soporta).
  { code: "mn", label: "MN", name: "Монгол", intl: "mn", ready: true },
  { code: "ms", label: "MS", name: "Bahasa Melayu", intl: "ms-MY", ready: true },
  { code: "mt", label: "MT", name: "Malti", intl: "mt-MT", ready: true },
  // Bokmål, no nynorsk: es la variante escrita de ~85–90 % de los noruegos y la
  // que usa el software. Se derivó de `da`, que es su pariente escrito directo.
  { code: "nb", label: "NB", name: "Norsk bokmål", intl: "nb-NO", ready: true },
  // Devanágari. Nepal; el inglés circula allí, así que esto mejora el fallback.
  { code: "ne", label: "NE", name: "नेपाली", intl: "ne", ready: true },
  { code: "nl", label: "NL", name: "Nederlands", intl: "nl-NL", ready: true },
  { code: "pl", label: "PL", name: "Polski", intl: "pl-PL", ready: true },
  // Las dos variantes del portugués comparten idioma pero NO etiqueta: `label` es el chip
  // del selector cerrado y muestra el locale ACTIVO. Con "PT" en ambas, el usuario no
  // podría distinguir cuál tiene puesta. "BR" / "PT" es lo convencional y sigue en 2 letras.
  { code: "pt-BR", label: "BR", name: "Português (Brasil)", intl: "pt-BR", ready: true },
  { code: "pt-PT", label: "PT", name: "Português (Portugal)", intl: "pt-PT", ready: true },
  { code: "ro", label: "RO", name: "Română", intl: "ro-RO", ready: true },
  // Escritura singalesa. Sri Lanka; el inglés es lengua de enlace allí, así que
  // esto es una mejora sobre el fallback, no un rescate.
  { code: "si", label: "SI", name: "සිංහල", intl: "si", ready: true },
  { code: "sk", label: "SK", name: "Slovenčina", intl: "sk-SK", ready: true },
  { code: "sl", label: "SL", name: "Slovenščina", intl: "sl-SI", ready: true },
  // Sin pariente en el repertorio: no se deriva de nadie, está escrito.
  { code: "sq", label: "SQ", name: "Shqip", intl: "sq-AL", ready: true },
  // EKAVO (vreme, mesec) frente al ijekavo del bosnio, y futuro sintético
  // (Pojaviće se, no Pojavit će se). Se derivó de `bs` con una lista CERRADA de
  // raíces con yat: un `je → e` a ciegas se comería `nije`, `jedan` y todos los
  // sustantivos en -nje sin dar un solo error. Alfabeto latino, no cirílico.
  { code: "sr", label: "SR", name: "Srpski", intl: "sr-Latn-RS", ready: true },
  { code: "sv", label: "SV", name: "Svenska", intl: "sv-SE", ready: true },
  // El tailandés no tiene plural gramatical: TODOS sus `plural` son `other`-only.
  // No es una traducción incompleta; es lo que dice CLDR para `th`.
  { code: "th", label: "TH", name: "ไทย", intl: "th-TH", ready: true },
  // Aglutinante con armonía vocálica: los sufijos de caso NO se pueden pegar a un
  // placeholder porque su vocal depende de la palabra que los precede. Por eso los
  // mensajes con {name} llevan detrás una palabra fija ("{name} adlı kişiye").
  { code: "tr", label: "TR", name: "Türkçe", intl: "tr-TR", ready: true },
  // Sin plural gramatical y con clasificadores, como el tailandés. ⚠️ Vietnam cobra
  // al 7 % por el CIT vietnamita, no al tipo global de FX: ver COUNTRY_TAX_CONFIG.
  { code: "vi", label: "VI", name: "Tiếng Việt", intl: "vi-VN", ready: true },
  // Taiwán usa caracteres TRADICIONALES y vocabulario propio (影片 no 视频,
  // 網路 no 网络, 貼文 no 帖子). Por eso es `zh-TW` y no un `zh` genérico:
  // deja sitio a un `zh-CN` simplificado si algún día entra China continental.
  { code: "zh-TW", label: "TW", name: "繁體中文", intl: "zh-TW", ready: true },
];

/**
 * Locales SERVIDOS hoy. Tupla literal a propósito: de ella sale el tipo `Locale`,
 * y derivarla con .filter() lo degradaría a `string` y perdería el chequeo de tipos
 * en toda la app. Al terminar el archivo de un idioma: pon su `ready: true` arriba
 * Y agrégalo a esta tupla. El test de i18n verifica que ambas listas coincidan.
 */
export const READY_LOCALES = ["es", "en", "pt-BR", "de", "fr", "it", "nl", "pl", "ro", "el", "cs", "hu", "sv", "pt-PT", "da", "fi", "sk", "bg", "hr", "lt", "sl", "lv", "et", "ga", "mt", "ja", "zh-TW", "id", "ms", "th", "bs", "nb", "is", "tr", "ko", "vi", "sr", "sq", "az", "ca", "ar", "fil", "mn", "si", "km", "ne", "dv"] as const;

export type Locale = (typeof READY_LOCALES)[number];

const META_BY_CODE = new Map(LOCALE_META.map((m) => [m.code, m]));
const READY_SET: ReadonlySet<string> = new Set(READY_LOCALES);

/**
 * Respaldo por PARENTESCO de idioma, para cuando el locale ideal aún no está listo.
 * Mejor un portugués de Brasil que un inglés: se entiende. Solo se listan parejas
 * mutuamente inteligibles; sin entrada aquí, el respaldo es el inglés.
 */
const LOCALE_FALLBACK: Readonly<Record<string, string>> = {
  "pt-PT": "pt-BR",
  "pt-BR": "pt-PT",
};

export function localeMeta(code: string): LocaleMeta | undefined {
  return META_BY_CODE.get(code);
}

export function isReadyLocale(code: string | null | undefined): code is Locale {
  return !!code && READY_SET.has(code);
}

/**
 * El locale servible más cercano a `code`: él mismo si está listo, si no su pariente,
 * y si tampoco, null (quien llama decide el defaultLocale). Es lo que evita que un
 * idioma a medio hacer degrade a un usuario que hoy sí tiene traducción.
 */
export function nearestReadyLocale(code: string | null | undefined): Locale | null {
  if (!code) return null;
  if (isReadyLocale(code)) return code;
  const alt = LOCALE_FALLBACK[code];
  return isReadyLocale(alt) ? alt : null;
}

/** Metadatos de los locales servidos, en el orden de READY_LOCALES. */
export function readyLocaleMeta(): LocaleMeta[] {
  return READY_LOCALES.map((c) => META_BY_CODE.get(c)!).filter(Boolean);
}

/** Locale BCP-47 para Intl. Fallback al propio código si es desconocido. */
export function intlLocale(code: string): string {
  return META_BY_CODE.get(code)?.intl ?? code;
}

/**
 * Pone en mayúscula la PRIMERA letra y deja el resto igual.
 *
 * No es `text-transform: capitalize`, que pone en mayúscula cada palabra: eso
 * convertiría "người theo dõi" en "Người Theo Dõi", que en vietnamita se lee
 * mal. Y no es `toUpperCase()` a secas, que en turco convierte la i en I y no en
 * İ — de ahí el `toLocaleUpperCase` con el idioma en la mano.
 *
 * Los idiomas sin mayúsculas (japonés, árabe, tailandés…) devuelven el mismo
 * carácter, así que llamarlo siempre no hace daño.
 */
export function capitalizeFirst(text: string, locale: string): string {
  if (!text) return text;
  const chars = Array.from(text);
  return chars[0].toLocaleUpperCase(intlLocale(locale)) + chars.slice(1).join("");
}

/**
 * País de la UE (ISO-3166 alpha-2) → su idioma principal.
 *
 * Un país = un idioma, porque la geo-IP solo da país. En los multilingües se elige
 * el de mayor población y el usuario puede cambiarlo en el selector (la elección se
 * guarda en cookie y nunca se sobrescribe):
 *   BE → nl (neerlandés ~60% vs francés ~40%)
 *   LU → fr (lengua administrativa; también de y lb)
 *   CY → el   ·   IE → en (no ga)   ·   MT → mt   ·   FI → fi (no sv)
 */
export const EU_COUNTRY_TO_LOCALE: Readonly<Record<string, string>> = {
  AT: "de", // Austria
  BE: "nl", // Bélgica
  BG: "bg", // Bulgaria
  HR: "hr", // Croacia
  CY: "el", // Chipre
  CZ: "cs", // Chequia
  DK: "da", // Dinamarca
  EE: "et", // Estonia
  FI: "fi", // Finlandia
  FR: "fr", // Francia
  DE: "de", // Alemania
  GR: "el", // Grecia
  HU: "hu", // Hungría
  IE: "en", // Irlanda
  IT: "it", // Italia
  LV: "lv", // Letonia
  LT: "lt", // Lituania
  LU: "fr", // Luxemburgo
  MT: "mt", // Malta
  NL: "nl", // Países Bajos
  PL: "pl", // Polonia
  PT: "pt-PT", // Portugal (pt-PT, NO pt-BR: son variantes distintas)
  RO: "ro", // Rumania
  SK: "sk", // Eslovaquia
  SI: "sl", // Eslovenia
  ES: "es", // España
  SE: "sv", // Suecia
};

/**
 * Países FUERA de la UE con idioma propio en Vibra.
 *
 * Va aparte de `EU_COUNTRY_TO_LOCALE` a propósito: ese mapa tiene exactamente los 27
 * de la Unión y hay un test que lo comprueba. Meter Japón ahí rompería esa garantía
 * y, peor, haría que un mapa llamado "EU" dejara de significar lo que dice.
 *
 * Solo se listan países cuyo idioma YA está servido. El resto (los países árabes,
 * Turquía, Corea…) sigue cayendo a inglés, que es el comportamiento por defecto.
 */
export const NON_EU_COUNTRY_TO_LOCALE: Readonly<Record<string, string>> = {
  JP: "ja", // Japón
  TW: "zh-TW", // Taiwán
  ID: "id", // Indonesia
  MY: "ms", // Malasia
  TH: "th", // Tailandia
  BA: "bs", // Bosnia y Herzegovina
  TR: "tr", // Turquía
  KR: "ko", // Corea del Sur
  VN: "vi", // Vietnam
  RS: "sr", // Serbia
  AL: "sq", // Albania
  AZ: "az", // Azerbaiyán

  // Árabe. Siete países, todos fuera de la UE.
  SA: "ar", // Arabia Saudita
  AE: "ar", // Emiratos Árabes Unidos
  QA: "ar", // Catar
  KW: "ar", // Kuwait
  JO: "ar", // Jordania
  EG: "ar", // Egipto
  KH: "km", // Camboya
  LK: "si", // Sri Lanka
  MN: "mn", // Mongolia
  MV: "dv", // Maldivas
  NP: "ne", // Nepal
  PH: "fil", // Filipinas — inglés cooficial, pero el filipino es el idioma nacional
  MA: "ar", // Marruecos — el francés también es de uso corriente, pero el árabe es el oficial
  AD: "ca", // Andorra — el catalán es la única lengua oficial del país
  NO: "nb", // Noruega
  IS: "is", // Islandia

  // ─── Reutilizaciones ───────────────────────────────────────────────────────
  // De aquí abajo, NINGUNA entrada trajo traducción nueva: todas apuntan a un
  // idioma que ya servíamos y que a ese país no le llegaba. Estaban viendo la
  // app en inglés sin motivo, y el síntoma no se nota porque "inglés" parece un
  // resultado normal, no un fallo. Por eso hay un test que las fija una a una.
  MD: "ro", // Moldavia — rumano (el moldavo es la misma lengua; así lo reconoce el país desde 2023)
  ME: "bs", // Montenegro — ijekavo y meses latinos, igual que el bosnio
  HK: "zh-TW", // Hong Kong — chino TRADICIONAL, el mismo que Taiwán
  // ⚠️ Serbia (RS) NO va aquí aunque sea vecina de Montenegro: el serbio es EKAVO
  // (`vreme`, no `vrijeme`) y se escribe a menudo en cirílico. Darle `bs` se notaría.

  // Español. Códigos ISO reservados aparte de ES: no los cubre el mapa de la UE.
  IC: "es", // Canarias
  EA: "es", // Ceuta y Melilla

  // Italiano. Dos microestados rodeados por Italia, ninguno en la UE.
  VA: "it", // Ciudad del Vaticano
  SM: "it", // San Marino

  // Francés. Los cinco RUP (GP, MQ, GF, YT, RE) sí son territorio de la UE, pero
  // tienen código ISO propio y no "FR", así que el mapa de los 27 no los alcanza.
  GP: "fr", // Guadalupe
  MQ: "fr", // Martinica
  GF: "fr", // Guayana Francesa
  YT: "fr", // Mayotte
  RE: "fr", // Reunión
  PM: "fr", // San Pedro y Miquelón — PTU, no RUP
  PF: "fr", // Polinesia Francesa
  WF: "fr", // Wallis y Futuna
  NC: "fr", // Nueva Caledonia — colectividad francesa, pero NO está en la UE: es un PTU
  MC: "fr", // Mónaco
  CI: "fr", // Costa de Marfil
  HT: "fr", // Haití — el criollo haitiano es cooficial y mayoritario, pero no lo servimos

  // Neerlandés.
  BQ: "nl", // Caribe Neerlandés (Bonaire, San Eustaquio y Saba)
  SR: "nl", // Surinam — ⚠️ el ISO de Surinam es "SR", que NO es el locale serbio "sr"

  // Nórdicos.
  SJ: "nb", // Svalbard y Jan Mayen
  // Groenlandia y las Feroe: su lengua propia es el groenlandés y el feroés, y no
  // servimos ninguna de las dos. El danés es la mejor aproximación que tenemos —
  // cooficial en las Feroe y lengua escolar obligatoria en ambas—, así que se
  // entiende mejor que el inglés. Estuvieron en inglés hasta 2026-08-12.
  GL: "da", // Groenlandia — groenlandés oficial
  FO: "da", // Islas Feroe — feroés oficial

  // Malayo.
  BN: "ms", // Brunéi

  // ─── Inglés DELIBERADO ─────────────────────────────────────────────────────
  // El inglés ya es el respaldo por defecto, así que estas entradas no cambian
  // nada en tiempo de ejecución. Existen para dejar constancia de que en estos
  // países se REVISÓ el idioma y se decidió el inglés, en vez de que les llegue
  // por descarte igual que a un país que se nos olvidó mapear. Sin ellas, un
  // hueco real y una decisión tomada son indistinguibles desde el código.
  //
  // En los cuatro del Pacífico el inglés es lengua oficial del Estado; la lengua
  // propia (samoano, tongano, bislama, tuvaluano) no la servimos.
  WS: "en", // Samoa — samoano cooficial
  TO: "en", // Tonga — tongano cooficial
  VU: "en", // Vanuatu — bislama y francés cooficiales
  TV: "en", // Tuvalu — tuvaluano cooficial
  // Bután. Su lengua es el dzongkha y NO lo servimos a propósito: el inglés es
  // allí lengua de gobierno y el medio de enseñanza en la escuela, así que una
  // traducción sin hablante nativo que la revise —en pantallas de dinero— sería
  // peor que el respaldo. Decisión de Luis, 2026-08-12.
  BT: "en", // Bután — dzongkha oficial
};

/**
 * Locales que se escriben de DERECHA A IZQUIERDA.
 *
 * Fuente única de la dirección del documento. El `dir` del `<html>` sale de aquí
 * (ver app/layout.tsx) y NO se deduce del locale con una heurística: no hay forma
 * de saber la dirección de un código de idioma sin una tabla, y adivinarla mal
 * rompe el renderizado del texto entero, no solo la maquetación.
 *
 * ⚠️ `dir="rtl"` NO refleja la interfaz por sí solo. Lo que arregla es la capa de
 * TEXTO —orden de los caracteres, posición de los signos de puntuación, dirección
 * de escritura en los inputs, alineación por defecto— y eso hay que activarlo sí
 * o sí: sin ello el árabe se lee mal a nivel de carácter, que es mucho peor que
 * una maquetación sin espejar. El espejado visual de la interfaz es un trabajo
 * aparte y progresivo (ver docs/rtl-pendiente.md).
 */
export const RTL_LOCALES: ReadonlySet<string> = new Set(["ar", "dv"]);

/** "rtl" si el locale se escribe de derecha a izquierda; "ltr" en cualquier otro caso. */
export function localeDir(locale: string | null | undefined): "rtl" | "ltr" {
  return locale && RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}
