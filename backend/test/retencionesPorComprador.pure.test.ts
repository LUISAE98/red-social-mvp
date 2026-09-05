// Lo que se le retiene a un creador MEXICANO según a quién le vendió.
//
// Es la pregunta que el creador va a hacer al ver su desglose: «¿por qué me retuvieron esto?».
// La respuesta depende de dos cosas distintas que conviene no mezclar:
//
//   · El **ISR** depende SOLO de él —de si dio su RFC—. Es el mismo venda a quien venda.
//   · El **IVA** depende del COMPRADOR: solo hay IVA mexicano que retener si la venta lo llevó,
//     y una venta a un extranjero va a 0% por exportación.
//
// Por eso el desglose de un retiro no es un porcentaje sobre el total: es la suma de ventas con
// tratamientos distintos.

import { describe, it, expect } from "vitest";
import {
  resolveSaleTax,
  resolveSettlement,
  calcularRetiro,
  type PerfilFiscalCreador,
} from "../src/tax/fiscalEngine";

/** Creador mexicano con RFC y cuenta en México: el caso normal. */
const MEXICANO: PerfilFiscalCreador = {
  residency: "MX",
  hasTaxId: true,
  payoutAccountCountry: "MX",
};

/** Una venta de 100, con el comprador en el país que se le pase. */
function venta(paisComprador: string, creador = MEXICANO) {
  const fiscal = resolveSaleTax({
    base: 100,
    buyerCountry: paisComprador,
    serviceType: "greeting",
  });
  return resolveSettlement({
    base: 100,
    mxVatAmount: fiscal.mxVatAmount,
    creador,
    ejercicio: 2026,
    commissionRate: 0.25,
  });
}

describe("creador mexicano — qué cambia según el comprador", () => {
  it("vendiendo a un MEXICANO se le retiene IVA, porque la venta lo llevó", () => {
    const r = venta("MX");
    // 16 de IVA sobre 100, y se retiene la mitad por tener RFC.
    expect(r.ivaRetenido).toBe(8);
    expect(r.ivaRate).toBe(0.5);
  });

  it("vendiendo a un EXTRANJERO no se le retiene IVA, porque no hubo", () => {
    // La venta va a 0% por exportación, así que no hay IVA mexicano del que retener una parte.
    // ⚠️ Esto NO es una excepción codificada: la retención es una proporción del IVA cobrado,
    // así que al ser cero se anula sola.
    for (const pais of ["DE", "US", "BR", "JP"]) {
      expect(venta(pais).ivaRetenido).toBe(0);
    }
  });

  it("el ISR es el MISMO venda a quien venda", () => {
    // No depende del comprador: 2.5% sobre la base en los dos casos.
    expect(venta("MX").isrRetenido).toBe(2.5);
    expect(venta("DE").isrRetenido).toBe(2.5);
  });

  it("el RFC ya NO cambia ninguna tasa", () => {
    // 🚫 Hubo un motor "sin RFC" con ISR al 20% y IVA al 100%. Se eliminó el 2026-08-30:
    //    la retención ocurre al PAGAR y sin RFC no se puede cobrar, así que esa tasa nunca
    //    llegaba a aplicarse — solo asustaba en pantalla. Este test impide que vuelva.
    const sinRfc = { ...MEXICANO, hasTaxId: false };
    const conRfc = venta("MX");
    const r = venta("MX", sinRfc);
    expect(r.isrRetenido).toBe(conRfc.isrRetenido);
    expect(r.ivaRetenido).toBe(conRfc.ivaRetenido);
    expect(r.neto).toBe(conRfc.neto);
  });

  it("cobrando FUERA de México se le retiene el 100% del IVA aunque tenga RFC", () => {
    // Ver `fiscal-iva-isr-plataforma.md` §0.6. El ISR no cambia por esto.
    const fuera = { ...MEXICANO, payoutAccountCountry: "US" };
    const r = venta("MX", fuera);
    expect(r.ivaRate).toBe(1);
    expect(r.ivaRetenido).toBe(16);
    expect(r.isrRetenido).toBe(2.5);
  });
});

describe("creador extranjero", () => {
  const EXTRANJERO: PerfilFiscalCreador = {
    residency: "FOREIGN",
    hasTaxId: false,
    payoutAccountCountry: "DE",
  };

  it("no se le retiene ISR por un servicio prestado fuera de México", () => {
    expect(venta("MX", EXTRANJERO).isrRetenido).toBe(0);
  });

  it("su comisión NO lleva IVA, por exportación de mediación", () => {
    // Confirmado por el fiscalista el 2026-08-29. Si se revirtiera, Vibra tendría que absorber
    // ese 16% de su margen: el creador extranjero no lo puede acreditar.
    expect(venta("MX", EXTRANJERO).ivaComision).toBe(0);
    // Y al mexicano sí se le cobra, por encima del 25%.
    expect(venta("MX").ivaComision).toBe(4); // 16% de los 25 de comisión
  });

  it("si su pago es REGALÍA sí se le retiene ISR", () => {
    const regalia = { ...EXTRANJERO, esRegalia: true as const };
    expect(venta("MX", regalia).isrRetenido).toBe(25);
  });

  it("con constancia de residencia aplica la tasa del tratado", () => {
    const conTratado = { ...EXTRANJERO, esRegalia: true as const, tasaTratado: 0.1 };
    expect(venta("MX", conTratado).isrRetenido).toBe(10);
  });
});

describe("el saldo ya viene neto (§A5)", () => {
  // 🚨 Desde el 2026-09-03 la retención ocurre EN LA VENTA, no al retirar. El saldo que ve el
  // creador es dinero suyo, ya limpio, y retirar solo lo mueve.

  it("🚨 dos ventas iguales dejan saldos distintos según el comprador", () => {
    const aMexicano = venta("MX");
    const aAleman = venta("DE");

    // No es un porcentaje sobre el total: son dos tratamientos distintos sumados.
    // La mexicana llevó IVA y se le retuvo la mitad; la alemana fue exportación a 0%.
    expect(aMexicano.ivaRetenido).toBe(8);
    expect(aAleman.ivaRetenido).toBe(0);
    expect(aMexicano.neto).not.toBe(aAleman.neto);

    // Lo que el creador tiene disponible es la suma de los dos netos, no 150.
    const saldo = round2(aMexicano.neto + aAleman.neto);
    expect(saldo).toBe(145);
  });

  it("🚨 retirar NO vuelve a retener: sería cobrarlo dos veces", () => {
    const r = calcularRetiro({
      saldo: 145,
      // Se siguen pasando por compatibilidad, pero ya no deben aplicarse.
      ivaCobradoPendiente: 16,
      isrPendiente: 5,
      ivaPendiente: 8,
      ivaComisionPendiente: 8,
    });

    expect(r.bruto).toBe(145);
    expect(r.neto).toBe(145);
    expect(r.isr).toBe(0);
    expect(r.iva).toBe(0);
    expect(r.ivaComision).toBe(0);
    expect(r.ivaCobrado).toBe(0);
  });

  it("un retiro parcial es solo una fracción del dinero", () => {
    const r = calcularRetiro({
      saldo: 145,
      solicitado: 72.5,
      ivaCobradoPendiente: 16,
      isrPendiente: 5,
      ivaPendiente: 8,
      ivaComisionPendiente: 8,
    });
    expect(r.proporcion).toBe(0.5);
    expect(r.neto).toBe(72.5);
  });

  it("no se puede retirar más de lo que hay", () => {
    const r = calcularRetiro({
      saldo: 10,
      solicitado: 500,
      ivaCobradoPendiente: 0,
      isrPendiente: 0,
      ivaPendiente: 0,
      ivaComisionPendiente: 0,
    });
    expect(r.neto).toBe(10);
  });
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Los cargos refacturados (§11, 2026-09-04)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🚨 EL PROBLEMA QUE RESUELVEN. El comprador paga base + cargo fijo + 2% de conversión, y el IVA
//    se calcula sobre ESA suma. Pero el CFDI amparaba solo la base, así que quedaban ~0.39 de IVA
//    por cada 100 cobrados sin aparecer en el comprobante de nadie.
//
//    Desde ahora los dos cargos entran en lo que el creador factura —un solo concepto— y Vibra se
//    los refactura desglosados. Lo que el creador RECIBE no cambia; lo que cambia es su ingreso
//    facturado y, con él, la base de sus retenciones.

describe("cargos refacturados", () => {
  /** Base 100 con cargo fijo 0.40 y 2% sobre 100.40 = 2.01, redondeado a 2.41. */
  const CARGOS = 2.41;

  const conCargos = () => {
    const fiscal = resolveSaleTax({ base: 102.41, buyerCountry: "MX" });
    return resolveSettlement({
      base: 100,
      cargosRefacturados: CARGOS,
      mxVatAmount: fiscal.mxVatAmount,
      creador: MEXICANO,
    });
  };

  it("🚨 la participación del creador NO cambia", () => {
    // Es la garantía de todo el diseño: los cargos suben el ingreso facturado y bajan otro tanto
    // en la refactura. Si esto se rompiera, le estaríamos quitando dinero al creador.
    expect(conCargos().participacion).toBe(75);
  });

  it("🚨 el reparto sigue siendo 25% del PRECIO, no del total facturado", () => {
    // Calcular el 25% sobre 102.41 daría 25.60 y rompería el 75/25 escrito en los términos.
    expect(conCargos().comision).toBe(25);
    expect(conCargos().cargos).toBe(CARGOS);
  });

  it("el ingreso facturable es el precio más los cargos", () => {
    expect(conCargos().ingresoFacturable).toBe(102.41);
  });

  it("🚨 el ISR se retiene sobre lo FACTURADO, no sobre la base", () => {
    // 102.41 × 2.5% = 2.56, no 2.50. Es la contrapartida de facturar el total: sube la base de
    // retención. El creador lo recupera al declarar, salvo si optó por el pago definitivo.
    expect(conCargos().isrRetenido).toBe(2.56);
  });

  it("el impuesto de la refactura grava los TRES conceptos", () => {
    // (25 + 2.41) × 16% = 4.39. Gravar solo la comisión dejaría los cargos sin su impuesto.
    expect(conCargos().ivaComision).toBe(4.39);
  });

  it("🚨 sin cargos, todo queda exactamente como antes", () => {
    // Los asientos anteriores al cambio no traen cargos. Tienen que liquidar igual que siempre,
    // o un recálculo movería dinero ya pagado.
    const fiscal = resolveSaleTax({ base: 100, buyerCountry: "MX" });
    const sin = resolveSettlement({ base: 100, mxVatAmount: fiscal.mxVatAmount, creador: MEXICANO });

    expect(sin.cargos).toBe(0);
    expect(sin.ingresoFacturable).toBe(100);
    expect(sin.isrRetenido).toBe(2.5);
    expect(sin.ivaComision).toBe(4);
    expect(sin.neto).toBe(76.5);
  });

  it("exportación: los cargos suben la base del ISR pero no crean IVA", () => {
    // El comprador extranjero no paga IVA mexicano, así que no hay nada que retener por ese lado.
    // El ISR sí sube, porque se retiene sobre todas las ventas.
    const fiscal = resolveSaleTax({ base: 102.41, buyerCountry: "DE" });
    const r = resolveSettlement({
      base: 100,
      cargosRefacturados: CARGOS,
      mxVatAmount: fiscal.mxVatAmount,
      creador: MEXICANO,
    });

    expect(r.ivaRetenido).toBe(0);
    expect(r.isrRetenido).toBe(2.56);
    expect(r.participacion).toBe(75);
  });
});
