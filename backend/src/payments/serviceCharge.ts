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
import { mpFetch } from "./mpClient";
import {
  normalizeOrderPaymentStatus,
  upsertPaymentIntentStatus,
  applyApprovedPaymentToSource,
} from "./reconcile";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/** MP espera el monto como string con 2 decimales ("100.00"). */
function money(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

export type ServiceCardData = {
  token: string;
  paymentMethodId: string;
  paymentType?: string;
  installments?: number;
  payerEmail: string;
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
  if (!card.token || !card.paymentMethodId) {
    throw new HttpsError("invalid-argument", "Faltan datos de pago.");
  }
  if (!card.payerEmail) {
    throw new HttpsError("invalid-argument", "Falta el correo del pagador.");
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

  const gross = Number(intent.grossAmount);
  if (!Number.isFinite(gross) || gross <= 0) {
    throw new HttpsError("failed-precondition", "Precio inválido para esta compra.");
  }

  const installments =
    Number.isFinite(card.installments) && (card.installments as number) > 0
      ? Math.floor(card.installments as number)
      : 1;

  await upsertPaymentIntentStatus(externalReference, { status: "pending" });

  const res = await mpFetch<OrderResponse>("/v1/orders", {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: {
      type: "online",
      processing_mode: "automatic",
      total_amount: money(gross),
      external_reference: externalReference,
      payer: { email: card.payerEmail },
      transactions: {
        payments: [
          {
            amount: money(gross),
            payment_method: {
              id: card.paymentMethodId,
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
  }

  logger.info("chargeServiceIntent processed", { externalReference, normalized });

  return {
    status: normalized,
    orderId: order?.id ?? null,
    statusDetail: payment?.status_detail ?? order?.status_detail ?? null,
  };
}
