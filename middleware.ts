import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { localeFromCountry, hasLocalePrefix } from "./i18n/localeFromCountry";

const intlMiddleware = createMiddleware(routing);

const LOCALE_COOKIE = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const alreadyChosen = request.cookies.has(LOCALE_COOKIE);

  // Solo en la PRIMERA visita (sin cookie de idioma y sin locale en la URL)
  // detectamos el idioma por país (cabecera de geo de Vercel). Si el usuario
  // ya eligió idioma o la URL ya trae locale, no interferimos.
  if (!alreadyChosen && !hasLocalePrefix(pathname)) {
    const country = request.headers.get("x-vercel-ip-country");
    const locale = localeFromCountry(country);
    if (locale) {
      // next-intl lee la cookie del request para decidir el redirect.
      request.cookies.set(LOCALE_COOKIE, locale);
      const response = intlMiddleware(request);
      // Persistimos la elección para las siguientes visitas.
      response.cookies.set(LOCALE_COOKIE, locale, {
        maxAge: ONE_YEAR,
        path: "/",
        sameSite: "lax",
      });
      return response;
    }
  }

  return intlMiddleware(request);
}

export const config = {
  // Match all paths except: API routes, Next.js internals, Sentry tunnel, static files
  matcher: [
    "/((?!api|_next|_vercel|monitoring|.*\\..*).*)",
  ],
};
