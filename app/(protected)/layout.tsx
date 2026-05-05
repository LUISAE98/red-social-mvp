"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
      <span
        style={{
          fontSize: size >= 40 ? 18 : 16,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-hidden="true"
      >
        📊
      </span>
    </HeaderIconButton>
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
    {
      key: "finances",
      label: "Finanzas",
      href: "/wallet/finanzas",
      emoji: "📈",
    },
    {
      key: "calendar",
      label: "Calendario",
      href: "/wallet/calendario",
      emoji: "📅",
    },
    {
      key: "pending",
      label: "Pendientes",
      href: "/wallet/pendientes",
      emoji: "⏳",
    },
    {
      key: "history",
      label: "Historial",
      href: "/wallet/historial",
      emoji: "🧾",
    },
  ];

  const mainItems: Array<{
    key: MainRailTab;
    label: string;
    href: string;
    emoji: string;
  }> = [
    {
      key: "home",
      label: "Inicio",
      href: "/",
      emoji: "🏠",
    },
    {
      key: "saved",
      label: "Guardados",
      href: "/saved",
      emoji: "🔖",
    },
    {
      key: "createGroup",
      label: "Crear nuevo grupo",
      href: "/groups/new",
      emoji: "🧩",
    },
  ];

  const activeWalletTab = resolveWalletRailTab(activePath);
  const activeMainTab = resolveMainRailTab(activePath);

  return (
    <>
      <style jsx>{`
.walletRail {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 104px);
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

.walletTitle {
  margin: 0 0 10px;
          font-size: 17px;
          line-height: 1.2;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #fff;
        }
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
          transition:
            color 0.18s ease,
            transform 0.18s ease,
            opacity 0.18s ease;
        }

        .walletLink:hover {
          color: #ffffff;
          transform: translateX(2px);
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
          flex-shrink: 0;
          font-size: 17px;
          line-height: 1;
          margin-right: 6px;
        }

        .walletLabel {
          min-width: 0;
          white-space: nowrap;
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
          z-index: 60;
          padding-top: env(safe-area-inset-top);
          padding-left: max(24px, env(safe-area-inset-left));
          padding-right: max(24px, env(safe-area-inset-right));
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .headerInner {
          min-height: 60px;
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
            min-height: 56px;
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
            <Link href="/" className="brand">
              Red Social MVP
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
  const { hasWallet: showWalletRail } = useWalletVisibility(user?.uid);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

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
          --wallet-rail-width: 220px;
          --main-max-width: 860px;
          --shell-column-gap: 24px;
          --desktop-search-width: 780px;
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
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .headerInner {
          width: 100%;
          padding-left: max(var(--shell-gutter), env(safe-area-inset-left));
          padding-right: max(var(--shell-gutter), env(safe-area-inset-right));
          padding-top: 12px;
          padding-bottom: 12px;
          box-sizing: border-box;
        }

        .desktopHeader {
          display: grid;
          grid-template-columns: var(--sidebar-width) minmax(0, 1fr) auto;
          gap: var(--shell-column-gap);
          align-items: center;
          min-height: 60px;
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

        .desktopMainCluster {
          min-width: 0;
          width: min(var(--main-max-width), 100%);
          display: flex;
          align-items: center;
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
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-shrink: 0;
        }

        .mobileHeaderRow,
        .mobileSearchRow {
          display: none;
        }

        .mobileHeaderRow {
          min-height: 56px;
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
  grid-template-columns: var(--sidebar-width) minmax(0, var(--main-max-width)) var(--wallet-rail-width);
}

        .sidebarCol {
          position: relative;
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

        .walletCol {
          min-width: 0;
          display: block;
        }

        @media (max-width: 1180px) {
          .layout {
            --shell-gutter: 14px;
            --sidebar-width: 260px;
            --wallet-rail-width: 210px;
            --shell-column-gap: 18px;
            --main-max-width: 780px;
          }
        }

        @media (max-width: 900px) {
          .headerInner {
            width: 100%;
            padding-top: 10px;
            padding-bottom: 10px;
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
        <header className="header">
          <div className="headerInner">
            <div className="desktopHeader">
              <div className="brandCol">
                <Link href="/" className="brand">
                  Red Social MVP
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
                <strong className="mobileBrand">Red Social MVP</strong>

<div className="mobileActions">
  <HeaderIconButton
    onClick={() => setMobileSearchOpen(true)}
    title="Buscar comunidad"
    ariaLabel="Buscar comunidad"
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="11"
        cy="11"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M16 16L21 21"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  </HeaderIconButton>

  <LogoutButton />
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
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#000",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        Cargando sesión...
      </div>
    );
  }

  if (user) {
    return <AuthenticatedProfileShell>{children}</AuthenticatedProfileShell>;
  }

  return <PublicProfileShell>{children}</PublicProfileShell>;
}