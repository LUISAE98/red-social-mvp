import { describe, it, expect } from "vitest";
import {
  convertFromAnchor,
  convertToAnchor,
  roundNice,
  buyerPrice,
  formatCurrency,
  FX_BUFFER,
} from "@/lib/currency/format";

// Conversión FX. Regla de oro del sistema: nunca se guarda un monto convertido;
// se guarda USD (ancla) y se convierte al mostrar/cobrar. Un error aquí cobra de
// más/menos al comprador o descuadra la liquidación.
const RATES = { MXN: 18.5, COP: 4000, USD: 1 } as const;

describe("lib/currency/format", () => {
  describe("convertFromAnchor (USD -> local)", () => {
    it("convierte USD a la moneda local con la tasa dada", () => {
      expect(convertFromAnchor(10, "MXN", RATES)).toBe(185);
    });

    it("la moneda ancla (USD) se devuelve sin convertir", () => {
      expect(convertFromAnchor(10, "USD", RATES)).toBe(10);
    });

    it("tasa faltante/inválida -> null (no cobra con tasa basura)", () => {
      expect(convertFromAnchor(10, "MXN", {})).toBeNull();
      expect(convertFromAnchor(10, "MXN", { MXN: 0 })).toBeNull();
      expect(convertFromAnchor(10, "MXN", { MXN: -5 })).toBeNull();
      expect(convertFromAnchor(10, "MXN", { MXN: NaN })).toBeNull();
    });
  });

  describe("convertToAnchor (local -> USD)", () => {
    it("es el inverso de convertFromAnchor", () => {
      expect(convertToAnchor(185, "MXN", RATES)).toBe(10);
    });

    it("round-trip USD->MXN->USD conserva el valor", () => {
      const usd = 12.34;
      const mxn = convertFromAnchor(usd, "MXN", RATES)!;
      expect(convertToAnchor(mxn, "MXN", RATES)).toBeCloseTo(usd, 10);
    });

    it("tasa faltante -> null", () => {
      expect(convertToAnchor(100, "MXN", {})).toBeNull();
    });
  });

  describe("roundNice (redondeo bonito por moneda)", () => {
    it("redondea al múltiplo del paso de cada moneda", () => {
      expect(roundNice(187.775, "MXN")).toBe(190); // paso 5
      expect(roundNice(4873.42, "COP")).toBe(4900); // paso 100
      expect(roundNice(2.3, "USD")).toBe(2.5); // paso 0.5
    });
  });

  describe("buyerPrice (lo que el comprador VE y PAGA)", () => {
    it("aplica el margen FX (1.5%) y redondea a cifra limpia", () => {
      // 10 USD * 18.5 = 185 ; *1.015 = 187.775 ; roundNice(,MXN)=190
      expect(buyerPrice(10, "MXN", RATES)).toBe(190);
    });

    it("USD (ancla) se paga exacto: sin buffer ni redondeo", () => {
      expect(buyerPrice(9.99, "USD", RATES)).toBe(9.99);
    });

    it("el buffer FX es 1.5%", () => {
      expect(FX_BUFFER).toBeCloseTo(0.015, 10);
    });

    it("tasa faltante -> null", () => {
      expect(buyerPrice(10, "MXN", {})).toBeNull();
    });
  });

  describe("formatCurrency", () => {
    it("formatea un monto como string no vacío", () => {
      const s = formatCurrency(185, "MXN", "es");
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    });

    it("moneda inválida -> fallback '$x.xx' sin lanzar", () => {
      // "US" no es un código ISO 4217 válido (2 letras) -> Intl lanza -> fallback.
      expect(formatCurrency(10, "US", "en")).toBe("$10.00");
    });
  });
});
