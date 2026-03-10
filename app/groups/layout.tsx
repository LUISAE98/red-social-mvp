"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";
import OwnerSidebar from "@/app/components/OwnerSidebar";
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

        .contentArea {
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 24px;
          width: min(1280px, calc(100% - 48px));
          margin: 0 auto;
          flex: 1;
          padding-top: 24px;
        }

        .sidebarCol {
          position: relative;
        }

        .mainCol {
          min-width: 0;
        }

        @media (max-width: 1100px) {
          .contentArea {
            grid-template-columns: 260px 1fr;
            gap: 18px;
          }
        }

        @media (max-width: 900px) {
          .contentArea {
            grid-template-columns: 1fr;
          }

          .sidebarCol {
            display: none;
          }
        }
      `}</style>

      <div className="layout">
        <header
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.12)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#000",
            position: "relative",
            zIndex: 20,
          }}
        >
          <strong>Red Social MVP</strong>
          <LogoutButton />
        </header>

        <div className="contentArea">
          <div className="sidebarCol">
            <OwnerSidebar />
          </div>

          <main
            className="mainCol"
            style={{
              position: "relative",
              zIndex: 1,
              paddingBottom: "90px",
            }}
          >
            {children}
          </main>
        </div>
        <MobileBottomNav />
      </div>
    </>
  );
}