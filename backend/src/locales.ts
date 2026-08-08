// Locales SERVIDOS por Vibra, para el backend.
//
// ⚠️ COPIA MANUAL de READY_LOCALES de i18n/locales.ts. El backend compila aparte
// (tsconfig propio en backend/) y no puede importar del árbol del frontend — el
// mismo caso que DISPLAY_CURRENCIES en exchangeRates.ts.
//
// Si divergen, las plantillas de grabación (egress de sesión y de saludo) se
// renderizan en inglés para un usuario que SÍ tiene traducción: el texto queda
// horneado en el .mp4 y no se puede corregir después.
// El test test/unit/i18n.test.ts compara ambas listas.
export const READY_LOCALES = ["es", "en", "pt-BR", "de", "fr", "it", "nl", "pl", "ro", "el", "cs", "hu", "sv", "pt-PT", "da"];

const READY_SET = new Set(READY_LOCALES);

/** El locale si lo servimos, si no "en". Para segmentos de URL de las plantillas. */
export function safeLocale(locale: string | null | undefined): string {
  return locale && READY_SET.has(locale) ? locale : "en";
}
