import { describe, it, expect } from "vitest";
import {
  COUNTRY_TAX_CONFIG,
  ALTAS_PENDIENTES,
  computeConsumptionTax,
  countryTaxConfig,
  taxRateForCountry,
  chargeCurrencyForCountry,
  shouldAddFxFee,
  fxFeeRateForCountry,
  isChargeableCountry,
  platformCollectsTax,
  mxVatTreatmentForSale,
  MX_EXPORT_TREATMENT_BY_SERVICE,
  type ServiceType,
} from "@/lib/tax/config";
import {
  resolveTaxCountryFromIndicios,
  type CountryIndicios,
} from "../../backend/src/tax/resolveCountry";

/**
 * País deliberadamente NO configurado, para probar el camino "sin ficha".
 *
 * Se elige EN TIEMPO DE EJECUCIÓN. Fijarlo a mano ya rompió estos tests dos
 * veces —"AR" al habilitar Argentina (2026-08-08) y "JP" al habilitar Japón
 * (2026-08-10)—: cada país nuevo invalidaba el centinela y el CI se ponía rojo
 * por un test viejo, no por un bug. Se toma el primer código que NO esté en la
 * tabla; son territorios sin jurisdicción fiscal propia, y "ZZ" (reservado por
 * la ISO para uso privado) cierra la lista como red.
 */
const UNCONFIGURED =
  ["AQ", "GS", "HM", "BV", "TF", "UM", "PN", "IO", "ZZ"].find(
    (code) => !(code in COUNTRY_TAX_CONFIG),
  ) ?? "ZZ";

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

  // `collectionMode` distingue quién recauda. Hoy solo existe MX ("platform"), pero el
  // modo se conserva porque hay países donde el impuesto lo percibe la emisora del
  // comprador y cobrarlo en el checkout sería DOBLE cobro. Los datos por país vendrán de
  // Stripe Tax, no de investigación manual (ver impuestos.md).
  describe("collectionMode", () => {
    it("solo se cobra el impuesto donde Vibra es quien lo entera", () => {
      expect(platformCollectsTax("MX")).toBe(true);
      expect(platformCollectsTax(UNCONFIGURED)).toBe(false);
    });

    it("un país sin ficha no es cobrable", () => {
      expect(isChargeableCountry(UNCONFIGURED)).toBe(false);
      expect(computeConsumptionTax(100, UNCONFIGURED).collectionMode).toBe("none");
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
        registrationStatus: "registered",
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
    expect(r.source).toBe("mx_rule");
    expect(r.hadConflict).toBe(true);
  });

  it("IP extranjera + tarjeta mexicana → México (Art. 18-C: basta un indicio)", () => {
    const r = resolveTaxCountryFromIndicios(indicios("AR", "MX"));
    expect(r.country).toBe("MX");
    expect(r.source).toBe("mx_rule");
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

// 🇪🇺 Los 27 de la UE. Un solo trámite (Non-Union OSS) los habilita todos, así que su
// estado de alta se controla con UNA constante. Ver impuestos.md §6.1.
describe("Unión Europea — 27 países, 1 solo registro", () => {
  const EU_27 = [
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES",
    "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU",
    "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
  ];

  it("están los 27, ni uno más ni uno menos", () => {
    expect(EU_27).toHaveLength(27);
    for (const iso of EU_27) {
      expect(countryTaxConfig(iso), `falta ${iso}`).not.toBeNull();
    }
  });

  it("Grecia va como GR (ISO), no como EL (el código de TEDB)", () => {
    expect(countryTaxConfig("GR")).not.toBeNull();
    expect(countryTaxConfig("EL")).toBeNull();
  });

  it("todos tienen tasa > 0 y el IVA lo cobra la plataforma, no la emisora", () => {
    for (const iso of EU_27) {
      const cfg = countryTaxConfig(iso)!;
      expect(cfg.taxRate, iso).toBeGreaterThan(0);
      // En la UE no hay retención bancaria: cobra el proveedor y declara vía OSS.
      expect(cfg.collectionMode, iso).toBe("platform");
      expect(cfg.mxVatTreatment, iso).toBe("export_zero");
    }
  });

  it("las tasas coinciden con TEDB (muestreo de los extremos y casos raros)", () => {
    expect(taxRateForCountry("LU")).toBe(0.17);   // la más baja de la UE
    expect(taxRateForCountry("HU")).toBe(0.27);   // la más alta
    expect(taxRateForCountry("FI")).toBe(0.255);  // única con media unidad
    expect(taxRateForCountry("ES")).toBe(0.21);
    expect(taxRateForCountry("DE")).toBe(0.19);
    expect(taxRateForCountry("GR")).toBe(0.24);
  });

  it("Bulgaria cobra en EUR: adoptó el euro el 1-ene-2026, ya no usa BGN", () => {
    expect(chargeCurrencyForCountry("BG")).toBe("EUR");
  });

  it("las 6 monedas no-euro apuntan a su divisa local", () => {
    expect(chargeCurrencyForCountry("CZ")).toBe("CZK");
    expect(chargeCurrencyForCountry("DK")).toBe("DKK");
    expect(chargeCurrencyForCountry("HU")).toBe("HUF");
    expect(chargeCurrencyForCountry("PL")).toBe("PLN");
    expect(chargeCurrencyForCountry("RO")).toBe("RON");
    expect(chargeCurrencyForCountry("SE")).toBe("SEK");
  });

  // 🚨 El invariante que evita cobrar un impuesto que no se puede enterar.
  it("🚨 SIN el alta de OSS no se cobra NI se vende", () => {
    for (const iso of EU_27) {
      const cfg = countryTaxConfig(iso)!;
      if (cfg.registrationStatus === "registered") continue; // ya se activó el OSS

      expect(cfg.registrationStatus, iso).toBe("cannot_sell");
      // No se vende: el checkout rechaza.
      expect(isChargeableCountry(iso), iso).toBe(false);
      // Y aunque la tasa está puesta, NO se cobra.
      expect(computeConsumptionTax(100, iso).tax, iso).toBe(0);
      expect(platformCollectsTax(iso), iso).toBe(false);
    }
  });

  // 🟢 Con el OSS activo los 27 cobran. Cada uno a SU tasa, no a una común.
  it("con el OSS activo se cobra el IVA de cada país", () => {
    expect(computeConsumptionTax(100, "ES")).toMatchObject({ rate: 0.21, tax: 21, total: 121 });
    expect(computeConsumptionTax(100, "DE")).toMatchObject({ rate: 0.19, tax: 19, total: 119 });
    expect(computeConsumptionTax(100, "LU")).toMatchObject({ rate: 0.17, tax: 17, total: 117 });
    expect(computeConsumptionTax(100, "HU")).toMatchObject({ rate: 0.27, tax: 27, total: 127 });
  });

  it("los 27 son vendibles y cobran su propia tasa", () => {
    for (const iso of EU_27) {
      expect(isChargeableCountry(iso), iso).toBe(true);
      expect(platformCollectsTax(iso), iso).toBe(true);
      const b = computeConsumptionTax(100, iso);
      expect(b.tax, iso).toBeCloseTo(100 * b.rate, 8);
      expect(b.applies, iso).toBe(true);
    }
  });

  it("no todos comparten tasa: hay al menos 8 distintas entre los 27", () => {
    const tasas = new Set(EU_27.map((iso) => taxRateForCountry(iso)));
    expect(tasas.size).toBeGreaterThanOrEqual(8);
  });

  it("el interruptor del OSS es único: los 27 comparten estado", () => {
    const estados = new Set(EU_27.map((iso) => countryTaxConfig(iso)!.registrationStatus));
    expect(estados.size).toBe(1);
  });
});

// 🇪🇺 Regla europea de ubicación: Art. 24b del Reglamento de Ejecución del IVA exige
// DOS pruebas no contradictorias. Bajo 100,000 EUR de ventas B2C a la UE basta una, pero
// el desempate y la evidencia se registran siempre. Ver impuestos.md §3.3.
describe("resolveCountry — dos pruebas no contradictorias (Art. 24b UE)", () => {
  const full = (
    ipCountry: string | null,
    cardCountry: string | null,
    billingAddress: string | null = null,
    phoneCountry: string | null = null
  ): CountryIndicios => ({ billingAddress, cardCountry, ipCountry, phoneCountry });

  it("IP y tarjeta coinciden → dos pruebas, sin conflicto", () => {
    const r = resolveTaxCountryFromIndicios(full("DE", "DE"));
    expect(r.country).toBe("DE");
    expect(r.source).toBe("agreement");
    expect(r.hadConflict).toBe(false);
    expect(r.meetsTwoEvidenceRule).toBe(true);
    expect(r.agreeingIndicios).toEqual(
      expect.arrayContaining(["ipCountry", "cardCountry"])
    );
  });

  it("🇫🇷 IP francesa + 🇩🇪 tarjeta alemana → la dirección de facturación desempata", () => {
    const r = resolveTaxCountryFromIndicios(full("FR", "DE", "FR"));
    expect(r.country).toBe("FR"); // gana Francia: IP + facturación
    expect(r.source).toBe("tiebreak");
    expect(r.conflictResolvedBy).toBe("billingAddress");
    expect(r.meetsTwoEvidenceRule).toBe(true);
  });

  it("el desempate también puede favorecer a la tarjeta", () => {
    const r = resolveTaxCountryFromIndicios(full("FR", "DE", "DE"));
    expect(r.country).toBe("DE");
    expect(r.source).toBe("tiebreak");
    expect(r.conflictResolvedBy).toBe("billingAddress");
    expect(r.meetsTwoEvidenceRule).toBe(true);
  });

  it("sin dirección, el teléfono sirve de desempate", () => {
    const r = resolveTaxCountryFromIndicios(full("FR", "DE", null, "DE"));
    expect(r.country).toBe("DE");
    expect(r.conflictResolvedBy).toBe("phoneCountry");
    expect(r.meetsTwoEvidenceRule).toBe(true);
  });

  it("la dirección de facturación tiene prioridad sobre el teléfono", () => {
    const r = resolveTaxCountryFromIndicios(full("FR", "DE", "FR", "DE"));
    expect(r.country).toBe("FR");
    expect(r.conflictResolvedBy).toBe("billingAddress");
  });

  it("🚨 sin desempate gana la tarjeta, pero queda MARCADO que no hay dos pruebas", () => {
    const r = resolveTaxCountryFromIndicios(full("FR", "DE"));
    expect(r.country).toBe("DE"); // la tarjeta es el indicio más difícil de falsificar
    expect(r.source).toBe("card_bin");
    expect(r.hadConflict).toBe(true);
    // Esto es lo importante: se puede auditar que la operación NO cumple el Art. 24b.
    expect(r.meetsTwoEvidenceRule).toBe(false);
    expect(r.conflictResolvedBy).toBeNull();
  });

  it("un tercer indicio que no coincide con ninguno no desempata", () => {
    const r = resolveTaxCountryFromIndicios(full("FR", "DE", "IT"));
    expect(r.country).toBe("DE");
    expect(r.conflictResolvedBy).toBeNull();
    expect(r.meetsTwoEvidenceRule).toBe(false);
  });

  it("México gana por cualquier indicio, incluso el teléfono", () => {
    const r = resolveTaxCountryFromIndicios(full("DE", "DE", null, "MX"));
    expect(r.country).toBe("MX");
    expect(r.source).toBe("mx_rule");
  });

  it("fase de display (solo IP): una prueba, y se sabe que es una", () => {
    const r = resolveTaxCountryFromIndicios(full("ES", null));
    expect(r.country).toBe("ES");
    expect(r.source).toBe("ip");
    expect(r.meetsTwoEvidenceRule).toBe(false);
    expect(r.hadConflict).toBe(false);
  });
});

// 🌎 Países donde el impuesto lo percibe la EMISORA del comprador, no Vibra.
// Es el caso que motivó `collectionMode`: la tasa existe pero el checkout suma CERO,
// porque el banco se la agrega al comprador en su resumen de tarjeta. Ver impuestos.md.
describe("Recaudación por la emisora — AR, CR, EC, PY, DO", () => {
  const ISSUER: Array<[string, number, string]> = [
    ["AR", 0.21, "ARS"],
    ["CR", 0.13, "CRC"],
    ["EC", 0.15, "USD"],
    ["PY", 0.10, "PYG"],
    ["DO", 0.18, "DOP"],
  ];

  it("los cinco están configurados y SE PUEDE vender ahí", () => {
    for (const [iso] of ISSUER) {
      expect(countryTaxConfig(iso), iso).not.toBeNull();
      // Ninguno exige alta previa → se vende.
      expect(isChargeableCountry(iso), iso).toBe(true);
    }
  });

  it("🚨 NINGUNO suma impuesto al precio (si lo hiciera, el comprador pagaría doble)", () => {
    for (const [iso] of ISSUER) {
      const b = computeConsumptionTax(100, iso);
      expect(b.tax, iso).toBe(0);
      expect(b.total, iso).toBe(100);
      expect(b.applies, iso).toBe(false);
      expect(b.collectedByPlatform, iso).toBe(false);
      expect(platformCollectsTax(iso), iso).toBe(false);
    }
  });

  it("conservan su tasa y moneda, para poder advertir qué sumará el banco", () => {
    for (const [iso, rate, currency] of ISSUER) {
      expect(taxRateForCountry(iso), iso).toBeCloseTo(rate, 8);
      expect(chargeCurrencyForCountry(iso), iso).toBe(currency);
      expect(computeConsumptionTax(100, iso).rate, iso).toBeCloseTo(rate, 8);
    }
  });

  it("el modo es 'issuer' y el IVA mexicano va a 0% por exportación", () => {
    for (const [iso] of ISSUER) {
      const cfg = countryTaxConfig(iso)!;
      expect(cfg.collectionMode, iso).toBe("issuer");
      expect(cfg.registrationStatus, iso).toBe("not_registered");
      expect(cfg.mxVatTreatment, iso).toBe("export_zero");
    }
  });

  it("Rep. Dominicana usa ITBIS, no IVA", () => {
    expect(countryTaxConfig("DO")!.taxName).toBe("ITBIS");
  });

  // Contraste: México y la UE SÍ cobran. El modo no es cosmético.
  it("contraste: donde recauda la plataforma, el impuesto sí se suma", () => {
    expect(computeConsumptionTax(100, "MX").tax).toBe(16);
    expect(computeConsumptionTax(100, "ES").tax).toBe(21);
    expect(platformCollectsTax("MX")).toBe(true);
    expect(platformCollectsTax("AR")).toBe(false);
  });
});

// Los rezagados de LatAm: no han creado un régimen que obligue a un proveedor extranjero a
// registrarse. Se parecen a los de arriba en el resultado (cero impuesto en el checkout) pero
// por una razón distinta: allá recauda el banco, aquí NO RECAUDA NADIE por esta venta.
// Esa diferencia es la que separa `collectionMode: "issuer"` de `"none"`.
describe("Sin régimen de servicios digitales — BO, SV, GT, HN, NI, PA", () => {
  const NO_REGIME: Array<[string, number, string, string]> = [
    ["BO", 0.13, "BOB", "IVA"],
    ["SV", 0.13, "USD", "IVA"],
    ["GT", 0.12, "GTQ", "IVA"],
    ["HN", 0.15, "HNL", "ISV"],
    ["NI", 0.15, "NIO", "IVA"],
    ["PA", 0.07, "USD", "ITBMS"],
  ];

  // 🚨 La regresión que este bloque protege: `isChargeableCountry` rechazaba cualquier país
  // con `collectionMode: "none"`. Si alguien restaura esa condición, estos cinco dejan de
  // vender en silencio — la compra falla sin que nada en la tabla se vea mal.
  it("🚨 que no recaude nadie NO impide vender", () => {
    for (const [iso] of NO_REGIME) {
      expect(countryTaxConfig(iso), iso).not.toBeNull();
      expect(countryTaxConfig(iso)!.collectionMode, iso).toBe("none");
      expect(isChargeableCountry(iso), iso).toBe(true);
    }
  });

  it("el checkout suma CERO: no hay alta posible ni fisco al que enterar", () => {
    for (const [iso] of NO_REGIME) {
      const b = computeConsumptionTax(100, iso);
      expect(b.tax, iso).toBe(0);
      expect(b.total, iso).toBe(100);
      expect(b.applies, iso).toBe(false);
      expect(platformCollectsTax(iso), iso).toBe(false);
      expect(countryTaxConfig(iso)!.registrationStatus, iso).toBe("not_registered");
    }
  });

  it("guardan tasa, moneda y nombre del impuesto como referencia", () => {
    for (const [iso, rate, currency, name] of NO_REGIME) {
      expect(taxRateForCountry(iso), iso).toBeCloseTo(rate, 8);
      expect(chargeCurrencyForCountry(iso), iso).toBe(currency);
      expect(countryTaxConfig(iso)!.taxName, iso).toBe(name);
    }
  });

  // Honduras le dice ISV (Impuesto Sobre Ventas) y El Salvador cobra en dólares: son los dos
  // que se escriben mal si alguien copia la fila de un vecino.
  it("cada uno con su nombre y moneda: ISV en HN, ITBMS en PA, USD en SV y PA", () => {
    expect(countryTaxConfig("HN")!.taxName).toBe("ISV");
    expect(countryTaxConfig("PA")!.taxName).toBe("ITBMS");
    expect(chargeCurrencyForCountry("SV")).toBe("USD");
    expect(chargeCurrencyForCountry("PA")).toBe("USD");
  });

  // 🚨 Panamá SÍ tiene una retención de ITBMS sobre no domiciliados, pero la practica el
  // cliente panameño que paga (B2B), no el emisor de la tarjeta. Marcarlo "issuer" sería
  // describir mal el mecanismo; el cobro coincide, la razón no. Y si mañana se aprueba el
  // anteproyecto de 2019, lo que cambia es a "platform" + "registered", no a "issuer".
  it("🚨 Panamá NO es 'issuer': ahí no retiene el banco, retiene el cliente empresa", () => {
    expect(countryTaxConfig("PA")!.collectionMode).toBe("none");
    expect(countryTaxConfig("AR")!.collectionMode).toBe("issuer");
    expect(computeConsumptionTax(100, "PA").total).toBe(100);
  });

  it("el IVA mexicano de esas ventas es 0% por exportación", () => {
    for (const [iso] of NO_REGIME) {
      expect(countryTaxConfig(iso)!.mxVatTreatment, iso).toBe("export_zero");
    }
  });
});

// 🇳🇴🇮🇸🇧🇦 Europa NO comunitaria. Aquí el régimen SÍ existe y Vibra SÍ sería quien recauda:
// lo único que falta es el alta, que no es obligatoria mientras no se cruce el umbral. Por eso
// van con `platform` + `not_registered` y no con `none` como los de LatAm sin régimen.
describe("Europa no comunitaria bajo umbral — NO, IS, BA", () => {
  const UNDER: Array<[string, number, string, string]> = [
    ["NO", 0.25, "NOK", "MVA"],
    ["IS", 0.24, "ISK", "VSK"],
    ["BA", 0.17, "BAM", "PDV"],
  ];

  it("se vende, y el checkout suma CERO mientras no haya alta", () => {
    for (const [iso] of UNDER) {
      expect(isChargeableCountry(iso), iso).toBe(true);
      const b = computeConsumptionTax(100, iso);
      expect(b.tax, iso).toBe(0);
      expect(b.total, iso).toBe(100);
      expect(b.applies, iso).toBe(false);
      expect(platformCollectsTax(iso), iso).toBe(false);
    }
  });

  // 🚨 La distinción que hace falta preservar: NO es lo mismo "nadie recauda nunca" (Bolivia)
  // que "Vibra recaudará en cuanto se registre" (Noruega). Si alguien uniforma los dos a
  // `none`, se pierde la señal de que aquí hay una obligación esperando a nacer.
  it("🚨 el modo es platform (no none): la obligación existe, solo falta el alta", () => {
    for (const [iso] of UNDER) {
      expect(countryTaxConfig(iso)!.collectionMode, iso).toBe("platform");
      expect(countryTaxConfig(iso)!.registrationStatus, iso).toBe("not_registered");
    }
    // Contraste con los que nunca van a cobrar nada.
    expect(countryTaxConfig("BO")!.collectionMode).toBe("none");
  });

  it("guardan tasa, moneda y nombre para el día del alta", () => {
    for (const [iso, rate, currency, name] of UNDER) {
      expect(taxRateForCountry(iso), iso).toBeCloseTo(rate, 8);
      expect(chargeCurrencyForCountry(iso), iso).toBe(currency);
      expect(countryTaxConfig(iso)!.taxName, iso).toBe(name);
      // Cobran en su moneda local, así que les toca el 2% de conversión.
      expect(shouldAddFxFee(iso), iso).toBe(true);
    }
  });

  // Cambiar UN campo debe bastar para encender el cobro el día que se cruce el umbral.
  it("encender el cobro es cambiar registrationStatus y nada más", () => {
    const noruega = countryTaxConfig("NO")!;
    const comoSiEstuvieraDeAlta = { ...noruega, registrationStatus: "registered" as const };
    expect(comoSiEstuvieraDeAlta.collectionMode).toBe("platform");
    expect(comoSiEstuvieraDeAlta.taxRate).toBe(0.25);
  });

  // 🚫 Ucrania tiene umbral pero se dejó fuera: Crimea, Donetsk y Lugansk están bajo embargo
  // OFAC y resolveCountry solo distingue país, no región (D-14).
  it("🚫 Ucrania NO está configurada, y es a propósito", () => {
    expect(countryTaxConfig("UA")).toBeNull();
    expect(isChargeableCountry("UA")).toBe(false);
  });
});

// Asia-Pacífico y Medio Oriente. Dos situaciones distintas que dan el mismo cobro (cero):
// unos no tienen impuesto en absoluto, otros lo tienen pero Vibra está bajo su umbral.
describe("Asia-Pacífico y Medio Oriente", () => {
  // 🇭🇰🇶🇦🇰🇼 No existe IVA/GST. Son los ÚNICOS de toda la tabla sin reloj corriendo:
  // no hay umbral que cruzar ni alta que llegue nunca. Estrictamente mejores que NO/IS/BA.
  describe("sin impuesto al consumo — HK, QA, KW", () => {
    const SIN_IMPUESTO: Array<[string, string]> = [
      ["HK", "HKD"],
      ["QA", "QAR"],
      ["KW", "KWD"],
    ];

    it("se vende, y la tasa es CERO — no solo el cobro", () => {
      for (const [iso, moneda] of SIN_IMPUESTO) {
        expect(isChargeableCountry(iso), iso).toBe(true);
        expect(taxRateForCountry(iso), iso).toBe(0);
        expect(computeConsumptionTax(100, iso).total, iso).toBe(100);
        expect(chargeCurrencyForCountry(iso), iso).toBe(moneda);
      }
    });

    // 🚨 La diferencia con NO/IS/BA: allá la tasa está guardada esperando el día del alta.
    // Aquí no hay nada que esperar. Si alguien copia una fila de Noruega y le pone tasa a
    // Hong Kong, se cobraría un impuesto que no existe.
    it("🚨 no confundirlos con los de umbral: aquí NO hay tasa guardada", () => {
      for (const [iso] of SIN_IMPUESTO) {
        expect(countryTaxConfig(iso)!.taxRate, iso).toBe(0);
        expect(countryTaxConfig(iso)!.collectionMode, iso).toBe("none");
      }
      // Contraste: Japón sí guarda su 10% para el día que cruce el umbral.
      expect(countryTaxConfig("JP")!.taxRate).toBe(0.1);
      expect(countryTaxConfig("JP")!.collectionMode).toBe("platform");
    });
  });

  describe("bajo umbral — JP, MY, PH, TH, AU, JO, ID, NZ, TW, SG", () => {
    const UMBRAL: Array<[string, number, string, string]> = [
      ["JP", 0.1, "JPY", "JCT"],
      ["MY", 0.08, "MYR", "SST"],
      ["PH", 0.12, "PHP", "VAT"],
      ["TH", 0.07, "THB", "VAT"],
      ["AU", 0.1, "AUD", "GST"],
      ["JO", 0.16, "JOD", "GST"],
      ["ID", 0.11, "IDR", "PPN"],
      ["NZ", 0.15, "NZD", "GST"],
      ["TW", 0.05, "TWD", "VAT"],
      ["SG", 0.09, "SGD", "GST"],
    ];

    it("los diez venden con cobro CERO mientras no haya alta", () => {
      for (const [iso] of UMBRAL) {
        expect(isChargeableCountry(iso), iso).toBe(true);
        expect(computeConsumptionTax(100, iso).total, iso).toBe(100);
        expect(platformCollectsTax(iso), iso).toBe(false);
        expect(countryTaxConfig(iso)!.registrationStatus, iso).toBe("not_registered");
      }
    });

    it("guardan tasa, moneda y nombre para el día del alta", () => {
      for (const [iso, tasa, moneda, nombre] of UMBRAL) {
        expect(taxRateForCountry(iso), iso).toBeCloseTo(tasa, 8);
        expect(chargeCurrencyForCountry(iso), iso).toBe(moneda);
        expect(countryTaxConfig(iso)!.taxName, iso).toBe(nombre);
        expect(shouldAddFxFee(iso), iso).toBe(true);
      }
    });

    it("cada uno con el nombre real de SU impuesto, no un IVA genérico", () => {
      expect(countryTaxConfig("JP")!.taxName).toBe("JCT");
      expect(countryTaxConfig("MY")!.taxName).toBe("SST");
      expect(countryTaxConfig("ID")!.taxName).toBe("PPN");
      expect(countryTaxConfig("AU")!.taxName).toBe("GST");
    });
  });

  // 🚫 Los que siguen fuera, cada uno por su motivo:
  //   RU · BY · CU  sanciones (Stripe no opera)
  //   IL            decisión de Luis
  //   IN            representante fiscal obligatorio + UPI inaccesible desde México
  //   BH            representante fiscal obligatorio
  //   OM            sin confirmar si exige representante
  // (SA, AE y KR estaban aquí hasta el 2026-08-11; ya se integraron.)
  it("🚫 los excluidos siguen fuera", () => {
    for (const iso of ["RU", "BY", "CU", "IL", "IN", "BH", "OM"]) {
      expect(countryTaxConfig(iso), iso).toBeNull();
      expect(isChargeableCountry(iso), iso).toBe(false);
    }
  });
});

// 🌊 Oceanía. Australia y Nueva Zelanda se cubren en el bloque de Asia-Pacífico; aquí van
// los cuatro que quedaban, cada uno por un motivo distinto de cobrar cero.
describe("Oceanía — GU, PG, NC, FJ", () => {
  it("los cuatro venden y ninguno suma impuesto", () => {
    for (const iso of ["GU", "PG", "NC", "FJ"]) {
      expect(isChargeableCountry(iso), iso).toBe(true);
      expect(computeConsumptionTax(100, iso).total, iso).toBe(100);
      expect(platformCollectsTax(iso), iso).toBe(false);
    }
  });

  // Cada uno usa un helper distinto, y la diferencia no es cosmética: dice si algún día
  // habrá que cobrar ahí y por qué. Guam nunca; Papúa solo si legisla un régimen para
  // extranjeros; Nueva Caledonia y Fiyi en cuanto crucen su umbral.
  it("🚨 cada motivo con su helper: no son intercambiables", () => {
    // Guam: no existe el impuesto. Tasa 0 de verdad.
    expect(countryTaxConfig("GU")!.taxRate).toBe(0);
    expect(countryTaxConfig("GU")!.collectionMode).toBe("none");
    // Papúa: el GST existe (10%) pero no alcanza al B2C desde el exterior.
    expect(countryTaxConfig("PG")!.taxRate).toBe(0.1);
    expect(countryTaxConfig("PG")!.collectionMode).toBe("none");
    // Nueva Caledonia y Fiyi: régimen activo, solo falta cruzar el umbral.
    expect(countryTaxConfig("NC")!.collectionMode).toBe("platform");
    expect(countryTaxConfig("FJ")!.collectionMode).toBe("platform");
  });

  it("monedas y tasas correctas", () => {
    expect(chargeCurrencyForCountry("GU")).toBe("USD");
    expect(chargeCurrencyForCountry("PG")).toBe("PGK");
    expect(chargeCurrencyForCountry("NC")).toBe("XPF");
    expect(chargeCurrencyForCountry("FJ")).toBe("FJD");
    expect(countryTaxConfig("NC")!.taxName).toBe("TGC");
    // ⚠️ Fiyi bajó de 15% a 12,5% el 2025-08-01. Si alguien "corrige" esto a 0.15, rompe.
    expect(taxRateForCountry("FJ")).toBeCloseTo(0.125, 8);
  });

  // 🚫 Polinesia Francesa tiene umbral CERO: alta desde la primera venta. Su moneda (XPF)
  // sí está en el catálogo porque la comparte con Nueva Caledonia — tener moneda NO es
  // permiso de venta, y este test evita que alguien confunda una cosa con la otra.
  it("🚫 Polinesia Francesa NO es vendible, aunque su moneda esté en el catálogo", () => {
    expect(countryTaxConfig("PF")).toBeNull();
    expect(isChargeableCountry("PF")).toBe(false);
    expect(chargeCurrencyForCountry("NC")).toBe("XPF");
  });
});

// 🌍 África. Solo dos integrados, y con los umbrales más extremos de toda la tabla:
// Sudáfrica el más holgado que existe, Egipto de los más apretados.
describe("África — ZA, EG", () => {
  it("los dos venden con cobro CERO mientras no haya alta", () => {
    for (const iso of ["ZA", "EG"]) {
      expect(isChargeableCountry(iso), iso).toBe(true);
      expect(computeConsumptionTax(100, iso).total, iso).toBe(100);
      expect(platformCollectsTax(iso), iso).toBe(false);
      expect(countryTaxConfig(iso)!.collectionMode, iso).toBe("platform");
      expect(countryTaxConfig(iso)!.registrationStatus, iso).toBe("not_registered");
    }
  });

  it("tasas y monedas correctas", () => {
    expect(taxRateForCountry("ZA")).toBeCloseTo(0.15, 8);
    expect(taxRateForCountry("EG")).toBeCloseTo(0.14, 8);
    expect(chargeCurrencyForCountry("ZA")).toBe("ZAR");
    expect(chargeCurrencyForCountry("EG")).toBe("EGP");
    expect(shouldAddFxFee("ZA")).toBe(true);
    expect(shouldAddFxFee("EG")).toBe(true);
  });

  // 🚨 En África el impuesto NO es el único filtro: Stripe no procesa en varios países y
  // aplica restricciones por riesgo de sanciones en otros. Zimbabue es el caso claro —
  // fiscalmente sería vendible (umbral de US$25.000) pero Stripe lo restringe. Ninguno de
  // esos debe acabar en la tabla "porque el impuesto lo permite".
  it("🚨 los países que Stripe no procesa NO están configurados", () => {
    for (const iso of ["SD", "SS", "SO", "ER", "LY", "ZW", "BI", "CF", "CD", "GN", "GW", "ML"]) {
      expect(countryTaxConfig(iso), iso).toBeNull();
      expect(isChargeableCountry(iso), iso).toBe(false);
    }
  });

  it("🚫 los africanos con alta desde la venta 1 siguen fuera", () => {
    for (const iso of ["MA", "KE", "GH", "NG", "TZ", "UG"]) {
      expect(countryTaxConfig(iso), iso).toBeNull();
      expect(isChargeableCountry(iso), iso).toBe(false);
    }
  });
});

// 🇨🇦 Canadá. Es el único país de la tabla que NO cabe en el modelo de una fila por país:
// tiene cinco registros (federal + 4 provincias), tasas que van de 5% a 15% según dónde esté
// el comprador, y dos provincias SIN umbral. Se integró cubriendo los tres niveles con umbral
// y asumiendo a conciencia la exposición de Saskatchewan y Manitoba. Ver impuestos.md §6.8.
describe("Canadá — el país que no cabe en el modelo", () => {
  it("vende con cobro CERO mientras no haya alta", () => {
    expect(isChargeableCountry("CA")).toBe(true);
    expect(computeConsumptionTax(100, "CA").total).toBe(100);
    expect(platformCollectsTax("CA")).toBe(false);
    expect(chargeCurrencyForCountry("CA")).toBe("CAD");
    expect(shouldAddFxFee("CA")).toBe(true);
  });

  // 🚨 En los otros 17 países bajo umbral, cruzarlo se resuelve poniendo registrationStatus
  // en "registered" y el motor hace el resto. En Canadá ESO NO BASTA: la tasa efectiva
  // depende de la provincia del comprador (5% Alberta … 15% Nueva Escocia) y resolveCountry
  // solo distingue país. Quien haga el flip sin resolver provincia va a cobrar mal.
  it("🚨 la tasa guardada es el SUELO federal, no la tasa de Canadá", () => {
    expect(taxRateForCountry("CA")).toBe(0.05);
    // Si alguien "corrige" esto a una tasa promedio o al HST máximo, es señal de que creyó
    // que Canadá se comporta como los demás. No lo hace.
    expect(taxRateForCountry("CA")).not.toBe(0.15);
    expect(taxRateForCountry("CA")).toBeLessThan(taxRateForCountry("MX"));
  });

  it("está bajo umbral, como los otros 17", () => {
    expect(countryTaxConfig("CA")!.collectionMode).toBe("platform");
    expect(countryTaxConfig("CA")!.registrationStatus).toBe("not_registered");
    expect(countryTaxConfig("CA")!.mxVatTreatment).toBe("export_zero");
  });
});

// 🇺🇸 Estados Unidos. Comparte con Canadá la limitación de modelo (el impuesto es por
// subdivisión, no por país) pero NO su exposición: ningún estado tiene umbral cero, así que
// vender sin registro es legal en los 50. Ver impuestos.md §6.9.
describe("Estados Unidos", () => {
  it("vende con cobro CERO y en dólares", () => {
    expect(isChargeableCountry("US")).toBe(true);
    expect(computeConsumptionTax(100, "US").total).toBe(100);
    expect(platformCollectsTax("US")).toBe(false);
    expect(chargeCurrencyForCountry("US")).toBe("USD");
  });

  // 🚨 Tasa 0 NO significa "aquí no hay impuesto": significa que no existe una tasa FEDERAL
  // que guardar (van de 2,9% a 7,25% de base estatal, más locales). La diferencia con Hong
  // Kong o Guam —donde el impuesto de verdad no existe— está en el helper, no en la tasa.
  it("🚨 tasa 0 por falta de tasa federal, NO por ausencia de impuesto", () => {
    expect(taxRateForCountry("US")).toBe(0);
    // Bajo umbral de un régimen que SÍ existe...
    expect(countryTaxConfig("US")!.collectionMode).toBe("platform");
    expect(countryTaxConfig("US")!.registrationStatus).toBe("not_registered");
    // ...a diferencia de Hong Kong y Guam, donde no hay nada que recaudar nunca.
    expect(countryTaxConfig("HK")!.collectionMode).toBe("none");
    expect(countryTaxConfig("GU")!.collectionMode).toBe("none");
  });

  // El 2% de conversión sí aplica: se liquida en MXN, así que hay cambio de divisa real.
  it("cobra el 2% de FX (la liquidación es en MXN)", () => {
    expect(shouldAddFxFee("US")).toBe(true);
    expect(fxFeeRateForCountry("US")).toBeGreaterThan(0);
  });
});

// 🇧🇷🇨🇴🇨🇱🇵🇪 LatAm con alta obligatoria desde la venta 1. A diferencia de los 19 países
// bajo umbral, aquí NO existe el estado "vender sin cobrar": vender sin alta es ilegal.
// Están encendidos para probar con Stripe en modo prueba; sus altas reales siguen pendientes.
describe("LatAm con alta obligatoria — BR, CO, CL, PE, UY", () => {
  const CUATRO: Array<[string, number, string, string]> = [
    ["BR", 0.01, "BRL", "CBS+IBS"],
    ["CO", 0.19, "COP", "IVA"],
    ["CL", 0.19, "CLP", "IVA"],
    ["PE", 0.18, "PEN", "IGV"],
    ["UY", 0.22, "UYU", "IVA"],
  ];

  it("los cuatro COBRAN el impuesto: recauda la plataforma", () => {
    for (const [iso, tasa] of CUATRO) {
      expect(isChargeableCountry(iso), iso).toBe(true);
      expect(platformCollectsTax(iso), iso).toBe(true);
      expect(countryTaxConfig(iso)!.collectionMode, iso).toBe("platform");
      expect(countryTaxConfig(iso)!.registrationStatus, iso).toBe("registered");
      expect(computeConsumptionTax(100, iso).tax, iso).toBeCloseTo(100 * tasa, 6);
    }
  });

  it("tasas, monedas y nombres correctos", () => {
    for (const [iso, tasa, moneda, nombre] of CUATRO) {
      expect(taxRateForCountry(iso), iso).toBeCloseTo(tasa, 8);
      expect(chargeCurrencyForCountry(iso), iso).toBe(moneda);
      expect(countryTaxConfig(iso)!.taxName, iso).toBe(nombre);
      expect(shouldAddFxFee(iso), iso).toBe(true);
    }
  });

  // 🚨 Brasil es el ÚNICO país de la tabla cuya tasa cambia con el calendario. Hoy 1% (año de
  // prueba), ~8,9% en 2027, 26,5% en 2033. Quien vea "1%" y lo tome por error de dedo estaría
  // cobrándole a los brasileños 26 veces de más, siete años antes de tiempo.
  it("🚨 Brasil cobra 1% HOY, no el 26,5% del régimen final", () => {
    expect(taxRateForCountry("BR")).toBeCloseTo(0.01, 8);
    expect(taxRateForCountry("BR")).not.toBeCloseTo(0.265, 3);
    expect(computeConsumptionTax(1000, "BR").tax).toBeCloseTo(10, 6);
  });

  // 🚨 Lista de verificación previa a sk_live. Mientras tenga entradas, hay países cobrando
  // un impuesto que Vibra todavía no puede enterar. En modo prueba es inocuo; en producción
  // sería quedarse con dinero ajeno.
  it("🚨 ALTAS_PENDIENTES refleja exactamente los que están encendidos sin alta", () => {
    expect([...ALTAS_PENDIENTES].sort()).toEqual(
      ["AE", "AL", "BR", "CL", "CO", "GB", "KR", "MD", "ME", "PE", "RS", "SA", "TR", "UY", "VN"],
    );
    // Todo el que esté en la lista debe estar cobrando (si no, sobra en la lista).
    for (const iso of ALTAS_PENDIENTES) {
      expect(platformCollectsTax(iso), iso + " está en ALTAS_PENDIENTES pero no cobra").toBe(true);
    }
  });

  // 🚨 Uruguay cobra DOS impuestos pero solo uno se le cobra al comprador. El IRNR 12% es
  // impuesto a la RENTA de Vibra, sale de su margen, y por eso NO debe aparecer en taxRate.
  // Si alguien "completa" la tasa a 0.34 (22+12), le estaría cobrando al comprador uruguayo
  // un impuesto que no le corresponde pagar.
  it("🚨 Uruguay cobra 22% al comprador, NO 34%: el IRNR no se traslada", () => {
    expect(taxRateForCountry("UY")).toBeCloseTo(0.22, 8);
    expect(taxRateForCountry("UY")).not.toBeCloseTo(0.34, 3);
    expect(computeConsumptionTax(100, "UY").tax).toBeCloseTo(22, 6);
  });

  // Contraste con los de umbral: allá vender sin alta es legal, aquí no.
  it("no confundirlos con los países bajo umbral", () => {
    expect(countryTaxConfig("JP")!.registrationStatus).toBe("not_registered");
    expect(platformCollectsTax("JP")).toBe(false);
    expect(countryTaxConfig("CL")!.registrationStatus).toBe("registered");
    expect(platformCollectsTax("CL")).toBe(true);
  });
});

// 🇬🇧🇹🇷🇷🇸🇦🇱🇲🇪🇲🇩 Europa no comunitaria con alta obligatoria. El OSS no cubre nada de esto.
describe("Europa no comunitaria con alta obligatoria", () => {
  const SEIS: Array<[string, number, string, string]> = [
    ["GB", 0.20, "GBP", "VAT"],
    ["TR", 0.20, "TRY", "KDV"],
    ["RS", 0.20, "RSD", "PDV"],
    ["AL", 0.20, "ALL", "TVSH"],
    ["ME", 0.21, "EUR", "PDV"],
    ["MD", 0.20, "MDL", "TVA"],
  ];

  it("los seis cobran su impuesto y recauda la plataforma", () => {
    for (const [iso, tasa, moneda, nombre] of SEIS) {
      expect(platformCollectsTax(iso), iso).toBe(true);
      expect(taxRateForCountry(iso), iso).toBeCloseTo(tasa, 8);
      expect(chargeCurrencyForCountry(iso), iso).toBe(moneda);
      expect(countryTaxConfig(iso)!.taxName, iso).toBe(nombre);
      expect(computeConsumptionTax(100, iso).tax, iso).toBeCloseTo(100 * tasa, 6);
    }
  });

  // 🚨 Montenegro usa el EURO pero NO es de la UE: el OSS no lo cubre y necesita registro
  // propio. Si alguien lo mete en la lista de los 27 "porque paga en euros", quedaría
  // cubierto por un registro que no lo alcanza.
  it("🚨 Montenegro paga en euros pero NO es UE: registro aparte", () => {
    expect(chargeCurrencyForCountry("ME")).toBe("EUR");
    expect(chargeCurrencyForCountry("DE")).toBe("EUR");
    // La UE se controla con un solo interruptor; Montenegro con el suyo.
    expect(countryTaxConfig("ME")!.taxName).toBe("PDV");
    expect(countryTaxConfig("DE")!.taxName).toBe("IVA");
    expect(ALTAS_PENDIENTES).toContain("ME");
    expect(ALTAS_PENDIENTES).not.toContain("DE");
  });

  // 🚫 Los tres que se dejaron fuera a propósito.
  it("🚫 Macedonia del Norte, Suiza y Liechtenstein siguen fuera", () => {
    for (const iso of ["MK", "CH", "LI"]) {
      expect(countryTaxConfig(iso), iso).toBeNull();
      expect(isChargeableCountry(iso), iso).toBe(false);
    }
  });
});

// 🇰🇷🇻🇳🇦🇪🇸🇦 Asia y Golfo con alta obligatoria. Sin representante fiscal, trimestrales.
describe("Asia y Golfo con alta obligatoria", () => {
  const CUATRO: Array<[string, number, string]> = [
    ["KR", 0.10, "KRW"],
    ["VN", 0.10, "VND"],
    ["AE", 0.05, "AED"],
    ["SA", 0.15, "SAR"],
  ];

  it("los cuatro cobran su impuesto y recauda la plataforma", () => {
    for (const [iso, tasa, moneda] of CUATRO) {
      expect(platformCollectsTax(iso), iso).toBe(true);
      expect(taxRateForCountry(iso), iso).toBeCloseTo(tasa, 8);
      expect(chargeCurrencyForCountry(iso), iso).toBe(moneda);
      expect(computeConsumptionTax(100, iso).tax, iso).toBeCloseTo(100 * tasa, 6);
    }
  });

  // 🚨 Vietnam cobra VAT 10% al comprador Y un CIT 5% sobre bruto que sale del margen.
  // Ese 5% NO se absorbe como en Uruguay: se recupera subiendo el cargo de conversión del
  // dong al 7% (2% estándar + 5% del CIT). Es PRECIO, no impuesto, y no se desglosa.
  // Si alguien lo baja al 2% "por consistencia", cada venta vietnamita pierde 5 puntos.
  it("🚨 Vietnam lleva 7% de conversión, no el 2% estándar", () => {
    // 7% = 2% + 5% del CIT vietnamita.
    expect(fxFeeRateForCountry("VN")).toBeCloseTo(0.07, 8);
    // 🚫 Uruguay se probó al 14% y se descartó: el total subía a $143 por cada $100 de base,
    // el más caro de la tabla, porque el IVA del 22% se calcula DESPUÉS del ajuste. Se
    // prefirió absorber el IRNR. Si alguien lo sube, ese número es el que hay que revisar.
    expect(fxFeeRateForCountry("UY")).toBeCloseTo(0.02, 8);
    // El resto del mundo sigue en 2%.
    for (const iso of ["KR", "AE", "SA", "DE", "JP", "BR"]) {
      expect(fxFeeRateForCountry(iso), iso).toBeCloseTo(0.02, 8);
    }
    // México no lleva conversión: se cobra en la moneda de liquidación.
    expect(fxFeeRateForCountry("MX")).toBe(0);
  });

  // El 7% NO es impuesto: la tabla fiscal de Vietnam sigue diciendo 10%, que es lo único
  // que se le desglosa al comprador.
  it("los ajustes no contaminan la tasa fiscal", () => {
    expect(taxRateForCountry("VN")).toBeCloseTo(0.10, 8);
    expect(countryTaxConfig("VN")!.taxName).toBe("VAT");
    // Uruguay desglosa 22% al comprador, no 34%: el IRNR 12% lo absorbe Vibra.
    expect(taxRateForCountry("UY")).toBeCloseTo(0.22, 8);
  });
});

// 🇲🇽 IVA mexicano sobre ventas al EXTRANJERO. Vibra es residente en México, así que por el
// Art. 16 LIVA su venta siempre está dentro del objeto: lo que cambia es la tasa. Hoy 0% por
// exportación en los 11 servicios (D-08 pendiente de fiscalista). Ver impuestos.md.
describe("IVA mexicano de exportación — 0% por servicio", () => {
  const SERVICIOS: ServiceType[] = [
    "supercomment", "profile_donation", "live_donation", "live_ticket",
    "premium_post", "greeting", "advice", "exclusive_session",
    "live_session", "subscription", "vod_ticket",
  ];

  it("están los 11 servicios en la tabla", () => {
    expect(Object.keys(MX_EXPORT_TREATMENT_BY_SERVICE).sort()).toEqual([...SERVICIOS].sort());
  });

  it("🟢 los 11 están en 0% por exportación", () => {
    for (const s of SERVICIOS) {
      expect(MX_EXPORT_TREATMENT_BY_SERVICE[s], s).toBe("export_zero");
    }
  });

  it("comprador en México → doméstico 16%, sin importar el servicio", () => {
    for (const s of SERVICIOS) {
      expect(mxVatTreatmentForSale("MX", s), s).toBe("domestic_16");
    }
  });

  it("comprador fuera → 0% de exportación, en cualquier país", () => {
    for (const pais of ["DE", "ES", "AR", "CR", "EC", "PY", "DO"]) {
      expect(mxVatTreatmentForSale(pais, "premium_post"), pais).toBe("export_zero");
    }
  });

  it("sin servicio informado cae al default (0%), nunca a 16%", () => {
    expect(mxVatTreatmentForSale("DE", null)).toBe("export_zero");
    expect(mxVatTreatmentForSale("DE", undefined)).toBe("export_zero");
  });

  // El punto de tenerlo por servicio: cambiar UNO no debe arrastrar a los demás.
  it("el régimen es POR SERVICIO, no por país", () => {
    const porPais = new Set(["DE", "AR", "PY"].map((c) => mxVatTreatmentForSale(c, "greeting")));
    expect(porPais.size).toBe(1); // el país no lo cambia…
    // …y la tabla permite diferenciarlos uno por uno cuando el fiscalista lo dictamine.
    expect(Object.keys(MX_EXPORT_TREATMENT_BY_SERVICE)).toHaveLength(11);
  });
});
