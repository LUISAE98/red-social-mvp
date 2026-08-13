import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  convertFromAnchor,
  convertToAnchor,
  roundNice,
  buyerPrice,
  formatCurrency,
  FX_BUFFER,
} from "@/lib/currency/format";
import {
  DISPLAY_CURRENCIES,
  COUNTRY_TO_CURRENCY,
  FX_CONVERSION_FEE,
  displayCurrencyForCountry,
  isDisplayCurrency,
} from "@/lib/currency/catalog";

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

    it("redondea al múltiplo del paso de cada moneda de la UE", () => {
      expect(roundNice(9.31, "EUR")).toBe(9.5); // paso 0.5
      expect(roundNice(228.4, "CZK")).toBe(230); // paso 5
      expect(roundNice(68.6, "DKK")).toBe(69); // paso 1
      expect(roundNice(3512, "HUF")).toBe(3500); // paso 100
      expect(roundNice(40.4, "PLN")).toBe(40); // paso 1
      expect(roundNice(46.7, "RON")).toBe(47); // paso 1
      expect(roundNice(107.2, "SEK")).toBe(105); // paso 5
    });
  });

  describe("buyerPrice (lo que el comprador VE y PAGA)", () => {
    it("aplica el margen FX (2%) y redondea a cifra limpia", () => {
      // 10 USD * 18.5 = 185 ; *1.02 = 188.7 ; roundNice(,MXN)=190
      expect(buyerPrice(10, "MXN", RATES)).toBe(190);
    });

    it("USD (ancla) se paga exacto: sin buffer ni redondeo", () => {
      expect(buyerPrice(9.99, "USD", RATES)).toBe(9.99);
    });

    // El margen que se MUESTRA tiene que ser el mismo que se COBRA. Hasta el
    // 2026-08-07 eran dos constantes desalineadas (1.5% aquí, 2% en el cobro) y el
    // comprador extranjero veía un precio distinto del que se le cargaba.
    it("el buffer FX es 2% y sale de la misma constante que el cobro", () => {
      expect(FX_BUFFER).toBeCloseTo(0.02, 10);
      expect(FX_BUFFER).toBe(FX_CONVERSION_FEE);
    });

    it("tasa faltante -> null", () => {
      expect(buyerPrice(10, "MXN", {})).toBeNull();
    });

    it("aplica el mismo buffer+redondeo a una moneda de la UE", () => {
      // 10 USD * 0.92 = 9.2 ; *1.015 = 9.338 ; roundNice(,EUR) paso 0.5 = 9.5
      expect(buyerPrice(10, "EUR", { EUR: 0.92 })).toBe(9.5);
    });

    it("una moneda de la UE sin tasa -> null (nunca cobra con tasa basura)", () => {
      // Es el modo de fallo si el backend no refresca la moneda: precio en null,
      // no un precio inventado. Ver la copia de DISPLAY_CURRENCIES en exchangeRates.ts.
      expect(buyerPrice(10, "SEK", { EUR: 0.92 })).toBeNull();
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

// Catálogo país→moneda. Un país mal mapeado le muestra al comprador un precio en
// una moneda que no es la suya; un país ausente cae al fallback USD.
describe("lib/currency/catalog", () => {
  const EU_COUNTRY_TO_CURRENCY: Record<string, string> = {
    AT: "EUR", BE: "EUR", BG: "EUR", HR: "EUR", CY: "EUR", EE: "EUR", FI: "EUR",
    FR: "EUR", DE: "EUR", GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR",
    LU: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR", ES: "EUR",
    CZ: "CZK", DK: "DKK", HU: "HUF", PL: "PLN", RO: "RON", SE: "SEK",
  };

  it("los 27 países de la UE mapean a su moneda", () => {
    expect(Object.keys(EU_COUNTRY_TO_CURRENCY)).toHaveLength(27);
    for (const [cc, expected] of Object.entries(EU_COUNTRY_TO_CURRENCY)) {
      expect(COUNTRY_TO_CURRENCY[cc], `país ${cc}`).toBe(expected);
      expect(displayCurrencyForCountry(cc.toLowerCase()), `país ${cc}`).toBe(expected);
    }
  });

  it("Bulgaria usa EUR desde el 1-ene-2026 (BGN ya no existe en el catálogo)", () => {
    expect(COUNTRY_TO_CURRENCY.BG).toBe("EUR");
    expect(isDisplayCurrency("BGN")).toBe(false);
  });

  it("las 7 monedas de la UE están en DISPLAY_CURRENCIES", () => {
    for (const c of ["EUR", "CZK", "DKK", "HUF", "PLN", "RON", "SEK"]) {
      expect(isDisplayCurrency(c), `moneda ${c}`).toBe(true);
    }
  });

  it("no hay códigos de moneda repetidos", () => {
    expect(new Set(DISPLAY_CURRENCIES).size).toBe(DISPLAY_CURRENCIES.length);
  });

  // El backend mantiene su PROPIA copia a mano de la lista (no puede importar de
  // lib/ porque compila aparte). Si divergen, la tarea diaria de tasas no trae la
  // moneda faltante y su precio sale en null en todo el frontend.
  it("la copia de DISPLAY_CURRENCIES del backend está en sync con el catálogo", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../backend/src/exchangeRates.ts", import.meta.url)),
      "utf8"
    );
    const block = src.match(/const DISPLAY_CURRENCIES = \[([\s\S]*?)\];/);
    expect(block, "no se encontró DISPLAY_CURRENCIES en backend/src/exchangeRates.ts").not.toBeNull();
    const backendList = [...block![1].matchAll(/"([A-Z]{3})"/g)].map((m) => m[1]);
    expect([...backendList].sort()).toEqual([...DISPLAY_CURRENCIES].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Código ISO de la moneda: el bug de "83,52 MXN MXN"
// ─────────────────────────────────────────────────────────────────────────────
describe("formatCurrency · código ISO sin duplicar", () => {
  // 🚨 EL BUG QUE ESTE BLOQUE IMPIDE 🚨
  //
  // `currencyDisplay: "narrowSymbol"` NO garantiza un símbolo. Cuando el idioma no
  // conoce símbolo corto para esa moneda, Intl usa el PROPIO CÓDIGO ISO como símbolo.
  // En finés, MXN se formatea "83,52 MXN". Si encima se concatena el código —que es lo
  // que hacían a mano 14 sitios de la app— sale "83,52 MXN MXN".
  //
  // En español no se veía porque sí hay símbolo ("$83.52"), y por eso el bug llegó a
  // producción y solo apareció al mirar la app en finés.
  it("🚨 en finés NO duplica el código (el símbolo YA es el código)", () => {
    const out = formatCurrency(83.52, "MXN", "fi");
    expect(out).not.toMatch(/MXN.*MXN/);
    const conCodigo = formatCurrency(83.52, "MXN", "fi", { code: true });
    expect(conCodigo).not.toMatch(/MXN.*MXN/);
    expect(conCodigo).toContain("MXN");
  });

  it("donde SÍ hay símbolo, el código se añade una sola vez", () => {
    for (const loc of ["es", "en", "el", "de", "pt-BR"]) {
      const out = formatCurrency(83.52, "MXN", loc, { code: true });
      expect(out.match(/MXN/g)?.length, `locale ${loc}`).toBe(1);
    }
  });

  it("sin `code` no aparece el código salvo que Intl lo use de símbolo", () => {
    expect(formatCurrency(83.52, "MXN", "es")).not.toContain("MXN");
  });

  // El defecto importa: la mayoría de los sitios llama sin opciones y no debe cambiar.
  it("ningún idioma produce el código repetido, en ninguna moneda del catálogo", () => {
    for (const cur of DISPLAY_CURRENCIES) {
      for (const loc of ["es", "fi", "en", "ja", "tr"]) {
        const out = formatCurrency(1234.5, cur, loc, { code: true });
        expect(out.match(new RegExp(cur, "g"))?.length ?? 0, `${cur}/${loc}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
