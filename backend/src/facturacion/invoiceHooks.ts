// Punto de enganche de FACTURACIÓN (PREPARADO — NO conectado todavía).
//
// Fija el CONTRATO por el que, en los Bloques 2 y 3, la facturación se disparará
// cuando una venta quede registrada en el ledger, SIN tener que modificar el ledger
// en ese momento. Hoy es un no-op: el ledger NO llama a esto aún.
//
// MODELO VENDEDOR DIRECTO (docs/legal/fiscal-iva-isr-plataforma.md §0.6) — al
// dispararse, aquí se decidirá qué emitir vía Facturapi:
//   • Vibra → Comprador: CFDI de VENTA (con CSD de Vibra) SOLO si el comprador la
//     pidió; si no, comprobante de pago (no fiscal) y la venta entra a la factura
//     global mensual. → Bloque 2.
//   • Creador → Vibra: CFDI de PROVEEDOR (self-billing, con el CSD del creador, en
//     su organización de Facturapi) por cada pago, si el creador ya subió su CSD.
//     Retenciones al proveedor según su régimen (D-06). → Bloque 3.
//
// ⚠️ INTENCIONALMENTE DESCONECTADO: no importar ni llamar esto desde el ledger aún.

/** Datos mínimos de una venta ya registrada, para decidir la facturación. */
export type EarningInvoiceContext = {
  creatorId: string;
  buyerId: string | null;
  /** Tipo de servicio (LedgerServiceType), p.ej. "premium_post". */
  serviceType: string;
  /** Origen determinista de la venta: {sourceType}__{sourceId}. */
  sourceType: string;
  sourceId: string;
  /** Precio base (SIN impuesto): la venta real. */
  baseAmount: number;
  /** Impuesto (IVA) cobrado al comprador. Va al SAT, no es del creador. */
  taxAmount: number;
  /** País fiscal del comprador (ISO-2) o null. */
  taxCountry: string | null;
  /** Moneda del monto (ancla del ledger). */
  currency: string;
};

/**
 * Enganche futuro. Se invocará desde el flujo del ledger cuando una venta quede
 * registrada (Bloques 2/3). HOY es un no-op: deja el contrato listo para no tocar
 * el ledger después. NO conectado.
 */
export async function onEarningInvoiceHook(_ctx: EarningInvoiceContext): Promise<void> {
  // TODO(Bloque 2): CFDI de venta Vibra→comprador (si la pidió) / comprobante de pago.
  // TODO(Bloque 3): CFDI de proveedor creador→Vibra (self-billing) por cada pago.
  return;
}
