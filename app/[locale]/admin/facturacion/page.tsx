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
import { useVibraToast, type ToastType } from "@/lib/hooks/useVibraToast";

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

/** Lo que devuelve `runCreatorMonthlyDocs`. */
type ResumenDelMes = {
  periodo: string;
  creadores: number;
  comision: number;
  retenciones: number;
  liquidaciones: number;
  saltados: number;
  errores: number;
  detalles?: string[];
  timbrado: boolean;
};

/** Lo que devuelve la liberación con motivo 04. */
type Liberacion = {
  /** UUID de la global que se canceló, o null si no había ninguna viva. */
  canceladoUuid: string | null;
  /** UUID de la global reexpedida sin esa venta. Null si ya no quedaban ventas que cubrir. */
  nuevaGlobalUuid: string | null;
  /** Cuántas ventas siguen amparadas por la global nueva. */
  ventasRestantes: number;
};

/** Lo que devuelve la cancelación de un comprobante mensual. */
type Cancelacion = {
  tipo: "comision" | "retenciones";
  folio: string | null;
  uuid: string | null;
  /** `en_proceso` significa que el creador todavía tiene que aceptar la cancelación. */
  estado: "cancelado" | "en_proceso" | "sin_timbrar";
  /** Si el mes quedó libre para volver a emitirse. */
  liberado: boolean;
};

/** Lo que devuelve la emisión de una nota de crédito. */
type NotaCredito = {
  facturapiId: string;
  uuid: string | null;
  /** Lo acreditado en ESTA nota, sin impuesto. */
  base: number;
  /** Lo acreditado en total sobre esa compra, contando las anteriores. */
  acumulado: number;
  /** Lo que queda por devolver. No se puede acreditar más que esto. */
  restante: number;
};

type Phase = "idle" | "running" | "done" | "error";

/** El mes mexicano de hoy. */
function mesMx(): string {
  const l = new Date(Date.now() - 6 * 3_600_000);
  return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}`;
}

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

      <ComprobantesDelMes onError={setError} showToast={showToast} />

      <LiberarDeGlobal onError={setError} showToast={showToast} />

      <CancelarComprobanteMensual onError={setError} showToast={showToast} />

      <NotaDeCredito onError={setError} showToast={showToast} />

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
function Fila({ k, v, hint }: { k: string; v: number | string; hint?: string }) {
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
          /* Un UUID no cabe en una línea y no debe desbordar la tarjeta. */
          text-align: end;
          overflow-wrap: anywhere;
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

/**
 * Los comprobantes que Vibra emite AL CREADOR cada mes.
 *
 * Van aparte de la global porque tienen otra cadencia y otro emisor: la global la emite el
 * creador con su sello y sale a diario; estos los emite Vibra con el suyo y son mensuales,
 * porque la comisión es un servicio continuado y la constancia de retenciones es periódica
 * por naturaleza.
 */
function ComprobantesDelMes({
  onError,
  showToast,
}: {
  onError: (e: string | null) => void;
  showToast: (m: string, t: "success" | "error" | "info") => void;
}) {
  const [periodo, setPeriodo] = useState(mesMx);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ResumenDelMes | null>(null);
  const [seenSeco, setSeenSeco] = useState<string | null>(null);

  const valido = /^\d{4}-\d{2}$/.test(periodo);
  const secoListo = seenSeco === periodo;
  const corriendo = phase === "running";

  async function correr(timbrar: boolean) {
    if (corriendo || !valido) return;
    if (timbrar && !secoListo) return;

    setPhase("running");
    onError(null);
    setResult(null);

    try {
      const fn = httpsCallable<{ periodo: string; timbrar?: boolean }, ResumenDelMes>(
        functions,
        "runCreatorMonthlyDocs"
      );
      const res = await fn(timbrar ? { periodo, timbrar: true } : { periodo });
      setResult(res.data);
      setPhase("done");
      if (!timbrar) setSeenSeco(periodo);
      showToast(
        timbrar
          ? `Emitidos ${res.data.comision} de comisión y ${res.data.retenciones} constancia(s).`
          : `En seco: ${res.data.creadores} creador(es) con movimiento en ${periodo}.`,
        timbrar ? "success" : "info"
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  return (
    <section className="card">
      <span className="badge">Comisión y constancia de retenciones</span>
      <p className="desc">
        Los dos comprobantes que Vibra le emite al creador cada mes, con su propio sello. Son
        mensuales a propósito, no diarios como la global.
      </p>

      <div className="warn">
        🚨 La constancia de retenciones es el documento con el que el creador acredita ante el
        SAT lo que se le retuvo, y el SAT lo cruza con la declaración informativa. Cuenta en seco
        y revisa antes de emitir.
      </div>

      <label className="label" htmlFor="periodo">
        Mes
      </label>
      <input
        id="periodo"
        className="input"
        type="month"
        value={periodo}
        disabled={corriendo}
        onChange={(e) => setPeriodo(e.target.value)}
      />

      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={corriendo || !valido}
          onClick={() => correr(false)}
        >
          {corriendo ? "Contando…" : "Contar en seco"}
        </button>
        <button
          type="button"
          className="btn btnDanger"
          disabled={corriendo || !valido || !secoListo}
          onClick={() => correr(true)}
        >
          Emitir de verdad
        </button>
      </div>

      {result && (
        <>
          <div className="rows">
            <Fila
              k="Creadores con movimiento"
              v={result.creadores}
              hint="Con al menos una venta ganada en el mes."
            />
            <Fila
              k="CFDI de comisión"
              v={result.comision}
              hint="Vibra le factura su 25% más el impuesto de esa comisión."
            />
            <Fila
              k="Constancias de retenciones"
              v={result.retenciones}
              hint="Con el complemento de plataformas tecnológicas. Solo si hubo retención mexicana."
            />
            <Fila
              k="Comprobantes de liquidación"
              v={result.liquidaciones}
              hint="Para el creador extranjero sin retención mexicana. No es un CFDI, se genera siempre."
            />
            <Fila
              k="Saltados"
              v={result.saltados}
              hint="Ya se habían emitido ese mes. No se duplican."
            />
            <Fila k="Errores" v={result.errores} />
          </div>

          {result.detalles && result.detalles.length > 0 && (
            <div className="errores">
              {result.detalles.map((d, i) => (
                <p key={i} className="errorLinea">
                  {d}
                </p>
              ))}
            </div>
          )}

          <p className="hint">
            {result.timbrado
              ? "Esta pasada TIMBRÓ. Los documentos existen."
              : "Pasada en seco. No se timbró nada."}
          </p>
        </>
      )}

      <style jsx>{`
        .card {
          margin-top: 18px;
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
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btnDanger {
          border-color: #3d1515;
          color: #f87171;
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
        .hint {
          margin-top: 10px;
          font-size: 11.5px;
          color: #666;
          line-height: 1.5;
        }
      `}</style>
    </section>
  );
}

/**
 * Saca una compra de la factura global para que el comprador pueda tener la suya (motivo 04).
 *
 * 🚨 POR QUÉ HACE FALTA UN BOTÓN Y NO SE HACE SOLO.
 *
 *    Cuando el comprador pide su factura y la compra ya entró en una global, el flujo lo
 *    RECHAZA a propósito y le dice que escriba. No es una carencia: el trámite cancela un CFDI
 *    ya timbrado con el sello del creador y reexpide otro, y eso no se dispara desde el botón
 *    de un comprador. Alguien de la plataforma tiene que decidirlo.
 *
 *    Este panel es esa mano. Hasta que existió, la única forma era entrar a la base de datos.
 *
 * ⚠️ El orden importa y lo garantiza el backend: **primero cancela, luego reexpide**. Al revés,
 *    un fallo a la mitad dejaría dos globales vivas cubriendo la misma venta.
 */
function LiberarDeGlobal({
  onError,
  showToast,
}: {
  onError: (m: string | null) => void;
  showToast: (m: string | null, tipo?: ToastType) => void;
}) {
  const [buyerId, setBuyerId] = useState("");
  const [purchaseId, setPurchaseId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [salida, setSalida] = useState<Liberacion | null>(null);
  /**
   * 🚨 El error TAL CUAL, sin pasar por `cfError`.
   *
   * El toast traduce los mensajes conocidos y a los demás les pone «Ocurrió un error, intenta
   * de nuevo». Para un comprador eso está bien; para una herramienta que cancela CFDI es
   * inútil, esconde justo el dato que hace falta. Aquí se enseña el código y el mensaje
   * originales.
   */
  const [crudo, setCrudo] = useState<string | null>(null);

  const corriendo = phase === "running";
  const listo = buyerId.trim().length > 0 && purchaseId.trim().length > 0;

  async function liberar() {
    if (corriendo || !listo) return;
    setPhase("running");
    setSalida(null);
    setCrudo(null);
    onError(null);
    try {
      const fn = httpsCallable<
        { buyerId: string; purchaseId: string },
        Liberacion
      >(functions, "cancelarGlobalPorNominativa");
      const r = await fn({ buyerId: buyerId.trim(), purchaseId: purchaseId.trim() });
      setSalida(r.data);
      setPhase("done");
      showToast(
        r.data.nuevaGlobalUuid
          ? `Liberada. La global se reexpidió sin esa compra.`
          : `Liberada. No quedaban más ventas, así que no hubo global nueva.`,
        "success"
      );
    } catch (err) {
      setPhase("error");
      // Los errores de un callable traen `code` («permission-denied», «not-found»…), que dice
      // mucho más que el mensaje. Se enseñan los dos.
      const codigo = (err as { code?: string })?.code;
      const mensaje = err instanceof Error ? err.message : String(err);
      setCrudo(codigo ? `${codigo} — ${mensaje}` : mensaje);
      onError(mensaje);
    }
  }

  return (
    <section className="card">
      <span className="badge">Liberar de la global</span>
      <p className="desc">
        Cuando un comprador pide su factura y la compra ya entró en la global del creador, hay
        que cancelar esa global con motivo 04, reexpedirla sin esa venta y dejar la compra libre.
        Esto hace los tres pasos.
      </p>

      <div className="warn">
        🚨 Cancela un CFDI que ya está timbrado con el sello del creador. Comprueba que el
        comprador de verdad pidió su factura antes de correrlo.
      </div>

      <label className="label" htmlFor="buyerId">
        Comprador
      </label>
      <input
        id="buyerId"
        className="input"
        value={buyerId}
        disabled={corriendo}
        placeholder="uid del comprador"
        onChange={(ev) => setBuyerId(ev.target.value)}
      />

      <label className="label" htmlFor="purchaseId">
        Compra
      </label>
      <input
        id="purchaseId"
        className="input"
        value={purchaseId}
        disabled={corriendo}
        placeholder="id del documento de compra"
        onChange={(ev) => setPurchaseId(ev.target.value)}
      />

      <div className="actions">
        <button
          type="button"
          className="btn btnDanger"
          disabled={corriendo || !listo}
          onClick={liberar}
        >
          {corriendo ? "Liberando…" : "Cancelar y liberar"}
        </button>
      </div>

      {crudo ? (
        <div className="errores">
          <p className="errorLinea">{crudo}</p>
          {crudo.includes("permission-denied") || crudo.includes("moderador") ? (
            <p className="errorLinea">
              Esta herramienta exige el permiso de supermoderador Y haber iniciado sesión con
              Google. Con correo y contraseña no basta, aunque el menú lateral se vea.
            </p>
          ) : null}
        </div>
      ) : null}

      {salida ? (
        <div className="rows">
          <Fila
            k="Global cancelada"
            v={salida.canceladoUuid ?? "ninguna"}
            hint="El CFDI que dejó de amparar esas ventas."
          />
          <Fila
            k="Global reexpedida"
            v={salida.nuevaGlobalUuid ?? "no hizo falta"}
            hint="La nueva, sin la venta liberada. Si no quedaban más ventas, no se emite ninguna."
          />
          <Fila
            k="Ventas que siguen cubiertas"
            v={salida.ventasRestantes}
          />
        </div>
      ) : null}

      <p className="hint">
        Después de esto el comprador ya puede pedir su factura desde su propia pantalla, sin
        que nadie más intervenga.
      </p>

      {/*
        ⚠️ styled-jsx NO cruza de un componente a otro, aunque vivan en el mismo archivo: cada
        uno recibe su propio hash. Sin este bloque el panel sale sin ningún estilo —texto suelto
        sobre el fondo— y no avisa de nada. Es lo que pasó la primera vez.
      */}
      <style jsx>{`
        .card {
          margin-top: 18px;
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
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btnDanger {
          border-color: #3d1515;
          color: #f87171;
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
      `}</style>
    </section>
  );
}
/**
 * Cancela un comprobante mensual del creador para poder volver a emitir ese mes.
 *
 * 🚨 Sustituye a `scripts/anular-comprobante-mensual.mjs`, que solo quitaba el candado y **dejaba
 *    el CFDI vivo en Facturapi**. En pruebas daba igual; en producción eso son dos comprobantes
 *    vigentes del mismo periodo.
 *
 * ⚠️ La constancia se cancela en firme al instante. La comisión va a nombre del creador, así que
 *    por encima de 1 000 pesos el SAT exige que él acepte, y hasta entonces queda EN PROCESO —
 *    el mes NO se libera, porque reexpedir con el anterior vigente es el error caro.
 */
function CancelarComprobanteMensual({
  onError,
  showToast,
}: {
  onError: (m: string | null) => void;
  showToast: (m: string | null, tipo?: ToastType) => void;
}) {
  const [creatorId, setCreatorId] = useState("");
  const [periodo, setPeriodo] = useState(mesMx);
  const [tipo, setTipo] = useState<"comision" | "retenciones">("retenciones");
  const [phase, setPhase] = useState<Phase>("idle");
  const [salida, setSalida] = useState<Cancelacion | null>(null);
  const [crudo, setCrudo] = useState<string | null>(null);

  const corriendo = phase === "running";
  const listo = creatorId.trim().length > 0 && /^\d{4}-\d{2}$/.test(periodo);

  async function cancelar() {
    if (corriendo || !listo) return;
    setPhase("running");
    setSalida(null);
    setCrudo(null);
    onError(null);
    try {
      const fn = httpsCallable<{ creatorId: string; periodo: string; tipo: string }, Cancelacion>(
        functions,
        "cancelarComprobanteMensualCallable"
      );
      const r = await fn({ creatorId: creatorId.trim(), periodo, tipo });
      setSalida(r.data);
      setPhase("done");
      showToast(
        r.data.liberado
          ? "Cancelado. Ese mes ya se puede volver a emitir."
          : "Pedida la cancelación. Falta que el creador la acepte.",
        r.data.liberado ? "success" : "warning"
      );
    } catch (err) {
      setPhase("error");
      const codigo = (err as { code?: string })?.code;
      const mensaje = err instanceof Error ? err.message : String(err);
      setCrudo(codigo ? `${codigo} — ${mensaje}` : mensaje);
      onError(mensaje);
    }
  }

  return (
    <section className="card">
      <span className="badge">Cancelar comprobante mensual</span>
      <p className="desc">
        Cancela la comisión o la constancia de un creador en un mes, para poder volver a emitirla
        corregida. Cancela en Facturapi y retira el candado que impide repetir el mes.
      </p>

      <div className="warn">
        🚨 Cancela un CFDI ya timbrado, con motivo 02, «emitido con errores sin sustitución». El
        documento corregido se emite después, desde el panel de comprobantes del mes.
      </div>

      <label className="label" htmlFor="cancelCreator">
        Creador
      </label>
      <input
        id="cancelCreator"
        className="input"
        value={creatorId}
        disabled={corriendo}
        placeholder="uid del creador"
        onChange={(ev) => setCreatorId(ev.target.value)}
      />

      <label className="label" htmlFor="cancelMes">
        Mes
      </label>
      <input
        id="cancelMes"
        className="input"
        type="month"
        value={periodo}
        disabled={corriendo}
        onChange={(ev) => setPeriodo(ev.target.value)}
      />

      <label className="label" htmlFor="cancelTipo">
        Documento
      </label>
      <select
        id="cancelTipo"
        className="input"
        value={tipo}
        disabled={corriendo}
        onChange={(ev) => setTipo(ev.target.value as "comision" | "retenciones")}
      >
        <option value="retenciones">Constancia de retenciones</option>
        <option value="comision">CFDI de comisión</option>
      </select>

      <div className="actions">
        <button
          type="button"
          className="btn btnDanger"
          disabled={corriendo || !listo}
          onClick={cancelar}
        >
          {corriendo ? "Cancelando…" : "Cancelar comprobante"}
        </button>
      </div>

      {crudo ? (
        <div className="errores">
          <p className="errorLinea">{crudo}</p>
        </div>
      ) : null}

      {salida ? (
        <div className="rows">
          <Fila
            k="Estado"
            v={
              salida.estado === "cancelado"
                ? "cancelado en firme"
                : salida.estado === "en_proceso"
                  ? "esperando al creador"
                  : "no estaba timbrado"
            }
            hint={
              salida.liberado
                ? "El mes quedó libre, ya se puede volver a emitir."
                : "El mes SIGUE bloqueado hasta que la cancelación quede en firme."
            }
          />
          <Fila k="Folio" v={salida.folio ?? "no tenía"} />
          <Fila k="UUID" v={salida.uuid ?? "no tenía"} />
        </div>
      ) : null}

      <p className="hint">
        El registro no se borra, se archiva en creatorMonthlyDocsAnulados con quién lo pidió y en
        qué estado quedó el CFDI.
      </p>

      {/* ⚠️ styled-jsx no cruza de un componente a otro: este bloque es obligatorio. */}
      <style jsx>{`
        .card {
          margin-top: 18px;
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
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btnDanger {
          border-color: #3d1515;
          color: #f87171;
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
        .hint {
          margin-top: 10px;
          font-size: 11.5px;
          color: #666;
          line-height: 1.5;
        }
      `}</style>
    </section>
  );
}

/**
 * Emite la nota de crédito de una compra ya facturada.
 *
 * 🚨 CUÁNDO ES ESTE DOCUMENTO Y NO UNA CANCELACIÓN. Cancelar sirve dentro del mes y para
 *    operaciones completas. Una devolución PARCIAL, o una total con el mes ya cerrado, se
 *    documenta con nota de crédito: un CFDI no se cancela a medias.
 *
 * ⚠️ Solo contra una factura NOMINATIVA. Una venta que solo está dentro de una global se corrige
 *    cancelando la global y reexpidiéndola, con el panel de arriba.
 */
function NotaDeCredito({
  onError,
  showToast,
}: {
  onError: (m: string | null) => void;
  showToast: (m: string | null, tipo?: ToastType) => void;
}) {
  const [buyerId, setBuyerId] = useState("");
  const [purchaseId, setPurchaseId] = useState("");
  const [base, setBase] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [salida, setSalida] = useState<NotaCredito | null>(null);
  const [crudo, setCrudo] = useState<string | null>(null);

  const corriendo = phase === "running";
  const importe = Number(base);
  const listo =
    buyerId.trim().length > 0 &&
    purchaseId.trim().length > 0 &&
    Number.isFinite(importe) &&
    importe > 0;

  async function emitir() {
    if (corriendo || !listo) return;
    setPhase("running");
    setSalida(null);
    setCrudo(null);
    onError(null);
    try {
      const fn = httpsCallable<
        { buyerId: string; purchaseId: string; base: number },
        NotaCredito
      >(functions, "emitirNotaDeCreditoCallable");
      const r = await fn({
        buyerId: buyerId.trim(),
        purchaseId: purchaseId.trim(),
        base: importe,
      });
      setSalida(r.data);
      setPhase("done");
      showToast("Nota de crédito emitida.", "success");
    } catch (err) {
      setPhase("error");
      const codigo = (err as { code?: string })?.code;
      const mensaje = err instanceof Error ? err.message : String(err);
      setCrudo(codigo ? `${codigo} — ${mensaje}` : mensaje);
      onError(mensaje);
    }
  }

  return (
    <section className="card">
      <span className="badge">Nota de crédito</span>
      <p className="desc">
        Documenta una devolución sobre una compra que ya tiene su factura. La emite el CREADOR con
        su sello, relacionada al UUID de la factura original.
      </p>

      <div className="warn">
        🚨 Para devoluciones PARCIALES, o totales de un mes ya cerrado. Si la devolución es total y
        el mes sigue abierto, es más limpio cancelar la factura.
      </div>

      <label className="label" htmlFor="ncBuyer">
        Comprador
      </label>
      <input
        id="ncBuyer"
        className="input"
        value={buyerId}
        disabled={corriendo}
        placeholder="uid del comprador"
        onChange={(ev) => setBuyerId(ev.target.value)}
      />

      <label className="label" htmlFor="ncPurchase">
        Compra
      </label>
      <input
        id="ncPurchase"
        className="input"
        value={purchaseId}
        disabled={corriendo}
        placeholder="id del documento de compra"
        onChange={(ev) => setPurchaseId(ev.target.value)}
      />

      <label className="label" htmlFor="ncBase">
        Importe a devolver, SIN impuesto, en pesos
      </label>
      <input
        id="ncBase"
        className="input"
        type="number"
        step="0.01"
        min="0"
        value={base}
        disabled={corriendo}
        placeholder="0.00"
        onChange={(ev) => setBase(ev.target.value)}
      />

      <div className="actions">
        <button
          type="button"
          className="btn btnDanger"
          disabled={corriendo || !listo}
          onClick={emitir}
        >
          {corriendo ? "Emitiendo…" : "Emitir nota de crédito"}
        </button>
      </div>

      {crudo ? (
        <div className="errores">
          <p className="errorLinea">{crudo}</p>
        </div>
      ) : null}

      {salida ? (
        <div className="rows">
          <Fila k="UUID" v={salida.uuid ?? "sin folio"} />
          <Fila k="Acreditado ahora" v={salida.base.toFixed(2)} />
          <Fila
            k="Acreditado en total"
            v={salida.acumulado.toFixed(2)}
            hint="Contando las notas anteriores de esta misma compra."
          />
          <Fila
            k="Queda por devolver"
            v={salida.restante.toFixed(2)}
            hint="No se puede acreditar más que esto."
          />
        </div>
      ) : null}

      <p className="hint">
        El importe va sin impuesto. El IVA se calcula encima, con la misma tasa que llevó la
        venta, así que una exportación se acredita al 0%.
      </p>

      {/* ⚠️ styled-jsx no cruza de un componente a otro: este bloque es obligatorio. */}
      <style jsx>{`
        .card {
          margin-top: 18px;
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
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btnDanger {
          border-color: #3d1515;
          color: #f87171;
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
        .hint {
          margin-top: 10px;
          font-size: 11.5px;
          color: #666;
          line-height: 1.5;
        }
      `}</style>
    </section>
  );
}
