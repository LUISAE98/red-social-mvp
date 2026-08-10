// Conversión y formateo de montos. Puro (usable en servidor y cliente).
//
// Regla de oro: nunca se guarda un monto convertido. Se guarda USD (ancla de
// referencia) y se convierte en el momento de mostrar/cobrar en la moneda local.

import { intlLocale } from "@/i18n/locales";
import { ANCHOR_CURRENCY, FX_CONVERSION_FEE, type DisplayCurrency } from "./catalog";

/**
 * Mapa de tasas: unidades de la moneda por 1 unidad del ancla (USD).
 * Ej.: rates["MXN"] = 18.5  →  1 USD = 18.5 MXN.
 */
export type RateMap = Partial<Record<DisplayCurrency, number>>;

/** Convierte un monto en USD (ancla) a la moneda destino. Devuelve null si falta la tasa. */
export function convertFromAnchor(
  amountUsd: number,
  to: DisplayCurrency,
  rates: RateMap
): number | null {
  if (to === ANCHOR_CURRENCY) return amountUsd;
  const r = rates[to];
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return null;
  return amountUsd * r;
}

/**
 * Convierte un monto en `from` de vuelta a USD (ancla), p.ej. el input del creador
 * que teclea en su moneda local. Devuelve null si falta la tasa.
 */
export function convertToAnchor(
  amount: number,
  from: DisplayCurrency,
  rates: RateMap
): number | null {
  if (from === ANCHOR_CURRENCY) return amount;
  const r = rates[from];
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return null;
  return amount / r;
}

/**
 * Margen sobre la tasa FX aplicado al precio de cara al comprador.
 *
 * ⚠️ Es el MISMO cargo que cobra el backend (`FX_CONVERSION_FEE`), no otro distinto.
 * Hasta el 2026-08-07 este valor era 1.5% mientras el cobro real usaba 2%: el comprador
 * extranjero veía un precio y se le cobraba otro. Ahora ambos salen de la misma constante.
 *
 * Se re-exporta con el nombre histórico para no romper los imports existentes.
 */
export const FX_BUFFER = FX_CONVERSION_FEE;

/**
 * Paso de redondeo "bonito" por moneda: el precio local convertido se redondea a un
 * múltiplo de esto para no mostrar cifras crudas del FX (ej. 4.873,42 COP → 4.900 COP).
 * Impacta conversión de ventas.
 *
 * Criterio: el paso debe valer aproximadamente lo mismo en poder adquisitivo en todas
 * las monedas (~0.05–0.50 USD). Demasiado fino deja cifras feas; demasiado grueso
 * mueve el precio real (el redondeo puede subir o bajar lo que paga el comprador).
 */
export const NICE_STEP: Record<DisplayCurrency, number> = {
  USD: 0.5,
  MXN: 5,
  ARS: 100,
  BOB: 1,
  BRL: 1,
  CLP: 100,
  COP: 100,
  CRC: 100,
  GTQ: 1,
  HNL: 5,
  NIO: 5,
  PEN: 1,
  PYG: 500,
  DOP: 10,
  UYU: 5,
  // --- Unión Europea --- (equivalencias con la tasa de referencia, ago-2026)
  EUR: 0.5, // 1 EUR ≈ 1.08 USD → 0.5 EUR ≈ 0.54 USD. Mismo paso que el ancla.
  CZK: 5, //   1 USD ≈ 23 CZK   → 5 CZK   ≈ 0.22 USD. Igual de fino que MXN.
  DKK: 1, //   1 USD ≈ 6.9 DKK  → 1 DKK   ≈ 0.15 USD. Con paso 5 serían 0.72 USD, muy grueso.
  HUF: 100, // 1 USD ≈ 355 HUF  → 100 HUF ≈ 0.28 USD. Nadie cotiza en unidades de HUF.
  PLN: 1, //   1 USD ≈ 4.0 PLN  → 1 PLN   ≈ 0.25 USD.
  RON: 1, //   1 USD ≈ 4.6 RON  → 1 RON   ≈ 0.22 USD.
  SEK: 5, //   1 USD ≈ 10.5 SEK → 5 SEK   ≈ 0.48 USD. El precio sueco se usa en múltiplos de 5.
  // --- Europa NO comunitaria ---
  NOK: 5, //   1 USD ≈ 10.5 NOK → 5 NOK   ≈ 0.48 USD. Mismo caso que la corona sueca.
  ISK: 50, //  1 USD ≈ 138 ISK  → 50 ISK  ≈ 0.36 USD. La corona islandesa no usa decimales
  //           en la práctica y los precios se cotizan en decenas.
  BAM: 0.5, // 1 USD ≈ 1.8 BAM  → 0.5 BAM ≈ 0.28 USD. El marco está anclado al euro
  //           (1.95583 BAM = 1 EUR), así que se comporta como él.
  // --- Asia-Pacífico y Medio Oriente ---
  JPY: 50, //    1 USD ≈ 150 JPY  → 50 JPY ≈ 0.33 USD. El yen no tiene decimales.
  SGD: 0.5, //   1 USD ≈ 1.34 SGD → 0.5 SGD ≈ 0.37 USD.
  AUD: 0.5, //   1 USD ≈ 1.5 AUD  → 0.5 AUD ≈ 0.33 USD.
  NZD: 0.5, //   1 USD ≈ 1.65 NZD → 0.5 NZD ≈ 0.30 USD.
  HKD: 1, //     1 USD ≈ 7.8 HKD  → 1 HKD ≈ 0.13 USD. Anclado al dólar (banda 7.75–7.85).
  TWD: 5, //     1 USD ≈ 32 TWD   → 5 TWD ≈ 0.16 USD.
  THB: 5, //     1 USD ≈ 35 THB   → 5 THB ≈ 0.14 USD.
  MYR: 0.5, //   1 USD ≈ 4.4 MYR  → 0.5 MYR ≈ 0.11 USD.
  PHP: 5, //     1 USD ≈ 57 PHP   → 5 PHP ≈ 0.09 USD.
  IDR: 5000, //  1 USD ≈ 16.000 IDR → 5.000 IDR ≈ 0.31 USD. Nadie cotiza en unidades de rupia.
  QAR: 0.5, //   1 USD ≈ 3.64 QAR → 0.5 QAR ≈ 0.14 USD. Anclado al dólar.
  // ⚠️ KWD y JOD son monedas de TRES decimales. El paso debe dejar el monto en múltiplos
  // de 10 fils, porque Stripe exige que el último dígito del importe en milésimas sea 0.
  KWD: 0.05, //  1 USD ≈ 0.31 KWD → 0.05 KWD ≈ 0.16 USD = 50 fils exactos.
  JOD: 0.1, //   1 USD ≈ 0.71 JOD → 0.1 JOD ≈ 0.14 USD = 100 fils exactos. Anclado al dólar.
};

/** Redondea a un múltiplo "bonito" según la moneda. */
export function roundNice(amount: number, currency: DisplayCurrency): number {
  const step = NICE_STEP[currency] ?? 1;
  if (step <= 0) return amount;
  return Math.round(amount / step) * step;
}

/**
 * Precio de cara al COMPRADOR: convierte del USD (ancla) a su moneda local, aplica
 * el margen FX y redondea a cifra limpia. Es lo que el comprador VE y PAGA (dLocal).
 * USD (Ecuador/El Salvador/Panamá) se paga exacto: sin buffer ni redondeo (es la
 * moneda de referencia). Devuelve null si falta la tasa.
 */
export function buyerPrice(
  usdAmount: number,
  currency: DisplayCurrency,
  rates: RateMap
): number | null {
  if (currency === ANCHOR_CURRENCY) return usdAmount;
  const raw = convertFromAnchor(usdAmount, currency, rates);
  if (raw == null) return null;
  return roundNice(raw * (1 + FX_BUFFER), currency);
}

// Locale de FORMATEO por idioma: fija el símbolo antes del número y el separador
// decimal correcto (el genérico "es" pone el símbolo al final, se ve raro).
// Sale de i18n/locales.ts (campo `intl`), la fuente única de idiomas.

/**
 * Formatea un monto en su moneda usando Intl: símbolo normal antes del número,
 * decimales según la propia moneda (CLP/COP/PYG sin decimales, etc.).
 * Cada quien ve su moneda como es normal — sin "≈" ni código ISO pegado.
 */
export function formatCurrency(
  amount: number,
  currency: string,
  locale: string,
  // Se conservan por compatibilidad de firma; ya no se usan (sin "≈" ni código).
  _opts: { approx?: boolean; code?: boolean } = {}
): string {
  const loc = intlLocale(locale);
  try {
    return new Intl.NumberFormat(loc, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/** Nombre localizado de la moneda (para el selector). */
export function currencyLabel(currency: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}

/** Símbolo de la moneda (para chips/selector). */
export function currencySymbol(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}
