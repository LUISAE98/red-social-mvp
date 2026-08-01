// S3a — Crea un PaymentIntent para la pasarela de Stripe.
//
// DEMO/prueba: monto en MXN, capado por seguridad, gate de moderador. Al cablear
// servicios reales, el monto se derivará DEL SERVIDOR (precio del servicio) y se
// abrirá a cualquier comprador; este callable es el andamio para probar la UI.
//
// `saveCard` → setup_future_usage: "off_session" (guarda el PaymentMethod en el
// Customer para cobros de un clic / recurrentes SIN CVV después).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { getOrCreateStripeCustomer } from "./stripeCustomer";

const REGION = "us-central1";

type PaymentIntent = { id: string; client_secret: string };

export const createStripePaymentIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    if (request.auth?.token?.role !== "moderator") {
      throw new HttpsError("permission-denied", "Solo un moderador (fase de prueba).");
    }

    const data = (request.data ?? {}) as { amount?: unknown; saveCard?: unknown };
    let amount = Math.round(Number(data.amount) || 0); // MXN (pesos)
    if (!(amount > 0)) amount = 50;
    if (amount > 500) amount = 500; // tope de seguridad en la fase de prueba
    const saveCard = data.saveCard === true;
    const email = request.auth?.token?.email ?? null;

    const customerId = await getOrCreateStripeCustomer(uid, email);

    const res = await stripeFetch<PaymentIntent>("/payment_intents", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      form: {
        amount: amount * 100, // centavos
        currency: "mxn",
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
      },
    });
    if (!res.ok) {
      throw new HttpsError("internal", `No se pudo crear el PaymentIntent (${res.status}): ${res.error.slice(0, 200)}`);
    }
    return { clientSecret: res.data.client_secret, customerId };
  }
);
