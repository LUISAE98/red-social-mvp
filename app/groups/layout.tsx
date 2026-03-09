"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";
import GreetingRequestsWidget from "@/app/groups/[groupId]/components/GreetingRequestsWidget";
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
        .groupsSidebarDesktop {
          display: none;
        }

        @media (min-width: 900px) {
          .groupsSidebarDesktop {
            display: block;
          }
        }
      `}</style>

      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
        }}
      >
        <header
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background: "#000",
            position: "relative",
            zIndex: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              padding: "12px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <strong style={{ color: "#fff" }}>Red Social MVP</strong>
            <LogoutButton />
          </div>
        </header>

        <div className="groupsSidebarDesktop">
          <OwnerSidebar />
        </div>

        <main
          style={{
            position: "relative",
            zIndex: 1,
            paddingBottom: "90px",
          }}
        >
          {children}
        </main>

        <GreetingRequestsWidget />

        <MobileBottomNav />
      </div>
    </>
  );
}