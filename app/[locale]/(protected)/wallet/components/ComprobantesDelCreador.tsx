"use client";

// Los comprobantes del creador, en la pestaña de retiros.
//
// Hasta hoy el backend generaba dos documentos que **nadie podía ver**: el comprobante de cada
// retiro y el cierre mensual de liquidación. Un documento que existe y no se puede consultar no
// sirve para nada — y son justo los que el creador necesita cuando su contador le pregunta de
// dónde salió ese dinero.
//
// 🚨 SON DOS COSAS DISTINTAS Y SE PRESENTAN APARTE.
//
//   · **Por retiro** — que el dinero salió: cuándo, cuánto, a qué cuenta y a qué tipo de cambio.
//   · **Cierre mensual** — qué ganó en el periodo y qué se le descontó.
//
// Un retiro junta ventas de varios meses, así que ninguno explica al otro. Mezclarlos en una
// sola lista sería la forma más rápida de que el creador no entienda ninguno de los dos.
//
// ⚠️ NO SON FACTURAS y el texto lo dice. El creador mexicano recibe además sus CFDI; el
// extranjero no recibe ninguno, y para él esto es todo lo que hay.

import { useEffect, useState } from "react";
import { descargarDocumentoFiscal } from "@/lib/facturacion/descargarDocumento";
import { useTranslations, useLocale } from "next-intl";
import {
  suscribirComprobantesRetiro,
  suscribirComprobantesMensuales,
  suscribirCfdiMensuales,
  type ComprobanteRetiroDoc,
  type ComprobanteMensualDoc,
  type CfdiMensualDoc,
} from "@/lib/wallet/comprobantes";

function dinero(monto: number, moneda: string): string {
  return `${monto.toFixed(2)} ${moneda}`;
}

export default function ComprobantesDelCreador({ uid }: { uid: string | null | undefined }) {
  const t = useTranslations("wallet");
  const locale = useLocale();
  const [retiros, setRetiros] = useState<ComprobanteRetiroDoc[]>([]);
  const [meses, setMeses] = useState<ComprobanteMensualDoc[]>([]);
  const [cfdis, setCfdis] = useState<CfdiMensualDoc[]>([]);
  /**
   * 🚨 Se distingue «todavía no cargó» de «no hay ninguno».
   *
   * Sin esto, una consulta denegada y un creador nuevo se ven exactamente igual: una lista
   * vacía. Es el fallo que ya se coló una vez en `suscribirMisRetiros`.
   */
  const [cargado, setCargado] = useState(false);
  const [falló, setFalló] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const parar1 = suscribirComprobantesRetiro(
      uid,
      (rows) => {
        setRetiros(rows);
        setCargado(true);
      },
      () => setFalló(true)
    );
    const parar2 = suscribirComprobantesMensuales(uid, setMeses, () => setFalló(true));
    /*
     * 🚨 Sus TRES CFDI, que hasta hoy no podía ver: la factura global que emite él, la comisión
     *    que Vibra le cobra y su constancia de retenciones. Son justo los que su contador pide.
     */
    const parar3 = suscribirCfdiMensuales(uid, setCfdis, () => setFalló(true));
    return () => {
      parar1();
      parar2();
      parar3();
    };
  }, [uid]);

  if (!uid || falló) return null;
  // Sin nada que enseñar y ya cargado, el bloque entero sobra: un título sobre el vacío es peor
  // que no poner nada.
  if (cargado && retiros.length === 0 && meses.length === 0 && cfdis.length === 0) return null;

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 550, color: "rgba(254,254,254,0.82)" }}>
        {t("receiptsTitle")}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "rgba(255,255,255,0.45)",
          lineHeight: 1.45,
          marginTop: 4,
          marginBottom: 14,
        }}
      >
        {t("receiptsNote")}
      </div>

      {/*
        Los CFDI van PRIMERO: son los que tienen valor fiscal y los que le van a pedir. Los
        comprobantes propios de Vibra explican el dinero, pero no se declaran con ellos.
      */}
      {cfdis.length > 0 && (
        <Grupo titulo={t("receiptsFiscal")}>
          {cfdis.map((c) => (
            <TarjetaCfdi key={c.id} c={c} t={t} />
          ))}
        </Grupo>
      )}

      {retiros.length > 0 && (
        <Grupo titulo={t("receiptsWithdrawals")}>
          {retiros.map((r) => (
            <TarjetaRetiro key={r.id} r={r} t={t} locale={locale} />
          ))}
        </Grupo>
      )}

      {meses.length > 0 && (
        <Grupo titulo={t("receiptsMonthly")}>
          {meses.map((m) => (
            <TarjetaMes key={m.id} m={m} t={t} locale={locale} />
          ))}
        </Grupo>
      )}
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "rgba(255,255,255,0.38)",
          marginBottom: 8,
        }}
      >
        {titulo}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

/**
 * Enlace a la vista imprimible.
 *
 * Se abre en pestaña nueva a propósito: el creador vuelve a su wallet cerrándola, en vez de
 * perder el sitio en la lista al usar «atrás».
 */
function Descargar({ href, texto }: { href: string; texto: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-block",
        marginTop: 8,
        fontSize: 11.5,
        color: "#a855f7",
        textDecoration: "none",
      }}
    >
      {texto}
    </a>
  );
}

function TarjetaRetiro({
  r,
  t,
  locale,
}: {
  r: ComprobanteRetiroDoc;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
          {r.pagadoEn ? r.pagadoEn.toLocaleDateString() : "—"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 650, color: "rgba(254,254,254,0.92)" }}>
          {dinero(r.neto, r.currency)}
        </span>
      </div>

      {/*
        Lo que de verdad le importa: cuánto le LLEGÓ en su moneda. Solo se enseña si hubo
        conversión — repetir la misma cifra en la misma moneda no informa de nada.
      */}
      {r.acreditado !== null && r.monedaAcreditada && r.tipoCambio !== null && (
        <Linea
          k={t("receiptsCredited")}
          v={`${dinero(r.acreditado, r.monedaAcreditada)} · ${r.tipoCambio.toFixed(4)}`}
        />
      )}
      {r.cuentaLast4 && <Linea k={t("receiptsAccount")} v={`•••• ${r.cuentaLast4}`} />}
      {r.referencia && <Linea k={t("receiptsReference")} v={r.referencia} />}
      <Descargar href={`/${locale}/comprobante/retiro/${r.id}`} texto={t("receiptsPrint")} />
    </div>
  );
}

function TarjetaMes({
  m,
  t,
  locale,
}: {
  m: ComprobanteMensualDoc;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{m.id}</span>
        <span style={{ fontSize: 13, fontWeight: 650, color: "rgba(254,254,254,0.92)" }}>
          {dinero(m.neto, m.currency)}
        </span>
      </div>
      <Linea k={t("receiptsSales")} v={String(m.ventas)} />
      <Linea k={t("receiptsCommission")} v={dinero(m.comision, m.currency)} />
      {m.isrRetenido > 0 && (
        <Linea k={t("receiptsIsr")} v={dinero(m.isrRetenido, m.currency)} />
      )}
      {m.ivaRetenido > 0 && (
        <Linea k={t("receiptsVat")} v={dinero(m.ivaRetenido, m.currency)} />
      )}
      <Descargar href={`/${locale}/comprobante/mensual/${m.id}`} texto={t("receiptsPrint")} />
    </div>
  );
}

function Linea({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        marginTop: 6,
        fontSize: 11.5,
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.42)" }}>{k}</span>
      <span
        style={{
          color: "rgba(255,255,255,0.72)",
          textAlign: "end",
          overflowWrap: "anywhere",
        }}
      >
        {v}
      </span>
    </div>
  );
}

/**
 * Un CFDI del creador, con su explicación.
 *
 * 🚨 LA EXPLICACIÓN NO ES ADORNO. Un creador que ve «constancia de retenciones» sin más no sabe
 *    si eso es algo que le cobraron, algo que puede deducir o algo que tiene que declarar. Y son
 *    tres cosas distintas según el documento. Sin la línea que lo explica, el feed es una lista
 *    de nombres que nadie entiende.
 */
function TarjetaCfdi({
  c,
  t,
}: {
  c: CfdiMensualDoc;
  t: ReturnType<typeof useTranslations>;
}) {
  const [bajando, setBajando] = useState(false);
  const [falla, setFalla] = useState(false);

  /** Cada documento responde una pregunta distinta del creador. */
  const titulo = t(`cfdiTitle_${c.tipo}`);
  const porque = t(`cfdiWhy_${c.tipo}`);

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(254,254,254,0.9)" }}>
          {titulo}
        </span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{c.periodo}</span>
      </div>

      <div
        style={{
          fontSize: 11.5,
          color: "rgba(255,255,255,0.45)",
          lineHeight: 1.45,
          marginTop: 5,
        }}
      >
        {porque}
      </div>

      {/*
        🚨 Por qué cambió de folio. Sin esto, el creador ve que su factura del mes no es la que
        vio la semana pasada y no tiene forma de saber si algo va mal. No va mal: alguien pidió
        su factura y la global se rehízo sin esa venta.
      */}
      {c.reexpedida && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "rgba(217,164,65,0.85)",
            lineHeight: 1.45,
          }}
        >
          {c.reexpedida.causa === "devolucion"
            ? t("cfdiReissuedRefund", { veces: c.reexpedida.veces })
            : t("cfdiReissuedInvoice", { veces: c.reexpedida.veces })}
        </div>
      )}

      {/*
        Sin folio no hay documento que bajar: ese mes se calculó con el timbrado apagado. Decirlo
        es mejor que ofrecer un botón que va a fallar.
      */}
      {c.timbrado && c.facturapiId ? (
        <button
          type="button"
          disabled={bajando}
          onClick={async () => {
            setBajando(true);
            setFalla(false);
            try {
              await descargarDocumentoFiscal({
                tipo: c.tipo === "liquidacion" ? "comision" : c.tipo,
                referencia: c.id,
                nombre: `${titulo}-${c.periodo}`,
              });
            } catch {
              setFalla(true);
            } finally {
              setBajando(false);
            }
          }}
          style={{
            marginTop: 8,
            background: "none",
            border: "none",
            padding: 0,
            cursor: bajando ? "default" : "pointer",
            fontSize: 11.5,
            fontWeight: 600,
            color: falla ? "#f87171" : "#a855f7",
            opacity: bajando ? 0.5 : 1,
          }}
        >
          {falla ? t("receiptsDownloadFailed") : t("receiptsDownloadPdf")}
        </button>
      ) : (
        <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.32)" }}>
          {t("cfdiNotStamped")}
        </div>
      )}
    </div>
  );
}
