"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DEV TEMPORAL — ejecutar la migración de monedas MXN → USD.
//
// La migración (`migrateCurrencyMxnToUsd`) está gateada al dueño de la plataforma,
// así que debe correrse desde una sesión autenticada. Esta página da dos botones:
//   1) Dry run  → simula y muestra el conteo, SIN escribir.
//   2) Migrar    → corrida real: refresca las tasas a base USD y convierte todos
//                  los precios guardados de MXN a USD (idempotente).
//
// ⚠️ BORRAR esta carpeta (app/[locale]/dev/migrate-currency) después del cutover.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/app/providers";

export default function MigrateCurrencyDevPage() {
  const { user } = useAuth();
  const [running, setRunning] = useState<null | "dry" | "real">(null);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function run(dryRun: boolean) {
    setRunning(dryRun ? "dry" : "real");
    setError("");
    setResult("");
    try {
      const fn = httpsCallable(functions, "migrateCurrencyMxnToUsd");
      const res = await fn({ dryRun });
      setResult(JSON.stringify(res.data, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0a", color: "#fff", fontFamily: "inherit", padding: 24, display: "grid", placeItems: "center" }}>
      <div style={{ maxWidth: 520, width: "100%", display: "grid", gap: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Migración de monedas MXN → USD</div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: 0 }}>
          Sesión: <strong>{user?.email ?? "— (inicia sesión como dueño)"}</strong>. Corre primero el
          dry run para revisar el conteo; luego la migración real (refresca tasas a USD + convierte
          todos los precios). Es idempotente.
        </p>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => run(true)}
            disabled={running !== null}
            style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.6 : 1 }}
          >
            {running === "dry" ? "Simulando…" : "Dry run (simular)"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("¿Correr la migración REAL? Convierte todos los precios guardados MXN → USD.")) run(false);
            }}
            disabled={running !== null}
            style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.6 : 1 }}
          >
            {running === "real" ? "Migrando…" : "Migrar (real)"}
          </button>
        </div>

        {result && (
          <pre style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 14, fontSize: 12.5, color: "#4ade80", overflowX: "auto", margin: 0 }}>
            {result}
          </pre>
        )}
        {error && (
          <pre style={{ background: "#111", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 10, padding: 14, fontSize: 12.5, color: "#f87171", whiteSpace: "pre-wrap", margin: 0 }}>
            {error}
          </pre>
        )}
      </div>
    </div>
  );
}
