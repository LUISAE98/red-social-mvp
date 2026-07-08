// Layout de grupos 

"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import VibraSavedPostIcon from "@/app/components/VibraServiceIcons/VibraSavedPostIcon";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import MobileBottomNav from "@/app/components/MobileBottomNav";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { useMobileHeaderFade } from "@/app/hooks/useMobileHeaderFade";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
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
const { hasWallet: showWalletRail } = useWalletVisibility(user?.uid);
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
  setMobileSearchOpen(false);
  setContextScrolled(false);
}, [pathname]);

// Scroll listener: context shrink solo en páginas de grupo específico
useEffect(() => {
  if (!isGroupDetailPage) return;

  const handler = () => {
    setContextScrolled(window.scrollY > 80);
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

          min-height: 100vh;
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

        .brandLogo {
  display: block;
  width: 112px;
  height: auto;
  object-fit: contain;
}

.mobileBrandLogo {
  display: block;
  width: 86px;
  height: auto;
  object-fit: contain;
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

        .desktopLogoutWrap {
          display: none;
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
  color: #a855ff;
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

        .mobileSearchIconButton {
  width: 32px;
  height: 32px;
  min-width: 32px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #a855ff;
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
  top: calc(env(safe-area-inset-top) + 90px);
  right: max(var(--shell-gutter), env(safe-area-inset-right));
  bottom: calc(24px + env(safe-area-inset-bottom));
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
  <Image src="/logotipo.png" alt="Vibra" width={112} height={32} className="brandLogo" />
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

              <div className="desktopLogoutWrap">
                <LogoutButton />
              </div>
            </div>

{mobileSearchOpen ? (
  <div className="mobileSearchRow">
    <div className="mobileSearchCol">
      <GroupsSearchPanel
        fontStack={fontStack}
        showCreateGroup={false}
        createGroupHref="/groups/new"
        showCloseSearch={true}
        onCloseSearch={() => setMobileSearchOpen(false)}
        autoFocusOnMount={true}
      />
    </div>
  </div>
) : (
  <div className={`mobileHeaderRow${isGroupDetailPage && contextScrolled ? " mobileHeaderScrolled" : ""}`}>
    {/* Contenido por defecto: logo + acciones */}
    <div className="mobileHeaderDefault">
      <Link
        href="/"
        className="mobileBrand mobileBrandVisible"
        aria-label={tNav("goHome")}
      >
        <Image src="/logotipo.png" alt="Vibra" width={86} height={25} className="mobileBrandLogo" />
      </Link>
      <div className="mobileActions">
        <button
          type="button"
          onClick={() => router.push("/saved")}
          title={tNav("saved")}
          aria-label={tNav("viewSaved")}
          className="mobileSearchIconButton"
        >
          <VibraSavedPostIcon size={22} color="#a855ff" />
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
                showWallet={showWalletRail}
              />
            </div>
          )}
        </div>

       {!isEmbed && <MobileBottomNav showWallet={showWalletRail} />}
      </div>
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