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

  return (
    <main
      style={{
        minHeight: "calc(100vh - 48px)",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
          Recuperar contraseña
        </h1>

        <p style={{ marginTop: 8, marginBottom: 16, color: "#555" }}>
          Escribe tu correo y te mandaremos un enlace para restablecerla.
        </p>

        <form onSubmit={handleReset} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Correo</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #111",
              background: loading ? "#ddd" : "#111",
              color: loading ? "#333" : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {loading ? "Enviando..." : "Enviar correo"}
          </button>
        </form>

        {msg && <p style={{ marginTop: 12, marginBottom: 0 }}>{msg}</p>}

        <div style={{ marginTop: 16, display: "flex", gap: 12, fontSize: 14 }}>
          <Link href="/login">Volver a login</Link>
          <Link href="/register">Crear cuenta</Link>
        </div>
      </div>
    </main>
  );
}