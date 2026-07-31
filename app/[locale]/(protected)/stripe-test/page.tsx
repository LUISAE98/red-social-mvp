"use client";

// Página TEMPORAL de diagnóstico (S1): confirma que la conexión con Stripe funciona.
// Solo un moderador puede ejecutarla (el callable lo valida). Borrar cuando ya no se use.

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type Result = {
  ok: boolean;
  mode: "test" | "live";
  livemode: boolean | null;
  currencies: string[];
};

export default function StripeTestPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fn = httpsCallable<Record<string, never>, Result>(functions, "stripeHealthcheck");
      const res = await fn({});
      setResult(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px", color: "#fff", fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Diagnóstico Stripe (S1)</h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: "0 0 20px" }}>
        Confirma que la llave de Stripe funciona (hace una llamada real a /balance, no mueve dinero). Debes ser moderador.
      </p>

      <button
        type="button"
        onClick={run}
        disabled={loading}
        style={{
          width: "100%", height: 48, borderRadius: 8, border: "none",
          background: loading ? "rgba(255,255,255,0.12)" : "#635bff",
          color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: "inherit",
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "Probando…" : "Probar conexión con Stripe"}
      </button>

      {result && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: `1px solid ${result.ok ? "#22c55e" : "#ef4444"}`, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ color: result.ok ? "#22c55e" : "#ef4444", fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>
            {result.ok ? `✅ ¡Conexión con Stripe OK! (modo ${result.mode})` : "❌ Algo falló"}
          </div>
          <pre style={{ marginTop: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
{`modo: ${result.mode}
livemode: ${result.livemode}
monedas del balance: ${result.currencies.length ? result.currencies.join(", ") : "(vacío — normal en cuenta nueva)"}`}
          </pre>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: "1px solid #ef4444", background: "rgba(120,18,18,0.28)", color: "#ffdada", fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" }}>
          {error}
        </div>
      )}
    </div>
  );
}
