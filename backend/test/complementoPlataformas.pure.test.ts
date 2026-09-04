// El complemento «Servicios de Plataformas Tecnológicas» del CFDI de retenciones (§A4).
//
// Lo que se protege aquí es que el documento con el que un creador acredita ante el SAT lo que
// se le retuvo salga bien. El código mandaba la clave `14` —dividendos— y sin complemento; con
// eso, o no timbra, o timbra mal y el creador acredita algo que no es.

import { describe, it, expect } from "vitest";
import {
  armarComplemento,
  CVE_RETENC_PLATAFORMAS,
  TIPO_SERVICIO_OTROS,
  PERIODICIDAD_MENSUAL,
  type ServicioDelComplemento,
} from "../src/facturacion/complementoPlataformas";
import { serviciosDelPeriodo } from "../src/facturacion/creatorMonthlyDocs";

const venta = (over: Partial<ServicioDelComplemento> = {}): ServicioDelComplemento => ({
  fecha: "2026-09-15",
  precioSinIva: 1850,
  ivaTrasladado: 296,
  comision: 462.5,
  ivaComision: 74,
  ...over,
});

describe("claves del complemento", () => {
  it("🚨 la clave de retención es 26, no 14", () => {
    // La `14` es «dividendos o utilidades distribuidas». Vibra no reparte dividendos.
    expect(CVE_RETENC_PLATAFORMAS).toBe("26");
  });

  it("el tipo de servicio es «otro tipo de servicios»", () => {
    // El catálogo tiene transporte, alimentos, bienes, hospedaje, comercio, apuestas... y este
    // cajón general, que es donde caben los once servicios de los creadores.
    expect(TIPO_SERVICIO_OTROS).toBe("06");
  });

  it("la periodicidad es mensual, que es uno de los dos únicos valores admitidos", () => {
    expect(PERIODICIDAD_MENSUAL).toBe("02");
  });
});

describe("armado del complemento", () => {
  it("🚨 los totales se SUMAN del detalle, no se reciben", () => {
    // Un complemento cuyos totales no cuadran con sus nodos es un CFDI rechazado, y descubrirlo
    // al timbrar es tarde. Por eso no se aceptan totales de fuera.
    const c = armarComplemento([venta(), venta({ precioSinIva: 1000, ivaTrasladado: 160 })], {
      iva: 228,
      isr: 71.25,
    });

    expect(c.NumServ).toBe(2);
    expect(c.MontToServSIva).toBe(2850);
    expect(c.TotalIvaTrasladado).toBe(456);
  });

  it("lleva un nodo por operación, con su fecha", () => {
    // No es un documento de totales: el SAT exige el detalle servicio por servicio.
    const c = armarComplemento(
      [venta({ fecha: "2026-09-01" }), venta({ fecha: "2026-09-28" })],
      { iva: 296, isr: 92.5 }
    );

    expect(c.Servicios).toHaveLength(2);
    expect(c.Servicios[0].FechaServ).toBe("2026-09-01");
    expect(c.Servicios[1].FechaServ).toBe("2026-09-28");
    expect(c.Servicios[0].TipoDeServ).toBe("06");
  });

  it("🚨 el IVA entregado al creador es lo trasladado menos lo retenido", () => {
    // Con la retención del 50% al creador mexicano, es la otra mitad — el dinero que sí llegó a
    // su wallet por encima del precio. Equivocarlo descuadra su acreditamiento.
    const c = armarComplemento([venta()], { iva: 148, isr: 46.25 });

    expect(c.TotalIvaTrasladado).toBe(296);
    expect(c.TotalIvaRetenido).toBe(148);
    expect(c.DifIvaEntregadoPrestServ).toBe(148);
  });

  it("exportación a 0%: sin IVA trasladado, no hay nada que entregar", () => {
    const c = armarComplemento([venta({ ivaTrasladado: 0 })], { iva: 0, isr: 46.25 });
    expect(c.TotalIvaTrasladado).toBe(0);
    expect(c.DifIvaEntregadoPrestServ).toBe(0);
  });

  it("la comisión de la plataforma se suma aparte, con su impuesto por servicio", () => {
    const c = armarComplemento([venta(), venta()], { iva: 296, isr: 92.5 });
    expect(c.MonTotalporUsoPlataforma).toBe(925);
    expect(c.Servicios[0].ComisionDelServicio.MontoComision).toBe(462.5);
    expect(c.Servicios[0].ComisionDelServicio.ImpuestoIvaComision).toBe(74);
  });
});

describe("detalle sacado de los asientos", () => {
  const asiento = (over: Record<string, unknown> = {}) =>
    ({
      status: "earned",
      grossAmount: 100,
      occurredAt: { toDate: () => new Date("2026-09-15T18:00:00.000Z") },
      fiscalMxn: { total: 2146, base: 1850, iva: 296, tipoCambio: 18.5, fuente: "cobro" },
      retenciones: { comision: 25, ivaComision: 4 },
      ...over,
    }) as Parameters<typeof serviciosDelPeriodo>[0][number];

  /** FIX de mentira, para no depender de que Banxico esté en pie durante un test. */
  const fixFalso = async () => 20;

  it("con pesos congelados usa el tipo de cambio de ESA venta", async () => {
    const [s] = await serviciosDelPeriodo([asiento()], fixFalso);
    expect(s.precioSinIva).toBe(1850);
    expect(s.comision).toBe(462.5); // 25 USD × 18.5, la tasa real de su cobro
    expect(s.ivaComision).toBe(74);
  });

  it("🚨 una venta de EXPORTACIÓN se convierte con el FIX, no se salta", async () => {
    /*
     * Antes se saltaba, y por eso la constancia quedaba con la base corta: el ISR se retiene
     * sobre TODAS las ventas, también las exportadas. Fue lo que bloqueó este documento hasta
     * que apareció la fuente oficial de tipo de cambio.
     */
    const [s] = await serviciosDelPeriodo([asiento({ fiscalMxn: undefined })], fixFalso);
    expect(s.precioSinIva).toBe(2000); // 100 USD × 20 del FIX
    expect(s.ivaTrasladado).toBe(0); // exportación a 0%: no hubo IVA que trasladar
    expect(s.comision).toBe(500); // 25 × 20
  });

  it("🚨 salta las ventas sin fecha: `FechaServ` es obligatorio", async () => {
    const r = await serviciosDelPeriodo(
      [asiento({ occurredAt: null, createdAt: null })],
      fixFalso
    );
    expect(r).toHaveLength(0);
  });

  it("solo cuenta lo ganado, no lo pendiente de resolver", async () => {
    expect(await serviciosDelPeriodo([asiento({ status: "pending" })], fixFalso)).toHaveLength(0);
  });

  it("🚨 mezcla nacional y exportación en el mismo periodo, cada una con su tasa", async () => {
    const r = await serviciosDelPeriodo(
      [asiento(), asiento({ fiscalMxn: undefined })],
      fixFalso
    );
    expect(r).toHaveLength(2);
    expect(r[0].precioSinIva).toBe(1850); // cobro real
    expect(r[1].precioSinIva).toBe(2000); // FIX
  });
});
