//layout (protected)

"use client";

import Link from "next/link";
import { IconButton } from "@/components/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { consumeNavSlideDir } from "@/lib/nav-slide";
import { usePathname, useRouter } from "@/i18n/navigation";
import VibraSavedPostIcon from "@/app/components/VibraServiceIcons/VibraSavedPostIcon";
import { useAuth } from "@/app/providers";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import ChatDockProvider from "@/components/chat/ChatDockProvider";
import MobileBottomNav from "@/app/components/MobileBottomNav";
import ScrollToTopFAB from "@/app/components/ScrollToTopFAB/ScrollToTopFAB";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { useHasPurchasedExperiences } from "@/lib/experiences/useHasPurchasedExperiences";
import { useBuyerExperienceActivity } from "@/lib/experiences/useBuyerExperienceActivity";
import { useBuyerExperiencesSeen } from "@/lib/experiences/useBuyerExperiencesSeen";
import { countNewExperiences, isCategoryNew } from "@/lib/experiences/experienceActivity";
import { useMobileHeaderFade } from "@/app/hooks/useMobileHeaderFade";
import { VibraNavigationIcon, VibraNavigationIconsStyles } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import NotificationBell from "@/app/components/Notifications/NotificationBell";
import WalletDesktopRail from "@/app/components/WalletDesktopRail/WalletDesktopRail";
import { MobileHeaderCtx, type MobileHeaderData } from "@/app/contexts/MobileHeaderContext";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";
import LogoutButton from "@/app/LogoutButton";
import PushEnablePrompt from "@/app/components/PushEnablePrompt";


/**
 * Secciones que ya animan su contenido por dentro.
 *
 * La wallet tiene su propio subnav y desliza la pestaña nueva con el `motion.div`
 * de `wallet/layout.tsx`. Moverse dentro de una de estas secciones NO debe
 * deslizar la columna principal: esa animación arrastra TODO lo que hay dentro,
 * y aquí el título de la sección y su subnav tienen que quedarse quietos —
 * solo se mueve lo que va debajo del subnav.
 *
 * Entrar a la sección desde fuera sí desliza, como cualquier cambio de pantalla.
 */
const SELF_ANIMATED_SECTIONS = ["/wallet"];

function isNavWithinSelfAnimatedSection(
  prev: string | null,
  next: string
): boolean {
  if (prev === null) return false;
  return SELF_ANIMATED_SECTIONS.some(
    (section) => prev.startsWith(section) && next.startsWith(section)
  );
}

function PublicProfileShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style jsx>{`
        .layout {
          position: relative;
          z-index: 1;
          width: 100%;
          min-width: 0;
          min-height: auto;
          background: transparent;
          color: #fff;
          overflow-x: clip;
        }

        .contentArea {
          position: relative;
          z-index: 2;
          width: min(820px, calc(100% - 28px));
          min-width: 0;
          margin: 0 auto;
          padding-top: 24px;
          padding-bottom: calc(48px + var(--vb-safe-bottom, 0px));
          box-sizing: border-box;
        }

        @media (max-width: 900px) {
          .contentArea {
            width: 100%;
            padding-top: 10px;
            padding-bottom: calc(32px + var(--vb-safe-bottom, 0px));
          }
        }
      `}</style>

      <div className="layout">
        <div className="contentArea">{children}</div>
      </div>
    </>
  );
}

function AuthenticatedProfileShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
// Solo el rail derecho se condiciona a monetizar (servicios activos en perfil o
// comunidad, o alguna solicitud histórica). El header y el nav móvil siguen
// mostrando la wallet a cualquier usuario con sesión.
const { hasWallet: hasMonetization } = useWalletVisibility(user?.uid);
// La estrella "Mis experiencias" solo aparece para quien COMPRÓ alguna experiencia
// (no a quien solo vende ni a quien solo navega). Ver useHasPurchasedExperiences.
const hasPurchasedExperiences = useHasPurchasedExperiences(user?.uid);
// Badge de la estrella: hay algo NUEVO sin ver (pendiente/rechazado/entregado).
const expActivity = useBuyerExperienceActivity(user?.uid);
const { seen: expSeen } = useBuyerExperiencesSeen(user?.uid);
const experiencesBadge =
  hasPurchasedExperiences &&
  (isCategoryNew(expActivity.latest.requested, expSeen.requested) ||
    isCategoryNew(expActivity.latest.rejected, expSeen.rejected) ||
    isCategoryNew(expActivity.latest.delivered, expSeen.delivered));
// Cuantas experiencias tienen novedad, para el globo del menu lateral. El
// booleano de arriba sigue mandando en la estrella del nav movil, que solo
// necesita saber si hay algo.
const experiencesBadgeCount = experiencesBadge
  ? countNewExperiences(expActivity.timestamps, expSeen)
  : 0;
const { headerRef, safeAreaRef } = useMobileHeaderFade();
// Slide de entrada vía atributo CSS aplicado DESPUÉS del paint (no framer-motion).
// En iOS un transform en render sobre un ancestro crea un containing/stacking
// context para los `position: fixed` descendientes (OwnerSidebar y sus overlays)
// antes de que estén pintados, y la animación no corre. Aplicar el transform tras
// el paint lo evita. Mismo mecanismo que app/[locale]/groups/layout.tsx.
const mainInnerRef = useRef<HTMLDivElement>(null);
const pendingAnimDirRef = useRef<"left" | "right" | null>(null);
// ¿La última navegación fue el botón "atrás" del navegador/gesto? Se marca en
// `popstate` y se consume en el siguiente cambio de ruta, para que volver entre
// desde la izquierda (como en iOS) y avanzar entre desde la derecha.
const poppedRef = useRef(false);
const firstRenderRef = useRef(true);
// Ruta anterior, para distinguir "entré a una sección" de "me moví dentro de
// ella". Ver SELF_ANIMATED_SECTIONS.
const prevPathnameRef = useRef<string | null>(null);

// Estado para header contextual (avatar + nombre que pasan las páginas hijas)
const [headerData, setHeaderData] = useState<MobileHeaderData>({ avatarUrl: null, name: null });
// Scroll state: home=true → header se oculta; context=true → header se comprime+swap
const [homeHeaderHidden, setHomeHeaderHidden] = useState(false);
const [contextScrolled, setContextScrolled] = useState(false);
// Laptop: el header entero (con el buscador) se desliza fuera de vista al bajar
// y vuelve al subir, igual que el público de RootChrome. Va aparte de
// `homeHeaderHidden` a propósito: ese es de celular, se desvanece en vez de
// deslizarse y solo actúa en home y wallet.
const [desktopHeaderHidden, setDesktopHeaderHidden] = useState(false);

const isHomePage = pathname === "/";
const isProfilePage = /^\/u\/[^/]+/.test(pathname);
// La wallet oculta/muestra el header al hacer scroll, igual que home.
const isWalletPage = pathname.startsWith("/wallet");
// El reel ocupa la pantalla entera y trae sus propios controles arriba: un
// header encima le robaría espacio y taparía la barra de progreso.
const isReelsPage = pathname === "/reels" || pathname.startsWith("/reels/");
const [isEmbed, setIsEmbed] = useState(false);

useLayoutEffect(() => {
  try {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsEmbed(window.self !== window.top);
  } catch {
    setIsEmbed(true);
  }
}, []);

  const fontStack =
    'inherit';

  // Disable browser scroll restoration so our manual restore doesn't conflict
  useEffect(() => {
    history.scrollRestoration = "manual";
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileSearchOpen(false);
    setHomeHeaderHidden(false);
    setContextScrolled(false);
    // Al cambiar de pantalla el header vuelve. Como el layout no se desmonta al
    // navegar y la vuelta es un `transform`, baja deslizándose con su transición
    // en vez de aparecer de golpe.
    setDesktopHeaderHidden(false);
  }, [pathname]);

  // Restaurar scroll antes del paint (sin salto visible) y guardar la dirección
  // para animar después del paint.
  // El "atrás" del navegador (y el gesto de borde en iOS) no pasa por el subnav,
  // así que se detecta aparte para animar hacia el lado correcto.
  useEffect(() => {
    const onPop = () => { poppedRef.current = true; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useLayoutEffect(() => {
    const explicit = consumeNavSlideDir();
    const wasBack = poppedRef.current;
    poppedRef.current = false;

    const prevPathname = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    // Arranque en frío: no hubo navegación, así que no hay nada que deslizar.
    // Sin esto la app "entraría" desplazándose en cada carga, que se lee como
    // un salto, no como una transición.
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      if (!explicit) return;
    }

    // Moverse DENTRO de una sección que ya anima lo suyo (hoy, las pestañas de
    // la wallet): la columna principal se queda quieta y anima la sección. Si
    // deslizáramos aquí también, se irían con ella el título y el subnav, que
    // son justo lo que debe permanecer fijo mientras cambia lo de abajo.
    if (isNavWithinSelfAnimatedSection(prevPathname, pathname)) return;

    if (explicit) {
      // Navegación del subnav: además restaura el scroll que tenía esa página.
      const saved = sessionStorage.getItem(`nav:scroll:${pathname}`);
      window.scrollTo({ top: saved !== null ? parseInt(saved) : 0, behavior: "instant" });
      pendingAnimDirRef.current = explicit;
      return;
    }

    // En CELULAR toda navegación desliza, la pida quien la pida: un enlace del
    // menú, una tarjeta del feed o el botón atrás. Sin esto solo se animaba lo
    // que pasaba por el subnav y el resto de la app cambiaba de página de golpe.
    // En escritorio se deja quieto: ahí el deslizamiento no aporta y marea.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      pendingAnimDirRef.current = wasBack ? "left" : "right";
    }
  }, [pathname]);

  // Animar después del paint para que los `position: fixed` hijos ya estén en el
  // DOM cuando iOS crea el stacking context del transform.
  useEffect(() => {
    const dir = pendingAnimDirRef.current;
    pendingAnimDirRef.current = null;
    if (!dir) return;
    const mainEl = mainInnerRef.current;
    if (mainEl) {
      mainEl.setAttribute("data-nav-enter", dir);
      mainEl.addEventListener("animationend", () => mainEl.removeAttribute("data-nav-enter"), { once: true });
    }
  }, [pathname]);

  // Scroll listener: comportamiento diferente según la ruta
  useEffect(() => {
    if (!isHomePage && !isProfilePage && !isWalletPage) return;

    let lastY = window.scrollY;

    const handler = () => {
      const y = window.scrollY;

      if (isHomePage || isWalletPage) {
        // Dirección: ocultar al bajar, mostrar al subir o estar cerca del top
        if (y > 60 && y > lastY) setHomeHeaderHidden(true);
        else if (y < lastY || y <= 20) setHomeHeaderHidden(false);
      }

      if (isProfilePage) {
        // Histéresis: se activa al pasar el nombre (>80) y NO vuelve al header
        // original hasta llegar arriba (y<=4). Así, al subir, el header mini se
        // mantiene hasta el tope en vez de revertir apenas bajas de 80.
        if (y > 80) setContextScrolled(true);
        else if (y <= 4) setContextScrolled(false);
      }

      lastY = y;
    };

    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [pathname, isHomePage, isProfilePage, isWalletPage]);

  /**
   * Laptop: esconder el header al bajar y devolverlo al subir.
   *
   * Mismo criterio y misma curva que el header público de `RootChrome`, para que
   * entrar con sesión no cambie el comportamiento de la barra. A diferencia del
   * listener de arriba, este corre en TODAS las rutas: sin sesión la barra se
   * comporta igual en cualquier pantalla y no hay motivo para que con sesión
   * dependa de dónde estés.
   *
   * Solo por encima de 900px: en celular el header logueado tiene su propio
   * guion (se desvanece en home y wallet, se comprime en perfil) y meterle
   * además un deslizamiento lo pelearía.
   */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px)");
    let lastY = window.scrollY;

    const onScroll = () => {
      if (!mq.matches) return;

      const y = window.scrollY;
      const last = lastY;
      lastY = y;

      // Escribiendo en el buscador: no se esconde aunque la página se mueva, o
      // el campo se iría con el foco puesto.
      const el = headerRef.current;
      if (el && document.activeElement && el.contains(document.activeElement)) {
        setDesktopHeaderHidden(false);
        return;
      }

      if (y > 60 && y > last) setDesktopHeaderHidden(true);
      else if (y < last || y <= 20) setDesktopHeaderHidden(false);
    };

    // Al bajar a anchos de celular, devolverlo: allí manda el otro guion y un
    // header escondido se quedaría escondido para siempre.
    const onBreakpoint = () => {
      if (!mq.matches) setDesktopHeaderHidden(false);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    mq.addEventListener("change", onBreakpoint);
    return () => {
      window.removeEventListener("scroll", onScroll);
      mq.removeEventListener("change", onBreakpoint);
    };
  }, [headerRef]);

const contentAreaClassName = isEmbed
  ? "contentArea contentAreaEmbed"
  : "contentArea contentAreaWithWallet";

  return (
    <ChatDockProvider selfUid={user?.uid ?? null}>
      <style jsx>{`
        .layout {
          --shell-gutter: 16px;
          --sidebar-width: 300px;
          --wallet-rail-width: 280px;
          --main-max-width: 860px;
          --shell-column-gap: 24px;
          /* Hueco que .contentAreaWithWallet reserva a un lado para el rail de la
             wallet. Va en una VARIABLE y no en la propia regla a propósito.

             El motivo: una propiedad lógica con valor asimétrico no sobrevive a la
             compilación. Lightning CSS no puede dejar padding-inline-end tal cual
             para navegadores viejos, así que la parte en dos reglas dirigidas por
             :lang() —una para LTR y otra para RTL— y ese :not(:is(:lang(…)))
             SUMA especificidad. La regla pasa de (0,2,0) a (0,3,0) sola.

             Cuando el valor es simétrico (0 a los dos lados) no hace falta saber la
             dirección, así que lo colapsa a físicas y se queda en (0,2,0). Es decir:
             la anulación de celular perdía contra la regla de escritorio y el móvil
             seguía reservando ~292px para un rail que ahí ni se pinta. Con variable
             no hay pulso de especificidad: es el MISMO selector redefiniendo su
             propio valor por breakpoint. */
          --wallet-rail-pad: calc(
            var(--wallet-rail-width) + var(--shell-column-gap) + var(--shell-gutter)
          );
          --shell-pad-inline: var(--shell-gutter);
          /* Ancho natural del conjunto (sidebar + gap + main + gap + wallet + gutters).
             Por encima de esto el shell deja de estirarse y se CENTRA, para que en
             monitores grandes las 3 columnas no se dispersen. */
          --shell-max-width: 1520px;
          /* Borde izquierdo del cluster centrado, para que el OwnerSidebar (que va
             position:fixed) siga al conjunto en pantallas grandes en vez de quedarse
             pegado al viewport. Debajo de --shell-max-width cae a su valor histórico. */
          --owner-sidebar-fixed-left: max(
            18px,
            calc(50vw - var(--shell-max-width) / 2 + var(--shell-gutter))
          );
          --desktop-search-width: 920px;
          --desktop-search-gap: 8px;
          --desktop-create-size: 35px;

          min-height: 100dvh;
          min-height: 100dvh;
          background: transparent;
          color: #fff;
          display: flex;
          flex-direction: column;
        }

.safeAreaHeaderBackdrop {
  position: fixed;
  top: 0;
  inset-inline-start: 0;
  inset-inline-end: 0;
  height: calc(env(safe-area-inset-top, 0px) + 56px);
  z-index: 70;
  pointer-events: none;
  background: transparent;
  transition: opacity 220ms ease;
}

.header {
  position: sticky;
  top: 0;
  z-index: 80;
  padding-top: env(safe-area-inset-top, 0px);
  border-bottom: none;
  background: transparent;
  pointer-events: none;
  transition: opacity 220ms ease;
}

/* Laptop: al bajar se va SOLO el buscador; el logo y los iconos de la derecha se
   quedan. Sin sesión el header entero se esconde porque allí es casi solo la
   barra, pero aquí .desktopHeader es una fila de tres columnas
   (marca | buscador | acciones) y llevarse las tres dejaría la pantalla sin
   navegación.

   Mismos tiempos y curva que .rootChromePublicHeader en RootChrome.tsx — si se
   toca uno, tocar el otro. La columna conserva su hueco en el grid, así que la
   marca y las acciones no se mueven al esconderse la barra.

   Va en min-width porque en celular el header logueado tiene otro guion. */
@media (min-width: 901px) {
  .desktopSearchCol {
    transition:
      transform 260ms cubic-bezier(0.4, 0, 0.2, 1),
      opacity 200ms ease;
    will-change: transform;
  }

  .header[data-hidden="true"] .desktopSearchCol {
    transform: translateY(-140%);
    opacity: 0;
    pointer-events: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .desktopSearchCol {
    transition: opacity 200ms ease;
  }

  .header[data-hidden="true"] .desktopSearchCol {
    transform: none;
  }
}

.headerInner,
.headerInner a,
.headerInner button,
.headerInner input {
  pointer-events: auto;
}

.headerInner {
  width: 100%;
  max-width: var(--shell-max-width);
  margin-inline-start: auto;
  margin-inline-end: auto;
  min-height: 56px;
  padding-inline-start: max(var(--shell-gutter), env(safe-area-inset-left, 0px));
  padding-inline-end: max(var(--shell-gutter), env(safe-area-inset-right, 0px));
  padding-top: 8px;
  padding-bottom: 8px;
  box-sizing: border-box;
}

 .desktopHeader {
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--wallet-rail-width);
  gap: var(--shell-column-gap);
  align-items: center;
  min-height: 40px;
  width: 100%;
}

        .brandCol {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        .brand {
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
          white-space: nowrap;
          color: #fff;
          text-decoration: none;
        }


/* Wordmark "Vibra" con el degradado de marca animado (mismo efecto que
   VibraGradientText / el hero del login). */
.brandLogo {
  display: inline-block;
  margin-inline-start: 10px;
  font-size: 35px;
  font-weight: 680;
  letter-spacing: -0.035em;
  line-height: 1;
  background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
  background-size: 220% 220%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: vibraTextFlow 4.5s ease-in-out infinite;
}

.mobileBrandLogo {
  display: inline-block;
  margin-inline-start: 8px;
  font-size: 29px;
  font-weight: 680;
  letter-spacing: -0.035em;
  line-height: 1;
  background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
  background-size: 220% 220%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: vibraTextFlow 4.5s ease-in-out infinite;
}

@keyframes vibraTextFlow {
  0%,
  100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .brandLogo,
  .mobileBrandLogo {
    animation: none;
    background-position: 50% 50%;
  }
}

.desktopMainCluster {
  min-width: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.desktopSearchCol {
  min-width: 0;
  width: min(var(--desktop-search-width), 100%);
  flex: 0 1 auto;
}


        .desktopCreateButtonWrap {
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }

.desktopHeaderActions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* Botón de cerrar sesión (icono puerta+flecha) a la derecha del switch de idioma. */
.desktopHeaderActions :global(.headerLogoutBtn) {
  background: transparent;
  margin-inline-start: 2px;
  transition: background 140ms ease;
}

.desktopHeaderActions :global(.headerLogoutBtn:hover) {
  background: rgba(255, 255, 255, 0.10);
}

/* Accesos rápidos (la campanita).
   Se alinean con el título "Menú" del rail derecho que queda justo debajo, en vez
   de amontonarse contra el borde de la pantalla.

   La cuenta no es un número a ojo, es la MISMA que sitúa ese título: el rail mide
   min(100%, 250px) y va centrado en esta columna, así que su borde empieza a la
   mitad de lo que sobra; sus secciones añaden 14px de relleno. Escrita así sigue
   cuadrando en el corte de 1180px, donde la columna pasa de 280 a 260.

   El margen final "auto" es el que empuja moneda, idioma y salir hasta la derecha:
   solo se mueve la campanita. */
.desktopHeaderQuickLinks {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-inline-start: calc((100% - min(100%, 250px)) / 2 + 14px);
  margin-inline-end: auto;
  flex: 0 0 auto;
}

/* Anclado en el div (styled-jsx no scopea clases sobre componentes como Link,
   ver nota de la búsqueda móvil) y bajando con :global hasta el <a>. */
.desktopHeaderQuickLinks :global(.desktopActionIcon) {
  height: 38px;
  padding: 0 6px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex: 0 0 auto;
  opacity: 1;
  transition: opacity 140ms ease, background 140ms ease;
}


/* Los iconos del set Vibra traen el trazo morado de marca; en el header van en
   blanco. El CSS gana sobre el atributo stroke del SVG. */
.desktopHeaderQuickLinks :global(.desktopActionIcon svg path) {
  stroke: #ffffff;
}

.desktopHeaderQuickLinks :global(.desktopActionIcon:hover) {
  opacity: 1;
  background: rgba(255, 255, 255, 0.10);
}

.desktopHeaderQuickLinks :global(.desktopActionIconActive) {
  opacity: 1;
}

        .mobileSearchRow {
          display: none;
        }

.mobileHeaderRow {
  display: none;
  min-height: 40px;
  width: 100%;
  pointer-events: none;
  position: relative;
}

/* Contenedor del contenido por defecto (logo + acciones) */
.mobileHeaderDefault {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  /* Devuelve el puntero a todo lo de dentro (ver la nota en .mobileActions).
     Cuando la fila está en modo contexto, .mobileHeaderScrolled lo vuelve a
     apagar con más especificidad, así que el header comprimido sigue igual. */
  pointer-events: auto;
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* Barra contextual: avatar + nombre (aparece al hacer scroll en perfil/grupo) */
.mobileHeaderContext {
  position: absolute;
  top: 0;
  inset-inline-start: 0;
  inset-inline-end: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  opacity: 0;
  transform: translateY(5px);
  pointer-events: none;
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* Estado scrolled en modo contexto */
.mobileHeaderScrolled .mobileHeaderDefault {
  opacity: 0;
  transform: translateY(-5px);
  pointer-events: none;
}

.mobileHeaderScrolled .mobileHeaderContext {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* Deshabilitar clicks en botones del default cuando está oculto */
.mobileHeaderScrolled .mobileHeaderDefault a,
.mobileHeaderScrolled .mobileHeaderDefault button {
  pointer-events: none;
}

.mobileContextAvatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #1a0a2e;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #a855f7;
  border: 1.5px solid rgba(168, 85, 255, 0.3);
}

.mobileContextAvatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.mobileContextName {
  font-size: 15px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100vw - 110px);
  letter-spacing: -0.01em;
}

.mobileBrand {
  display: none;
  pointer-events: none;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
  max-width: 34vw;
}

.mobileBrand {
  transform-origin: center;
  transition:
    opacity 160ms ease,
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.mobileBrandHidden {
  opacity: 0;
  transform: scale(0.86);
  pointer-events: none;
}

.mobileBrandVisible {
  opacity: 1;
  transform: scale(1);
  /* Vence al pointer-events none de .mobileBrand, que es para cuando el logo
     está oculto. Visible tiene que poder pulsarse sin depender de que el hash de
     styled-jsx llegue al enlace que pinta next/link. */
  pointer-events: auto;
  animation: mobileBrandPopIn 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes mobileBrandPopIn {
  0% {
    opacity: 0;
    transform: scale(0.88);
  }

  70% {
    opacity: 1;
    transform: scale(1.04);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}

        .mobileActions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-inline-start: auto;
          flex-shrink: 0;
          /* Reactiva el puntero para TODO lo que va dentro.
             .mobileHeaderRow lo apaga (el header es transparente y no debe
             tragarse clics fuera de sus controles) y hasta ahora lo recuperaban
             las reglas .headerInner a y .headerInner button de más arriba. Eso
             dependía de que el botón fuese un elemento button escrito aquí
             mismo, al que styled-jsx le pone su hash. Desde que buscar y
             guardados son IconButton, el hash no está garantizado en el button
             que ese componente pinta, la regla dejaba de encajar y los dos se
             quedaban muertos al tacto. Puesto en el contenedor, que sí es un
             elemento de este archivo, funciona pase lo que pase con el hijo. */
          pointer-events: auto;
        }

        /* Campanita del panel en el header móvil: solo aparece en el rango de
           laptop angosto (769–900px). El header móvil ya está oculto >900px; aquí
           la ocultamos ≤768px para no duplicar con el nav inferior en celular. */
        .mobileNotifBell {
          display: inline-flex;
          align-items: center;
        }
        .mobileNotifBell :global(svg path) {
          stroke: #ffffff;
        }
        @media (max-width: 768px) {
          .mobileNotifBell {
            display: none;
          }
        }

.mobileSearchIconButton {
  width: 32px;
  height: 32px;
  min-width: 32px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #a855f7;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.mobileSearchRow {
  width: 100%;
  min-height: 40px;
  display: none;
  align-items: center;
  overflow: visible;
}

.mobileSearchCol {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
}

        .mobileSearchCol {
          min-width: 0;
          width: 100%;
        }

.contentArea {
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, var(--main-max-width));
  gap: var(--shell-column-gap);
  width: 100%;
  max-width: var(--shell-max-width);
  margin-inline-start: auto;
  margin-inline-end: auto;
  flex: 1;
  /* Por variable, no por valor: ver --wallet-rail-pad arriba. Aunque aquí los dos
     lados valgan lo mismo, el compilador no puede demostrarlo (son var() sin
     resolver), así que parte la regla igual y le sube la especificidad. */
  padding-inline-start: var(--shell-pad-inline);
  padding-inline-end: var(--shell-pad-inline);
  padding-top: 0;
  padding-bottom: calc(24px + var(--vb-safe-bottom, 0px));
  box-sizing: border-box;
  align-items: start;
}

.contentAreaWithWallet {
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  padding-inline-end: var(--wallet-rail-pad);
}

.contentAreaEmbed {
  grid-template-columns: minmax(0, 1fr);
  --shell-pad-inline: 0px;
  --wallet-rail-pad: 0px;
}

.sidebarCol {
  position: sticky;
  top: calc(env(safe-area-inset-top) + 90px);
  align-self: start;
  min-width: 0;
  z-index: 90;
}

.mainCol {
  min-width: 0;
  width: 100%;
  position: relative;
  z-index: 1;
  padding-top: 0;
  /* En laptop no hay nada anclado abajo —el nav inferior es solo de celular—,
     así que aquí basta un respiro. Los 90px de antes eran el hueco del nav
     copiado a una pantalla que no lo tiene: puro vacío al final del scroll. */
  padding-bottom: 24px;
  align-self: start;
}

.mainInner {
  width: min(var(--main-max-width), 100%);
  margin-inline-start: auto;
  margin-inline-end: auto;
  margin-top: 0;
}
  
.walletCol {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 64px);
  /* Se ancla al borde derecho del cluster centrado: en pantallas anchas sigue al
     conjunto (no al borde del viewport); en pantallas ≤ --shell-max-width cae al
     gutter, como antes. */
  inset-inline-end: max(
    env(safe-area-inset-right, 0px),
    var(--shell-gutter),
    calc(50vw - var(--shell-max-width) / 2 + var(--shell-gutter))
  );
  bottom: calc(8px + var(--vb-safe-bottom, 0px));
  width: var(--wallet-rail-width);
  min-width: 0;

  display: flex;
  flex-direction: column;
  align-items: center;

  overflow: hidden;
  box-sizing: border-box;
  z-index: 20;
}
.walletLogoutWrap {
  width: 250px;
  margin: clamp(18px, 3vh, 34px) auto 0;
  padding-bottom: calc(8px + var(--vb-safe-bottom, 0px));
  flex-shrink: 0;
  box-sizing: border-box;
}

.walletLogoutWrap :global(button) {
  width: 100%;
  height: 40px;
  min-height: 40px;
  background: #7c3aed !important;
  background-image: none !important;
  box-shadow: 0 10px 24px rgba(124, 58, 237, 0.22);
}

@media (max-width: 1180px) {
  .layout {
    --shell-gutter: 14px;
    --sidebar-width: 260px;
    --wallet-rail-width: 260px;
    --shell-column-gap: 18px;
    --main-max-width: 780px;
  }
}

        @media (max-width: 900px) {

.layout {
  background: #000000;
  /* En celular el rail de la wallet no se pinta (.walletCol va a display:none),
     así que no hay hueco que reservarle; y el contenido va a sangre. */
  --wallet-rail-pad: 0px;
  --shell-pad-inline: 0px;
}

.safeAreaHeaderBackdrop {
  background: #000000;
}

.safeAreaHidden {
  opacity: 0;
}

.header {
  position: sticky;
  background: transparent;
  transition: opacity 220ms ease;
}

/* Home: header se desvanece al hacer scroll hacia abajo */
.headerFadeHome {
  opacity: 0;
  pointer-events: none;
}

/* Perfil: header se comprime un poco al hacer scroll */
.headerContextScrolled .headerInner {
  padding-top: 2px;
  padding-bottom: 2px;
  min-height: 40px;
}

.headerMobileSearchOpen {
  background: transparent;
}

.headerInner {
  width: 100%;
  min-height: 48px;
  padding-top: 4px;
  padding-bottom: 4px;
  box-sizing: border-box;
  overflow: visible;
  transition: padding-top 220ms ease, padding-bottom 220ms ease, min-height 220ms ease;
}

.headerInnerMobileSearchOpen {
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

          .desktopHeader {
            display: none;
          }

.mobileHeaderRow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 40px;
}

.mobileSearchRow {
  display: flex;
  min-height: 44px;
  align-items: center;
  overflow: visible;
}

.mobileSearchCol {
  min-height: 44px;
  display: flex;
  align-items: center;
  overflow: visible;
}

          .contentArea,
          .contentAreaWithWallet {
            grid-template-columns: 1fr;
            width: 100%;
            gap: 0;
            /* El padding lateral ya lo pone a 0 --shell-pad-inline / --wallet-rail-pad
               unas líneas más arriba. Anularlo aquí no servía: escrito como propiedad
               lógica simétrica el compilador lo colapsa a físicas y se queda con menos
               especificidad que la regla de escritorio, que sí se parte por :lang(). */
            padding-top: 10px;
            padding-bottom: calc(16px + var(--vb-safe-bottom, 0px));
          }

          .sidebarCol,
          .walletCol {
            display: none;
          }

          .mainCol {
            width: 100%;
            min-width: 0;
            overflow-x: clip;
          }

          .mainInner {
            width: 100%;
          }
        }

        /* El hueco del nav inferior va atado a DÓNDE EXISTE ese nav (≤768px), no
           al breakpoint de columnas (≤900px). Estando en el de 900 la franja de
           769–900px reservaba 84px para una barra que ahí no se dibuja: vacío al
           final del scroll en tablets y ventanas a medio ancho.

           Cuentas del clearance: el nav mide 8 + 54 + 8 = 70px más la safe-area
           constante; 84 deja un respiro por encima de eso. */
        /* UN SOLO sitio para el hueco del nav inferior.

           Estaba repartido entre .contentArea, .mainCol y el padding propio de
           cada página, y los cuatro se apilaban: el resultado era el doble de lo
           necesario y nadie podía calcularlo leyendo un archivo. Aquí .contentArea
           cede su padding y .mainCol carga con todo.

           El alto del nav NO se escribe aquí: lo publica él mismo en
           --vb-bottom-nav-h (ver MobileBottomNav). No es constante —se encoge a
           0.75 al bajar y tras cinco segundos quieto—, así que un número fijo se
           calibra con el nav expandido y deja ~23px de vacío justo al final del
           scroll, que es cuando está encogido. El respaldo de 90px solo vale
           hasta la primera medida. */
        @media (max-width: 768px) {
          .contentArea,
          .contentAreaWithWallet {
            padding-bottom: 0;
          }

          .mainCol {
            padding-bottom: calc(var(--vb-bottom-nav-h, 90px) + 12px);
          }

          /* Rutas con la flecha de subir (home, perfil y comunidad; la marca la
             pone ScrollToTopFAB). La flecha se ancla a 54px del fondo y mide
             58px, así que su borde superior llega a 112px + safe-area; con 124
             el último post le queda 12px por encima, el mismo respiro. */
          :global(body.vb-scroll-fab-route) .mainCol {
            padding-bottom: calc(124px + var(--vb-safe-bottom, 0px));
          }
        }

@media (max-width: 900px) {
  .floatingLogoutWrap {
    display: none;
  }
}

        @media (max-width: 520px) {
          .mobileHeaderRow {
            gap: 8px;
          }

          .mobileBrand {
            max-width: 28vw;
          }

          .mobileActions {
            gap: 6px;
          }
        }
      `}</style>

      <MobileHeaderCtx.Provider value={{ ...headerData, setMobileHeader: setHeaderData }}>
      <div className="layout">
{!isReelsPage && (
<div
  ref={safeAreaRef}
  className={`safeAreaHeaderBackdrop${(isHomePage || isWalletPage) && homeHeaderHidden ? " safeAreaHidden" : ""}`}
/>
)}

{!isReelsPage && (
<header
  ref={headerRef}
  data-hidden={desktopHeaderHidden ? "true" : undefined}
  className={[
    "header",
    mobileSearchOpen ? "headerMobileSearchOpen" : "",
    (isHomePage || isWalletPage) && homeHeaderHidden ? "headerFadeHome" : "",
    isProfilePage && contextScrolled ? "headerContextScrolled" : "",
  ].filter(Boolean).join(" ")}
>
          <div
  className={[
    "headerInner",
    mobileSearchOpen ? "headerInnerMobileSearchOpen" : "",
  ].filter(Boolean).join(" ")}
>
            <div className="desktopHeader">
              <div className="brandCol">
<Link href="/" className="brand" aria-label={tNav("goHome")}>
  <span className="brandLogo">Vibra</span>
</Link>
              </div>

              <div className="desktopMainCluster">
                <div className="desktopSearchCol">
                  <GroupsSearchPanel
                    fontStack={fontStack}
                    showCreateGroup={false}
                    createGroupHref="/groups/new"
                  />
                </div>

              </div>

<div className="desktopHeaderActions">
                <VibraNavigationIconsStyles />

                {user ? (
                  <div className="desktopHeaderQuickLinks">
                    {/* Campanita: abre un panel flotante con las notificaciones
                        agregadas (likes, comentarios, follows, comunidades). */}
                    <NotificationBell active={pathname.startsWith("/notifications")} />
                    {/* La estrella de experiencias se mudo al menu lateral
                        derecho, bajo Guardados (ver WalletDesktopRail). Aqui
                        competia por sitio con la campana. */}
                  </div>
                ) : null}

                <CurrencySwitcher variant="desktop" />
                <LanguageSwitcher variant="desktop" />
                {user ? (
                  <LogoutButton variant="headerIcon" className="headerLogoutBtn" />
                ) : null}
              </div>
            </div>

{(
  <div className={`mobileHeaderRow${isProfilePage && contextScrolled ? " mobileHeaderScrolled" : ""}`}>
    {/* Contenido por defecto: logo + acciones */}
    <div className="mobileHeaderDefault">
      <Link
        href="/"
        className="mobileBrand mobileBrandVisible"
        aria-label={tNav("goHome")}
      >
        <span className="mobileBrandLogo">Vibra</span>
      </Link>
      <div className="mobileActions">
        {/* Campanita del panel para el rango de laptop angosto (769–900px), donde
            el header de escritorio se oculta. En celular (≤768px) se oculta y las
            notificaciones se ven en el nav inferior (que va al page). */}
        {user ? (
          <span className="mobileNotifBell">
            <NotificationBell active={pathname.startsWith("/notifications")} />
          </span>
        ) : null}
        {user && hasPurchasedExperiences ? (
          <span className="mobileNotifBell">
            <Link
              href="/experiencias"
              aria-label={tNav("tabExperiences")}
              style={{ position: "relative", display: "inline-grid", placeItems: "center", width: 36, height: 36, borderRadius: 10, color: "#fff" }}
            >
              <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3.2l2.7 5.47 6.03.88-4.36 4.25 1.03 6.0L12 17.9l-5.4 2.84 1.03-6.0L3.27 9.55l6.03-.88z" />
              </svg>
              {experiencesBadge ? (
                <span aria-hidden="true" style={{ position: "absolute", top: 5, insetInlineEnd: 5, width: 8, height: 8, borderRadius: 999, background: "#ff3b30", boxShadow: "0 0 0 2px rgba(0,0,0,0.55)" }} />
              ) : null}
            </Link>
          </span>
        ) : null}
        <IconButton label={tNav("viewSaved")} size="sm" tone="bare" shape="square" style={{ minWidth: "32px" }} onClick={() => router.push("/saved")} className="mobileSearchIconButton">
          <VibraSavedPostIcon size={22} color="#a855f7" />
        </IconButton>
        <IconButton label={tNav("searchCommunity")} size="sm" tone="bare" shape="square" style={{ minWidth: "32px" }} onClick={() => setMobileSearchOpen(true)} className="mobileSearchIconButton">
          <VibraNavigationIcon type="search" size={24} strokeWidth={2.2} />
        </IconButton>
      </div>
    </div>

    {/* Barra contextual: avatar + nombre (solo en páginas de perfil) */}
    {isProfilePage && (
      <div className="mobileHeaderContext">
        <div className="mobileContextAvatar">
          {headerData.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headerData.avatarUrl} alt="" />
          ) : (
            <span>{headerData.name?.slice(0, 1).toUpperCase() ?? ""}</span>
          )}
        </div>
        {headerData.name && (
          <span className="mobileContextName">{headerData.name}</span>
        )}
      </div>
    )}
  </div>
)}
          </div>
        </header>
        )}

        <div className={contentAreaClassName}>
          {!isEmbed && (
            <div className="sidebarCol">
              <OwnerSidebar />
            </div>
          )}

          <main className="mainCol">
            <div className="mainInner" ref={mainInnerRef}>{children}</div>
          </main>

          {!isEmbed && (
            <div className="walletCol">
              <WalletDesktopRail
                activePath={pathname}
                showWallet={hasMonetization}
                showExperiences={hasPurchasedExperiences}
                experiencesBadgeCount={experiencesBadgeCount}
              />
            </div>
          )}
        </div>

       {/* El propio botón decide en qué rutas se pinta (solo feeds). La `key`
           lo remonta limpio en cada ruta; ver la nota en el componente. */}
       {!isEmbed && <ScrollToTopFAB key={pathname} />}
       {!isEmbed && <MobileBottomNav showWallet={!!user} />}
       {!isEmbed && <PushEnablePrompt />}
      </div>

       {/* Búsqueda móvil: página completa negra que entra deslizándose de derecha
           a izquierda. La app de atrás no se mueve. Estilos inline porque
           styled-jsx no scopea clases sobre componentes como motion.div. */}
       <AnimatePresence>
         {mobileSearchOpen && (
           <motion.div
             key="mobile-search-page"
             initial={{ x: "100%" }}
             animate={{ x: 0 }}
             exit={{ x: "100%" }}
             transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.9 }}
             style={{
               position: "fixed",
               inset: 0,
               zIndex: 200,
               background: "#000",
               display: "flex",
               flexDirection: "column",
               paddingTop: "env(safe-area-inset-top, 0px)",
               paddingInlineStart: "env(safe-area-inset-left, 0px)",
               paddingInlineEnd: "env(safe-area-inset-right, 0px)",
               boxSizing: "border-box",
               willChange: "transform",
             }}
           >
             <div
               style={{
                 flex: 1,
                 minHeight: 0,
                 display: "flex",
                 flexDirection: "column",
                 padding: "10px 12px calc(12px + var(--vb-safe-bottom, 0px))",
                 boxSizing: "border-box",
               }}
             >
               <GroupsSearchPanel
                 fontStack={fontStack}
                 showCreateGroup={false}
                 createGroupHref="/groups/new"
                 showCloseSearch={true}
                 onCloseSearch={() => setMobileSearchOpen(false)}
                 autoFocusOnMount={true}
                 fullPage
               />
             </div>
           </motion.div>
         )}
       </AnimatePresence>
      </MobileHeaderCtx.Provider>
    </ChatDockProvider>
  );
}

export default function PublicProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, authTransitionMode } = useAuth();

  // Hasta que el componente monte en el cliente, el estado de sesión aún no
  // está resuelto (Firebase Auth resuelve async). Si decidiéramos el shell
  // público vs. autenticado en el primer render, el HTML del servidor no
  // coincidiría con el del cliente → error de hidratación. Renderizamos el
  // mismo placeholder neutro hasta montar; luego ya ramificamos con seguridad.
  // No cambia la lógica de autenticación.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  /**
   * Desvío del SUPERMODERADOR DE PLATAFORMA a su panel.
   *
   * ⚠️ No confundirlo con un moderador de COMUNIDAD, que sí es un usuario normal con su
   * perfil y su wallet. Este es de plataforma: no tiene perfil ni lo necesita.
   *
   * El desvío existía SOLO en el login y en completar perfil, así que con la sesión ya
   * abierta —o entrando por una URL directa— caía en la aplicación normal, sin perfil y sin
   * forma de crearlo. Aquí se cubre cualquier ruta protegida.
   *
   * Se exige el claim Y que la sesión sea de Google, las mismas dos condiciones que el
   * panel y el backend: si el claim viajara sin Google, el panel lo rechazaría y este
   * desvío lo dejaría dando vueltas entre las dos pantallas.
   */
  const router = useRouter();
  const [esSupermoderador, setEsSupermoderador] = useState(false);
  useEffect(() => {
    if (!user) {
      // Sin sesión no hay nada que comprobar. La bandera se deja como esté: el propio
      // layout ya cae al shell público, y escribirla aquí dispara renders en cascada.
      return;
    }
    // ⚠️ DENTRO DE UN MARCO no se desvía: el panel de moderación lleva un navegador
    // interno para recorrer el sitio como lo ve cualquiera, y ahí el supermoderador SÍ
    // tiene que ver la aplicación normal. Sin esta salida, ese marco cargaba una ruta
    // protegida, el desvío lo mandaba al panel y el panel se dibujaba dentro de sí mismo.
    if (typeof window !== "undefined" && window.self !== window.top) return;
    let vigente = true;
    user
      .getIdTokenResult()
      .then((r) => {
        if (!vigente) return;
        const esMod = r.claims["role"] === "moderator" && r.signInProvider === "google.com";
        if (!esMod) return;
        setEsSupermoderador(true);
        router.replace("/admin");
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [user, router]);

  // El primer render del cliente DEBE ser idéntico al del servidor. En el
  // servidor `loading` se queda en true (no hay onAuthStateChanged) → placeholder.
  // Gateamos con `!mounted` (no solo `loading`) porque en el cliente Firebase
  // resuelve la sesión antes de hidratar y `loading` ya sería false en el 1er
  // render → ramificaría al shell autenticado y no coincidiría con el servidor.
  if (!mounted || loading || authTransitionMode === "exiting") {
    return <div style={{ minHeight: "100dvh", background: "#000" }} />;
  }

  // Un SUPERMODERADOR DE PLATAFORMA no tiene sitio en esta parte de la aplicación: no
  // tiene perfil, ni wallet, ni servicios. Se le lleva a su panel.
  if (esSupermoderador) {
    return <div style={{ minHeight: "100dvh", background: "#000" }} />;
  }

  if (user) {
    return <AuthenticatedProfileShell>{children}</AuthenticatedProfileShell>;
  }

  return <PublicProfileShell>{children}</PublicProfileShell>;
}