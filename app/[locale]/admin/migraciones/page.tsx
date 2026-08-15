"use client";

// Migraciones de una sola vez.
//
// Los backfills viven detrás de `requirePlatformOwner` (claim de moderador MÁS
// sesión de Google MÁS el correo del dueño), así que no hay forma de dispararlos
// desde una máquina de desarrollo, solo desde una sesión real. Antes eso obligaba
// a invocarlos a mano desde la consola del navegador copiando el token de
// IndexedDB. Esta página es esa misma llamada, con dos botones.
//
// El panel entero está gateado a moderador de PLATAFORMA, pero estas funciones
// exigen además ser el dueño. Un moderador que entre aquí verá el error que
// devuelve la propia función, no una pantalla en blanco.

import { useState } from "react";
import { httpsCallable, type HttpsCallableResult } from "firebase/functions";
import { functions } from "@/lib/firebase";

type BackfillResult = {
  dryRun: boolean;
  scanned: number;
  updated: number;
  searchableFixed: number;
  playbackFixed: number;
};

type Phase = "idle" | "running" | "done" | "error";

export default function AdminMigrationsPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Aplicar sin haber contado antes es cómo se rompen las bases de datos. El
  // botón de escritura no se habilita hasta que la pasada en seco haya corrido
  // en ESTA sesión.
  const [dryRunDone, setDryRunDone] = useState(false);

  async function run(dryRun: boolean) {
    if (phase === "running") return;
    if (!dryRun && !dryRunDone) return;

    setPhase("running");
    setError(null);
    setResult(null);

    try {
      const fn = httpsCallable<{ dryRun: boolean }, BackfillResult>(
        functions,
        "backfillStoriesReelFields",
      );
      const res: HttpsCallableResult<BackfillResult> = await fn({ dryRun });
      setResult(res.data);
      setPhase("done");
      if (dryRun) setDryRunDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("error");
    }
  }

  const running = phase === "running";

  return (
    <>
      <style jsx>{`
        .wrap {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .card {
          border: 1px solid #1a1a1a;
          border-radius: 10px;
          padding: 16px;
          background: #0d0d0d;
        }

        .title {
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          margin: 0 0 6px;
        }

        .body {
          font-size: 12.5px;
          line-height: 1.55;
          color: #777;
          margin: 0;
        }

        .warn {
          margin-top: 10px;
          padding: 9px 11px;
          border-radius: 7px;
          border: 1px solid #3d2a15;
          background: #181004;
          color: #d9a441;
          font-size: 12px;
          line-height: 1.5;
        }

        .actions {
          display: flex;
          gap: 8px;
          margin-top: 14px;
        }

        .btn {
          padding: 8px 14px;
          border-radius: 8px;
          border: 1px solid #2a2a2a;
          background: #141414;
          color: #ddd;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: border-color 150ms, color 150ms, background 150ms;
        }

        .btn:hover:not(:disabled) {
          border-color: #444;
          color: #fff;
        }

        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .btnDanger {
          border-color: #3d1515;
          color: #f87171;
        }

        .btnDanger:hover:not(:disabled) {
          border-color: #6b2020;
          background: #1a0808;
          color: #fca5a5;
        }

        .rows {
          margin-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 1px;
          background: #1a1a1a;
          border: 1px solid #1a1a1a;
          border-radius: 8px;
          overflow: hidden;
        }

        .row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          padding: 9px 12px;
          background: #0d0d0d;
        }

        .rowLabel {
          font-size: 12px;
          color: #777;
        }

        .rowValue {
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          font-variant-numeric: tabular-nums;
        }

        .rowHint {
          font-size: 11px;
          color: #555;
          padding: 0 12px 10px;
          background: #0d0d0d;
          line-height: 1.5;
        }

        .badge {
          display: inline-block;
          margin-bottom: 10px;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .badgeDry {
          border: 1px solid #1e3a2f;
          background: #08160f;
          color: #4ade80;
        }

        .badgeLive {
          border: 1px solid #3d2a15;
          background: #181004;
          color: #d9a441;
        }

        .error {
          margin-top: 14px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid #3d1515;
          background: #140606;
          color: #f87171;
          font-size: 12px;
          line-height: 1.5;
          word-break: break-word;
        }
      `}</style>

      <div className="wrap">
        <div className="card">
          <h2 className="title">Historias, campos del feed de reels</h2>
          <p className="body">
            Escribe <code>byCreator</code> y <code>hiddenFromReel</code> en las
            historias anteriores al reel, que no los tienen. Sin esta pasada el
            feed nacería vacío, porque una consulta de Firestore no devuelve los
            documentos a los que les falta el campo que filtra.
          </p>
          <p className="body" style={{ marginTop: 8 }}>
            De paso recalcula <code>searchable</code> contra la visibilidad real
            de cada comunidad, y rescata el video de las historias que se
            publicaron mientras Mux todavía procesaba.
          </p>

          <div className="warn">
            Corre primero la pasada en seco. Si <code>searchableFixed</code> viene
            distinto de cero, son historias de comunidades que se volvieron
            privadas y que hoy siguen marcadas como públicas. Las reglas nuevas se
            apoyan en ese campo, así que no deben desplegarse hasta que esta
            migración se haya aplicado de verdad.
          </div>

          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={running}
              onClick={() => void run(true)}
            >
              {running ? "Corriendo..." : "Pasada en seco"}
            </button>
            <button
              type="button"
              className="btn btnDanger"
              disabled={running || !dryRunDone}
              onClick={() => void run(false)}
              title={
                dryRunDone
                  ? "Escribe los cambios en producción"
                  : "Corre antes la pasada en seco"
              }
            >
              Aplicar cambios
            </button>
          </div>

          {result && (
            <>
              <div className="rows">
                <div style={{ background: "#0d0d0d", padding: "10px 12px 0" }}>
                  <span
                    className={`badge ${result.dryRun ? "badgeDry" : "badgeLive"}`}
                  >
                    {result.dryRun ? "Pasada en seco, no escribió nada" : "Aplicado en producción"}
                  </span>
                </div>
                <div className="row">
                  <span className="rowLabel">Historias revisadas</span>
                  <span className="rowValue">{result.scanned}</span>
                </div>
                <div className="row">
                  <span className="rowLabel">
                    {result.dryRun ? "Necesitan cambios" : "Modificadas"}
                  </span>
                  <span className="rowValue">{result.updated}</span>
                </div>
                <div className="row">
                  <span className="rowLabel">
                    Marcadas como públicas sin serlo
                  </span>
                  <span className="rowValue">{result.searchableFixed}</span>
                </div>
                <div className="rowHint">
                  Historias de comunidades que dejaron de ser públicas. Son las
                  que obligan a aplicar esto antes de desplegar las reglas.
                </div>
                <div className="row">
                  <span className="rowLabel">Videos rescatados</span>
                  <span className="rowValue">{result.playbackFixed}</span>
                </div>
                <div className="rowHint">
                  Historias que se quedaron sin <code>muxPlaybackId</code> por
                  publicarse antes de que Mux terminara. En un carrusel se veían
                  como una miniatura gris, en el reel serían un slide negro.
                </div>
              </div>

              {result.dryRun && result.updated > 0 && (
                <p className="body" style={{ marginTop: 12 }}>
                  Si los números cuadran, pulsa Aplicar cambios. La migración es
                  idempotente, repetirla no hace daño.
                </p>
              )}
            </>
          )}

          {error && (
            <div className="error">
              {error}
              {error.toLowerCase().includes("permission") && (
                <div style={{ marginTop: 6, color: "#a15757" }}>
                  Esta migración exige ser el dueño de la plataforma, con sesión
                  iniciada por Google. Ser moderador no basta.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
