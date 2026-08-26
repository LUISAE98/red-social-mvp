// Tipo de cambio de STRIPE, con candado de 1 hora (FX Quotes API).
//
// EL PROBLEMA QUE RESUELVE
// Hasta ahora la conversión a la moneda del comprador usaba `config/exchangeRates`, que se
// llena a diario desde `open.er-api.com`. Pero quien convierte de verdad —y cobra por ello—
// es Stripe, con SU tasa. Eran dos fuentes distintas, y la diferencia entre ambas salía del
// margen sin que nadie la midiera: por eso el 2% que se le cobra al comprador cargaba un
// colchón puesto a ojo.
//
// Con esta API se le pregunta a Stripe su tasa real y, de paso, se la congela: el precio que
// se le muestra al comprador es exactamente el que se va a convertir al liquidar.
//
// QUÉ DEVUELVE STRIPE
//   · base_rate       — la tasa sin su comisión de conversión
//   · exchange_rate   — la tasa CON su comisión ya incorporada
//   · fx_fee_rate     — el porcentaje exacto que está cobrando (≈1% en cuenta de EE. UU.)
//   · duration_premium— lo que cuesta congelar (0.15% a una hora, para pesos)
//
// 🚨 Se usa `base_rate`, NO `exchange_rate`. El modelo de precio (ver docs/stripe-integracion.md §5)
// ya le cobra al comprador un 2% explícito que cubre la comisión de Stripe; convertir además
// con `exchange_rate` —que la trae dentro— se la cobraría DOS veces.
//
// ⚠️ La API está en PREVIEW: exige el header `Stripe-Version` y puede cambiar sin aviso. Si
// falla, NO se rompe el cobro: el llamador cae a `config/exchangeRates`.

import { logger } from "firebase-functions";
import { stripeFetch, STRIPE_PREVIEW_VERSION } from "../payments/stripe/stripeClient";

/** Versión preview que expone `/v1/fx_quotes`. */
const FX_API_VERSION = STRIPE_PREVIEW_VERSION;

/**
 * Duración del candado. Una hora cubre de sobra un checkout (minutos) y cuesta 0.15% para
 * pesos, contra 0.30% de las 24 horas — que serían 23 horas que no se usan.
 */
const LOCK_DURATION = "hour";

/**
 * Margen antes de que expire con el que se deja de reutilizar una cotización cacheada.
 * Sin él, una cotización a punto de vencer se adjunta a un PaymentIntent que se confirma
 * un minuto después y Stripe la rechaza con `payment_intent_fx_quote_invalid`.
 */
const MARGEN_EXPIRACION_MS = 5 * 60 * 1000;

export type FxQuote = {
  /** `fxq_...` — se adjunta al PaymentIntent para que liquide a esta tasa. */
  id: string;
  /** Cuántas unidades de la moneda de liquidación vale 1 de la de presentación. */
  baseRate: number;
  /** La misma tasa pero con la comisión de Stripe dentro. Se guarda para conciliar. */
  exchangeRate: number;
  /** Comisión de conversión REAL de Stripe. El dato que antes se estimaba a ciegas. */
  fxFeeRate: number;
  /** Lo que costó congelar. */
  durationPremium: number;
  /** De dónde sale la referencia de Stripe (p. ej. `ecb`). */
  referenceProvider: string | null;
  expiresAtMs: number;
};

type FxQuoteResponse = {
  id?: string;
  lock_expires_at?: number;
  lock_status?: string;
  rates?: Record<
    string,
    {
      exchange_rate?: number;
      rate_details?: {
        base_rate?: number;
        duration_premium?: number;
        fx_fee_rate?: number;
        reference_rate_provider?: string;
      };
    }
  >;
};

/**
 * Cotizaciones vivas por moneda, reutilizadas mientras siguen dentro de su hora.
 *
 * Las instancias de Cloud Functions se reciclan entre peticiones, así que este caché sirve a
 * varias compras. Es justo el uso previsto: una cotización por hora y por moneda, no una por
 * transacción. Reutilizar no ahorra el premium —va dentro de la tasa— pero sí evita una
 * llamada de red en cada cobro.
 */
const cache = new Map<string, FxQuote>();

/**
 * Pide (o reutiliza) la cotización de Stripe para convertir de `presentmentCurrency` a
 * `settlementCurrency`. Devuelve `null` si la API falla: el llamador debe caer a la tabla
 * de tasas cacheadas antes que dejar de cobrar.
 */
export async function getFxQuote(
  presentmentCurrency: string,
  settlementCurrency: string
): Promise<FxQuote | null> {
  const from = presentmentCurrency.toLowerCase();
  const to = settlementCurrency.toLowerCase();
  if (from === to) return null;

  const clave = `${from}->${to}`;
  const enCache = cache.get(clave);
  if (enCache && enCache.expiresAtMs - MARGEN_EXPIRACION_MS > Date.now()) return enCache;

  const res = await stripeFetch<FxQuoteResponse>("/fx_quotes", {
    method: "POST",
    apiVersion: FX_API_VERSION,
    form: { to_currency: to, from_currencies: [from], lock_duration: LOCK_DURATION },
  });

  if (!res.ok) {
    logger.warn("getFxQuote: Stripe no dio cotización, se usará la tabla cacheada", {
      clave,
      status: res.status,
      error: res.error.slice(0, 200),
    });
    return null;
  }

  const d = res.data;
  const fila = d.rates?.[from];
  const base = Number(fila?.rate_details?.base_rate);
  if (!d.id || !Number.isFinite(base) || base <= 0) {
    logger.warn("getFxQuote: respuesta sin tasa utilizable", { clave, id: d.id });
    return null;
  }
  if (d.lock_status && d.lock_status !== "active") {
    logger.warn("getFxQuote: la cotización no nació activa", { clave, estado: d.lock_status });
    return null;
  }

  const quote: FxQuote = {
    id: d.id,
    baseRate: base,
    exchangeRate: Number(fila?.exchange_rate) || base,
    fxFeeRate: Number(fila?.rate_details?.fx_fee_rate) || 0,
    durationPremium: Number(fila?.rate_details?.duration_premium) || 0,
    referenceProvider: fila?.rate_details?.reference_rate_provider ?? null,
    expiresAtMs: (Number(d.lock_expires_at) || 0) * 1000,
  };

  // Se registra la comisión real de Stripe en cada cotización nueva: es el número con el que
  // se dimensiona el colchón del 2%, que hasta ahora se llevaba a ojo.
  logger.info("fx_quote", {
    clave,
    baseRate: quote.baseRate,
    fxFeeRate: quote.fxFeeRate,
    durationPremium: quote.durationPremium,
    proveedor: quote.referenceProvider,
  });

  cache.set(clave, quote);
  return quote;
}

/** Vacía el caché. Solo para pruebas. */
export function __limpiarCacheFxQuotes(): void {
  cache.clear();
}

/**
 * Tamaño de lote al pedir muchas monedas. La documentación no publica un tope de
 * `from_currencies`, así que se parte de forma conservadora: un lote rechazado por
 * tamaño se llevaría por delante todas las monedas que traía.
 */
const LOTE = 20;

/**
 * Tasas SPOT de Stripe para varias monedas, sin candado.
 *
 * `lock_duration: none` es GRATIS: solo informa. Se usa para la tabla que alimenta los
 * precios mostrados, donde no hace falta congelar nada con Stripe — el congelamiento lo
 * hace Vibra guardando la tasa (ver `frozenRates.ts`).
 *
 * Devuelve `{ MXN: 17.06, ... }` — unidades por 1 de la moneda de liquidación, que es el
 * formato de `config/exchangeRates`. ⚠️ Stripe da lo INVERSO (`base_rate` = cuántos USD
 * vale 1 peso), así que aquí se invierte.
 */
export async function getSpotRates(
  currencies: string[],
  settlementCurrency: string
): Promise<Record<string, number>> {
  const to = settlementCurrency.toLowerCase();
  const pendientes = currencies.map((c) => c.toLowerCase()).filter((c) => c !== to);
  const out: Record<string, number> = {};

  // ⚠️ La clave va SIN el sufijo `[]`: `encodeForm` ya numera los arreglos
  // (`from_currencies[0]=...`). Con `"from_currencies[]"` generaba `from_currencies[][0]`,
  // que Stripe lee como OBJETO y rechaza con 400 — el congelamiento diario quedaba muerto
  // en silencio (se conservaba la tabla vieja). Con UN solo string sí pasaba, por eso los
  // cobros seguían funcionando y solo fallaba este lote.
  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE);
    const res = await stripeFetch<FxQuoteResponse>("/fx_quotes", {
      method: "POST",
      apiVersion: FX_API_VERSION,
      form: { to_currency: to, from_currencies: lote, lock_duration: "none" },
    });
    if (!res.ok) {
      logger.warn("getSpotRates: lote rechazado", {
        desde: lote[0],
        n: lote.length,
        status: res.status,
        error: res.error.slice(0, 200),
      });
      continue; // los demás lotes siguen: es mejor una tabla parcial que ninguna
    }
    for (const [codigo, fila] of Object.entries(res.data.rates ?? {})) {
      const base = Number(fila?.rate_details?.base_rate);
      if (Number.isFinite(base) && base > 0) out[codigo.toUpperCase()] = 1 / base;
    }
  }
  return out;
}
