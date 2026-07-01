"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePlatformMod } from "@/lib/moderation/usePlatformMod";

const NAV_ITEMS = [
  { label: "Reportes", href: "/admin/reports" },
  { label: "Usuarios", href: "/admin/users" },
  { label: "Historial", href: "/admin/audit-log" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isPlatformMod, loading } = usePlatformMod();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !isPlatformMod) {
      router.replace("/");
    }
  }, [isPlatformMod, loading, router]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
          fontSize: 14,
        }}
      >
        Verificando acceso...
      </div>
    );
  }

  if (!isPlatformMod) {
    return null;
  }

  return (
    <>
      <style jsx>{`
        .shell {
          display: flex;
          min-height: 100dvh;
          background: #0a0a0a;
          color: #fff;
        }

        .sidebar {
          width: 220px;
          flex-shrink: 0;
          border-right: 1px solid #1a1a1a;
          display: flex;
          flex-direction: column;
          padding: 24px 0;
          position: sticky;
          top: 0;
          height: 100dvh;
          overflow-y: auto;
        }

        .sidebarTitle {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #555;
          padding: 0 20px 16px;
        }

        .navItem {
          display: block;
          padding: 10px 20px;
          font-size: 14px;
          font-weight: 500;
          color: #888;
          text-decoration: none;
          border-left: 2px solid transparent;
          transition: color 150ms, border-color 150ms, background 150ms;
        }

        .navItem:hover {
          color: #fff;
          background: #111;
        }

        .navItemActive {
          color: #a855ff;
          border-left-color: #a855ff;
          background: #130a1f;
        }

        .main {
          flex: 1;
          min-width: 0;
          padding: 32px;
          max-width: 1100px;
        }

        @media (max-width: 700px) {
          .shell {
            flex-direction: column;
          }

          .sidebar {
            width: 100%;
            height: auto;
            position: static;
            flex-direction: row;
            padding: 12px 16px;
            overflow-x: auto;
            border-right: none;
            border-bottom: 1px solid #1a1a1a;
            gap: 4px;
          }

          .sidebarTitle {
            display: none;
          }

          .navItem {
            border-left: none;
            border-bottom: 2px solid transparent;
            white-space: nowrap;
            padding: 8px 12px;
            border-radius: 6px;
          }

          .navItemActive {
            border-bottom-color: #a855ff;
            background: #130a1f;
          }

          .main {
            padding: 20px 16px;
          }
        }
      `}</style>

      <div className="shell">
        <nav className="sidebar">
          <div className="sidebarTitle">Moderación</div>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "navItem",
                pathname.startsWith(item.href) ? "navItemActive" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="main">{children}</main>
      </div>
    </>
  );
}
