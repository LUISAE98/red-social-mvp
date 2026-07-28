import { describe, it, expect } from "vitest";
import { MP_SANDBOX } from "../src/payments/mpClient";

// Canario de corte a producción. Hoy MP_SANDBOX está hardcodeado en `true`
// (cobros de prueba). Este test NO falla en desarrollo/CI, pero si alguna vez se
// construye con NODE_ENV=production teniendo el sandbox activo, revienta en rojo
// para evitar desplegar a producción cobrando en el entorno de pruebas de MP.
describe("guard: corte a producción de Mercado Pago", () => {
  it("en producción, MP_SANDBOX debe estar en false", () => {
    if (process.env.NODE_ENV === "production") {
      expect(MP_SANDBOX).toBe(false);
    } else {
      // Fuera de producción solo dejamos constancia del valor actual.
      expect(typeof MP_SANDBOX).toBe("boolean");
    }
  });
});
