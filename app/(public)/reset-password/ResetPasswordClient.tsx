"use client";

import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
const vibraBlue = "#4f46ff";

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
    position: "relative",
    zIndex: 1,
    background: "transparent",
    color: "#fff",
    fontFamily: fontStack,
    padding: "clamp(12px, 2.2vw, 18px) clamp(12px, 2.2vw, 18px) clamp(44px, 6vw, 72px)",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 380,
    padding: "24px 36px 34px",
    borderRadius: 18,
    border: "1px solid rgba(168, 85, 255, 0.58)",
    background: "rgba(10, 7, 28, 0.30)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 28px rgba(168,85,255,0.18)",
    backdropFilter: "blur(16px) saturate(120%)",
    WebkitBackdropFilter: "blur(16px) saturate(120%)",
    boxSizing: "border-box",
  };

  const innerPanelStyle: React.CSSProperties = {
    marginTop: 26,
  };

  const labelTextStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 500,
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.15,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 40,
    padding: "0 11px",
    borderRadius: 8,
    border: "1px solid rgba(168,85,255,0.22)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    outline: "none",
    fontSize: 12.5,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
  };

  const linkStyle: React.CSSProperties = {
    color: vibraPurple,
    textDecoration: "none",
    fontSize: 10.5,
    fontWeight: 600,
  };

  const primaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    padding: "8px 14px",
    borderRadius: 10,
    border: "none",
    background: `linear-gradient(100deg, ${vibraPink} 0%, ${vibraPurple} 52%, ${vibraBlue} 100%)`,
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    fontFamily: fontStack,
    cursor: "pointer",
    boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
    overflow: "hidden",
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
  };

  const messageStyle: React.CSSProperties = {
    marginTop: 10,
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "7px 9px",
    fontSize: 10.5,
    fontWeight: 400,
    color: "rgba(255,255,255,0.90)",
    lineHeight: 1.35,
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(18px, 2vw, 20px)",
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
            }}
          >
            Recuperar contraseña
          </h1>

          <p
            style={{
              margin: "5px 0 0 0",
              fontSize: 12,
              fontWeight: 400,
              color: "rgba(255,255,255,0.66)",
              lineHeight: 1.35,
            }}
          >
            Escribe tu correo y te mandaremos un enlace para restablecerla.
          </p>
        </div>

        <div style={innerPanelStyle}>
          <form onSubmit={handleReset} style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 4 }}>
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
                gap: 8,
                flexWrap: "wrap",
                marginTop: 1,
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
                marginTop: 2,
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
    </main>
  );
}