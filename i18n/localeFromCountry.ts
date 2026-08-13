import { routing } from "./routing";
import {
  EU_COUNTRY_TO_LOCALE,
  NON_EU_COUNTRY_TO_LOCALE,
  nearestReadyLocale,
  type Locale,
} from "./locales";

// Países hispanohablantes → español. (España también está en EU_COUNTRY_TO_LOCALE;
// ambos coinciden en "es", así que el orden no importa para ese caso.)
const ES_COUNTRIES = new Set([
  "MX", "ES", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO",
  "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ",
]);

// Países lusófonos → portugués. Portugal NO está aquí: lo resuelve el mapa de la UE
// como pt-PT (con respaldo a pt-BR mientras pt-PT no esté listo).
const PT_COUNTRIES = new Set([
  "BR", "AO", "MZ", "CV", "GW", "ST", "TL",
]);

// Países donde el país NO determina el idioma y el navegador es mejor señal.
//
// Canadá es el caso claro: el inglés y el francés son cooficiales y las dos
// comunidades son grandes (~75 % y ~22 %). Cualquier valor fijo se equivoca con
// millones de personas —forzar inglés deja fuera a Quebec, forzar francés se lo
// impone al resto—, así que aquí se devuelve null a propósito para que decida el
// Accept-Language del navegador, que sí distingue fr-CA de en-CA.
//
// ⚠️ Devolver null NO es lo mismo que devolver "en": con "en" el middleware fija
// la cookie y la cabecera del navegador ya no se mira nunca.
const BROWSER_DECIDES = new Set(["CA"]);

/**
 * Devuelve el locale según el código de país ISO (de la geo por IP).
 *
 * Orden: los países bilingües se delegan al navegador, luego los 27 de la UE por
 * su idioma oficial, luego hispanohablantes, luego lusófonos, y cualquier otro
 * país → inglés.
 *
 * Un idioma de la UE que todavía no tenga su archivo de traducción NO degrada al
 * usuario a un idioma peor por accidente: `nearestReadyLocale` prueba primero el
 * pariente (pt-PT → pt-BR) y solo entonces cae al inglés.
 *
 * Si el país es desconocido (null), devuelve null para dejar que next-intl use su
 * detección normal (cookie / Accept-Language) y, si el idioma del usuario no está
 * en nuestro repertorio, el defaultLocale que es inglés.
 */
export function localeFromCountry(country: string | null | undefined): Locale | null {
  if (!country) return null;
  const cc = country.toUpperCase();

  if (BROWSER_DECIDES.has(cc)) return null;

  const eu = EU_COUNTRY_TO_LOCALE[cc];
  if (eu) return nearestReadyLocale(eu) ?? routing.defaultLocale;

  const nonEu = NON_EU_COUNTRY_TO_LOCALE[cc];
  if (nonEu) return nearestReadyLocale(nonEu) ?? routing.defaultLocale;

  if (ES_COUNTRIES.has(cc)) return "es";
  if (PT_COUNTRIES.has(cc)) return "pt-BR";
  return "en";
}

export function hasLocalePrefix(pathname: string): boolean {
  return routing.locales.some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)
  );
}
