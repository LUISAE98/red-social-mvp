// updateVatRates — vigilante diario de las tasas de IVA de la Unión Europea.
//
// FUENTE: VATcomply (`https://api.vatcomply.com/vat_rates`), API pública, gratuita y sin
// llave, que sirve las tasas de **TEDB** — la base de datos oficial de la Comisión Europea.
// Es el dato del regulador, no la recopilación de un tercero.
//
// ⚠️ ESTE FEED NUNCA CAMBIA LO QUE SE COBRA.
// Escribe a un documento INFORMATIVO (`config/vatRates`) y compara contra la tabla de
// `tax/config.ts`. Si difieren, lo registra y lo deja marcado para revisión humana.
//
// La razón es de seguridad, no de estilo: si el feed escribiera directo en COUNTRY_TAX_CONFIG,
// un tercero gratuito y sin contrato podría alterar lo que se le cobra a los compradores. Un
// error suyo se volvería un error fiscal de Vibra, en producción, sin que nadie se entere.
// La regla de `impuestos.md` §5 lo dice: la tasa vive en configuración versionada y aprobada.
//
// Mismo patrón que `updateExchangeRates`: una llamada diaria, cacheada en Firestore, y todo
// el resto del sistema lee el doc cacheado.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { COUNTRY_TAX_CONFIG } from "./tax/config";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

const VAT_RATES_URL = "https://api.vatcomply.com/vat_rates";

/**
 * TEDB (y por tanto VATcomply) publica Grecia como "EL", que es el código estadístico de la
 * UE. El ISO-3166 alpha-2 es "GR", que es el que usa todo el resto del sistema.
 */
const TEDB_TO_ISO: Readonly<Record<string, string>> = { EL: "GR" };

type VatComplyRow = {
  country_code?: unknown;
  country_name?: unknown;
  standard_rate?: unknown;
  currency?: unknown;
  member_state?: unknown;
};

export type VatRateDrift = {
  country: string;
  configuredRate: number;
  feedRate: number;
};

function toIso(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) return null;
  return TEDB_TO_ISO[clean] ?? clean;
}

/** Compara con tolerancia de centésima de punto para no reportar ruido de coma flotante. */
function ratesDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.0001;
}

export async function updateVatRatesHandler(): Promise<void> {
  const res = await fetch(VAT_RATES_URL);
  if (!res.ok) {
    logger.error("updateVatRates: VATcomply respondió mal", { status: res.status });
    return;
  }

  const payload = (await res.json()) as VatComplyRow[];
  if (!Array.isArray(payload)) {
    logger.error("updateVatRates: respuesta inesperada (no es array)");
    return;
  }

  const feed: Record<string, { rate: number; currency: string; name: string }> = {};

  for (const row of payload) {
    if (row.member_state !== true) continue; // solo los 27 de la UE
    const iso = toIso(row.country_code);
    const rate = typeof row.standard_rate === "number" ? row.standard_rate : null;
    if (!iso || rate === null) continue;

    feed[iso] = {
      rate: rate / 100, // VATcomply publica 21.0; el sistema usa 0.21
      currency: typeof row.currency === "string" ? row.currency : "EUR",
      name: typeof row.country_name === "string" ? row.country_name : iso,
    };
  }

  const feedCount = Object.keys(feed).length;

  // La UE tiene 27 miembros. Si el feed trae otra cosa, algo cambió (adhesión, salida, o el
  // formato de la API) y hay que mirarlo antes de confiar en el resto.
  if (feedCount !== 27) {
    logger.warn("updateVatRates: el feed no trae 27 miembros", { feedCount });
  }

  // ── Comparar contra lo que realmente se cobra ──
  const drift: VatRateDrift[] = [];
  const missingInConfig: string[] = [];

  for (const [iso, data] of Object.entries(feed)) {
    const configured = COUNTRY_TAX_CONFIG[iso];
    if (!configured) {
      missingInConfig.push(iso);
      continue;
    }
    if (ratesDiffer(configured.taxRate, data.rate)) {
      drift.push({
        country: iso,
        configuredRate: configured.taxRate,
        feedRate: data.rate,
      });
    }
  }

  if (drift.length > 0) {
    // Esto exige acción humana: alguien tiene que verificar el cambio y editar la tabla.
    logger.error("🔴 updateVatRates: TASAS DESALINEADAS — revisar y actualizar tax/config.ts", {
      drift,
    });
  }

  if (missingInConfig.length > 0) {
    logger.warn("updateVatRates: países de la UE en el feed sin fila en la config", {
      missingInConfig,
    });
  }

  await db.collection("config").doc("vatRates").set({
    source: "VATcomply / TEDB (Comisión Europea)",
    url: VAT_RATES_URL,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    memberStates: feedCount,
    rates: feed,
    // Lo que hay que revisar a mano. Vacío = la config coincide con la fuente oficial.
    drift,
    missingInConfig,
    // Recordatorio grabado en el propio dato, para quien lo lea desde la consola.
    note:
      "INFORMATIVO. El cobro usa COUNTRY_TAX_CONFIG (backend/src/tax/config.ts), no este doc. " +
      "Si `drift` no está vacío, verificar el cambio y editar la tabla a mano. Ver impuestos.md.",
  });

  logger.info("updateVatRates finished", {
    memberStates: feedCount,
    driftCount: drift.length,
    missingCount: missingInConfig.length,
  });
}
