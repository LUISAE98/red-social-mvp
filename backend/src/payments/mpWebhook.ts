// mpWebhook — recibe las notificaciones de Mercado Pago (Orders API).
//
// MP llama con query `?type=order&data.id=ORD...`. Validamos la firma con ese
// `data.id`, consultamos `GET /v1/orders/{id}` (fuente autoritativa del estado),
// leemos su `external_reference` y aplicamos el resultado de forma idempotente.
//
// Fuente de verdad durable del cobro: si un pago aprueba de forma asíncrona (o
// si la respuesta síncrona de `payGreeting` se perdió), este webhook lo confirma.

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import {
  mpAccessToken,
  mpWebhookSecret,
  mpFetch,
  verifyMpWebhookSignature,
} from "./mpClient";
import {
  normalizeOrderPaymentStatus,
  upsertPaymentIntentStatus,
  applyApprovedPaymentToSource,
} from "./reconcile";
import { reconcileMpSubscription } from "./groupSubscription";

const REGION = "us-central1";

type OrderResponse = {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  transactions?: {
    payments?: Array<{ id?: string; status?: string; status_detail?: string }>;
  };
};

type PaymentResponse = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  order?: { id?: string } | null;
};

/**
 * Resuelve una notificación (order o payment) a un resultado normalizado.
 * MP puede avisar por cualquiera de los dos topics según la suscripción, así que
 * soportamos ambos. Devuelve null si no se pudo resolver.
 */
async function resolveNotification(
  type: string,
  dataId: string
): Promise<{
  externalReference: string;
  normalized: ReturnType<typeof normalizeOrderPaymentStatus>;
  mpOrderId: string | null;
  mpPaymentId: string | null;
  statusDetail: string | null;
} | null> {
  if (type === "order") {
    const res = await mpFetch<OrderResponse>(`/v1/orders/${dataId}`);
    if (!res.ok) {
      logger.error("mpWebhook order_fetch_failed", { dataId, status: res.status });
      return null;
    }
    const order = res.data;
    const externalReference = String(order?.external_reference ?? "").trim();
    if (!externalReference) return null;
    const payment = order?.transactions?.payments?.[0] ?? {};
    return {
      externalReference,
      normalized: normalizeOrderPaymentStatus(order?.status, payment?.status),
      mpOrderId: order?.id ?? dataId,
      mpPaymentId: payment?.id ?? null,
      statusDetail: payment?.status_detail ?? order?.status_detail ?? null,
    };
  }

  if (type === "payment") {
    const res = await mpFetch<PaymentResponse>(`/v1/payments/${dataId}`);
    if (!res.ok) {
      logger.error("mpWebhook payment_fetch_failed", { dataId, status: res.status });
      return null;
    }
    const pay = res.data;
    const externalReference = String(pay?.external_reference ?? "").trim();
    if (!externalReference) return null;
    return {
      externalReference,
      normalized: normalizeOrderPaymentStatus(undefined, pay?.status),
      mpOrderId: pay?.order?.id ?? null,
      mpPaymentId: pay?.id != null ? String(pay.id) : dataId,
      statusDetail: pay?.status_detail ?? null,
    };
  }

  return null;
}

export const mpWebhook = onRequest(
  { region: REGION, secrets: [mpAccessToken, mpWebhookSecret] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = (req.body ?? {}) as { type?: string; data?: { id?: string } };
    const type = String(req.query.type ?? req.query.topic ?? body.type ?? "").trim();
    const dataId = String(
      req.query["data.id"] ?? req.query.id ?? body.data?.id ?? ""
    ).trim();

    // Anti-suplantación: la firma se calcula sobre data.id + x-request-id + ts.
    const validSignature = verifyMpWebhookSignature({
      xSignature: req.headers["x-signature"] as string | undefined,
      xRequestId: req.headers["x-request-id"] as string | undefined,
      dataId,
      secret: mpWebhookSecret.value(),
    });
    if (!validSignature) {
      logger.warn("mpWebhook invalid_signature", { type, dataId });
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Suscripciones (preapproval): topics propios. Se reconcilian aparte.
    if ((type === "subscription_preapproval" || type === "subscription_authorized_payment") && dataId) {
      await reconcileMpSubscription(type, dataId);
      logger.info("mpWebhook subscription processed", { type, dataId });
      res.status(200).json({ received: true });
      return;
    }

    // Soportamos ambos topics (order y payment). Otros → 200 para que MP no
    // reintente. Un data.id de prueba (p.ej. "123456") resolverá 404 → 200.
    if ((type !== "order" && type !== "payment") || !dataId) {
      res.status(200).json({ received: true });
      return;
    }

    const resolved = await resolveNotification(type, dataId);
    if (!resolved) {
      // No se pudo resolver (recurso de prueba, aún no listo, o sin external_ref).
      // 200 para no entrar en bucle de reintentos.
      res.status(200).json({ received: true });
      return;
    }

    const { externalReference, normalized, mpOrderId, mpPaymentId, statusDetail } =
      resolved;

    await upsertPaymentIntentStatus(externalReference, {
      status: normalized,
      mpOrderId,
      mpPaymentId,
      statusDetail,
    });

    if (normalized === "approved") {
      await applyApprovedPaymentToSource(externalReference, { mpOrderId, mpPaymentId });
    }

    logger.info("mpWebhook processed", { type, dataId, externalReference, normalized });
    res.status(200).json({ received: true });
  }
);
