"use client";

import { useCallback } from "react";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useWalletCurrencyMode, type WalletCurrencyMode } from "./useWalletCurrencyMode";

/**
 * Formateador ÚNICO del dinero del creador en toda la wallet.
 *
 * Antes cada pestaña y cada tarjeta repetía su propio `formatMoney` —quince copias del
 * mismo lambda— y bastaba con que una usara `pf.format` para inflarle el saldo: esa es la
 * fórmula del precio del COMPRADOR (convierte, suma el 2% de colchón FX y redondea al
 * escalón comercial). El dinero que el creador ya ganó no lleva nada de eso.
 *
 * Aquí hay dos lecturas y ninguna inventa cifras:
 *
 * - `usd`   → `formatAnchor`: la cifra tal cual se liquida, sin conversión.
 * - `local` → `formatPlain`: conversión limpia al tipo de cambio de hoy, sin margen.
 *
 * `refLocal` es la guía pequeña bajo la cifra. Solo tiene sentido en modo USD: en modo
 * local la cifra grande YA está en su moneda y repetirla debajo sería ruido.
 */
export type WalletMoney = {
  mode: WalletCurrencyMode;
  /** Moneda anclada en el switch global de la plataforma. */
  localCurrency: string;
  /** ¿Hay algo que elegir? No, si su moneda ya es la de liquidación. */
  hasLocalOption: boolean;
  /** ¿Las cifras se están pintando en su moneda local? */
  showingLocal: boolean;
  /** Formatea un monto EN USD (como se guarda) según el modo activo. */
  formatMoney: (amount: number, opts?: { code?: boolean }) => string;
  /** Guía "Aproximadamente …" en su moneda. `null` cuando no aplica. */
  refLocal: (amount: number) => string | null;
  /**
   * Siempre en la moneda de liquidación, ignorando el switch.
   *
   * Para lo que NO es una lectura sino un DOCUMENTO: el panel fiscal del retiro produce
   * las cifras que el creador copia a su CFDI. Ahí una conversión al cambio de hoy no es
   * una guía, es un dato que se factura mal.
   */
  formatSettlement: (amount: number, opts?: { code?: boolean }) => string;
};

export function useWalletMoney(): WalletMoney {
  const pf = usePriceFormat();
  const mode = useWalletCurrencyMode();

  const hasLocalOption = pf.currency !== SETTLEMENT_CURRENCY;
  const showingLocal = hasLocalOption && mode === "local";

  const formatMoney = useCallback(
    (amount: number, opts: { code?: boolean } = {}) =>
      showingLocal
        ? pf.formatPlain(amount, { baseCurrency: SETTLEMENT_CURRENCY, code: opts.code ?? false })
        : pf.formatAnchor(amount, { code: opts.code ?? false }),
    [showingLocal, pf]
  );

  const refLocal = useCallback(
    (amount: number): string | null =>
      hasLocalOption && !showingLocal
        ? pf.formatPlain(amount, { baseCurrency: SETTLEMENT_CURRENCY, code: true })
        : null,
    [hasLocalOption, showingLocal, pf]
  );

  const formatSettlement = useCallback(
    (amount: number, opts: { code?: boolean } = {}) => pf.formatAnchor(amount, { code: opts.code ?? false }),
    [pf]
  );

  return {
    mode,
    localCurrency: pf.currency,
    hasLocalOption,
    showingLocal,
    formatMoney,
    refLocal,
    formatSettlement,
  };
}
