import { describe, it, expect } from "vitest";
import {
  toStripeAmount,
  meetsStripeMinimum,
  NICE_STEP as BACKEND_NICE_STEP,
} from "../../backend/src/tax/presentment";
import { NICE_STEP as FRONTEND_NICE_STEP } from "@/lib/currency/format";
import { DISPLAY_CURRENCIES } from "@/lib/currency/catalog";

// La moneda de PRESENTACIÓN es en la que se le cobra de verdad al comprador. Dos cosas se
// rompen en silencio aquí: que el paso de redondeo del backend y el del frontend se separen
// (el comprador ve un precio y se le cobra otro), y que el monto no cumpla el formato exacto
// que exige Stripe para ciertas monedas (el cargo se rechaza sin más explicación).

describe("NICE_STEP — paridad entre el backend y el frontend", () => {
  // 🚨 Es un duplicado a mano: backend/src/tax/presentment.ts no puede importar de lib/.
  // Si alguien agrega una moneda de un solo lado, el precio mostrado deja de coincidir con
  // el cobrado. Exactamente el bug que la conversión a moneda local vino a cerrar.
  it("🚨 toda moneda del catálogo tiene el MISMO paso en los dos lados", () => {
    for (const c of DISPLAY_CURRENCIES) {
      expect(BACKEND_NICE_STEP[c], `${c} falta o difiere en el backend`).toBe(
        FRONTEND_NICE_STEP[c]
      );
    }
  });

  it("el backend no tiene monedas de más que el catálogo no conozca", () => {
    const catalogo = new Set<string>(DISPLAY_CURRENCIES);
    for (const c of Object.keys(BACKEND_NICE_STEP)) {
      expect(catalogo.has(c), `${c} está en el backend pero no en DISPLAY_CURRENCIES`).toBe(true);
    }
  });

  it("ningún paso es cero ni negativo (dejaría el monto sin redondear)", () => {
    for (const c of DISPLAY_CURRENCIES) {
      expect(FRONTEND_NICE_STEP[c], c).toBeGreaterThan(0);
    }
  });
});

describe("toStripeAmount — formato exacto que exige Stripe", () => {
  it("monedas normales de dos decimales van en centavos", () => {
    expect(toStripeAmount(10.99, "USD")).toBe(1099);
    expect(toStripeAmount(250, "MXN")).toBe(25000);
    expect(toStripeAmount(19.5, "EUR")).toBe(1950);
    expect(toStripeAmount(120, "NOK")).toBe(12000);
    expect(toStripeAmount(35.5, "BAM")).toBe(3550);
  });

  it("monedas sin decimales van en unidades enteras, sin multiplicar", () => {
    expect(toStripeAmount(5000, "CLP")).toBe(5000);
    expect(toStripeAmount(75000, "PYG")).toBe(75000);
  });

  // 🚨 La corona islandesa es el caso raro: Stripe la trata como moneda SIN decimales, pero
  // por compatibilidad histórica hay que mandarla en centavos con los decimales SIEMPRE en
  // `00`. Una fracción (p.ej. 125037) hace que Stripe RECHACE el cargo.
  it("🚨 ISK: siempre entero de coronas, nunca una fracción", () => {
    expect(toStripeAmount(5, "ISK")).toBe(500);
    expect(toStripeAmount(1250, "ISK")).toBe(125000);
    // Aunque llegue un monto fraccionario, el resultado tiene que terminar en 00.
    expect(toStripeAmount(1250.37, "ISK")).toBe(125000);
    expect(toStripeAmount(1250.62, "ISK")).toBe(125100);
    for (const raw of [1, 3.4, 99.9, 1250.37, 48210.5]) {
      expect(toStripeAmount(raw, "ISK") % 100, `${raw} ISK`).toBe(0);
    }
  });

  it("normaliza el código de moneda a mayúsculas", () => {
    expect(toStripeAmount(1250.37, "isk")).toBe(125000);
    expect(toStripeAmount(5000, "clp")).toBe(5000);
  });
});

describe("meetsStripeMinimum", () => {
  it("respeta el mínimo publicado por moneda", () => {
    expect(meetsStripeMinimum(10, "MXN")).toBe(true);
    expect(meetsStripeMinimum(9.99, "MXN")).toBe(false);
    expect(meetsStripeMinimum(3, "NOK")).toBe(true);
    expect(meetsStripeMinimum(2.99, "NOK")).toBe(false);
    expect(meetsStripeMinimum(175, "HUF")).toBe(true);
    expect(meetsStripeMinimum(174, "HUF")).toBe(false);
  });

  // ISK y BAM no aparecen en la lista publicada de mínimos. Sin dato, se deja pasar y decide
  // Stripe: inventar un mínimo sería peor que no tenerlo, porque rechazaría cobros válidos.
  it("una moneda sin mínimo publicado no bloquea el cobro", () => {
    expect(meetsStripeMinimum(0.01, "ISK")).toBe(true);
    expect(meetsStripeMinimum(0.01, "BAM")).toBe(true);
  });
});
