"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/app/providers";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";

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

export default function RootChrome({
  children,
}: {
  children: React.ReactNode;
}) {
const { user, loading } = useAuth();
const pathname = usePathname();
const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

const isLoginPage = pathname === "/login";

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

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
    return <>{children}</>;
  }

  return (
    <>
      <style jsx global>{`
        .rootChromePublicLayout {
          --shell-gutter: 16px;
          --sidebar-width: 300px;
          --wallet-rail-width: 220px;
          --shell-column-gap: 24px;
          --desktop-search-width: 920px;

          min-height: 100vh;
          min-height: 100dvh;
          background: #000000;
          color: #ffffff;
          display: flex;
          flex-direction: column;
        }

        .rootChromePublicHeader {
          position: sticky;
          top: 0;
          z-index: 100;
          padding-top: env(safe-area-inset-top);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          background: #000000;
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
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        .rootChromeBrand {
          color: #fff;
          text-decoration: none;
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
          white-space: nowrap;
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
        }

        .rootChromeDesktopAuthLink {
          color: #fff;
          text-decoration: none;
          font-size: 14px;
          font-weight: 600;
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.04);
          transition:
            background 0.18s ease,
            border-color 0.18s ease,
            transform 0.18s ease;
        }

        .rootChromeDesktopAuthLink:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.22);
          transform: translateY(-1px);
        }

        .rootChromeMobileHeaderRow,
        .rootChromeMobileSearchRow {
          display: none;
        }

        .rootChromeMobileHeaderRow {
          min-height: 38px;
          width: 100%;
        }

        .rootChromeMobileBrand {
          color: #fff;
          text-decoration: none;
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

        .rootChromeMobileActions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
          flex-shrink: 0;
        }

        .rootChromeMobileSearchRow {
          width: 100%;
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
            --sidebar-width: 260px;
            --wallet-rail-width: 210px;
            --shell-column-gap: 18px;
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

          .rootChromeMobileHeaderRow {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
          }

          .rootChromeMobileSearchRow {
            display: block;
          }
        }

        @media (max-width: 520px) {
          .rootChromeMobileHeaderRow {
            gap: 8px;
          }

          .rootChromeMobileBrand {
            max-width: 28vw;
          }

          .rootChromeMobileActions {
            gap: 6px;
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
  {!isLoginPage ? (
    <Link href="/login" className="rootChromeDesktopAuthLink">
      Iniciar sesión
    </Link>
  ) : null}
</div>
            </div>

            {!mobileSearchOpen ? (
              <div className="rootChromeMobileHeaderRow">
<span className="rootChromeMobileBrand" />

                <div className="rootChromeMobileActions">
                  <HeaderIconButton
                    onClick={() => setMobileSearchOpen(true)}
                    title="Buscar comunidad"
                    ariaLabel="Buscar comunidad"
                  >
                    <span aria-hidden="true">🔍</span>
                  </HeaderIconButton>

{!isLoginPage ? (
  <HeaderIconButton
    href="/login"
    title="Iniciar sesión"
    ariaLabel="Iniciar sesión"
  >
    <span aria-hidden="true">↪</span>
  </HeaderIconButton>
) : null}
                </div>
              </div>
            ) : (
              <div className="rootChromeMobileSearchRow">
                <div className="rootChromeMobileSearchCol">
                  <GroupsSearchPanel
                    fontStack={fontStack}
                    showCreateGroup={false}
                    createGroupHref="/login"
                    showCloseSearch={true}
                    onCloseSearch={() => setMobileSearchOpen(false)}
                  />
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="rootChromePageContent">{children}</main>
      </div>
    </>
  );
}