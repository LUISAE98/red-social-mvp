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
      setMsg(`❌ ${friendlyAuthError(err)}`);
    } finally {
      setLoading(false);
    }
  }

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#000",
        color: "#fff",
        fontFamily: fontStack,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.22)", // línea más clara
            background: "rgba(12,12,12,0.9)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ padding: 24 }}>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 600,
                margin: 0,
              }}
            >
              Iniciar sesión
            </h1>

            <p
              style={{
                marginTop: 6,
                marginBottom: 20,
                color: "rgba(255,255,255,0.78)",
                fontWeight: 400,
                fontSize: 14,
              }}
            >
              Accede con tu correo y contraseña
            </p>

            {registered && (
              <div
                style={{
                  background: "rgba(85,239,196,0.12)",
                  border: "1px solid rgba(85,239,196,0.30)",
                  padding: 10,
                  borderRadius: 10,
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                Cuenta creada. Revisa tu correo para verificarla.
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.90)",
                  }}
                >
                  Correo
                </span>

                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.30)", // líneas más visibles
                    background: "rgba(0,0,0,0.32)",
                    color: "#fff",
                    outline: "none",
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.90)",
                  }}
                >
                  Contraseña
                </span>

                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.30)", // líneas más visibles
                    background: "rgba(0,0,0,0.32)",
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
                  border: "1px solid rgba(255,255,255,0.28)", // línea clara
                  background: loading ? "rgba(255,255,255,0.15)" : "#fff",
                  color: loading ? "#fff" : "#000",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {loading ? "Entrando..." : "Entrar"}
              </button>
            </form>

            {msg && (
              <div
                style={{
                  marginTop: 14,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.92)",
                }}
              >
                {msg}
              </div>
            )}

            <div
              style={{
                marginTop: 18,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
              }}
            >
              <Link
                href="/register"
                style={{
                  color: "rgba(255,255,255,0.85)",
                  textDecoration: "none",
                }}
              >
                Crear cuenta
              </Link>

              <Link
                href="/reset-password"
                style={{
                  color: "rgba(255,255,255,0.85)",
                  textDecoration: "none",
                }}
              >
                Olvidé mi contraseña
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}