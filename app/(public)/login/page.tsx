"use client";
import { useEffect } from "react";
import { useAuth } from "@/app/providers";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../../lib/firebase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const { user, loading: authLoading } = useAuth();

useEffect(() => {
  if (!authLoading && user) {
    router.replace(next);
  }
}, [authLoading, user, router, next]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      setMsg(`✅ Sesión iniciada. UID: ${cred.user.uid}`);
      router.replace(next);
    } catch (err: any) {
      setMsg(`❌ Error: ${err?.message ?? "desconocido"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Login</h1>

      <form onSubmit={handleLogin} style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <label>
          Correo
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            style={{ width: "100%", padding: 8, display: "block", marginTop: 6 }}
          />
        </label>

        <label>
          Contraseña
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            style={{ width: "100%", padding: 8, display: "block", marginTop: 6 }}
          />
        </label>

        <button type="submit" disabled={loading} style={{ padding: 10, cursor: "pointer" }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      <p style={{ marginTop: 18, opacity: 0.7 }}>
        Tip: abre <code>/login</code> en tu navegador.
        <button
  type="button"
  onClick={async () => {
    await signOut(auth);
    setMsg("✅ Sesión cerrada.");
  }}
  style={{ marginTop: 12, padding: 10, cursor: "pointer" }}
>
  Cerrar sesión (logout)
</button>

      </p>
    </main>
  );
}
