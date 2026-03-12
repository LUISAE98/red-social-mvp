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
      "radial-gradient(circle at top, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.018) 18%, #000 52%)",
    color: "#fff",
    fontFamily: fontStack,
    padding: "clamp(12px, 2.2vw, 18px) clamp(12px, 2.2vw, 18px) clamp(44px, 6vw, 72px)",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 332,
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
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    outline: "none",
    fontSize: 12.5,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
  };

  const linkStyle: React.CSSProperties = {
    color: "rgba(255,255,255,0.82)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    fontSize: 10.5,
    fontWeight: 400,
  };

  const secondaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const primaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const messageStyle: React.CSSProperties = {
    marginTop: 10,
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "7px 9px",
    fontSize: 10.5,
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
              margin: "5px 0 12px 0",
              fontSize: 12,
              color: "rgba(255,255,255,0.66)",
              lineHeight: 1.35,
            }}
          >
            Escribe tu correo y te mandaremos un enlace para restablecerla.
          </p>
        </div>

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

        {msg ? <div style={messageStyle}>{msg}</div> : null}
      </div>
    </main>
  );
}