// Motor fiscal — los ocho casos de la matriz, más las variantes que mueven el resultado.
//
// El ejemplo es siempre el mismo, y es el que está en `docs/legal/fiscal-iva-isr-plataforma.md`
// §0.1: base 100, comisión 25. Si un número de aquí deja de cuadrar con el documento, uno de
// los dos está mal — y el documento es el que fue al contador.

import { describe, it, expect } from "vitest";
import {
  resolveSaleTax as saleBack,
  resolveSettlement as settleBack,
  requiereCfdiRetenciones,
  TASAS_POR_EJERCICIO,
  EJERCICIO_VIGENTE,
  ejercicioDeFecha,
  MOTOR_VERSION,
  calcularRetiro,
  type PerfilFiscalCreador,
} from "../../backend/src/tax/fiscalEngine";
import {
  resolveSaleTax as saleFront,
  resolveSettlement as settleFront,
  TASAS_POR_EJERCICIO as TASAS_FRONT,
  calcularRetiro as calcularRetiroFront,
} from "../../lib/tax/fiscalEngine";

const BASE = 100;

const mxConRfc: PerfilFiscalCreador = { residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" };
const mxSinRfc: PerfilFiscalCreador = { residency: "MX", hasTaxId: false, payoutAccountCountry: "MX" };
const extranjero: PerfilFiscalCreador = { residency: "FOREIGN", hasTaxId: true };

/** Atajo: venta + liquidación en un paso. */
function corrida(buyerCountry: string, creador: PerfilFiscalCreador) {
  const venta = saleBack({ base: BASE, buyerCountry, serviceType: "greeting" });
  const liq = settleBack({ base: BASE, mxVatAmount: venta.mxVatAmount, creador });
  return { venta, liq };
}

describe("motor fiscal / impuesto de la venta", () => {
  it("comprador mexicano paga 16 sobre la base", () => {
    const v = saleBack({ base: BASE, buyerCountry: "MX", serviceType: "greeting" });
    expect(v.tratamiento).toBe("domestic_16");
    expect(v.mxVatAmount).toBe(16);
  });

  it("comprador extranjero no lleva IVA mexicano, sea cual sea el servicio", () => {
    const servicios = [
      "greeting", "advice", "exclusive_session", "live_session", "profile_donation",
      "live_donation", "live_ticket", "supercomment", "vod_ticket", "subscription", "premium_post",
    ] as const;
    for (const s of servicios) {
      const v = saleBack({ base: BASE, buyerCountry: "ES", serviceType: s });
      expect(v.tratamiento, s).toBe("export_zero");
      expect(v.mxVatAmount, s).toBe(0);
      expect(v.mxVatAbsorbido, s).toBe(0);
    }
  });

  it("el país del creador no cambia el impuesto de la venta", () => {
    const a = saleBack({ base: BASE, buyerCountry: "MX", serviceType: "greeting" });
    const b = saleBack({ base: BASE, buyerCountry: "MX", serviceType: "vod_ticket" });
    expect(a.mxVatAmount).toBe(b.mxVatAmount);
  });
});

describe("motor fiscal / los cuatro escenarios", () => {
  it("1 · creador mexicano + comprador mexicano deposita 76.50", () => {
    const { venta, liq } = corrida("MX", mxConRfc);
    expect(venta.mxVatAmount).toBe(16);
    expect(liq.comision).toBe(25);
    expect(liq.ivaComision).toBe(4);
    expect(liq.ivaRetenido).toBe(8);
    expect(liq.isrRetenido).toBe(2.5);
    expect(liq.neto).toBe(76.5);
  });

  it("2 · creador mexicano + comprador extranjero deposita 68.50", () => {
    const { venta, liq } = corrida("ES", mxConRfc);
    expect(venta.mxVatAmount).toBe(0);
    expect(liq.ivaComision).toBe(4);
    // La retención de IVA se anula sola: es una proporción de un IVA que vale cero.
    expect(liq.ivaRetenido).toBe(0);
    expect(liq.isrRetenido).toBe(2.5);
    expect(liq.neto).toBe(68.5);
  });

  it("3 · creador extranjero + comprador mexicano deposita 75", () => {
    const { venta, liq } = corrida("MX", extranjero);
    expect(venta.mxVatAmount).toBe(16);
    expect(liq.ivaRetenido).toBe(16); // 100%
    expect(liq.isrRetenido).toBe(0);
    expect(liq.ivaComision).toBe(0); // exportación de mediación
    expect(liq.neto).toBe(75);
  });

  it("4 · creador extranjero + comprador extranjero deposita 75", () => {
    const { venta, liq } = corrida("ES", extranjero);
    expect(venta.mxVatAmount).toBe(0);
    expect(liq.ivaRetenido).toBe(0);
    expect(liq.isrRetenido).toBe(0);
    expect(liq.neto).toBe(75);
  });
});

describe("motor fiscal / variantes que mueven el resultado", () => {
  it("el RFC ya NO cambia ninguna tasa, se liquida igual con él y sin él", () => {
    // 🚫 Hubo un motor "sin RFC" con ISR al 20% y IVA al 100%. Se eliminó el 2026-08-30:
    //    la retención ocurre al PAGAR y en Vibra no se puede cobrar sin RFC, así que esa
    //    tasa nunca llegaba a aplicarse — solo aparecía en pantalla asustando al creador.
    //    Si alguien la reintroduce, este test se lo dice.
    const conRfc = corrida("MX", mxConRfc).liq;
    const sinRfc = corrida("MX", mxSinRfc).liq;
    expect(sinRfc.isrRetenido).toBe(conRfc.isrRetenido);
    expect(sinRfc.ivaRetenido).toBe(conRfc.ivaRetenido);
    expect(sinRfc.neto).toBe(conRfc.neto);
  });

  it("cobrar en cuenta fuera de México sube la retención de IVA al 100%", () => {
    const fuera: PerfilFiscalCreador = { ...mxConRfc, payoutAccountCountry: "US" };
    const { liq } = corrida("MX", fuera);
    expect(liq.ivaRetenido).toBe(16);
    expect(liq.isrRetenido).toBe(2.5); // el ISR NO cambia por dónde cobra
    expect(liq.neto).toBe(68.5);
  });

  it("el pago tratado como regalía le cuesta 25 puntos al extranjero", () => {
    const regalia: PerfilFiscalCreador = { ...extranjero, esRegalia: true };
    const { liq } = corrida("MX", regalia);
    expect(liq.isrRetenido).toBe(25);
    expect(liq.neto).toBe(50);
  });

  it("con constancia de residencia el tratado baja la regalía a 10", () => {
    const conTratado: PerfilFiscalCreador = { ...extranjero, esRegalia: true, tasaTratado: 0.1 };
    const { liq } = corrida("MX", conTratado);
    expect(liq.isrRetenido).toBe(10);
    expect(liq.neto).toBe(65);
  });
});

describe("motor fiscal / reglas estructurales", () => {
  it("el ISR se calcula sobre la base, no sobre el total ni sobre la participación", () => {
    const { liq } = corrida("MX", mxConRfc);
    // 2.5% de 116 serían 2.90; de 75, 1.88. Es 2.50 porque va sobre los 100.
    expect(liq.isrRetenido).toBe(2.5);
    expect(liq.isrRetenido).not.toBe(2.9);
    expect(liq.isrRetenido).not.toBe(1.88);
  });

  it("el ISR no depende del comprador", () => {
    expect(corrida("MX", mxConRfc).liq.isrRetenido).toBe(corrida("ES", mxConRfc).liq.isrRetenido);
  });

  it("el impuesto de la comisión va por encima del 25%, no dentro", () => {
    const { liq } = corrida("MX", mxConRfc);
    expect(liq.comision).toBe(25);
    expect(liq.ivaComision).toBe(4);
    // Si fuera dentro, la comisión efectiva caería a 21.55.
    expect(liq.comision + liq.ivaComision).toBe(29);
  });

  it("la participación del creador es siempre 75 antes de retenciones", () => {
    for (const [pais, perfil] of [["MX", mxConRfc], ["ES", mxConRfc], ["MX", extranjero], ["ES", extranjero]] as const) {
      expect(corrida(pais, perfil).liq.participacion, `${pais}`).toBe(75);
    }
  });

  it("hay constancia de retenciones salvo en extranjero-extranjero", () => {
    expect(requiereCfdiRetenciones(corrida("MX", mxConRfc).liq)).toBe(true);
    expect(requiereCfdiRetenciones(corrida("ES", mxConRfc).liq)).toBe(true);
    expect(requiereCfdiRetenciones(corrida("MX", extranjero).liq)).toBe(true);
    expect(requiereCfdiRetenciones(corrida("ES", extranjero).liq)).toBe(false);
  });

  it("cada liquidación estampa el ejercicio que usó", () => {
    expect(corrida("MX", mxConRfc).liq.ejercicio).toBe(EJERCICIO_VIGENTE);
  });

  it("se puede recalcular una venta vieja con las tasas de su año", () => {
    const liq = settleBack({ base: BASE, mxVatAmount: 16, creador: mxConRfc, ejercicio: 2026 });
    expect(liq.isrRate).toBe(TASAS_POR_EJERCICIO[2026].isrMx);
  });

  it("un ejercicio sin tasas falla en vez de inventarlas", () => {
    expect(() => settleBack({ base: BASE, mxVatAmount: 16, creador: mxConRfc, ejercicio: 2099 })).toThrow();
  });
});


describe("motor fiscal / ejercicio y versión", () => {
  it("el ejercicio sale de la fecha de la operación, no del reloj", () => {
    expect(ejercicioDeFecha("2026-12-31T23:00:00Z")).toBe(2026);
    expect(ejercicioDeFecha("2027-01-01T00:30:00Z")).toBe(2027);
  });

  it("una venta de fin de año pertenece al ejercicio de la venta, no al de su liquidación", () => {
    // Se vende el 31 de diciembre y se liquida el 2 de enero: manda diciembre.
    expect(ejercicioDeFecha(new Date("2026-12-31T18:00:00Z"))).toBe(2026);
  });

  it("cada liquidación estampa la versión de la fórmula, aparte del ejercicio", () => {
    const liq = settleBack({ base: BASE, mxVatAmount: 16, creador: mxConRfc });
    expect(liq.motorVersion).toBe(MOTOR_VERSION);
    expect(liq.ejercicio).toBe(EJERCICIO_VIGENTE);
  });

  it("el tratamiento del cobro manda sobre el que calcularía el motor", () => {
    // Si el cobro resolvió `export_taxable`, el motor no debe sobreescribirlo con su default.
    const v = saleBack({ base: BASE, buyerCountry: "ES", serviceType: "vod_ticket", tratamiento: "export_taxable" });
    expect(v.tratamiento).toBe("export_taxable");
  });
});

describe("motor fiscal / paridad entre backend y espejo", () => {
  it("las tasas son idénticas", () => {
    expect(TASAS_FRONT).toEqual(TASAS_POR_EJERCICIO);
  });

  it("los ocho casos dan el mismo resultado al centavo", () => {
    for (const pais of ["MX", "ES"]) {
      for (const perfil of [mxConRfc, mxSinRfc, extranjero, { ...extranjero, esRegalia: true }]) {
        const vb = saleBack({ base: BASE, buyerCountry: pais, serviceType: "greeting" });
        const vf = saleFront({ base: BASE, buyerCountry: pais, serviceType: "greeting" });
        expect(vf, `venta ${pais}`).toEqual(vb);

        const lb = settleBack({ base: BASE, mxVatAmount: vb.mxVatAmount, creador: perfil });
        const lf = settleFront({ base: BASE, mxVatAmount: vf.mxVatAmount, creador: perfil });
        expect(lf, `liquidación ${pais}`).toEqual(lb);
      }
    }
  });
});

/** Mismo redondeo que el motor, para comparar totales sin arrastrar flotantes. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

describe("motor fiscal / desglose del retiro", () => {
  /**
   * Un mes típico: TRES ventas de 100 a compradores mexicanos, creador mexicano.
   *
   * Por venta: participación 75, IVA cobrado 16, ISR 2.50, IVA retenido 8, IVA comisión 4.
   * Por tres: saldo 225, IVA cobrado 48, ISR 7.50, IVA retenido 24, IVA comisión 12.
   */
  const acumulado = {
    saldo: 225,
    ivaCobradoPendiente: 48,
    isrPendiente: 7.5,
    ivaPendiente: 24,
    ivaComisionPendiente: 12,
  };

  it("retirar todo suma el IVA cobrado y aplica todas las retenciones", () => {
    const r = calcularRetiro(acumulado);
    expect(r.bruto).toBe(225);
    expect(r.ivaCobrado).toBe(48);
    expect(r.isr).toBe(7.5);
    expect(r.iva).toBe(24);
    expect(r.ivaComision).toBe(12);
    expect(r.neto).toBe(229.5); // 225 + 48 − 7.5 − 24 − 12
    expect(r.ivaPorDeclarar).toBe(24); // los 48 cobrados menos los 24 retenidos
    expect(r.proporcion).toBe(1);
  });

  it("🚨 el retiro CUADRA con la liquidación de las ventas que lo formaron", () => {
    // La invariante que faltaba y que costó 15.25 USD por cada 71.49 de saldo: el retiro
    // restaba el IVA retenido de un saldo que nunca contuvo el IVA cobrado. Aquí se compara
    // el desglose del pago contra lo que el motor dijo, venta por venta, que se depositaría.
    const porVenta = settleBack({
      base: 100,
      mxVatAmount: 16,
      creador: mxConRfc,
    });
    const r = calcularRetiro(acumulado);
    expect(r.neto).toBe(round2(porVenta.neto * 3));
  });

  it("un retiro parcial consume el IVA y las retenciones EN PROPORCIÓN", () => {
    // Un tercio del saldo se lleva un tercio de todo.
    const r = calcularRetiro({ ...acumulado, solicitado: 75 });
    expect(r.bruto).toBe(75);
    expect(r.ivaCobrado).toBe(16);
    expect(r.isr).toBe(2.5);
    expect(r.iva).toBe(8);
    expect(r.ivaComision).toBe(4);
    expect(r.neto).toBe(76.5);
  });

  it("sacar poco de un saldo grande NO paga el impuesto de todo el saldo", () => {
    // El error que evita la proporcionalidad: 10 de 1,000 no debe cargar con todo.
    const r = calcularRetiro({
      saldo: 1000,
      solicitado: 10,
      ivaCobradoPendiente: 0,
      isrPendiente: 100,
      ivaPendiente: 200,
      ivaComisionPendiente: 50,
    });
    expect(r.isr).toBe(1);
    expect(r.iva).toBe(2);
    expect(r.neto).toBe(6.5);
  });

  it("no se puede retirar más que el saldo", () => {
    const r = calcularRetiro({ ...acumulado, solicitado: 9999 });
    expect(r.bruto).toBe(225);
    expect(r.proporcion).toBe(1);
  });

  it("el neto nunca es negativo", () => {
    // Caso extremo: retenciones mayores que el retiro. Se deposita cero, no en rojo.
    const r = calcularRetiro({
      saldo: 10,
      ivaCobradoPendiente: 0,
      isrPendiente: 20,
      ivaPendiente: 20,
      ivaComisionPendiente: 0,
    });
    expect(r.neto).toBe(0);
  });

  it("sin saldo no hay retiro", () => {
    const r = calcularRetiro({
      saldo: 0,
      ivaCobradoPendiente: 0,
      isrPendiente: 0,
      ivaPendiente: 0,
      ivaComisionPendiente: 0,
    });
    expect(r.bruto).toBe(0);
    expect(r.neto).toBe(0);
  });

  it("creador extranjero con comprador MEXICANO recibe su 75% ÍNTEGRO", () => {
    // 🚨 El caso más feo del bug: a un creador alemán se le restaba una retención mexicana
    //    de 16 sobre un IVA que jamás fue suyo, y acababa cobrando 59 en vez de 75.
    //    El IVA entra y sale por el mismo importe —se le retiene el 100%— y no le toca nada.
    const r = calcularRetiro({
      saldo: 75,
      ivaCobradoPendiente: 16,
      isrPendiente: 0,
      ivaPendiente: 16,
      ivaComisionPendiente: 0,
    });
    expect(r.neto).toBe(75);
    expect(r.ivaPorDeclarar).toBe(0);
  });

  it("creador extranjero sin retenciones recibe íntegro", () => {
    const r = calcularRetiro({
      saldo: 300,
      ivaCobradoPendiente: 0,
      isrPendiente: 0,
      ivaPendiente: 0,
      ivaComisionPendiente: 0,
    });
    expect(r.neto).toBe(300);
  });

  it("backend y espejo dan el mismo desglose", () => {
    expect(calcularRetiroFront(acumulado)).toEqual(calcularRetiro(acumulado));
  });
});

describe("motor fiscal / MEZCLAS de ventas en un mismo saldo", () => {
  /**
   * Un creador real no tiene una venta: tiene un saldo hecho de muchas, de compradores de
   * países distintos y algunas devueltas. El retiro no las recorre —lee contadores agregados
   * del resumen—, así que sumar y luego repartir TIENE que dar lo mismo que repartir venta
   * por venta. Si no, el creador cobra mal y nadie lo nota.
   *
   * Azar determinista: misma semilla, misma corrida. Un fallo tiene que poder repetirse.
   */
  function rng(semilla: number) {
    let a = semilla;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PAISES = ["MX", "DE", "US", "MX", "BR", "MX"]; // MX pesa más: es el caso con IVA

  /** Genera una mezcla y devuelve los contadores del resumen y lo que debería pagarse. */
  function mezcla(r: () => number, perfil: PerfilFiscalCreador) {
    const c = { saldo: 0, mxVat: 0, isr: 0, iva: 0, ivaComision: 0 };
    let esperado = 0;
    const cuantas = 1 + Math.floor(r() * 12);
    for (let k = 0; k < cuantas; k++) {
      const base = round2(3 + r() * 500);
      const pais = PAISES[Math.floor(r() * PAISES.length)];
      const venta = saleBack({ base, buyerCountry: pais });
      const liq = settleBack({ base, mxVatAmount: venta.mxVatAmount, creador: perfil });
      const devuelta = r() < 0.15;

      // Suma como el ledger al ganar…
      c.saldo = round2(c.saldo + liq.participacion);
      c.mxVat = round2(c.mxVat + venta.mxVatAmount);
      c.isr = round2(c.isr + liq.isrRetenido);
      c.iva = round2(c.iva + liq.ivaRetenido);
      c.ivaComision = round2(c.ivaComision + liq.ivaComision);

      // …y resta como el ledger al devolver, nunca por debajo de cero.
      if (devuelta) {
        c.saldo = round2(c.saldo - liq.participacion);
        c.mxVat = round2(Math.max(0, c.mxVat - venta.mxVatAmount));
        c.isr = round2(Math.max(0, c.isr - liq.isrRetenido));
        c.iva = round2(Math.max(0, c.iva - liq.ivaRetenido));
        c.ivaComision = round2(Math.max(0, c.ivaComision - liq.ivaComision));
      } else {
        esperado = round2(esperado + liq.neto);
      }
    }
    return { c, esperado, ventas: cuantas };
  }

  const PERFILES: Array<[string, (r: () => number) => PerfilFiscalCreador]> = [
    [
      "mexicano cobrando en México",
      () => ({ residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" }),
    ],
    [
      "mexicano que CAMBIA de cuenta a mitad (unas ventas al 50% de IVA, otras al 100%)",
      (r) => ({
        residency: "MX",
        hasTaxId: true,
        payoutAccountCountry: r() < 0.5 ? "MX" : "US",
      }),
    ],
    [
      "extranjero",
      () => ({ residency: "FOREIGN", hasTaxId: true, payoutAccountCountry: "DE" }),
    ],
  ];

  for (const [nombre, perfilDe] of PERFILES) {
    it(`el retiro agregado CUADRA con las ventas una por una · ${nombre}`, () => {
      const r = rng(nombre.length * 7 + 1);
      for (let i = 0; i < 200; i++) {
        const { c, esperado, ventas } = mezcla(r, perfilDe(r));
        const pagado = calcularRetiro({
          saldo: c.saldo,
          ivaCobradoPendiente: c.mxVat,
          isrPendiente: c.isr,
          ivaPendiente: c.iva,
          ivaComisionPendiente: c.ivaComision,
        }).neto;
        // Un centavo por venta: cada asiento redondea el suyo y el agregado redondea otra vez.
        expect(Math.abs(pagado - esperado), `mezcla ${i} de ${ventas} ventas`).toBeLessThanOrEqual(
          Math.max(0.02, ventas * 0.01)
        );
      }
    });
  }

  it("una venta devuelta no deja residuo en ningún contador", () => {
    const r = rng(99);
    for (let i = 0; i < 200; i++) {
      const { c, esperado } = mezcla(r, {
        residency: "MX",
        hasTaxId: true,
        payoutAccountCountry: "MX",
      });
      if (esperado !== 0) continue; // solo interesan las mezclas devueltas por completo
      expect(c).toEqual({ saldo: 0, mxVat: 0, isr: 0, iva: 0, ivaComision: 0 });
    }
  });

  it("🚨 partir el retiro NUNCA saca de más (a partir de 1 USD por trozo)", () => {
    // El redondeo de cada trozo podría, en teoría, dejar la retención en cero y regalarle
    // el impuesto al creador. Solo pasa con trozos de céntimos, y el mínimo de retiro lo
    // hace inalcanzable — pero si alguien baja ese mínimo, este test se lo dice.
    const c = { saldo: 100000, mxVat: 0, isr: 2500, iva: 0, ivaComision: 4000 };
    const retiro = (solicitado?: number) =>
      calcularRetiro({
        saldo: c.saldo,
        solicitado,
        ivaCobradoPendiente: c.mxVat,
        isrPendiente: c.isr,
        ivaPendiente: c.iva,
        ivaComisionPendiente: c.ivaComision,
      });
    const entero = retiro().neto;
    for (const cacho of [50000, 5000, 500, 100, 10, 1]) {
      const trozos = Math.floor(c.saldo / cacho);
      let suma = 0;
      for (let i = 0; i < trozos; i++) suma += retiro(cacho).neto;
      expect(round2(suma), `trozos de ${cacho}`).toBeLessThanOrEqual(entero + 0.05);
    }
  });
});
