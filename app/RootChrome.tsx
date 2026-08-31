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
  // Marcar "ya hidraté" es justo lo que este efecto debe hacer: corre una sola
  // vez al montar y no encadena renders.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHydrated(true); }, []);

  // Aquí se marcaba el <body> con `vb-authed` para encender un safe-area
  // inferior de 20px estando logueado. Ya no hay safe-area inferior en ninguna
  // parte, así que la clase no la leía nadie más y se fue con ella.

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
  pathname.startsWith("/egress/") ||
  pathname.startsWith("/dev/") || // páginas de diseño/preview (dev), accesibles sin login
  // Vibra Express: el feed sin cuenta. Su razon de ser es que se pueda ver sin
  // login, asi que mandarlo a login lo vacia de sentido.
  pathname === "/express" ||
  pathname.startsWith("/express/");

// Rutas que se renderizan SIN chrome (overlays a pantalla completa y la
// plantilla de grabación de sesiones, que carga el grabador headless).
const isOverlayRoute =
  pathname.startsWith("/live-overlay/") || pathname.startsWith("/egress/");

  /**
   * El panel del SUPERMODERADOR DE PLATAFORMA se gobierna solo.
   *
   * ⚠️ Sin esto, entrar al panel era imposible: un supermoderador NO tiene documento de
   * perfil —no es un creador, no lo necesita— y la regla de más abajo, pensada para
   * rescatar un registro a medias, lo devolvía al login. El resultado era un bucle:
   * inicias sesión, te manda al panel y el panel te devuelve al login.
   *
   * `/admin` ya tiene su propia puerta —claim de moderador Y sesión de Google— así que
   * aquí no hay que decidir nada por él.
   */
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

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

    if (!user && !isPublicRoute && !isAdminRoute) {
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
    } else if (user && hasProfile === false && !isPublicRoute && !isAuthPage && !isAdminRoute) {
      // Cuenta de Firebase Auth SIN documento de perfil, dentro de la app.
      // Pasa cuando el registro creó la cuenta pero la transacción del perfil
      // falló, o cuando el onboarding de Google se abandonó a medias: quedaba
      // navegando por la app autenticado y sin perfil, sin nada que lo empujara
      // a terminar. `hasProfile` solo vale `false` tras una lectura correcta —
      // los errores lo dejan en `null`—, así que esto no dispara por red caída.
      startAuthTransition("exiting");
      router.replace("/login");
    }
  }, [loading, user, hasProfile, isPublicRoute, isAuthPage, isAdminRoute, router, startAuthTransition, searchParams]);

  const fontStack =
    'inherit';

  // El header público (con el buscador) se esconde al bajar y vuelve al subir,
  // como el de la app ya autenticada. Devuelve la pantalla completa a la lectura
  // sin obligar a llegar hasta arriba para recuperar la búsqueda.
  const publicHeaderRef = useRef<HTMLElement>(null);
  const [publicHeaderHidden, setPublicHeaderHidden] = useState(false);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      const last = lastScrollYRef.current;
      lastScrollYRef.current = y;

      // Escribiendo en el buscador: NO se esconde aunque la página se mueva
      // (el teclado del celular desplaza el scroll y se llevaría el campo).
      const el = publicHeaderRef.current;
      if (el && document.activeElement && el.contains(document.activeElement)) {
        setPublicHeaderHidden(false);
        return;
      }

      // Mismo criterio que el layout autenticado: se esconde al bajar pasando
      // los 60px, y reaparece en cuanto se sube un poco — sin tener que llegar
      // al tope. El umbral de 20px lo fuerza visible cerca del inicio.
      if (y > 60 && y > last) setPublicHeaderHidden(true);
      else if (y < last || y <= 20) setPublicHeaderHidden(false);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

    // Auth solo para el render (el primer render del cliente = servidor). Los
    // efectos de arriba siguen usando el `user` real para redirigir.
    const renderUser = hydrated ? user : null;
    if (authTransitionMode === "exiting") {
  // Lo que la persona VE durante el cierre de sesión es el splash de marca, que
  // `startAuthTransition` enciende (ver lib/splash.ts) y que va muy por encima
  // de esto en z-index. Este negro se queda de respaldo por si el nodo del
  // splash no estuviera: sin él, devolver null aquí asomaría el fondo.
  //
  // Sigue siendo necesario devolver algo en vez de `children`: RootChrome vive
  // en el layout raíz y no se desmonta al navegar, así que dejar el árbol de la
  // app montado durante la salida reaparecía contenido de la sesión a media
  // transición. No lo cambies por `children` pensando que el splash ya tapa.
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
          transition: transform 260ms cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform;
        }

        /* Oculto: sube fuera de la vista. Sigue en el flujo (es sticky), así que
           el contenido no salta al esconderse ni al volver. */
        .rootChromePublicHeader[data-hidden="true"] {
          transform: translateY(-100%);
        }

        @media (prefers-reduced-motion: reduce) {
          .rootChromePublicHeader {
            transition: none;
          }
        }

        .rootChromePublicHeaderInner {
          width: 100%;
          min-height: 56px;
          padding-inline-start: max(var(--shell-gutter), env(safe-area-inset-left));
          padding-inline-end: max(var(--shell-gutter), env(safe-area-inset-right));
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
          overflow: hidden;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          white-space: nowrap;
          transition: transform 0.18s ease;
        }

        .rootChromeDesktopAuthLink:hover {
          transform: translateY(-1px);
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
            bottom: calc(16px + var(--vb-safe-bottom, 0px));
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
            padding-inline-start: max(12px, env(safe-area-inset-left));
            padding-inline-end: max(12px, env(safe-area-inset-right));
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
        <header
          ref={publicHeaderRef}
          className="rootChromePublicHeader"
          data-hidden={publicHeaderHidden ? "true" : undefined}
        >
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
                {/* En auth los switches los pone el (public)/layout; aquí solo
                    para páginas públicas fuera de auth (evita duplicados). */}
                {!isAuthPage && (
                  <>
                    <CurrencySwitcher variant="desktop" />
                    <LanguageSwitcher variant="desktop" />
                  </>
                )}
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

        {/* En CELULAR los switches de moneda/idioma solo se muestran en /login
            (arriba del botón), no en el resto de páginas públicas. En LAPTOP siguen
            en el header de escritorio (arriba). */}
      </div>
    </>
  );
}