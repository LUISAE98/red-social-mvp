// Conversión y formateo de montos. Puro (usable en servidor y cliente).
//
// Regla de oro: nunca se guarda un monto convertido. Se guarda MXN (ancla) y se
// convierte en el momento de mostrar. Los importes convertidos que no son la
// moneda de cobro real se marcan con "≈".

import { ANCHOR_CURRENCY, type DisplayCurrency } from "./catalog";

/**
 * Mapa de tasas: unidades de la moneda por 1 unidad del ancla (MXN).
 * Ej.: rates["USD"] = 0.055  →  1 MXN = 0.055 USD.
 */
export type RateMap = Partial<Record<DisplayCurrency, number>>;

/** Convierte un monto en MXN (ancla) a la moneda destino. Devuelve null si falta la tasa. */
export function convertFromAnchor(
  amountMxn: number,
  to: DisplayCurrency,
  rates: RateMap
): number | null {
  if (to === ANCHOR_CURRENCY) return amountMxn;
  const r = rates[to];
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return null;
  return amountMxn * r;
}

/**
 * Convierte un monto en `from` de vuelta a MXN (para el input del creador, que
 * teclea en su moneda pero se guarda en MXN). Devuelve null si falta la tasa.
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
