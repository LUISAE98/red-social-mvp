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
  it("los tres grupos suman los 147 países de la tabla fiscal, sin sobras ni faltas", () => {
    const clasificados = new Set([
      ...Object.keys(back.PAYOUT_TIER_BY_COUNTRY),
      ...back.UNPAYABLE_COUNTRIES,
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
    const porNivel = Object.values(back.PAYOUT_TIER_BY_COUNTRY);
    expect(porNivel.filter((t) => t === "standard").length).toBe(45);
    expect(porNivel.filter((t) => t === "expensive").length).toBe(29);
    expect(back.UNPAYABLE_COUNTRIES.length).toBe(73);
  });
});

describe("niveles de retiro — resolución", () => {
  it("un país sin ruta de pago devuelve null, NO el estándar", () => {
    // Es la regla que evita prometerle a un creador brasileño un retiro que no existe.
    for (const c of ["BR", "AR", "CO", "CL", "KR"]) {
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
