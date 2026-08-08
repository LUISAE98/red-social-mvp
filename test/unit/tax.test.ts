import { describe, it, expect } from "vitest";
import {
  computeConsumptionTax,
  countryTaxConfig,
  taxRateForCountry,
  chargeCurrencyForCountry,
  shouldAddFxFee,
  fxFeeRateForCountry,
  isChargeableCountry,
  platformCollectsTax,
} from "@/lib/tax/config";
import {
  resolveTaxCountryFromIndicios,
  type CountryIndicios,
} from "../../backend/src/tax/resolveCountry";

// País deliberadamente NO configurado, para probar el camino "sin ficha".
// (Antes se usaba "AR" para esto; desde 2026-08-07 Argentina SÍ está configurada.)
const UNCONFIGURED = "JP";

// Impuesto al consumo. El impuesto lo determina el país del COMPRADOR, no el creador.
// El desglose base/impuesto/total debe ser exacto.
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
        collectionMode: "platform",
        collectedByPlatform: true,
      });
    });

    it("país sin ficha: sin impuesto, no rompe", () => {
      const b = computeConsumptionTax(100, UNCONFIGURED);
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

  // 🇦🇷 El caso que motivó `collectionMode`: el impuesto EXISTE (21%) pero lo percibe la
  // emisora del comprador (RG 4240/18). Si Vibra lo sumara al precio, el argentino lo
  // pagaría DOS VECES. Ver impuestos.md §6.
  describe("Argentina — impuesto existente que Vibra NO cobra", () => {
    it("está configurada y es cobrable", () => {
      expect(isChargeableCountry("AR")).toBe(true);
      expect(countryTaxConfig("AR")).not.toBeNull();
    });

    it("conserva la tasa del 21% aunque no la cobre (para poder mostrarla)", () => {
      expect(taxRateForCountry("AR")).toBe(0.21);
      expect(computeConsumptionTax(100, "AR").rate).toBe(0.21);
    });

    it("NO suma el impuesto al total: lo percibe la emisora", () => {
      const b = computeConsumptionTax(100, "AR");
      expect(b.tax).toBe(0);
      expect(b.total).toBe(100); // ← si esto fuera 121, sería doble cobro
      expect(b.applies).toBe(false);
      expect(b.collectionMode).toBe("issuer");
      expect(b.collectedByPlatform).toBe(false);
    });

    it("platformCollectsTax distingue MX (cobra) de AR (no cobra)", () => {
      expect(platformCollectsTax("MX")).toBe(true);
      expect(platformCollectsTax("AR")).toBe(false);
      expect(platformCollectsTax(UNCONFIGURED)).toBe(false);
    });

    it("cobra en ARS y sí lleva el 2% de conversión", () => {
      expect(chargeCurrencyForCountry("AR")).toBe("ARS");
      expect(shouldAddFxFee("AR")).toBe(true);
      expect(fxFeeRateForCountry("AR")).toBe(0.02);
    });
  });

  describe("countryTaxConfig / taxRateForCountry", () => {
    it("MX está configurado con IVA 16%, MXN y cobro por plataforma", () => {
      expect(countryTaxConfig("MX")).toEqual({
        taxName: "IVA",
        taxRate: 0.16,
        currency: "MXN",
        collectionMode: "platform",
        mxVatTreatment: "domestic_16",
      });
      expect(taxRateForCountry("MX")).toBe(0.16);
    });

    it("país sin ficha o nulo -> null / 0", () => {
      expect(countryTaxConfig(UNCONFIGURED)).toBeNull();
      expect(countryTaxConfig(null)).toBeNull();
      expect(taxRateForCountry(UNCONFIGURED)).toBe(0);
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

    it("país sin ficha: no cobrable, sin FX, cae a MXN de liquidación", () => {
      expect(isChargeableCountry(UNCONFIGURED)).toBe(false);
      expect(shouldAddFxFee(UNCONFIGURED)).toBe(false);
      expect(fxFeeRateForCountry(UNCONFIGURED)).toBe(0);
      expect(chargeCurrencyForCountry(UNCONFIGURED)).toBe("MXN");
    });
  });
});

// Determinación del país fiscal. Es la defensa contra que un comprador mexicano se
// declare extranjero para no pagar el 16%. Ver impuestos.md §3.3.
describe("backend/tax/resolveCountry — regla de determinación", () => {
  const indicios = (ipCountry: string | null, cardCountry: string | null): CountryIndicios => ({
    billingAddress: null,
    cardCountry,
    ipCountry,
    phoneCountry: null,
  });

  it("IP mexicana gana SIEMPRE, aunque la tarjeta sea extranjera", () => {
    const r = resolveTaxCountryFromIndicios(indicios("MX", "AR"));
    expect(r.country).toBe("MX");
    expect(r.source).toBe("mx_ip_rule");
    expect(r.hadConflict).toBe(true);
  });

  it("IP argentina + tarjeta mexicana → México (gana la tarjeta, y es MX)", () => {
    const r = resolveTaxCountryFromIndicios(indicios("AR", "MX"));
    expect(r.country).toBe("MX");
    expect(r.source).toBe("card_bin");
    expect(r.hadConflict).toBe(true);
  });

  it("entre dos países extranjeros gana la tarjeta", () => {
    const r = resolveTaxCountryFromIndicios(indicios("AR", "CO"));
    expect(r.country).toBe("CO");
    expect(r.source).toBe("card_bin");
  });

  it("sin tarjeta todavía (fase de display) manda la IP", () => {
    const r = resolveTaxCountryFromIndicios(indicios("AR", null));
    expect(r.country).toBe("AR");
    expect(r.source).toBe("ip");
    expect(r.hadConflict).toBe(false);
  });

  it("coincidencia: sin conflicto", () => {
    const r = resolveTaxCountryFromIndicios(indicios("AR", "AR"));
    expect(r.country).toBe("AR");
    expect(r.hadConflict).toBe(false);
  });

  it("sin ninguna señal cae a MX (conservador: cobra el 16%)", () => {
    const r = resolveTaxCountryFromIndicios(indicios(null, null));
    expect(r.country).toBe("MX");
    expect(r.source).toBe("default");
  });

  it("ignora valores basura y no los toma como país", () => {
    const r = resolveTaxCountryFromIndicios(indicios("no-es-iso", "XXX"));
    expect(r.country).toBe("MX");
    expect(r.source).toBe("default");
  });

  it("🚨 el cliente ya no puede elegir el país: solo entran IP y tarjeta", () => {
    // La firma no acepta un país propuesto por el cliente. Un mexicano (IP MX) no puede
    // hacerse pasar por argentino ni con una tarjeta argentina.
    const r = resolveTaxCountryFromIndicios(indicios("MX", "AR"));
    expect(r.country).toBe("MX");
    expect(computeConsumptionTax(100, r.country).tax).toBe(16);
  });
});
