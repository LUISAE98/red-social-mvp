// Composición del precio final de un cobro. FUENTE ÚNICA.
//
// Antes cada uno de los 8 intents de Stripe repetía a mano:
//     const published = round2(base + FIXED_SERVICE_FEE_MXN);
//     const tax = applyConsumptionTax(published, country);
//     const totalMxn = round2(published + tax.taxAmount);
// …y ninguno aplicaba el 2% de FX (estaba definido en la config y no se invocaba en ningún lado).
//
// Aquí vive el orden de operaciones completo, una sola vez. Ver `impuestos.md` §2.

import {
  applyConsumptionTax,
  chargeCurrencyForCountry,
  fxFeeRateForCountry,
  taxNameForCountry,
  type MxVatTreatment,
  type TaxCollectionMode,
} from "./config";
import { FIXED_SERVICE_FEE_MXN, SETTLEMENT_CURRENCY } from "../wallet/ledger";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ChargeComposition = {
  /** País fiscal aplicado (ya resuelto por el servidor). */
  buyerCountry: string;

  // ── Composición, toda en MXN canónico ──
  /** Precio del creador. Es la base del reparto 75/25. */
  baseAmount: number;
  /** Cargo fijo de Vibra por transacción. */
  fixedFee: number;
  /** base + cargo fijo. */
  publishedAmount: number;
  /** Tasa del cargo por conversión (0.02 fuera de México, 0 en México). */
  fxFeeRate: number;
  /** Monto del cargo por conversión. NO es impuesto: es costo/comisión. */
  fxFeeAmount: number;
  /** Base gravable: publicado + FX. Sobre esto corre el impuesto. */
  taxableAmount: number;

  // ── Impuesto del país del comprador ──
  buyerTax: {
    name: string | null;
    /** Tasa vigente del país, aunque no se cobre (AR: 0.21). */
    rate: number;
    /** Monto efectivamente cobrado. 0 si lo percibe la emisora. */
    amount: number;
    collectionMode: TaxCollectionMode;
    collectedByPlatform: boolean;
  };

  // ── IVA mexicano de la venta de Vibra ──
  mxVat: {
    treatment: MxVatTreatment;
    /**
     * Devengado que Vibra debe al SAT y NO trasladó al comprador (solo en "export_taxable").
     * Sale del margen. NUNCA está incluido en `chargedAmount`.
     */
    accruedAmount: number;
  };

  /** TOTAL a cobrar al comprador, en MXN. */
  chargedAmount: number;
  /** Moneda canónica de liquidación (siempre MXN). */
  settlementCurrency: string;
  /** Moneda en la que se le MUESTRA el precio al comprador. */
  displayCurrency: string;
};

/**
 * Compone el cobro completo para un país ya resuelto por el servidor.
 *
 * Orden (invariable, ver impuestos.md §2):
 *     base + $3  →  + 2% FX  →  + impuesto del país  =  total
 *
 * El 2% va ANTES del impuesto porque es parte de la contraprestación que cobra Vibra, así que
 * forma parte de la base gravable. No es impuesto y nunca se declara como tal.
 *
 * @param base   Precio del creador en MXN (sin cargo fijo, sin FX, sin impuesto).
 * @param country País fiscal YA RESUELTO por `resolveTaxCountry`. Nunca uno propuesto por el cliente.
 */
export function composeCharge(
  base: number,
  country: string,
  opts?: { fixedFee?: number }
): ChargeComposition {
  const baseAmount = round2(base);
  const fixedFee = opts?.fixedFee ?? FIXED_SERVICE_FEE_MXN;
  const publishedAmount = round2(baseAmount + fixedFee);

  // 2% de conversión: solo cuando se cobra en una moneda distinta a la de liquidación.
  const fxFeeRate = fxFeeRateForCountry(country);
  const fxFeeAmount = round2(publishedAmount * fxFeeRate);
  const taxableAmount = round2(publishedAmount + fxFeeAmount);

  // El impuesto solo se SUMA si Vibra es quien lo entera. Donde lo percibe la emisora
  // (Argentina, Costa Rica, Paraguay), `taxAmount` sale en 0 y el comprador no lo paga dos veces.
  const tax = applyConsumptionTax(taxableAmount, country);

  return {
    buyerCountry: country.toUpperCase(),

    baseAmount,
    fixedFee,
    publishedAmount,
    fxFeeRate,
    fxFeeAmount,
    taxableAmount,

    buyerTax: {
      name: taxNameForCountry(country),
      rate: tax.taxRate,
      amount: tax.taxAmount,
      collectionMode: tax.collectionMode,
      collectedByPlatform: tax.collectedByPlatform,
    },

    mxVat: {
      treatment: tax.mxVatTreatment,
      accruedAmount: tax.mxVatAccruedAmount,
    },

    chargedAmount: tax.chargedAmount,
    settlementCurrency: SETTLEMENT_CURRENCY,
    displayCurrency: chargeCurrencyForCountry(country),
  };
}

/**
 * Aplana la composición a los campos que ya escribe cada `paymentIntent`, para poder
 * hacer `...chargeFields(composition)` sin reescribir los 8 intents.
 */
export function chargeFields(c: ChargeComposition) {
  return {
    baseAmount: c.baseAmount,
    fixedFee: c.fixedFee,
    publishedAmount: c.publishedAmount,

    fxFeeRate: c.fxFeeRate,
    fxFeeAmount: c.fxFeeAmount,
    taxableAmount: c.taxableAmount,

    // Compatibilidad con los campos históricos del paymentIntent.
    taxCountry: c.buyerCountry,
    taxRate: c.buyerTax.rate,
    taxAmount: c.buyerTax.amount,

    // Desglose nuevo (impuestos.md §4.2).
    buyerTax: c.buyerTax,
    mxVat: c.mxVat,

    chargedAmount: c.chargedAmount,
    settlementCurrency: c.settlementCurrency,
    settlementAmount: c.chargedAmount,
    displayCurrency: c.displayCurrency,
  };
}
