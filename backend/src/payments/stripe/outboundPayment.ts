// El envío del dinero al creador. Global Payouts, API v2.
//
// Es la última pieza del flujo: el `OutboundPayment` saca el importe del `FinancialAccount` de
// Vibra y lo manda al `PayoutMethod` del creador. Todo lo demás —su cuenta, su formulario, su
// método de cobro— existía para poder llegar aquí.
//
// 🚨 ESTO MUEVE DINERO DE VERDAD. Tres cosas lo protegen, y las tres son deliberadas:
//
//   1. **Clave de idempotencia = el id de la solicitud.** Un reintento por un timeout NO
//      manda el dinero dos veces: Stripe devuelve el mismo objeto. Sin esto, una respuesta
//      perdida por la red se convierte en un pago duplicado.
//   2. **Se comprueba el saldo antes.** Un `FinancialAccount` sin fondos falla con un error
//      genérico; mirarlo primero permite decir qué pasa de verdad.
//   3. **Solo se llama tras la aprobación humana**, nunca desde el flujo del creador.
//
// ⚠️ VIVE EN VISTA PREVIA. La versión va fijada; si Stripe cambia la API, esto se entera de
//    golpe. Ver `V2_VERSION`.

import { logger } from "firebase-functions";
import { stripeFetch } from "./stripeClient";

/** La misma que usa el alta del creador. Las dos tienen que ir en la misma versión. */
const V2_VERSION = "2026-08-26.preview";

type V2FinancialAccount = {
  id?: string;
  balance?: { available?: Record<string, { value?: number }> };
};

type V2PayoutMethod = {
  id?: string;
  bank_account?: { last4?: string; bank_name?: string };
};

type V2OutboundPayment = {
  id?: string;
  status?: string;
};

export type EnvioResultado =
  | { ok: true; outboundPaymentId: string; estado: string }
  | { ok: false; motivo: string };

/**
 * El `FinancialAccount` desde el que paga Vibra.
 *
 * Se consulta en vez de guardarse en una constante: hay uno solo por cuenta, y el id cambia
 * entre el sandbox (`fa_test_…`) y producción. Fijarlo a mano garantizaba que un día se
 * pagara desde el equivocado.
 */
async function cuentaDeOrigen(): Promise<V2FinancialAccount | null> {
  const res = await stripeFetch<{ data?: V2FinancialAccount[] }>(
    "/v2/money_management/financial_accounts",
    { method: "GET", apiVersion: V2_VERSION, usePayoutsKey: true }
  );
  if (!res.ok) {
    logger.error("outbound_cuenta_origen_falló", { error: String(res.error).slice(0, 300) });
    return null;
  }
  return res.data?.data?.[0] ?? null;
}

/** El método de cobro del creador. El primero es el que dio de alta en el formulario. */
async function metodoDelCreador(cuentaId: string): Promise<V2PayoutMethod | null> {
  const res = await stripeFetch<{ data?: V2PayoutMethod[] }>(
    "/v2/money_management/payout_methods",
    { method: "GET", apiVersion: V2_VERSION, usePayoutsKey: true, stripeAccount: cuentaId }
  );
  if (!res.ok) {
    logger.error("outbound_metodo_falló", { cuentaId, error: String(res.error).slice(0, 300) });
    return null;
  }
  return res.data?.data?.[0] ?? null;
}

/**
 * Manda el dinero.
 *
 * @param requestId   Id de la solicitud. Es la clave de idempotencia, así que un reintento
 *                    del MISMO retiro nunca duplica el pago.
 * @param cuentaId    `acct_…` del creador, su cuenta de destinatario.
 * @param neto        Lo que se le manda, en la moneda de liquidación.
 * @param currency    Minúsculas, como la quiere Stripe.
 */
export async function enviarPago(params: {
  requestId: string;
  cuentaId: string;
  neto: number;
  currency: string;
}): Promise<EnvioResultado> {
  const { requestId, cuentaId, neto, currency } = params;

  if (!(neto > 0)) return { ok: false, motivo: "El importe a enviar no es válido." };
  if (!cuentaId) return { ok: false, motivo: "El creador no tiene cuenta de cobro en Stripe." };

  const origen = await cuentaDeOrigen();
  if (!origen?.id) {
    return { ok: false, motivo: "No se pudo leer la cuenta desde la que paga Vibra." };
  }

  /**
   * 🚨 EL SALDO, ANTES DE INTENTARLO.
   *
   * Sin fondos, Stripe rechaza con un error genérico que no dice qué pasó. Mirarlo aquí
   * convierte «no se pudo enviar» en «falta fondear la cuenta», que es accionable.
   *
   * Los importes de Stripe van en la unidad mínima: 1000 = 10.00 USD.
   */
  const disponible = origen.balance?.available?.[currency.toLowerCase()]?.value ?? 0;
  const centavos = Math.round(neto * 100);
  if (disponible < centavos) {
    const falta = ((centavos - disponible) / 100).toFixed(2);
    return {
      ok: false,
      motivo: `Falta saldo en la cuenta de Vibra. Se necesitan ${falta} ${currency.toUpperCase()} más.`,
    };
  }

  const metodo = await metodoDelCreador(cuentaId);
  if (!metodo?.id) {
    return { ok: false, motivo: "El creador no tiene un método de cobro dado de alta." };
  }

  const res = await stripeFetch<V2OutboundPayment>("/v2/money_management/outbound_payments", {
    method: "POST",
    apiVersion: V2_VERSION,
    usePayoutsKey: true,
    // 🚨 Un reintento con el mismo id devuelve el mismo pago, no manda otro.
    idempotencyKey: `withdrawal_${requestId}`,
    json: {
      from: { financial_account: origen.id, currency: currency.toLowerCase() },
      to: {
        recipient: cuentaId,
        payout_method: metodo.id,
        currency: currency.toLowerCase(),
      },
      amount: { value: centavos, currency: currency.toLowerCase() },
      // Para poder reconciliar desde el Dashboard sin adivinar de qué retiro es.
      metadata: { withdrawalRequestId: requestId },
    },
  });

  if (!res.ok || !res.data?.id) {
    // `error` solo existe en la rama fallida del tipo; con `ok` y sin id, el fallo es otro.
    const error = (res.ok ? "Stripe respondió sin id de pago." : String(res.error)).slice(0, 300);
    logger.error("outbound_payment_falló", { requestId, cuentaId, error });
    return { ok: false, motivo: `Stripe rechazó el envío. ${error}` };
  }

  logger.info("outbound_payment_creado", {
    requestId,
    cuentaId,
    outboundPaymentId: res.data.id,
    estado: res.data.status ?? "desconocido",
    neto,
  });

  return {
    ok: true,
    outboundPaymentId: res.data.id,
    estado: res.data.status ?? "pending",
  };
}
