import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "en", "pt-BR"],
  // Inglés es el fallback universal: si el idioma del usuario no está en
  // nuestro repertorio (es / pt-BR), se sirve en inglés. La detección por país
  // y la elección manual (guardada en cookie) tienen prioridad sobre esto.
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];
