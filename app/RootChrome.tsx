"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/app/providers";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";

export default function RootChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, authTransitionMode, startAuthTransition } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPostRoute = pathname.startsWith("/p/");

const isPublicRoute =
  pathname === "/" ||
  pathname === "/login" ||
  pathname === "/register" ||
  pathname === "/forgot-password" ||
  pathname === "/reset-password" ||
  pathname.startsWith("/search") ||
  pathname.startsWith("/groups") ||
  pathname.startsWith("/u/") ||
  pathname.startsWith("/p/");

  useEffect(() => {
    if (!loading && !user && !isPublicRoute) {
      startAuthTransition("exiting");
      router.replace("/login");
    }
  }, [loading, user, isPublicRoute, router, startAuthTransition]);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';
    if (authTransitionMode === "exiting") {
  return null;
}
    const isAuthPage =
  pathname === "/login" ||
  pathname === "/register" ||
  pathname === "/forgot-password" ||
  pathname === "/reset-password";

if (user && isAuthPage) {
  return null;
}

if (user) {
  return <>{children}</>;
}

if (isPublicPostRoute) {
  return <>{children}</>;
}

  return (
    <>
      <style jsx global>{`
        .rootChromePublicLayout {
          --shell-gutter: 16px;
          min-height: 100vh;
          min-height: 100dvh;
          background: transparent;
          color: #ffffff;
          display: flex;
          flex-direction: column;
        }

        .rootChromePublicHeader {
          position: sticky;
          top: 0;
          z-index: 100;
          padding-top: env(safe-area-inset-top);
          border-bottom: none;
          background: transparent;
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
          width: auto;
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
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text",
            "SF Pro Display", system-ui, sans-serif;
          cursor: pointer;
          box-shadow: 0 10px 28px rgba(168, 85, 255, 0.22);
          overflow: hidden;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          white-space: nowrap;
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease,
            filter 0.18s ease;
        }

        .rootChromeDesktopAuthLink:hover {
          transform: translateY(-1px);
          filter: brightness(1.06);
          box-shadow: 0 14px 34px rgba(168, 85, 255, 0.3);
        }

        .rootChromeMobileSearchRow {
          display: none;
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

          .rootChromeMobileSearchRow {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 8px;
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
                {pathname !== "/login" ? (
                  <Link
                    href="/login"
                    className="rootChromeDesktopAuthLink"
                    onClick={() => startAuthTransition("entering")}
                  >
                    Iniciar sesión
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="rootChromeMobileSearchRow">
              <div className="rootChromeMobileSearchCol">
                <GroupsSearchPanel
                  fontStack={fontStack}
                  showCreateGroup={false}
                  createGroupHref="/login"
                  showCloseSearch={false}
                />
              </div>
            </div>
          </div>
        </header>

        <main className="rootChromePageContent">{children}</main>
      </div>
    </>
  );
}