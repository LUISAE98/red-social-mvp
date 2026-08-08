// updateVatRates — vigilante diario de las tasas de impuesto al consumo.
//
// DOS FUENTES, CON JERARQUÍA
//   1. **VATcomply** (`api.vatcomply.com/vat_rates`) — sirve **TEDB**, la base de datos oficial
//      de la Comisión Europea. Es el dato del regulador. Cubre los 27 de la UE.
//   2. **TaxID** (`taxid.dev/api/v1/rates`) — recopilación de un tercero, ~100 países.
//      Cubre todo lo demás: LatAm, Asia, África, Norteamérica, Europa no comunitaria.
//
// Cuando un país está en las dos, **gana TEDB**: es fuente oficial, la otra es recopilación.
// Ambas son públicas, gratuitas y sin llave.
//
// ⚠️ ESTE FEED NUNCA CAMBIA LO QUE SE COBRA.
// Escribe a un documento INFORMATIVO (`config/vatRates`) y compara contra la tabla de
// `tax/config.ts`. Si difieren, lo registra y lo deja marcado para revisión humana.
//
// La razón es de seguridad: si el feed escribiera directo en COUNTRY_TAX_CONFIG, un tercero
// gratuito y sin contrato podría alterar lo que se le cobra a los compradores. Un error suyo
// se volvería un error fiscal de Vibra, en producción, sin que nadie se entere. La regla de
// `impuestos.md` §5 lo dice: la tasa vive en configuración versionada y aprobada.
//
// Mismo patrón que `updateExchangeRates`: una llamada diaria, cacheada en Firestore.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { COUNTRY_TAX_CONFIG } from "./tax/config";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

const TEDB_URL = "https://api.vatcomply.com/vat_rates";
const TAXID_URL = "https://www.taxid.dev/api/v1/rates";

/**
 * TEDB y TaxID publican Grecia como "EL" (el código estadístico de la UE). El ISO-3166
 * alpha-2 es "GR", que es el que usa todo el resto del sistema.
 */
const TEDB_TO_ISO: Readonly<Record<string, string>> = { EL: "GR" };

export type RateSource = "tedb" | "taxid";

export type FeedRate = {
  /** Tasa DECIMAL (0.21), no porcentaje. */
  rate: number;
  currency: string;
  name: string;
  /** Qué fuente aportó el dato. `tedb` es oficial; `taxid` es recopilación de tercero. */
  source: RateSource;
  /** Nombre del impuesto tal como lo reporta la fuente (vat, gst, consumption_tax…). */
  taxType?: string;
};

export type VatRateDrift = {
  country: string;
  configuredRate: number;
  feedRate: number;
  source: RateSource;
};

function toIso(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) return null;
  return TEDB_TO_ISO[clean] ?? clean;
}

/** Compara con tolerancia para no reportar ruido de coma flotante. */
function ratesDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.0001;
}

/** Los 27 de la UE desde TEDB (vía VATcomply). Fuente OFICIAL. */
async function fetchTedb(): Promise<Record<string, FeedRate>> {
  const out: Record<string, FeedRate> = {};
  const res = await fetch(TEDB_URL);
  if (!res.ok) {
    logger.error("updateVatRates: TEDB respondió mal", { status: res.status });
    return out;
  }

  const payload = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(payload)) {
    logger.error("updateVatRates: respuesta de TEDB inesperada");
    return out;
  }

  for (const row of payload) {
    if (row.member_state !== true) continue; // solo los 27
    const iso = toIso(row.country_code);
    const rate = typeof row.standard_rate === "number" ? row.standard_rate : null;
    if (!iso || rate === null) continue;

    out[iso] = {
      rate: rate / 100, // publican 21.0; el sistema usa 0.21
      currency: typeof row.currency === "string" ? row.currency : "EUR",
      name: typeof row.country_name === "string" ? row.country_name : iso,
      source: "tedb",
      taxType: "vat",
    };
  }
  return out;
}

/** ~100 países desde TaxID. Recopilación de tercero: sirve de referencia, no de autoridad. */
async function fetchTaxId(): Promise<Record<string, FeedRate>> {
  const out: Record<string, FeedRate> = {};
  const res = await fetch(TAXID_URL);
  if (!res.ok) {
    logger.error("updateVatRates: TaxID respondió mal", { status: res.status });
    return out;
  }

  const payload = (await res.json()) as { rates?: Array<Record<string, unknown>> };
  const rows = payload?.rates;
  if (!Array.isArray(rows)) {
    logger.error("updateVatRates: respuesta de TaxID inesperada");
    return out;
  }

  for (const row of rows) {
    const iso = toIso(row.country_code);
    // Hong Kong, Catar y Kuwait no tienen impuesto al consumo → standard_rate null o 0.
    const rate = typeof row.standard_rate === "number" ? row.standard_rate : null;
    if (!iso || rate === null) continue;

    out[iso] = {
      rate: rate / 100,
      currency: typeof row.currency === "string" ? row.currency : "",
      name: typeof row.country_name === "string" ? row.country_name : iso,
      source: "taxid",
      taxType: typeof row.tax_type === "string" ? row.tax_type : undefined,
    };
  }
  return out;
}

export async function updateVatRatesHandler(): Promise<void> {
  const [tedb, taxid] = await Promise.all([fetchTedb(), fetchTaxId()]);

  // Merge con jerarquía: TaxID rellena el mundo, TEDB pisa a TaxID en la UE porque es oficial.
  const feed: Record<string, FeedRate> = { ...taxid, ...tedb };

  const tedbCount = Object.keys(tedb).length;
  const taxidCount = Object.keys(taxid).length;

  // La UE tiene 27 miembros. Si TEDB trae otra cosa, algo cambió (adhesión, salida, o el
  // formato de la API) y hay que mirarlo antes de confiar en el resto.
  if (tedbCount !== 27) {
    logger.warn("updateVatRates: TEDB no trae 27 miembros", { tedbCount });
  }
  if (taxidCount === 0) {
    logger.warn("updateVatRates: TaxID no devolvió países");
  }

  // ── Comparar contra lo que realmente se cobra ──
  const drift: VatRateDrift[] = [];
  const configuredWithoutFeed: string[] = [];

  for (const [iso, cfg] of Object.entries(COUNTRY_TAX_CONFIG)) {
    const found = feed[iso];
    if (!found) {
      configuredWithoutFeed.push(iso);
      continue;
    }
    if (ratesDiffer(cfg.taxRate, found.rate)) {
      drift.push({
        country: iso,
        configuredRate: cfg.taxRate,
        feedRate: found.rate,
        source: found.source,
      });
    }
  }

  if (drift.length > 0) {
    // Esto exige acción humana: verificar el cambio y editar la tabla a mano.
    logger.error("🔴 updateVatRates: TASAS DESALINEADAS — revisar y actualizar tax/config.ts", {
      drift,
    });
  }

  if (configuredWithoutFeed.length > 0) {
    // Un país que cobramos y ninguna fuente reporta: no se puede vigilar su tasa.
    logger.warn("updateVatRates: países configurados que ninguna fuente cubre", {
      configuredWithoutFeed,
    });
  }

  await db.collection("config").doc("vatRates").set({
    sources: {
      tedb: { url: TEDB_URL, countries: tedbCount, note: "Oficial — Comisión Europea (TEDB)" },
      taxid: { url: TAXID_URL, countries: taxidCount, note: "Recopilación de tercero" },
    },
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    countries: Object.keys(feed).length,
    rates: feed,
    // Lo que hay que revisar a mano. Vacío = la config coincide con las fuentes.
    drift,
    configuredWithoutFeed,
    note:
      "INFORMATIVO. El cobro usa COUNTRY_TAX_CONFIG (backend/src/tax/config.ts), no este doc. " +
      "Si `drift` no está vacío, verificar el cambio y editar la tabla a mano. " +
      "Las tasas de `taxid` NO son fuente oficial: confirmar contra la autoridad del país " +
      "antes de habilitar el cobro ahí. Ver impuestos.md.",
  });

  logger.info("updateVatRates finished", {
    total: Object.keys(feed).length,
    tedb: tedbCount,
    taxid: taxidCount,
    driftCount: drift.length,
  });
}
