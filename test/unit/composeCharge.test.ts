import { describe, it, expect, vi } from "vitest";

// `wallet/ledger` inicializa el Admin SDK al importarse; aquí solo se prueban funciones
// puras de composición de precio, así que se stubea.
vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: () => undefined,
  firestore: Object.assign(() => ({}), {
    FieldValue: { serverTimestamp: () => null },
    Timestamp: { now: () => null },
  }),
}));

import { composeCharge, recomposeWithCharged } from "../../backend/src/tax/composeCharge";
import { roundCharm } from "../../backend/src/tax/presentmentFormat";
import { resolveTaxCountryFromIndicios } from "../../backend/src/tax/resolveCountry";
import { COUNTRY_TAX_CONFIG } from "../../backend/src/tax/config";

/**
 * País SIN ficha, elegido en tiempo de ejecución: fijarlo a mano ya puso el CI en
 * rojo dos veces al habilitarse el país que servía de centinela (AR, luego JP).
 * Mismo criterio que en `tax.test.ts`.
 */
const UNCONFIGURED =
  ["AQ", "GS", "HM", "BV", "TF", "UM", "PN", "IO", "ZZ"].find(
    (code) => !(code in COUNTRY_TAX_CONFIG),
  ) ?? "ZZ";

// Composición del precio: base + cargo fijo → +2% FX → + impuesto (solo si lo cobra Vibra).
// Orden y justificación: impuestos.md §2.
describe("backend/tax/composeCharge", () => {
  describe("🇲🇽 México — Vibra cobra el 16%", () => {
    const c = composeCharge(100, "MX");

    it("suma el cargo fijo de $0.40", () => {
      expect(c.baseAmount).toBe(100);
      expect(c.fixedFee).toBe(0.4);
      expect(c.publishedAmount).toBe(100.4);
    });

    // 🔄 Se INVIRTIÓ con el corte a USD (2026-08-18). Con liquidación en pesos, México
    // era el único país sin cargo de conversión; ahora es al revés y el que no lo lleva
    // es Estados Unidos. La regla no se tocó —sigue siendo "moneda del país ≠ moneda de
    // liquidación"—, lo que cambió es de qué lado cae México.
    it("SÍ lleva 2% de conversión: su moneda ya no es la de liquidación", () => {
      expect(c.fxFeeRate).toBe(0.02);
      expect(c.fxFeeAmount).toBe(2.01); // 100.40 × 0.02
      expect(c.taxableAmount).toBe(102.41);
      expect(c.displayCurrency).toBe("MXN");
    });

    it("cobra el 16% y lo suma al total", () => {
      expect(c.buyerTax.rate).toBe(0.16);
      expect(c.buyerTax.amount).toBe(16.39); // 102.41 × 0.16
      expect(c.buyerTax.collectedByPlatform).toBe(true);
      expect(c.chargedAmount).toBe(118.8);
    });

    it("no devenga IVA mexicano aparte: ya está cobrado como impuesto del comprador", () => {
      expect(c.mxVat.treatment).toBe("domestic_16");
      expect(c.mxVat.accruedAmount).toBe(0);
    });
  });

  // País sin ficha: no cobrable. Hoy MX es el único habilitado; los demás se abrirán con
  // Stripe Tax, que informa por país el registro y las obligaciones. Ver impuestos.md.
  describe("país sin ficha", () => {
    const c = composeCharge(100, UNCONFIGURED);

    it("no aplica impuesto ni conversión", () => {
      expect(c.buyerTax.rate).toBe(0);
      expect(c.buyerTax.amount).toBe(0);
      expect(c.buyerTax.collectionMode).toBe("none");
      expect(c.fxFeeAmount).toBe(0);
      expect(c.chargedAmount).toBe(100.4); // solo base + cargo fijo
    });
  });

  // La resolución de país es independiente de qué países estén habilitados: decide QUIÉN es
  // el comprador. La chequeo de cobrabilidad va después. Ver impuestos.md §3.
  describe("Fase 2 — la tarjeta corrige lo que estimó la IP", () => {
    const fase1 = resolveTaxCountryFromIndicios({
      billingAddress: null,
      cardCountry: null, // aún no hay tarjeta
      ipCountry: "CO",
      phoneCountry: null,
    });
    const fase2 = resolveTaxCountryFromIndicios({
      billingAddress: null,
      cardCountry: "MX", // ya se leyó el BIN
      ipCountry: "CO",
      phoneCountry: null,
    });

    it("fase 1 estima por la IP", () => {
      expect(fase1.country).toBe("CO");
      expect(fase1.source).toBe("ip");
    });

    it("fase 2 corrige a México al leer la tarjeta", () => {
      expect(fase2.country).toBe("MX");
      // Basta un indicio hacia México (Art. 18-C), aunque venga de la tarjeta.
      expect(fase2.source).toBe("mx_rule");
      expect(fase2.hadConflict).toBe(true);
    });

    // Antes Colombia no tenía ficha y este test comparaba "algo contra nada". Desde que
    // Colombia cobra (2026-08-11) compara dos impuestos reales, que es el caso que importa:
    // la tarjeta no solo agrega impuesto, puede CAMBIARLO de país.
    it("al corregir a México cambia el impuesto: 19% colombiano → 16% mexicano", () => {
      // Fase 1 — IP colombiana: 19% sobre (base + cargo fijo) + 2% de conversión.
      expect(composeCharge(100, fase1.country).buyerTax.amount).toBeCloseTo(19.46, 2);
      // Fase 2 — tarjeta mexicana: 16%. Desde el corte a USD el peso TAMBIÉN lleva
      // el 2% de conversión, así que lo que distingue a México ya no es la ausencia de
      // FX sino la tasa del impuesto.
      expect(composeCharge(100, fase2.country).chargedAmount).toBe(118.8);
      expect(composeCharge(100, fase2.country).fxFeeAmount).toBe(2.01);
    });
  });

  describe("invariantes", () => {
    it("el total siempre es base + fijo + FX + impuesto cobrado", () => {
      for (const country of ["MX", "AR", "JP"]) {
        for (const base of [50, 99.99, 1234.56]) {
          const c = composeCharge(base, country);
          const suma = c.baseAmount + c.fixedFee + c.fxFeeAmount + c.buyerTax.amount;
          expect(c.chargedAmount).toBeCloseTo(suma, 2);
        }
      }
    });

    it("el devengo de IVA mexicano NUNCA está dentro de lo que paga el comprador", () => {
      // En "export_taxable" Vibra debe el 16% pero no se lo traslada al extranjero.
      for (const country of ["MX", "AR", "JP"]) {
        const c = composeCharge(100, country);
        // toBeCloseTo, no toBe: sumar los componentes en crudo arrastra el error de
        // coma flotante (100 + 0.4 + 2.01 + 16.39 da 118.80000000000001), mientras que
        // composeCharge redondea a dos decimales. Comparar dinero con igualdad exacta de
        // floats es la fragilidad, no el invariante.
        expect(c.chargedAmount).toBeCloseTo(
          c.baseAmount + c.fixedFee + c.fxFeeAmount + c.buyerTax.amount, 2
        );
      }
    });
  });
});

// Despeje HACIA ATRÁS del desglose cuando el redondeo comercial cambia el total.
// Es lo que hace que el `paymentIntent` cuadre con lo que de verdad se cobró; si no cuadra,
// no sirve ni para declarar el impuesto ni para conciliar contra Stripe.
describe("recomposeWithCharged — el desglose cuadra con el total redondeado", () => {
  it("despeja el impuesto desde el total, sin tocar la base del creador", () => {
    const c = composeCharge(100, "MX");
    const r = recomposeWithCharged(c, 118.99); // 118.80 → 118.99

    expect(r.chargedAmount).toBe(118.99);
    // 🚨 Lo que el creador gana NO puede depender de cómo cayó un decimal del redondeo.
    expect(r.baseAmount).toBe(c.baseAmount);
    expect(r.fixedFee).toBe(c.fixedFee);
    expect(r.fxFeeAmount).toBe(c.fxFeeAmount);
    // gravable = total ÷ 1.16 ; impuesto = el resto
    expect(r.taxableAmount).toBeCloseTo(118.99 / 1.16, 2);
    expect(r.buyerTax.amount).toBeCloseTo(118.99 - 118.99 / 1.16, 2);
  });

  it("🚨 el total siempre es base + fijo + FX + sobrante + impuesto", () => {
    for (const country of ["MX", "DE", "AR", "JP", "US"]) {
      for (const base of [1.5, 10, 99.99, 1234.56]) {
        const c = composeCharge(base, country);
        const r = recomposeWithCharged(c, roundCharm(c.chargedAmount, "USD"));
        const suma =
          r.baseAmount + r.fixedFee + r.fxFeeAmount + r.roundingAdjustment + r.buyerTax.amount;
        expect(r.chargedAmount, `${country} ${base}`).toBeCloseTo(suma, 2);
      }
    }
  });

  it("🚨 el sobrante del redondeo NUNCA es negativo (sería cobrar de menos)", () => {
    for (const country of ["MX", "DE", "JP", "US"]) {
      for (const base of [1.5, 10, 99.99, 1234.56]) {
        const c = composeCharge(base, country);
        const r = recomposeWithCharged(c, roundCharm(c.chargedAmount, "USD"));
        expect(r.roundingAdjustment, `${country} ${base}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("donde el impuesto lo cobra la EMISORA, el sobrante entero es base gravable", () => {
    // AR: `collectionMode: "issuer"` → Vibra no cobra impuesto, `amount` queda en 0.
    const c = composeCharge(100, "AR");
    expect(c.buyerTax.collectedByPlatform).toBe(false);
    const r = recomposeWithCharged(c, c.chargedAmount + 1);
    expect(r.buyerTax.amount).toBe(0);
    expect(r.taxableAmount).toBeCloseTo(c.taxableAmount + 1, 2);
    expect(r.roundingAdjustment).toBeCloseTo(1, 2);
  });

  it("si el total no cambia, devuelve la composición intacta", () => {
    const c = composeCharge(100, "MX");
    expect(recomposeWithCharged(c, c.chargedAmount)).toBe(c);
  });
});
