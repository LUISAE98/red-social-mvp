// La cadencia de la factura global: MENSUAL desde el 2026-09-05.
//
// 🚨 POR QUÉ VOLVIÓ A MENSUAL. La regla 2.7.1.21 permite diario, semanal, quincenal, mensual o
//    bimestral, y exige timbrar dentro de las 24 horas siguientes al cierre **del periodo
//    elegido**. El incumplimiento que se arregló en §A1 no era la periodicidad, era que el
//    proceso corría el día 5 del mes siguiente. Se pasó a diaria creyendo que el plazo obligaba,
//    y no era así: eran 365 comprobantes al año por creador, y metía cada venta en un CFDI
//    timbrado en menos de 24 h — lo que convertía cada factura pedida por un comprador en una
//    cancelación con reexpedición.
//
// ⚠️ Los comprobantes de la cadencia diaria SIGUEN EXISTIENDO, con periodo `YYYY-MM-DD`. Todo lo
//    que reciba un periodo tiene que seguir entendiéndolos, o se vuelven inalcanzables.

import { describe, it, expect } from "vitest";
import { mesAnterior, diaAnterior, periodoValido } from "../src/facturacion/runGlobalInvoice";
import { rangoDelPeriodo, finDelPeriodo } from "../src/facturacion/creatorMonthlyDocs";

describe("qué mes factura el cron", () => {
  it("el día 1 factura el mes que acaba de cerrar", () => {
    expect(mesAnterior(new Date("2026-09-01T07:00:00Z"))).toBe("2026-08");
  });

  it("🚨 en enero retrocede de AÑO, no solo de mes", () => {
    // El fallo clásico: `mes - 1` en enero da cero, y el periodo sale `2027-00`.
    expect(mesAnterior(new Date("2027-01-01T07:00:00Z"))).toBe("2026-12");
  });

  it("🚨 se calcula en hora de MÉXICO, no UTC", () => {
    /*
     * A las 05:00 UTC del 1 de septiembre en México siguen siendo las 23:00 del 31 de agosto.
     * Calculándolo en UTC, el proceso facturaría julio en vez de agosto.
     */
    expect(mesAnterior(new Date("2026-09-01T05:00:00Z"))).toBe("2026-07");
    expect(mesAnterior(new Date("2026-09-01T07:00:00Z"))).toBe("2026-08");
  });
});

describe("qué periodos se aceptan", () => {
  it("el mes, que es la cadencia de ahora", () => {
    expect(periodoValido("2026-08")).toBe(true);
  });

  it("🚨 y el día, porque los comprobantes viejos siguen existiendo", () => {
    // Si dejaran de aceptarse, la global `2026-08-31` que ya está timbrada se volvería
    // imposible de reprocesar o de liberar.
    expect(periodoValido("2026-08-31")).toBe(true);
  });

  it("rechaza lo que no es ninguno de los dos", () => {
    expect(periodoValido("2026")).toBe(false);
    expect(periodoValido("agosto")).toBe(false);
    expect(periodoValido("")).toBe(false);
  });

  it("🚨 rechaza el texto literal que la comprobación rota daba por bueno", () => {
    /*
     * La validación anterior era `/^d{4}-d{2}-d{2}$/`, sin barras invertidas: no casaba con
     * ninguna fecha real y sí con esto. `liberarVentasAtascadas` rechazaba todo lo que se le
     * pasaba.
     */
    expect(periodoValido("dddd-dd-dd")).toBe(false);
  });
});

describe("el rango sigue entendiendo los dos formatos", () => {
  it("un mes cubre del día 1 al 1 del siguiente", () => {
    const { desde, hasta } = rangoDelPeriodo("2026-08");
    // Hora de México, UTC-6: el mes arranca a las 06:00 UTC del día 1.
    expect(desde.toISOString()).toBe("2026-08-01T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-09-01T06:00:00.000Z");
  });

  it("un día sigue cubriendo solo ese día", () => {
    const { desde, hasta } = rangoDelPeriodo("2026-08-31");
    expect(desde.toISOString()).toBe("2026-08-31T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-09-01T06:00:00.000Z");
  });

  it("el fin de periodo de un mes es su último día", () => {
    // De ahí sale el tipo de cambio que le toca al comprobante.
    expect(finDelPeriodo("2026-08")).toBe("2026-08-31");
    expect(finDelPeriodo("2026-02")).toBe("2026-02-28");
  });
});

describe("el día anterior sigue existiendo", () => {
  it("porque lo usan los comprobantes antiguos", () => {
    expect(diaAnterior(new Date("2026-09-01T12:00:00Z"))).toBe("2026-08-31");
  });
});
