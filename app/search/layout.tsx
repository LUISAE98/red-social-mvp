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

type WalletRailTab = "finances" | "calendar" | "pending" | "history";
type MainRailTab = "home" | "saved" | "createGroup";

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
  if (pathname.startsWith("/groups/new")) return "createGroup";
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
    emoji: string;
  }> = [
    { key: "finances", label: "Finanzas", href: "/wallet/finanzas", emoji: "📈" },
    { key: "calendar", label: "Calendario", href: "/wallet/calendario", emoji: "📅" },
    { key: "pending", label: "Pendientes", href: "/wallet/pendientes", emoji: "⏳" },
    { key: "history", label: "Historial", href: "/wallet/historial", emoji: "🧾" },
  ];

  const mainItems: Array<{
    key: MainRailTab;
    label: string;
    href: string;
    emoji: string;
  }> = [
    { key: "home", label: "Inicio", href: "/", emoji: "🏠" },
    { key: "saved", label: "Guardados", href: "/saved", emoji: "🔖" },
    { key: "createGroup", label: "Crear nuevo grupo", href: "/groups/new", emoji: "🧩" },
  ];

  const activeWalletTab = resolveWalletRailTab(activePath);
  const activeMainTab = resolveMainRailTab(activePath);

  return (
    <>
      <style jsx>{`
.walletRail {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 86px);
  width: var(--wallet-rail-width);
}

        .railSection {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .railSection + .railSection {
          margin-top: 34px;
          padding-top: 26px;
          border-top: 1px solid rgba(255, 255, 255, 0.12);
        }

        .walletTitle,
        .secondaryTitle {
          margin: 0 0 10px;
          font-size: 17px;
          line-height: 1.2;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #fff;
        }

        .walletNav {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .walletLink {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 46px;
          padding: 6px 0 6px 14px;
          color: rgba(255, 255, 255, 0.74);
          text-decoration: none;
          font-size: 15px;
          line-height: 1.2;
          font-weight: 500;
        }

        .walletLinkActive {
          color: #ffffff;
          font-weight: 700;
        }

        .walletLinkActive::before {
          content: "";
          position: absolute;
          left: 0;
          top: 4px;
          bottom: 4px;
          width: 3px;
          border-radius: 999px;
          background: #ffffff;
        }

        .walletEmoji {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          min-width: 22px;
          font-size: 17px;
          line-height: 1;
          margin-right: 6px;
        }

        .walletLabel {
          white-space: nowrap;
        }

        .floatingLogoutWrap {
          position: fixed;
          right: calc(18px + env(safe-area-inset-right));
          bottom: calc(18px + env(safe-area-inset-bottom));
          z-index: 2147483005;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .floatingLogoutWrap :global(button) {
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.36);
        }

        @media (max-width: 900px) {
          .floatingLogoutWrap {
            right: calc(12px + env(safe-area-inset-right));
            bottom: calc(82px + env(safe-area-inset-bottom));
          }
        }

      `}</style>

      <aside className="walletRail" aria-label="Accesos directos">
        <section className="railSection" aria-label="Navegación principal">
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
                  <span className="walletEmoji" aria-hidden="true">
                    {item.emoji}
                  </span>
                  <span className="walletLabel">{item.label}</span>
                </Link>
              );
            })}
          </nav>
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
                    <span className="walletEmoji" aria-hidden="true">
                      {item.emoji}
                    </span>
                    <span className="walletLabel">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </section>
        ) : null}
      </aside>
    </>
  );
}

function PublicSearchShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style jsx>{`
        .layout {
          min-height: 100vh;
          min-height: 100dvh;
          background: #000;
          color: #fff;
        }

.contentArea {
  width: min(620px, calc(100% - 28px));
  margin: 0 auto;
  padding-top: 24px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

        @media (max-width: 900px) {
          .contentArea {
            width: 100%;
            padding-top: 10px;
            padding-bottom: calc(18px + env(safe-area-inset-bottom));
          }
        }

        .floatingLogoutWrap {
          position: fixed;
          right: calc(18px + env(safe-area-inset-right));
          bottom: calc(18px + env(safe-area-inset-bottom));
          z-index: 2147483005;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .floatingLogoutWrap :global(button) {
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.36);
        }

        @media (max-width: 900px) {
          .floatingLogoutWrap {
            right: calc(12px + env(safe-area-inset-right));
            bottom: calc(82px + env(safe-area-inset-bottom));
          }
        }

      `}</style>

      <div className="layout">
        <div className="contentArea">{children}</div>
      </div>
    </>
  );
}

function AuthenticatedSearchShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();

const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
const [mobileHeaderOffset, setMobileHeaderOffset] = useState(0);
const lastScrollYRef = useRef(0);
const headerRef = useRef<HTMLElement | null>(null);
const contentAreaScrollRef = useRef<HTMLDivElement | null>(null);

const { hasWallet: showWalletRail } = useWalletVisibility(user?.uid);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

 useEffect(() => {
  setMobileSearchOpen(false);
}, [pathname]);

useEffect(() => {
  setMobileHeaderOffset(0);
  lastScrollYRef.current = 0;

  if (contentAreaScrollRef.current) {
    contentAreaScrollRef.current.scrollTop = 0;
  }
}, [pathname]);

useEffect(() => {
  if (mobileSearchOpen) {
    setMobileHeaderOffset(0);
    return;
  }

  const scrollElement = contentAreaScrollRef.current;
  if (!scrollElement) return;

  function handleScroll(event: Event) {
    const target = event.currentTarget as HTMLDivElement;

    if (window.innerWidth > 900) {
      setMobileHeaderOffset(0);
      lastScrollYRef.current = target.scrollTop;
      return;
    }

    const currentScrollY = target.scrollTop;
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

  scrollElement.addEventListener("scroll", handleScroll, { passive: true });

  return () => {
    scrollElement.removeEventListener("scroll", handleScroll);
  };
}, [mobileSearchOpen]);

  return (
    <>
      <style jsx>{`
        .layout {
          --shell-gutter: 16px;
          --sidebar-width: 300px;
          --wallet-rail-width: 220px;
          --main-max-width: 1040px;
          --shell-column-gap: 24px;
          --desktop-search-width: 920px;

          height: 100vh;
          height: 100dvh;
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

.header {
  position: sticky;
  top: 0;
  z-index: 80;
  padding-top: env(safe-area-inset-top);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  background: #000000;
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

        .brand {
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
          white-space: nowrap;
          color: #fff;
          text-decoration: none;
        }

        .desktopSearchCol {
          min-width: 0;
          width: min(var(--desktop-search-width), 100%);
          justify-self: center;
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
          max-width: 34vw;
        }

        .mobileActions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
        }

        .contentArea {
          display: grid;
          grid-template-columns: var(--sidebar-width) minmax(0, var(--main-max-width)) var(--wallet-rail-width);
          gap: var(--shell-column-gap);
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding-left: var(--shell-gutter);
          padding-right: var(--shell-gutter);
          padding-top: 24px;
          padding-bottom: calc(24px + env(safe-area-inset-bottom));
          box-sizing: border-box;
        }

 .sidebarCol {
  position: sticky;
  top: calc(env(safe-area-inset-top) + 86px);
  align-self: start;
  min-width: 0;
  z-index: 2;
}

.walletCol {
  min-width: 0;
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
        }

        @media (max-width: 1180px) {
          .layout {
            --shell-gutter: 14px;
            --sidebar-width: 260px;
            --wallet-rail-width: 210px;
            --shell-column-gap: 18px;
            --main-max-width: 900px;
          }
        }

@media (max-width: 900px) {
  .header {
    margin-bottom: var(--mobile-header-offset-y, 0px);
  }

  .desktopHeader {
            display: none;
          }

          .mobileHeaderRow {
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .mobileSearchRow {
            display: block;
            width: 100%;
          }

          .contentArea {
            grid-template-columns: 1fr;
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
            padding-bottom: calc(100px + env(safe-area-inset-bottom));
          }

          .mainInner {
            width: 100%;
          }
        }

        .floatingLogoutWrap {
          position: fixed;
          right: calc(18px + env(safe-area-inset-right));
          bottom: calc(18px + env(safe-area-inset-bottom));
          z-index: 2147483005;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .floatingLogoutWrap :global(button) {
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.36);
        }

@media (max-width: 900px) {
  .floatingLogoutWrap {
    display: none;
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
              <Link href="/" className="brand">
                Red Social MVP
              </Link>

              <div className="desktopSearchCol">
                <GroupsSearchPanel
                  fontStack={fontStack}
                  showCreateGroup={false}
                  createGroupHref="/groups/new"
                />
              </div>

              <div className="desktopLogoutWrap">
                <LogoutButton />
              </div>
            </div>

            {!mobileSearchOpen ? (
              <div className="mobileHeaderRow">
                <strong className="mobileBrand">Red Social MVP</strong>

                <div className="mobileActions">
                  <HeaderIconButton
                    onClick={() => setMobileSearchOpen(true)}
                    title="Buscar"
                    ariaLabel="Buscar"
                  >
                    <span aria-hidden="true">🔍</span>
                  </HeaderIconButton>
                </div>
              </div>
            ) : (
              <div className="mobileSearchRow">
                <GroupsSearchPanel
                  fontStack={fontStack}
                  showCreateGroup={false}
                  createGroupHref="/groups/new"
                  showCloseSearch={true}
                  onCloseSearch={() => setMobileSearchOpen(false)}
                />
              </div>
            )}
          </div>
        </header>

        <div className="floatingLogoutWrap">
          <LogoutButton />
        </div>

       <div className="contentArea" ref={contentAreaScrollRef}>
          <div className="sidebarCol">
            <OwnerSidebar />
          </div>

          <main className="mainCol">
            <div className="mainInner">{children}</div>
          </main>

          <div className="walletCol">
            <WalletDesktopRail activePath={pathname} showWallet={showWalletRail} />
          </div>
        </div>

        <MobileBottomNav showWallet={showWalletRail} />
      </div>
    </>
  );
}

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();


  if (user) {
    return <AuthenticatedSearchShell>{children}</AuthenticatedSearchShell>;
  }

  return <PublicSearchShell>{children}</PublicSearchShell>;
}