"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
// Quita el prefijo de idioma de forma determinista (sin depender del provider
// de next-intl), para que la detección de rutas del guardián de auth funcione
// tras la migración i18n sin inestabilidad ni problemas de hidratación.
import { stripLocalePrefix } from "@/lib/localePath";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/app/providers";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { buildCurrentPathWithSearch, getNextFromSearchParams } from "@/lib/auth-redirect";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";

export default function RootChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const tCommon = useTranslations("common");
  const { user, loading, hasProfile, authTransitionMode, startAuthTransition } = useAuth();
  const pathname = stripLocalePrefix(usePathname());
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPublicPostRoute = pathname.startsWith("/p/");

  // El servidor no conoce la sesión (Firebase Auth es cliente) → siempre rinde
  // el shell "logged-out". Firebase resuelve la sesión en el cliente ANTES de que
  // React hidrate, así que sin este flag el primer render del cliente ramifica a
  // "logged-in" y no coincide con el servidor → error de hidratación. Tratamos al
  // usuario como null hasta hidratar; tras el efecto ya usamos el real.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

const isPublicRoute =
  pathname === "/" ||
  pathname === "/login" ||
  pathname === "/register" ||
  pathname === "/forgot-password" ||
  pathname === "/reset-password" ||
  pathname.startsWith("/search") ||
  pathname.startsWith("/groups") ||
  pathname.startsWith("/u/") ||
  pathname.startsWith("/p/") ||
  pathname.startsWith("/live-overlay/") ||
  pathname.startsWith("/egress/");

// Rutas que se renderizan SIN chrome (overlays a pantalla completa y la
// plantilla de grabación de sesiones, que carga el grabador headless).
const isOverlayRoute =
  pathname.startsWith("/live-overlay/") || pathname.startsWith("/egress/");

  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password";

  // Perfil público o comunidad pública → muestran un CTA de login FIJO en celular
  // (abajo, centrado). Excluye /groups/new (crear comunidad).
  const isProfileOrCommunity =
    pathname.startsWith("/u/") ||
    (pathname.startsWith("/groups/") && pathname !== "/groups/new");

  // Track previous auth state to detect sign-out on public routes
  const prevUserRef = useRef<typeof user | undefined>(undefined);

  useEffect(() => {
    if (loading) return;

    const wasAuthenticated = prevUserRef.current != null;
    const isNowUnauthenticated = !user;

    prevUserRef.current = user;

    if (!user && !isPublicRoute) {
      // Protected route — always redirect unauthenticated users
      startAuthTransition("exiting");
      router.replace("/login");
    } else if (wasAuthenticated && isNowUnauthenticated && !isAuthPage) {
      // User signed out while on any page (including public routes like /u/ or /groups/)
      startAuthTransition("exiting");
      router.replace("/login");
    } else if (user && isAuthPage && hasProfile === true) {
      // Ya autenticado Y con perfil → al feed. Un usuario autenticado SIN perfil
      // (onboarding de Google) se queda: el login muestra el panel de completar.
      router.replace(getNextFromSearchParams(searchParams, "/"));
    }
  }, [loading, user, hasProfile, isPublicRoute, isAuthPage, router, startAuthTransition, searchParams]);

  const fontStack =
    'inherit';

    // Auth solo para el render (el primer render del cliente = servidor). Los
    // efectos de arriba siguen usando el `user` real para redirigir.
    const renderUser = hydrated ? user : null;
    if (authTransitionMode === "exiting") {
  // Pantalla negra CONTINUA durante el cierre de sesión (en vez de null).
  // Como RootChrome vive en el layout raíz y no se desmonta al navegar, este
  // negro cubre toda la transición (redirect del guardián + recarga) sin los
  // parpadeos que se veían cuando el overlay del botón se desmontaba a media
  // transición o cuando aquí se devolvía null y se asomaba el fondo.
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 999999,
        pointerEvents: "none",
      }}
    />
  );
}
if (renderUser && isAuthPage && hasProfile === true) {
  return null;
}

if (renderUser) {
  return <>{children}</>;
}

if (isPublicPostRoute || isOverlayRoute) {
  return <>{children}</>;
}

// Páginas de auth (login, etc.): su propio (public)/layout ya pone el chrome
// (switches de moneda/idioma). RootChrome NO debe renderizar su header público
// aquí, o los switches (y la búsqueda) saldrían duplicados.
if (isAuthPage) {
  return <>{children}</>;
}

  return (
    <>
      <style jsx global>{`
        .rootChromePublicLayout {
          --shell-gutter: 16px;
          min-height: 100dvh;
          min-height: 100dvh;
          background: transparent;
          color: #ffffff;
          display: flex;
          flex-direction: column;
        }

        .rootChromePublicHeader {
          position: sticky;
          top: 0;
          z-index: 100;
          padding-top: env(safe-area-inset-top);
          border-bottom: none;
          background: transparent;
        }

        .rootChromePublicHeaderInner {
          width: 100%;
          min-height: 56px;
          padding-left: max(var(--shell-gutter), env(safe-area-inset-left));
          padding-right: max(var(--shell-gutter), env(safe-area-inset-right));
          padding-top: 18px;
          padding-bottom: 8px;
          box-sizing: border-box;
          position: relative;
        }

        .rootChromeDesktopHeader {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          min-height: 40px;
          width: 100%;
        }

        .rootChromeBrandCol {
          min-width: 0;
        }

        .rootChromeDesktopSearchCol {
          position: absolute;
          left: 50%;
          top: 50%;
          width: min(460px, calc(100vw - 48px));
          transform: translate(-50%, -50%);
          min-width: 0;
        }

        .rootChromeDesktopActions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-shrink: 0;
        }

        .rootChromeDesktopAuthLink {
          width: auto;
          min-height: 34px;
          padding: 0 14px;
          border-radius: 9px;
          border: none;
          background-image: linear-gradient(
            100deg,
            #ff2fb3 0%,
            #a855f7 35%,
            #4f46ff 70%,
            #ff2fb3 100%
          );
          background-size: 280% 280%;
          background-position: 0% 50%;
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.01em;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 6px 16px rgba(168, 85, 255, 0.25);
          overflow: hidden;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          white-space: nowrap;
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease,
            filter 0.18s ease;
        }

        .rootChromeDesktopAuthLink:hover {
          transform: translateY(-1px);
          filter: brightness(1.06);
          box-shadow: 0 14px 34px rgba(168, 85, 255, 0.3);
        }

        /* CTA de login FIJO en celular (perfil/comunidad públicos). Mismo estilo
           estético que el botón del header en laptop; oculto en laptop. */
        .rootChromeMobileAuthCta {
          display: none;
        }
        @media (max-width: 900px) {
          .rootChromeMobileAuthCta {
            position: fixed;
            left: 50%;
            transform: translateX(-50%);
            bottom: calc(16px + env(safe-area-inset-bottom));
            z-index: 200;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 42px;
            padding: 0 24px;
            border-radius: 9px;
            border: none;
            background-image: linear-gradient(
              100deg,
              #ff2fb3 0%,
              #a855f7 35%,
              #4f46ff 70%,
              #ff2fb3 100%
            );
            background-size: 280% 280%;
            background-position: 0% 50%;
            color: #fff;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: -0.01em;
            font-family: inherit;
            line-height: 1;
            white-space: nowrap;
            text-decoration: none;
            box-shadow: 0 8px 24px rgba(168, 85, 255, 0.38);
          }
        }

        .rootChromeMobileSearchRow {
          display: none;
        }

        .rootChromeMobileSearchCol {
          min-width: 0;
          width: 100%;
        }

        .rootChromePageContent {
          flex: 1;
        }

        @media (max-width: 1180px) {
          .rootChromePublicLayout {
            --shell-gutter: 14px;
          }
        }

        @media (max-width: 900px) {
          .rootChromePublicHeaderInner {
            width: 100%;
            padding-top: 16px;
            padding-bottom: 6px;
            padding-left: max(12px, env(safe-area-inset-left));
            padding-right: max(12px, env(safe-area-inset-right));
          }

          .rootChromeDesktopHeader {
            display: none;
          }

          .rootChromeMobileSearchRow {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 8px;
          }
        }
      `}</style>

      <div className="rootChromePublicLayout">
        <header className="rootChromePublicHeader">
          <div className="rootChromePublicHeaderInner">
            <div className="rootChromeDesktopHeader">
              <div className="rootChromeBrandCol" />

              <div className="rootChromeDesktopSearchCol">
                <GroupsSearchPanel
                  fontStack={fontStack}
                  showCreateGroup={false}
                  createGroupHref="/login"
                />
              </div>

              <div className="rootChromeDesktopActions">
                {pathname !== "/login" ? (
                  <Link
                    href={`/login?next=${encodeURIComponent(buildCurrentPathWithSearch(pathname, searchParams))}`}
                    className="rootChromeDesktopAuthLink"
                    onClick={() => startAuthTransition("entering")}
                  >
                    {tCommon("login")}
                  </Link>
                ) : null}
                <CurrencySwitcher variant="desktop" />
                <LanguageSwitcher variant="desktop" />
              </div>
            </div>

            <div className="rootChromeMobileSearchRow">
              <div className="rootChromeMobileSearchCol">
                <GroupsSearchPanel
                  fontStack={fontStack}
                  showCreateGroup={false}
                  createGroupHref="/login"
                  showCloseSearch={false}
                />
              </div>
            </div>
          </div>
        </header>

        <main className="rootChromePageContent">{children}</main>

        {/* CTA de login FIJO en celular, solo en perfil/comunidad públicos. */}
        {isProfileOrCommunity && pathname !== "/login" && (
          <Link
            href={`/login?next=${encodeURIComponent(buildCurrentPathWithSearch(pathname, searchParams))}`}
            className="rootChromeMobileAuthCta"
            onClick={() => startAuthTransition("entering")}
          >
            {tCommon("login")}
          </Link>
        )}

        {/* En celular, los switches de moneda/idioma van como burbujas flotantes
            (mismo patrón que el layout de auth), disponibles en cualquier página
            pública. */}
        <CurrencySwitcher variant="mobile-bubble" />
        <LanguageSwitcher variant="mobile-bubble" />
      </div>
    </>
  );
}