"use client";

// Formateador central de precios de cara al usuario.
//
// Recibe SIEMPRE un monto en USD (el ancla de referencia en que se guarda todo) y
// lo muestra en la moneda local del usuario. Con dLocal el comprador paga en su
// moneda local; el USD es solo la referencia interna del precio.
//
// Nunca se usa para cálculos de dinero: solo para MOSTRAR.

import { useCallback } from "react";
import { useLocale } from "next-intl";
import { useCurrency } from "@/app/components/CurrencyProvider";
import { useExchangeRates } from "./rates";
import { buyerPrice, buyerPriceExact, roundCharm, convertFromAnchor, convertToAnchor, formatCurrency, buyerLocalToAnchor } from "./format";
import {
  ANCHOR_CURRENCY,
  isDisplayCurrency,
  type ChargeCurrency,
  type DisplayCurrency,
} from "./catalog";
import { useBuyerCountry } from "@/lib/tax/useBuyerCountry";
import { computeConsumptionTax, taxRateForCountry } from "@/lib/tax/config";

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
  /**
   * País fiscal a usar EN LUGAR del que dice la IP.
   *
   * Lo usa la pasarela cuando ya leyó el país EMISOR de la tarjeta: al terminar de escribirla
   * el precio se recalcula con su país, que es el que de verdad va a mandar en el cobro.
   * Espeja la regla del backend (`resolveTaxCountry`): gana la tarjeta, salvo IP mexicana.
   */
  taxCountryOverride?: string | null;
};

/**
 * Precio con impuesto SUMADO (IVA), ya resuelto en la moneda local del comprador.
 * `base`/`tax`/`total` son cadenas formateadas listas para mostrar; los `*Local`
 * son los números por si el caller los necesita. `applies` = hay impuesto que
 * mostrar (según el país del comprador). Ver lib/tax/config.ts.
 */
export type TaxedPrice = {
  applies: boolean;
  rate: number;
  taxName: string | null;
  taxCountry: string | null;
  baseLocal: number;
  taxLocal: number;
  totalLocal: number;
  currency: DisplayCurrency;
  base: string;
  tax: string;
  total: string;
};

export type PriceFormatter = {
  /** Formatea un monto en MXN en la moneda de visualización. */
  format: (mxnAmount: number, opts?: PriceFormatOptions) => string;
  /**
   * Como `format`, pero devuelve el desglose base / impuesto / total según el país
   * del comprador (IVA sumado encima). Si el país no tiene impuesto, `applies=false`
   * y base==total. Para MOSTRAR; el cobro autoritativo se hará en el backend (dLocal).
   */
  formatWithTax: (amount: number, opts?: PriceFormatOptions) => TaxedPrice;
  /** País del comprador por IP (ISO-2), o null si aún no se conoce. */
  buyerCountry: string | null;
  /** Tasa de impuesto del comprador (0 si no aplica). Útil para el cobro (base * (1+rate)). */
  taxRate: number;
  /** Moneda de visualización activa. */
  currency: DisplayCurrency;
  /** Locale activo. */
  locale: string;
  /** "live" = tasas reales; "mock" = placeholder (aún no hay feed real). */
  ratesSource: "live" | "mock";
  /** Convierte un monto en la moneda mostrada de vuelta a MXN (para inputs del creador). */
  toAnchor: (amount: number) => number | null;
  /** Conversión SIMPLE del ancla a la moneda del usuario: solo tipo de cambio, sin el 2% ni redondeo. */
  fromAnchor: (amount: number) => number | null;
  /** Inverso del precio de comprador: de su moneda a USD (deshace tasa + margen FX). */
  buyerLocalToUsd: (localAmount: number) => number | null;
  /** Como `format` pero con conversión SIMPLE (sin el 2% ni redondeo). Para lo que ve el CREADOR de su dinero. */
  formatPlain: (amount: number, opts?: { baseCurrency?: string | null; code?: boolean }) => string;
  /** Formatea un monto ya en MXN, siempre en MXN (para el "= $X MXN (precio real)"). */
  formatAnchor: (mxnAmount: number, opts?: { code?: boolean }) => string;
  /**
   * Input del creador → cómo guardar. El creador teclea en SU moneda local y se
   * guarda en USD (ancla de referencia). Devuelve { price: USD, currency: "USD" }.
   */
  resolveStoredPrice: (amount: number) => { price: number; currency: "USD" };
  /** Convierte un precio guardado (en su moneda) a la del creador, para editarlo. */
  toDisplayForInput: (storedPrice: number, storedCurrency: string) => number;
};

export function usePriceFormat(): PriceFormatter {
  const locale = useLocale();
  const { currency } = useCurrency();
  const rates = useExchangeRates();
  const buyerCountry = useBuyerCountry();

  // Resuelve un monto (en su moneda base, default USD ancla) a la moneda local del
  // comprador. Devuelve el número local y la moneda efectiva mostrada (para fallbacks
  // sin tasa). Reutilizado por `format` y `formatWithTax`.
  const resolveLocal = useCallback(
    (amount: number, opts: PriceFormatOptions = {}): { value: number; currency: DisplayCurrency } => {
      const base: DisplayCurrency = isDisplayCurrency(opts.baseCurrency)
        ? opts.baseCurrency
        : ANCHOR_CURRENCY;
      // Sin conversión (misma moneda) → monto EXACTO, sin buffer FX ni redondeo "nice".
      // El buffer solo aplica cuando de verdad se convierte de una moneda a otra.
      if (base === currency) return { value: amount, currency };
      const usd = base === ANCHOR_CURRENCY ? amount : convertToAnchor(amount, base, rates.rates);
      if (usd == null) return { value: amount, currency: base };
      const local = buyerPrice(usd, currency, rates.rates);
      if (local == null) return { value: usd, currency: ANCHOR_CURRENCY };
      return { value: local, currency };
    },
    [currency, rates]
  );

  // Igual que `resolveLocal` pero SIN el redondeo a paso de la moneda. Lo usa `formatWithTax`,
  // porque el total que se cobra se compone sin ese redondeo intermedio: aplicarlo aquí
  // separaba el precio mostrado del cobrado.
  const resolveLocalExact = useCallback(
    (amount: number, opts: PriceFormatOptions = {}): { value: number; currency: DisplayCurrency } => {
      const base: DisplayCurrency = isDisplayCurrency(opts.baseCurrency)
        ? opts.baseCurrency
        : ANCHOR_CURRENCY;
      if (base === currency) return { value: amount, currency };
      const usd = base === ANCHOR_CURRENCY ? amount : convertToAnchor(amount, base, rates.rates);
      if (usd == null) return { value: amount, currency: base };
      const local = buyerPriceExact(usd, currency, rates.rates);
      if (local == null) return { value: usd, currency: ANCHOR_CURRENCY };
      return { value: local, currency };
    },
    [currency, rates]
  );

  const format = useCallback(
    (amount: number, opts: PriceFormatOptions = {}): string => {
      const code = opts.code ?? false;
      const { value, currency: cur } = resolveLocal(amount, opts);
      return formatCurrency(value, cur, locale, { code });
    },
    [locale, resolveLocal]
  );

  /**
   * Formatea con conversión SIMPLE (solo tipo de cambio) en vez de con el precio de cara
   * al comprador. Es lo que va en todo lo que el CREADOR ve de su propio dinero.
   *
   * 🚨 La diferencia con `format` no es cosmética. `format` suma el 2% de conversión y
   * redondea al paso de la moneda porque calcula lo que PAGA un comprador. Aplicado a las
   * ganancias del creador daba números que no son ni su precio ni su ganancia: con 1 USD de
   * base, "ganarás 0.75" se mostraba como 15 MXN (0.75 → +2% → 13.02 → paso de 5 → 15).
   */
  const formatPlain = useCallback(
    (amount: number, opts: { baseCurrency?: string | null; code?: boolean } = {}): string => {
      const code = opts.code ?? true;
      const base: DisplayCurrency = isDisplayCurrency(opts.baseCurrency)
        ? opts.baseCurrency
        : ANCHOR_CURRENCY;
      if (base === currency) return formatCurrency(amount, currency, locale, { code });
      const usd = base === ANCHOR_CURRENCY ? amount : convertToAnchor(amount, base, rates.rates);
      if (usd == null) return formatCurrency(amount, base, locale, { code });
      const local = convertFromAnchor(usd, currency, rates.rates);
      if (local == null) return formatCurrency(usd, ANCHOR_CURRENCY, locale, { code });
      return formatCurrency(local, currency, locale, { code });
    },
    [currency, locale, rates]
  );

  const formatWithTax = useCallback(
    (amount: number, opts: PriceFormatOptions = {}): TaxedPrice => {
      // ⚠️ ESTE es el número que el comprador va a pagar, así que tiene que reproducir
      // EXACTAMENTE lo que hace el backend (composeCharge → applyCharmRounding):
      //   convertir sin redondeo intermedio → sumar impuesto → redondear el TOTAL → despejar.
      //
      // Antes usaba `resolveLocal`, que aplica `roundNice` a la base. Con base 10 USD y
      // comprador mexicano el backend cobraba 209.99 y aquí se mostraba 208.80: la base se
      // redondeaba al paso de 5 ANTES de sumar el impuesto, y el total nunca coincidía.
      const { value: baseLocal, currency: cur } = resolveLocalExact(amount, opts);
      // El impuesto se calcula sobre la base YA en moneda local, así base+impuesto=total
      // exacto (sin drift). Ver docs/legal/fiscal-iva-isr-plataforma.md.
      // El override gana sobre la IP: cuando la pasarela ya leyó el país de la tarjeta,
      // ese es el país que va a mandar en el cobro real.
      const country = opts.taxCountryOverride ?? buyerCountry;
      const crudo = computeConsumptionTax(baseLocal, country);

      // Redondeo comercial del TOTAL y despeje hacia atrás, espejo de recomposeWithCharged.
      const total = roundCharm(crudo.total, cur);
      const base = crudo.applies && crudo.rate > 0 ? total / (1 + crudo.rate) : total;
      const bd = {
        ...crudo,
        base: Math.round(base * 100) / 100,
        tax: Math.round((total - base) * 100) / 100,
        total,
      };
      const fmt = (n: number) => formatCurrency(n, cur, locale, { code: opts.code ?? false });
      return {
        applies: bd.applies,
        rate: bd.rate,
        taxName: bd.taxName,
        taxCountry: bd.taxCountry,
        baseLocal: bd.base,
        taxLocal: bd.tax,
        totalLocal: bd.total,
        currency: cur,
        base: fmt(bd.base),
        tax: fmt(bd.tax),
        total: fmt(bd.total),
      };
    },
    [locale, resolveLocalExact, buyerCountry]
  );

  const toAnchor = useCallback(
    (amount: number) => convertToAnchor(amount, currency, rates.rates),
    [currency, rates]
  );

  /**
   * Conversión SIMPLE del ancla a la moneda que mira el usuario: solo el tipo de cambio.
   *
   * 🚨 No confundir con `format`, que es el precio de cara al COMPRADOR: ese suma el 2% de
   * conversión y redondea al paso de la moneda. Usarlo como referencia para el creador daba
   * números absurdos — 1 USD salía como "15 MXN" (17.03 → +2% = 17.37 → paso de 5 → 15).
   * Para "cuánto es esto en mi moneda" lo que va es la tasa pelada.
   */
  const fromAnchor = useCallback(
    (amount: number) => convertFromAnchor(amount, currency, rates.rates),
    [currency, rates]
  );

  /**
   * De lo que el comprador VE en su moneda, de vuelta a USD. Inverso exacto del precio
   * de comprador (deshace el margen FX además de la tasa).
   *
   * Lo usa la donación, que es el único sitio donde el comprador TECLEA un importe.
   */
  const buyerLocalToUsd = useCallback(
    (localAmount: number) => buyerLocalToAnchor(localAmount, currency, rates.rates),
    [currency, rates]
  );

  const formatAnchor = useCallback(
    (mxnAmount: number, opts: { code?: boolean } = {}) =>
      formatCurrency(mxnAmount, ANCHOR_CURRENCY, locale, { code: opts.code ?? true }),
    [locale]
  );

  const resolveStoredPrice = useCallback(
    (amount: number): { price: number; currency: "USD" } => {
      // El creador teclea en su moneda local; se guarda en USD (ancla de referencia).
      const usd =
        currency === ANCHOR_CURRENCY
          ? amount
          : convertToAnchor(amount, currency, rates.rates) ?? amount;
      return { price: Math.round(usd * 100) / 100, currency: "USD" };
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
    formatWithTax,
    buyerCountry,
    taxRate: taxRateForCountry(buyerCountry),
    currency,
    locale,
    ratesSource: rates.source,
    toAnchor,
    fromAnchor,
    buyerLocalToUsd,
    formatPlain,
    formatAnchor,
    resolveStoredPrice,
    toDisplayForInput,
  };
}
