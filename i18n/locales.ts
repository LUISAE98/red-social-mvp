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
  { code: "bg", label: "BG", name: "Български", intl: "bg-BG", ready: true },
  { code: "cs", label: "CS", name: "Čeština", intl: "cs-CZ", ready: true },
  { code: "da", label: "DA", name: "Dansk", intl: "da-DK", ready: true },
  { code: "de", label: "DE", name: "Deutsch", intl: "de-DE", ready: true },
  { code: "el", label: "EL", name: "Ελληνικά", intl: "el-GR", ready: true },
  { code: "en", label: "EN", name: "English", intl: "en-US", ready: true },
  { code: "es", label: "ES", name: "Español", intl: "es-MX", ready: true },
  { code: "et", label: "ET", name: "Eesti", intl: "et-EE", ready: true },
  { code: "fi", label: "FI", name: "Suomi", intl: "fi-FI", ready: true },
  { code: "fr", label: "FR", name: "Français", intl: "fr-FR", ready: true },
  { code: "ga", label: "GA", name: "Gaeilge", intl: "ga-IE", ready: true },
  { code: "hr", label: "HR", name: "Hrvatski", intl: "hr-HR", ready: true },
  { code: "hu", label: "HU", name: "Magyar", intl: "hu-HU", ready: true },
  { code: "id", label: "ID", name: "Bahasa Indonesia", intl: "id-ID", ready: true },
  { code: "it", label: "IT", name: "Italiano", intl: "it-IT", ready: true },
  // Primer idioma FUERA de la UE. Japón no está en EU_COUNTRY_TO_LOCALE: lo mapea
  // NON_EU_COUNTRY_TO_LOCALE, más abajo.
  { code: "ja", label: "JA", name: "日本語", intl: "ja-JP", ready: true },
  { code: "lt", label: "LT", name: "Lietuvių", intl: "lt-LT", ready: true },
  { code: "lv", label: "LV", name: "Latviešu", intl: "lv-LV", ready: true },
  { code: "ms", label: "MS", name: "Bahasa Melayu", intl: "ms-MY", ready: true },
  { code: "mt", label: "MT", name: "Malti", intl: "mt-MT", ready: true },
  { code: "nl", label: "NL", name: "Nederlands", intl: "nl-NL", ready: true },
  { code: "pl", label: "PL", name: "Polski", intl: "pl-PL", ready: true },
  // Las dos variantes del portugués comparten idioma pero NO etiqueta: `label` es el chip
  // del selector cerrado y muestra el locale ACTIVO. Con "PT" en ambas, el usuario no
  // podría distinguir cuál tiene puesta. "BR" / "PT" es lo convencional y sigue en 2 letras.
  { code: "pt-BR", label: "BR", name: "Português (Brasil)", intl: "pt-BR", ready: true },
  { code: "pt-PT", label: "PT", name: "Português (Portugal)", intl: "pt-PT", ready: true },
  { code: "ro", label: "RO", name: "Română", intl: "ro-RO", ready: true },
  { code: "sk", label: "SK", name: "Slovenčina", intl: "sk-SK", ready: true },
  { code: "sl", label: "SL", name: "Slovenščina", intl: "sl-SI", ready: true },
  { code: "sv", label: "SV", name: "Svenska", intl: "sv-SE", ready: true },
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
export const READY_LOCALES = ["es", "en", "pt-BR", "de", "fr", "it", "nl", "pl", "ro", "el", "cs", "hu", "sv", "pt-PT", "da", "fi", "sk", "bg", "hr", "lt", "sl", "lv", "et", "ga", "mt", "ja", "zh-TW", "id", "ms"] as const;

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
 * Solo se listan países cuyo idioma YA está servido. El resto (Noruega, Tailandia,
 * los países árabes…) sigue cayendo a inglés, que es el comportamiento por defecto.
 */
export const NON_EU_COUNTRY_TO_LOCALE: Readonly<Record<string, string>> = {
  JP: "ja", // Japón
  TW: "zh-TW", // Taiwán
  ID: "id", // Indonesia
  MY: "ms", // Malasia
};
