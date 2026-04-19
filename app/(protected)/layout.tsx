"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import MobileBottomNav from "@/app/components/MobileBottomNav";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { db } from "@/lib/firebase";

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
      <svg
        width={size >= 40 ? "20" : "18"}
        height={size >= 40 ? "20" : "18"}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4.75 8.25C4.75 7.14543 5.64543 6.25 6.75 6.25H17.25C18.3546 6.25 19.25 7.14543 19.25 8.25V15.75C19.25 16.8546 18.3546 17.75 17.25 17.75H6.75C5.64543 17.75 4.75 16.8546 4.75 15.75V8.25Z"
          stroke="currentColor"
          strokeWidth="1.9"
        />
        <path
          d="M15.75 12C15.75 11.3096 16.3096 10.75 17 10.75H19.25V13.25H17C16.3096 13.25 15.75 12.6904 15.75 12Z"
          stroke="currentColor"
          strokeWidth="1.9"
        />
        <path
          d="M7.5 6.25V5.75C7.5 4.92157 8.17157 4.25 9 4.25H15"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    </HeaderIconButton>
  );
}

type WalletRailTab = "finances" | "calendar" | "pending" | "history";

function resolveWalletRailTab(pathname: string): WalletRailTab | null {
  if (pathname.startsWith("/wallet/finanzas")) return "finances";
  if (pathname.startsWith("/wallet/calendario")) return "calendar";
  if (pathname.startsWith("/wallet/pendientes")) return "pending";
  if (pathname.startsWith("/wallet/historial")) return "history";
  return null;
}

function WalletDesktopRail({
  activePath,
}: {
  activePath: string;
}) {
  const items: Array<{
    key: WalletRailTab;
    label: string;
    href: string;
    icon: React.ReactNode;
  }> = [
    {
      key: "finances",
      label: "Finanzas",
      href: "/wallet/finanzas",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 7.75C4 6.7835 4.7835 6 5.75 6H18.25C19.2165 6 20 6.7835 20 7.75V16.25C20 17.2165 19.2165 18 18.25 18H5.75C4.7835 18 4 17.2165 4 16.25V7.75Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M15.5 12C15.5 11.1716 16.1716 10.5 17 10.5H20V13.5H17C16.1716 13.5 15.5 12.8284 15.5 12Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      ),
    },
    {
      key: "calendar",
      label: "Calendario",
      href: "/wallet/calendario",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="5.5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 4V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M16 4V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 9.5H20" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ),
    },
    {
      key: "pending",
      label: "Pendientes",
      href: "/wallet/pendientes",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="5" y="4.5" width="14" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 9H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M9 13H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8 4.5H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: "history",
      label: "Historial",
      href: "/wallet/historial",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 6.25A5.75 5.75 0 1 1 6.25 12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path d="M12 8.5V12L14.5 13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8 4.75H4.75V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  const activeTab = resolveWalletRailTab(activePath);

  return (
    <>
      <style jsx>{`
        .walletRail {
          position: sticky;
          top: calc(env(safe-area-inset-top) + 96px);
        }

        .walletCard {
          border-radius: 22px;
          border: 1px solid rgba(255, 255, 255, 0.11);
          background: rgba(255, 255, 255, 0.035);
          padding: 16px;
        }

        .walletEyebrow {
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.52);
          margin-bottom: 8px;
          font-weight: 600;
        }

        .walletTitle {
          margin: 0 0 14px;
          font-size: 16px;
          line-height: 1.2;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: #fff;
        }

        .walletNav {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .walletLink {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 11px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.02);
          color: rgba(255, 255, 255, 0.86);
          text-decoration: none;
          font-size: 14px;
          line-height: 1.2;
          font-weight: 500;
          transition:
            background 0.18s ease,
            border-color 0.18s ease;
        }

        .walletLink:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.14);
        }

        .walletLinkActive {
          background: #ffffff;
          color: #000000;
          border-color: rgba(255, 255, 255, 0.96);
        }

        .walletLinkLeft {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .walletIcon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .walletLabel {
          white-space: nowrap;
        }

        .walletArrow {
          opacity: 0.8;
          font-size: 13px;
          flex-shrink: 0;
        }

        .walletHint {
          margin-top: 12px;
          color: rgba(255, 255, 255, 0.52);
          font-size: 12px;
          line-height: 1.45;
        }
      `}</style>

      <aside className="walletRail" aria-label="Acceso directo wallet">
        <div className="walletCard">
          <div className="walletEyebrow">Panel</div>
          <h3 className="walletTitle">Wallet</h3>

          <nav className="walletNav">
            {items.map((item) => {
              const isActive = activeTab === item.key;

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`walletLink ${isActive ? "walletLinkActive" : ""}`}
                >
                  <span className="walletLinkLeft">
                    <span className="walletIcon">{item.icon}</span>
                    <span className="walletLabel">{item.label}</span>
                  </span>
                  <span className="walletArrow">→</span>
                </Link>
              );
            })}
          </nav>

          <div className="walletHint">
            Acceso rápido a finanzas, calendario, pendientes e historial.
          </div>
        </div>
      </aside>
    </>
  );
}

async function ownerHasAnyActiveServices(ownerId: string): Promise<boolean> {
  const q = query(
    collection(db, "groups"),
    where("ownerId", "==", ownerId),
    limit(20)
  );

  const snap = await getDocs(q);

  return snap.docs.some((docSnap) => {
    const data = docSnap.data() as {
      offerings?: Array<{
        enabled?: boolean;
      }> | null;
      greetingsEnabled?: boolean;
      adviceEnabled?: boolean;
      customClassEnabled?: boolean;
      digitalMeetGreetEnabled?: boolean;
      monetization?: {
        greetingsEnabled?: boolean;
        adviceEnabled?: boolean;
        customClassEnabled?: boolean;
        digitalMeetGreetEnabled?: boolean;
      } | null;
    };

    const offeringsActive =
      Array.isArray(data.offerings) &&
      data.offerings.some((item) => item?.enabled === true);

    const legacyFlagsActive =
      data.greetingsEnabled === true ||
      data.adviceEnabled === true ||
      data.customClassEnabled === true ||
      data.digitalMeetGreetEnabled === true;

    const monetizationFlagsActive =
      data.monetization?.greetingsEnabled === true ||
      data.monetization?.adviceEnabled === true ||
      data.monetization?.customClassEnabled === true ||
      data.monetization?.digitalMeetGreetEnabled === true;

    return offeringsActive || legacyFlagsActive || monetizationFlagsActive;
  });
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
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [showWalletRail, setShowWalletRail] = useState(false);
  const [walletRailLoading, setWalletRailLoading] = useState(true);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  useEffect(() => {
    setMobileSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!user?.uid) {
        if (!cancelled) {
          setShowWalletRail(false);
          setWalletRailLoading(false);
        }
        return;
      }

      try {
        setWalletRailLoading(true);
        const hasServices = await ownerHasAnyActiveServices(user.uid);

        if (!cancelled) {
          setShowWalletRail(hasServices);
        }
      } catch {
        if (!cancelled) {
          setShowWalletRail(false);
        }
      } finally {
        if (!cancelled) {
          setWalletRailLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const contentAreaClassName = useMemo(() => {
    if (showWalletRail) return "contentArea contentAreaWithWallet";
    return "contentArea";
  }, [showWalletRail]);

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
          width: min(
            var(--desktop-search-width),
            calc(100% - var(--desktop-create-size) - var(--desktop-search-gap))
          );
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
          grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
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
          grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--wallet-rail-width);
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

                <div className="desktopCreateButtonWrap">
                  <HeaderIconButton
                    href="/groups/new"
                    title="Crear comunidad"
                    ariaLabel="Crear comunidad"
                    size={35}
                    borderRadius={16}
                    background="#ffffff"
                    color="#000000"
                    border="1px solid rgba(255,255,255,0.85)"
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 5V19"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                      <path
                        d="M5 12H19"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                    </svg>
                  </HeaderIconButton>
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
                  {showWalletRail ? <WalletHeaderButton href="/wallet/finanzas" size={42} /> : null}

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

                  <HeaderIconButton
                    onClick={() => router.push("/groups/new")}
                    title="Crear comunidad"
                    ariaLabel="Crear comunidad"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 5V19"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                      <path
                        d="M5 12H19"
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

          {showWalletRail && !walletRailLoading ? (
            <div className="walletCol">
              <WalletDesktopRail activePath={pathname} />
            </div>
          ) : null}
        </div>

        <MobileBottomNav />
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