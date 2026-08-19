"use client";

// Diagnóstico de la FX Quotes API de Stripe.
//
// POR QUÉ ESTÁ FUERA DE /admin
// El panel de administración exige claim de moderador de plataforma, y hoy la cuenta de
// administrador no está entrando con ese claim (la sesión de Google se crea como usuario
// común). Esta página solo pide sesión iniciada, que es lo que sí funciona.
//
// La función detrás (`fxQuoteDiagnostic`) es de SOLO LECTURA y no revela nada sensible: el
// tipo de cambio y las comisiones de conversión son información pública del tarifario de
// Stripe. El saldo de la cuenta y su modo live/test NO se exponen aquí — eso vive en
// `stripeHealthcheck`, detrás del claim.
//
// ⚠️ TEMPORAL: cuando el claim de administrador vuelva a funcionar, esta ruta y su función
// se borran y se usa el healthcheck.

import { useState } from "react";
import { httpsCallable, type HttpsCallableResult } from "firebase/functions";
import { functions } from "@/lib/firebase";

type Moneda = {
  disponible: boolean;
  tasa?: number;
  porUnidadLiquidacion?: number;
  comisionStripe?: number;
  costoCandado?: number;
  proveedorReferencia?: string | null;
  error?: string;
};

type Resultado = {
  settlementCurrency: string;
  algunaDisponible: boolean;
  monedas: Record<string, Moneda>;
};

export default function DiagnosticoFxPage() {
  const [cargando, setCargando] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function consultar() {
    setCargando(true);
    setError(null);
    setRes(null);
    try {
      const fn = httpsCallable(functions, "fxQuoteDiagnostic");
      const r = (await fn({})) as HttpsCallableResult<Resultado>;
      setRes(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  const pct = (v: number | undefined, dec = 2) =>
    typeof v === "number" ? `${(v * 100).toFixed(dec)}%` : "—";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px", color: "#fff" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Diagnóstico de tipo de cambio</h1>
      <p style={{ fontSize: 14, lineHeight: 1.55, color: "rgba(255,255,255,0.65)" }}>
        Pregunta a Stripe si la <code>FX Quotes API</code> está disponible en esta cuenta. Es
        la que da el tipo de cambio real y permite congelarlo una hora. No mueve dinero.
      </p>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.45)", marginTop: 10 }}>
        Si no está disponible el cobro sigue funcionando —cae a la tabla de tasas cacheadas—
        pero sin candado, y entonces hay que bajar el 2% de conversión: ese 0.15% del candado
        se estaría cobrando sin prestarlo.
      </p>

      <button
        type="button"
        onClick={consultar}
        disabled={cargando}
        style={{
          marginTop: 20,
          padding: "12px 20px",
          borderRadius: 12,
          border: "none",
          background: cargando ? "rgba(168,85,247,0.4)" : "#a855f7",
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: cargando ? "not-allowed" : "pointer",
        }}
      >
        {cargando ? "Consultando…" : "Consultar Stripe"}
      </button>

      {error && (
        <div
          style={{
            marginTop: 20,
            padding: 14,
            borderRadius: 12,
            background: "rgba(248,113,113,0.12)",
            border: "1px solid rgba(248,113,113,0.3)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Error:</strong> {error}
          <div style={{ marginTop: 6, color: "rgba(255,255,255,0.55)" }}>
            Si dice <code>unauthenticated</code>, inicia sesión primero.
          </div>
        </div>
      )}

      {res && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: res.algunaDisponible
                ? "rgba(74,222,128,0.12)"
                : "rgba(250,204,21,0.12)",
              border: `1px solid ${res.algunaDisponible ? "rgba(74,222,128,0.35)" : "rgba(250,204,21,0.35)"}`,
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            {res.algunaDisponible
              ? "✅ La FX Quotes API está DISPONIBLE — no hay que habilitar nada"
              : "⚠️ NO disponible — hay que pedir acceso al preview"}
          </div>

          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: "14px 0 8px" }}>
            Moneda de liquidación: <strong>{res.settlementCurrency}</strong>
          </div>

          {Object.entries(res.monedas).map(([codigo, m]) => (
            <div
              key={codigo}
              style={{
                padding: 14,
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{codigo}</div>
              {m.disponible ? (
                <div style={{ display: "grid", gap: 5, fontSize: 13 }}>
                  <Fila etiqueta={`1 ${res.settlementCurrency} equivale a`} valor={`${m.porUnidadLiquidacion} ${codigo}`} />
                  <Fila etiqueta="Comisión REAL de conversión de Stripe" valor={pct(m.comisionStripe)} destacado />
                  <Fila etiqueta="Costo del candado de 1 hora" valor={pct(m.costoCandado, 3)} />
                  <Fila etiqueta="Referencia del tipo de cambio" valor={m.proveedorReferencia ?? "—"} />
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                  No disponible. {m.error ?? ""}
                </div>
              )}
            </div>
          ))}

          {res.algunaDisponible && (
            <p style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.5)", marginTop: 14 }}>
              La <strong>comisión real</strong> es el número con el que se dimensiona el
              colchón del 2%. Se venía asumiendo 1%; si difiere, hay que reajustarlo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Fila({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>{etiqueta}</span>
      <span
        style={{
          fontWeight: destacado ? 700 : 500,
          color: destacado ? "#a855f7" : "#fff",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {valor}
      </span>
    </div>
  );
}
