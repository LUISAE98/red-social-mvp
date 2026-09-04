// Complemento «Servicios de Plataformas Tecnológicas» del CFDI de retenciones.
//
// Lo que el SAT exige de una plataforma de intermediación cuando le retiene a sus creadores.
// Investigado y confirmado contra fuente oficial el 2026-09-02 (`pendientesimpuestos.md` §A4).
//
// ⚠️ LA CLAVE Y EL COMPLEMENTO SON INSEPARABLES
//
// La regla de validación del SAT es explícita: **el atributo `CveRetenc` debe ser `26`; si es
// distinto, este complemento no debe existir**. No se puede poner la clave sin el complemento ni
// el complemento con otra clave. Antes se mandaba `14`, «dividendos o utilidades distribuidas»,
// que no tiene nada que ver con retenerle a alguien por vender a través de una plataforma.
//
// ⚠️ NO ES UN DOCUMENTO DE TOTALES: LLEVA UN NODO POR SERVICIO
//
// Esto es lo que más pesa en el diseño. Además de los totales del periodo, el complemento exige
// un nodo `Servicios` por **cada operación**, con su fecha, su precio sin IVA, sus impuestos
// trasladados y la comisión que cobró la plataforma por ella. Un creador con quinientas ventas
// al mes produce un complemento con quinientos nodos.
//
// 🚨 Y de ahí sale una observación que importa para §A5: **el complemento está diseñado
//    suponiendo que la plataforma retiene conforme presta cada servicio**, no cuando le paga al
//    creador. `FechaServ` es la fecha del SERVICIO. Un modelo que difiere la retención al retiro
//    —el nuestro— no encaja de forma natural aquí. Hay que resolverlo en §A5.

/** Clave de retención obligatoria cuando va este complemento. */
export const CVE_RETENC_PLATAFORMAS = "26";

/**
 * `c_TipoDeServ` — qué vende el creador.
 *
 * El catálogo vigente tiene siete claves: transporte de pasajeros (01), entrega de alimentos
 * (02), entrega de bienes (03), hospedaje (04), comercio de bienes (05), **otro tipo de
 * servicios (06)** y juegos con apuestas (11, nueva desde el 01-01-2026).
 *
 * Vibra va en la **06**. No es una interpretación forzada: los once servicios de los creadores
 * no son ninguno de los otros seis, y el catálogo tiene ese cajón general justamente para esto.
 */
export const TIPO_SERVICIO_OTROS = "06";

/**
 * `c_Periodicidad` — solo admite dos valores, `01` semanal y `02` mensual.
 *
 * 🚨 Es una restricción dura sobre §A5: **la constancia no puede ser por retiro**. Tiene que ser
 * un documento de periodo, semanal o mensual. Los retiros del periodo podrán decidir los números
 * y el tipo de cambio, pero no la forma del documento.
 */
export const PERIODICIDAD_MENSUAL = "02";

/**
 * `c_FormaPagoServ` — cómo se pagó el servicio. Es un catálogo PROPIO del complemento, de nueve
 * valores, distinto del `c_FormaPago` del CFDI normal.
 *
 * 🔁 FISCALISTA: se manda `08`, «pago a través de intermediario». Es lo que describe mejor lo
 * que pasa —el comprador paga a Vibra y Vibra le abona al creador— aunque por debajo el cargo
 * fuera una tarjeta. Poner `03` tarjeta de crédito describiría el cobro al comprador, no la
 * forma en que el creador recibió su dinero, que es lo que este campo documenta.
 */
export const FORMA_PAGO_INTERMEDIARIO = "08";

/**
 * Espacio de nombres del complemento.
 *
 * 🚨 NO SE DEDUCE, SE CONSULTA. El primer intento usó
 * `.../retencionpago/1/servicios/plataformastecnologicas`, que parece razonable y no existe. El
 * SAT respondió `cvc-complex-type.2.4.c: no declaration can be found for element` — su validador
 * no encuentra esquema para un espacio de nombres que nadie publicó.
 *
 * El bueno lleva el nombre pegado y versionado, `PlataformasTecnologicas10`, y sale del registro
 * de espacios de nombres del SAT (`phpcfdi/sat-ns-registry`), no de la intuición.
 */
const NS = "http://www.sat.gob.mx/esquemas/retencionpago/1/PlataformasTecnologicas10";

/** Ruta del XSD, del mismo registro. El validador la exige aunque no la descargue. */
const XSD =
  "http://www.sat.gob.mx/esquemas/retencionpago/1/PlataformasTecnologicas10" +
  "/ServiciosPlataformasTecnologicas10.xsd";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Una operación del periodo, con los pesos ya resueltos. */
export type ServicioDelComplemento = {
  /** `YYYY-MM-DD` de la operación. */
  fecha: string;
  /** Precio del creador sin impuesto, en pesos. */
  precioSinIva: number;
  /** IVA que el creador trasladó al comprador, en pesos. */
  ivaTrasladado: number;
  /** Comisión que Vibra cobró por esa operación, en pesos. */
  comision: number;
  /** IVA de esa comisión, en pesos. */
  ivaComision: number;
};

/** El nodo que se manda, ya con la forma del complemento del SAT. */
export type ComplementoPlataformas = {
  Periodicidad: string;
  NumServ: number;
  MontToServSIva: number;
  TotalIvaTrasladado: number;
  TotalIvaRetenido: number;
  TotalIsrRetenido: number;
  DifIvaEntregadoPrestServ: number;
  MonTotalporUsoPlataforma: number;
  Servicios: Array<{
    FechaServ: string;
    PrecioServSinIva: number;
    TipoDeServ: string;
    FormaPagoServ: string;
    ImpuestosTrasladadosdelServicio: { BaseIva: number; ImpuestoIva: number };
    ComisionDelServicio: { MontoComision: number; ImpuestoIvaComision: number };
  }>;
};

/**
 * Arma el complemento a partir de los servicios del periodo y lo retenido.
 *
 * Función PURA: los totales del nodo se **suman de los servicios**, no se reciben, para que no
 * puedan discrepar del detalle. Un complemento cuyos totales no cuadran con sus nodos es un CFDI
 * que el SAT rechaza, y descubrirlo al timbrar es tarde.
 *
 * Lo retenido sí viene de fuera, porque no se calcula por servicio: sale del motor fiscal con el
 * perfil del creador congelado en cada venta.
 */
export function armarComplemento(
  servicios: ServicioDelComplemento[],
  retenido: { iva: number; isr: number }
): ComplementoPlataformas {
  let montoSinIva = 0;
  let ivaTrasladado = 0;
  let comisiones = 0;

  const nodos = servicios.map((s) => {
    montoSinIva = round2(montoSinIva + s.precioSinIva);
    ivaTrasladado = round2(ivaTrasladado + s.ivaTrasladado);
    comisiones = round2(comisiones + s.comision);
    return {
      FechaServ: s.fecha,
      PrecioServSinIva: s.precioSinIva,
      TipoDeServ: TIPO_SERVICIO_OTROS,
      FormaPagoServ: FORMA_PAGO_INTERMEDIARIO,
      ImpuestosTrasladadosdelServicio: {
        BaseIva: s.precioSinIva,
        ImpuestoIva: s.ivaTrasladado,
      },
      ComisionDelServicio: {
        MontoComision: s.comision,
        ImpuestoIvaComision: s.ivaComision,
      },
    };
  });

  return {
    Periodicidad: PERIODICIDAD_MENSUAL,
    NumServ: nodos.length,
    MontToServSIva: montoSinIva,
    TotalIvaTrasladado: ivaTrasladado,
    TotalIvaRetenido: round2(retenido.iva),
    TotalIsrRetenido: round2(retenido.isr),
    /**
     * El IVA que SÍ se le entregó al creador.
     *
     * Es la diferencia entre lo que trasladó a sus compradores y lo que Vibra le retuvo. Con la
     * retención del 50% del IVA que aplica al creador mexicano, es la otra mitad — el dinero que
     * llegó a su wallet por encima del precio.
     */
    DifIvaEntregadoPrestServ: round2(ivaTrasladado - retenido.iva),
    MonTotalporUsoPlataforma: comisiones,
    Servicios: nodos,
  };
}

/**
 * El complemento como XML, que es como Facturapi lo admite.
 *
 * 🚨 FACTURAPI NO TIENE UN TIPO CON NOMBRE PARA ESTE COMPLEMENTO.
 *
 *    Su documentación enumera siete complementos de retenciones —dividendos, intereses,
 *    premios, fideicomisos, arrendamiento en fideicomiso, planes de retiro y enajenación de
 *    acciones— y **plataformas tecnológicas no está entre ellos**. Mandarle
 *    `{ type, data }` devuelve «El campo complements.0 tiene un tipo inválido».
 *
 *    La salida es la que su propia documentación describe para cualquier complemento que no
 *    tenga tipo propio: **insertar el XML** en el nodo `complements`. Se arma aquí, con los
 *    nombres del Anexo 20 —que en el XML sí son los del SAT, porque viaja tal cual—.
 *
 * ⚠️ Al ser XML a mano, el orden de los nodos importa y los importes van con dos decimales
 *    exactos: el XSD del SAT valida las dos cosas.
 */
export function complementoComoXml(c: ComplementoPlataformas): string {
  const n = (v: number) => v.toFixed(2);

  const servicios = c.Servicios.map(
    (s) =>
      `<plataformasTecnologicas:Servicios FechaServ="${s.FechaServ}" ` +
      `PrecioServSinIva="${n(s.PrecioServSinIva)}" ` +
      `TipoDeServ="${s.TipoDeServ}" FormaPagoServ="${s.FormaPagoServ}">` +
      `<plataformasTecnologicas:ImpuestosTrasladadosdelServicio ` +
      `BaseIva="${n(s.ImpuestosTrasladadosdelServicio.BaseIva)}" ` +
      `ImpuestoIva="${n(s.ImpuestosTrasladadosdelServicio.ImpuestoIva)}"/>` +
      `<plataformasTecnologicas:ComisionDelServicio ` +
      `MontoComision="${n(s.ComisionDelServicio.MontoComision)}" ` +
      `ImpuestoIvaComision="${n(s.ComisionDelServicio.ImpuestoIvaComision)}"/>` +
      `</plataformasTecnologicas:Servicios>`
  ).join("");

  return (
    `<plataformasTecnologicas:ServiciosPlataformasTecnologicas ` +
    `xmlns:plataformasTecnologicas="${NS}" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="${NS} ${XSD}" ` +
    `Version="1.0" ` +
    `Periodicidad="${c.Periodicidad}" ` +
    `NumServ="${c.NumServ}" ` +
    `MontToServSIva="${n(c.MontToServSIva)}" ` +
    `TotalIvaTrasladado="${n(c.TotalIvaTrasladado)}" ` +
    `TotalIvaRetenido="${n(c.TotalIvaRetenido)}" ` +
    `TotalIsrRetenido="${n(c.TotalIsrRetenido)}" ` +
    `DifIvaEntregadoPrestServ="${n(c.DifIvaEntregadoPrestServ)}" ` +
    `MonTotalporUsoPlataforma="${n(c.MonTotalporUsoPlataforma)}">` +
    servicios +
    `</plataformasTecnologicas:ServiciosPlataformasTecnologicas>`
  );
}
