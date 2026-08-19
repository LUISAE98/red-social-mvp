// Composición del precio final de un cobro. FUENTE ÚNICA.
//
// Antes cada uno de los 8 intents de Stripe repetía a mano:
//     const published = round2(base + FIXED_SERVICE_FEE_USD);
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
import { FIXED_SERVICE_FEE_USD, SETTLEMENT_CURRENCY } from "../wallet/ledger";
import type { LedgerServiceType } from "../wallet/ledger";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ChargeComposition = {
  /** País fiscal aplicado (ya resuelto por el servidor). */
  buyerCountry: string;

  // ── Composición, toda en la moneda de liquidación (USD) ──
  /** Precio del creador. Es la base del reparto 75/25. */
  baseAmount: number;
  /** Cargo fijo de Vibra por transacción. */
  fixedFee: number;
  /** base + cargo fijo. */
  publishedAmount: number;
  /** Tasa del cargo por conversión (0.02 donde la moneda del país no es la de liquidación). */
  fxFeeRate: number;
  /** Monto del cargo por conversión. NO es impuesto: es costo/comisión. */
  fxFeeAmount: number;
  /** Base gravable: publicado + FX (+ el ajuste de redondeo). Sobre esto corre el impuesto. */
  taxableAmount: number;
  /**
   * Sobrante del redondeo comercial: lo que subió el total al dejarlo en `.99`/`.00`.
   * Es INGRESO de Vibra y va DENTRO de la base gravable, porque es contraprestación como
   * el cargo fijo. Cero mientras no se redondee. Nunca es negativo: `roundCharm` solo sube.
   */
  roundingAdjustment: number;

  // ── Impuesto del país del comprador ──
  buyerTax: {
    name: string | null;
    /** Tasa vigente del país, aunque no se cobre. */
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

  /** TOTAL a cobrar al comprador, en la moneda de liquidación. */
  chargedAmount: number;
  /** Moneda canónica de liquidación (USD). */
  settlementCurrency: string;
  /** Moneda en la que se le MUESTRA el precio al comprador. */
  displayCurrency: string;
};

/**
 * Compone el cobro completo para un país ya resuelto por el servidor.
 *
 * Orden (invariable, ver impuestos.md §2):
 *     base + cargo fijo  →  + 2% FX  →  + impuesto del país  =  total
 *
 * El 2% va ANTES del impuesto porque es parte de la contraprestación que cobra Vibra, así que
 * forma parte de la base gravable. No es impuesto y nunca se declara como tal.
 *
 * @param base   Precio del creador en USD (sin cargo fijo, sin FX, sin impuesto).
 * @param country País fiscal YA RESUELTO por `resolveTaxCountry`. Nunca uno propuesto por el cliente.
 */
export function composeCharge(
  base: number,
  country: string,
  opts?: { fixedFee?: number; serviceType?: LedgerServiceType | null }
): ChargeComposition {
  const baseAmount = round2(base);
  const fixedFee = opts?.fixedFee ?? FIXED_SERVICE_FEE_USD;
  const publishedAmount = round2(baseAmount + fixedFee);

  // 2% de conversión: solo cuando se cobra en una moneda distinta a la de liquidación.
  const fxFeeRate = fxFeeRateForCountry(country);
  const fxFeeAmount = round2(publishedAmount * fxFeeRate);
  const taxableAmount = round2(publishedAmount + fxFeeAmount);

  // El impuesto solo se SUMA si Vibra es quien lo entera. Donde lo percibe la emisora
  // `taxAmount` sale en 0 y el comprador no lo paga dos veces.
  const tax = applyConsumptionTax(taxableAmount, country, opts?.serviceType);

  return {
    buyerCountry: country.toUpperCase(),

    baseAmount,
    fixedFee,
    publishedAmount,
    fxFeeRate,
    fxFeeAmount,
    taxableAmount,
    roundingAdjustment: 0,

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
 * Recompone el desglose cuando el TOTAL cambió por el redondeo comercial.
 *
 * EL PROBLEMA. `composeCharge` va hacia adelante: base → +fijo → +FX → +impuesto = total.
 * El redondeo comercial se aplica al FINAL, sobre el total ya convertido a la moneda del
 * comprador, así que rompe esa cadena: el total cobrado deja de ser la suma de las partes
 * y el desglose que se guarda en el `paymentIntent` ya no cuadra con lo que se cobró. Un
 * desglose que no cuadra con el cargo no sirve para declarar el impuesto ni para conciliar.
 *
 * LA SOLUCIÓN es despejar hacia ATRÁS desde el total limpio:
 *
 *     gravable = total ÷ (1 + tasa)
 *     impuesto = total − gravable
 *     sobrante = gravable − gravable_original
 *
 * Lo que NO se toca, y es deliberado:
 *   · `baseAmount` — es el precio del creador y de ahí sale su 75%. El redondeo es de
 *     Vibra; que el creador gane más o menos según cómo cayó un decimal sería absurdo.
 *   · `fixedFee` y `fxFeeAmount` — son importes fijos ya devengados.
 *
 * El sobrante entra a la base gravable, no fuera: es contraprestación de Vibra igual que el
 * cargo fijo, así que **paga impuesto**. Meterlo fuera sería cobrar dinero no declarado.
 */
export function recomposeWithCharged(
  c: ChargeComposition,
  chargedAmount: number
): ChargeComposition {
  const total = round2(chargedAmount);
  if (!Number.isFinite(total) || total <= 0 || total === c.chargedAmount) return c;

  // Solo se despeja el impuesto que COBRA Vibra. Donde lo percibe la emisora, `amount` es 0
  // y el total no lo incluye: ahí el sobrante entero es base gravable.
  const rate = c.buyerTax.collectedByPlatform ? c.buyerTax.rate : 0;
  const taxableAmount = round2(total / (1 + rate));
  const taxAmount = round2(total - taxableAmount);
  const roundingAdjustment = round2(taxableAmount - (c.publishedAmount + c.fxFeeAmount));

  // El devengo de IVA mexicano (export_taxable) corre sobre la base gravable, así que si
  // esta creció, la deuda con el SAT crece en la misma proporción.
  const mxVatAccrued =
    c.mxVat.accruedAmount > 0 && c.taxableAmount > 0
      ? round2((c.mxVat.accruedAmount / c.taxableAmount) * taxableAmount)
      : c.mxVat.accruedAmount;

  return {
    ...c,
    taxableAmount,
    roundingAdjustment,
    buyerTax: { ...c.buyerTax, amount: taxAmount },
    mxVat: { ...c.mxVat, accruedAmount: mxVatAccrued },
    chargedAmount: total,
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
    roundingAdjustment: c.roundingAdjustment,

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
