// Conversión y formateo de montos. Puro (usable en servidor y cliente).
//
// Regla de oro: nunca se guarda un monto convertido. Se guarda USD (ancla de
// referencia) y se convierte en el momento de mostrar/cobrar en la moneda local.

import { ANCHOR_CURRENCY, type DisplayCurrency } from "./catalog";

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
 * Margen (buffer) sobre la tasa FX aplicado SOLO al precio de cara al comprador.
 * Cubre la volatilidad entre que el comprador ve el precio y dLocal liquida (crítico
 * en monedas volátiles como ARS). No se aplica al round-trip del creador ni a la
 * referencia en USD. ~1.5%.
 */
export const FX_BUFFER = 0.015;

/**
 * Paso de redondeo "bonito" por moneda: el precio local convertido se redondea a un
 * múltiplo de esto para no mostrar cifras crudas del FX (ej. 4.873,42 COP → 4.900 COP).
 * Impacta conversión de ventas.
 */
const NICE_STEP: Record<DisplayCurrency, number> = {
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
const FORMAT_LOCALE: Record<string, string> = {
  es: "es-MX",
  en: "en-US",
  "pt-BR": "pt-BR",
};

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
  const loc = FORMAT_LOCALE[locale] ?? locale;
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
