// Los pesos de una venta, congelados el día que ocurrió.
//
// Este módulo existe porque los tres emisores del proceso mensual mandaban a Facturapi los
// DÓLARES del ledger declarando `currency: "MXN"`. Una global de 100 USD se habría timbrado
// como $100 MXN. Ver `pendientesimpuestos.md` §A0.
//
// Lo que se prueba aquí no es aritmética bonita: es que el importe de un documento fiscal salga
// del cobro que de verdad ocurrió, y que cuando no se pueda, se note en vez de inventarse.

import { describe, it, expect } from "vitest";
import {
  tipoCambioDelCobro,
  convertirAPesos,
  importeFiscalDeLaVenta,
  leerImporteFiscal,
} from "../src/facturacion/importeFiscal";
import { rangoDelPeriodo } from "../src/facturacion/creatorMonthlyDocs";
import { diaAnterior } from "../src/facturacion/runGlobalInvoice";

describe("tipo de cambio despejado del cobro", () => {
  it("sale de lo que se le cargó a la tarjeta, no de una tabla", () => {
    // 100 USD que se cobraron como 1,850 MXN ⇒ la tasa de ESA operación fue 18.50.
    expect(
      tipoCambioDelCobro({
        presentmentCurrency: "MXN",
        presentmentAmount: 1850,
        settlementAmount: 100,
      })
    ).toBeCloseTo(18.5, 10);
  });

  it("🚨 con saldo a favor divide entre el REMANENTE, no entre el total", () => {
    // Venta de 100 USD, 60 pagados con crédito: a la tarjeta solo fueron 40 USD = 740 MXN.
    // Dividir entre los 100 daría 7.40 y la factura saldría a menos de la mitad.
    const tasa = tipoCambioDelCobro({
      presentmentCurrency: "MXN",
      presentmentAmount: 740,
      settlementAmount: 100,
      creditApplied: 60,
    });
    expect(tasa).toBeCloseTo(18.5, 10);
  });

  it("devuelve null si pagó TODO con saldo: no hubo cargo del que despejar nada", () => {
    expect(
      tipoCambioDelCobro({
        presentmentCurrency: "MXN",
        presentmentAmount: 0,
        settlementAmount: 100,
        creditApplied: 100,
      })
    ).toBeNull();
  });

  it("devuelve null si no se cobró en pesos", () => {
    expect(
      tipoCambioDelCobro({
        presentmentCurrency: "EUR",
        presentmentAmount: 92,
        settlementAmount: 100,
      })
    ).toBeNull();
  });

  it("🚨 rechaza una tasa imposible: el error realista son centavos por pesos", () => {
    // 185000 «pesos» por 100 USD ⇒ 1850, que es el importe guardado en centavos. Si se colara,
    // el CFDI saldría cien veces mayor.
    expect(
      tipoCambioDelCobro({
        presentmentCurrency: "MXN",
        presentmentAmount: 185000,
        settlementAmount: 100,
      })
    ).toBeNull();
  });

  it("aguanta basura de Firestore sin explotar", () => {
    expect(tipoCambioDelCobro(null)).toBeNull();
    expect(tipoCambioDelCobro({})).toBeNull();
    expect(
      tipoCambioDelCobro({ presentmentCurrency: "MXN", presentmentAmount: "x", settlementAmount: 100 })
    ).toBeNull();
  });
});

describe("conversión a pesos", () => {
  it("🚨 base + iva SIEMPRE suman el total", () => {
    // Redondear base e IVA por separado deja un centavo suelto, y un CFDI cuyos conceptos no
    // suman el total es un CFDI que el SAT rechaza.
    for (const base of [33.33, 10.01, 99.99, 0.07, 1234.56]) {
      const r = convertirAPesos({
        baseUsd: base,
        ivaUsd: base * 0.16,
        tipoCambio: 18.4573,
        fuente: "cobro",
      });
      expect(r.base + r.iva).toBeCloseTo(r.total, 10);
    }
  });

  it("exportación a 0%: el total es la base y el IVA queda en cero", () => {
    const r = convertirAPesos({ baseUsd: 100, ivaUsd: 0, tipoCambio: 18.5, fuente: "cobro" });
    expect(r.base).toBe(1850);
    expect(r.iva).toBe(0);
    expect(r.total).toBe(1850);
  });

  it("el residuo del redondeo se le carga al IVA, nunca a la base", () => {
    // La base es lo que el creador vendió; el IVA es la partida que se despeja.
    const r = convertirAPesos({ baseUsd: 10, ivaUsd: 1.6, tipoCambio: 18.333333, fuente: "cobro" });
    expect(r.base).toBe(183.33);
    expect(r.base + r.iva).toBeCloseTo(r.total, 10);
  });
});

describe("importe fiscal de la venta", () => {
  it("prefiere el cobro real y lo marca", () => {
    const r = importeFiscalDeLaVenta({
      baseUsd: 100,
      ivaUsd: 16,
      cobro: { presentmentCurrency: "MXN", presentmentAmount: 2146, settlementAmount: 116 },
      tasaDeTabla: 20,
    });
    expect(r?.fuente).toBe("cobro");
    expect(r?.tipoCambio).toBeCloseTo(18.5, 10);
  });

  it("cae a la tabla solo si el cobro no sirve, y lo deja marcado", () => {
    const r = importeFiscalDeLaVenta({
      baseUsd: 100,
      ivaUsd: 16,
      cobro: { presentmentCurrency: "MXN", settlementAmount: 116, creditApplied: 116 },
      tasaDeTabla: 18.5,
    });
    expect(r?.fuente).toBe("tabla");
    expect(r?.total).toBe(2146);
  });

  it("🚨 sin cobro NI tabla devuelve null: la venta se registra sin congelar, no con un número inventado", () => {
    expect(importeFiscalDeLaVenta({ baseUsd: 100, ivaUsd: 16 })).toBeNull();
    expect(importeFiscalDeLaVenta({ baseUsd: 100, ivaUsd: 16, tasaDeTabla: 0 })).toBeNull();
  });
});

describe("lectura de lo congelado", () => {
  it("distingue «no congelado» de «vale cero»", () => {
    expect(leerImporteFiscal(undefined)).toBeNull();
    expect(leerImporteFiscal({ total: 0, base: 0, iva: 0, tipoCambio: 18.5 })).toBeNull();
    expect(leerImporteFiscal({ total: 1850, base: 1850, iva: 0, tipoCambio: 0 })).toBeNull();
  });

  it("lee lo que escribió la venta", () => {
    const congelado = convertirAPesos({ baseUsd: 100, ivaUsd: 16, tipoCambio: 18.5, fuente: "cobro" });
    const leido = leerImporteFiscal({ ...congelado, congeladoEn: "cualquier cosa" });
    expect(leido).toEqual(congelado);
  });
});

describe("periodos en hora de México (§A1, AUD-2)", () => {
  // 🇲🇽 Un periodo fiscal mexicano se mide con el calendario mexicano. Antes se cortaba en
  // medianoche UTC —las 18:00 de aquí— y las ventas de la tarde acababan documentadas en el día
  // siguiente. México no tiene horario de verano desde 2022, así que el desfase es fijo, UTC-6.

  it("🚨 una venta de las 19:00 en México pertenece a ESE día, no al siguiente", () => {
    // Es el caso que destapó AUD-2. 19:00 del 14 en México son las 01:00 UTC del 15.
    const venta = new Date("2026-09-15T01:00:00.000Z");
    const dia14 = rangoDelPeriodo("2026-09-14");
    const dia15 = rangoDelPeriodo("2026-09-15");

    expect(venta >= dia14.desde && venta < dia14.hasta).toBe(true);
    expect(venta >= dia15.desde && venta < dia15.hasta).toBe(false);
  });

  it("el día va de las 06:00 UTC a las 06:00 UTC del siguiente", () => {
    const { desde, hasta } = rangoDelPeriodo("2026-09-15");
    expect(desde.toISOString()).toBe("2026-09-15T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-09-16T06:00:00.000Z");
  });

  it("🚨 el último día del mes no se desborda al mes siguiente", () => {
    const { desde, hasta } = rangoDelPeriodo("2026-08-31");
    expect(desde.toISOString()).toBe("2026-08-31T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-09-01T06:00:00.000Z");
  });

  it("un `YYYY-MM` acota el mes mexicano entero, para la comisión y la constancia", () => {
    const { desde, hasta } = rangoDelPeriodo("2026-02");
    expect(desde.toISOString()).toBe("2026-02-01T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-03-01T06:00:00.000Z");
  });

  it("los días son contiguos: ninguna venta se pierde ni se cuenta dos veces", () => {
    expect(rangoDelPeriodo("2026-09-14").hasta.getTime()).toBe(
      rangoDelPeriodo("2026-09-15").desde.getTime()
    );
  });

  it("el cron de la 01:00 de México pide el día que acaba de cerrar", () => {
    // 01:00 hora de México = 07:00 UTC. Le toca el día anterior completo.
    expect(diaAnterior(new Date("2026-09-01T07:00:00.000Z"))).toBe("2026-08-31");
    expect(diaAnterior(new Date("2026-01-01T07:00:00.000Z"))).toBe("2025-12-31");
    expect(diaAnterior(new Date("2028-03-01T07:00:00.000Z"))).toBe("2028-02-29"); // bisiesto
  });
});
