"use client";

// Página TEMPORAL de diagnóstico: prueba si Facturapi nos entrega la API key de una
// organización (necesario para el self-billing del creador, Bloque 4). Solo un
// moderador puede ejecutarlo (el callable lo valida). Borrar cuando ya no se use.

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type ProbeResult = {
  endpoint: string;
  status: number;
  looksLikeKey: boolean;
  preview: string;
  tempOrgDeleted: boolean;
};

export default function FacturapiTestPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fn = httpsCallable<Record<string, never>, ProbeResult>(functions, "facturapiOrgKeyProbe");
      const res = await fn({});
      setResult(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Mensaje humano según el resultado.
  let verdict: { color: string; text: string } | null = null;
  if (result) {
    if (result.status === 200 && result.looksLikeKey) {
      verdict = { color: "#22c55e", text: "✅ ¡Funciona! Facturapi sí nos da la llave de la organización. Ya se puede seguir con la factura automática del creador." };
    } else if (result.status === 401 || result.status === 403) {
      verdict = { color: "#ef4444", text: "❌ Facturapi no nos deja obtener la llave (permiso o plan). Hay que activar el multi-tenant / pedirlo a su soporte." };
    } else if (result.status === 404) {
      verdict = { color: "#f59e0b", text: "⚠️ La ruta todavía no es la correcta. Pásale este resultado a Claude para ajustarla." };
    } else {
      verdict = { color: "#f59e0b", text: `Respuesta inesperada (status ${result.status}). Pásale el resultado a Claude.` };
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px", color: "#fff", fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Diagnóstico Facturapi</h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: "0 0 20px" }}>
        Prueba si Facturapi nos entrega la llave de una organización (para la factura automática del creador).
        Crea un cajón temporal, prueba la llave y lo borra solo. Debes ser moderador.
      </p>

      <button
        type="button"
        onClick={run}
        disabled={loading}
        style={{
          width: "100%", height: 48, borderRadius: 8, border: "none",
          background: loading ? "rgba(255,255,255,0.12)" : "#a855f7",
          color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: "inherit",
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "Probando…" : "Probar llave de Facturapi"}
      </button>

      {verdict && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: `1px solid ${verdict.color}`, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ color: verdict.color, fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>{verdict.text}</div>
        </div>
      )}

      {result && (
        <pre style={{ marginTop: 14, padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.8)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowX: "auto" }}>
{`status: ${result.status}
¿parece llave?: ${result.looksLikeKey ? "sí" : "no"}
respuesta: ${result.preview}
endpoint: ${result.endpoint}`}
        </pre>
      )}

      {error && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: "1px solid #ef4444", background: "rgba(120,18,18,0.28)", color: "#ffdada", fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" }}>
          {error}
        </div>
      )}
    </div>
  );
}
