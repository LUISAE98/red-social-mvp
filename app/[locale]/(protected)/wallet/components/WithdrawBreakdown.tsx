"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { TextButton } from "@/components/ui";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";

/**
 * Desglose de un retiro: de qué dinero sale, qué se retiene y cuánto le llega.
 *
 * Lo pintan DOS pantallas —la pestaña de Retiros y el panel que se abre al pulsar «Retirar»—
 * y tienen que decir exactamente lo mismo. Si el creador lee dos cifras distintas para el
 * mismo dinero, deja de creerle a las dos, así que el desglose vive aquí y no duplicado.
 *
 * ── POR QUÉ ESTÁ AGRUPADO ASÍ ───────────────────────────────────────────────
 *
 * La primera versión listaba las cinco cifras planas: saldo, IVA cobrado, ISR retenido, IVA
 * retenido, IVA de la comisión. Era correcta y era ilegible. El creador veía 329.94 arriba y
 * 328.89 abajo —casi lo mismo— con tres restas en medio que parecían todas pérdidas.
 *
 * Ahora se agrupa por **de quién es el dinero**, que es la única pregunta que el creador se
 * hace mirando esto:
 *
 *   1. Lo que ganó          → suyo
 *   2. El impuesto que cobró → NO es suyo, lo declara él
 *   3. Lo retenido           → tampoco es suyo, pero NO se pierde
 *   4. Lo que le llega
 *
 * Las tres retenciones se suman en una sola línea con su detalle debajo, sangrado. Están
 * porque su contador las va a pedir, pero no compiten con el total.
 *
 * Las cadenas llegan YA FORMATEADAS en la moneda de liquidación. Este componente no calcula
 * ni convierte nada; los números salen de `calcularRetiro` una sola vez, en Finanzas.
 */
export type DesgloseRetiro = {
  /** Lo que ganó, su 75% íntegro. */
  bruto: string;
  /**
   * 🧾 Impuesto que sus compradores pagaron ENCIMA del precio, y que entra al pago.
   *
   * Suma, no resta. Ese dinero llegó con el cobro y de él sale la retención de abajo, así que
   * enseñar la resta sin la suma descuenta algo que nunca se sumó.
   */
  ivaCobrado: string;
  /** Las tres retenciones sumadas. Es la línea que se lee; el detalle va debajo. */
  retenidoTotal: string;
  isr: string;
  iva: string;
  ivaComision: string;
  /**
   * Cuáles de las tres retenciones existen de verdad. NO todas salen siempre.
   *
   * El creador extranjero que vende a compradores mexicanos tiene IVA retenido pero ISR
   * cero, y su comisión sale a 0% por exportación. Pintar «ISR $0.00» ya era ruido; con la
   * explicación de la tasa debajo pasaría a ser mentira, porque le diría que se le retiene
   * el 2.5% de cada venta cuando no se le retiene nada.
   */
  hayIsr: boolean;
  hayIva: boolean;
  hayIvaComision: boolean;
  /** Lo que efectivamente le llega al banco, en la moneda de liquidación. */
  neto: string;
  /**
   * 💱 Lo mismo, aproximado a su moneda. `null` si ya cobra en dólares.
   *
   * Va como GUÍA y no como la cifra principal, y es una decisión con dos motivos que
   * tiran en direcciones contrarias:
   *
   * · A su banco le llegan PESOS, no dólares. Enseñarle solo dólares le esconde la mitad
   *   del dato justo cuando decide si retirar.
   * · Pero el desglose alimenta su CFDI, y ahí una conversión al cambio de hoy no es una
   *   guía sino un número que se factura mal.
   *
   * Así que la cifra ancla se queda en dólares y esto va debajo, en pequeño y con un
   * «aproximadamente» por delante. **El tipo de cambio de verdad no existe hasta que se
   * ejecuta el pago**: lo fija Stripe en el `OutboundPaymentQuote` y queda guardado en la
   * solicitud como `tipoCambio`. Esta cifra usa el cambio de la app, que es otro.
   */
  netoLocal: string | null;
  /**
   * Del impuesto cobrado, la parte que NO se le retuvo y viaja dentro de `neto`. Nulo si no hay.
   *
   * Se dice aparte porque no es suyo: lo declara él. Callarlo haría que creyera que ganó de
   * más y que se gastara un dinero que le debe al SAT.
   */
  ivaPorDeclarar: string | null;
  /** Si hubo impuesto mexicano en sus ventas. Falso ⇒ la línea de la suma ni aparece. */
  hayIvaCobrado: boolean;
  /**
   * Si hay algo que retener. Falso para los creadores de los otros 88 países, cuyo ISR
   * mexicano es cero: para ellos el desglose es una sola línea y las restas sobrarían.
   */
  hayRetenciones: boolean;
};

const GRIS = "rgba(255,255,255,0.55)";
const CLARO = "rgba(255,255,255,0.88)";

/** Una línea del desglose. `nota` es la explicación de una frase, debajo. */
function Linea({
  concepto,
  nota,
  valor,
  signo,
}: {
  concepto: string;
  nota?: string;
  valor: string;
  signo?: "mas" | "menos";
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: CLARO, fontWeight: 500 }}>{concepto}</span>
        <span style={{ color: CLARO, fontWeight: 600, textAlign: "end", whiteSpace: "nowrap" }}>
          {signo === "mas" ? "+ " : signo === "menos" ? "− " : ""}
          {valor}
        </span>
      </div>
      {nota && (
        <span style={{ fontSize: 11.5, color: GRIS, lineHeight: 1.45 }}>{nota}</span>
      )}
    </div>
  );
}

/**
 * Una de las tres retenciones, sangrada bajo su total y con el porqué debajo.
 *
 * La explicación va POR IMPUESTO y no en una nota común porque los tres se descuentan por
 * motivos distintos: dos son retenciones de ley que Vibra adelanta al SAT y el tercero es
 * IVA que el creador le paga a Vibra por su servicio. Meterlos en la misma frase obliga a
 * generalizar, y generalizar aquí es decirle algo falso sobre su dinero.
 */
function Detalle({
  concepto,
  porque,
  valor,
}: {
  concepto: string;
  porque: string;
  valor: string;
}) {
  return (
    <div style={{ display: "grid", gap: 5, paddingInlineStart: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: CLARO }}>
        <span>{concepto}</span>
        <span style={{ whiteSpace: "nowrap" }}>{valor}</span>
      </div>
      <span style={{ fontSize: 11, color: GRIS, lineHeight: 1.45 }}>{porque}</span>
    </div>
  );
}

export default function WithdrawBreakdown({
  desglose,
  /**
   * Impuestos que pagaron sus compradores, ya formateado. `null` si no hay ninguno.
   *
   * Va al final y FUERA del plegado, porque es la única cifra del bloque que no sale de su
   * bolsillo ni entra a este pago: es acumulado histórico de la pestaña de Retiros.
   */
  impuestosRecaudados,
}: {
  desglose: DesgloseRetiro;
  impuestosRecaudados?: string | null;
}) {
  const t = useTranslations("wallet");

  /**
   * El desglose arranca PLEGADO.
   *
   * Lo que el creador viene a ver es cuánto le llega. El reparto de impuestos es la
   * respuesta a la pregunta que hace después, y solo si la hace; enseñárselo todo abierto
   * convertía el momento de pedir su dinero en un formulario del SAT.
   *
   * Se pliega el DETALLE, nunca la cifra: `neto` vive fuera y no hay estado en el que se
   * pueda esconder.
   */
  const [abierto, setAbierto] = useState(false);
  const idDesglose = useId();

  /**
   * ⚠️ La transición va EN LÍNEA, no en una clase de `globals.css`.
   *
   * Ahí estuvo primero, que es donde le tocaría por la media query de movimiento
   * reducido, y el plegado no se movía: el desglose ni abría ni cerraba aunque el botón
   * sí cambiaba de «Ver desglose» a «Ver menos». La hoja compartida no estaba llegando
   * al navegador.
   *
   * En línea no depende de que la hoja se recompile ni de que el dev server la recoja:
   * React escribe el estilo directamente en el elemento. El precio es tener que leer el
   * movimiento reducido a mano, y eso es exactamente lo que hace el hook de abajo.
   */
  const sinMovimiento = useMediaQuery("(prefers-reduced-motion: reduce)");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 💰 Lo único que no se pliega. */}
      <div style={{ display: "grid", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{t("withdrawRowNet")}</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#4ade80", whiteSpace: "nowrap" }}>
            {desglose.neto}
          </span>
        </div>

        {/* 💱 Lo que le va a llegar al banco, en su moneda. Aproximado, y lo dice. */}
        {desglose.netoLocal && (
          <span style={{ fontSize: 11.5, color: GRIS, textAlign: "end", lineHeight: 1.4 }}>
            {t("withdrawNetLocal", { amount: desglose.netoLocal })}
          </span>
        )}
      </div>

      {/* El interruptor va ENCIMA del desglose, no debajo: abriéndose hacia abajo el botón
          no se mueve, y en la pestaña de celular eso es la diferencia entre volver a
          cerrarlo de un toque o perseguirlo por la pantalla. */}
      <TextButton
        tone="brand"
        size="sm"
        style={{ margin: 0, justifySelf: "start", fontFamily: "inherit" }}
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls={idDesglose}
      >
        {abierto ? t("withdrawHideBreakdown") : t("withdrawSeeBreakdown")}
      </TextButton>

      {/* Anima `grid-template-rows` de 0fr a 1fr, que es lo que llega hasta la altura REAL
          del contenido sin medirla en JS: `height: auto` no es animable y `max-height`
          obliga a inventar un tope que, si se queda corto, le recorta el desglose a quien
          tenga las tres retenciones y una moneda de nombre largo.

          El `overflow: hidden` va en el HIJO, no aquí: es la fila del grid la que encoge, y
          puesto en el padre el contenido se sale durante la transición.

          El contenido se queda montado y solo se colapsa, así que `aria-hidden` es lo que
          impide que un lector de pantalla lea un desglose que nadie ve. */}
      <div
        id={idDesglose}
        aria-hidden={!abierto}
        style={{
          display: "grid",
          gridTemplateRows: abierto ? "1fr" : "0fr",
          opacity: abierto ? 1 : 0,
          transition: sinMovimiento
            ? "none"
            : "grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms ease",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div style={{ display: "grid", gap: 22, fontSize: 13, paddingTop: 2 }}>
            <Linea concepto={t("withdrawRowEarned")} valor={desglose.bruto} />

            {/* 🧾 El impuesto del comprador. Suma, y por eso lleva su nota: sin ella parece
                un regalo, y el creador se lo gasta creyendo que es ganancia. */}
            {desglose.hayIvaCobrado && (
              <Linea
                concepto={t("withdrawRowVatCollected")}
                nota={t("withdrawRowVatCollectedNote")}
                valor={desglose.ivaCobrado}
                signo="mas"
              />
            )}

            {/* Las tres retenciones en UNA línea, con su detalle debajo. */}
            {desglose.hayRetenciones && (
              <div style={{ display: "grid", gap: 16 }}>
                <Linea
                  concepto={t("withdrawRowWithheld")}
                  nota={t("withdrawRowWithheldNote")}
                  valor={desglose.retenidoTotal}
                  signo="menos"
                />
                <div style={{ display: "grid", gap: 16 }}>
                  {desglose.hayIsr && (
                    <Detalle
                      concepto={t("withdrawRowIsr")}
                      porque={t("withdrawRowIsrWhy")}
                      valor={desglose.isr}
                    />
                  )}
                  {desglose.hayIva && (
                    <Detalle
                      concepto={t("withdrawRowIva")}
                      porque={t("withdrawRowIvaWhy")}
                      valor={desglose.iva}
                    />
                  )}
                  {desglose.hayIvaComision && (
                    <Detalle
                      concepto={t("withdrawRowCommissionVat")}
                      porque={t("withdrawRowCommissionVatWhy")}
                      valor={desglose.ivaComision}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Del pago, lo que no es suyo. Va dentro del plegado porque suelto bajo el total
                sería una cifra nueva sin contexto: solo se entiende después de haber visto
                que ese impuesto se sumó arriba. */}
            {desglose.ivaPorDeclarar && (
              <p style={{ fontSize: 11.5, color: GRIS, lineHeight: 1.5, margin: 0 }}>
                {t("withdrawVatToDeclare", { amount: desglose.ivaPorDeclarar })}
              </p>
            )}
          </div>
        </div>
      </div>

      {impuestosRecaudados && (
        <>
          <div style={{ height: 1, background: "rgba(255,255,255,0.12)" }} />
          <p style={{ fontSize: 11.5, color: GRIS, lineHeight: 1.5, margin: 0 }}>
            {t("financesTaxCollected")}{" "}
            <span style={{ fontWeight: 640, color: CLARO }}>{impuestosRecaudados}</span>
          </p>
        </>
      )}
    </div>
  );
}
