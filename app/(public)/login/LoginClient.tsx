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

async function applyAuthPersistence(keepSession: boolean) {
  if (!keepSession) {
    await setPersistence(auth, browserSessionPersistence);
    return;
  }

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    await setPersistence(auth, browserSessionPersistence);
  }
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
      await applyAuthPersistence(keepSession);
      await signInWithEmailAndPassword(auth, email.trim(), password);

      router.replace("/");
      router.refresh();
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

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "clamp(18px, 2vw, 20px)",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: 1.08,
  };

  const subtitleStyle: React.CSSProperties = {
    margin: "5px 0 12px 0",
    fontSize: 12,
    color: "rgba(255,255,255,0.66)",
    lineHeight: 1.35,
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
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    transition: "border-color 0.18s ease, background 0.18s ease",
    WebkitAppearance: "none",
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

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
  };

  const linkStyle: React.CSSProperties = {
    color: "rgba(255,255,255,0.8)",
    textDecoration: "none",
    fontSize: 10.5,
    fontWeight: 400,
  };

  const switchRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.022)",
  };

  const switchButtonStyle: React.CSSProperties = {
    position: "relative",
    width: 36,
    height: 20,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: keepSession ? "#ffffff" : "rgba(255,255,255,0.10)",
    transition: "all 0.2s ease",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  };

  const switchThumbStyle: React.CSSProperties = {
    position: "absolute",
    top: 2,
    left: keepSession ? 18 : 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: keepSession ? "#000" : "#fff",
    transition: "all 0.2s ease",
  };

  const noticeStyle: React.CSSProperties = {
    marginBottom: 10,
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "7px 9px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <div>
          <h1 style={titleStyle}>Iniciar sesión</h1>
          <p style={subtitleStyle}>Accede con tu correo y contraseña.</p>
        </div>

        {registered && (
          <div style={noticeStyle}>
            Cuenta creada. Revisa tu correo para verificarla.
          </div>
        )}

        <form
          onSubmit={handleLogin}
          style={{
            display: "grid",
            gap: 8,
          }}
        >
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

          <label style={{ display: "grid", gap: 4 }}>
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
                  fontSize: 11.5,
                  fontWeight: 600,
                  lineHeight: 1.15,
                  color: "rgba(255,255,255,0.93)",
                }}
              >
                Mantener sesión
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontSize: 10,
                  lineHeight: 1.25,
                  color: "rgba(255,255,255,0.6)",
                }}
              >
                Dispositivos personales
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
              gap: 8,
              marginTop: 1,
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
              marginTop: 2,
              opacity: loading ? 0.84 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        {msg && (
          <div style={{ ...noticeStyle, marginTop: 10, marginBottom: 0 }}>
            {msg}
          </div>
        )}
      </div>
    </main>
  );
}