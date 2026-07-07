"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { usePlatformMod } from "@/lib/moderation/usePlatformMod";
import { AdminPreviewContext } from "./context";

const NAV_ITEMS = [
  { label: "Mi perfil", href: "/admin/profile" },
  { label: "Reportes generales", href: "/admin/reports" },
  { label: "Asignados a mí", href: "/admin/my-reports" },
  { label: "Asignados a otros", href: "/admin/other-reports" },
  { label: "Historial", href: "/admin/audit-log" },
  { label: "Comunidades ocultas", href: "/admin/hidden-communities" },
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [iframeLoading, setIframeLoading] = useState(false);

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

  // Reset preview when navigating between sections
  useEffect(() => {
    setPreviewUrl(null);
  }, [pathname]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut(auth);
    router.replace("/login");
  }

  function handleSetPreviewUrl(url: string | null) {
    setPreviewUrl(url);
    if (url) setIframeLoading(true);
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
    <AdminPreviewContext.Provider
      value={{ previewUrl, setPreviewUrl: handleSetPreviewUrl }}
    >
      <>
        <style jsx>{`
          .shell {
            display: flex;
            height: 100dvh;
            overflow: hidden;
            background: #0a0a0a;
            color: #fff;
          }

          /* Col 1 — nav */
          .sidebar {
            width: 200px;
            flex-shrink: 0;
            border-right: 1px solid #1a1a1a;
            display: flex;
            flex-direction: column;
            padding: 24px 0 16px;
            height: 100dvh;
            overflow-y: auto;
          }

          .sidebarTitle {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #444;
            padding: 0 16px 14px;
          }

          .navItem {
            display: block;
            padding: 9px 16px;
            font-size: 13px;
            font-weight: 500;
            color: #777;
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

          /* Col 2 — list content */
          .content {
            width: 400px;
            flex-shrink: 0;
            border-right: 1px solid #1a1a1a;
            height: 100dvh;
            overflow-y: auto;
            padding: 0;
            display: flex;
            flex-direction: column;
          }

          .contentTitle {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #444;
            padding: 24px 20px 14px;
            flex-shrink: 0;
            border-bottom: 1px solid #111;
          }

          .contentInner {
            flex: 1;
            overflow-y: auto;
            padding: 20px 20px;
          }

          /* Col 3 — preview */
          .preview {
            flex: 1;
            min-width: 0;
            height: 100dvh;
            position: relative;
            background: #050505;
            display: flex;
            flex-direction: column;
          }

          .previewTitle {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #444;
            padding: 24px 20px 14px;
            flex-shrink: 0;
            border-bottom: 1px solid #111;
          }

          .previewBody {
            flex: 1;
            min-height: 0;
            position: relative;
          }

          .previewPlaceholder {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: #2a2a2a;
            user-select: none;
          }

          .previewIframe {
            width: 100%;
            height: 100%;
            border: none;
            display: block;
            position: absolute;
            inset: 0;
          }

          .iframeLoadingOverlay {
            position: absolute;
            inset: 0;
            background: #050505;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #333;
            font-size: 13px;
            pointer-events: none;
            z-index: 1;
          }
        `}</style>

        <div className="shell">
          {/* Col 1 — Navigation */}
          <nav className="sidebar">
            <div className="sidebarTitle">Menú del moderador</div>

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

            <div style={{ flex: 1 }} />

            <button
              onClick={handleSignOut}
              disabled={signingOut}
              style={{
                margin: "0 10px",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #1e1e1e",
                background: "transparent",
                color: "#444",
                fontSize: 12,
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
                (e.currentTarget as HTMLButtonElement).style.color = "#444";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#1e1e1e";
              }}
            >
              {signingOut ? "Cerrando..." : "Cerrar sesión"}
            </button>
          </nav>

          {/* Col 2 — Page content (list) */}
          <div className="content">
            <div className="contentTitle">Panel informativo</div>
            <div className="contentInner">{children}</div>
          </div>

          {/* Col 3 — Preview iframe */}
          <div className="preview">
            <div className="previewTitle">Navegador</div>
            <div className="previewBody">
              {previewUrl ? (
                <>
                  {iframeLoading && (
                    <div className="iframeLoadingOverlay">Cargando...</div>
                  )}
                  <iframe
                    key={previewUrl}
                    src={previewUrl}
                    className="previewIframe"
                    onLoad={() => setIframeLoading(false)}
                  />
                </>
              ) : (
                <div className="previewPlaceholder">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18" />
                    <path d="M9 21V9" />
                  </svg>
                  <span style={{ fontSize: 13 }}>
                    Selecciona un elemento para previsualizar
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    </AdminPreviewContext.Provider>
  );
}
