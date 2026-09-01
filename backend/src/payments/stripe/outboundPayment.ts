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

type V2Importe = { value?: number; currency?: string };

type V2OutboundPayment = {
  id?: string;
  /**
   * `processing` al crearlo, `posted` cuando el banco lo acredita, y `failed`, `returned` o
   * `canceled` si se cae. **Crear el pago NO es pagarlo.**
   */
  status?: string;
};

type V2OutboundPaymentQuote = {
  id?: string;
  estimated_fees?: Array<{ amount?: V2Importe; type?: string }>;
  from?: { debited?: V2Importe; financial_account?: string };
  to?: { credited?: V2Importe; recipient?: string; payout_method?: string };
  fx_quote?: {
    lock_expires_at?: string;
    lock_status?: string;
    /** Indexado por la moneda de ORIGEN. */
    rates?: Record<string, { exchange_rate?: string | number }>;
    to_currency?: string;
  };
};

/**
 * Lo que Stripe cobra por este envío, ya desglosado.
 *
 * Sale de `estimated_fees` de la cotización, que llega como una lista de `{amount, type}`.
 * Se separa por tipo porque cada línea responde a una pregunta distinta: el fijo es del rail,
 * la transfronteriza del país y la de conversión de la moneda.
 */
export type ComisionesEnvio = {
  /** `standard_payout_fee` — el fijo del rail (1.50 local, 25 wire). */
  fijo: number;
  /** `cross_border_payout_fee` — del 0.25% al 1.25% según país de destino. */
  transfronteriza: number;
  /** `foreign_exchange_fee` — 0.50% entre USD·EUR·GBP, 1% el resto, 0 sin conversión. */
  conversion: number;
  /** Cualquier tipo que Stripe agregue y que todavía no sepamos nombrar. */
  otras: number;
  /** La suma. Es lo que sale de la cuenta ADEMÁS del importe enviado. */
  total: number;
};

/** Lo que la cotización dice que va a pasar, antes de que pase. */
export type Cotizacion = {
  id: string;
  comisiones: ComisionesEnvio;
  /** Lo que sale de la cuenta de Vibra, sin las comisiones. */
  debitado: number;
  /** Lo que le llega al creador, en SU moneda. */
  acreditado: number;
  monedaDestino: string;
  /** Tipo de cambio aplicado, o `null` si no hay conversión. */
  tipoCambio: number | null;
  /** Cuándo caduca la cotización. Stripe la mantiene cinco minutos. */
  caducaEn: string | null;
};

export type EnvioResultado =
  | {
      ok: true;
      outboundPaymentId: string;
      estado: string;
      /** Null solo si la cotización no se pudo crear y el envío salió sin ella. */
      cotizacion: Cotizacion | null;
    }
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

/** Los importes de Stripe van en la unidad mínima: 1000 = 10.00 USD. */
const aCentavos = (n: number) => Math.round(n * 100);
const aUnidades = (n: number) => Math.round(n) / 100;

/**
 * 💱 LA COTIZACIÓN. Lo que Stripe va a cobrar y al tipo de cambio que va a convertir,
 *    ANTES de mover un peso.
 *
 * Resuelve tres cosas que estaban rotas de tres maneras distintas:
 *
 *   1. **El saldo.** Antes se comprobaba `disponible >= neto`, pero Stripe cobra sus
 *      comisiones **de la misma cuenta financiera** y no las descuenta del envío. Con
 *      exactamente 300 USD en la cuenta, la validación pasaba y Stripe rechazaba después.
 *   2. **La moneda.** Antes se forzaba `to.currency: "usd"` contra la cuenta del creador.
 *      Una cuenta que solo admite moneda local devuelve `payout_method_unsupported_currency`.
 *      Ahora se omite y Stripe elige la que acepta el método de cobro.
 *   3. **El tipo de cambio.** No existía en ninguna parte del sistema, así que no se le podía
 *      enseñar al creador ni poner en su CFDI. Ahora llega en `fx_quote.rates`.
 *
 * ⚠️ **Vive cinco minutos.** Si se agota, el envío falla con `fx_quote_expired` y hay que
 *    pedir otra. Por eso se crea aquí, pegada al envío, y no cuando el creador abre el panel.
 *
 * ⚠️ **`from`, `to`, `amount` y `delivery_options` tienen que ser IDÉNTICOS** en la cotización
 *    y en el pago, o Stripe responde `outbound_payment_quote_mismatch`. Por eso los dos los
 *    arma la misma función a partir del mismo objeto.
 */
async function cotizar(params: {
  origenId: string;
  cuentaId: string;
  metodoId: string;
  centavos: number;
  currency: string;
}): Promise<Cotizacion | null> {
  const { origenId, cuentaId, metodoId, centavos, currency } = params;

  const res = await stripeFetch<V2OutboundPaymentQuote>(
    "/v2/money_management/outbound_payment_quotes",
    {
      method: "POST",
      apiVersion: V2_VERSION,
      usePayoutsKey: true,
      json: cuerpoDelMovimiento({ origenId, cuentaId, metodoId, centavos, currency }),
    }
  );

  if (!res.ok || !res.data?.id) {
    logger.error("outbound_cotizacion_falló", {
      cuentaId,
      error: String(res.ok ? "Stripe respondió sin id de cotización." : res.error).slice(0, 300),
    });
    return null;
  }

  const q = res.data;
  // La guarda de arriba ya descartó el id vacío; esto es lo que se lo demuestra al compilador,
  // que no arrastra el estrechamiento a través del encadenamiento opcional.
  const quoteId = q.id;
  if (!quoteId) return null;

  const comisiones: ComisionesEnvio = { fijo: 0, transfronteriza: 0, conversion: 0, otras: 0, total: 0 };
  for (const f of q.estimated_fees ?? []) {
    const v = aUnidades(f.amount?.value ?? 0);
    if (f.type === "standard_payout_fee") comisiones.fijo += v;
    else if (f.type === "cross_border_payout_fee") comisiones.transfronteriza += v;
    else if (f.type === "foreign_exchange_fee") comisiones.conversion += v;
    else comisiones.otras += v;
    comisiones.total += v;
  }

  // La tasa viene indexada por la moneda de ORIGEN, no por la de destino.
  const tasa = q.fx_quote?.rates?.[currency.toLowerCase()]?.exchange_rate;
  const tipoCambio = tasa != null && Number.isFinite(Number(tasa)) ? Number(tasa) : null;

  return {
    id: quoteId,
    comisiones,
    debitado: aUnidades(q.from?.debited?.value ?? centavos),
    acreditado: aUnidades(q.to?.credited?.value ?? centavos),
    monedaDestino: (q.to?.credited?.currency ?? currency).toUpperCase(),
    tipoCambio,
    caducaEn: q.fx_quote?.lock_expires_at ?? null,
  };
}

/**
 * El cuerpo del movimiento, compartido por la cotización y el pago.
 *
 * 🚨 Los dos tienen que mandar EXACTAMENTE lo mismo o Stripe responde
 *    `outbound_payment_quote_mismatch`. Que lo arme una sola función es lo que garantiza que
 *    no se separen al editar uno de los dos.
 *
 * `to.currency` se omite a propósito: Stripe elige la que admite el método de cobro del
 * creador. Forzar dólares contra una cuenta que solo acepta moneda local la rechaza.
 */
function cuerpoDelMovimiento(p: {
  origenId: string;
  cuentaId: string;
  metodoId: string;
  centavos: number;
  currency: string;
}) {
  const moneda = p.currency.toLowerCase();
  return {
    from: { financial_account: p.origenId, currency: moneda },
    to: { recipient: p.cuentaId, payout_method: p.metodoId },
    amount: { value: p.centavos, currency: moneda },
  };
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

  const metodo = await metodoDelCreador(cuentaId);
  if (!metodo?.id) {
    return { ok: false, motivo: "El creador no tiene un método de cobro dado de alta." };
  }

  const centavos = aCentavos(neto);
  const movimiento = cuerpoDelMovimiento({
    origenId: origen.id,
    cuentaId,
    metodoId: metodo.id,
    centavos,
    currency,
  });

  const cotizacion = await cotizar({
    origenId: origen.id,
    cuentaId,
    metodoId: metodo.id,
    centavos,
    currency,
  });

  /**
   * 🚨 EL SALDO, ANTES DE INTENTARLO — Y CON LAS COMISIONES DENTRO.
   *
   * Stripe cobra sus comisiones **de la cuenta financiera**, no las descuenta del envío. Con
   * exactamente el importe justo, este chequeo pasaba y Stripe rechazaba después con
   * `insufficient_funds`, dejando la solicitud en un estado que había que rescatar a mano.
   *
   * Si la cotización no se pudo crear se comprueba solo el importe, que es lo que se podía
   * hacer antes. Es peor, pero es mejor que no comprobar nada.
   */
  const disponible = origen.balance?.available?.[currency.toLowerCase()]?.value ?? 0;
  const necesario = centavos + aCentavos(cotizacion?.comisiones.total ?? 0);
  if (disponible < necesario) {
    const falta = ((necesario - disponible) / 100).toFixed(2);
    const detalle = cotizacion
      ? ` Se envían ${neto.toFixed(2)} y Stripe cobra ${cotizacion.comisiones.total.toFixed(2)} de comisión aparte.`
      : "";
    return {
      ok: false,
      motivo: `Falta saldo en la cuenta de Vibra. Se necesitan ${falta} ${currency.toUpperCase()} más.${detalle}`,
    };
  }

  const res = await stripeFetch<V2OutboundPayment>("/v2/money_management/outbound_payments", {
    method: "POST",
    apiVersion: V2_VERSION,
    usePayoutsKey: true,
    // 🚨 Un reintento con el mismo id devuelve el mismo pago, no manda otro.
    idempotencyKey: `withdrawal_${requestId}`,
    json: {
      ...movimiento,
      // La cotización que el creador ya vio. Sin ella, los países con mandato regulatorio de
      // enseñar las comisiones por adelantado rechazan el pago.
      ...(cotizacion ? { outbound_payment_quote: cotizacion.id } : {}),
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
    comisiones: cotizacion?.comisiones.total ?? null,
    tipoCambio: cotizacion?.tipoCambio ?? null,
  });

  return {
    ok: true,
    outboundPaymentId: res.data.id,
    estado: res.data.status ?? "processing",
    cotizacion,
  };
}

/**
 * Relee un pago ya creado, para saber en qué acabó.
 *
 * Un `OutboundPayment` nace en `processing` y tarda de uno a siete días en llegar al banco.
 * Esta función es lo que permite cerrar la solicitud cuando de verdad termina, en vez de
 * darla por pagada al crearla.
 */
export async function leerPago(
  outboundPaymentId: string
): Promise<{ ok: true; estado: string } | { ok: false; motivo: string }> {
  if (!outboundPaymentId) return { ok: false, motivo: "Sin id de pago." };

  const res = await stripeFetch<V2OutboundPayment>(
    `/v2/money_management/outbound_payments/${encodeURIComponent(outboundPaymentId)}`,
    { method: "GET", apiVersion: V2_VERSION, usePayoutsKey: true }
  );

  if (!res.ok || !res.data?.status) {
    const error = (res.ok ? "Stripe respondió sin estado." : String(res.error)).slice(0, 300);
    logger.error("outbound_payment_lectura_falló", { outboundPaymentId, error });
    return { ok: false, motivo: error };
  }
  return { ok: true, estado: res.data.status };
}
