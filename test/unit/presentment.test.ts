import { describe, it, expect } from "vitest";
// Módulo PURO del backend (sin firebase-admin ni firebase-functions): se puede
// importar desde el frontend sin arrastrar dependencias que este no instala —
// eso es justo lo que rompía el CI y el build de Vercel.
import {
  toStripeAmount,
  meetsStripeMinimum,
  NICE_STEP as BACKEND_NICE_STEP,
  roundCharm,
} from "../../backend/src/tax/presentmentFormat";
import { NICE_STEP as FRONTEND_NICE_STEP, roundCharm as frontendRoundCharm } from "@/lib/currency/format";
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
    // 🚨 El franco CFP también: sin esto se le cobraría 100x de más a Nueva Caledonia.
    expect(toStripeAmount(1200, "XPF")).toBe(1200);
    expect(toStripeAmount(1200, "XPF")).not.toBe(120000);
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

  // 🚨 Los dinares del Golfo van en MILÉSIMAS, no en centésimas. Con la fórmula genérica
  // (amount * 100) se le cobraría al comprador la DÉCIMA PARTE: un error de 10x a favor
  // del comprador que no salta a la vista salvo cuadrando la liquidación.
  it("🚨 KWD y JOD: milésimas, no centésimas (error de 10x si se olvida)", () => {
    expect(toStripeAmount(1.5, "KWD")).toBe(1500);
    expect(toStripeAmount(0.5, "BHD")).toBe(500);
    expect(toStripeAmount(1, "TND")).toBe(1000);
    expect(toStripeAmount(2.3, "JOD")).toBe(2300);
    // Lo que habría hecho la fórmula genérica, para dejar clara la diferencia.
    expect(toStripeAmount(1.5, "KWD")).not.toBe(150);
  });

  // Stripe exige que el último dígito del importe en milésimas sea 0.
  it("🚨 tres decimales: el último dígito siempre es 0", () => {
    for (const raw of [1.5, 2.348, 0.077, 15.778, 99.999]) {
      for (const code of ["KWD", "JOD", "BHD", "OMR", "TND"]) {
        expect(toStripeAmount(raw, code) % 10, raw + " " + code).toBe(0);
      }
    }
    // 15.778 KWD → 15.780 KWD = 15780 milésimas (se redondea a la decena de fils).
    expect(toStripeAmount(15.778, "KWD")).toBe(15780);
  });

  it("normaliza el código de moneda a mayúsculas", () => {
    expect(toStripeAmount(1250.37, "isk")).toBe(125000);
    expect(toStripeAmount(5000, "clp")).toBe(5000);
    expect(toStripeAmount(1.5, "kwd")).toBe(1500);
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

// Redondeo COMERCIAL del total. Es lo último que se aplica antes de cobrar, así que un
// error aquí llega íntegro a la tarjeta del comprador. Lo que se protege: que NUNCA
// redondee hacia abajo (dejaría el cobro por debajo del costo) y que no suba más de una
// unidad (un salto grande es un sobrecargo silencioso, no un precio bonito).
describe("roundCharm — precio con terminación comercial", () => {
  it("deja el total en .99 o .00, el que quede más cerca por arriba", () => {
    expect(roundCharm(108.65, "MXN")).toBe(108.99);
    expect(roundCharm(108.995, "MXN")).toBe(109); // el .99 ya quedó abajo → sube al entero
    expect(roundCharm(109, "MXN")).toBe(109); // ya es .00, no lo mueve
    expect(roundCharm(109.5, "MXN")).toBe(109.99);
    expect(roundCharm(12.246, "USD")).toBe(12.99);
  });

  it("🚨 NUNCA redondea hacia abajo", () => {
    for (const c of ["USD", "MXN", "EUR", "BRL", "JPY", "CLP", "COP"]) {
      // Incluye MÚLTIPLOS EXACTOS del paso de la moneda (50, 100, 1000): ahí estaba el
      // bug — restar 1 para dejar la terminación en 9 caía por debajo del monto.
      for (const base of [0.5, 1.01, 9.99, 12.246, 50, 100, 108.65, 1000, 1234.56, 98765]) {
        expect(roundCharm(base, c), `${base} ${c}`).toBeGreaterThanOrEqual(base);
      }
    }
  });

  it("🚨 no sube más de una unidad de la moneda", () => {
    for (const base of [0.5, 1.01, 9.99, 12.246, 108.65, 1234.56]) {
      expect(roundCharm(base, "USD") - base, `${base}`).toBeLessThan(1);
    }
  });

  it("en monedas sin decimales conserva la terminación en 9 (no inventa centavos)", () => {
    const jpy = roundCharm(10865, "JPY");
    expect(Number.isInteger(jpy)).toBe(true);
    expect(jpy).toBeGreaterThanOrEqual(10865);
    expect(String(jpy).endsWith("9")).toBe(true);
  });

  // Stripe exige último dígito 0 en las de tres decimales, así que ahí la terminación
  // comercial es imposible y el resultado tiene que seguir pasando `toStripeAmount`.
  it("las monedas de tres decimales siguen cumpliendo el formato de Stripe", () => {
    for (const c of ["KWD", "JOD", "BHD", "OMR", "TND"]) {
      const v = roundCharm(15.778, c);
      expect(v).toBeGreaterThanOrEqual(15.778);
      expect(toStripeAmount(v, c) % 10, `${c}`).toBe(0);
    }
  });

  it("el resultado siempre supera el mínimo de Stripe si el original lo superaba", () => {
    for (const c of ["USD", "MXN", "EUR", "JPY"]) {
      const v = roundCharm(50, c);
      expect(meetsStripeMinimum(v, c), c).toBe(true);
    }
  });
});

// 🚨 `roundCharm` está DUPLICADO a mano (el backend no puede importar de lib/). Es el
// último paso antes de cobrar, así que si los dos se separan el comprador ve un precio y
// se le cobra otro — exactamente el bug que este redondeo vino a cerrar.
describe("roundCharm — paridad entre el backend y el frontend", () => {
  it("🚨 dan el MISMO resultado en todas las monedas del catálogo", () => {
    const montos = [0.5, 1.01, 9.99, 12.246, 50, 99.99, 100, 108.65, 1000, 1234.56, 98765];
    for (const c of DISPLAY_CURRENCIES) {
      for (const m of montos) {
        expect(frontendRoundCharm(m, c), `${m} ${c}`).toBe(roundCharm(m, c));
      }
    }
  });
});
