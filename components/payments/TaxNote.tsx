"use client";

// Nota "+ impuestos" (chica, tenue) que se muestra DEBAJO de un precio SOLO cuando
// el país del comprador tiene impuesto configurado (hoy únicamente México = IVA 16%).
//
// El impuesto va SUMADO sobre el precio del creador; el desglose exacto
// (Subtotal / IVA / Total) aparece en el panel de pago (ServicePaymentModal).
//
// El texto va en español a propósito: hoy el impuesto solo aplica a compradores
// ubicados en México, que son hispanohablantes. Cuando se activen más países se
// deberá internacionalizar. Ver docs/legal/fiscal-iva-isr-plataforma.md.

import type React from "react";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { platformCollectsTax } from "@/lib/tax/config";

type Props = {
  /** Color del texto (ajústalo al fondo: claro sobre tarjetas oscuras). */
  color?: string;
  /** Alineación del texto. Default "left". */
  align?: "left" | "center" | "right";
  /** Estilos extra (margen, etc.). */
  style?: React.CSSProperties;
  /**
   * `true` cuando el precio mostrado ARRIBA ya incluye el impuesto → la nota dice
   * "impuestos incluidos". Por defecto (`false`) el precio es la base y dice
   * "+ impuestos".
   */
  included?: boolean;
};

export default function TaxNote({ color = "#9aa0a8", align = "left", style, included = false }: Props) {
  const { buyerCountry } = usePriceFormat();

  // ⚠️ La condición es que VIBRA cobre el impuesto, no que el país tenga tasa.
  //
  // Antes se guiaba por `taxRate > 0`, y eso se rompe en los países donde recauda la
  // EMISORA del comprador (Argentina, Costa Rica, Ecuador, Paraguay, Rep. Dominicana):
  // ahí la tasa existe —y se guarda— pero el precio NO la incluye, porque se la agrega su
  // banco en el resumen de tarjeta. Decir "impuestos incluidos" ahí sería mentir.
  //
  // Tampoco se muestra mientras el país aún no se conoce (`buyerCountry` null).
  if (!platformCollectsTax(buyerCountry)) return null;
  return (
    <span
      style={{
        display: "block",
        fontSize: 11,
        fontWeight: 500,
        color,
        textAlign: align,
        lineHeight: 1.2,
        ...style,
      }}
    >
      {included ? "impuestos incluidos" : "+ impuestos"}
    </span>
  );
}
