// S2 — Cobro de prueba con Stripe Checkout (página hospedada por Stripe).
//
// Crea una Checkout Session y devuelve su URL; el frontend redirige ahí. Prueba el
// cobro de punta a punta SIN manejar tarjetas (PCI lo cubre Stripe) y sin SDK de
// frontend. Monto fijo de prueba ($50 MXN). Gate: moderador (es diagnóstico).
//
// El siguiente paso (S2b/S3) es cablearlo a un servicio real y a guardar tarjeta.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import { stripeFetch, stripeSecretKey } from "./stripeClient";

const REGION = "us-central1";

type CheckoutSession = { id: string; url: string };

export const createStripeCheckoutSession = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    if (request.auth?.token?.role !== "moderator") {
      throw new HttpsError("permission-denied", "Solo un moderador puede ejecutar esto.");
    }

    // Origen para las URLs de retorno (lo manda el frontend; fallback al dominio).
    const rawOrigin = String((request.data as { origin?: unknown })?.origin ?? "").trim();
    const origin = /^https?:\/\//.test(rawOrigin) ? rawOrigin : "https://vibraon.com";

    // Monto en la unidad mínima (centavos): $50.00 MXN = 5000.
    const res = await stripeFetch<CheckoutSession>("/checkout/sessions", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      form: {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "mxn",
              unit_amount: 5000,
              product_data: { name: "Prueba de cobro Vibra" },
            },
          },
        ],
        success_url: `${origin}/stripe-test?pago=ok`,
        cancel_url: `${origin}/stripe-test?pago=cancelado`,
      },
    });

    if (!res.ok) {
      throw new HttpsError("internal", `No se pudo crear la sesión de pago (${res.status}): ${res.error.slice(0, 200)}`);
    }
    return { url: res.data.url };
  }
);
