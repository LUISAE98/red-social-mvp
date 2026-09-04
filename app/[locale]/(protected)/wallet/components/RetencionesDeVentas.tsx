"use client";

import { useTranslations } from "next-intl";

/**
 * Lo que ya se descontó de las ventas del creador, en la pestaña de Retiros.
 *
 * ── POR QUÉ ESTÁ AQUÍ Y NO EN EL SALDO ──────────────────────────────────────
 *
 * Desde §A5 la retención ocurre EN LA VENTA, así que el saldo que ve el creador ya viene
 * limpio y el desglose del retiro no tiene nada que restar. Pero el creador —y sobre todo su
 * contador— necesitan ver estas cifras en algún sitio, y el sitio es este: junto al disponible
 * para retirar, que es donde mira cuando piensa en su dinero.
 *
 * 🚨 NO ES UN DESGLOSE DEL SALDO. Son los totales de TODAS sus ventas, no solo de las que
 *    siguen sin retirar: los contadores del resumen dejaron de decrementarse al retirar cuando
 *    la retención se movió a la venta. Restarlas del disponible no cuadraría, y por eso se
 *    presentan como histórico y con su aviso. Confundir las dos cosas sería enseñarle una resta
 *    que no da.
 *
 * Las cadenas llegan YA FORMATEADAS. Este componente no calcula ni convierte nada.
 */
export type RetencionesVista = {
  isr: string;
  iva: string;
  ivaComision: string;
  /** El que cobró a sus compradores y declara él. Suma, no resta. */
  ivaCobrado: string;
  /** Cuáles existen de verdad. Pintar «$0.00» es ruido, y con su explicación debajo, mentira. */
  hayIsr: boolean;
  hayIva: boolean;
  hayIvaComision: boolean;
  hayIvaCobrado: boolean;
};

export default function RetencionesDeVentas({ datos }: { datos: RetencionesVista }) {
  const t = useTranslations("wallet");

  // Sin ninguna cifra no hay nada que contar: un bloque vacío con su título es peor que nada.
  if (!datos.hayIsr && !datos.hayIva && !datos.hayIvaComision && !datos.hayIvaCobrado) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 18,
        paddingTop: 16,
        borderTop: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 550, color: "rgba(254,254,254,0.82)" }}>
        {t("salesRetainedTitle")}
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
        {t("salesRetainedNote")}
      </div>

      {/* El IVA que cobró va primero y aparte: no es una retención, es dinero que pasó por él. */}
      {datos.hayIvaCobrado && (
        <Fila
          concepto={t("withdrawRowVatCollected")}
          porque={t("withdrawRowVatCollectedNote")}
          valor={datos.ivaCobrado}
        />
      )}
      {datos.hayIsr && (
        <Fila concepto={t("withdrawRowIsr")} porque={t("withdrawRowIsrWhy")} valor={datos.isr} />
      )}
      {datos.hayIva && (
        <Fila concepto={t("withdrawRowIva")} porque={t("withdrawRowIvaWhy")} valor={datos.iva} />
      )}
      {datos.hayIvaComision && (
        <Fila
          concepto={t("withdrawRowCommissionVat")}
          porque={t("withdrawRowCommissionVatWhy")}
          valor={datos.ivaComision}
        />
      )}

      <div
        style={{
          fontSize: 11.5,
          color: "rgba(255,255,255,0.45)",
          lineHeight: 1.45,
          marginTop: 14,
        }}
      >
        {t("withdrawRowWithheldNote")}
      </div>
    </div>
  );
}

/** Una cifra con su explicación debajo. La explicación es la mitad del valor de esta pantalla. */
function Fila({
  concepto,
  porque,
  valor,
}: {
  concepto: string;
  porque: string;
  valor: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 13, color: "rgba(254,254,254,0.9)" }}>{concepto}</span>
        <span
          style={{
            fontSize: 13,
            color: "rgba(254,254,254,0.9)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {valor}
        </span>
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "rgba(255,255,255,0.42)",
          lineHeight: 1.45,
          marginTop: 3,
          paddingInlineEnd: 40,
        }}
      >
        {porque}
      </div>
    </div>
  );
}
