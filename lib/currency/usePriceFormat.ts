"use client";

// Formateador central de precios de cara al usuario.
//
// Recibe SIEMPRE un monto en MXN (el ancla en que se guarda todo) y lo muestra en
// la moneda de visualización elegida. Marca "≈" cuando la moneda mostrada no es la
// moneda de cobro real del ítem (hoy el cobro es MXN → todo lo no-MXN va con "≈").
//
// Nunca se usa para cálculos de dinero: solo para MOSTRAR.

import { useCallback } from "react";
import { useLocale } from "next-intl";
import { useCurrency } from "@/app/components/CurrencyProvider";
import { useExchangeRates } from "./rates";
import { convertFromAnchor, convertToAnchor, formatCurrency } from "./format";
import {
  ANCHOR_CURRENCY,
  isDisplayCurrency,
  type ChargeCurrency,
  type DisplayCurrency,
} from "./catalog";

export type PriceFormatOptions = {
  /**
   * Moneda en que está guardado el monto. Default MXN (el ancla). Acepta cualquier
   * string; si no es una moneda conocida se trata como MXN. Si un ítem legado está
   * en otra moneda (p. ej. USD), se convierte a MXN primero, así se muestra correcto
   * aunque aún no se haya normalizado el dato.
   */
  baseCurrency?: string | null;
  /** Moneda de cobro real del ítem (default MXN). Si == la mostrada → exacto; si no → "≈". */
  chargeCurrency?: ChargeCurrency;
  /** Mostrar el código ISO al final (desambigua el "$" entre MXN/USD/ARS…). Default true. */
  code?: boolean;
};

export type PriceFormatter = {
  /** Formatea un monto en MXN en la moneda de visualización. */
  format: (mxnAmount: number, opts?: PriceFormatOptions) => string;
  /** Moneda de visualización activa. */
  currency: DisplayCurrency;
  /** Locale activo. */
  locale: string;
  /** "live" = tasas reales; "mock" = placeholder (aún no hay feed real). */
  ratesSource: "live" | "mock";
  /** Convierte un monto en la moneda mostrada de vuelta a MXN (para inputs del creador). */
  toAnchor: (amount: number) => number | null;
  /** Formatea un monto ya en MXN, siempre en MXN (para el "= $X MXN (precio real)"). */
  formatAnchor: (mxnAmount: number, opts?: { code?: boolean }) => string;
  /**
   * Input del creador → cómo guardar. El creador teclea en su moneda y se guarda
   * en MXN (ancla). Devuelve { price: MXN, currency: "MXN" }.
   */
  resolveStoredPrice: (amount: number) => { price: number; currency: "MXN" };
  /** Convierte un precio guardado (en su moneda) a la del creador, para editarlo. */
  toDisplayForInput: (storedPrice: number, storedCurrency: string) => number;
};

export function usePriceFormat(): PriceFormatter {
  const locale = useLocale();
  const { currency } = useCurrency();
  const rates = useExchangeRates();

  const format = useCallback(
    (amount: number, opts: PriceFormatOptions = {}): string => {
      const code = opts.code ?? false;
      const base: DisplayCurrency = isDisplayCurrency(opts.baseCurrency)
        ? opts.baseCurrency
        : ANCHOR_CURRENCY;
      const charge: ChargeCurrency = opts.chargeCurrency ?? ANCHOR_CURRENCY;
      // Normalizamos a MXN (ancla) si el monto viene en otra moneda base.
      const mxn = base === ANCHOR_CURRENCY ? amount : convertToAnchor(amount, base, rates.rates);
      if (mxn == null) {
        // Sin tasa para la base: mostramos el valor tal cual en su moneda base.
        return formatCurrency(amount, base, locale, { code });
      }
      const converted = convertFromAnchor(mxn, currency, rates.rates);
      if (converted == null) {
        // Sin tasa para la mostrada: mostramos el valor real en MXN (nunca inventamos).
        return formatCurrency(mxn, ANCHOR_CURRENCY, locale, { code });
      }
      return formatCurrency(converted, currency, locale, {
        approx: currency !== charge,
        code,
      });
    },
    [locale, currency, rates]
  );

  const toAnchor = useCallback(
    (amount: number) => convertToAnchor(amount, currency, rates.rates),
    [currency, rates]
  );

  const formatAnchor = useCallback(
    (mxnAmount: number, opts: { code?: boolean } = {}) =>
      formatCurrency(mxnAmount, ANCHOR_CURRENCY, locale, { code: opts.code ?? true }),
    [locale]
  );

  const resolveStoredPrice = useCallback(
    (amount: number): { price: number; currency: "MXN" } => {
      // El creador teclea en su moneda; se guarda en MXN (ancla).
      const mxn =
        currency === ANCHOR_CURRENCY
          ? amount
          : convertToAnchor(amount, currency, rates.rates) ?? amount;
      return { price: Math.round(mxn * 100) / 100, currency: "MXN" };
    },
    [currency, rates]
  );

  const toDisplayForInput = useCallback(
    (storedPrice: number, storedCurrency: string): number => {
      const from: DisplayCurrency = isDisplayCurrency(storedCurrency)
        ? storedCurrency
        : ANCHOR_CURRENCY;
      if (from === currency) return storedPrice;
      const mxn =
        from === ANCHOR_CURRENCY
          ? storedPrice
          : convertToAnchor(storedPrice, from, rates.rates) ?? storedPrice;
      return convertFromAnchor(mxn, currency, rates.rates) ?? mxn;
    },
    [currency, rates]
  );

  return {
    format,
    currency,
    locale,
    ratesSource: rates.source,
    toAnchor,
    formatAnchor,
    resolveStoredPrice,
    toDisplayForInput,
  };
}
