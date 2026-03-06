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
      await sendPasswordResetEmail(auth, email);
      setMsg("✅ Listo. Te enviamos un correo para restablecer tu contraseña.");
    } catch (err: any) {
      setMsg(`❌ ${friendlyAuthError(err)}`);
    } finally {
      setLoading(false);
    }
  }

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const cardBorder = "1px solid rgba(255,255,255,0.22)";
  const fieldBorder = "1px solid rgba(255,255,255,0.30)";
  const fieldBg = "rgba(0,0,0,0.32)";

  return (
    <main
      style={{
        minHeight: "calc(100vh - 48px)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#000",
        color: "#fff",
        fontFamily: fontStack,
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div
          style={{
            borderRadius: 16,
            border: cardBorder,
            background: "rgba(12,12,12,0.9)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ padding: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Recuperar contraseña</h1>

            <p
              style={{
                marginTop: 6,
                marginBottom: 20,
                color: "rgba(255,255,255,0.78)",
                fontWeight: 400,
                fontSize: 14,
              }}
            >
              Escribe tu correo y te mandaremos un enlace para restablecerla.
            </p>

            <form onSubmit={handleReset} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>Correo</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: fieldBorder,
                    background: fieldBg,
                    color: "#fff",
                    outline: "none",
                    fontSize: 14,
                  }}
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: 4,
                  padding: "11px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.28)",
                  background: loading ? "rgba(255,255,255,0.15)" : "#fff",
                  color: loading ? "#fff" : "#000",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {loading ? "Enviando..." : "Enviar correo"}
              </button>
            </form>

            {msg && (
              <div style={{ marginTop: 14, fontSize: 13, color: "rgba(255,255,255,0.92)" }}>
                {msg}
              </div>
            )}

            <div style={{ marginTop: 18, display: "flex", gap: 12, fontSize: 13 }}>
              <Link href="/login" style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none" }}>
                Volver a login
              </Link>
              <Link href="/register" style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none" }}>
                Crear cuenta
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}