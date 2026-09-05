// El comprobante de retiro: la constancia de que el dinero salió.
//
// Lo que se protege aquí es que el documento diga la VERDAD de lo que pasó. Un comprobante que
// inventa un tipo de cambio, o que enseña como descuento algo que el creador nunca pagó, es peor
// que no tener comprobante: el creador lo lleva a su contador y le cuadra mal.

import { describe, it, expect } from "vitest";
import { armarComprobanteRetiro } from "../src/wallet/comprobanteRetiro";

/** Un retiro pagado por Stripe, con conversión a pesos. */
const retiro = (over: Record<string, unknown> = {}) => ({
  creatorId: "creador1",
  currency: "USD",
  saldo: 300,
  neto: 300,
  acreditado: 5460,
  acreditadoCurrency: "MXN",
  tipoCambio: 18.2,
  route: "stripe",
  payoutCountry: "MX",
  declaredAccountLast4: "4321",
  declaredHolderName: "Nombre Apellido",
  outboundPaymentId: "obp_123",
  stripeFeeTotal: 5.25,
  ...over,
});

describe("comprobante de retiro", () => {
  it("recoge lo que salió, lo que llegó y a qué cambio", () => {
    const c = armarComprobanteRetiro({ withdrawalId: "w1", retiro: retiro() });

    expect(c.neto).toBe(300);
    expect(c.acreditado).toBe(5460);
    expect(c.monedaAcreditada).toBe("MXN");
    expect(c.tipoCambio).toBe(18.2);
  });

  it("🚨 NO enseña la comisión que Stripe le cobra a Vibra", () => {
    /*
     * El retiro persiste `stripeFeeTotal` y es tentador ponerlo «por transparencia». Sería
     * engañoso: esa comisión la absorbe Vibra y no sale del dinero del creador. Enseñarla en su
     * comprobante le haría pensar que se le descontó algo que nunca se le descontó.
     */
    const c = armarComprobanteRetiro({ withdrawalId: "w1", retiro: retiro() });
    expect(JSON.stringify(c)).not.toContain("5.25");
    expect(Object.keys(c)).not.toContain("stripeFeeTotal");
  });

  it("🚨 sin conversión, el tipo de cambio es null y NO 1.0", () => {
    // Inventar un 1.0 haría creer que hubo un cambio de moneda que no ocurrió.
    const c = armarComprobanteRetiro({
      withdrawalId: "w1",
      retiro: retiro({ tipoCambio: null, acreditadoCurrency: "USD", acreditado: 300 }),
    });

    expect(c.tipoCambio).toBeNull();
    expect(c.monedaAcreditada).toBe("USD");
    expect(c.acreditado).toBe(300);
  });

  it("un retiro que aún no se concilió deja lo acreditado en null", () => {
    // Wallbit se cierra a mano y no trae esas cifras. Mejor vacío que inventado.
    const c = armarComprobanteRetiro({
      withdrawalId: "w1",
      retiro: retiro({ acreditado: undefined, acreditadoCurrency: undefined, tipoCambio: undefined }),
    });

    expect(c.acreditado).toBeNull();
    expect(c.monedaAcreditada).toBeNull();
    expect(c.tipoCambio).toBeNull();
  });

  it("la referencia que se pasa a mano gana sobre la del documento", () => {
    // Es el caso de Wallbit: quien cierra el retiro escribe el identificador de la transferencia.
    const c = armarComprobanteRetiro({
      withdrawalId: "w1",
      retiro: retiro(),
      referencia: "TRANSFER-999",
    });
    expect(c.referencia).toBe("TRANSFER-999");
  });

  it("sin referencia a mano, usa la del pago de Stripe", () => {
    const c = armarComprobanteRetiro({ withdrawalId: "w1", retiro: retiro() });
    expect(c.referencia).toBe("obp_123");
  });

  it("congela la cuenta y el titular declarados en la solicitud", () => {
    // Un comprobante de hace dos años tiene que explicarse solo, aunque el creador haya
    // cambiado de banco tres veces desde entonces.
    const c = armarComprobanteRetiro({ withdrawalId: "w1", retiro: retiro() });
    expect(c.cuentaLast4).toBe("4321");
    expect(c.titular).toBe("Nombre Apellido");
    expect(c.payoutCountry).toBe("MX");
  });
});
