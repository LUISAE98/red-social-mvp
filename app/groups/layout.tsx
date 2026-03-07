"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";
import GreetingRequestsWidget from "@/app/groups/[groupId]/components/GreetingRequestsWidget";

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
    <div style={{ position: "relative", minHeight: "100vh", background: "#000" }}>
      <header
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "#000",
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

      <main>{children}</main>

      <GreetingRequestsWidget />
    </div>
  );
}