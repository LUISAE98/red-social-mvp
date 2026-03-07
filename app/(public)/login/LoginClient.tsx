"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function friendlyAuthError(err: any) {
  const code = err?.code as string | undefined;

  if (code === "auth/invalid-credential") return "Correo o contraseña incorrectos.";
  if (code === "auth/user-not-found") return "Usuario no encontrado.";
  if (code === "auth/wrong-password") return "Contraseña incorrecta.";
  if (code === "auth/too-many-requests") return "Demasiados intentos. Intenta más tarde.";
  if (code === "auth/network-request-failed") return "Error de red. Revisa tu conexión.";

  return "Error inesperado. Intenta nuevamente.";
}

export default function LoginClient() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered") === "1";

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      const next = searchParams.get("next") || "/";
      router.replace(next);
    } catch (err: any) {
      setMsg(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 18%, #000 52%)",
    color: "#fff",
    fontFamily: fontStack,
    padding: "20px 14px 120px",
    display: "grid",
    placeItems: "center",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 860,
    display: "flex",
    justifyContent: "center",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 460,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    overflow: "hidden",
    backdropFilter: "blur(10px)",
  };

  const innerPanelStyle: React.CSSProperties = {
    marginTop: 16,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
  };

  const labelTextStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: "rgba(255,255,255,0.92)",
    lineHeight: 1.2,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    fontWeight: 400,
    fontFamily: fontStack,
    transition: "border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease",
    boxSizing: "border-box",
  };

  const secondaryButtonStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const primaryButtonStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const linkStyle: React.CSSProperties = {
    color: "rgba(255,255,255,0.82)",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 400,
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <div style={cardStyle}>
          <div style={{ padding: 18 }}>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  letterSpacing: "-0.01em",
                }}
              >
                Iniciar sesión
              </h1>

              <p
                style={{
                  margin: "6px 0 0 0",
                  fontSize: 13,
                  fontWeight: 400,
                  color: "rgba(255,255,255,0.68)",
                  lineHeight: 1.45,
                }}
              >
                Accede con tu correo y contraseña.
              </p>
            </div>

            {registered && (
              <div
                style={{
                  marginTop: 14,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  padding: "10px 12px",
                  fontSize: 12,
                  fontWeight: 400,
                  color: "rgba(255,255,255,0.86)",
                  lineHeight: 1.45,
                }}
              >
                Cuenta creada. Revisa tu correo para verificarla.
              </div>
            )}

            <div style={innerPanelStyle}>
              <form onSubmit={handleLogin} style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelTextStyle}>Correo</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                    placeholder="tucorreo@ejemplo.com"
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelTextStyle}>Contraseña</span>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={inputStyle}
                    placeholder="Tu contraseña"
                  />
                </label>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  <Link href="/register" style={linkStyle}>
                    Crear cuenta
                  </Link>

                  <Link href="/reset-password" style={linkStyle}>
                    Olvidé mi contraseña
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    ...(loading ? secondaryButtonStyle : primaryButtonStyle),
                    marginTop: 4,
                    opacity: loading ? 0.82 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Entrando..." : "Entrar"}
                </button>
              </form>
            </div>

            {msg && (
              <div
                style={{
                  marginTop: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "10px 12px",
                  fontSize: 12,
                  fontWeight: 400,
                  color: "rgba(255,255,255,0.90)",
                  lineHeight: 1.45,
                }}
              >
                {msg}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}