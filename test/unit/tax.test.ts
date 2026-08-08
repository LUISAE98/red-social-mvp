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
  mxVatTreatmentForSale,
  MX_EXPORT_TREATMENT_BY_SERVICE,
  type ServiceType,
} from "@/lib/tax/config";
import {
  resolveTaxCountryFromIndicios,
  type CountryIndicios,
} from "../../backend/src/tax/resolveCountry";

// País deliberadamente NO configurado, para probar el camino "sin ficha".
// Ojo al elegirlo: debe seguir SIN fila en COUNTRY_TAX_CONFIG. Antes era "AR", pero
// Argentina se habilitó el 2026-08-08 y el centinela dejó de valer.
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
