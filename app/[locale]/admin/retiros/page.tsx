"use client";

// Retiros — la bandeja donde administración acepta o rechaza lo que pide un creador.
//
// 🚨 ESTA PANTALLA MUEVE DINERO. Aceptar aquí manda una transferencia bancaria a una cuenta
//    que solo se ha podido comprobar por sus últimos cuatro dígitos. Por eso el paso humano
//    existe, y por eso rechazar EXIGE un motivo: es lo único que el creador va a leer.
//
// El saldo ya está descontado desde que el creador solicitó. Aceptar no descuenta nada nuevo;
// rechazar se lo devuelve entero. Ver `backend/src/wallet/withdrawals.ts`.

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { TextButton } from "@/components/ui";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { formatCurrency, convertFromAnchor } from "@/lib/currency/format";
import { displayCurrencyForCountry } from "@/lib/currency/catalog";
import { costeRetiro } from "@/lib/wallet/payoutFees";
import { payoutTermsOf } from "@/lib/wallet/payoutTiers";
import { useExchangeRates } from "@/lib/currency/rates";
import {
  suscribirRetiros,
  reviewWithdrawal,
  markWithdrawalPaid,
  enlaceDidit,
  type WithdrawalRequestDoc,
  type WithdrawalStatus,
} from "@/lib/wallet/withdrawals";

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * El Record es EXHAUSTIVO a propósito: al agregar `sent` al tipo, TypeScript reventó aquí en
 * vez de dejar un estado sin etiqueta que se pintaría como `undefined` en el panel.
 */
const ESTADO: Record<WithdrawalStatus, { label: string; color: string }> = {
  pending: { label: "En verificación", color: "#f59e0b" },
  approved: { label: "Verificada, sin enviar", color: "#f59e0b" },
  rejected: { label: "Rechazada", color: "#f87171" },
  /** El dinero salió y el banco todavía no lo acredita. De uno a siete días según el país. */
  sent: { label: "En proceso de envío", color: "#60a5fa" },
  paid: { label: "Completada", color: "#34d399" },
  failed: { label: "Falló el envío", color: "#f87171" },
};

/** Motivos frecuentes, para no escribir lo mismo cada vez. El texto se puede editar. */
const MOTIVOS = [
  "La cuenta que declaraste no coincide con la que registraste en Stripe.",
  "Tu cuenta de cobro está incompleta y el banco rechazaría la transferencia.",
  "Necesitamos verificar tu identidad otra vez antes de enviarte dinero.",
  "Hay una revisión abierta sobre tus ventas, te contactamos por correo.",
];

function fecha(ts: WithdrawalRequestDoc["createdAt"]): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export default function AdminRetiros() {
  const { toast, showToast } = useVibraToast();
  const [rows, setRows] = useState<WithdrawalRequestDoc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Nombres de creador, cacheados: la solicitud solo guarda el uid. */
  const [nombres, setNombres] = useState<Record<string, string>>({});
  /** Qué solicitud está en curso, para apagar solo sus botones. */
  const [ocupada, setOcupada] = useState<string | null>(null);
  /** Cuál está en modo rechazo, con su motivo escrito. */
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  /** Referencia de la transferencia de Wallbit, para poder rastrearla después. */
  const [referencia, setReferencia] = useState("");

  useEffect(() => {
    const parar = suscribirRetiros(
      (r) => {
        setRows(r);
        setCargando(false);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setCargando(false);
      }
    );
    return parar;
  }, []);

  // Los nombres, uno por creador y una sola vez.
  useEffect(() => {
    const faltan = [...new Set(rows.map((r) => r.creatorId))].filter((id) => !(id in nombres));
    if (!faltan.length) return;
    let vivo = true;
    (async () => {
      const encontrados: Record<string, string> = {};
      await Promise.all(
        faltan.map(async (id) => {
          try {
            const s = await getDoc(doc(db, "users", id));
            const d = s.data() ?? {};
            encontrados[id] = String(d.displayName ?? d.handle ?? id.slice(0, 8));
          } catch {
            encontrados[id] = id.slice(0, 8);
          }
        })
      );
      if (vivo) setNombres((prev) => ({ ...prev, ...encontrados }));
    })();
    return () => {
      vivo = false;
    };
  }, [rows, nombres]);

  const pendientes = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  /**
   * Aceptadas cuyo dinero todavía no ha salido.
   *
   * Hoy son solo las de Wallbit: las de Stripe pasan a `paid` en el mismo clic, porque el
   * `OutboundPayment` sale ahí. Una de Stripe aquí significa que el envío falló a medias.
   */
  const porPagar = useMemo(() => rows.filter((r) => r.status === "approved"), [rows]);
  /**
   * 🚚 Stripe ya mandó el dinero y el banco todavía no lo acredita. De uno a siete días.
   *
   * Tienen grupo propio porque ni están pendientes de nada nuestro ni están resueltas: si
   * alguna se queda aquí una semana, es que algo se atascó y hay que mirarla en Stripe.
   */
  const enCamino = useMemo(() => rows.filter((r) => r.status === "sent"), [rows]);
  const resueltas = useMemo(
    () => rows.filter((r) => r.status !== "pending" && r.status !== "approved" && r.status !== "sent"),
    [rows]
  );

  async function cerrarPago(r: WithdrawalRequestDoc) {
    if (ocupada) return;
    setOcupada(r.id);
    try {
      await markWithdrawalPaid(r.id, referencia.trim());
      showToast("Marcado como pagado.", "success");
      setReferencia("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setOcupada(null);
    }
  }

  async function resolver(r: WithdrawalRequestDoc, aprobar: boolean) {
    if (ocupada) return;
    if (!aprobar && !motivo.trim()) {
      showToast("Un rechazo necesita un motivo.", "error");
      return;
    }
    setOcupada(r.id);
    try {
      await reviewWithdrawal(r.id, aprobar, aprobar ? undefined : motivo.trim());
      const monto = formatCurrency(r.neto, r.currency, "es-MX", { code: true });
      showToast(
        !aprobar
          ? "Retiro rechazado, el saldo volvió a su wallet."
          : r.route === "stripe"
            ? `Enviados ${monto} por Stripe.`
            : `Retiro aceptado. Falta mandar ${monto} por Wallbit.`,
        aprobar ? "success" : "info"
      );
      setRechazando(null);
      setMotivo("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setOcupada(null);
    }
  }

  return (
    <div style={{ padding: "8px 4px 64px", fontFamily: FONT, maxWidth: 760 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "0 0 6px" }}>Retiros</h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.55, margin: "0 0 8px" }}>
        Aceptar manda dinero de verdad. El saldo del creador ya está descontado desde que lo
        solicitó, así que rechazar se lo devuelve entero.
      </p>

      {/* Las dos rutas se comportan distinto al aceptar, y quien revisa tiene que saberlo
          ANTES de pulsar: en Stripe el dinero sale solo, en Wallbit no. */}
      <div
        style={{
          padding: "11px 14px",
          borderRadius: 12,
          background: "rgba(234,179,8,0.09)",
          border: "1px solid rgba(234,179,8,0.28)",
          color: "#eab308",
          fontSize: 12.5,
          lineHeight: 1.55,
          margin: "0 0 26px",
        }}
      >
        En las solicitudes de <strong>Stripe</strong>, aceptar manda el dinero en ese momento.
        En las de <strong>Wallbit</strong> solo cierra la contabilidad y la transferencia hay
        que hacerla a mano.
      </div>

      {error && (
        <p style={{ fontSize: 13, color: "#f87171", lineHeight: 1.5 }}>
          No se pudieron cargar las solicitudes, {error}
        </p>
      )}

      {cargando ? (
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Cargando…</p>
      ) : (
        <>
          <Grupo titulo={`En revisión · ${pendientes.length}`}>
            {pendientes.length === 0 ? (
              <Vacio texto="No hay solicitudes esperando." />
            ) : (
              pendientes.map((r) => (
                <Tarjeta key={r.id} r={r} nombre={nombres[r.creatorId]}>
                  {rechazando === r.id ? (
                    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                      <textarea
                        value={motivo}
                        onChange={(ev) => setMotivo(ev.target.value)}
                        placeholder="Por qué no se le puede enviar el dinero. Lo va a leer el creador."
                        rows={3}
                        style={{
                          width: "100%",
                          background: "rgba(255,255,255,0.06)",
                          border: "none",
                          borderRadius: 12,
                          padding: "10px 12px",
                          color: "#fff",
                          fontSize: 13,
                          fontFamily: "inherit",
                          lineHeight: 1.5,
                          outline: "none",
                          resize: "vertical",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {MOTIVOS.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setMotivo(m)}
                            style={{
                              background: "rgba(255,255,255,0.06)",
                              border: "none",
                              borderRadius: 999,
                              padding: "6px 11px",
                              color: "rgba(255,255,255,0.7)",
                              fontSize: 11.5,
                              fontFamily: "inherit",
                              cursor: "pointer",
                              textAlign: "start",
                              maxWidth: 260,
                            }}
                          >
                            {m.slice(0, 42)}…
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <TextButton
                          tone="plain"
                          size="sm"
                          style={{ margin: 0 }}
                          disabled={ocupada === r.id || !motivo.trim()}
                          onClick={() => resolver(r, false)}
                        >
                          {ocupada === r.id ? "Rechazando…" : "Confirmar rechazo"}
                        </TextButton>
                        <TextButton
                          tone="mute"
                          size="sm"
                          style={{ margin: 0 }}
                          onClick={() => {
                            setRechazando(null);
                            setMotivo("");
                          }}
                        >
                          Cancelar
                        </TextButton>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center" }}>
                      <TextButton
                        tone="brand"
                        size="sm"
                        style={{ margin: 0 }}
                        disabled={ocupada === r.id}
                        onClick={() => resolver(r, true)}
                      >
                        {ocupada === r.id
                          ? r.route === "stripe"
                            ? "Enviando el dinero…"
                            : "Aceptando…"
                          : r.route === "stripe"
                            ? "Aceptar y enviar"
                            : "Aceptar"}
                      </TextButton>
                      <TextButton
                        tone="plain"
                        size="sm"
                        style={{ margin: 0 }}
                        disabled={ocupada === r.id}
                        onClick={() => {
                          setRechazando(r.id);
                          setMotivo("");
                        }}
                      >
                        Rechazar
                      </TextButton>
                    </div>
                  )}
                </Tarjeta>
              ))
            )}
          </Grupo>

          <Grupo
            titulo={`Pendiente de pago · ${porPagar.length}`}
            nota="Aceptadas cuyo dinero todavía no ha salido. Las de Wallbit se transfieren a mano y se cierran aquí."
          >
            {porPagar.length === 0 ? (
              <Vacio texto="Nada pendiente de pagar." />
            ) : (
              porPagar.map((r) => (
                <Tarjeta key={r.id} r={r} nombre={nombres[r.creatorId]}>
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {/* 🚨 OBLIGATORIO. La ruta de Wallbit no tiene API: alguien mueve el
                        dinero a mano y luego cierra la solicitud. Sin este dato, lo único que
                        respalda el pago es que el operador dijo que lo hizo, y si el creador
                        reclama no hay nada que cotejar. El servidor lo rechaza por debajo de
                        6 caracteres, así que el gate no depende de esta pantalla. */}
                    <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.45 }}>
                      Copia el identificador de la transferencia desde Wallbit. El creador lo
                      va a ver en su retiro para poder cotejarlo.
                    </div>
                    <input
                      value={referencia}
                      onChange={(ev) => setReferencia(ev.target.value)}
                      placeholder="Identificador de la transferencia de Wallbit"
                      style={{
                        width: "100%",
                        background: "rgba(255,255,255,0.06)",
                        border: "none",
                        borderRadius: 12,
                        padding: "10px 12px",
                        color: "#fff",
                        fontSize: 13,
                        fontFamily: "inherit",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    {/* Sin identificador el botón no se puede pulsar. Un botón que se deja
                        tocar promete que va a funcionar, y aquí fallaría en el servidor. */}
                    <TextButton
                      tone="brand"
                      size="sm"
                      style={{ margin: 0, justifySelf: "start" }}
                      disabled={ocupada === r.id || referencia.trim().length < 6}
                      onClick={() => cerrarPago(r)}
                    >
                      {ocupada === r.id ? "Cerrando…" : "Ya lo transferí"}
                    </TextButton>
                  </div>
                </Tarjeta>
              ))
            )}
          </Grupo>

          <Grupo titulo={`En camino · ${enCamino.length}`}>
            {enCamino.length === 0 ? (
              <Vacio texto="Ninguna transferencia en tránsito." />
            ) : (
              enCamino.map((r) => <Tarjeta key={r.id} r={r} nombre={nombres[r.creatorId]} />)
            )}
          </Grupo>

          <Grupo titulo={`Resueltas · ${resueltas.length}`}>
            {resueltas.length === 0 ? (
              <Vacio texto="Todavía no se ha resuelto ninguna." />
            ) : (
              resueltas.map((r) => <Tarjeta key={r.id} r={r} nombre={nombres[r.creatorId]} />)
            )}
          </Grupo>
        </>
      )}

      <VibraToast toast={toast} />
    </div>
  );
}

function Grupo({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>{titulo}</h2>
      {nota && (
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "0 0 14px", lineHeight: 1.5 }}>
          {nota}
        </p>
      )}
      {!nota && <div style={{ height: 10 }} />}
      <div style={{ display: "grid", gap: 14 }}>{children}</div>
    </section>
  );
}

function Vacio({ texto }: { texto: string }) {
  return <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: 0 }}>{texto}</p>;
}

function Fila({ k, v, fuerte }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
      <span style={{ color: "rgba(255,255,255,0.5)" }}>{k}</span>
      <span
        style={{
          color: fuerte ? "#4ade80" : "rgba(255,255,255,0.85)",
          fontWeight: fuerte ? 700 : 600,
          textAlign: "end",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function Tarjeta({
  r,
  nombre,
  children,
}: {
  r: WithdrawalRequestDoc;
  nombre?: string;
  children?: React.ReactNode;
}) {
  const meta = ESTADO[r.status];
  const esWallbit = r.route === "wallbit";
  const money = (n: number) => formatCurrency(n, r.currency, "es-MX", { code: true });

  /**
   * 💱 Lo que el creador va a ver en SU banco.
   *
   * El desglose entero va en dólares porque así se liquida y así se factura, pero a él le
   * llegan pesos, reales o euros. Quien revisa un retiro necesita saberlo: es lo único que
   * puede contrastar contra lo que el creador reclame si algo sale mal.
   *
   * ⚠️ Es una APROXIMACIÓN al cambio de hoy. El bueno lo fija Stripe al enviar, y queda
   *    guardado en la solicitud como `tipoCambio` en cuanto el pago sale.
   */
  const { rates } = useExchangeRates();
  const monedaCreador = displayCurrencyForCountry(r.payoutCountry);

  /**
   * 🧮 Lo que ese retiro nos cuesta a nosotros.
   *
   * Prefiere la cifra REAL que devolvió Stripe. Si no la hay —y hoy nunca la hay, porque
   * `outbound_payment_quotes` da 404 en nuestra cuenta— cae al modelo de `payoutFees.ts` y lo
   * marca como estimación. Enseñar una estimación rotulada es útil; enseñar una fila vacía no.
   */
  const costeDelRetiro = useMemo(() => {
    if (r.route !== "stripe") return null;

    if (r.stripeFeeTotal != null) {
      const partes = [
        r.stripeFeeFijo != null ? `fijo ${r.stripeFeeFijo.toFixed(2)}` : null,
        r.stripeFeeTransfronteriza != null ? `frontera ${r.stripeFeeTransfronteriza.toFixed(2)}` : null,
        r.stripeFeeConversion != null ? `cambio ${r.stripeFeeConversion.toFixed(2)}` : null,
      ].filter(Boolean);
      return {
        real: true,
        detalle: `${r.stripeFeeTotal.toFixed(2)} ${r.currency}${partes.length ? "  ·  " + partes.join(" · ") : ""}`,
      };
    }

    const k = costeRetiro({
      importe: r.neto,
      paisDestino: r.payoutCountry,
      monedaDestino: monedaCreador,
      // El tramo caro es el único que va por wire. Sale de la tabla, que es la fuente.
      wire: payoutTermsOf(r.payoutCountry)?.tier === "expensive",
    });
    return {
      real: false,
      detalle: `${k.total.toFixed(2)} ${r.currency}  ·  fijo ${k.fijo.toFixed(2)} · frontera ${k.transfronteriza.toFixed(2)} · cambio ${k.conversion.toFixed(2)}`,
    };
  }, [r, monedaCreador]);
  const enSuMoneda =
    monedaCreador === r.currency ? null : convertFromAnchor(r.neto, monedaCreador, rates);
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: "#fff" }}>
              {nombre ?? r.creatorId.slice(0, 8)}
            </span>
            {/* 🏷️ La RUTA, arriba y en color. Es lo primero que cambia qué hay que hacer:
                en Stripe se acepta y el dinero sale; en Wallbit hay que ir a transferir. */}
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 999,
                whiteSpace: "nowrap",
                background: esWallbit ? "rgba(168,85,247,0.16)" : "rgba(96,165,250,0.16)",
                color: esWallbit ? "#d8b4fe" : "#93c5fd",
              }}
            >
              {esWallbit ? "Wallbit · a mano" : "Stripe · automático"}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>
            {fecha(r.createdAt)}
            {r.payoutCountry ? ` · ${r.payoutCountry}` : ""}
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, whiteSpace: "nowrap" }}>
          {meta.label}
        </span>
      </div>

      {/* El mismo desglose que vio el creador al pedirlo, congelado en la solicitud. */}
      <div style={{ display: "grid", gap: 7 }}>
        <Fila k="Sale de su saldo" v={money(r.saldo)} />
        {r.ivaCobrado > 0 && <Fila k="+ IVA que cobró" v={money(r.ivaCobrado)} />}
        {r.isr > 0 && <Fila k="− ISR retenido" v={money(r.isr)} />}
        {r.iva > 0 && <Fila k="− IVA retenido" v={money(r.iva)} />}
        {r.ivaComision > 0 && <Fila k="− IVA de la comisión" v={money(r.ivaComision)} />}
        <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "3px 0" }} />
        <Fila k="Se le manda" v={money(r.neto)} fuerte />

        {/* Lo que de verdad ve en su banco. Si ya cobra en dólares, esta línea no aparece:
            repetir la misma cifra en la misma moneda solo sería ruido. */}
        {enSuMoneda != null && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 12,
              color: "rgba(255,255,255,0.55)",
              marginTop: -4,
            }}
          >
            <span>
              Su cuenta está en {monedaCreador}
              {r.payoutCountry ? ` (${r.payoutCountry})` : ""}
            </span>
            <span style={{ whiteSpace: "nowrap" }}>
              ≈ {formatCurrency(enSuMoneda, monedaCreador, "es-MX", { code: true })}
            </span>
          </div>
        )}

        {/* 🧮 LO QUE NOS COSTÓ ESE RETIRO.

            Va aquí y NO en la tarjeta del creador: él recibe su 75% pase lo que pase, así
            que enseñarle lo que Stripe nos cobró es ruido sobre un dinero que no es suyo.
            Quien revisa sí lo necesita — y sumado mes a mes es el margen real, que hoy solo
            existe como modelo.

            ⚠️ Si no hay cifra real se enseña la MODELADA, marcada como estimación. Hoy es
               siempre así: `outbound_payment_quotes` devuelve 404 en nuestra cuenta. */}
        {r.route === "stripe" && costeDelRetiro && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 11,
              color: "rgba(255,255,255,0.42)",
              marginTop: -2,
            }}
          >
            <span>{costeDelRetiro.real ? "Nos costó" : "Nos cuesta, estimado"}</span>
            <span style={{ whiteSpace: "nowrap", fontFamily: "monospace" }}>
              {costeDelRetiro.detalle}
            </span>
          </div>
        )}

        {/* 🧾 El identificador de la transferencia de Wallbit, una vez cerrada. Es lo que
            respalda ese pago, así que se enseña aquí y en la tarjeta del creador. */}
        {r.paymentReference && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 12,
              color: "rgba(255,255,255,0.6)",
              marginTop: -4,
            }}
          >
            <span>Transferencia de Wallbit</span>
            <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
              {r.paymentReference}
            </span>
          </div>
        )}

        {/* Cuando ya se envió, el cambio deja de ser una estimación. */}
        {r.tipoCambio != null && r.acreditado != null && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 12,
              color: "#4ade80",
              marginTop: -4,
            }}
          >
            <span>Se le mandaron, al cambio de Stripe {r.tipoCambio}</span>
            <span style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
              {formatCurrency(r.acreditado, r.acreditadoCurrency ?? monedaCreador, "es-MX", {
                code: true,
              })}
            </span>
          </div>
        )}
      </div>

      {/* 🏷️ EL TAG DE WALLBIT, en grande y arriba de todo lo demás.

          Es el dato con el que se hace la transferencia a mano, así que quien revisa el retiro
          lo va a copiar de aquí. Va destacado y en monoespaciada porque un guión de más o de
          menos manda el dinero a otra cuenta o a ninguna. */}
      {r.wallbitTag && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "rgba(168,85,247,0.12)",
            border: "1px solid rgba(168,85,247,0.3)",
            borderRadius: 10,
            display: "grid",
            gap: 2,
          }}
        >
          <span style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
            Transfiere a este TAG
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#fff", wordBreak: "break-all" }}>
            {r.wallbitTag}
          </span>
        </div>
      )}

      {(r.declaredAccountLast4 || r.declaredHolderName) && (
        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", marginTop: 12, lineHeight: 1.5 }}>
          Cuenta declarada, {r.declaredHolderName ?? "sin titular"}
          {r.declaredAccountLast4 ? ` · terminada en ${r.declaredAccountLast4}` : ""}
          {r.stripeAccountBank ? ` · ${r.stripeAccountBank}` : ""}
        </div>
      )}

      {/* 🔎 La cuenta COMPLETA vive en Didit, nunca en Vibra. Para transferir por Wallbit
          hace falta el número entero, así que este enlace es el camino — y el único.
          Se enseña en las dos rutas: en Stripe sirve para cotejar si algo no cuadra. */}
      {r.payoutAccountSessionId && (
        <a
          href={enlaceDidit(r.payoutAccountSessionId)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            marginTop: 10,
            fontSize: 12.5,
            fontWeight: 600,
            color: "#a855f7",
            textDecoration: "none",
          }}
        >
          Ver la cuenta completa en Didit →
        </a>
      )}

      {r.paymentReference && (
        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", marginTop: 10, lineHeight: 1.5 }}>
          Referencia de la transferencia, {r.paymentReference}
        </div>
      )}

      {r.outboundPaymentId && (
        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", marginTop: 12, lineHeight: 1.5 }}>
          Pago de Stripe {r.outboundPaymentId}
          {r.outboundStatus ? ` · ${r.outboundStatus}` : ""}
        </div>
      )}

      {r.rejectionReason && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(248,113,113,0.09)",
            color: "#fca5a5",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          Motivo del rechazo, {r.rejectionReason}
        </div>
      )}

      {children}
    </div>
  );
}
