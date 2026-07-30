// Helper interno de cobro de un paymentIntent ya creado.
//
// NO es una "pasarela genérica de producto": es solo el bloque de dinero común
// (crear la Order en MP + reconciliar) que reusan las funciones de pago POR
// SERVICIO (payExclusiveSession, etc.), para no duplicar código crítico. Cada
// servicio conserva su propio callable, su create<Service>Request y su rama en
// reconcile, de modo que las diferencias por servicio se manejan aparte.

import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { mpFetch, MP_SANDBOX, SANDBOX_PAYER_EMAIL } from "./mpClient";
import {
  normalizeOrderPaymentStatus,
  upsertPaymentIntentStatus,
  applyApprovedPaymentToSource,
} from "./reconcile";
import { saveCardForBuyer, getSavedCardRef } from "./savedCards";
import { applyConsumptionTax } from "../tax/config";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/** MP espera el monto como string con 2 decimales ("100.00"). */
function money(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * La cuenta de Mercado Pago liquida SIEMPRE en MXN, pero desde la migración de
 * moneda el precio del servicio (grossAmount) se guarda en la moneda ancla (USD)
 * o en la del intent. Convertimos el monto a MXN con la tasa vigente
 * (`config/exchangeRates`, base USD, rates[X] = unidades de X por 1 USD) ANTES de
 * cobrar. Si no hay tasa válida, NO cobramos: es preferible fallar a mandar un
 * monto en la escala equivocada (lo que MP rechaza como invalid_transaction_amount).
 */
async function toMxnSettlement(
  amount: number,
  sourceCurrency: unknown
): Promise<{ amountMXN: number; fxRate: number; sourceCurrency: string }> {
  const src = String(sourceCurrency || "MXN").toUpperCase();
  if (src === "MXN") {
    return { amountMXN: round2(amount), fxRate: 1, sourceCurrency: "MXN" };
  }
  const snap = await db.doc("config/exchangeRates").get();
  const rates = (snap.data()?.rates ?? {}) as Record<string, number>;
  const rMxn = rates.MXN;
  const rSrc = rates[src];
  if (
    !Number.isFinite(rMxn) || rMxn <= 0 ||
    !Number.isFinite(rSrc) || rSrc <= 0
  ) {
    throw new HttpsError(
      "failed-precondition",
      "No se pudo obtener la tasa de cambio para procesar el pago. Intenta de nuevo en unos minutos."
    );
  }
  // amount(src) → USD (÷rSrc) → MXN (×rMxn).
  const amountMXN = round2((amount / rSrc) * rMxn);
  return { amountMXN, fxRate: round2((rMxn / rSrc) * 1e6) / 1e6, sourceCurrency: src };
}

export type ServiceCardData = {
  token: string;
  paymentMethodId?: string;
  paymentType?: string;
  installments?: number;
  payerEmail?: string;
  /** Token de guardado (segundo token de la tarjeta nueva) para guardarla. */
  saveToken?: string;
  /** Si se cobra con una tarjeta YA guardada: su mpCardId. */
  savedCardId?: string;
  /**
   * 🧾 IVA — País fiscal del comprador (ISO-2, ej. "MX"), detectado por IP en el
   * cliente. Determina el impuesto SUMADO al cobro. 🔁 DLOCAL-MIGRATION: debe pasar
   * a determinarse de forma autoritativa en el backend (IP del request + tarjeta).
   */
  taxCountry?: string | null;
};

type OrderResponse = {
  id?: string;
  status?: string;
  status_detail?: string;
  transactions?: {
    payments?: Array<{ id?: string; status?: string; status_detail?: string }>;
  };
};

export type ChargeResult = {
  status: "approved" | "pending" | "rejected" | "unknown" | "refunded" | "charged_back";
  orderId: string | null;
  statusDetail: string | null;
};

/**
 * Cobra un paymentIntent existente (creado por create<Service>Request) y, si
 * aprueba, materializa el documento de dominio vía reconcile. Idempotente.
 */
export async function chargeServiceIntent(
  externalReference: string,
  uid: string,
  card: ServiceCardData
): Promise<ChargeResult> {
  if (!card.token) {
    throw new HttpsError("invalid-argument", "Faltan datos de pago.");
  }

  const intentRef = db.collection("paymentIntents").doc(externalReference);
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) {
    throw new HttpsError("not-found", "Compra no encontrada.");
  }
  const intent = intentSnap.data() ?? {};

  if (intent.buyerId !== uid) {
    throw new HttpsError("permission-denied", "No eres el comprador de esta compra.");
  }
  if (intent.status === "approved" || intent.status === "paid") {
    throw new HttpsError("failed-precondition", "Esta compra ya está pagada.");
  }

  const base = Number(intent.grossAmount);
  if (!Number.isFinite(base) || base <= 0) {
    throw new HttpsError("failed-precondition", "Precio inválido para esta compra.");
  }

  // 🧾 IVA — El comprador paga base + IVA (SUMADO). El `grossAmount` del intent es la
  // BASE (precio del creador, SIN impuesto) y NO se toca: así las ganancias del creador
  // —que el ledger calcula sobre la base, a partir de los docs de dominio— siguen
  // correctas. El IVA es de Vibra hacia el SAT, no del creador. Guardamos el desglose
  // fiscal en el intent (baseAmount / taxAmount / taxCountry) como registro.
  // 🔁 DLOCAL-MIGRATION: hoy el país fiscal viene del CLIENTE (card.taxCountry, por IP).
  // Al migrar, determinarlo aquí de forma autoritativa (IP del request + país de la
  // tarjeta) y calcular el split de retención (50%/100% IVA + ISR) + CFDI de retención.
  // Matriz y fundamentos: docs/legal/fiscal-iva-isr-plataforma.md.
  const tax = applyConsumptionTax(base, card.taxCountry);
  const charged = tax.chargedAmount;

  // MP liquida en MXN; `charged` está en la moneda del intent (USD ancla u otra).
  // Convertimos a MXN para el cobro real. NO tocamos base/tax/charged (siguen en
  // la moneda ancla, que es lo que lee el ledger): solo agregamos el registro de
  // liquidación en MXN. Si no hay tasa, esto lanza y no se cobra.
  const settlement = await toMxnSettlement(charged, intent.currency);

  await db.collection("paymentIntents").doc(externalReference).set(
    {
      baseAmount: tax.baseAmount,
      taxCountry: tax.taxCountry,
      taxRate: tax.taxRate,
      taxAmount: tax.taxAmount,
      chargedAmount: charged,
      settlementCurrency: "MXN",
      settlementAmount: settlement.amountMXN,
      settlementFxRate: settlement.fxRate,
      settlementSourceCurrency: settlement.sourceCurrency,
    },
    { merge: true }
  );

  logger.info("chargeServiceIntent start", {
    externalReference,
    hasSaveToken: !!card.saveToken,
    savedCardId: card.savedCardId ?? null,
  });

  const installments =
    Number.isFinite(card.installments) && (card.installments as number) > 0
      ? Math.floor(card.installments as number)
      : 1;

  // En sandbox el email debe terminar en @testuser.com; en prod usamos el real.
  const effectiveEmail = MP_SANDBOX ? SANDBOX_PAYER_EMAIL : card.payerEmail ?? "";

  // Arma el pagador y el método según sea tarjeta GUARDADA o NUEVA.
  let payer: Record<string, unknown>;
  let paymentMethodId: string;
  if (card.savedCardId) {
    const ref = await getSavedCardRef(uid, card.savedCardId);
    if (!ref) {
      throw new HttpsError("failed-precondition", "Tarjeta guardada no encontrada.");
    }
    payer = { customer_id: ref.mpCustomerId };
    paymentMethodId = ref.paymentMethodId;
  } else {
    if (!card.paymentMethodId) {
      throw new HttpsError("invalid-argument", "Falta el método de pago.");
    }
    if (!effectiveEmail) {
      throw new HttpsError("invalid-argument", "Falta el correo del pagador.");
    }
    payer = { email: effectiveEmail };
    paymentMethodId = card.paymentMethodId;
  }

  await upsertPaymentIntentStatus(externalReference, { status: "pending" });

  const res = await mpFetch<OrderResponse>("/v1/orders", {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: {
      type: "online",
      processing_mode: "automatic",
      total_amount: money(settlement.amountMXN),
      external_reference: externalReference,
      payer,
      transactions: {
        payments: [
          {
            amount: money(settlement.amountMXN),
            payment_method: {
              id: paymentMethodId,
              type: card.paymentType ?? "credit_card",
              token: card.token,
              installments,
            },
          },
        ],
      },
    },
  });

  if (!res.ok) {
    await upsertPaymentIntentStatus(externalReference, {
      status: "rejected",
      lastError: String(res.error).slice(0, 500),
    });
    logger.error("chargeServiceIntent order_failed", {
      externalReference,
      status: res.status,
    });
    throw new HttpsError("internal", "No se pudo procesar el pago. Intenta de nuevo.");
  }

  const order = res.data;
  const payment = order?.transactions?.payments?.[0] ?? {};
  const normalized = normalizeOrderPaymentStatus(order?.status, payment?.status);

  await upsertPaymentIntentStatus(externalReference, {
    status: normalized,
    mpOrderId: order?.id ?? null,
    mpPaymentId: payment?.id ?? null,
    statusDetail: payment?.status_detail ?? order?.status_detail ?? null,
  });

  if (normalized === "approved") {
    await applyApprovedPaymentToSource(externalReference, {
      mpOrderId: order?.id ?? null,
      mpPaymentId: payment?.id ?? null,
    });

    // Guarda la tarjeta NUEVA si el comprador lo pidió (best-effort; no tumba el
    // pago si falla). Solo con tarjeta nueva (no re-guarda una ya guardada).
    if (card.saveToken && effectiveEmail && !card.savedCardId) {
      try {
        await saveCardForBuyer(uid, effectiveEmail, card.saveToken);
      } catch (err) {
        logger.warn("chargeServiceIntent save_card_failed", {
          externalReference,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  logger.info("chargeServiceIntent processed", { externalReference, normalized });

  return {
    status: normalized,
    orderId: order?.id ?? null,
    statusDetail: payment?.status_detail ?? order?.status_detail ?? null,
  };
}
