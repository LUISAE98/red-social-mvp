// Tasas de cambio reales: una tarea programada trae las tasas de una fuente
// gratuita (sin API key) y las guarda en un solo doc `config/exchangeRates` que
// todo el frontend lee. Base = USD (ancla). rates[X] = unidades de X por 1 USD.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// 15 monedas de LatAm (17 países; EC/SV/PA comparten USD) + 7 de la UE
// (27 países; 21 usan EUR) + 3 de Europa no comunitaria + 13 de Asia-Pacífico y
// Medio Oriente. Total 38.
// ⚠️ COPIA MANUAL: debe quedar IDÉNTICA a DISPLAY_CURRENCIES de
// lib/currency/catalog.ts. Una moneda que falte aquí no se refresca y su precio
// sale en null en todo el frontend.
const DISPLAY_CURRENCIES = [
  "MXN",
  "ARS",
  "BOB",
  "BRL",
  "CLP",
  "COP",
  "CRC",
  "GTQ",
  "HNL",
  "NIO",
  "PEN",
  "PYG",
  "DOP",
  "UYU",
  "USD",
  // --- Unión Europea ---
  "EUR",
  "CZK",
  "DKK",
  "HUF",
  "PLN",
  "RON",
  "SEK",
  // --- Europa NO comunitaria ---
  "NOK",
  "ISK",
  "BAM",
  // --- Asia-Pacífico y Medio Oriente ---
  "JPY",
  "SGD",
  "AUD",
  "NZD",
  "HKD",
  "TWD",
  "THB",
  "MYR",
  "PHP",
  "IDR",
  "QAR",
  "KWD",
  "JOD",
];

// Fuente gratuita y sin clave. Devuelve { result, base_code: "USD", rates: { MXN: n, ... } }
// donde rates[X] = cuántas unidades de X equivalen a 1 USD (justo lo que guardamos).
const RATES_URL = "https://open.er-api.com/v6/latest/USD";

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
  rates.USD = 1; // el ancla siempre vale 1

  await db.doc("config/exchangeRates").set(
    {
      base: "USD",
      rates,
      source: "live",
      provider: "open.er-api.com",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info("exchangeRates updated", { count: Object.keys(rates).length });
}
