// Paridad y cobertura de la tabla de niveles de retiro.
//
// Dos preguntas, y las dos han costado fallos reales en este repo:
//
//   1. ¿Dicen lo mismo el backend y su espejo del frontend? Si se separan, el creador ve una
//      cifra en la wallet y cobra otra.
//   2. ¿Está TODO país vendible clasificado? La tabla fiscal tiene 147 países cobrables. Si
//      uno se queda sin nivel, su creador acumula saldo que nadie sabe cómo pagarle.

import { describe, it, expect } from "vitest";

import * as back from "../src/wallet/payoutTiers";
// El espejo del frontend, tal cual, por ruta relativa: el alias `@/` no existe aquí.
import * as front from "../../lib/wallet/payoutTiers";
import { COUNTRY_TAX_CONFIG } from "../src/tax/config";

describe("niveles de retiro — paridad backend / frontend", () => {
  it("las dos tablas país→nivel son idénticas", () => {
    expect(front.PAYOUT_TIER_BY_COUNTRY).toEqual(back.PAYOUT_TIER_BY_COUNTRY);
  });

  it("las dos condiciones de cada nivel son idénticas", () => {
    expect(front.PAYOUT_TERMS).toEqual(back.PAYOUT_TERMS);
  });

  it("las dos listas de países sin ruta de pago son idénticas", () => {
    expect([...front.UNPAYABLE_COUNTRIES]).toEqual([...back.UNPAYABLE_COUNTRIES]);
  });

  it("resuelven igual país por país, incluida la respuesta vacía", () => {
    const todos = [
      ...Object.keys(back.PAYOUT_TIER_BY_COUNTRY),
      ...back.UNPAYABLE_COUNTRIES,
      "ZZ",
      "",
    ];
    for (const c of todos) {
      expect(front.payoutTermsOf(c)).toEqual(back.payoutTermsOf(c));
    }
  });
});

describe("niveles de retiro — cobertura", () => {
  it("los cuatro grupos suman los 147 países de la tabla fiscal, sin sobras ni faltas", () => {
    const clasificados = new Set([
      ...Object.keys(back.PAYOUT_TIER_BY_COUNTRY),
      ...back.UNPAYABLE_COUNTRIES,
      // Los territorios que cobran con la cuenta de otro país también están resueltos.
      ...Object.keys(back.PAYOUT_COUNTRY_ALIAS),
    ]);
    const vendibles = new Set(Object.keys(COUNTRY_TAX_CONFIG));

    const sinNivel = [...vendibles].filter((c) => !clasificados.has(c)).sort();
    const sinVenta = [...clasificados].filter((c) => !vendibles.has(c)).sort();

    // Se comprueban por separado para que el fallo diga CUÁLES, no solo que no cuadra.
    expect({ sinNivel, sinVenta }).toEqual({ sinNivel: [], sinVenta: [] });
    expect(clasificados.size).toBe(vendibles.size);
  });

  it("ningún país está en dos grupos a la vez", () => {
    const duplicados = back.UNPAYABLE_COUNTRIES.filter(
      (c) => c in back.PAYOUT_TIER_BY_COUNTRY
    );
    expect(duplicados).toEqual([]);
  });

  it("los tamaños de los grupos son los acordados", () => {
    // Se cuenta por RUTA y no solo por nivel: los 12 de Wallbit también son `standard`, así
    // que un recuento por nivel los mezclaría con los 46 de transferencia local de Stripe.
    const t = Object.values(back.PAYOUT_TERMS_BY_COUNTRY);
    const cuenta = (ruta: string, nivel: string) =>
      t.filter((x) => x.route === ruta && x.tier === nivel).length;

    expect(cuenta("stripe", "standard")).toBe(46); // transferencia local, 1.50 USD
    expect(cuenta("stripe", "expensive")).toBe(27); // solo wire, 25 USD
    expect(cuenta("wallbit", "standard")).toBe(12);
    expect(cuenta("wallbit", "expensive")).toBe(0); // Wallbit nunca sale caro

    expect(back.UNPAYABLE_COUNTRIES.length).toBe(58);
    expect(Object.keys(back.PAYOUT_COUNTRY_ALIAS).length).toBe(4);
  });

  it("un alias no aparece además como país propio", () => {
    // Estaría en dos sitios y ganaría el que se consultara primero.
    for (const c of Object.keys(back.PAYOUT_COUNTRY_ALIAS)) {
      expect(c in back.PAYOUT_TIER_BY_COUNTRY).toBe(false);
      expect(back.UNPAYABLE_COUNTRIES.includes(c)).toBe(false);
    }
  });
});

describe("niveles de retiro — territorios que cobran por otro país", () => {
  it("Puerto Rico y las Islas Vírgenes cobran como Estados Unidos", () => {
    // Sus bancos son estadounidenses: routing number, no un sistema propio.
    for (const c of ["PR", "VI"]) {
      expect(back.payoutTermsOf(c)).toEqual(back.payoutTermsOf("US"));
      expect(back.isPayableCountry(c)).toBe(true);
    }
  });

  it("Canarias y Ceuta y Melilla cobran como España", () => {
    // ⚠️ `IC` y `EA` ni siquiera son ISO 3166; vienen de la tabla fiscal, donde existen
    // porque su IVA es distinto al peninsular. Su banco es español.
    for (const c of ["IC", "EA"]) {
      expect(back.payoutTermsOf(c)).toEqual(back.payoutTermsOf("ES"));
      expect(back.isPayableCountry(c)).toBe(true);
    }
  });

  it("el espejo resuelve los alias igual que el backend", () => {
    for (const c of Object.keys(back.PAYOUT_COUNTRY_ALIAS)) {
      expect(front.payoutTermsOf(c)).toEqual(back.payoutTermsOf(c));
    }
    expect(front.PAYOUT_COUNTRY_ALIAS).toEqual(back.PAYOUT_COUNTRY_ALIAS);
  });
});

describe("qué país decide la comisión", () => {
  it("la cuenta de cobro manda sobre el documento", () => {
    // Un mexicano con cuenta en Estados Unidos se paga por ACH estadounidense, no por SPEI.
    expect(back.paisDeCobroDe({ payoutAccountCountry: "US", documentCountry: "MX" })).toBe("US");
  });

  it("sin cuenta, decide el documento", () => {
    // Es el caso de TODO creador de ruta Wallbit: nunca da de alta cuenta en Stripe.
    expect(back.paisDeCobroDe({ payoutAccountCountry: null, documentCountry: "BR" })).toBe("BR");
    expect(back.payoutTermsOf(back.paisDeCobroDe({ documentCountry: "BR" }))).toMatchObject({
      route: "wallbit",
      commissionRate: 0.25,
    });
  });

  it("sin ninguno de los dos, no hay país", () => {
    expect(back.paisDeCobroDe({})).toBeNull();
    expect(back.paisDeCobroDe({ payoutAccountCountry: "", documentCountry: "  " })).toBeNull();
  });

  it("el espejo aplica el mismo criterio", () => {
    // Si se separan, el creador ve una comisión y cobra otra.
    const casos = [
      { payoutAccountCountry: "US", documentCountry: "MX" },
      { payoutAccountCountry: null, documentCountry: "BR" },
      { payoutAccountCountry: "TR", documentCountry: "DE" },
      {},
    ];
    for (const c of casos) {
      expect(front.paisDeCobroDe(c)).toBe(back.paisDeCobroDe(c));
    }
  });
});

describe("niveles de retiro — rutas de pago", () => {
  it("los 12 de Wallbit cobran al 25% y desde 300, como los de transferencia local", () => {
    // Es el motivo de meterlos en Wallbit: sacarlos del wire de 25 USD por envío.
    for (const c of ["AR", "BR", "BO", "CO", "GT", "PA", "EC", "SV", "CL", "UY", "PY", "HN"]) {
      const t = back.payoutTermsOf(c);
      expect(t).toMatchObject({ route: "wallbit", commissionRate: 0.25, minWithdrawalUsd: 300 });
    }
  });

  /**
   * 🚨 La lista está FIJADA a propósito, y este test ya evitó un problema real.
   *
   * `soloDolares` es lo que hace salir el aviso del paso 2 del panel de registro, donde se le
   * dice al creador que su única salida es cripto ANTES de que empiece a acumular. Un país
   * que entra o sale de esta lista cambia si a alguien se le avisa o no, así que el cambio
   * tiene que ser deliberado y pasar por aquí.
   *
   * 📅 **2026-09-01: entraron Ecuador y El Salvador.** Estaban clasificados como ruta
   *    completa porque están dolarizados —cierto e irrelevante: el problema no es la
   *    conversión, es que Wallbit no tiene retiro a banco local ahí—. Mientras estuvieron
   *    mal clasificados, sus creadores no veían el aviso. Ver `paiseswallbit.md`.
   */
  it("los seis sin retiro local quedan marcados como solo dólares", () => {
    const soloUsd = Object.entries(back.PAYOUT_TERMS_BY_COUNTRY)
      .filter(([, t]) => t.soloDolares)
      .map(([c]) => c)
      .sort();
    expect(soloUsd).toEqual(["CL", "EC", "HN", "PY", "SV", "UY"]);
  });

  it("🚨 los marcados solo dólares siguen cobrando: la bandera avisa, no bloquea", () => {
    // Se incluyeron por decisión de producto porque la alternativa era no pagarles nada.
    // Si algún día la bandera empezara a impedir el cobro, esto lo cazaría.
    const soloUsd = Object.entries(back.PAYOUT_TERMS_BY_COUNTRY).filter(([, t]) => t.soloDolares);
    expect(soloUsd.length).toBeGreaterThan(0);
    for (const [, t] of soloUsd) {
      expect(t).toMatchObject({ route: "wallbit", commissionRate: 0.25, minWithdrawalUsd: 300 });
    }
  });

  it("todo país pagable tiene una ruta, y ninguna otra", () => {
    for (const t of Object.values(back.PAYOUT_TERMS_BY_COUNTRY)) {
      expect(["stripe", "wallbit"]).toContain(t.route);
    }
    expect(back.payoutRouteOf("MX")).toBe("stripe");
    expect(back.payoutRouteOf("BR")).toBe("wallbit");
    expect(back.payoutRouteOf("NI")).toBeNull();
  });

  it("el espejo resuelve las rutas igual que el backend", () => {
    expect(front.PAYOUT_TERMS_BY_COUNTRY).toEqual(back.PAYOUT_TERMS_BY_COUNTRY);
  });
});

describe("niveles de retiro — resolución", () => {
  it("un país sin ruta de pago devuelve null, NO el estándar", () => {
    // Es la regla que evita prometerle a un creador brasileño un retiro que no existe.
    // ⚠️ Brasil sí y Argentina no: se preguntó a la API una por una. Brasil tiene las dos
    // capacidades en `unsupported`; Argentina y Colombia salen `restricted`, que significa
    // «se puede, faltan datos», así que están en el grupo de wire.
    for (const c of ["NI", "KR", "SA", "NP", "HT"]) {
      expect(back.payoutTermsOf(c)).toBeNull();
      expect(back.isPayableCountry(c)).toBe(false);
      expect(back.isKnownUnpayableCountry(c)).toBe(true);
    }
  });

  it("un país desconocido devuelve null y NO se hace pasar por conocido", () => {
    for (const c of ["ZZ", "XX", "", null, undefined]) {
      expect(back.payoutTermsOf(c)).toBeNull();
      expect(back.isKnownUnpayableCountry(c)).toBe(false);
    }
  });

  it("acepta minúsculas y espacios, que es como llegan de una API", () => {
    expect(back.payoutTermsOf(" mx ")).toEqual(back.PAYOUT_TERMS.standard);
    expect(back.payoutTermsOf("tr")).toEqual(back.PAYOUT_TERMS.expensive);
  });

  it("los países caros llevan 30% y 500, los estándar 25% y 300", () => {
    expect(back.payoutTermsOf("US")).toMatchObject({ commissionRate: 0.25, minWithdrawalUsd: 300 });
    expect(back.payoutTermsOf("MX")).toMatchObject({ commissionRate: 0.25, minWithdrawalUsd: 300 });
    expect(back.payoutTermsOf("JP")).toMatchObject({ commissionRate: 0.3, minWithdrawalUsd: 500 });
    expect(back.payoutTermsOf("TR")).toMatchObject({ commissionRate: 0.3, minWithdrawalUsd: 500 });
  });
});
