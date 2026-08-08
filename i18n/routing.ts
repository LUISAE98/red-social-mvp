import { defineRouting } from "next-intl/routing";
import { READY_LOCALES } from "./locales";

export const routing = defineRouting({
  // La lista viene de i18n/locales.ts, la fuente única de verdad. Para servir un
  // idioma nuevo se enciende ahí (ready: true + entrada en READY_LOCALES), nunca aquí.
  locales: READY_LOCALES,
  // Inglés es el fallback universal: si el idioma del usuario no está en nuestro
  // repertorio, se sirve en inglés. La detección por país y la elección manual
  // (guardada en cookie) tienen prioridad sobre esto.
  defaultLocale: "en",
});

export type { Locale } from "./locales";
