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
import { getFxQuote } from "../../tax/fxQuotes";
import { SETTLEMENT_CURRENCY } from "../../wallet/ledger";

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

    // ¿La cuenta tiene acceso a la FX Quotes API? Está en PREVIEW, así que puede no estar
    // habilitada. Se comprueba con una cotización real: si falla, el cobro sigue funcionando
    // (cae a `config/exchangeRates`) pero SIN candado de tasa, y eso hay que saberlo.
    let fx: Record<string, unknown>;
    try {
      const q = await getFxQuote("MXN", SETTLEMENT_CURRENCY);
      fx = q
        ? {
            disponible: true,
            tasa: q.baseRate,
            comisionStripe: q.fxFeeRate,
            costoCandado: q.durationPremium,
            proveedorReferencia: q.referenceProvider,
          }
        : { disponible: false, nota: "Stripe no devolvió cotización; revisa los logs de getFxQuote" };
    } catch (e) {
      fx = { disponible: false, error: e instanceof Error ? e.message : String(e) };
    }

    logger.info("stripeHealthcheck", { mode, livemode: res.data.livemode, fx });
    return {
      ok: true,
      mode,
      livemode: res.data.livemode ?? null,
      currencies: (res.data.available ?? []).map((a) => a.currency).filter(Boolean),
      fxQuotes: fx,
    };
  }
);
