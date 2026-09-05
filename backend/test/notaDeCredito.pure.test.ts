// El tope acumulado de las notas de crédito.
//
// 🚨 ES LA REGLA QUE PROTEGE EL DINERO. Sin ella, tres devoluciones parciales del 40% acreditarían
//    el 120% de una venta: cada nota se validaría contra el total original sin saber de las
//    anteriores, y el creador acabaría con más egresos que ingresos. El SAT cruza eso.

import { describe, it, expect } from "vitest";
import { restantePorAcreditar, cabeLaNota } from "../src/facturacion/notaDeCredito";

describe("cuánto queda por acreditar", () => {
  it("sin notas previas, queda todo", () => {
    expect(restantePorAcreditar(1000, 0)).toBe(1000);
  });

  it("descuenta lo ya acreditado", () => {
    expect(restantePorAcreditar(1000, 400)).toBe(600);
  });

  it("🚨 nunca devuelve negativo", () => {
    // Si por lo que sea se acreditó de más, el restante es cero, no una cifra negativa que
    // permitiría emitir otra nota «para compensar».
    expect(restantePorAcreditar(1000, 1200)).toBe(0);
  });

  it("redondea CADA lado a centavos antes de restar, como el CFDI", () => {
    // Redondear solo el resultado dejaría un restante con fracciones de centavo que ningún
    // CFDI puede expresar. Aquí 1000.004 baja a 1000.00 y 0.006 sube a 0.01.
    expect(restantePorAcreditar(1000.004, 0.006)).toBe(999.99);
    expect(restantePorAcreditar(1000.005, 0)).toBe(1000.01);
  });
});

describe("si cabe una nota más", () => {
  it("cabe lo que queda exacto", () => {
    expect(cabeLaNota(600, 600)).toBe(true);
  });

  it("🚨 NO cabe más de lo que queda", () => {
    expect(cabeLaNota(601, 600)).toBe(false);
  });

  it("🚨 tres parciales del 40% fallan en la tercera", () => {
    // El caso que motiva toda la regla.
    let acreditado = 0;
    const base = 1000;

    expect(cabeLaNota(400, restantePorAcreditar(base, acreditado))).toBe(true);
    acreditado += 400;

    expect(cabeLaNota(400, restantePorAcreditar(base, acreditado))).toBe(true);
    acreditado += 400;

    // Aquí solo quedan 200: la tercera de 400 tiene que rebotar.
    expect(cabeLaNota(400, restantePorAcreditar(base, acreditado))).toBe(false);
    expect(cabeLaNota(200, restantePorAcreditar(base, acreditado))).toBe(true);
  });

  it("tolera medio centavo, para que el redondeo no bloquee la última devolución", () => {
    // Sin la tolerancia, devolver el resto exacto de una venta con decimales feos fallaría por
    // una diferencia que no le importa a nadie.
    expect(cabeLaNota(600.004, 600)).toBe(true);
    expect(cabeLaNota(600.02, 600)).toBe(false);
  });

  it("un importe de cero o negativo no cabe nunca", () => {
    expect(cabeLaNota(0, 600)).toBe(false);
    expect(cabeLaNota(-100, 600)).toBe(false);
  });
});
