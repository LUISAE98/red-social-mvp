// Hasta cuándo se puede cancelar un CFDI.
//
// 🚨 Es una guarda con fecha, así que TODAS las pruebas inyectan el reloj. Una prueba de plazos
//    que dependa del día en que se corre pasa en marzo, falla en abril, y nadie entiende por qué.

import { describe, it, expect } from "vitest";
import {
  limiteDeCancelacion,
  dentroDePlazo,
  mensajeFueraDePlazo,
} from "../src/facturacion/plazoCancelacion";

const emitido = (iso: string) => new Date(iso);

describe("el límite", () => {
  it("persona moral, el 31 de marzo del año siguiente", () => {
    const l = limiteDeCancelacion(emitido("2026-08-31T00:00:00Z"), "moral");
    expect(l.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("persona física, el 30 de abril del año siguiente", () => {
    const l = limiteDeCancelacion(emitido("2026-08-31T00:00:00Z"), "fisica");
    expect(l.toISOString().slice(0, 10)).toBe("2027-04-30");
  });

  it("🚨 el último día cuenta ENTERO", () => {
    // Si el límite fuera el comienzo del día, el 31 de marzo a las 10 de la mañana ya estaría
    // fuera de plazo — y sí se puede cancelar.
    const l = limiteDeCancelacion(emitido("2026-08-31T00:00:00Z"), "moral");
    expect(l.toISOString()).toBe("2027-03-31T23:59:59.999Z");
  });

  it("un comprobante de enero tiene el mismo límite que uno de diciembre", () => {
    // El plazo cuelga del EJERCICIO, no de la fecha exacta. Uno de enero tiene quince meses;
    // uno de diciembre, tres.
    const enero = limiteDeCancelacion(emitido("2026-01-05T00:00:00Z"), "moral");
    const diciembre = limiteDeCancelacion(emitido("2026-12-28T00:00:00Z"), "moral");
    expect(enero.toISOString()).toBe(diciembre.toISOString());
  });
});

describe("si todavía se puede cancelar", () => {
  const agosto = emitido("2026-08-31T00:00:00Z");

  it("el mismo mes, claro que sí", () => {
    expect(dentroDePlazo(agosto, "moral", emitido("2026-09-05T12:00:00Z"))).toBe(true);
  });

  it("el 31 de marzo siguiente, todavía sí", () => {
    expect(dentroDePlazo(agosto, "moral", emitido("2027-03-31T18:00:00Z"))).toBe(true);
  });

  it("🚨 el 1 de abril siguiente, ya no", () => {
    expect(dentroDePlazo(agosto, "moral", emitido("2027-04-01T00:00:01Z"))).toBe(false);
  });

  it("la persona física tiene un mes más", () => {
    expect(dentroDePlazo(agosto, "fisica", emitido("2027-04-15T00:00:00Z"))).toBe(true);
    expect(dentroDePlazo(agosto, "moral", emitido("2027-04-15T00:00:00Z"))).toBe(false);
  });
});

describe("el mensaje de fuera de plazo", () => {
  it("🚨 dice la fecha concreta Y la salida", () => {
    // «No se puede» a secas deja a administración sin saber qué hacer con una devolución que
    // sigue siendo real.
    const m = mensajeFueraDePlazo(emitido("2026-08-31T00:00:00Z"), "moral");
    expect(m).toContain("2027-03-31");
    expect(m).toContain("nota de crédito");
  });
});
