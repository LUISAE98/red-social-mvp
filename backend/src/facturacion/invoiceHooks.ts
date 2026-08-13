// Punto de enganche de FACTURACIÓN (PREPARADO — NO conectado todavía).
//
// Fija el CONTRATO por el que, en los Bloques 2 y 3, la facturación se disparará
// cuando una venta quede registrada en el ledger, SIN tener que modificar el ledger
// en ese momento. Hoy es un no-op: el ledger NO llama a esto aún.
//
// MODELO VENDEDOR DIRECTO (docs/legal/fiscal-iva-isr-plataforma.md §0.6). Son CUATRO
// caminos, y lo que decide es la RESIDENCIA de la contraparte:
//
//   COMPRA (lado comprador)
//     1. Comprador MEXICANO   → puede pedir CFDI de venta, con el CSD de Vibra.
//     2. Comprador EXTRANJERO → comprobante de pago (NO fiscal): no hay CFDI que emitir
//        a un residente en el extranjero.
//
//   RETIRO (lado creador)
//     3. Creador MEXICANO   → factura a Vibra su 75% CON RETENCIONES según su régimen
//        (D-06). Dos caminos a elección suya: sube su CSD y Vibra la emite por él
//        (self-billing), o sube él mismo su PDF + XML ya timbrados.
//     4. Creador EXTRANJERO → comprobante de pago y se le transfiere; no hay CFDI.
//
// 🚫 La FACTURA GLOBAL mensual NO se automatiza por ahora (decisión de Luis, 2026-08-13).
//    Lo que el comprador no pida se queda sin CFDI y se resuelve fuera del sistema.
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
