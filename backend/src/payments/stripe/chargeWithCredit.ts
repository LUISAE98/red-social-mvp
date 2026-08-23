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
import { resolvePresentment, type Presentment, toStripeAmount } from "../../tax/presentment";
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
  /**
   * El saldo aplicado EN LA MONEDA DEL COMPRADOR: la cifra que se le resta en pantalla.
   * `creditApplied` es su equivalente en la de liquidación, para la contabilidad.
   */
  creditAppliedLocal: number;
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
  /** Precio comercial exacto en la moneda del comprador (…,99). Ver `applyCharmRounding`. */
  displayAmount?: number | null;
}): Promise<CreditSplit> {
  // 1) El TOTAL en la moneda del comprador, ya con su precio comercial. Se resuelve
  //    ANTES de tocar el saldo: es la cifra que él ve y contra la que hay que restar.
  const totalPres = await resolvePresentment(
    params.totalMxn,
    params.displayCurrency,
    params.displayAmount ?? null
  );

  // 2) El saldo se gasta EN ESA MISMA MONEDA.
  //
  //    ⚠️ Antes se descontaba en la de liquidación y solo DESPUÉS se convertía el resto.
  //    Con eso, el saldo que veía el comprador y el descuento que se le aplicaba salían de
  //    dos conversiones distintas, y la resta de la pasarela —total menos saldo, resto a la
  //    tarjeta— no cuadraba por céntimos. Restando en su moneda, cuadra exacta.
  let creditAppliedLocal = 0;
  if (params.applyCredit && params.uid) {
    creditAppliedLocal = await spendBuyerCredit(params.uid, {
      amount: totalPres.amount,
      currency: totalPres.currency,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
    });
  }

  // 3) Lo que queda para la tarjeta, en la moneda del comprador.
  const remainderLocal = round2(totalPres.amount - creditAppliedLocal);

  // 4) Su equivalente en liquidación, en PROPORCIÓN al total. Reconvertir el residuo por
  //    separado metería un segundo redondeo y el reparto dejaría de sumar el total.
  const proporcion = totalPres.amount > 0 ? remainderLocal / totalPres.amount : 0;
  const remainderMxn = round2(params.totalMxn * proporcion);
  const creditApplied = round2(params.totalMxn - remainderMxn);

  // 5) El cobro a la tarjeta reusa la MISMA cotización del total: no se vuelve a resolver,
  //    porque una segunda consulta podría traer otra tasa y separar las dos cifras.
  const presentment: Presentment | null =
    remainderLocal > 0
      ? {
          ...totalPres,
          amount: remainderLocal,
          amountForStripe: toStripeAmount(remainderLocal, totalPres.currency),
          settlementEquivalent: remainderMxn,
        }
      : null;

  return {
    creditApplied,
    creditAppliedLocal,
    remainderMxn: Math.max(0, remainderMxn),
    presentment,
  };
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
