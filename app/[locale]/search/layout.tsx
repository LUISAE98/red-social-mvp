"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import VibraSavedPostIcon from "@/app/components/VibraServiceIcons/VibraSavedPostIcon";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import MobileBottomNav from "@/app/components/MobileBottomNav";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { useMobileHeaderFade } from "@/app/hooks/useMobileHeaderFade";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
  type VibraNavigationIconType,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

function usePersistentSidebarScroll(key: string, restoreSignal?: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isRestoringRef = useRef(false);

  const restoreScroll = () => {
    const el = scrollRef.current;
    if (!el) return;

    const saved = sessionStorage.getItem(key);
    if (saved === null) return;

    const target = Number(saved);
    if (!Number.isFinite(target)) return;

    isRestoringRef.current = true;

el.scrollTop = target;

setTimeout(() => {
  el.scrollTop = target;
  isRestoringRef.current = false;
}, 80);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const saveScroll = () => {
      if (isRestoringRef.current) return;

      const canScroll = el.scrollHeight > el.clientHeight + 1;
      if (!canScroll) return;

      sessionStorage.setItem(key, String(el.scrollTop));
    };

    el.addEventListener("scroll", saveScroll, { passive: true });

    return () => {
      saveScroll();
      el.removeEventListener("scroll", saveScroll);
    };
  }, [key]);

useLayoutEffect(() => {
  restoreScroll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [key, restoreSignal]);

  return scrollRef;
}

type WalletRailTab = "finances" | "calendar" | "pending" | "history";
type MainRailTab = "home" | "saved";

function resolveWalletRailTab(pathname: string): WalletRailTab | null {
  if (pathname.startsWith("/wallet/finanzas")) return "finances";
  if (pathname.startsWith("/wallet/calendario")) return "calendar";
  if (pathname.startsWith("/wallet/pendientes")) return "pending";
  if (pathname.startsWith("/wallet/historial")) return "history";
  return null;
}

function resolveMainRailTab(pathname: string): MainRailTab | null {
  if (pathname === "/" || pathname.startsWith("/home")) return "home";
  if (pathname.startsWith("/saved")) return "saved";
  return null;
}

function WalletDesktopRail({
  activePath,
  showWallet,
}: {
  activePath: string;
  showWallet: boolean;
}) {
  const walletItems: Array<{
    key: WalletRailTab;
    label: string;
    href: string;
    icon: VibraNavigationIconType;
  }> = [
    {
      key: "finances",
      label: "Finanzas",
      href: "/wallet/finanzas",
      icon: "finance",
    },
    {
      key: "calendar",
      label: "Calendario",
      href: "/wallet/calendario",
      icon: "calendar",
    },
    {
      key: "pending",
      label: "Pendientes",
      href: "/wallet/pendientes",
      icon: "pending",
    },
    {
      key: "history",
      label: "Historial",
      href: "/wallet/historial",
      icon: "history",
    },
  ];

  const mainItems: Array<{
    key: MainRailTab;
    label: string;
    href: string;
    icon: VibraNavigationIconType;
  }> = [
    {
      key: "home",
      label: "Inicio",
      href: "/",
      icon: "home",
    },
    {
      key: "saved",
      label: "Guardados",
      href: "/saved",
      icon: "saved",
    },
  ];

  const activeWalletTab = resolveWalletRailTab(activePath);
  const activeMainTab = resolveMainRailTab(activePath);
 const sidebarScrollRef = usePersistentSidebarScroll(
  "vibra-wallet-rail-scroll",
  showWallet
);

  return (
    <>
      <VibraNavigationIconsStyles />

      <style jsx>{`
.walletRail {
  width: min(100%, 250px);
  height: 100%;
  min-height: 0;
  margin-left: auto;
  margin-right: auto;
  overflow: hidden;
  box-sizing: border-box;

  display: flex;
  flex-direction: column;
}

.walletRailCenter {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: clamp(12px, 2vh, 20px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 18px;
  scrollbar-width: none;
}

.walletRailCenter::-webkit-scrollbar {
  display: none;
}

.railSection {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  gap: 10px;

  padding: 14px 14px;
  box-sizing: border-box;

  border-radius: 12px;
  border: 1px solid rgba(168, 85, 255, 0.08);

  background:
    linear-gradient(
      135deg,
      rgb(3, 3, 6) 0%,
      rgb(8, 5, 13) 48%,
      rgb(0, 0, 0) 100%
    );

  backdrop-filter: none;
  -webkit-backdrop-filter: none;

  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    inset 0 -1px 0 rgba(255, 255, 255, 0.015),
    inset 0 0 14px rgba(168, 85, 255, 0.012),
    0 0 8px rgba(168, 85, 255, 0.022),
    0 18px 54px rgba(0, 0, 0, 0.68);
}

.railSection::before {
  content: "";
  position: absolute;
  inset: -38%;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 10%, rgba(168, 85, 255, 0.045), transparent 34%),
    radial-gradient(circle at 86% 18%, rgba(126, 34, 206, 0.032), transparent 36%),
    radial-gradient(circle at 22% 92%, rgba(168, 85, 255, 0.025), transparent 40%);
  filter: blur(24px);
  opacity: 0.32;
  z-index: 0;
}
.railSection::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 18px rgba(79, 70, 255, 0.045),
    inset 0 0 14px rgba(168, 85, 255, 0.045),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  z-index: 1;
}

.railSection > * {
  position: relative;
  z-index: 2;
}

.railSection + .railSection {
  margin-top: 0;
}

.createCommunitySection + .railSection {
  margin-top: 0;
}

.logoutSection {
  width: 100%;
  margin-top: 14px;
  flex: 0 0 auto;
}

.logoutSection :global(button) {
  width: 100%;
  height: 40px;
  min-height: 40px;
  filter: saturate(0.84) brightness(0.93);
  box-shadow: 0 7px 18px rgba(168, 85, 255, 0.11);
}

@media (max-height: 760px) {
  .createCommunitySection {
    transform: none;
  }
  .walletRailCenter {
    gap: 10px;
  }

  .railSection {
    padding: 12px 14px;
    gap: 6px;
  }

  .createCommunityImage {
    width: 108px;
    max-width: 108px;
    margin: -12px auto -20px;
  }

  .createCommunityCopy {
    margin-bottom: 2px;
  }

  .createCommunityCopy strong {
    font-size: 14px;
  }

  .createCommunityCopy span {
    font-size: 11px;
    line-height: 1.12;
  }

  .createCommunitySection :global(.createCommunityButton) {
    height: 36px;
    min-height: 36px;
  }

  .logoutSection :global(button) {
    height: 38px;
    min-height: 38px;
  }
}

.walletTitle {
  margin: 0 0 2px;
  font-size: 17px;
  line-height: 1.2;
  font-weight: 550;
  letter-spacing: -0.02em;
  color: #fff;
}

.secondaryTitle {
  margin: 0 0 2px;
  font-size: 17px;
  line-height: 1.2;
  font-weight: 550;
  letter-spacing: -0.02em;
  color: #fff;
}

@keyframes railAuraMove {
  from {
    transform: translate3d(-2%, -1%, 0) scale(1);
  }

  to {
    transform: translate3d(2%, 1.5%, 0) scale(1.06);
  }
}

.createCommunitySection {
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  overflow: visible;
  margin-top: 0;
  gap: clamp(3px, 0.55vh, 6px);
  align-items: center;

  transform: none;
}

.createCommunitySection::before,
.createCommunitySection::after {
  display: none;
}

.createCommunityImage {
  width: 300px;
  max-width: 300px;
  height: auto;
  display: block;
  margin: -6px auto -14px;
  object-fit: contain;
  transform: translateX(-35px);
}

.createCommunityCopy {
  margin-bottom: 5px;
  display: grid;
  gap: 2px;
  color: #fff;
  text-align: center;
  justify-items: center;
  font-family: inherit;
}

.createCommunityCopy strong {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.02em;
}

.createCommunityCopy span {
  font-size: 12px;
  font-weight: 400;
  line-height: 1.28;
  color: rgba(255, 255, 255, 0.76);
}

.createCommunitySection :global(.createCommunityButton) {
opacity: 0.85;
  width: 100%;
  height: 40px;
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
  box-shadow: 0 7px 18px rgba(168, 85, 255, 0.11);
  filter: saturate(0.84) brightness(0.93);
  overflow: hidden;
  text-decoration: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.walletNav {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.walletLink:hover {
  color: rgba(255, 255, 255, 0.84);
  transform: translateX(2px);
}

.walletLink:hover .walletIcon {
  color: rgba(255, 255, 255, 0.72);
  opacity: 0.86;
  filter: saturate(0.7) brightness(1);
}

.walletIcon {
  width: 22px;
  min-width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.68);
  opacity: 0.82;
  filter: saturate(0.65) brightness(0.96);
  transform: translateY(3.5px);
  margin-right: 8px;
  transition:
    color 180ms ease,
    opacity 180ms ease,
    filter 180ms ease;
}

.walletLabel {
  min-width: 0;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.74);
  transition: color 180ms ease;
}
:global(.walletLinkActive) .walletIcon {
  color: #a855ff;
  opacity: 1;
  filter: saturate(1) brightness(1);
}

:global(.walletLinkActive) .walletLabel {
  color: #ffffff;
}

:global(.walletLinkActive) {
  color: #ffffff;
  font-weight: 700;
  border-radius: 15px;
  position: relative;
  overflow: hidden;

  background:
    radial-gradient(circle at 18% 50%, rgba(236, 72, 153, 0.23), transparent 34%),
    radial-gradient(circle at 80% 45%, rgba(79, 70, 229, 0.25), transparent 36%),
    radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.23), transparent 42%),
    linear-gradient(
      135deg,
      #09090f 0%,
      #050509 52%,
      #000000 100%
    );

  padding: 3px 12px;
  margin-left: -2px;
  margin-right: -2px;

  box-shadow:
    inset 0 0 10px rgba(255, 255, 255, 0.04),
    inset 0 0 18px rgba(124, 58, 237, 0.16),
    0 0 14px rgba(124, 58, 237, 0.20);
}

:global(.walletLinkActive)::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;

  background:
    linear-gradient(
      110deg,
      transparent 0%,
      rgba(236, 72, 153, 0.13) 25%,
      rgba(124, 58, 237, 0.18) 50%,
      rgba(79, 70, 229, 0.13) 75%,
      transparent 100%
    );

  opacity: 0.82;
}

@keyframes walletActiveAura {
  0% {
    transform: translateX(-8%);
  }

  100% {
    transform: translateX(8%);
  }
}
      `}</style>

      <aside className="walletRail" aria-label="Accesos directos">
                <div className="walletRailCenter" ref={sidebarScrollRef}>
          <section className="railSection mainMenuSection" aria-label="Navegación principal">
            <h3 className="secondaryTitle">Menú</h3>

            <nav className="walletNav">
              {mainItems.map((item) => {
                const isActive = activeMainTab === item.key;

                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`walletLink ${isActive ? "walletLinkActive" : ""}`}
                  >
                    <span className="walletIcon" aria-hidden="true">
                      <VibraNavigationIcon type={item.icon} size={21} />
                    </span>
                    <span className="walletLabel">{item.label}</span>

                  </Link>
                );
              })}
            </nav>
          </section>

          <section className="railSection createCommunitySection" aria-label="Crear comunidad">
            <Image
              src="/Crear-comunidad.png"
              alt=""
              width={108} height={72}
              className="createCommunityImage"
              aria-hidden="true"
            />

            <div className="createCommunityCopy">
              <strong>Crea tu comunidad</strong>
              <span>
                Conecta, comparte y
                <br />
                monetiza tu pasión.
              </span>
            </div>

            <Link href="/groups/new" className="createCommunityButton">
              Crear comunidad
            </Link>
          </section>

          {showWallet ? (
            <section className="railSection" aria-label="Wallet">
              <h3 className="walletTitle">Wallet</h3>

              <nav className="walletNav">
                {walletItems.map((item) => {
                  const isActive = activeWalletTab === item.key;

                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={`walletLink ${isActive ? "walletLinkActive" : ""}`}
                    >
                      <span className="walletIcon" aria-hidden="true">
                        <VibraNavigationIcon type={item.icon} size={21} />
                      </span>
                      <span className="walletLabel">{item.label}</span>


                    </Link>
                  );
                })}
              </nav>
            </section>
          ) : null}
        </div>

        <section className="logoutSection" aria-label="Cerrar sesión">
          <LogoutButton variant="settings" />
        </section>
      </aside>
    </>
  );
}

function PublicSearchShell({
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
          overflow-x: hidden;
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

function AuthenticatedSearchShell({
  children,
}: {
  children: React.ReactNode;
}) {

  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
const { hasWallet: showWalletRail } = useWalletVisibility(user?.uid);
const { headerRef, safeAreaRef } = useMobileHeaderFade();

  const fontStack =
    'inherit';

useEffect(() => {
  setMobileSearchOpen(false);
}, [pathname]);


const contentAreaClassName = "contentArea contentAreaWithWallet";

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

<div className="layout">
<div ref={safeAreaRef} className="safeAreaHeaderBackdrop" />

<header
  ref={headerRef}
  className={`header ${
    mobileSearchOpen ? "headerMobileSearchOpen" : ""
  }`}
>
          <div
  className={`headerInner ${
    mobileSearchOpen ? "headerInnerMobileSearchOpen" : ""
  }`}
>
            <div className="desktopHeader">
              <div className="brandCol">
<Link href="/" className="brand" aria-label="Ir al inicio">
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
  <div className="mobileHeaderRow">
<Link
  href="/"
  className={`mobileBrand ${mobileSearchOpen ? "mobileBrandHidden" : "mobileBrandVisible"}`}
  aria-label="Ir al inicio"
>
  <Image src="/logotipo.png" alt="Vibra" width={86} height={25} className="mobileBrandLogo" />
</Link>

    <div className="mobileActions">
      <button
        type="button"
        onClick={() => router.push("/saved")}
        title="Guardados"
        aria-label="Ver guardados"
        className="mobileSearchIconButton"
      >
        <VibraSavedPostIcon size={22} color="#a855ff" />
      </button>
<button
  type="button"
onClick={() => setMobileSearchOpen(true)}
  title="Buscar comunidad"
  aria-label="Buscar comunidad"
  className="mobileSearchIconButton"
>
        <VibraNavigationIcon type="search" size={24} strokeWidth={2.2} />
      </button>
    </div>
  </div>
)}
          </div>
        </header>

        <div className={contentAreaClassName}>
          <div className="sidebarCol">
            <OwnerSidebar />
          </div>

          <main className="mainCol">
            <div className="mainInner">{children}</div>
          </main>

<div className="walletCol">
  <WalletDesktopRail
    activePath={pathname}
    showWallet={showWalletRail}
  />

</div>
        </div>

       <MobileBottomNav showWallet={showWalletRail} />
      </div>
    </>
  );
}

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, authTransitionMode } = useAuth();

  if (authTransitionMode === "exiting") {
    return <div style={{ minHeight: "100dvh", background: "#000" }} />;
  }

  if (user) {
    return <AuthenticatedSearchShell>{children}</AuthenticatedSearchShell>;
  }

  return <PublicSearchShell>{children}</PublicSearchShell>;
}