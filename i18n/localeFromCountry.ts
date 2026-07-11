import { routing, type Locale } from "./routing";

// Países hispanohablantes → español.
const ES_COUNTRIES = new Set([
  "MX", "ES", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO",
  "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ",
]);

// Países lusófonos → portugués (la app solo tiene pt-BR).
const PT_COUNTRIES = new Set([
  "BR", "PT", "AO", "MZ", "CV", "GW", "ST", "TL",
]);

/**
 * Devuelve el locale según el código de país ISO (de la geo por IP).
 * Español o portugués según el país; cualquier otro → inglés.
 * Si el país es desconocido (null), devuelve null para dejar que next-intl
 * use su detección normal (cookie / Accept-Language / defaultLocale).
 */
export function localeFromCountry(country: string | null | undefined): Locale | null {
  if (!country) return null;
  const cc = country.toUpperCase();
  if (ES_COUNTRIES.has(cc)) return "es";
  if (PT_COUNTRIES.has(cc)) return "pt-BR";
  return "en";
}

export function hasLocalePrefix(pathname: string): boolean {
  return routing.locales.some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)
  );
}
