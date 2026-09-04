"use client";

// Herramientas de facturación, para disparar a mano lo que el cron hace solo.
//
// Existe por lo mismo que la página de migraciones: estas funciones viven detrás de
// `requirePlatformMod` —claim de moderador MÁS sesión de Google— así que no se pueden
// invocar desde una máquina de desarrollo, solo desde una sesión real. La alternativa
// era pegar código en la consola del navegador, que es una forma horrible de operar
// algo que timbra documentos fiscales.
//
// 🚨 EL TIMBRADO ES IRREVERSIBLE. Cancelar un CFDI es un trámite, no un borrado. Por eso
// el botón que emite de verdad no se habilita hasta haber corrido la pasada en seco en
// ESTA sesión, igual que en las migraciones.
//
// Hoy Facturapi está en modo PRUEBA (`sk_test`), así que lo que se timbre aquí no tiene
// efectos fiscales. Cuando se pase a producción, esta pantalla emite de verdad.

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

/** Lo que devuelve `runGlobalInvoiceDay`. */
type ResumenDelDia = {
  dia: string;
  creadores: number;
  emitidas: number;
  sinSello: number;
  simuladas: number;
  ventasSinPesos: number;
  ventasAtascadas: number;
  liberadasSoltadas: number;
  colaRecogida: number;
  errores: number;
  /** Qué falló, no solo cuántos. */
  detalles?: string[];
  timbrado: boolean;
};

type Phase = "idle" | "running" | "done" | "error";

/** El día mexicano de hoy. México es UTC-6 fijo desde que quitaron el horario de verano. */
function hoyMx(): string {
  const l = new Date(Date.now() - 6 * 3_600_000);
  return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}-${String(
    l.getUTCDate()
  ).padStart(2, "0")}`;
}

export default function AdminFacturacionPage() {
  const [dia, setDia] = useState(hoyMx);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ResumenDelDia | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Timbrar sin haber contado antes es cómo se emiten CFDI por error. El botón que
   * emite no se habilita hasta que la pasada en seco de ESE MISMO DÍA haya corrido.
   */
  const [seenSeco, setSeenSeco] = useState<string | null>(null);
  const secoListo = seenSeco === dia;

  const diaValido = useMemo(() => /^\d{4}-\d{2}-\d{2}$/.test(dia), [dia]);

  const { toast, showToast } = useVibraToast();
  useEffect(() => {
    if (!error) return;
    const extra = error.toLowerCase().includes("permission")
      ? " Esta herramienta exige ser supermoderador, con sesión iniciada por Google."
      : "";
    showToast(`${error}${extra}`, "error");
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  async function correr(timbrar: boolean) {
    if (phase === "running" || !diaValido) return;
    if (timbrar && !secoListo) return;

    setPhase("running");
    setError(null);
    setResult(null);

    try {
      const fn = httpsCallable<{ dia: string; timbrar?: boolean }, ResumenDelDia>(
        functions,
        "runGlobalInvoiceDay"
      );
      const res = await fn(timbrar ? { dia, timbrar: true } : { dia });
      setResult(res.data);
      setPhase("done");
      if (!timbrar) setSeenSeco(dia);
      showToast(
        timbrar
          ? `Emitidas ${res.data.emitidas} factura(s) global(es) del ${dia}.`
          : `En seco: ${res.data.simuladas} global(es) saldrían del ${dia}.`,
        timbrar ? "success" : "info"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  /**
   * Suelta las ventas que un intento fallido dejó apartadas.
   *
   * Un fallo al timbrar las deja en `emitiendo` y fuera de cualquier global — es el estado
   * seguro, pero sin esto hay que entrar a la base de datos a mano para poder reintentar.
   * Solo suelta las que NO llegaron a tener folio; con folio el CFDI existe y soltarlas lo
   * duplicaría.
   */
  async function liberar() {
    if (corriendo || !diaValido) return;
    setPhase("running");
    setError(null);
    try {
      const fn = httpsCallable<{ dia: string }, { sueltas: number; conFolio: number }>(
        functions,
        "liberarVentasAtascadas"
      );
      const r = await fn({ dia });
      setPhase("idle");
      setResult(null);
      setSeenSeco(null);
      showToast(
        r.data.conFolio > 0
          ? `Liberadas ${r.data.sueltas}. ⚠️ ${r.data.conFolio} tienen folio y NO se tocaron: su CFDI existe.`
          : `Liberadas ${r.data.sueltas} venta(s). Vuelve a contar en seco.`,
        r.data.conFolio > 0 ? "info" : "success"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  const corriendo = phase === "running";

  return (
    <div className="wrap">
      <h1 className="title">Facturación</h1>

      <section className="card">
        <span className="badge">Factura global</span>
        <p className="desc">
          Emite la factura global de un día para los creadores que vendieron. Es lo mismo
          que hace el proceso automático cada madrugada, disparado a mano.
        </p>

        <div className="warn">
          🚨 Timbrar es irreversible. Cancelar un CFDI es un trámite, no un borrado. Corre
          siempre la pasada en seco primero y revisa los números.
        </div>

        <label className="label" htmlFor="dia">
          Día a facturar
        </label>
        <input
          id="dia"
          className="input"
          type="date"
          value={dia}
          disabled={corriendo}
          onChange={(e) => setDia(e.target.value)}
        />

        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={corriendo || !diaValido}
            onClick={() => correr(false)}
          >
            {corriendo ? "Contando…" : "Contar en seco"}
          </button>
          <button
            type="button"
            className="btn btnDanger"
            disabled={corriendo || !diaValido || !secoListo}
            onClick={() => correr(true)}
          >
            Timbrar de verdad
          </button>
          <button
            type="button"
            className="btn"
            disabled={corriendo || !diaValido}
            onClick={liberar}
          >
            Liberar atascadas
          </button>
        </div>
        <p className="hint">
          Si un intento falla, las ventas se quedan apartadas y no se pueden volver a facturar
          hasta soltarlas. «Liberar atascadas» hace eso, y nunca toca las que ya tienen folio.
        </p>

        {!secoListo && (
          <p className="hint">
            El botón de timbrar se habilita al contar en seco este mismo día.
          </p>
        )}

        {result && (
          <>
            <div className="rows">
              <Fila
                k="Facturas emitidas"
                v={result.emitidas}
                hint="Globales timbradas de verdad."
              />
              <Fila
                k="Se habrían emitido"
                v={result.simuladas}
                hint="Lo que saldría si timbraras. Solo aparece en las pasadas en seco."
              />
              <Fila
                k="Creadores con ventas"
                v={result.creadores}
                hint="Con al menos una venta sin facturar ese día."
              />
              <Fila
                k="Sin sello digital"
                v={result.sinSello}
                hint="Vendieron pero no pueden emitir. No es un error del proceso: les falta subir su sello."
              />
              <Fila
                k="Ventas sin pesos congelados"
                v={result.ventasSinPesos}
                hint="Quedan fuera a propósito. Se recogen con el backfill de importes."
              />
              <Fila
                k="Ventas atascadas"
                v={result.ventasAtascadas}
                hint="Se apartaron para una global que nunca se confirmó. No se timbran dos veces, pero hay que mirarlas."
              />
              <Fila
                k="Facturas de la cola"
                v={result.colaRecogida}
                hint="Peticiones que esperaban al sello del creador y se emitieron en esta pasada."
              />
              <Fila k="Errores" v={result.errores} />
            </div>

            {/* El motivo, no solo la cuenta. Sin esto hay que ir a buscar el log del
                servidor, que es justo lo que esta pantalla vino a evitar. */}
            {result.detalles && result.detalles.length > 0 && (
              <div className="errores">
                {result.detalles.map((d, i) => (
                  <p key={i} className="errorLinea">{d}</p>
                ))}
              </div>
            )}
            <p className="hint">
              {result.timbrado
                ? "Esta pasada TIMBRÓ. Los documentos existen."
                : "Pasada en seco. No se emitió ni se marcó nada."}
            </p>
          </>
        )}
      </section>

      <VibraToast toast={toast} />

      <style jsx>{`
        .wrap {
          max-width: 640px;
          margin: 0 auto;
          padding: 24px 16px 60px;
        }
        .title {
          font-size: 20px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 18px;
        }
        .card {
          border: 1px solid #1a1a1a;
          border-radius: 12px;
          padding: 18px;
          background: #0a0a0a;
        }
        .badge {
          display: inline-block;
          margin-bottom: 10px;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          background: #17111f;
          color: #a855f7;
        }
        .desc {
          font-size: 13px;
          color: #999;
          line-height: 1.55;
        }
        .warn {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          background: #181004;
          color: #d9a441;
          font-size: 12px;
          line-height: 1.5;
        }
        .label {
          display: block;
          margin-top: 16px;
          margin-bottom: 6px;
          font-size: 12px;
          color: #777;
        }
        .input {
          width: 100%;
          padding: 9px 12px;
          border-radius: 8px;
          border: 1px solid #2a2a2a;
          background: #141414;
          color: #eee;
          font-size: 13px;
          font-family: inherit;
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
        .hint {
          margin-top: 10px;
          font-size: 11.5px;
          color: #666;
          line-height: 1.5;
        }
        .errores {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          background: #1a0808;
          border: 1px solid #3d1515;
        }
        .errorLinea {
          font-size: 11.5px;
          color: #fca5a5;
          line-height: 1.55;
          word-break: break-word;
        }
        .errorLinea + .errorLinea {
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}

/** Una cifra del resumen, con su explicación debajo cuando hace falta. */
function Fila({ k, v, hint }: { k: string; v: number; hint?: string }) {
  return (
    <div className="fila">
      <div className="linea">
        <span className="k">{k}</span>
        <span className="v">{v}</span>
      </div>
      {hint && <div className="hint">{hint}</div>}
      <style jsx>{`
        .fila {
          background: #0d0d0d;
        }
        .linea {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          padding: 9px 12px;
        }
        .k {
          font-size: 12px;
          color: #777;
        }
        .v {
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          font-variant-numeric: tabular-nums;
        }
        .hint {
          font-size: 11px;
          color: #555;
          padding: 0 12px 10px;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
