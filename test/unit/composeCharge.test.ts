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

import { composeCharge } from "../../backend/src/tax/composeCharge";
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

// Composición del precio: base + $3 → +2% FX → + impuesto (solo si lo cobra Vibra).
// Orden y justificación: impuestos.md §2.
describe("backend/tax/composeCharge", () => {
  describe("🇲🇽 México — Vibra cobra el 16%", () => {
    const c = composeCharge(100, "MX");

    it("suma el cargo fijo de $3", () => {
      expect(c.baseAmount).toBe(100);
      expect(c.fixedFee).toBe(3);
      expect(c.publishedAmount).toBe(103);
    });

    it("NO lleva 2% de conversión: cobra en la moneda de liquidación", () => {
      expect(c.fxFeeRate).toBe(0);
      expect(c.fxFeeAmount).toBe(0);
      expect(c.taxableAmount).toBe(103);
      expect(c.displayCurrency).toBe("MXN");
    });

    it("cobra el 16% y lo suma al total", () => {
      expect(c.buyerTax.rate).toBe(0.16);
      expect(c.buyerTax.amount).toBe(16.48); // 103 × 0.16
      expect(c.buyerTax.collectedByPlatform).toBe(true);
      expect(c.chargedAmount).toBe(119.48);
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
      expect(c.chargedAmount).toBe(103); // solo base + $3
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

    it("al corregir a México entra el 16%", () => {
      expect(composeCharge(100, fase1.country).buyerTax.amount).toBe(0); // país sin ficha
      expect(composeCharge(100, fase2.country).chargedAmount).toBe(119.48);
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
        expect(c.chargedAmount).toBe(
          c.baseAmount + c.fixedFee + c.fxFeeAmount + c.buyerTax.amount
        );
      }
    });
  });
});
