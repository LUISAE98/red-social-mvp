import { describe, it, expect } from "vitest";
import {
  computeConsumptionTax,
  countryTaxConfig,
  taxRateForCountry,
  chargeCurrencyForCountry,
  shouldAddFxFee,
  fxFeeRateForCountry,
  isChargeableCountry,
} from "@/lib/tax/config";

// Impuesto al consumo (IVA). Vibra es retenedor: el desglose base/impuesto/total
// debe ser exacto. El impuesto lo determina el país del COMPRADOR, no el creador.
describe("lib/tax/config", () => {
  describe("computeConsumptionTax", () => {
    it("México: IVA 16% sumado sobre la base", () => {
      const b = computeConsumptionTax(100, "MX");
      expect(b).toMatchObject({
        taxCountry: "MX",
        rate: 0.16,
        taxName: "IVA",
        base: 100,
        tax: 16,
        total: 116,
        applies: true,
      });
    });

    it("país sin impuesto configurado (aún): sin IVA", () => {
      // AR todavía no está activo -> 0, no rompe.
      const b = computeConsumptionTax(100, "AR");
      expect(b.rate).toBe(0);
      expect(b.tax).toBe(0);
      expect(b.total).toBe(100);
      expect(b.taxCountry).toBeNull();
      expect(b.applies).toBe(false);
    });

    it("país nulo/indefinido: sin impuesto", () => {
      expect(computeConsumptionTax(100, null).total).toBe(100);
      expect(computeConsumptionTax(100, undefined).applies).toBe(false);
    });

    it("invariante: base + tax === total sin drift de redondeo", () => {
      for (const base of [1, 33.33, 99.99, 149.95, 1000.01]) {
        const b = computeConsumptionTax(base, "MX");
        expect(b.base + b.tax).toBeCloseTo(b.total, 10);
      }
    });

    it("normaliza el código de país a mayúsculas", () => {
      expect(computeConsumptionTax(100, "mx").rate).toBe(0.16);
    });
  });

  describe("countryTaxConfig / taxRateForCountry", () => {
    it("MX está configurado con IVA 16% y moneda MXN", () => {
      expect(countryTaxConfig("MX")).toEqual({ taxName: "IVA", taxRate: 0.16, currency: "MXN" });
      expect(taxRateForCountry("MX")).toBe(0.16);
    });

    it("país no configurado o nulo -> null / 0", () => {
      expect(countryTaxConfig("AR")).toBeNull();
      expect(countryTaxConfig(null)).toBeNull();
      expect(taxRateForCountry("AR")).toBe(0);
      expect(taxRateForCountry(undefined)).toBe(0);
    });
  });

  describe("moneda de cobro y 2% FX (derivado)", () => {
    it("MX cobra en MXN, sin FX (moneda = liquidación)", () => {
      expect(chargeCurrencyForCountry("MX")).toBe("MXN");
      expect(shouldAddFxFee("MX")).toBe(false);
      expect(fxFeeRateForCountry("MX")).toBe(0);
      expect(isChargeableCountry("MX")).toBe(true);
    });

    it("país no configurado: no cobrable, sin FX, cae a MXN de liquidación", () => {
      expect(isChargeableCountry("AR")).toBe(false);
      expect(shouldAddFxFee("AR")).toBe(false); // aún no configurado -> no cobrable
      expect(fxFeeRateForCountry("AR")).toBe(0);
      expect(chargeCurrencyForCountry("AR")).toBe("MXN");
    });
  });
});
