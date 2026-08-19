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
import { NICE_STEP as FRONTEND_NICE_STEP, roundCharm as frontendRoundCharm, roundReference } from "@/lib/currency/format";
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

// Redondeo de REFERENCIA: el "≈ 1,700 MXN" que ve el creador junto a su precio en dólares.
// No es un precio, es una estimación. Lo que se protege es que NO se mueva con cualquier
// movimiento del tipo de cambio — que es justo lo que un escalón fino (o terminación .99)
// haría, y por lo que se descartó usar el redondeo comercial aquí.
describe("roundReference — la referencia del creador no debe bailar", () => {
  it("🚨 un movimiento pequeño del tipo de cambio NO cambia el número mostrado", () => {
    // El caso que motivó la regla: 90.99 con el dólar subiendo el equivalente a 0.33.
    expect(roundReference(90.99, "MXN")).toBe(roundReference(91.32, "MXN"));
  });

  it("el escalón crece con el monto, para dejar ~3 cifras significativas", () => {
    expect(roundReference(51.08, "MXN")).toBe(51); // < 100 → paso 1
    expect(roundReference(850.4, "MXN")).toBe(850); // < 1.000 → paso 10
    expect(roundReference(1703.4, "MXN")).toBe(1700); // < 10.000 → paso 50
    expect(roundReference(17034, "MXN")).toBe(17000); // ≥ 10.000 → paso 500
  });

  it("las monedas sin decimales nunca muestran medios", () => {
    for (const c of ["JPY", "CLP", "KRW", "VND", "XOF"] as const) {
      const v = roundReference(8.4, c);
      expect(Number.isInteger(v), `${c} → ${v}`).toBe(true);
    }
  });

  // COP NO va en esa lista: para Stripe tiene centavos. MXN tiene paso 5 en NICE_STEP pero SÍ admite decimales: detectar "sin decimales" a
  // partir del paso daba falsos positivos y le quitaba los medios a monedas que sí los tienen.
  it("MXN admite medios por debajo de 10 (su paso grande no la hace entera)", () => {
    expect(roundReference(5.4, "MXN")).toBe(5.5);
  });

  it("nunca devuelve cero ni negativos para entradas válidas", () => {
    for (const c of ["USD", "MXN", "EUR", "JPY"] as const) {
      expect(roundReference(0.4, c)).toBeGreaterThan(0);
    }
  });
});

// 🚨 El set de monedas SIN DECIMALES está duplicado a mano (el backend no importa de lib/).
// Ya se habían separado una vez: el frontend tenía 7 monedas de más. No se notó porque
// ninguna estaba en el catálogo — o sea, el test de paridad de `roundCharm` no las veía,
// porque solo recorre lo vendible. Este test compara los SETS, no sus resultados, así que
// caza la divergencia ANTES de que una de esas monedas entre al catálogo.
describe("monedas sin decimales — paridad de los SETS, no solo de los resultados", () => {
  it("🚨 el backend y el frontend clasifican igual TODA moneda de tres letras", () => {
    // Se recorre un universo mayor que el catálogo a propósito: el riesgo es justo la
    // moneda que todavía NO se vende y que alguien agrega mañana.
    const universo = [
      ...DISPLAY_CURRENCIES,
      "BIF", "DJF", "GNF", "KMF", "MGA", "RWF", "UGX", "ISK", "HUF", "TWD", "COP",
    ];
    for (const c of universo) {
      // `roundCharm` toma caminos distintos según la clasificación: si los sets difieren,
      // para algún importe los dos lados dan números distintos.
      for (const m of [8.4, 50, 1234.56]) {
        expect(frontendRoundCharm(m, c), `${c} @ ${m}`).toBe(roundCharm(m, c));
      }
    }
  });
});
