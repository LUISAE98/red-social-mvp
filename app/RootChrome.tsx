"use client";

import Link from "next/link";
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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

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
          min-height: 100vh;
          min-height: 100dvh;
          background: #000000;
          color: #ffffff;
        }

        .rootChromePublicHeader {
          position: sticky;
          top: 0;
          z-index: 100;
          padding-top: env(safe-area-inset-top);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .rootChromePublicHeaderInner {
          width: 100%;
          padding-left: max(16px, env(safe-area-inset-left));
          padding-right: max(16px, env(safe-area-inset-right));
          padding-top: 12px;
          padding-bottom: 12px;
          box-sizing: border-box;
        }

        .rootChromeDesktopHeader {
          display: grid;
          grid-template-columns: 220px minmax(0, 1fr) auto;
          gap: 20px;
          align-items: center;
          min-height: 60px;
          width: 100%;
        }

        .rootChromeBrandCol {
          min-width: 0;
          display: flex;
          align-items: center;
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
          min-width: 0;
          width: min(780px, 100%);
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
          transition: background 0.18s ease, border-color 0.18s ease,
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
          min-height: 56px;
          width: 100%;
          align-items: center;
          gap: 10px;
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
          max-width: 42vw;
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
          min-height: calc(100dvh - 84px);
        }

        @media (max-width: 900px) {
          .rootChromePublicHeaderInner {
            padding-top: 10px;
            padding-bottom: 10px;
            padding-left: max(12px, env(safe-area-inset-left));
            padding-right: max(12px, env(safe-area-inset-right));
          }

          .rootChromeDesktopHeader {
            display: none;
          }

          .rootChromeMobileHeaderRow {
            display: flex;
          }

          .rootChromeMobileSearchRow {
            display: block;
          }

          .rootChromePageContent {
            min-height: calc(100dvh - 76px);
          }
        }

        @media (max-width: 520px) {
          .rootChromeMobileHeaderRow {
            gap: 8px;
          }

          .rootChromeMobileBrand {
            max-width: 38vw;
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
              <div className="rootChromeBrandCol">
                <Link href="/" className="rootChromeBrand">
                  Red Social MVP
                </Link>
              </div>

              <div className="rootChromeDesktopSearchCol">
                <GroupsSearchPanel
                  fontStack={fontStack}
                  showCreateGroup={false}
                  createGroupHref="/login"
                />
              </div>

              <div className="rootChromeDesktopActions">
                <Link href="/login" className="rootChromeDesktopAuthLink">
                  Iniciar sesión
                </Link>
              </div>
            </div>

            {!mobileSearchOpen ? (
              <div className="rootChromeMobileHeaderRow">
                <Link href="/" className="rootChromeMobileBrand">
                  Red Social MVP
                </Link>

                <div className="rootChromeMobileActions">
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
                    href="/login"
                    title="Iniciar sesión"
                    ariaLabel="Iniciar sesión"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M10 17L15 12L10 7"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M15 12H4"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                      <path
                        d="M20 5V19"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                    </svg>
                  </HeaderIconButton>
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