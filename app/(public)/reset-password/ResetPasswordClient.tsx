"use client";

import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";

function friendlyAuthError(err: any) {
  const code = err?.code as string | undefined;

  if (code === "auth/invalid-email") return "El correo no es válido.";
  if (code === "auth/user-not-found") return "No existe una cuenta con ese correo.";
  if (code === "auth/too-many-requests") return "Demasiados intentos. Intenta más tarde.";
  if (code === "auth/network-request-failed") return "Error de red. Revisa tu conexión.";

  return "Error inesperado. Intenta nuevamente.";
}

export default function ResetPasswordClient() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg("Listo. Te enviamos un correo para restablecer tu contraseña.");
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
    boxSizing: "border-box",
  };

  const linkStyle: React.CSSProperties = {
    color: "rgba(255,255,255,0.82)",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 400,
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

  const messageStyle: React.CSSProperties = {
    marginTop: 12,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "10px 12px",
    fontSize: 12,
    fontWeight: 400,
    color: "rgba(255,255,255,0.90)",
    lineHeight: 1.45,
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
                Recuperar contraseña
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
                Escribe tu correo y te mandaremos un enlace para restablecerla.
              </p>
            </div>

            <div style={innerPanelStyle}>
              <form onSubmit={handleReset} style={{ display: "grid", gap: 12 }}>
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

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  <Link href="/login" style={linkStyle}>
                    Volver a login
                  </Link>

                  <Link href="/register" style={linkStyle}>
                    Crear cuenta
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
                  {loading ? "Enviando..." : "Enviar correo"}
                </button>
              </form>
            </div>

            {msg ? <div style={messageStyle}>{msg}</div> : null}
          </div>
        </div>
      </div>
    </main>
  );
}