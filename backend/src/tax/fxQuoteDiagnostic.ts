// Diagnóstico de la FX Quotes API. NO mueve dinero: pregunta el tipo de cambio.
//
// POR QUÉ EXISTE SEPARADO DE `stripeHealthcheck`
// El healthcheck exige claim de moderador de plataforma, y hoy la cuenta de administrador
// no está entrando con ese claim. Como esto es una consulta de solo lectura que no revela
// secretos —el tipo de cambio y las comisiones de Stripe son información pública de su
// tarifario— basta con exigir sesión iniciada.
//
// 🔒 Deliberadamente NO devuelve el saldo de la cuenta ni su modo live/test: eso sí es
// información interna y vive en `stripeHealthcheck`, detrás del claim de moderador.
//
// ⚠️ TEMPORAL. Cuando el claim de administrador vuelva a funcionar, esto se borra y se usa
// el healthcheck. Mientras tanto es la única forma de saber si la API está habilitada.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { stripeSecretKey } from "../payments/stripe/stripeClient";
import { getFxQuote } from "./fxQuotes";
import { SETTLEMENT_CURRENCY } from "../wallet/ledger";

const REGION = "us-central1";

/** Monedas que se consultan. Se prueban varias porque el acceso puede variar por par. */
const MONEDAS = ["MXN", "EUR", "BRL"];

export const fxQuoteDiagnostic = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const resultados: Record<string, unknown> = {};
    for (const moneda of MONEDAS) {
      try {
        const q = await getFxQuote(moneda, SETTLEMENT_CURRENCY);
        resultados[moneda] = q
          ? {
              disponible: true,
              // Cuántas unidades de la moneda de liquidación vale 1 de ésta.
              tasa: q.baseRate,
              // La inversa, que es como la lee un humano: cuántos MXN por 1 USD.
              porUnidadLiquidacion: Math.round((1 / q.baseRate) * 10000) / 10000,
              comisionStripe: q.fxFeeRate,
              costoCandado: q.durationPremium,
              proveedorReferencia: q.referenceProvider,
            }
          : { disponible: false };
      } catch (e) {
        resultados[moneda] = {
          disponible: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    const algunaDisponible = Object.values(resultados).some(
      (r) => (r as { disponible?: boolean }).disponible === true
    );

    logger.info("fxQuoteDiagnostic", { uid: request.auth.uid, algunaDisponible });
    return { settlementCurrency: SETTLEMENT_CURRENCY, algunaDisponible, monedas: resultados };
  }
);
