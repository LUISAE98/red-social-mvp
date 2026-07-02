"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { usePlatformMod } from "@/lib/moderation/usePlatformMod";

const NAV_ITEMS = [
  { label: "Reportes", href: "/admin/reports" },
  { label: "Usuarios", href: "/admin/users" },
  { label: "Historial", href: "/admin/audit-log" },
];

const MOBILE_BREAKPOINT = 900;

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isPlatformMod, loading, wrongProvider } = usePlatformMod();
  const router = useRouter();
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!loading && !isPlatformMod && !wrongProvider) {
      router.replace("/");
    }
  }, [isPlatformMod, loading, wrongProvider, router]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut(auth);
    router.replace("/login");
  }

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

  if (wrongProvider) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 12,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 32 }}>🔒</div>
        <div style={{ color: "#f87171", fontSize: 16, fontWeight: 700 }}>
          Acceso denegado
        </div>
        <div style={{ color: "#666", fontSize: 13, maxWidth: 320 }}>
          El panel de moderación requiere iniciar sesión con Google. Cierra sesión
          y vuelve a entrar usando tu cuenta de Google con verificación en dos pasos.
        </div>
      </div>
    );
  }

  if (!isPlatformMod) {
    return null;
  }

  if (isMobile) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          padding: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>🖥️</div>
        <div style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>
          Solo disponible en escritorio
        </div>
        <div style={{ color: "#555", fontSize: 13, maxWidth: 280, lineHeight: 1.5 }}>
          El panel de moderación no está disponible en dispositivos móviles. Accede desde un ordenador.
        </div>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            marginTop: 8,
            padding: "9px 20px",
            borderRadius: 8,
            border: "1px solid #2a2a2a",
            background: "transparent",
            color: "#666",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {signingOut ? "Cerrando..." : "Cerrar sesión"}
        </button>
      </div>
    );
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
          padding: 24px 0 16px;
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

          {/* Spacer empuja el botón al fondo */}
          <div style={{ flex: 1 }} />

          <button
            onClick={handleSignOut}
            disabled={signingOut}
            style={{
              margin: "0 12px",
              padding: "9px 14px",
              borderRadius: 8,
              border: "1px solid #1e1e1e",
              background: "transparent",
              color: "#555",
              fontSize: 13,
              fontWeight: 600,
              cursor: signingOut ? "not-allowed" : "pointer",
              textAlign: "left",
              transition: "color 150ms, border-color 150ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#f87171";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#3d1515";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#555";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#1e1e1e";
            }}
          >
            {signingOut ? "Cerrando sesión..." : "Cerrar sesión"}
          </button>
        </nav>

        <main className="main">{children}</main>
      </div>
    </>
  );
}
