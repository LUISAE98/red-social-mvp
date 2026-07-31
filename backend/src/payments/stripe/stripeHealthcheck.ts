// stripeHealthcheck — smoke test de Stripe (S1).
//
// Hace UNA llamada real (balance.retrieve) para confirmar que STRIPE_SECRET_KEY
// funciona y en qué modo (test/live) está. No mueve dinero.
//
// Gate: solo un moderador de plataforma (igual que facturapiHealthcheck).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getStripe, isStripeTestMode, stripeSecretKey } from "./stripeClient";

const REGION = "us-central1";

export const stripeHealthcheck = onCall(
  { region: REGION, secrets: [stripeSecretKey] },
  async (request) => {
    if (request.auth?.token?.role !== "moderator") {
      throw new HttpsError("permission-denied", "Solo un moderador puede ejecutar esto.");
    }
    try {
      const stripe = getStripe();
      const balance = await stripe.balance.retrieve();
      const mode = isStripeTestMode() ? "test" : "live";
      logger.info("stripeHealthcheck", { mode, livemode: balance.livemode });
      return {
        ok: true,
        mode,
        livemode: balance.livemode,
        currencies: balance.available.map((a) => a.currency),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("stripeHealthcheck failed", { err: msg });
      throw new HttpsError("internal", `Stripe no respondió: ${msg}`);
    }
  }
);
