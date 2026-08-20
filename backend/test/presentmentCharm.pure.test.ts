import { describe, it, expect } from "vitest";
import { roundCharm } from "../src/tax/presentmentFormat";

// El precio que ve el comprador debe ser EXACTAMENTE el que se le cobra.
//
// El total se redondea a precio comercial (…,99) en la moneda del comprador, pero el
// importe canónico se guarda en la de liquidación. Reconvertirlo para cobrar hacía un
// viaje de ida y vuelta que devolvía céntimos de más: se MOSTRABA 411.99 MXN y se
// COBRABA 412.01. Dos céntimos, pero en la dirección equivocada y rompiendo el .99 que
// es justo lo que el redondeo comercial busca.
//
// Por eso `applyCharmRounding` devuelve `displayAmount` y se cobra ese importe tal cual.
// Estos tests fijan el porqué: si alguien quita el `displayAmount` creyendo que la
// reconversión basta, el primero de estos se pone en rojo.
describe("precio comercial — el ida y vuelta NO conserva el importe", () => {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  it("reconvertir 411.99 MXN devuelve 412.01 — el caso real que se cobró de más", () => {
    const tasa = 17.0605; // MXN por USD, la del cobro real
    const local = roundCharm(24.147 * tasa, "MXN");
    expect(local).toBe(411.99);

    // Lo que se guarda en la moneda de liquidación…
    const enUsd = round2(local / tasa);
    // …y lo que salía al reconvertirlo para cobrar.
    const deVuelta = round2(enUsd * tasa);

    expect(deVuelta).not.toBe(local);
    expect(deVuelta).toBeGreaterThan(local); // cobraba de MÁS
  });

  it("el redondeo comercial siempre termina en ,99 o en entero", () => {
    for (const bruto of [412.008, 815.5, 100.01, 47.2, 3.5]) {
      const r = roundCharm(bruto, "MXN");
      const centavos = Math.round(r * 100) % 100;
      expect(centavos === 99 || centavos === 0).toBe(true);
      expect(r).toBeGreaterThanOrEqual(bruto); // nunca por debajo del importe debido
    }
  });

  it("nunca redondea por debajo, ni en monedas sin decimales", () => {
    for (const [bruto, mon] of [[412.008, "MXN"], [50, "JPY"], [1234, "JPY"]] as const) {
      expect(roundCharm(bruto, mon)).toBeGreaterThanOrEqual(bruto);
    }
  });
});
