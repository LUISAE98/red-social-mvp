// Tasas de cambio reales: una tarea programada trae las tasas de una fuente
// gratuita (sin API key) y las guarda en un solo doc `config/exchangeRates` que
// todo el frontend lee. Base = MXN (ancla). rates[X] = unidades de X por 1 MXN.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// Las 26 monedas de visualización del lanzamiento (continente americano, sin SRD).
const DISPLAY_CURRENCIES = [
  "MXN",
  "ARS",
  "BRL",
  "CLP",
  "COP",
  "PEN",
  "UYU",
  "USD",
  "CAD",
  "BSD",
  "BBD",
  "BZD",
  "BOB",
  "CRC",
  "CUP",
  "XCD",
  "GTQ",
  "GYD",
  "HTG",
  "HNL",
  "JMD",
  "NIO",
  "PYG",
  "DOP",
  "TTD",
  "VES",
];

// Fuente gratuita y sin clave. Devuelve { result, base_code: "MXN", rates: { USD: n, ... } }
// donde rates[X] = cuántas unidades de X equivalen a 1 MXN (justo lo que guardamos).
const RATES_URL = "https://open.er-api.com/v6/latest/MXN";

export async function updateExchangeRatesHandler(): Promise<void> {
  const res = await fetch(RATES_URL);
  if (!res.ok) {
    throw new Error(`rates fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    result?: string;
    base_code?: string;
    rates?: Record<string, number>;
  };
  if (data.result !== "success" || !data.rates) {
    throw new Error("rates payload invalid");
  }

  const rates: Record<string, number> = {};
  for (const code of DISPLAY_CURRENCIES) {
    const r = data.rates[code];
    if (typeof r === "number" && Number.isFinite(r) && r > 0) {
      rates[code] = r;
    }
  }
  rates.MXN = 1; // el ancla siempre vale 1

  await db.doc("config/exchangeRates").set(
    {
      base: "MXN",
      rates,
      source: "live",
      provider: "open.er-api.com",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info("exchangeRates updated", { count: Object.keys(rates).length });
}
