"use client";

import { useState } from "react";
import {
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
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
  const [keepSession, setKeepSession] = useState(true);
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
      await setPersistence(
        auth,
        keepSession ? browserLocalPersistence : browserSessionPersistence
      );

      await signInWithEmailAndPassword(auth, email.trim(), password);

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
    minHeight: "100dvh",
    background:
      "radial-gradient(circle at top, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 18%, #000 52%)",
    color: "#fff",
    fontFamily: fontStack,
    padding: "clamp(16px, 3vw, 28px) clamp(14px, 3vw, 22px) clamp(72px, 10vw, 120px)",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 920,
    display: "flex",
    justifyContent: "center",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 460,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    overflow: "hidden",
    backdropFilter: "blur(10px)",
  };

  const contentStyle: React.CSSProperties = {
    padding: "clamp(16px, 3vw, 24px)",
  };

  const innerPanelStyle: React.CSSProperties = {
    marginTop: 16,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    padding: "clamp(14px, 2.5vw, 18px)",
  };

  const labelTextStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: "rgba(255,255,255,0.92)",
    lineHeight: 1.2,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    outline: "none",
    fontSize: 14,
    fontWeight: 400,
    fontFamily: fontStack,
    transition: "border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease",
    boxSizing: "border-box",
  };

  const secondaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 42,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const primaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 42,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 14,
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

  const switchRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 2,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.025)",
  };

  const switchButtonStyle: React.CSSProperties = {
    position: "relative",
    width: 48,
    height: 28,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: keepSession ? "#ffffff" : "rgba(255,255,255,0.12)",
    transition: "all 0.2s ease",
    cursor: "pointer",
    flexShrink: 0,
  };

  const switchThumbStyle: React.CSSProperties = {
    position: "absolute",
    top: 3,
    left: keepSession ? 23 : 3,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: keepSession ? "#000" : "#fff",
    transition: "all 0.2s ease",
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <div style={cardStyle}>
          <div style={contentStyle}>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "clamp(20px, 3vw, 24px)",
                  fontWeight: 600,
                  lineHeight: 1.15,
                  letterSpacing: "-0.01em",
                }}
              >
                Iniciar sesión
              </h1>

              <p
                style={{
                  margin: "8px 0 0 0",
                  fontSize: "clamp(13px, 2vw, 14px)",
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

                <div style={switchRowStyle}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.94)",
                        lineHeight: 1.2,
                      }}
                    >
                      Mantener sesión iniciada
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 12,
                        fontWeight: 400,
                        color: "rgba(255,255,255,0.62)",
                        lineHeight: 1.35,
                      }}
                    >
                      Recomendado en dispositivos personales.
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-pressed={keepSession}
                    aria-label="Mantener sesión iniciada"
                    onClick={() => setKeepSession((prev) => !prev)}
                    style={switchButtonStyle}
                  >
                    <span style={switchThumbStyle} />
                  </button>
                </div>

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