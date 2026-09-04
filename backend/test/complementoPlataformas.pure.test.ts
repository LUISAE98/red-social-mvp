// El complemento «Servicios de Plataformas Tecnológicas» del CFDI de retenciones (§A4).
//
// Lo que se protege aquí es que el documento con el que un creador acredita ante el SAT lo que
// se le retuvo salga bien.
//
// 🚨 ESTE ARCHIVO ES LA RED DE UN XML ESCRITO A MANO. La primera versión del complemento estaba
//    mal en ocho sitios —espacio de nombres inexistente, un nivel de jerarquía ausente, cinco
//    atributos con la capitalización cambiada y dos nodos con atributos inventados— y los tests
//    de entonces la daban por buena, porque afirmaban lo mismo que el código. Los de ahora están
//    transcritos del XSD oficial, no del código.

import { describe, it, expect } from "vitest";
import {
  armarComplemento,
  complementoComoXml,
  CVE_RETENC_PLATAFORMAS,
  TIPO_SERVICIO_OTROS,
  PERIODICIDAD_MENSUAL,
  NS_PLATAFORMAS,
  type ServicioDelComplemento,
} from "../src/facturacion/complementoPlataformas";
import { serviciosDelPeriodo } from "../src/facturacion/creatorMonthlyDocs";

const venta = (over: Partial<ServicioDelComplemento> = {}): ServicioDelComplemento => ({
  fecha: "2026-09-15",
  precioSinIva: 1850,
  ivaTrasladado: 296, // 16%
  comision: 462.5, // 25%
  ivaComision: 74,
  ...over,
});

describe("claves y catálogos", () => {
  it("🚨 la clave de retención es 26, no 14", () => {
    // La `14` es «dividendos o utilidades distribuidas». Vibra no reparte dividendos.
    expect(CVE_RETENC_PLATAFORMAS).toBe("26");
  });

  it("el tipo de servicio es «otro tipo de servicios»", () => {
    expect(TIPO_SERVICIO_OTROS).toBe("06");
  });

  it("🚨 la periodicidad mensual es 02, aunque el catálogo tenga cinco valores", () => {
    // Con cinco valores es tentador leerlo como el catálogo de la factura global, donde el
    // mensual es el `04`. Es otro catálogo: aquí `01` es semanal y `02` mensual.
    expect(PERIODICIDAD_MENSUAL).toBe("02");
  });

  it("🚨 el espacio de nombres es el del registro del SAT, no uno deducido", () => {
    // El primero que se probó salió de inferirlo del nombre del complemento y no existía: el
    // PAC contestó `cvc-complex-type.2.4.c, no declaration can be found`.
    expect(NS_PLATAFORMAS.uri).toBe(
      "http://www.sat.gob.mx/esquemas/retencionpago/1/PlataformasTecnologicas10"
    );
    expect(NS_PLATAFORMAS.prefix).toBe("plataformasTecnologicas");
    expect(NS_PLATAFORMAS.schema_location).toMatch(/\/ServiciosPlataformasTecnologicas10\.xsd$/);
  });
});

describe("armado del complemento", () => {
  it("🚨 los totales se SUMAN del detalle, no se reciben", () => {
    // Un complemento cuyos totales no cuadran con sus nodos es un CFDI rechazado, y descubrirlo
    // al timbrar es tarde. Por eso no se aceptan totales de fuera.
    const c = armarComplemento([venta(), venta({ precioSinIva: 1000, ivaTrasladado: 160 })], {
      iva: 228,
      isr: 71.25,
    });

    expect(c.NumServ).toBe(2);
    expect(c.MonTotServSIVA).toBe(2850);
    expect(c.TotalIVATrasladado).toBe(456);
  });

  it("lleva un detalle por operación, con su fecha", () => {
    const c = armarComplemento([venta({ fecha: "2026-09-01" }), venta({ fecha: "2026-09-28" })], {
      iva: 296,
      isr: 92.5,
    });

    expect(c.Servicios).toHaveLength(2);
    expect(c.Servicios[0].FechaServ).toBe("2026-09-01");
    expect(c.Servicios[1].FechaServ).toBe("2026-09-28");
    expect(c.Servicios[0].TipoDeServ).toBe("06");
  });

  it("🚨 el IVA entregado al creador es lo trasladado menos lo retenido", () => {
    // Con la retención del 50% al creador mexicano es la otra mitad, el dinero que sí llegó a su
    // wallet por encima del precio. Equivocarlo descuadra su acreditamiento.
    const c = armarComplemento([venta()], { iva: 148, isr: 46.25 });

    expect(c.TotalIVATrasladado).toBe(296);
    expect(c.TotalIVARetenido).toBe(148);
    expect(c.DifIVAEntregadoPrestServ).toBe(148);
  });

  it("🚨 la tasa de IVA se DESPEJA de la operación, no se asume 16%", () => {
    // Un creador en zona fronteriza traslada el 8%. Asumir la tasa metería un `TasaCuota` que
    // no cuadra con el importe, y el SAT valida esa coherencia.
    const frontera = armarComplemento([venta({ ivaTrasladado: 148 })], { iva: 74, isr: 46.25 });
    expect(frontera.Servicios[0].ImpuestosTrasladadosdelServicio?.TasaCuota).toBe(0.08);

    const normal = armarComplemento([venta()], { iva: 148, isr: 46.25 });
    expect(normal.Servicios[0].ImpuestosTrasladadosdelServicio?.TasaCuota).toBe(0.16);
  });

  it("🚨 una tasa que no está en el catálogo LANZA en vez de redondearse", () => {
    // `c_TasaCuota` es una enumeración cerrada. Redondear a la más cercana convertiría un dato
    // roto en un CFDI timbrado, que ya no se puede corregir sin cancelar.
    expect(() =>
      armarComplemento([venta({ ivaTrasladado: 200 })], { iva: 100, isr: 46.25 })
    ).toThrow(/fuera del catálogo/);
  });

  it("exportación a 0%: se omite el nodo de impuestos trasladados", () => {
    // El nodo es condicional en el XSD. Sin IVA trasladado no hay nada que declarar, y `Base`
    // exige un valor mayor que cero.
    const c = armarComplemento([venta({ ivaTrasladado: 0 })], { iva: 0, isr: 46.25 });
    expect(c.Servicios[0].ImpuestosTrasladadosdelServicio).toBeUndefined();
    expect(c.TotalIVATrasladado).toBe(0);
    expect(c.DifIVAEntregadoPrestServ).toBe(0);
  });

  it("la comisión lleva base, porcentaje e importe, y NO su impuesto", () => {
    // `ComisionDelServicio` no tiene campo para el IVA de la comisión: ese va en el CFDI de
    // comisión que Vibra le emite al creador, no aquí.
    const c = armarComplemento([venta(), venta()], { iva: 296, isr: 92.5 });
    expect(c.MonTotalporUsoPlataforma).toBe(925);
    expect(c.Servicios[0].ComisionDelServicio).toEqual({
      Base: 1850,
      Porcentaje: 0.25,
      Importe: 462.5,
    });
  });
});

describe("el complemento como XML", () => {
  /*
   * Facturapi no tiene un tipo con nombre para este complemento, así que viaja como XML dentro
   * de `complements` y se inserta tal cual al timbrar. Eso lo vuelve texto a mano, y el XSD del
   * SAT es estricto: aquí se fija la forma.
   */
  const xml = () => complementoComoXml(armarComplemento([venta()], { iva: 148, isr: 46.25 }));

  it("🚨 la jerarquía tiene TRES niveles, no dos", () => {
    // raíz → `Servicios` (uno solo, envoltorio) → `DetallesDelServicio` (uno por operación).
    // La primera versión repetía `Servicios` por venta y se saltaba el nivel de en medio.
    const s = complementoComoXml(armarComplemento([venta(), venta()], { iva: 296, isr: 92.5 }));
    expect(s.match(/<plataformasTecnologicas:Servicios>/g)).toHaveLength(1);
    expect(s.match(/<plataformasTecnologicas:DetallesDelServicio/g)).toHaveLength(2);
  });

  it("🚨 los atributos llevan las siglas en MAYÚSCULA, como el XSD", () => {
    // `MonTotServSIVA`, no `MontToServSIva`. Un atributo mal capitalizado no existe para el
    // validador, y el error que devuelve no dice cuál es.
    const s = xml();
    for (const attr of [
      "MonTotServSIVA",
      "TotalIVATrasladado",
      "TotalIVARetenido",
      "TotalISRRetenido",
      "DifIVAEntregadoPrestServ",
      "MonTotalporUsoPlataforma",
      "PrecioServSinIVA",
    ]) {
      expect(s).toContain(`${attr}="`);
    }
  });

  it("🚨 el nodo de impuestos usa los atributos del SAT, no los inventados", () => {
    // Eran `BaseIva` e `ImpuestoIva`, que no existen. Los reales son cinco, y `Impuesto` vale
    // `02` para el IVA en el catálogo de RETENCIONES (no `002`, que es el del CFDI normal).
    expect(xml()).toContain(
      '<plataformasTecnologicas:ImpuestosTrasladadosdelServicio Base="1850.00" ' +
        'Impuesto="02" TipoFactor="Tasa" TasaCuota="0.160000" Importe="296.00"/>'
    );
  });

  it("declara su propio xmlns para ser XML bien formado por sí solo", () => {
    expect(xml()).toContain(`xmlns:plataformasTecnologicas="${NS_PLATAFORMAS.uri}"`);
  });

  it("🚨 NO lleva xsi:schemaLocation, que va en la raíz del CFDI", () => {
    // Ponerlo aquí no sirve: el PAC lo busca en `retenciones:Retenciones`, que construye
    // Facturapi. Se le pasa aparte, en el campo `namespaces`.
    expect(xml()).not.toContain("schemaLocation");
  });

  it("🚨 los importes llevan dos decimales exactos", () => {
    // El XSD los valida. Un `462.5` donde espera `462.50` tumba el timbrado aunque el número
    // sea correcto. `Version="1.0"` lleva uno y así debe ser, por eso no entra en la regla.
    const s = xml();
    expect(s).toContain('MonTotServSIVA="1850.00"');
    expect(s).toContain('Importe="462.50"');
    expect(s).not.toMatch(/(Mont|Total|Precio|Base|Importe|Dif)[A-Za-z]*="\d+\.\d"/);
  });

  it("cierra bien la raíz", () => {
    expect(xml()).toMatch(
      /^<plataformasTecnologicas:ServiciosPlataformasTecnologicas .*<\/plataformasTecnologicas:ServiciosPlataformasTecnologicas>$/s
    );
  });
});

describe("detalle sacado de los asientos", () => {
  const asiento = (over: Record<string, unknown> = {}) =>
    ({
      status: "earned",
      grossAmount: 100,
      occurredAt: { toDate: () => new Date("2026-09-15T18:00:00.000Z") },
      fiscalMxn: { total: 2146, base: 1850, iva: 296, tipoCambio: 18.5, fuente: "cobro" },
      retenciones: { comision: 25, ivaComision: 4 },
      ...over,
    }) as Parameters<typeof serviciosDelPeriodo>[0][number];

  /** FIX de mentira, para no depender de que Banxico esté en pie durante un test. */
  const fixFalso = async () => 20;

  it("con pesos congelados usa el tipo de cambio de ESA venta", async () => {
    const [s] = await serviciosDelPeriodo([asiento()], fixFalso);
    expect(s.precioSinIva).toBe(1850);
    expect(s.comision).toBe(462.5); // 25 USD × 18.5, la tasa real de su cobro
    expect(s.ivaComision).toBe(74);
  });

  it("🚨 una venta de EXPORTACIÓN se convierte con el FIX, no se salta", async () => {
    /*
     * Antes se saltaba, y por eso la constancia quedaba con la base corta: el ISR se retiene
     * sobre TODAS las ventas, también las exportadas. Fue lo que bloqueó este documento hasta
     * que apareció la fuente oficial de tipo de cambio.
     */
    const [s] = await serviciosDelPeriodo([asiento({ fiscalMxn: undefined })], fixFalso);
    expect(s.precioSinIva).toBe(2000); // 100 USD × 20 del FIX
    expect(s.ivaTrasladado).toBe(0); // exportación a 0%: no hubo IVA que trasladar
    expect(s.comision).toBe(500); // 25 × 20
  });

  it("🚨 salta las ventas sin fecha: `FechaServ` es obligatorio", async () => {
    const r = await serviciosDelPeriodo([asiento({ occurredAt: null, createdAt: null })], fixFalso);
    expect(r).toHaveLength(0);
  });

  it("solo cuenta lo ganado, no lo pendiente de resolver", async () => {
    expect(await serviciosDelPeriodo([asiento({ status: "pending" })], fixFalso)).toHaveLength(0);
  });

  it("🚨 mezcla nacional y exportación en el mismo periodo, cada una con su tasa", async () => {
    const r = await serviciosDelPeriodo([asiento(), asiento({ fiscalMxn: undefined })], fixFalso);
    expect(r).toHaveLength(2);
    expect(r[0].precioSinIva).toBe(1850); // cobro real
    expect(r[1].precioSinIva).toBe(2000); // FIX
  });
});
