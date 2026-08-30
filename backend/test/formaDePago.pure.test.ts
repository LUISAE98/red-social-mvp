// La forma de pago que va en cada CFDI.
//
// Antes iba fija en `04` —tarjeta de crédito— aunque el comprador hubiera pagado con débito o
// en un OXXO. No invalida el CFDI, pero es una discrepancia entre lo que dice la factura y lo
// que pasó, de las que salen en una revisión.

import { describe, it, expect } from "vitest";
import { formaDePagoSat, FORMA_PAGO } from "../src/facturacion/formaDePago";

describe("forma de pago del SAT", () => {
  it("distingue crédito de débito, que era el error", () => {
    expect(formaDePagoSat({ type: "card", funding: "credit" })).toBe(FORMA_PAGO.TARJETA_CREDITO);
    expect(formaDePagoSat({ type: "card", funding: "debit" })).toBe(FORMA_PAGO.TARJETA_DEBITO);
  });

  it("una prepago es monedero electrónico, ni crédito ni débito", () => {
    expect(formaDePagoSat({ type: "card", funding: "prepaid" })).toBe(FORMA_PAGO.MONEDERO);
  });

  it("OXXO es efectivo", () => {
    // El comprador entrega billetes en la caja, aunque el cobro llegue por Stripe.
    expect(formaDePagoSat({ type: "oxxo" })).toBe(FORMA_PAGO.EFECTIVO);
  });

  it("SPEI y transferencias son transferencia", () => {
    for (const t of ["customer_balance", "spei", "bank_transfer"]) {
      expect(formaDePagoSat({ type: t })).toBe(FORMA_PAGO.TRANSFERENCIA);
    }
  });

  it("Apple Pay y Google Pay son TARJETAS, no un método aparte", () => {
    // Stripe los reporta con `type: "card"` y el funding real debajo. Tratarlos como método
    // propio habría mandado todos a «por definir».
    expect(formaDePagoSat({ type: "card", funding: "credit" })).toBe(FORMA_PAGO.TARJETA_CREDITO);
    expect(formaDePagoSat({ type: "link", funding: "debit" })).toBe(FORMA_PAGO.TARJETA_DEBITO);
  });
});

describe("cuando no se sabe", () => {
  it("una tarjeta sin funding va a «por definir», NO a crédito", () => {
    // 🚨 Es la regla que importa: decir que no consta es cierto, decir «tarjeta de crédito»
    // sin saberlo es afirmar algo falso en un documento fiscal.
    expect(formaDePagoSat({ type: "card" })).toBe(FORMA_PAGO.POR_DEFINIR);
    expect(formaDePagoSat({ type: "card", funding: "unknown" })).toBe(FORMA_PAGO.POR_DEFINIR);
  });

  it("sin datos, sin nulos y con basura, tampoco inventa", () => {
    expect(formaDePagoSat(null)).toBe(FORMA_PAGO.POR_DEFINIR);
    expect(formaDePagoSat(undefined)).toBe(FORMA_PAGO.POR_DEFINIR);
    expect(formaDePagoSat({})).toBe(FORMA_PAGO.POR_DEFINIR);
    expect(formaDePagoSat({ type: "metodo_que_no_existe" })).toBe(FORMA_PAGO.POR_DEFINIR);
  });

  it("no le importan las mayúsculas", () => {
    expect(formaDePagoSat({ type: "CARD", funding: "CREDIT" })).toBe(FORMA_PAGO.TARJETA_CREDITO);
  });
});
