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
  type PerfilFiscalCreador,
} from "../../backend/src/tax/fiscalEngine";
import {
  resolveSaleTax as saleFront,
  resolveSettlement as settleFront,
  TASAS_POR_EJERCICIO as TASAS_FRONT,
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
  it("sin identificación fiscal el mexicano recibe 51 en vez de 76.50", () => {
    const { liq } = corrida("MX", mxSinRfc);
    expect(liq.isrRetenido).toBe(20);
    expect(liq.ivaRetenido).toBe(16);
    expect(liq.neto).toBe(51);
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
    expect(liq.isrRate).toBe(TASAS_POR_EJERCICIO[2026].isrMxConRfc);
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
