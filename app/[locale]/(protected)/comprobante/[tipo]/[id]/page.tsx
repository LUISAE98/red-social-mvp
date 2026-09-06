"use client";

// Vista imprimible de los comprobantes propios de Vibra.
//
// 🚨 POR QUÉ NO SE GENERA UN PDF EN EL SERVIDOR.
//
//    El proyecto no tiene ninguna librería de PDF, y meter Puppeteer en una Cloud Function son
//    cientos de megas de contenedor y arranques en frío de segundos — por un documento que un
//    creador baja unas pocas veces al año. `pdfkit` evitaría el navegador pero obligaría a
//    maquetar el documento en coordenadas, y cada cambio de diseño sería código.
//
//    Esta ruta renderiza el comprobante limpio y el navegador lo guarda como PDF de verdad, con
//    su «Imprimir → Guardar como PDF». Cero dependencias, y el diseño se toca en CSS.
//
// ⚠️ ESTOS DOS DOCUMENTOS NO SON CFDI, y el pie lo dice. Los CFDI —factura, nota de crédito,
//    comisión y constancia— los genera Facturapi con el formato oficial y se bajan por
//    `descargarDocumentoFiscal`. Aquí solo viven los que no existen en ningún otro sitio.
//
// ⚠️ Va FUERA del layout de la wallet a propósito: aquel trae subnav, onboarding y contexto, y
//    todo eso acabaría en la hoja impresa.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import {
  leerComprobanteRetiro,
  leerComprobanteMensual,
  leerRecibo,
  type ComprobanteRetiroDoc,
  type ComprobanteMensualDoc,
  type ReciboDoc,
} from "@/lib/wallet/comprobantes";

function dinero(monto: number, moneda: string): string {
  return `${monto.toFixed(2)} ${moneda}`;
}

export default function ComprobantePage() {
  const t = useTranslations("wallet");
  const { user } = useAuth();
  const params = useParams<{ tipo: string; id: string }>();
  /** Tres documentos propios, uno por ruta. Los CFDI van por otro camino. */
  const bruto = String(params?.tipo ?? "");
  const tipo = bruto === "mensual" || bruto === "recibo" ? bruto : "retiro";
  const id = decodeURIComponent(String(params?.id ?? ""));

  const [retiro, setRetiro] = useState<ComprobanteRetiroDoc | null>(null);
  const [mes, setMes] = useState<ComprobanteMensualDoc | null>(null);
  const [recibo, setRecibo] = useState<ReciboDoc | null>(null);
  /** Se distingue «cargando» de «no existe»: una hoja en blanco no explica cuál de los dos es. */
  const [estado, setEstado] = useState<"cargando" | "listo" | "vacio">("cargando");

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || !id) return;
    let vivo = true;
    (async () => {
      try {
        if (tipo === "mensual") {
          const d = await leerComprobanteMensual(uid, id);
          if (!vivo) return;
          setMes(d);
          setEstado(d ? "listo" : "vacio");
        } else if (tipo === "recibo") {
          const d = await leerRecibo(uid, id);
          if (!vivo) return;
          setRecibo(d);
          setEstado(d ? "listo" : "vacio");
        } else {
          const d = await leerComprobanteRetiro(uid, id);
          if (!vivo) return;
          setRetiro(d);
          setEstado(d ? "listo" : "vacio");
        }
      } catch {
        if (vivo) setEstado("vacio");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [user?.uid, tipo, id]);

  const titulo =
    tipo === "mensual"
      ? t("receiptsMonthly")
      : tipo === "recibo"
        ? t("receiptsPayment")
        : t("receiptsWithdrawals");

  return (
    <div className="hoja">
      {estado === "cargando" && <p className="aviso">{t("receiptsLoading")}</p>}
      {estado === "vacio" && <p className="aviso">{t("receiptsNotFound")}</p>}

      {estado === "listo" && (
        <>
          <header className="cabecera">
            <div className="marca">Vibra</div>
            <div className="tituloBloque">
              <h1 className="titulo">{titulo}</h1>
              <p className="folio">{id}</p>
            </div>
          </header>

          {retiro && (
            <>
              <Fila k={t("receiptsDate")} v={retiro.pagadoEn?.toLocaleDateString() ?? "—"} />
              <Fila k={t("receiptsSent")} v={dinero(retiro.neto, retiro.currency)} destacado />
              {retiro.acreditado !== null && retiro.monedaAcreditada && (
                <Fila
                  k={t("receiptsCredited")}
                  v={dinero(retiro.acreditado, retiro.monedaAcreditada)}
                  destacado
                />
              )}
              {/* Solo si hubo conversión. Un 1.0 haría creer que se cambió de moneda. */}
              {retiro.tipoCambio !== null && (
                <Fila k={t("receiptsRate")} v={retiro.tipoCambio.toFixed(6)} />
              )}
              {retiro.cuentaLast4 && (
                <Fila k={t("receiptsAccount")} v={`•••• ${retiro.cuentaLast4}`} />
              )}
              {retiro.referencia && <Fila k={t("receiptsReference")} v={retiro.referencia} />}
            </>
          )}

          {mes && (
            <>
              <Fila k={t("receiptsSales")} v={String(mes.ventas)} />
              <Fila k={t("receiptsBase")} v={dinero(mes.base, mes.currency)} />
              <Fila k={t("receiptsCommission")} v={`− ${dinero(mes.comision, mes.currency)}`} />
              {mes.ivaComision > 0 && (
                <Fila
                  k={t("receiptsCommissionVat")}
                  v={`− ${dinero(mes.ivaComision, mes.currency)}`}
                />
              )}
              {mes.isrRetenido > 0 && (
                <Fila k={t("receiptsIsr")} v={`− ${dinero(mes.isrRetenido, mes.currency)}`} />
              )}
              {mes.ivaRetenido > 0 && (
                <Fila k={t("receiptsVat")} v={`− ${dinero(mes.ivaRetenido, mes.currency)}`} />
              )}
              <Fila k={t("receiptsNet")} v={dinero(mes.neto, mes.currency)} destacado />
            </>
          )}

          {recibo && (
            <>
              <Fila k={t("receiptsDate")} v={recibo.fecha?.toLocaleDateString() ?? "—"} />
              {/*
                🚨 Lo primero y destacado: lo que VIO y pagó, en SU moneda. Es la única cifra
                que puede cotejar contra su banco.
              */}
              {recibo.pagado !== null && recibo.monedaPagada && (
                <Fila
                  k={t("receiptsPaid")}
                  v={dinero(recibo.pagado, recibo.monedaPagada)}
                  destacado
                />
              )}
              <Fila k={t("receiptsBase")} v={dinero(recibo.base, recibo.currency)} />
              {recibo.impuesto > 0 && (
                <Fila
                  k={t("receiptsLocalTax")}
                  v={dinero(recibo.impuesto, recibo.currency)}
                />
              )}
              <Fila k={t("receiptsTotal")} v={dinero(recibo.total, recibo.currency)} />
            </>
          )}

          {/*
            🚨 El aviso NO es decorativo. Un creador que lleve esto a su contador tiene que saber
            que no sirve para deducir en México; los CFDI son otros documentos.
          */}
          <p className="pie">{t("receiptsNotCfdi")}</p>

          <button type="button" className="imprimir" onClick={() => window.print()}>
            {t("receiptsPrint")}
          </button>
        </>
      )}

      <style jsx>{`
        .hoja {
          max-width: 720px;
          margin: 0 auto;
          padding: 32px 24px 48px;
          color: #111;
          background: #fff;
          font-size: 14px;
          line-height: 1.5;
        }
        .aviso {
          color: #666;
          text-align: center;
          padding: 48px 0;
        }
        .cabecera {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          padding-bottom: 16px;
          margin-bottom: 8px;
          border-bottom: 2px solid #111;
        }
        .marca {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .tituloBloque {
          text-align: end;
        }
        .titulo {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
        }
        .folio {
          margin: 4px 0 0;
          font-size: 11px;
          color: #666;
          overflow-wrap: anywhere;
        }
        .pie {
          margin-top: 24px;
          padding-top: 12px;
          border-top: 1px solid #ddd;
          font-size: 11px;
          color: #666;
          line-height: 1.5;
        }
        .imprimir {
          margin-top: 24px;
          padding: 10px 18px;
          border-radius: 8px;
          border: 1px solid #111;
          background: #111;
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        /*
         * 🚨 Al imprimir desaparece el botón y se quitan los márgenes de pantalla: el margen lo
         *    pone la hoja, no el contenedor, o el documento sale descentrado en el papel.
         */
        @media print {
          .hoja {
            max-width: none;
            padding: 0;
          }
          .imprimir {
            display: none;
          }
        }
      `}</style>
      <style jsx global>{`
        @page {
          margin: 18mm;
        }
      `}</style>
    </div>
  );
}

function Fila({ k, v, destacado }: { k: string; v: string; destacado?: boolean }) {
  return (
    <div className="fila">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      <style jsx>{`
        .fila {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 16px;
          padding: 9px 0;
          border-bottom: 1px solid #eee;
        }
        .k {
          color: #666;
          font-size: 13px;
        }
        .v {
          text-align: end;
          overflow-wrap: anywhere;
          font-weight: ${destacado ? 700 : 500};
          font-size: ${destacado ? "15px" : "13px"};
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}
