// Acumulado mensual y qué comprobantes toca emitir.
//
// La parte que se prueba aquí es la que decide: cuánto se acumuló y qué documentos salen. El
// timbrado en sí es una llamada al proveedor y no tiene lógica propia.

import { describe, it, expect } from "vitest";
import {
  acumularMes,
  documentosDelMes,
  periodoDe,
  rangoDelPeriodo,
} from "../../backend/src/facturacion/creatorMonthlyDocs";
import { agruparGlobal } from "../../backend/src/facturacion/globalInvoice";
import { armarComprobante } from "../../backend/src/facturacion/comprobanteLiquidacion";
import { resolveSettlement, calcularRetiro } from "../../backend/src/tax/fiscalEngine";

/** Mismo redondeo que el motor, para comparar totales sin arrastrar flotantes. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Asiento de venta mexicana: base 100, IVA 16, con retenciones ya congeladas. */
const ventaMx = {
  status: "earned",
  grossAmount: 100,
  retenciones: {
    comision: 25,
    ivaComision: 4,
    isrRetenido: 2.5,
    ivaRetenido: 8,
    mxVatVenta: 16,
    residency: "MX" as const,
  },
};

/** Venta de creador extranjero a comprador mexicano: 100% de IVA retenido, sin ISR. */
const ventaExtranjero = {
  status: "earned",
  grossAmount: 100,
  retenciones: {
    comision: 25,
    ivaComision: 0,
    isrRetenido: 0,
    ivaRetenido: 16,
    mxVatVenta: 16,
    residency: "FOREIGN" as const,
  },
};

describe("comprobantes mensuales / periodo", () => {
  it("el periodo es el mes natural en UTC", () => {
    expect(periodoDe(new Date("2026-08-26T23:00:00Z"))).toBe("2026-08");
    expect(periodoDe(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });

  it("el rango cubre el mes completo y excluye el primero del siguiente", () => {
    const { desde, hasta } = rangoDelPeriodo("2026-02");
    expect(desde.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("diciembre rueda al año siguiente sin romperse", () => {
    const { desde, hasta } = rangoDelPeriodo("2026-12");
    expect(desde.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(hasta.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("comprobantes mensuales / acumulado", () => {
  it("suma las retenciones de todas las ventas ganadas", () => {
    const a = acumularMes("c1", "2026-08", [ventaMx, ventaMx, ventaMx]);
    expect(a.ventas).toBe(3);
    expect(a.base).toBe(300);
    expect(a.comision).toBe(75);
    expect(a.ivaComision).toBe(12);
    expect(a.isrRetenido).toBe(7.5);
    expect(a.ivaRetenido).toBe(24);
  });

  it("ignora lo pendiente: todavía puede rechazarse", () => {
    const pendiente = { ...ventaMx, status: "pending" };
    const a = acumularMes("c1", "2026-08", [ventaMx, pendiente]);
    expect(a.ventas).toBe(1);
    expect(a.isrRetenido).toBe(2.5);
  });

  it("ignora lo reembolsado y lo rechazado", () => {
    const a = acumularMes("c1", "2026-08", [
      ventaMx,
      { ...ventaMx, status: "refunded" },
      { ...ventaMx, status: "rejected" },
    ]);
    expect(a.ventas).toBe(1);
  });

  it("ignora asientos sin retenciones, que son los anteriores al cambio", () => {
    const a = acumularMes("c1", "2026-08", [ventaMx, { status: "earned", grossAmount: 100 }]);
    expect(a.ventas).toBe(1);
    expect(a.base).toBe(100);
  });

  it("un mes sin ventas da un acumulado en ceros", () => {
    const a = acumularMes("c1", "2026-08", []);
    expect(a.ventas).toBe(0);
    expect(a.base).toBe(0);
  });
});

describe("comprobantes mensuales / qué documentos tocan", () => {
  it("creador mexicano recibe comisión y constancia de retenciones", () => {
    const d = documentosDelMes(acumularMes("c1", "2026-08", [ventaMx]));
    expect(d.comision).toBe(true);
    expect(d.retenciones).toBe(true);
    expect(d.liquidacion).toBe(false);
  });

  it("creador extranjero con comprador mexicano TAMBIÉN recibe constancia", () => {
    // Se le retiene el 100% del IVA, así que hay retención mexicana que constar —aunque el
    // receptor sea extranjero. Es la corrección del fiscalista del 26 de agosto.
    const d = documentosDelMes(acumularMes("c1", "2026-08", [ventaExtranjero]));
    expect(d.retenciones).toBe(true);
    expect(d.liquidacion).toBe(false);
  });

  it("sin ninguna retención mexicana el tercer documento es liquidación, no CFDI", () => {
    // Creador extranjero + comprador extranjero: no hay nada que retener.
    const sinRetencion = {
      status: "earned",
      grossAmount: 100,
      retenciones: {
        comision: 25,
        ivaComision: 0,
        isrRetenido: 0,
        ivaRetenido: 0,
        residency: "FOREIGN" as const,
      },
    };
    const d = documentosDelMes(acumularMes("c1", "2026-08", [sinRetencion]));
    expect(d.comision).toBe(true);
    expect(d.retenciones).toBe(false);
    expect(d.liquidacion).toBe(true);
  });

  it("un mes sin ventas no genera ningún documento", () => {
    const d = documentosDelMes(acumularMes("c1", "2026-08", []));
    expect(d.comision).toBe(false);
    expect(d.retenciones).toBe(false);
    expect(d.liquidacion).toBe(false);
  });
});

describe("factura global / agrupación", () => {
  it("agrupa por TIPO de servicio, no una línea por venta", () => {
    const r = agruparGlobal("c1", "2026-08", [
      { type: "greeting", base: 100, tax: 16 },
      { type: "greeting", base: 50, tax: 8 },
      { type: "premium_post", base: 30, tax: 4.8 },
    ]);
    expect(r.ventas).toBe(3);
    expect(Object.keys(r.porTipo)).toHaveLength(2);
    expect(r.porTipo.greeting.ventas).toBe(2);
    expect(r.porTipo.greeting.base).toBe(150);
    expect(r.base).toBe(180);
    expect(r.tax).toBe(28.8);
  });

  it("ignora ventas sin base", () => {
    const r = agruparGlobal("c1", "2026-08", [{ type: "greeting", base: 0, tax: 0 }]);
    expect(r.ventas).toBe(0);
  });

  it("un mes sin ventas sin facturar no genera global", () => {
    const r = agruparGlobal("c1", "2026-08", []);
    expect(r.ventas).toBe(0);
    expect(Object.keys(r.porTipo)).toHaveLength(0);
  });
});

describe("comprobante de liquidación", () => {
  const acc = acumularMes("c1", "2026-08", [
    {
      status: "earned",
      grossAmount: 400,
      retenciones: { comision: 100, ivaComision: 0, isrRetenido: 0, ivaRetenido: 0, residency: "FOREIGN" as const },
    },
  ]);

  it("desglosa de la venta al neto", () => {
    const c = armarComprobante(acc, "USD", "2026-09-05T09:00:00Z");
    expect(c.base).toBe(400);
    expect(c.comision).toBe(100);
    expect(c.participacion).toBe(300);
    expect(c.neto).toBe(300);
    expect(c.currency).toBe("USD");
  });

  it("suma el IVA cobrado y descuenta las retenciones", () => {
    const conRetencion = acumularMes("c1", "2026-08", [ventaMx]);
    const c = armarComprobante(conRetencion, "USD", "2026-09-05T09:00:00Z");
    expect(c.participacion).toBe(75);
    expect(c.mxVatVenta).toBe(16);
    expect(c.neto).toBe(76.5); // 75 + 16 − 4 − 2.5 − 8
  });

  it("🚨 el comprobante del mes CUADRA con la liquidación de cada venta", () => {
    // El comprobante y el retiro tienen que decir lo MISMO, porque son el mismo dinero.
    // Hasta el 2026-08-30 los dos omitían el IVA cobrado y daban 16 de menos por venta;
    // se arreglaron a la vez y este test impide que uno se quede atrás del otro.
    const porVenta = resolveSettlement({
      base: 100,
      mxVatAmount: 16,
      creador: { residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" },
    });
    const mes = acumularMes("c1", "2026-08", [ventaMx, ventaMx, ventaMx]);
    const c = armarComprobante(mes, "USD", "2026-09-05T09:00:00Z");
    expect(c.neto).toBe(round2(porVenta.neto * 3));

    // Y el retiro de ese mismo mes, por la vía de los contadores del resumen.
    const retiro = calcularRetiro({
      saldo: mes.base - mes.comision,
      ivaCobradoPendiente: mes.mxVatVenta,
      isrPendiente: mes.isrRetenido,
      ivaPendiente: mes.ivaRetenido,
      ivaComisionPendiente: mes.ivaComision,
    });
    expect(retiro.neto).toBe(c.neto);
  });

  it("el neto nunca es negativo", () => {
    const imposible = acumularMes("c1", "2026-08", [
      {
        status: "earned",
        grossAmount: 10,
        retenciones: { comision: 2.5, ivaComision: 0, isrRetenido: 50, ivaRetenido: 0, mxVatVenta: 0, residency: "MX" as const },
      },
    ]);
    expect(armarComprobante(imposible, "USD", "x").neto).toBe(0);
  });
});
