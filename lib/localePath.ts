import { routing } from "@/i18n/routing";

/**
 * Quita el prefijo de idioma de un pathname para comparaciones de ruta.
 * Determinista y sin dependencia del contexto de next-intl (seguro en cualquier
 * layout y sin riesgo de hidratación), a diferencia del usePathname de next-intl.
 *
 * Ej.: "/es/login" -> "/login", "/en" -> "/", "/login" -> "/login".
 */
export function stripLocalePrefix(pathname: string): string {
  const segments = pathname.split("/"); // "/es/login" -> ["", "es", "login"]
  const first = segments[1];

  if ((routing.locales as readonly string[]).includes(first)) {
    const rest = "/" + segments.slice(2).join("/");
    return rest === "/" ? "/" : rest;
  }

  return pathname;
}
