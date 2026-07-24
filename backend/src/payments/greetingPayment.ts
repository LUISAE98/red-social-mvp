// payGreeting — cobra un saludo/consejo con Mercado Pago (Orders API).
//
// Flujo (crear-luego-pagar): `createGreetingRequest` ya creó la solicitud en
// `awaiting_payment`. El cliente tokeniza la tarjeta con el Payment Brick (Public
// Key) y llama aquí con el token. Creamos la Order en MP; si aprueba, volteamos
// la solicitud a "paid" (lo que dispara el ledger vía trigger).
//
// El webhook (`mpWebhook`) confirma de forma durable y asíncrona; esta respuesta
// síncrona solo adelanta la UX. Ambos caminos son idempotentes.

import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { mpAccessToken, mpFetch, MP_CURRENCY } from "./mpClient";
import {
  normalizeOrderPaymentStatus,
  upsertPaymentIntentStatus,
  applyApprovedPaymentToSource,
} from "./reconcile";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const REGION = "us-central1";

/** MP espera el monto como string con 2 decimales ("100.00"). */
function money(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

type OrderResponse = {
  id?: string;
  status?: string;
  status_detail?: string;
  transactions?: {
    payments?: Array<{ id?: string; status?: string; status_detail?: string }>;
  };
};

export const payGreeting = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const greetingRequestId = String(data.greetingRequestId ?? "").trim();
    const token = String(data.token ?? "").trim();
    const paymentMethodId = String(data.paymentMethodId ?? "").trim();
    const paymentType = String(data.paymentType ?? "credit_card").trim();
    const rawInstallments = Number(data.installments);
    const installments = Number.isFinite(rawInstallments)
      ? Math.max(1, Math.floor(rawInstallments))
      : 1;
    const payerEmail = String(
      data.payerEmail ?? request.auth?.token?.email ?? ""
    ).trim();

    if (!greetingRequestId || !token || !paymentMethodId) {
      throw new HttpsError("invalid-argument", "Faltan datos de pago.");
    }
    if (!payerEmail) {
      throw new HttpsError("invalid-argument", "Falta el correo del pagador.");
    }

    const ref = db.doc(`greetingRequests/${greetingRequestId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Solicitud no encontrada.");
    const gr = snap.data() ?? {};

    if (gr.buyerId !== uid) {
      throw new HttpsError("permission-denied", "No eres el comprador de esta solicitud.");
    }
    if (gr.paymentStatus === "paid") {
      throw new HttpsError("failed-precondition", "Esta solicitud ya está pagada.");
    }
    if (gr.paymentStatus !== "awaiting_payment") {
      throw new HttpsError("failed-precondition", "Esta solicitud no está lista para pago.");
    }

    const gross = Number(gr.priceSnapshot);
    if (!Number.isFinite(gross) || gross <= 0) {
      throw new HttpsError("failed-precondition", "Precio inválido para esta solicitud.");
    }

    const externalReference = `greetingRequest__${greetingRequestId}`;

    // Registra el intento (pending) ANTES de llamar a MP, para no perder rastro
    // si algo falla a mitad.
    await upsertPaymentIntentStatus(externalReference, {
      serviceType: gr.type === "consejo" ? "advice" : "greeting",
      sourceType: "greetingRequest",
      sourceId: greetingRequestId,
      buyerId: uid,
      creatorId: gr.creatorId ?? null,
      grossAmount: gross,
      currency: MP_CURRENCY,
      status: "pending",
      mpOrderId: null,
      mpPaymentId: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Idempotency key por intento: evita doble cargo si el cliente reintenta la
    // MISMA llamada por red. (Un pago ya aprobado se bloquea antes, arriba.)
    const idempotencyKey = crypto.randomUUID();

    const res = await mpFetch<OrderResponse>("/v1/orders", {
      method: "POST",
      idempotencyKey,
      body: {
        type: "online",
        processing_mode: "automatic",
        total_amount: money(gross),
        external_reference: externalReference,
        payer: { email: payerEmail },
        transactions: {
          payments: [
            {
              amount: money(gross),
              payment_method: {
                id: paymentMethodId,
                type: paymentType,
                token,
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
      logger.error("payGreeting order_failed", {
        greetingRequestId,
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

    logger.info("payGreeting processed", {
      greetingRequestId,
      orderId: order?.id,
      normalized,
    });

    return {
      status: normalized, // approved | pending | rejected | unknown
      orderId: order?.id ?? null,
      statusDetail: payment?.status_detail ?? order?.status_detail ?? null,
    };
  }
);
