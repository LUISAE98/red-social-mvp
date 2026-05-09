//layout (protected) este ya está corregido, este lo tomas de referencia solamente

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import MobileBottomNav from "@/app/components/MobileBottomNav";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
  type VibraNavigationIconType,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

function HeaderIconButton({
  onClick,
  href,
  title,
  ariaLabel,
  children,
  size = 40,
  borderRadius = 12,
  background = "rgba(0,0,0,0.45)",
  color = "#fff",
  border = "1px solid rgba(255,255,255,0.18)",
}: {
  onClick?: () => void;
  href?: string;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
  size?: number;
  borderRadius?: number;
  background?: string;
  color?: string;
  border?: string;
}) {
  const commonStyle: React.CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    padding: 0,
    borderRadius,
    border,
    background,
    color,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    cursor: "pointer",
    textDecoration: "none",
    flexShrink: 0,
  };

  if (href) {
    return (
      <Link href={href} title={title} aria-label={ariaLabel} style={commonStyle}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      style={commonStyle}
    >
      {children}
    </button>
  );
}

function WalletHeaderButton({
  href = "/wallet/finanzas",
  size = 42,
}: {
  href?: string;
  size?: number;
}) {
  return (
    <HeaderIconButton
      href={href}
      title="Wallet"
      ariaLabel="Ir a wallet"
      size={size}
      borderRadius={999}
      background="#ffffff"
      color="#000000"
      border="1px solid rgba(255,255,255,0.95)"
    >
      <VibraNavigationIcon type="finance" size={20} />
    </HeaderIconButton>
  );
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
  overflow: visible;
  box-sizing: border-box;

  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  row-gap: clamp(18px, 3vh, 34px);
}

.walletRailCenter {
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(18px, 3vh, 28px);
  overflow: visible;
}

.logoutSection {
  width: 100%;
  flex-shrink: 0;
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
  border: 1px solid rgba(168, 85, 255, 0.16);

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
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 0 -1px 0 rgba(255, 255, 255, 0.025),
    inset 0 0 22px rgba(168, 85, 255, 0.025),
    0 0 18px rgba(168, 85, 255, 0.06),
    0 18px 54px rgba(0, 0, 0, 0.68);
}

.railSection::before {
  content: "";
  position: absolute;
  inset: -38%;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 10%, rgba(168, 85, 255, 0.09), transparent 34%),
    radial-gradient(circle at 86% 18%, rgba(126, 34, 206, 0.06), transparent 36%),
    radial-gradient(circle at 22% 92%, rgba(168, 85, 255, 0.05), transparent 40%);
  filter: blur(24px);
  opacity: 0.55;
  z-index: 0;
  animation: railAuraMove 7s ease-in-out infinite alternate;
}

.railSection::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 34px rgba(79, 70, 255, 0.10),
    inset 0 0 24px rgba(168, 85, 255, 0.10),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  z-index: 1;
}

.railSection > * {
  position: relative;
  z-index: 2;
}

.railSection + .railSection {
  margin-top: 0;
}

.mainMenuRailSection {
  transform: translateY(18px);
}

.createCommunitySection + .railSection {
  margin-top: 0;
}

.logoutSection {
  width: 100%;
  margin-top: auto;
  flex-shrink: 0;
}

.logoutSection :global(button) {
  width: 100%;
  height: 40px;
  min-height: 40px;
}

@media (max-height: 760px) {
  .createCommunitySection {
    transform: translateY(-10px);
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
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fff;
}

.secondaryTitle {
  margin: 0 0 2px;
  font-size: 17px;
  line-height: 1.2;
  font-weight: 700;
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

  transform: translateY(-18px);
}

.createCommunitySection::before,
.createCommunitySection::after {
  display: none;
}

.createCommunityImage {
  width: 138px;
  max-width: 138px;
  height: auto;
  display: block;
  margin: -8px auto -18px;
  object-fit: contain;
  position: relative;
  z-index: 1;
  pointer-events: none;
}

.createCommunityCopy {
  margin-bottom: 5px;
  display: grid;
  gap: 2px;
  color: #fff;
  text-align: center;
  justify-items: center;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
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
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(168, 85, 255, 0.22);
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
  color: #ffffff;
  transform: translateX(2px);
}

.walletIcon {
  width: 22px;
  min-width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #a855ff;
  transform: translateY(3.5px);
  margin-right: 8px;
}

.walletLabel {
  min-width: 0;
  white-space: nowrap;
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
  animation: walletActiveAura 4.5s ease-in-out infinite alternate;
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
        <div className="walletRailCenter">
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
            <img
              src="/Crear-comunidad.png"
              alt=""
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

function PublicProfileShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style jsx>{`
        .layout {
          min-height: 100vh;
          min-height: 100dvh;
          background: #000000;
          color: #fff;
          display: flex;
          flex-direction: column;
        }

.header {
  position: sticky;
  top: 0;
  z-index: 80;
  padding-top: env(safe-area-inset-top);
  border-bottom: none;
  background: transparent;
  transform: translateY(var(--mobile-header-offset-y, 0px));
  will-change: transform, margin-bottom;
}

        .headerInner {
          min-height: 48px;
          display: flex;
          justify-content: flex-start;
          align-items: center;
          gap: 12px;
        }

        .brand {
          color: #fff;
          text-decoration: none;
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }

        .contentArea {
          width: min(820px, calc(100% - 28px));
          margin: 0 auto;
          flex: 1;
          padding-top: 24px;
          padding-bottom: calc(24px + env(safe-area-inset-bottom));
          box-sizing: border-box;
        }

        @media (max-width: 900px) {
          .header {
            padding-left: max(12px, env(safe-area-inset-left));
            padding-right: max(12px, env(safe-area-inset-right));
          }

          .headerInner {
            min-height: 44px;
          }

          .brand {
            font-size: 15px;
          }

          .contentArea {
            width: min(720px, calc(100% - 20px));
            padding-top: 10px;
            padding-bottom: calc(18px + env(safe-area-inset-bottom));
          }
        }


.floatingLogoutWrap {
  position: fixed;
  right: calc(18px + env(safe-area-inset-right));
  bottom: calc(18px + env(safe-area-inset-bottom));
  z-index: 2147483005;
  width: var(--wallet-rail-width);
  display: flex;
  align-items: center;
  justify-content: center;
}

.floatingLogoutWrap :global(.logoutGradientButton) {
  width: 100%;
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
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(168, 85, 255, 0.22);
  text-decoration: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
@media (max-width: 900px) {
  .floatingLogoutWrap {
    display: none;
  }
}

        @media (max-width: 520px) {
          .brand {
            max-width: 132px;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }
      `}</style>

      <div className="layout">
        <header className="header">
          <div className="headerInner">
<Link href="/" className="brand" aria-label="Ir al inicio">
  <img src="/logotipo.png" alt="Vibra" className="brandLogo" />
</Link>
          </div>
        </header>

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

  const pathname = usePathname();
  const { user } = useAuth();

const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
const [mobileHeaderOffset, setMobileHeaderOffset] = useState(0);
const lastScrollYRef = useRef(0);
const headerRef = useRef<HTMLElement | null>(null);

const { hasWallet: showWalletRail } = useWalletVisibility(user?.uid);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  useEffect(() => {
    setMobileSearchOpen(false);
  }, [pathname]);

useEffect(() => {
  setMobileHeaderOffset(0);
  lastScrollYRef.current = 0;
}, [pathname]);

useEffect(() => {
  if (mobileSearchOpen) {
    setMobileHeaderOffset(0);
    return;
  }

  function handleScroll() {
    if (window.innerWidth > 900) {
      setMobileHeaderOffset(0);
      lastScrollYRef.current = window.scrollY;
      return;
    }

    const currentScrollY = window.scrollY;
    const previousScrollY = lastScrollYRef.current;
    const scrollDifference = currentScrollY - previousScrollY;

    if (currentScrollY < 8) {
      setMobileHeaderOffset(0);
      lastScrollYRef.current = currentScrollY;
      return;
    }

    const headerHeight = headerRef.current?.offsetHeight ?? 64;

    setMobileHeaderOffset((previousOffset) => {
      const nextOffset = previousOffset - scrollDifference;
      return Math.max(-headerHeight, Math.min(0, nextOffset));
    });

    lastScrollYRef.current = currentScrollY;
  }

  window.addEventListener("scroll", handleScroll, { passive: true });

  return () => {
    window.removeEventListener("scroll", handleScroll);
  };
}, [mobileSearchOpen]);

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
          background: #000000;
          color: #fff;
          display: flex;
          flex-direction: column;
        }

.header {
  position: sticky;
  top: 0;
  z-index: 80;
  padding-top: env(safe-area-inset-top);
  border-bottom: none;
  background: transparent;
  transform: translateY(var(--mobile-header-offset-y, 0px));
  will-change: transform, margin-bottom;
}

        .headerInner {
          width: 100%;
          padding-left: max(var(--shell-gutter), env(safe-area-inset-left));
          padding-right: max(var(--shell-gutter), env(safe-area-inset-right));
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
  width: 96px;
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

        .mobileHeaderRow,
        .mobileSearchRow {
          display: none;
        }

        .mobileHeaderRow {
          min-height: 38px;
          width: 100%;
        }

        .mobileBrand {
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

        .mobileActions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
          flex-shrink: 0;
        }

.mobileSearchRow {
  width: 100%;
  overflow: visible;
  animation: mobile-search-enter 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  transform-origin: top center;
}

@keyframes mobile-search-enter {
  from {
    opacity: 0;
    transform: translateY(-8px) scaleX(0.92);
  }

  to {
    opacity: 1;
    transform: translateY(0) scaleX(1);
  }
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
  padding-top: 24px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.contentAreaWithWallet {
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  padding-right: calc(var(--wallet-rail-width) + var(--shell-column-gap) + var(--shell-gutter));
}

.sidebarCol {
  position: sticky;
  top: calc(env(safe-area-inset-top) + 112px);
  align-self: start;
  min-width: 0;
  z-index: 2;
}

        .mainCol {
          min-width: 0;
          width: 100%;
          position: relative;
          z-index: 1;
          padding-bottom: 90px;
        }

.mainInner {
  width: min(var(--main-max-width), 100%);
  margin-left: auto;
  margin-right: auto;
}
.walletCol {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 44px);
  right: max(var(--shell-gutter), env(safe-area-inset-right));
  bottom: calc(24px + env(safe-area-inset-bottom));
  width: var(--wallet-rail-width);
  min-width: 0;

  display: flex;
  flex-direction: column;
  align-items: center;

  overflow: visible;
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
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.36);
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

          .header {
            margin-bottom: var(--mobile-header-offset-y, 0px);
          }
          .headerInner {
            width: 100%;
            padding-top: 6px;
            padding-bottom: 6px;
          }

          .desktopHeader {
            display: none;
          }

          .mobileHeaderRow {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
          }

          .mobileSearchRow {
            display: block;
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
        <header
          ref={headerRef}
          className="header"
          style={{
            "--mobile-header-offset-y": `${mobileHeaderOffset}px`,
          } as React.CSSProperties}
        >
          <div className="headerInner">
            <div className="desktopHeader">
              <div className="brandCol">
<Link href="/" className="brand" aria-label="Ir al inicio">
  <img src="/logotipo.png" alt="Vibra" className="brandLogo" />
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

            {!mobileSearchOpen ? (
              <div className="mobileHeaderRow">
                <Link href="/" className="mobileBrand" aria-label="Ir al inicio">
  <img src="/logotipo.png" alt="Vibra" className="mobileBrandLogo" />
</Link>

<div className="mobileActions">
  <HeaderIconButton
    onClick={() => setMobileSearchOpen(true)}
    title="Buscar comunidad"
    ariaLabel="Buscar comunidad"
  >
    <span
      aria-hidden="true"
      style={{
        fontSize: 18,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      🔍
    </span>
  </HeaderIconButton>
</div>
              </div>
            ) : (
              <div className="mobileSearchRow">
                <div className="mobileSearchCol">
                  <GroupsSearchPanel
                    fontStack={fontStack}
                    showCreateGroup={false}
                    createGroupHref="/groups/new"
                    showCloseSearch={true}
                    onCloseSearch={() => setMobileSearchOpen(false)}
                  />
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

export default function PublicProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();

  if (user) {
    return <AuthenticatedProfileShell>{children}</AuthenticatedProfileShell>;
  }

  return <PublicProfileShell>{children}</PublicProfileShell>;
}