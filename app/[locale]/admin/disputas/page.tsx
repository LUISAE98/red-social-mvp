"use client";

// Disputas de Stripe — la pantalla que faltaba.
//
// EL PROBLEMA QUE CIERRA
//
// Las disputas se registraban en `stripeDisputes` y **no se veían en ninguna parte**. Había que
// entrar a Stripe a mano para saber que existían. Una disputa sin responder se pierde por
// incomparecencia: el dinero se va aunque el servicio se haya prestado.
//
// 🚨 EL PLAZO MANDA, y por eso ordena la lista. Lo que vence antes va arriba. Ordenar por fecha
//    de apertura pondría primero una disputa vieja con plazo holgado y última la que vence
//    mañana, que es justo al revés de lo que hace falta.
//
// ⚠️ ENVIAR LA EVIDENCIA ES IRREVERSIBLE, y se manda una sola vez. Por eso el botón de
//    «Preparar» solo la reúne y la enseña; el de «Enviar» no aparece hasta haberla leído.
//
// ⚠️ A veces la respuesta correcta es NO RESPONDER: cuando el comprador tiene razón, sale más
//    barato aceptar que perder también la comisión de la disputa. Esta pantalla no decide eso.

import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

/** Espejo de `DisputaListada` en `backend/src/payments/stripe/responderDisputa.ts`. */
type Disputa = {
  disputeId: string;
  chargeId: string | null;
  amount: number | null;
  currency: string | null;
  reason: string | null;
  status: string;
  plazoHasta: string | null;
  respondida: boolean;
  abiertaEn: string | null;
  diasRestantes: number | null;
};

type Evidencia = {
  product_description: string;
  service_date?: string;
  customer_name?: string;
  customer_email_address?: string;
  access_activity_log?: string;
  uncategorized_text: string;
};

type Respuesta = {
  disputeId: string;
  enviada: boolean;
  evidencia: Evidencia;
  huecos: string[];
};

/**
 * Por qué la abrió el comprador, en castellano.
 *
 * Cambia qué evidencia convence: contra `product_not_received` pesa el registro de acceso, y
 * contra `fraudulent` pesan el correo y el país desde el que se compró.
 */
const MOTIVOS: Record<string, string> = {
  fraudulent: "Dice que no reconoce el cargo",
  product_not_received: "Dice que no recibió lo que compró",
  product_unacceptable: "Dice que lo recibido no era lo ofrecido",
  duplicate: "Dice que se le cobró dos veces",
  subscription_canceled: "Dice que había cancelado la suscripción",
  credit_not_processed: "Dice que se le prometió un reembolso que no llegó",
  unrecognized: "No reconoce el cargo en su estado de cuenta",
  general: "Sin motivo concreto",
};

const RESULTADOS: Record<string, { texto: string; tono: "gana" | "pierde" | "neutro" }> = {
  won: { texto: "Ganada", tono: "gana" },
  lost: { texto: "Perdida", tono: "pierde" },
  warning_closed: { texto: "Cerrada sin cargo", tono: "neutro" },
};

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Los importes de Stripe vienen en centavos. Sin moneda no se inventa una. */
function dinero(centavos: number | null, moneda: string | null): string {
  if (centavos === null) return "—";
  const n = (centavos / 100).toFixed(2);
  return moneda ? `${n} ${moneda}` : n;
}

function fecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function DisputasPage() {
  const { toast, showToast } = useVibraToast();

  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [incluirCerradas, setIncluirCerradas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** La evidencia preparada, por disputa. Se guarda para poder leerla antes de mandarla. */
  const [borradores, setBorradores] = useState<Record<string, Respuesta>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const fn = httpsCallable<
        { incluirCerradas: boolean },
        { disputas: Disputa[]; pendientes: number }
      >(functions, "listarDisputas");
      const r = await fn({ incluirCerradas });
      setDisputas(r.data.disputas);
      setPendientes(r.data.pendientes);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCargando(false);
    }
  }, [incluirCerradas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Reúne la evidencia SIN mandarla.
   *
   * 🚨 Es el paso obligatorio antes de enviar, y es deliberado. Una evidencia se manda una vez;
   *    leerla primero cuesta un minuto y evita mandar un texto que dice «(sin fecha)».
   */
  async function preparar(disputeId: string) {
    setOcupado(disputeId);
    setError(null);
    try {
      const fn = httpsCallable<{ disputeId: string; enviar: boolean }, Respuesta>(
        functions,
        "responderDisputa"
      );
      const r = await fn({ disputeId, enviar: false });
      setBorradores((prev) => ({ ...prev, [disputeId]: r.data }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setOcupado(null);
    }
  }

  async function enviar(disputeId: string) {
    if (
      !window.confirm(
        "La evidencia se envía a Stripe y NO se puede cambiar después. ¿La mandas tal como está?"
      )
    ) {
      return;
    }
    setOcupado(disputeId);
    setError(null);
    try {
      const fn = httpsCallable<{ disputeId: string; enviar: boolean }, Respuesta>(
        functions,
        "responderDisputa"
      );
      await fn({ disputeId, enviar: true });
      showToast("Evidencia enviada a Stripe.", "success");
      setBorradores((prev) => {
        const copia = { ...prev };
        delete copia[disputeId];
        return copia;
      });
      await cargar();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="pagina">
      <header className="cabecera">
        <h1 className="titulo">Disputas</h1>
        <p className="desc">
          Contracargos abiertos por los compradores en su banco. Una disputa sin responder antes
          de su plazo se pierde por incomparecencia, y el dinero se va aunque el servicio se haya
          prestado.
        </p>
        {pendientes > 0 && (
          <div className="alerta">
            {pendientes === 1
              ? "1 disputa está esperando respuesta."
              : `${pendientes} disputas están esperando respuesta.`}
          </div>
        )}
      </header>

      <div className="barra">
        <label className="check">
          <input
            type="checkbox"
            checked={incluirCerradas}
            onChange={(e) => setIncluirCerradas(e.target.checked)}
          />
          Ver también las cerradas
        </label>
        <button className="btn" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      {error && (
        <div className="errores">
          <p className="errorLinea">{error}</p>
        </div>
      )}

      {!cargando && disputas.length === 0 && (
        <p className="vacio">
          {incluirCerradas
            ? "No hay ninguna disputa registrada."
            : "No hay disputas abiertas. Es la mejor noticia de esta pantalla."}
        </p>
      )}

      {disputas.map((d) => {
        const cerrada = d.status !== "open";
        const resultado = RESULTADOS[d.status];
        const vencida = d.diasRestantes !== null && d.diasRestantes < 0;
        const urgente = d.diasRestantes !== null && d.diasRestantes >= 0 && d.diasRestantes <= 3;
        const borrador = borradores[d.disputeId];

        return (
          <article
            key={d.disputeId}
            className={`card ${!cerrada && !d.respondida && (vencida || urgente) ? "cardUrgente" : ""}`}
          >
            <div className="fila">
              <span className="importe">{dinero(d.amount, d.currency)}</span>
              {cerrada ? (
                <span className={`badge tono-${resultado?.tono ?? "neutro"}`}>
                  {resultado?.texto ?? d.status}
                </span>
              ) : d.respondida ? (
                <span className="badge tono-neutro">Respondida, esperando a Stripe</span>
              ) : vencida ? (
                <span className="badge tono-pierde">Plazo vencido</span>
              ) : (
                <span className={`badge ${urgente ? "tono-pierde" : "tono-abierta"}`}>
                  {d.diasRestantes === null
                    ? "Abierta, sin plazo conocido"
                    : d.diasRestantes === 0
                      ? "Vence HOY"
                      : `Quedan ${d.diasRestantes} días`}
                </span>
              )}
            </div>

            <p className="motivo">{d.reason ? (MOTIVOS[d.reason] ?? d.reason) : "Sin motivo"}</p>

            <dl className="datos">
              <div>
                <dt>Abierta</dt>
                <dd>{fecha(d.abiertaEn)}</dd>
              </div>
              <div>
                <dt>Plazo</dt>
                <dd>{fecha(d.plazoHasta)}</dd>
              </div>
              <div>
                <dt>Cargo</dt>
                <dd className="mono">{d.chargeId ?? "—"}</dd>
              </div>
              <div>
                <dt>Disputa</dt>
                <dd className="mono">{d.disputeId}</dd>
              </div>
            </dl>

            {!cerrada && !d.respondida && (
              <>
                <div className="actions">
                  <button
                    className="btn"
                    onClick={() => void preparar(d.disputeId)}
                    disabled={ocupado === d.disputeId}
                  >
                    {ocupado === d.disputeId ? "Trabajando…" : "Preparar evidencia"}
                  </button>
                  {borrador && (
                    <button
                      className="btn btnEnviar"
                      onClick={() => void enviar(d.disputeId)}
                      disabled={ocupado === d.disputeId}
                    >
                      Enviar a Stripe
                    </button>
                  )}
                </div>

                {borrador && (
                  <div className="borrador">
                    <p className="borradorTitulo">Esto es lo que se mandaría</p>

                    {borrador.huecos.length > 0 && (
                      <div className="warn">
                        {borrador.huecos.map((h, i) => (
                          <p key={i}>{h}</p>
                        ))}
                      </div>
                    )}

                    <p className="campo">
                      <span>Qué se vendió</span>
                      {borrador.evidencia.product_description}
                    </p>
                    {borrador.evidencia.service_date && (
                      <p className="campo">
                        <span>Fecha del servicio</span>
                        {borrador.evidencia.service_date}
                      </p>
                    )}
                    {borrador.evidencia.customer_email_address && (
                      <p className="campo">
                        <span>Correo del comprador</span>
                        {borrador.evidencia.customer_email_address}
                      </p>
                    )}
                    {borrador.evidencia.access_activity_log && (
                      <p className="campo">
                        <span>Registro de acceso</span>
                        {borrador.evidencia.access_activity_log}
                      </p>
                    )}
                    <p className="campo">
                      <span>Relato</span>
                      {borrador.evidencia.uncategorized_text}
                    </p>

                    <p className="hint">
                      Se envía una sola vez y no se puede corregir después. Si algo de arriba está
                      mal o falta, corrígelo en el sistema y vuelve a prepararla.
                    </p>
                  </div>
                )}
              </>
            )}
          </article>
        );
      })}

      <VibraToast toast={toast} />

      <style jsx>{`
        .pagina {
          padding: 4px 0 40px;
        }
        .cabecera {
          margin-bottom: 18px;
        }
        .titulo {
          margin: 0 0 8px;
          font-size: 20px;
          font-weight: 700;
          color: #eee;
        }
        .desc {
          margin: 0;
          font-size: 13px;
          color: #999;
          line-height: 1.55;
        }
        .alerta {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          background: #1a0808;
          border: 1px solid #3d1515;
          color: #fca5a5;
          font-size: 12.5px;
          font-weight: 600;
        }
        .barra {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 4px;
        }
        .check {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12.5px;
          color: #999;
          cursor: pointer;
        }
        .card {
          margin-top: 18px;
          border: 1px solid #1a1a1a;
          border-radius: 12px;
          padding: 18px;
          background: #0a0a0a;
        }
        .cardUrgente {
          border-color: #3d1515;
        }
        .fila {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .importe {
          font-size: 17px;
          font-weight: 700;
          color: #eee;
        }
        .badge {
          display: inline-block;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }
        .tono-abierta {
          background: #17111f;
          color: #a855f7;
        }
        .tono-pierde {
          background: #1a0808;
          color: #f87171;
        }
        .tono-gana {
          background: #0a1a0f;
          color: #4ade80;
        }
        .tono-neutro {
          background: #141414;
          color: #999;
        }
        .motivo {
          margin: 10px 0 0;
          font-size: 13.5px;
          color: #ddd;
        }
        .datos {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
          margin: 14px 0 0;
        }
        .datos dt {
          font-size: 11px;
          color: #666;
          margin-bottom: 3px;
        }
        .datos dd {
          margin: 0;
          font-size: 12.5px;
          color: #bbb;
        }
        .mono {
          font-family: ui-monospace, monospace;
          font-size: 11px;
          word-break: break-all;
        }
        .actions {
          display: flex;
          gap: 8px;
          margin-top: 14px;
          flex-wrap: wrap;
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
          font-family: inherit;
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btnEnviar {
          border-color: #3d1515;
          color: #f87171;
        }
        .borrador {
          margin-top: 14px;
          padding: 14px;
          border-radius: 10px;
          background: #0d0d0d;
          border: 1px solid #1a1a1a;
        }
        .borradorTitulo {
          margin: 0 0 10px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          color: #777;
        }
        .campo {
          margin: 0 0 10px;
          font-size: 12.5px;
          color: #ccc;
          line-height: 1.55;
        }
        .campo span {
          display: block;
          font-size: 11px;
          color: #666;
          margin-bottom: 2px;
        }
        .warn {
          margin-bottom: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          background: #181004;
          color: #d9a441;
          font-size: 12px;
          line-height: 1.5;
        }
        .warn p {
          margin: 0;
        }
        .errores {
          margin-top: 14px;
          padding: 10px 12px;
          border-radius: 8px;
          background: #1a0808;
          border: 1px solid #3d1515;
        }
        .errorLinea {
          margin: 0;
          font-size: 11.5px;
          color: #fca5a5;
          line-height: 1.55;
          word-break: break-word;
        }
        .vacio {
          margin-top: 24px;
          font-size: 13px;
          color: #666;
        }
        .hint {
          margin: 12px 0 0;
          font-size: 11.5px;
          color: #666;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
