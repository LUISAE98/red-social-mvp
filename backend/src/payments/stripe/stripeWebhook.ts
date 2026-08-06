// S4 — Webhook de Stripe. Recibe los eventos (pago aprobado, reembolso, etc.) y los
// procesa: es lo que convierte un cobro en una compra real (más adelante materializa
// el doc de dominio + ledger, según la metadata del PaymentIntent).
//
// Seguridad: verifica la FIRMA de Stripe a mano (HMAC-SHA256), SIN el SDK. Idempotente
// (guarda event.id procesados). Responde 200 rápido; si falla, 500 y Stripe reintenta.
//
// Reemplaza a `mpWebhook`. El signing secret (whsec_...) va en STRIPE_WEBHOOK_SECRET.

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { applyApprovedPaymentToSource, upsertPaymentIntentStatus } from "../reconcile";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { reconcileStripeSubscriptionEvent } from "./groupSubscriptionStripeSync";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

// Guarda la referencia de la tarjeta del comprador (solo referencias: marca + últimos 4;
// Stripe custodia el dato sensible). Se llama cuando un pago se aprobó con
// `setup_future_usage` (el comprador pidió guardarla). Con esto sus próximos cobros son
// "un clic" off-session (sin CVV). Best-effort: si algo falla, solo se loguea.
async function persistSavedCard(buyerId: string, stripeCustomerId: string, pmId: string): Promise<void> {
  const res = await stripeFetch<{ id?: string; card?: { brand?: string; last4?: string } }>(
    `/payment_methods/${pmId}`
  );
  if (!res.ok) return;
  const card = res.data.card ?? {};
  const brand = typeof card.brand === "string" ? card.brand : null;
  const lastFour = typeof card.last4 === "string" ? card.last4 : null;
  const brandName = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : null;
  await db.doc(`users/${buyerId}/paymentMethods/${pmId}`).set(
    {
      buyerId,
      stripeCustomerId,
      stripePaymentMethodId: pmId,
      brand,
      brandName,
      lastFour,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// Verifica la firma del header `Stripe-Signature` (formato "t=...,v1=...").
function verifySignature(rawBody: Buffer, sigHeader: string, secret: string): boolean {
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  // Tolerancia de 5 min contra replays.
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > 300) return false;
  const signedPayload = `${t}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export const stripeWebhook = onRequest(
  { region: REGION, secrets: [stripeWebhookSecret, stripeSecretKey], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("method not allowed");
      return;
    }
    const secret = stripeWebhookSecret.value().trim();
    const sig = req.headers["stripe-signature"];
    const raw = req.rawBody; // Buffer con el cuerpo crudo (necesario para la firma).
    if (!secret) {
      logger.error("stripeWebhook: falta STRIPE_WEBHOOK_SECRET");
      res.status(500).send("no secret");
      return;
    }
    if (!sig || typeof sig !== "string" || !raw || !verifySignature(raw, sig, secret)) {
      res.status(400).send("invalid signature");
      return;
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(raw.toString("utf8")) as StripeEvent;
    } catch {
      res.status(400).send("bad json");
      return;
    }

    // Idempotencia: si ya procesamos este evento, 200 y salir.
    const evRef = db.collection("stripeEvents").doc(event.id);
    if ((await evRef.get()).exists) {
      res.status(200).send("duplicate");
      return;
    }

    try {
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as { id?: string; amount?: number; currency?: string; status?: string; customer?: string; payment_method?: string; setup_future_usage?: string; metadata?: Record<string, unknown> };
        if (pi.id) {
          await db.collection("stripePayments").doc(pi.id).set(
            {
              paymentIntentId: pi.id,
              amount: pi.amount ?? null,
              currency: pi.currency ?? null,
              status: pi.status ?? null,
              customer: pi.customer ?? null,
              metadata: pi.metadata ?? {},
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        // Materializa la compra (crea el saludo/sesión + suma al ledger) usando el
        // externalReference de la metadata. Reusa TODA la lógica de MP (reconcile).
        const externalReference = String(pi.metadata?.externalReference ?? "").trim();
        if (externalReference) {
          await applyApprovedPaymentToSource(externalReference, { mpOrderId: null, mpPaymentId: pi.id ?? null });
          await upsertPaymentIntentStatus(externalReference, { status: "paid" });
          logger.info("stripeWebhook materialized", { externalReference, id: pi.id });
        } else {
          logger.info("stripeWebhook payment sin externalReference (prueba suelta)", { id: pi.id });
        }

        // Si el comprador pidió guardar su tarjeta (setup_future_usage), persistimos la
        // referencia para habilitar el cobro "un clic" off-session en la próxima compra.
        try {
          const buyerId = String(pi.metadata?.buyerId ?? "").trim();
          if (pi.setup_future_usage && pi.payment_method && pi.customer && buyerId) {
            await persistSavedCard(buyerId, pi.customer, pi.payment_method);
            logger.info("stripeWebhook saved card", { buyerId, pm: pi.payment_method });
          }
        } catch (e) {
          logger.warn("stripeWebhook no pudo guardar la tarjeta", { err: e instanceof Error ? e.message : String(e) });
        }
      } else if (
        event.type === "invoice.paid" ||
        event.type === "invoice.payment_succeeded" ||
        event.type === "invoice.payment_failed" ||
        event.type === "customer.subscription.deleted" ||
        event.type === "customer.subscription.updated"
      ) {
        // Suscripción MENSUAL a comunidad (Stripe Billing): renovación/baja/gracia.
        await reconcileStripeSubscriptionEvent(event.type, event.data.object);
      } else {
        // Otros eventos (payment_intent.payment_failed, charge.refunded, etc.): por
        // ahora solo se registran; se manejan al cablear servicios/reembolsos.
        logger.info("stripeWebhook event", { type: event.type, id: event.id });
      }

      await evRef.set({ type: event.type, processedAt: admin.firestore.FieldValue.serverTimestamp() });
      res.status(200).send("ok");
    } catch (err) {
      logger.error("stripeWebhook handler failed", { type: event.type, err: err instanceof Error ? err.message : String(err) });
      res.status(500).send("error"); // Stripe reintenta.
    }
  }
);
