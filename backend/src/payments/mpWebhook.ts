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

    // Por ahora solo procesamos órdenes. Otros topics → 200 para que MP no reintente.
    if (type !== "order" || !dataId) {
      res.status(200).json({ received: true });
      return;
    }

    const orderRes = await mpFetch<OrderResponse>(`/v1/orders/${dataId}`);
    if (!orderRes.ok) {
      logger.error("mpWebhook order_fetch_failed", { dataId, status: orderRes.status });
      // 200 para no gatillar reintentos infinitos; MP reintenta por su cuenta si
      // el recurso aún no está listo, pero no queremos un bucle de error.
      res.status(200).json({ received: true });
      return;
    }

    const order = orderRes.data;
    const externalReference = String(order?.external_reference ?? "").trim();
    if (!externalReference) {
      logger.warn("mpWebhook order_sin_external_reference", { dataId });
      res.status(200).json({ received: true });
      return;
    }

    const payment = order?.transactions?.payments?.[0] ?? {};
    const normalized = normalizeOrderPaymentStatus(order?.status, payment?.status);

    await upsertPaymentIntentStatus(externalReference, {
      status: normalized,
      mpOrderId: order?.id ?? dataId,
      mpPaymentId: payment?.id ?? null,
      statusDetail: payment?.status_detail ?? order?.status_detail ?? null,
    });

    if (normalized === "approved") {
      await applyApprovedPaymentToSource(externalReference, {
        mpOrderId: order?.id ?? dataId,
        mpPaymentId: payment?.id ?? null,
      });
    }

    logger.info("mpWebhook processed", { type, dataId, externalReference, normalized });
    res.status(200).json({ received: true });
  }
);
