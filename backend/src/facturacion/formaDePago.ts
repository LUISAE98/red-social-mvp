// Cómo pagó el comprador, en la clave que espera el SAT (catálogo `c_FormaPago`).
//
// Va en cada CFDI y el SAT la mira: dice si el dinero llegó por tarjeta, transferencia o
// efectivo. Antes iba fija en `04` —tarjeta de crédito— para todos, aunque hubieran pagado con
// débito o en un OXXO.
//
// ⚠️ No invalida un CFDI equivocarse, pero es una discrepancia entre lo que dice la factura y
// lo que pasó, y es de las que salen en una revisión.
//
// El dato lo tiene Stripe en `payment_method_details` del cargo, y el webhook lo guarda al
// confirmarse el pago — antes no se puede saber, porque al crear el intent el comprador todavía
// no ha elegido con qué paga.

/** Claves del catálogo `c_FormaPago` que usa Vibra. */
export const FORMA_PAGO = {
  EFECTIVO: "01",
  TRANSFERENCIA: "03",
  TARJETA_CREDITO: "04",
  MONEDERO: "05",
  TARJETA_DEBITO: "28",
  /** Cuando de verdad no se sabe. El SAT lo acepta. */
  POR_DEFINIR: "99",
} as const;

export type ClaveFormaPago = (typeof FORMA_PAGO)[keyof typeof FORMA_PAGO];

/**
 * Lo que Stripe cuenta del cargo, recortado a lo que hace falta.
 *
 * `type` es el método (card, oxxo, customer_balance…) y `funding` distingue crédito de débito
 * dentro de las tarjetas.
 */
export type DetallePago = {
  type?: string | null;
  funding?: string | null;
};

/**
 * Traduce el cargo de Stripe a la clave del SAT.
 *
 * 🚨 Ante la duda, `99` (por definir) y no `04`. Poner «tarjeta de crédito» en un pago que no
 * lo fue es afirmar algo falso; `99` es decir que no consta, que es la verdad.
 *
 * ⚠️ **Apple Pay y Google Pay son tarjetas**, no un método aparte: Stripe los reporta con
 * `type: "card"` y su `funding` real debajo. Por eso se mira `funding` antes que la billetera.
 */
export function formaDePagoSat(detalle: DetallePago | null | undefined): ClaveFormaPago {
  const tipo = (detalle?.type ?? "").toLowerCase();
  const funding = (detalle?.funding ?? "").toLowerCase();

  if (tipo === "card" || tipo === "card_present" || tipo === "link") {
    if (funding === "credit") return FORMA_PAGO.TARJETA_CREDITO;
    if (funding === "debit") return FORMA_PAGO.TARJETA_DEBITO;
    // Una prepago no es ni crédito ni débito: es un monedero electrónico.
    if (funding === "prepaid") return FORMA_PAGO.MONEDERO;
    // Tarjeta sin saber de qué tipo. Mejor no afirmar cuál.
    return FORMA_PAGO.POR_DEFINIR;
  }

  // Pago en tienda: el comprador entrega efectivo en la caja.
  if (tipo === "oxxo") return FORMA_PAGO.EFECTIVO;

  // Transferencia bancaria, que en México es SPEI.
  if (tipo === "customer_balance" || tipo === "spei" || tipo === "bank_transfer") {
    return FORMA_PAGO.TRANSFERENCIA;
  }

  return FORMA_PAGO.POR_DEFINIR;
}
