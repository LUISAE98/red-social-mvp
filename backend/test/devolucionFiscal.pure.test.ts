// Qué pasa con una venta DEVUELTA cuando se vuelve a facturar.
//
// 🔴 EL FALLO QUE ESTO PROTEGE (auditoría del 2026-09-06). Una devolución marcaba
//    `refundDestination` y nada más. `compraLibre` mira `devuelta`, un campo distinto, así que la
//    venta seguía contando como libre y **la global del mes siguiente la volvía a facturar** —
//    una venta que ya no existe, con el sello del creador encima.

import { describe, it, expect } from "vitest";
import { compraLibre, compraReclamablePorNominativa } from "../src/facturacion/globalInvoice";

const compra = (over: Record<string, unknown> = {}) => ({ status: "paid", ...over });

describe("una venta devuelta no se vuelve a facturar", () => {
  it("🚨 con la marca `devuelta`, NUNCA entra en otra global", () => {
    expect(compraLibre(compra({ devuelta: { origen: "devolucion_a_credito" } }))).toBe(false);
  });

  it("🚨 ni la puede reclamar el comprador para su factura", () => {
    expect(
      compraReclamablePorNominativa(compra({ devuelta: { origen: "devolucion_a_tarjeta" } }))
    ).toBe(false);
  });

  it("da igual el camino por el que se devolvió", () => {
    // A crédito y a tarjeta escriben la misma marca. Si divergieran, uno de los dos volvería a
    // facturarse y el otro no, sin ninguna razón visible.
    for (const origen of ["devolucion_a_credito", "devolucion_a_tarjeta"]) {
      expect(compraLibre(compra({ devuelta: { origen } }))).toBe(false);
    }
  });

  it("🚨 `refundDestination` por sí solo NO basta, y ése era el fallo", () => {
    /*
     * Es la prueba que documenta el error: marcar el destino del reembolso no dice nada a la
     * capa fiscal. Si alguien quitara la marca `devuelta` creyendo que con ésta sobra, esta
     * prueba se pone en verde y avisa de que la venta vuelve a ser facturable.
     */
    expect(compraLibre(compra({ refundDestination: "credit", refundedAmount: 100 }))).toBe(true);
  });

  it("una compra normal sigue siendo facturable", () => {
    expect(compraLibre(compra())).toBe(true);
  });
});
