// El tipo de cambio del retiro, que sale del pago y no de la cotización.
//
// Importa porque es la cifra con la que el creador mexicano va a timbrar su CFDI, y porque
// tiene una trampa que no se ve: **las monedas sin decimales**. Stripe manda los importes en
// la unidad mínima, y en yenes o pesos chilenos esa unidad ES la moneda. Dividir entre 100
// como en todas las demás da un tipo de cambio cien veces menor.
//
// El caso de México sale de un pago REAL contra el sandbox, el 2026-09-01:
// 300.00 USD → 5,101.17 MXN.

import { describe, it, expect } from "vitest";

import { liquidacionDelPago } from "../src/payments/stripe/outboundPayment";

describe("liquidacionDelPago", () => {
  it("reproduce el pago real a México, 300 USD a 5,101.17 MXN", () => {
    const l = liquidacionDelPago(
      {
        from: { debited: { value: 30000, currency: "usd" } },
        to: { credited: { value: 510117, currency: "mxn" } },
        expected_arrival_date: "2026-09-02T23:59:59.999Z",
      },
      30000,
      "usd",
      null
    );

    expect(l.debitado).toBe(300);
    expect(l.acreditado).toBe(5101.17);
    expect(l.monedaDestino).toBe("MXN");
    expect(l.tipoCambio).toBeCloseTo(17.0039, 4);
    expect(l.llegadaEstimada).toBe("2026-09-02T23:59:59.999Z");
  });

  it("🚨 no divide entre 100 las monedas SIN decimales", () => {
    // 300 USD a ~150 yenes por dólar son 45 000 yenes, y Stripe los manda como `45000`
    // porque el yen no tiene subunidad. Tratarlo como centavos daría un cambio de 1.5.
    const l = liquidacionDelPago(
      {
        from: { debited: { value: 30000, currency: "usd" } },
        to: { credited: { value: 45000, currency: "jpy" } },
      },
      30000,
      "usd",
      null
    );

    expect(l.acreditado).toBe(45000);
    expect(l.tipoCambio).toBe(150);
  });

  it("trata en milésimas las monedas del golfo, de tres decimales", () => {
    // 300 USD a ~0.376 dinares kuwaitíes son 112.8 KWD, que van como `112800`.
    const l = liquidacionDelPago(
      {
        from: { debited: { value: 30000, currency: "usd" } },
        to: { credited: { value: 112800, currency: "kwd" } },
      },
      30000,
      "usd",
      null
    );

    expect(l.acreditado).toBe(112.8);
    expect(l.tipoCambio).toBeCloseTo(0.376, 3);
  });

  it("sin conversión no informa tipo de cambio", () => {
    // Al creador estadounidense se le paga en dólares: no hay cambio que enseñarle, y un
    // «1.0» en pantalla se leería como si algo se hubiera convertido.
    const l = liquidacionDelPago(
      {
        from: { debited: { value: 30000, currency: "usd" } },
        to: { credited: { value: 30000, currency: "usd" } },
      },
      30000,
      "usd",
      null
    );

    expect(l.tipoCambio).toBeNull();
    expect(l.acreditado).toBe(300);
  });

  it("aguanta que el pago no traiga lo acreditado", () => {
    // Si Stripe no devuelve `to.credited`, se cae al importe enviado en vez de romper el
    // retiro: el dinero ya salió y el creador no puede quedarse sin registro por un campo.
    const l = liquidacionDelPago({ status: "processing" }, 30000, "usd", null);

    expect(l.debitado).toBe(300);
    expect(l.acreditado).toBe(300);
    expect(l.tipoCambio).toBeNull();
    expect(l.llegadaEstimada).toBeNull();
  });
});
