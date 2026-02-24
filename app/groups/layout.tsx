"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import LogoutButton from "@/app/LogoutButton";

export default function GroupsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) return <div style={{ padding: 24 }}>Cargando sesión...</div>;
  if (!user) return null;

  return (
    <div>
      <header
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid #ddd",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>Red Social MVP</strong>
        <LogoutButton />
      </header>

      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
