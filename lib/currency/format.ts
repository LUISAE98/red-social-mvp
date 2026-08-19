// Conversión y formateo de montos. Puro (usable en servidor y cliente).
//
// Regla de oro: nunca se guarda un monto convertido. Se guarda USD (ancla de
// referencia) y se convierte en el momento de mostrar/cobrar en la moneda local.

import { intlLocale } from "@/i18n/locales";
import {
  ANCHOR_CURRENCY,
  FX_CONVERSION_FEE,
  fxConversionFeeForCurrency,
  type DisplayCurrency,
} from "./catalog";

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
  // --- Oceanía ---
  PGK: 0.5, //   1 USD ≈ 4.0 PGK  → 0.5 PGK ≈ 0.13 USD.
  // ⚠️ El franco CFP es moneda SIN decimales para Stripe. El paso tiene que ser entero.
  XPF: 50, //    1 USD ≈ 110 XPF  → 50 XPF ≈ 0.45 USD. Anclado al euro (119,33 XPF = 1 EUR).
  FJD: 0.5, //   1 USD ≈ 2.25 FJD → 0.5 FJD ≈ 0.22 USD.
  // --- África ---
  ZAR: 5, //     1 USD ≈ 18 ZAR   → 5 ZAR  ≈ 0.28 USD. Mismo paso que el peso mexicano.
  EGP: 10, //    1 USD ≈ 48 EGP   → 10 EGP ≈ 0.21 USD. Con paso 5 quedaría en 0.10, muy fino.
  // --- Norteamérica ---
  CAD: 0.5, //   1 USD ≈ 1.37 CAD → 0.5 CAD ≈ 0.36 USD. Mismo paso que el ancla.
  // --- Europa NO comunitaria (2ª tanda) ---
  GBP: 0.5, //   1 USD ≈ 0.78 GBP → 0.5 GBP ≈ 0.64 USD. Algo grueso, pero el precio
  //             británico se cotiza en múltiplos de 0,50 y 0,99.
  TRY: 5, //     1 USD ≈ 41 TRY   → 5 TRY  ≈ 0.12 USD. La lira se devalúa: revisar el paso
  //             si el precio empieza a verse raro.
  RSD: 20, //    1 USD ≈ 101 RSD  → 20 RSD ≈ 0.20 USD.
  ALL: 10, //    1 USD ≈ 83 ALL   → 10 ALL ≈ 0.12 USD. El lek no usa subdivisiones.
  MDL: 5, //     1 USD ≈ 17.5 MDL → 5 MDL  ≈ 0.29 USD.
  // --- Asia y Golfo (2ª tanda) ---
  // ⚠️ KRW y VND son monedas SIN decimales para Stripe: el paso debe ser entero.
  KRW: 500, //   1 USD ≈ 1.390 KRW  → 500 KRW ≈ 0.36 USD. El won no usa subdivisiones.
  VND: 5000, //  1 USD ≈ 26.000 VND → 5.000 VND ≈ 0.19 USD. Nadie cotiza en dongs sueltos.
  AED: 1, //     1 USD ≈ 3.67 AED   → 1 AED ≈ 0.27 USD. Anclado al dólar.
  SAR: 1, //     1 USD ≈ 3.75 SAR   → 1 SAR ≈ 0.27 USD. Anclado al dólar.
  // --- África (2ª tanda) ---
  NGN: 200, //   1 USD ≈ 1.550 NGN → 200 NGN ≈ 0.13 USD. La naira se devaluó muchísimo:
  //             revisar el paso si el precio empieza a verse raro.
  MAD: 2, //     1 USD ≈ 9.2 MAD   → 2 MAD ≈ 0.22 USD.
  // --- Microestados del Pacífico ---
  TOP: 0.5, //   1 USD ≈ 2.4 TOP   → 0.5 TOP ≈ 0.21 USD.
  SBD: 2, //     1 USD ≈ 8.5 SBD   → 2 SBD ≈ 0.24 USD.
  // ⚠️ El vatu es moneda SIN decimales para Stripe: el paso debe ser entero.
  VUV: 20, //    1 USD ≈ 120 VUV   → 20 VUV ≈ 0.17 USD.
  WST: 0.5, //   1 USD ≈ 2.8 WST   → 0.5 WST ≈ 0.18 USD.
  // --- Caribe ---
  SRD: 5, //     1 USD ≈ 38 SRD   → 5 SRD  ≈ 0.13 USD.
  BZD: 0.5, //   1 USD = 2 BZD    → 0.5 BZD ≈ 0.25 USD. Anclado 2:1 al dólar.
  TTD: 1, //     1 USD ≈ 6.8 TTD  → 1 TTD  ≈ 0.15 USD.
  JMD: 20, //    1 USD ≈ 158 JMD  → 20 JMD ≈ 0.13 USD.
  KYD: 0.25, //  1 USD ≈ 0.82 KYD → 0.25 KYD ≈ 0.30 USD. Anclado al dólar.
  BMD: 0.5, //   1 USD = 1 BMD    → 0.5 BMD = 0.50 USD. Anclado 1:1, igual que el ancla.
  XCD: 0.5, //   1 USD ≈ 2.7 XCD  → 0.5 XCD ≈ 0.19 USD. Anclado al dólar.
  HTG: 20, //    1 USD ≈ 132 HTG  → 20 HTG ≈ 0.15 USD.
  GIP: 0.5, //   La libra gibraltareña está anclada 1:1 a la esterlina: mismo paso que GBP.
  AZN: 0.5, //   1 USD ≈ 1.7 AZN  → 0.5 AZN ≈ 0.29 USD.
  // --- Asia (3ª tanda) ---
  LKR: 50, //    1 USD ≈ 300 LKR   → 50 LKR ≈ 0.17 USD.
  KHR: 500, //   1 USD ≈ 4.000 KHR → 500 KHR ≈ 0.13 USD.
  NPR: 20, //    1 USD ≈ 140 NPR   → 20 NPR ≈ 0.14 USD.
  // ⚠️ El ngultrum está anclado 1:1 a la rupia india y casi no se usa fuera de Bután:
  // confirmar que Stripe lo acepte como moneda de presentación antes de pasar a producción.
  BTN: 10, //    1 USD ≈ 87 BTN    → 10 BTN ≈ 0.11 USD.
  BND: 0.5, //   1 USD ≈ 1.34 BND  → 0.5 BND ≈ 0.37 USD. Anclado 1:1 al dólar de Singapur.
  MNT: 500, //   1 USD ≈ 3.500 MNT → 500 MNT ≈ 0.14 USD.
  MVR: 2, //     1 USD ≈ 15.4 MVR  → 2 MVR ≈ 0.13 USD.
  // --- África (3ª tanda) ---
  BWP: 2, //     1 USD ≈ 13.5 BWP  → 2 BWP ≈ 0.15 USD.
  // ⚠️ El franco CFA es moneda SIN decimales para Stripe: el paso debe ser entero.
  XOF: 100, //   1 USD ≈ 570 XOF   → 100 XOF ≈ 0.18 USD. Anclado al euro (655,957 = 1 EUR).
};

/** Redondea a un múltiplo "bonito" según la moneda. Para etiquetas de precio, no para cobrar. */
export function roundNice(amount: number, currency: DisplayCurrency): number {
  const step = NICE_STEP[currency] ?? 1;
  if (step <= 0) return amount;
  return Math.round(amount / step) * step;
}

/** Monedas sin decimales. ⚠️ Espejo de ZERO_DECIMAL en backend/src/tax/presentmentFormat.ts. */
const SIN_DECIMALES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
/** Dinares: tres decimales y Stripe exige último dígito 0. ⚠️ Espejo del backend. */
const TRES_DECIMALES = new Set(["KWD", "JOD", "BHD", "OMR", "TND"]);

/**
 * Redondeo COMERCIAL del total: `.99` o `.00`, el que quede más cerca por arriba.
 *
 * ⚠️ ESPEJO EXACTO de `roundCharm` en backend/src/tax/presentmentFormat.ts. El backend no
 * puede importar de `lib/`, así que está duplicado a mano y hay un test de paridad. Si los
 * dos se separan, el comprador ve un precio y se le cobra otro — que es justo el bug que
 * este redondeo vino a cerrar, no a abrir.
 */
export function roundCharm(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount <= 0) return amount;
  const code = currency.toUpperCase();

  if (SIN_DECIMALES.has(code)) {
    const step = NICE_STEP[code as DisplayCurrency] ?? 1;
    if (step <= 1) return Math.ceil(amount);
    const arriba = Math.ceil(amount / step) * step;
    const charm = arriba - 1;
    return charm >= amount ? charm : arriba + step - 1;
  }

  if (TRES_DECIMALES.has(code)) {
    const step = NICE_STEP[code as DisplayCurrency] ?? 1;
    return Math.ceil(amount / step) * step;
  }

  let con99 = Math.floor(amount) + 0.99;
  if (con99 < amount) con99 += 1;
  const con00 = Math.ceil(amount);
  return Math.round(Math.min(con99, con00) * 100) / 100;
}

/**
 * Igual que `buyerPrice` pero SIN el redondeo a paso: convierte y aplica el cargo de FX,
 * nada más.
 *
 * Existe porque el TOTAL que se le cobra al comprador se compone en el backend sin ese
 * redondeo intermedio (`composeCharge` → `applyCharmRounding`), y solo se redondea al final.
 * Usar `buyerPrice` para el total daba un número distinto al cobrado: con base 10 USD y
 * comprador mexicano, el backend cobraba 209.99 y la UI mostraba 208.80.
 */
export function buyerPriceExact(
  usdAmount: number,
  currency: DisplayCurrency,
  rates: RateMap
): number | null {
  if (currency === ANCHOR_CURRENCY) return usdAmount;
  const raw = convertFromAnchor(usdAmount, currency, rates);
  if (raw == null) return null;
  return raw * (1 + fxConversionFeeForCurrency(currency));
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
  // El cargo depende de la MONEDA: casi todas llevan el 2% estándar, pero algunas tienen
  // un ajuste propio (ver FX_CONVERSION_FEE_BY_CURRENCY en catalog.ts).
  return roundNice(raw * (1 + fxConversionFeeForCurrency(currency)), currency);
}

// Locale de FORMATEO por idioma: fija el símbolo antes del número y el separador
// decimal correcto (el genérico "es" pone el símbolo al final, se ve raro).
// Sale de i18n/locales.ts (campo `intl`), la fuente única de idiomas.

/**
 * Formatea un monto en su moneda usando Intl: símbolo normal antes del número,
 * decimales según la propia moneda (CLP/COP/PYG sin decimales, etc.).
 *
 * Con `code: true` añade el código ISO al final para desambiguar el "$", que en Vibra
 * es genuinamente ambiguo: se muestran precios en 78 monedas y muchas comparten símbolo
 * (MXN, USD, ARS, CLP, COP…).
 *
 * 🚨 EL CÓDIGO NO SE PEGA A CIEGAS 🚨
 *
 * `narrowSymbol` NO garantiza un símbolo: cuando el locale no conoce un símbolo corto
 * para esa moneda, Intl usa **el propio código ISO como símbolo**. En finés, MXN se
 * formatea "83,52 MXN". Si encima le concatenamos el código sale "83,52 MXN MXN" —que es
 * exactamente el bug que se veía en la app en finés—, mientras que en español, donde sí
 * hay símbolo, salía bien y por eso pasó desapercibido.
 *
 * Por eso se inspecciona con `formatToParts` qué puso Intl de símbolo y solo se añade el
 * código cuando NO es ya el código.
 */
export function formatCurrency(
  amount: number,
  currency: string,
  locale: string,
  opts: { approx?: boolean; code?: boolean } = {}
): string {
  const loc = intlLocale(locale);
  try {
    const nf = new Intl.NumberFormat(loc, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    });
    const text = nf.format(amount);
    if (!opts.code) return text;
    const iso = currency.toUpperCase();
    const shown = nf.formatToParts(amount).find((p) => p.type === "currency")?.value ?? "";
    return shown.toUpperCase() === iso ? text : `${text} ${iso}`;
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
