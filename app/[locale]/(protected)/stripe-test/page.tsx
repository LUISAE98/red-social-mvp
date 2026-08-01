"use client";

// Página TEMPORAL de diagnóstico (S1): confirma que la conexión con Stripe funciona.
// Solo un moderador puede ejecutarla (el callable lo valida). Borrar cuando ya no se use.

import { useEffect, useState } from "react";
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
  const [paying, setPaying] = useState(false);
  // Aviso del retorno de Stripe Checkout (?pago=ok | cancelado).
  const [payMsg, setPayMsg] = useState<"ok" | "cancelado" | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("pago");
    if (p === "ok" || p === "cancelado") setPayMsg(p);
  }, []);

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const fn = httpsCallable<{ origin: string }, { url: string }>(functions, "createStripeCheckoutSession");
      const res = await fn({ origin: window.location.origin });
      window.location.href = res.data.url; // redirige a la página de pago de Stripe
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPaying(false);
    }
  }

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
        S1: confirma que la llave funciona. S2: prueba un cobro real ($50 MXN) con Stripe Checkout. Debes ser moderador.
      </p>

      {payMsg && (
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, border: `1px solid ${payMsg === "ok" ? "#22c55e" : "#f59e0b"}`, background: "rgba(255,255,255,0.03)", color: payMsg === "ok" ? "#22c55e" : "#f59e0b", fontSize: 14, fontWeight: 600 }}>
          {payMsg === "ok" ? "✅ ¡Pago de prueba completado! Verifícalo en el dashboard de Stripe (Payments)." : "⚠️ Pago cancelado."}
        </div>
      )}

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
        {loading ? "Probando…" : "S1 · Probar conexión con Stripe"}
      </button>

      <button
        type="button"
        onClick={pay}
        disabled={paying}
        style={{
          marginTop: 12, width: "100%", height: 48, borderRadius: 8, border: "none",
          background: paying ? "rgba(255,255,255,0.12)" : "#0a7d33",
          color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: "inherit",
          cursor: paying ? "default" : "pointer",
        }}
      >
        {paying ? "Redirigiendo a Stripe…" : "S2 · Probar cobro de $50 MXN (Checkout)"}
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
