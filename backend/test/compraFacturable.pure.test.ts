// Qué compra se puede facturar y cuál no.
//
// Es la guarda que impide emitir un CFDI que después haya que cancelar. Y cancelar no es gratis:
// una factura nominativa de más de 1 000 pesos **exige que el comprador acepte** la cancelación,
// así que un CFDI emitido de más puede quedarse vivo si el comprador no colabora.

import { describe, it, expect } from "vitest";
import { compraLibre, compraReclamablePorNominativa } from "../src/facturacion/globalInvoice";

const compra = (over: Record<string, unknown> = {}) => ({
  status: "paid",
  ...over,
});

describe("qué entra en la factura global", () => {
  it("una compra pagada y sin marcas, sí", () => {
    expect(compraLibre(compra())).toBe(true);
  });

  it("la que ya tiene su factura, no", () => {
    expect(compraLibre(compra({ invoiced: true }))).toBe(false);
  });

  it("la que está apartada por otra global, no", () => {
    expect(compraLibre(compra({ globalInvoice: { estado: "emitiendo" } }))).toBe(false);
  });

  it("🚨 la DEVUELTA, nunca más", () => {
    /*
     * Se sacó de una global porque se le devolvió el dinero al comprador. Sin esta comprobación,
     * el proceso del mes siguiente la vería sin marca de global y la facturaría otra vez — una
     * venta que ya no existe.
     */
    expect(compraLibre(compra({ devuelta: { sacadaDe: "abc" } }))).toBe(false);
  });

  it("🚨 la que está POR ENTREGARSE, tampoco", () => {
    /*
     * Una sesión pagada y no celebrada puede cancelarse. Meterla en la global obligaría a
     * cancelar un CFDI del creador para sacarla, que es justo lo que se quiere evitar.
     */
    expect(compraLibre(compra({ pendienteEntrega: true }))).toBe(false);
  });

  it("🚨 una compra ANTERIOR al cambio se sigue considerando entregada", () => {
    /*
     * Las compras de antes del 2026-09-05 no traen el campo. Tratarlas como pendientes las
     * dejaría fuera de toda factura para siempre, que es peor que el problema que se arregla.
     */
    expect(compraLibre(compra({ pendienteEntrega: undefined }))).toBe(true);
  });

  it("un servicio instantáneo llega con la marca en false y entra igual", () => {
    // Los que se cobran y entregan a la vez nunca pasan por `pending` en el ledger.
    expect(compraLibre(compra({ pendienteEntrega: false }))).toBe(true);
  });
});

describe("qué puede reclamar el comprador para su factura", () => {
  it("lo libre, claro", () => {
    expect(compraReclamablePorNominativa(compra())).toBe(true);
  });

  it("🚨 lo LIBERADO de una global, que es la excepción que justifica esta función", () => {
    /*
     * Se canceló la global con motivo 04 precisamente para que este comprador pudiera facturar.
     * Rechazarlo aquí haría inútil todo el trámite.
     */
    expect(
      compraReclamablePorNominativa(compra({ nominativaEnCurso: { estado: "liberada" } }))
    ).toBe(true);
  });

  it("🚨 pero NO lo que está por entregarse, ni siquiera liberado", () => {
    expect(
      compraReclamablePorNominativa(
        compra({ nominativaEnCurso: { estado: "liberada" }, pendienteEntrega: true })
      )
    ).toBe(false);
  });

  it("ni lo devuelto", () => {
    expect(compraReclamablePorNominativa(compra({ devuelta: { sacadaDe: "abc" } }))).toBe(false);
  });
});
