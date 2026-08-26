// Precio CONGELADO por día, con refresco de emergencia por moneda.
//
// EL PROBLEMA QUE RESUELVE
// El precio local se recalculaba con la tasa del momento, así que un comprador veía un
// número distinto de un día para otro sin que nadie tocara nada. En servicios que se
// repiten frente a la misma audiencia —niveles de súper comentario, montos de donación—
// eso rompe el precio: un nivel deja de ser un nivel cuando el número se mueve.
//
// CÓMO FUNCIONA
// La tasa se CONGELA y se guarda. Durante el día el precio mostrado no se mueve. Un cron
// corto compara la tasa congelada contra la de Stripe y **solo refresca las monedas que se
// salieron de su banda**; el resto se queda quieto hasta el refresco diario.
//
// 🚨 QUIÉN ABSORBE EL MOVIMIENTO. Mientras la tasa está congelada, Vibra cobra el importe
// local que prometió y recibe lo que valga ese día. Si el dólar sube pierde; si baja gana.
// Lo cubre el colchón del 2% (0.64% real tras impuesto en México, ver docs/stripe-integracion.md
// §5), que aguanta un movimiento diario de ~0.55%. Por eso la ventana es de UN DÍA: con un
// mes, el mismo colchón sería una apuesta.
//
// ⚠️ La banda es POR MONEDA. ARS, TRY o NGN se mueven mucho más que el euro; con una banda
// global se refrescarían de más las estables o de menos las volátiles.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { getSpotRates } from "./fxQuotes";
import { SETTLEMENT_CURRENCY } from "../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Cuánto puede desviarse una tasa de la congelada antes de refrescarla fuera de horario.
 *
 * 0.5% está por debajo del colchón real (0.64%): se corrige ANTES de empezar a comerse el
 * margen, no después. Subirla a 1% significa aceptar pérdidas antes de reaccionar.
 */
const BANDA_POR_DEFECTO = 0.005;

/**
 * Bandas propias de monedas que se mueven mucho más que el resto. Con la banda estándar
 * estarían disparando refrescos todo el día, y su precio no se quedaría quieto nunca —
 * que es justo lo contrario de lo que el congelamiento busca.
 *
 * Mismo patrón que `FX_CONVERSION_FEE_BY_CURRENCY` en catalog.ts.
 */
const BANDA_POR_MONEDA: Readonly<Record<string, number>> = {
  ARS: 0.02,
  TRY: 0.015,
  NGN: 0.015,
  EGP: 0.015,
  VND: 0.01,
};

export function bandaDe(moneda: string): number {
  return BANDA_POR_MONEDA[moneda.toUpperCase()] ?? BANDA_POR_DEFECTO;
}

/**
 * Refresca la tabla de tasas congeladas.
 *
 * @param forzar `true` en el refresco DIARIO: reescribe todas. `false` en el cron de
 *   vigilancia: solo las que se salieron de su banda.
 */
export async function refreshFrozenRatesHandler(forzar: boolean): Promise<{
  consultadas: number;
  refrescadas: string[];
  congeladas: number;
}> {
  const ref = db.doc("config/exchangeRates");
  const snap = await ref.get();
  const previas = (snap.data()?.rates ?? {}) as Record<string, number>;
  const monedas = Object.keys(previas).filter((c) => c !== SETTLEMENT_CURRENCY);

  // En el primer arranque la tabla puede venir vacía; no hay nada que comparar todavía.
  if (monedas.length === 0) {
    logger.warn("refreshFrozenRates: tabla vacía, no hay monedas que refrescar");
    return { consultadas: 0, refrescadas: [], congeladas: 0 };
  }

  const spot = await getSpotRates(monedas, SETTLEMENT_CURRENCY);
  if (Object.keys(spot).length === 0) {
    // 🛟 Sin tasas de Stripe NO se toca nada: la tabla vieja sigue sirviendo. Borrarla o
    // dejarla a medias rompería los precios de toda la plataforma.
    logger.error("refreshFrozenRates: Stripe no devolvió ninguna tasa, se conserva la tabla");
    return { consultadas: 0, refrescadas: [], congeladas: monedas.length };
  }

  const rates: Record<string, number> = { ...previas, [SETTLEMENT_CURRENCY]: 1 };
  const frozenAt: Record<string, unknown> = { ...(snap.data()?.frozenAt ?? {}) };
  const ahora = admin.firestore.Timestamp.now();
  const refrescadas: string[] = [];

  for (const [moneda, nueva] of Object.entries(spot)) {
    const anterior = previas[moneda];
    if (!anterior || anterior <= 0) {
      // Moneda sin tasa previa: se toma la de Stripe sin más, no hay contra qué comparar.
      rates[moneda] = nueva;
      frozenAt[moneda] = ahora;
      refrescadas.push(moneda);
      continue;
    }
    const deriva = Math.abs(nueva / anterior - 1);
    if (forzar || deriva > bandaDe(moneda)) {
      rates[moneda] = nueva;
      frozenAt[moneda] = ahora;
      refrescadas.push(moneda);
      if (!forzar) {
        logger.info("refreshFrozenRates: refresco fuera de horario", {
          moneda,
          deriva: Math.round(deriva * 10000) / 100,
          banda: bandaDe(moneda) * 100,
        });
      }
    }
  }

  await ref.set(
    {
      base: SETTLEMENT_CURRENCY,
      rates,
      frozenAt,
      source: "live",
      provider: "stripe-fx-quotes",
      updatedAt: ahora,
    },
    { merge: true }
  );

  const out = {
    consultadas: Object.keys(spot).length,
    refrescadas,
    congeladas: monedas.length - refrescadas.length,
  };
  logger.info("refreshFrozenRates", { forzar, ...out, refrescadas: refrescadas.join(",") });
  return out;
}
