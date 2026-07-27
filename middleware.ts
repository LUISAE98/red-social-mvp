import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { localeFromCountry, hasLocalePrefix } from "./i18n/localeFromCountry";
import { displayCurrencyForCountry } from "./lib/currency/catalog";

const intlMiddleware = createMiddleware(routing);

const LOCALE_COOKIE = "NEXT_LOCALE";
const CURRENCY_COOKIE = "vibra_currency";
// País por IP para fines de IMPUESTOS (IVA). A diferencia de la moneda (preferencia
// pegajosa), este se REFRESCA en cada visita para reflejar dónde está el comprador
// AHORA: un extranjero de viaje en México debe reportar MX y pagar IVA (Art. 18-C).
// Ver lib/tax/useBuyerCountry.ts y docs/legal/fiscal-iva-isr-plataforma.md.
const COUNTRY_COOKIE = "vibra_country";
const ONE_YEAR = 60 * 60 * 24 * 365;

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const alreadyChosen = request.cookies.has(LOCALE_COOKIE);
  const country = request.headers.get("x-vercel-ip-country");

  let response;

  // Solo en la PRIMERA visita (sin cookie de idioma y sin locale en la URL)
  // detectamos el idioma por país (cabecera de geo de Vercel). Si el usuario
  // ya eligió idioma o la URL ya trae locale, no interferimos.
  if (!alreadyChosen && !hasLocalePrefix(pathname)) {
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
