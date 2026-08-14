// stripeHealthcheck — smoke test de Stripe (S1).
//
// Hace UNA llamada real (GET /v1/balance) para confirmar que STRIPE_SECRET_KEY
// funciona y en qué modo (test/live) está. No mueve dinero.
//
// Gate: solo un moderador de plataforma (igual que facturapiHealthcheck).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { stripeFetch, isStripeTestMode, stripeSecretKey } from "./stripeClient";
import { requirePlatformMod } from "../../authz";

const REGION = "us-central1";

type StripeBalance = {
  livemode?: boolean;
  available?: Array<{ currency?: string; amount?: number }>;
};

export const stripeHealthcheck = onCall(
  { region: REGION, secrets: [stripeSecretKey] },
  async (request) => {
    requirePlatformMod(request);
    const res = await stripeFetch<StripeBalance>("/balance");
    if (!res.ok) {
      logger.error("stripeHealthcheck failed", { status: res.status, error: res.error.slice(0, 200) });
      throw new HttpsError("internal", `Stripe no respondió (${res.status}): ${res.error.slice(0, 200)}`);
    }
    const mode = isStripeTestMode() ? "test" : "live";
    logger.info("stripeHealthcheck", { mode, livemode: res.data.livemode });
    return {
      ok: true,
      mode,
      livemode: res.data.livemode ?? null,
      currencies: (res.data.available ?? []).map((a) => a.currency).filter(Boolean),
    };
  }
);
