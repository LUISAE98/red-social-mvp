// Corrección del país fiscal por SUBDIVISIÓN. Espejo de backend/src/tax/resolveCountry.ts.
//
// Puro: sin dependencias, importable desde middleware (edge), servidor y cliente.
/**
 * 🚨 SUBDIVISIONES QUE TRIBUTAN DISTINTO QUE SU PAÍS 🚨
 *
 * Algunos territorios pertenecen a un Estado pero están FUERA de su régimen de IVA, y la
 * geolocalización los devuelve con el código de país del Estado. Sin esta corrección se les
 * cobra el impuesto equivocado: a un comprador en Tenerife se le cobraba 21% de IVA español
 * cuando le corresponde IGIC 7% —y encima a otro fisco—.
 *
 * La clave es `PAÍS-SUBDIVISIÓN` en ISO 3166-2. El valor es el código con el que debe
 * resolverse para efectos fiscales.
 *
 *   ES-CN → IC   Canarias (IGIC 7%, umbral €100.000)
 *   ES-CE → EA   Ceuta (IPSI)
 *   ES-ML → EA   Melilla (IPSI)
 *
 * ⚠️ Guayana Francesa, Mayotte, Guadalupe, Martinica y Reunión NO están aquí: tienen código
 *    ISO de PAÍS propio (GF, YT, GP, MQ, RE) y se resuelven solos.
 * ⚠️ Åland (FI-01) se dejó fuera a propósito: su régimen no está resuelto. Ver impuestos.md §6.12.
 *
 * ⚠️ Este mapa está DUPLICADO en backend/src/tax/resolveCountry.ts porque el backend no
 *    puede importar de lib/. Hay un test de paridad.
 */
export const SUBDIVISION_TAX_OVERRIDES: Readonly<Record<string, string>> = {
  "ES-CN": "IC",
  "ES-CE": "EA",
  "ES-ML": "EA",
};

/**
 * Aplica la corrección por subdivisión. Devuelve el país fiscal correcto, o el original si
 * esa subdivisión no tributa distinto.
 */
export function applySubdivisionOverride(
  country: string | null | undefined,
  region: string | null | undefined
): string | null {
  const c = (country ?? '').trim().toUpperCase();
  if (!c) return null;
  const r = (region ?? '').trim().toUpperCase();
  if (!r) return c;
  return SUBDIVISION_TAX_OVERRIDES[`${c}-${r}`] ?? c;
}
