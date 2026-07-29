// Layout de grupos 

"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { motion, AnimatePresence } from "framer-motion";
import VibraSavedPostIcon from "@/app/components/VibraServiceIcons/VibraSavedPostIcon";
import { useAuth } from "@/app/providers";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";
import MobileBottomNav from "@/app/components/MobileBottomNav";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { useMobileHeaderFade } from "@/app/hooks/useMobileHeaderFade";
import { VibraNavigationIcon, VibraNavigationIconsStyles } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import NotificationBell from "@/app/components/Notifications/NotificationBell";
import LogoutButton from "@/app/LogoutButton";
import WalletDesktopRail from "@/app/components/WalletDesktopRail/WalletDesktopRail";
import { MobileHeaderCtx, type MobileHeaderData } from "@/app/contexts/MobileHeaderContext";
import { consumeNavSlideDir } from "@/lib/nav-slide";


function PublicGroupsShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style jsx>{`
        .layout {
          width: 100%;
          min-width: 0;
          min-height: auto;
          background: transparent;
          color: #fff;
          overflow-x: clip;
        }

        .contentArea {
          width: min(820px, calc(100% - 28px));
          min-width: 0;
          margin: 0 auto;
          padding-top: 24px;
          padding-bottom: calc(24px + env(safe-area-inset-bottom));
          box-sizing: border-box;
        }

        @media (max-width: 900px) {
          .contentArea {
            width: min(720px, calc(100% - 20px));
            padding-top: 10px;
            padding-bottom: calc(18px + env(safe-area-inset-bottom));
          }
        }
      `}</style>

      <div className="layout">
        <div className="contentArea">{children}</div>
      </div>
    </>
  );
}

function AuthenticatedGroupsShell({
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
const { headerRef, safeAreaRef } = useMobileHeaderFade();
const mainInnerRef = useRef<HTMLDivElement>(null);
const pendingAnimDirRef = useRef<"left" | "right" | null>(null);

// Estado para header contextual (avatar + nombre del grupo)
const [headerData, setHeaderData] = useState<MobileHeaderData>({ avatarUrl: null, name: null });
const [contextScrolled, setContextScrolled] = useState(false);

// Páginas de grupo específico: /groups/[groupId]/... (excluyendo /groups/new)
const isGroupDetailPage = /^\/groups\/[^/]+/.test(pathname) && !pathname.startsWith("/groups/new");
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

  // Restore scroll before paint so there's no visible jump
  useLayoutEffect(() => {
    const dir = consumeNavSlideDir();
    if (!dir) return;
    const saved = sessionStorage.getItem(`nav:scroll:${pathname}`);
    window.scrollTo({ top: saved !== null ? parseInt(saved) : 0, behavior: "instant" });
    pendingAnimDirRef.current = dir;
  }, [pathname]);

  // Animate after paint so position:fixed children are in the DOM when iOS
  // creates the transform stacking context.
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

useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setMobileSearchOpen(false);
  setContextScrolled(false);
}, [pathname]);

// Scroll listener: context shrink solo en páginas de grupo específico
useEffect(() => {
  if (!isGroupDetailPage) return;

  const handler = () => {
    // Histéresis: se activa al pasar el nombre (>80) y NO vuelve al header
    // original hasta llegar arriba (y<=4). Al subir, el header mini se mantiene
    // hasta el tope en vez de revertir apenas bajas de 80.
    const y = window.scrollY;
    if (y > 80) setContextScrolled(true);
    else if (y <= 4) setContextScrolled(false);
  };

  window.addEventListener("scroll", handler, { passive: true });
  return () => window.removeEventListener("scroll", handler);
}, [pathname, isGroupDetailPage]);


const contentAreaClassName = isEmbed
  ? "contentArea contentAreaEmbed"
  : "contentArea contentAreaWithWallet";

  return (
    <>
      <style jsx>{`
        .layout {
          --shell-gutter: 16px;
          --sidebar-width: 300px;
          --wallet-rail-width: 280px;
          --main-max-width: 860px;
          --shell-column-gap: 24px;
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
  left: 0;
  right: 0;
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

.headerInner,
.headerInner a,
.headerInner button,
.headerInner input {
  pointer-events: auto;
}

.headerInner {
  width: 100%;
  min-height: 56px;
  padding-left: max(var(--shell-gutter), env(safe-area-inset-left, 0px));
  padding-right: max(var(--shell-gutter), env(safe-area-inset-right, 0px));
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
  margin-left: 10px;
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
  margin-left: 8px;
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
  gap: var(--desktop-search-gap);
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

        /* Botón de cerrar sesión (icono) a la derecha del switch de idioma. */
        .desktopHeaderActions :global(.headerLogoutBtn) {
          background: transparent;
          margin-left: 2px;
          transition: background 140ms ease;
        }
        .desktopHeaderActions :global(.headerLogoutBtn:hover) {
          background: rgba(255, 255, 255, 0.1);
        }

        /* Accesos rápidos (notificaciones / wallet), junto al switch de monedas.
           margin-right los despega un poco de él, corriéndolos a la izquierda. */
        .desktopHeaderQuickLinks {
          display: flex;
          align-items: center;
          gap: 18px;
          margin-right: 72px;
          flex: 0 0 auto;
        }

        /* Anclado en el div (styled-jsx no scopea clases sobre componentes como
           Link) y bajando con :global hasta el <a>. */
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

        /* Los iconos del set Vibra traen el trazo morado de marca; en el header
           van en blanco. El CSS gana sobre el atributo stroke del SVG. */
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

.mobileHeaderDefault {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.mobileHeaderContext {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  opacity: 0;
  transform: translateY(5px);
  pointer-events: none;
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

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
  font-weight: 600;
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
          margin-left: auto;
          flex-shrink: 0;
        }

        /* Campanita del panel en el header móvil: solo en laptop angosto (769–900px);
           oculta ≤768px (celular usa el nav inferior). */
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
  flex: 1;
  padding-left: var(--shell-gutter);
  padding-right: var(--shell-gutter);
  padding-top: 0;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  box-sizing: border-box;
  align-items: start;
}

.contentAreaWithWallet {
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  padding-right: calc(var(--wallet-rail-width) + var(--shell-column-gap) + var(--shell-gutter));
}

.contentAreaEmbed {
  grid-template-columns: minmax(0, 1fr);
  padding-left: 0;
  padding-right: 0;
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
  padding-bottom: 90px;
  align-self: start;
}

.mainInner {
  width: min(var(--main-max-width), 100%);
  margin-left: auto;
  margin-right: auto;
  margin-top: 0;
}

.walletCol {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 64px);
  right: max(var(--shell-gutter), env(safe-area-inset-right));
  bottom: calc(8px + env(safe-area-inset-bottom));
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
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
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
}

.safeAreaHeaderBackdrop {
  background: #000000;
}

.header {
  position: sticky;
  background: transparent;
  transition: opacity 220ms ease;
}

/* Grupo: header se comprime al hacer scroll en página de detalle */
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
  transition: padding-top 220ms ease, padding-bottom 220ms ease, min-height 220ms ease;
  box-sizing: border-box;
  overflow: visible;
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
  pointer-events: auto;
}

.mobileBrand {
  display: flex;
  pointer-events: auto;
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
            padding-left: 0;
            padding-right: 0;
            padding-top: 10px;
            padding-bottom: calc(16px + env(safe-area-inset-bottom));
          }

          .sidebarCol,
          .walletCol {
            display: none;
          }

          .mainCol {
            width: 100%;
            min-width: 0;
            overflow-x: clip;
            padding-bottom: calc(100px + env(safe-area-inset-bottom));
          }

          .mainInner {
            width: 100%;
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
<div ref={safeAreaRef} className="safeAreaHeaderBackdrop" />

<header
  ref={headerRef}
  className={[
    "header",
    mobileSearchOpen ? "headerMobileSearchOpen" : "",
    isGroupDetailPage && contextScrolled ? "headerContextScrolled" : "",
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
                        agregadas (mismo componente que el header de home). */}
                    <NotificationBell active={pathname.startsWith("/notifications")} />
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
  <div className={`mobileHeaderRow${isGroupDetailPage && contextScrolled ? " mobileHeaderScrolled" : ""}`}>
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
        {/* Campanita del panel para el rango de laptop angosto (769–900px). En
            celular (≤768px) se oculta; ahí notificaciones vive en el nav inferior. */}
        {user ? (
          <span className="mobileNotifBell">
            <NotificationBell active={pathname.startsWith("/notifications")} />
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => router.push("/saved")}
          title={tNav("saved")}
          aria-label={tNav("viewSaved")}
          className="mobileSearchIconButton"
        >
          <VibraSavedPostIcon size={22} color="#a855f7" />
        </button>
        <button
          type="button"
          onClick={() => setMobileSearchOpen(true)}
          title={tNav("searchCommunity")}
          aria-label={tNav("searchCommunity")}
          className="mobileSearchIconButton"
        >
          <VibraNavigationIcon type="search" size={24} strokeWidth={2.2} />
        </button>
      </div>
    </div>

    {/* Barra contextual: avatar + nombre (solo en páginas de grupo específico) */}
    {isGroupDetailPage && (
      <div className="mobileHeaderContext">
        <div className="mobileContextAvatar">
          {headerData.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headerData.avatarUrl} alt="" />
          ) : (
            <span>{headerData.name?.slice(0, 2).toUpperCase() ?? ""}</span>
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
              />
            </div>
          )}
        </div>

       {!isEmbed && <MobileBottomNav showWallet={!!user} />}
      </div>

       {/* Búsqueda móvil: página completa negra que entra deslizándose de derecha
           a izquierda. Estilos inline (styled-jsx no scopea sobre motion.div). */}
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
               paddingLeft: "env(safe-area-inset-left, 0px)",
               paddingRight: "env(safe-area-inset-right, 0px)",
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
                 padding: "10px 12px calc(12px + env(safe-area-inset-bottom, 0px))",
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
    </>
  );
}

export default function GroupsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, authTransitionMode } = useAuth();

  if (authTransitionMode === "exiting") {
    return <div style={{ minHeight: "100dvh", background: "#000" }} />;
  }

  if (user) {
    return <AuthenticatedGroupsShell>{children}</AuthenticatedGroupsShell>;
  }

  return <PublicGroupsShell>{children}</PublicGroupsShell>;
}