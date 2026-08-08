// Aplicación del SALDO A FAVOR (crédito del comprador) como método de pago, con MEZCLA.
//
// El crédito es dinero que Vibra ya tiene (de una devolución previa). NO es descuento: el
// creador gana igual sobre el precio COMPLETO. El crédito solo reduce lo que se cobra a la
// TARJETA. Todo el cálculo se hace en MXN canónico (`chargedAmount`) y el RESTANTE se
// re-convierte a la moneda de presentación para el cargo real a Stripe.
//
// Seguridad del dinero (reserva + revierte):
//  - Se RESERVA (gasta) el crédito ANTES de cobrar la tarjeta (`spendBuyerCredit`,
//    idempotente por sourceType/sourceId). Así, si la tarjeta falla, se revierte; y si el
//    balance cambió, ya se descontó lo correcto (Vibra nunca queda corta).
//  - Si la tarjeta guardada falla → `revertBuyerCreditSpend` (el caller lo llama).
//  - Tarjeta nueva abandonada (nunca se confirma) → la limpia un cron (revierte la reserva).
//  - Si el crédito cubre el 100% → NO hay cargo a Stripe: se materializa la compra directo.

import { spendBuyerCredit } from "../../wallet/buyerCredit";
import { resolvePresentment, type Presentment } from "../../tax/presentment";
import { applyApprovedPaymentToSource, upsertPaymentIntentStatus } from "../reconcile";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type CreditSplit = {
  /** Crédito realmente reservado (MXN). 0 si no se pidió aplicar crédito o no hay saldo. */
  creditApplied: number;
  /** Restante a cobrar a la tarjeta (MXN). 0 si el crédito cubrió todo. */
  remainderMxn: number;
  /** Presentación del RESTANTE (lo que se cobra a la tarjeta). null si crédito cubrió todo. */
  presentment: Presentment | null;
};

/**
 * Reserva el crédito (si se pidió) y calcula el restante a cobrar a la tarjeta.
 * `spendBuyerCredit` es idempotente por (sourceType, sourceId): un reintento con el mismo
 * externalReference no vuelve a descontar.
 */
export async function reserveCreditAndSplit(params: {
  uid: string;
  applyCredit: boolean;
  totalMxn: number;
  displayCurrency: string;
  sourceType: string;
  sourceId: string;
}): Promise<CreditSplit> {
  let creditApplied = 0;
  if (params.applyCredit && params.uid) {
    creditApplied = await spendBuyerCredit(params.uid, {
      amount: params.totalMxn,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
    });
  }
  const remainderMxn = round2(params.totalMxn - creditApplied);
  const presentment = remainderMxn > 0 ? await resolvePresentment(remainderMxn, params.displayCurrency) : null;
  return { creditApplied, remainderMxn: Math.max(0, remainderMxn), presentment };
}

/**
 * Materializa una compra pagada 100% con crédito (sin cargo de Stripe). Reusa la misma
 * materialización que dispara el webhook al aprobar un pago: crea el doc de dominio con
 * `paymentStatus: "paid"` (dispara el ledger) y marca el intent como pagado por crédito.
 * Idempotente (la materialización lo es).
 */
export async function materializeCreditOnlyPurchase(externalReference: string): Promise<void> {
  await applyApprovedPaymentToSource(externalReference, { mpOrderId: null, mpPaymentId: null });
  await upsertPaymentIntentStatus(externalReference, { status: "paid", paidByCredit: true });
}
