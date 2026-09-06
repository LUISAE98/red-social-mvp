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
import { useTranslations, useLocale } from "next-intl";
import {
  suscribirComprobantesRetiro,
  suscribirComprobantesMensuales,
  type ComprobanteRetiroDoc,
  type ComprobanteMensualDoc,
} from "@/lib/wallet/comprobantes";

function dinero(monto: number, moneda: string): string {
  return `${monto.toFixed(2)} ${moneda}`;
}

export default function ComprobantesDelCreador({ uid }: { uid: string | null | undefined }) {
  const t = useTranslations("wallet");
  const locale = useLocale();
  const [retiros, setRetiros] = useState<ComprobanteRetiroDoc[]>([]);
  const [meses, setMeses] = useState<ComprobanteMensualDoc[]>([]);
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
    const parar2 = suscribirComprobantesMensuales(
      uid,
      setMeses,
      () => setFalló(true)
    );
    return () => {
      parar1();
      parar2();
    };
  }, [uid]);

  if (!uid || falló) return null;
  // Sin nada que enseñar y ya cargado, el bloque entero sobra: un título sobre el vacío es peor
  // que no poner nada.
  if (cargado && retiros.length === 0 && meses.length === 0) return null;

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
