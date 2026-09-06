// El recibo del comprador extranjero (§B8).
//
// Es el único papel que se lleva: el CFDI es un documento mexicano y a él no le aplica. Si este
// recibo miente, no tiene nada con qué contrastarlo.

import { describe, it, expect } from "vitest";
import { armarRecibo, leTocaRecibo } from "../src/facturacion/reciboComprador";

const compra = (over: Record<string, unknown> = {}) => ({
  buyerId: "comprador1",
  creatorId: "creador1",
  type: "greeting",
  status: "paid",
  taxCountry: "DE",
  grossAmount: 100,
  taxAmount: 19,
  currency: "USD",
  ...over,
});

const cobro = (over: Record<string, unknown> = {}) => ({
  presentmentAmount: 118.4,
  presentmentCurrency: "EUR",
  chargedAmount: 121.41,
  ...over,
});

describe("a quién le toca recibo", () => {
  it("al comprador de fuera con la compra pagada", () => {
    expect(leTocaRecibo(compra())).toBe(true);
  });

  it("🚨 al MEXICANO no, y es deliberado", () => {
    /*
     * Su venta la ampara un CFDI —la global del creador, o su propia factura si la pide—. Darle
     * además un papel que se le parece pero no vale fiscalmente lo invita a presentarlo en su
     * declaración. Un documento que confunde es peor que ninguno.
     */
    expect(leTocaRecibo(compra({ taxCountry: "MX" }))).toBe(false);
    expect(leTocaRecibo(compra({ taxCountry: "mx" }))).toBe(false);
  });

  it("🚨 sin país resuelto, tampoco", () => {
    // Suponerlo llenaría de recibos a compradores mexicanos que ya tienen su CFDI.
    expect(leTocaRecibo(compra({ taxCountry: null }))).toBe(false);
    expect(leTocaRecibo(compra({ taxCountry: "" }))).toBe(false);
  });

  it("ni a lo devuelto o rechazado", () => {
    expect(leTocaRecibo(compra({ status: "refunded" }))).toBe(false);
    expect(leTocaRecibo(compra({ status: "rejected" }))).toBe(false);
  });
});

describe("qué dice el recibo", () => {
  it("🚨 lo que VIO y pagó, en SU moneda", () => {
    // Es la única cifra que puede cotejar contra su banco. El importe en dólares de la
    // liquidación no le dice nada: él nunca vio esa cifra.
    const r = armarRecibo({ purchaseId: "p1", compra: compra(), cobro: cobro() });
    expect(r.pagado).toBe(118.4);
    expect(r.monedaPagada).toBe("EUR");
  });

  it("🚨 el precio va ÍNTEGRO y el desglose SUMA", () => {
    /*
     * El cargo fijo y el 2% de conversión van dentro del precio, como la pantalla y la memoria
     * van dentro del precio de un teléfono. Antes se ponía el precio del creador —100— y el
     * recibo decía 100 + 19 = 121.41, con 2.41 aparecidos de la nada. Un recibo cuyo desglose
     * no suma no lo firma nadie.
     */
    const r = armarRecibo({ purchaseId: "p1", compra: compra(), cobro: cobro() });

    expect(r.total).toBe(121.41);
    expect(r.impuesto).toBe(19);
    expect(r.base).toBe(102.41);
    expect(r.base + r.impuesto).toBeCloseTo(r.total, 2);
    expect(r.buyerCountry).toBe("DE");
  });

  it("sin cobro guardado, pierde la moneda local pero NO el recibo", () => {
    const r = armarRecibo({ purchaseId: "p1", compra: compra(), cobro: null });
    expect(r.pagado).toBeNull();
    expect(r.monedaPagada).toBeNull();
    // Sin cobro guardado se reconstruye con lo que hay, y sigue sumando.
    expect(r.total).toBe(119);
    expect(r.base + r.impuesto).toBeCloseTo(r.total, 2);
  });

  it("🚨 si el cobro no trae moneda local, no se inventa una", () => {
    const r = armarRecibo({
      purchaseId: "p1",
      compra: compra(),
      cobro: cobro({ presentmentAmount: 0, presentmentCurrency: null }),
    });
    expect(r.pagado).toBeNull();
    expect(r.monedaPagada).toBeNull();
  });

  it("el país se normaliza a mayúsculas", () => {
    const r = armarRecibo({ purchaseId: "p1", compra: compra({ taxCountry: "de" }), cobro: cobro() });
    expect(r.buyerCountry).toBe("DE");
  });
});
