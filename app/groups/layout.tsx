"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import MobileBottomNav from "@/app/components/MobileBottomNav";

export default function GroupsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return <div style={{ padding: 24 }}>Cargando sesión...</div>;
  }

  if (!user) return null;

  return (
    <>
      <style jsx>{`
        .layout {
          min-height: 100vh;
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
        }

        .header {
          padding: 12px 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          background: #000;
          position: relative;
          z-index: 20;
        }

        .brand {
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }

        .contentArea {
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr);
          gap: 24px;
          width: min(1280px, calc(100% - 40px));
          margin: 0 auto;
          flex: 1;
          padding-top: 24px;
          box-sizing: border-box;
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

        @media (max-width: 1100px) {
          .contentArea {
            grid-template-columns: 260px minmax(0, 1fr);
            gap: 18px;
            width: min(1280px, calc(100% - 28px));
          }
        }

        @media (max-width: 900px) {
          .header {
            padding: 12px 14px;
          }

          .brand {
            font-size: 18px;
          }

          .contentArea {
            grid-template-columns: 1fr;
            width: 100%;
            gap: 0;
            padding-top: 10px;
          }

          .sidebarCol {
            display: none;
          }

          .mainCol {
            width: 100%;
            min-width: 0;
            padding-bottom: 100px;
          }
        }
      `}</style>

      <div className="layout">
        <header className="header">
          <strong className="brand">Red Social MVP</strong>
          <LogoutButton />
        </header>

        <div className="contentArea">
          <div className="sidebarCol">
            <OwnerSidebar />
          </div>

          <main className="mainCol">{children}</main>
        </div>

        <MobileBottomNav />
      </div>
    </>
  );
}