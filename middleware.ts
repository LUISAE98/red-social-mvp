import createMiddleware from "next-intl/middleware";
import { applySubdivisionOverride } from "@/lib/tax/subdivisions";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { localeFromCountry, hasLocalePrefix } from "./i18n/localeFromCountry";
import { displayCurrencyForCountry } from "./lib/currency/catalog";

const intlMiddleware = createMiddleware(routing);

const LOCALE_COOKIE = "NEXT_LOCALE";
// Marca de elección MANUAL de idioma (la pone LanguageSwitcher). Ver más abajo.
const LOCALE_MANUAL_COOKIE = "vibra_locale_manual";
const CURRENCY_COOKIE = "vibra_currency";
// País por IP para fines de IMPUESTOS (IVA). A diferencia de la moneda (preferencia
// pegajosa), este se REFRESCA en cada visita para reflejar dónde está el comprador
// AHORA: un extranjero de viaje en México debe reportar MX y pagar IVA (Art. 18-C).
// Ver lib/tax/useBuyerCountry.ts y docs/legal/fiscal-iva-isr-plataforma.md.
const COUNTRY_COOKIE = "vibra_country";
const ONE_YEAR = 60 * 60 * 24 * 365;

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rawCountry = request.headers.get("x-vercel-ip-country");
  // Vercel manda la subdivisión ISO 3166-2 aparte. Se aplica antes de nada para que
  // Canarias, Ceuta y Melilla no se traten como España: tributan distinto.
  const country = applySubdivisionOverride(
    rawCountry,
    request.headers.get("x-vercel-ip-country-region")
  );

  let response;

  // 🚨 AUTO-DETECTADO ≠ ELEGIDO POR EL USUARIO 🚨
  //
  // Antes esto miraba solo si EXISTÍA `NEXT_LOCALE`, y esa cookie la escribe el propio
  // middleware en la primera visita. O sea que una detección automática quedaba
  // congelada un año, indistinguible de una decisión del usuario: quien entrara una vez
  // desde México y se mudara a Alemania seguía viendo español para siempre.
  //
  // `vibra_locale_manual` solo la pone LanguageSwitcher al elegir idioma a mano. Mientras
  // no esté, el idioma se re-detecta por geo en cada visita; en cuanto está, no se toca.
  const chosenByUser = request.cookies.has(LOCALE_MANUAL_COOKIE);
  const shouldDetectLocale = !chosenByUser && !hasLocalePrefix(pathname);

  if (shouldDetectLocale) {
    const locale = localeFromCountry(country);
    if (locale) {
      // next-intl lee la cookie del request para decidir el redirect.
      request.cookies.set(LOCALE_COOKIE, locale);
      response = intlMiddleware(request);
      // Persistimos la elección para las siguientes visitas.
      response.cookies.set(LOCALE_COOKIE, locale, {
        maxAge: ONE_YEAR,
        path: "/",
        sameSite: "lax",
      });
    }
  }

  if (!response) response = intlMiddleware(request);

  // Moneda de visualización por defecto según el país (solo en la primera visita;
  // una elección manual persiste en su propia cookie y no se sobrescribe).
  if (!request.cookies.has(CURRENCY_COOKIE) && country) {
    response.cookies.set(CURRENCY_COOKIE, displayCurrencyForCountry(country), {
      maxAge: ONE_YEAR,
      path: "/",
      sameSite: "lax",
    });
  }

  // País por IP para impuestos: se REFRESCA si cambió (rastrea la ubicación actual,
  // no una preferencia). Solo escribimos cuando hay cabecera de geo y difiere de la
  // cookie, para no reescribir en cada request innecesariamente.
  if (country) {
    const iso = country.toUpperCase();
    if (request.cookies.get(COUNTRY_COOKIE)?.value !== iso) {
      response.cookies.set(COUNTRY_COOKIE, iso, {
        maxAge: ONE_YEAR,
        path: "/",
        sameSite: "lax",
      });
    }
  }

  return response;
}

export const config = {
  // Match all paths except: API routes, Next.js internals, Sentry tunnel, static files
  matcher: [
    "/((?!api|_next|_vercel|monitoring|.*\\..*).*)",
  ],
};
