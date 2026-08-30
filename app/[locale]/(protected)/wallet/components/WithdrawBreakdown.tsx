"use client";

import { useTranslations } from "next-intl";

/**
 * Desglose de un retiro: de qué saldo sale, qué se le retiene y cuánto le llega.
 *
 * Lo pintan DOS pantallas —la pestaña de Retiros y el panel que se abre al pulsar «Retirar»—
 * y tienen que decir exactamente lo mismo. Si el creador lee dos cifras distintas para el
 * mismo dinero, deja de creerle a las dos, así que el desglose vive aquí y no duplicado.
 *
 * Las cadenas llegan YA FORMATEADAS en la moneda de liquidación. Este componente no calcula
 * ni convierte nada; los números salen de `calcularRetiro` una sola vez, en Finanzas.
 */
export type DesgloseRetiro = {
  /** Saldo del que se parte, el 75% íntegro del creador. */
  bruto: string;
  /**
   * 🧾 IVA mexicano que sus compradores pagaron ENCIMA del precio, y que entra al pago.
   *
   * Suma, no resta. Ese dinero llegó con el cobro y de él sale la retención de la línea de
   * abajo, así que enseñar la resta sin la suma descuenta algo que nunca se sumó.
   */
  ivaCobrado: string;
  isr: string;
  iva: string;
  ivaComision: string;
  /** Lo que efectivamente recibe. */
  neto: string;
  /**
   * Del IVA cobrado, la parte que NO se le retuvo y viaja dentro de `neto`. Nulo si no hay.
   *
   * Se dice aparte porque no es suyo: lo declara él. Callarlo haría que creyera que ganó de
   * más y que se gastara un dinero que le debe al SAT.
   */
  ivaPorDeclarar: string | null;
  /** Si hubo IVA mexicano en sus ventas. Falso ⇒ la línea de la suma ni aparece. */
  hayIvaCobrado: boolean;
  /**
   * Si hay algo que retener. Falso para los creadores de los otros 88 países, cuyo ISR
   * mexicano es cero: para ellos el desglose es una sola línea y las tres restas sobrarían.
   */
  hayRetenciones: boolean;
};

function Row({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>{k}</span>
      <span
        style={{
          color: dim ? "rgba(255,255,255,0.75)" : "#fff",
          fontWeight: 600,
          textAlign: "end",
        }}
      >
        {v}
      </span>
    </div>
  );
}

export default function WithdrawBreakdown({
  desglose,
  /**
   * Impuestos que pagaron sus compradores, ya formateado. `null` si no hay ninguno.
   *
   * Va al final y separado por una línea, porque es la única cifra del bloque que NO sale de
   * su bolsillo: el comprador la pagó encima del precio y va al fisco de su país. Mezclarla
   * con las retenciones le haría pensar que también se le está descontando.
   */
  impuestosRecaudados,
}: {
  desglose: DesgloseRetiro;
  impuestosRecaudados?: string | null;
}) {
  const t = useTranslations("wallet");

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 14,
        padding: "14px 16px",
        display: "grid",
        gap: 9,
        fontSize: 13,
      }}
    >
      <Row k={t("withdrawRowBalance")} v={desglose.bruto} />

      {/* 🧾 La suma del IVA cobrado. Va ANTES de las restas porque es lo que entra, y su
          ausencia era el bug: se restaba la retención de un saldo que nunca lo contuvo. */}
      {desglose.hayIvaCobrado ? (
        <Row k={t("withdrawRowVatCollected")} v={`+ ${desglose.ivaCobrado}`} />
      ) : null}

      {desglose.hayRetenciones ? (
        <>
          <Row k={t("withdrawRowIsr")} v={`− ${desglose.isr}`} />
          <Row k={t("withdrawRowIva")} v={`− ${desglose.iva}`} />
          <Row k={t("withdrawRowCommissionVat")} v={`− ${desglose.ivaComision}`} />
        </>
      ) : null}

      <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.85)" }}>{t("withdrawRowNet")}</span>
        <span style={{ color: "#4ade80" }}>{desglose.neto}</span>
      </div>

      {/* Del pago, lo que no es suyo. Va pegado al total y no en la nota de abajo, porque
          es la advertencia que evita que se gaste un dinero que le debe al SAT. */}
      {desglose.ivaPorDeclarar && (
        <p
          style={{
            fontSize: 11.5,
            color: "rgba(255,255,255,0.5)",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {t("withdrawVatToDeclare", { amount: desglose.ivaPorDeclarar })}
        </p>
      )}

      {desglose.hayRetenciones && (
        <p
          style={{
            fontSize: 11.5,
            color: "rgba(255,255,255,0.5)",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {t("withdrawRetentionNote")}
        </p>
      )}

      {impuestosRecaudados && (
        <>
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
          <p
            style={{
              fontSize: 11.5,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {t("financesTaxCollected")}{" "}
            <span style={{ fontWeight: 640, color: "rgba(255,255,255,0.78)" }}>
              {impuestosRecaudados}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
