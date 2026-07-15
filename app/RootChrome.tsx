"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
// Quita el prefijo de idioma de forma determinista (sin depender del provider
// de next-intl), para que la detección de rutas del guardián de auth funcione
// tras la migración i18n sin inestabilidad ni problemas de hidratación.
import { stripLocalePrefix } from "@/lib/localePath";
import { useEffect, useRef } from "react";
import { useAuth } from "@/app/providers";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { buildCurrentPathWithSearch, getNextFromSearchParams } from "@/lib/auth-redirect";
import { useTranslations } from "next-intl";

export default function RootChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const tCommon = useTranslations("common");
  const { user, loading, authTransitionMode, startAuthTransition } = useAuth();
  const pathname = stripLocalePrefix(usePathname());
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPublicPostRoute = pathname.startsWith("/p/");

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
    } else if (user && isAuthPage) {
      // Already authenticated — send to next param or home
      router.replace(getNextFromSearchParams(searchParams, "/"));
    }
  }, [loading, user, isPublicRoute, isAuthPage, router, startAuthTransition, searchParams]);

  const fontStack =
    'inherit';
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
if (user && isAuthPage) {
  return null;
}

if (user) {
  return <>{children}</>;
}

if (isPublicPostRoute || isOverlayRoute) {
  return <>{children}</>;
}

  return (
    <>
      <style jsx global>{`
        .rootChromePublicLayout {
          --shell-gutter: 16px;
          min-height: 100vh;
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
          padding-left: max(var(--shell-gutter), env(safe-area-inset-left));
          padding-right: max(var(--shell-gutter), env(safe-area-inset-right));
          padding-top: 8px;
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
          gap: 10px;
          flex-shrink: 0;
          /* Deja espacio para los switches de moneda/idioma, que van fijos en la
             esquina superior derecha, para que el botón de login no se encime. */
          margin-right: 172px;
        }

        .rootChromeDesktopAuthLink {
          width: auto;
          min-height: 40px;
          padding: 8px 14px;
          border-radius: 10px;
          border: none;
          background-image: linear-gradient(
            100deg,
            #ff2fb3 0%,
            #a855ff 35%,
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
          cursor: pointer;
          box-shadow: 0 10px 28px rgba(168, 85, 255, 0.22);
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
            padding-top: 6px;
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
      </div>
    </>
  );
}