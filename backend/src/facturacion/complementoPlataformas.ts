// Complemento «Servicios de Plataformas Tecnológicas» del CFDI de retenciones.
//
// Lo que el SAT exige de una plataforma de intermediación cuando le retiene a sus creadores.
// Transcrito del XSD oficial el 2026-09-04 (`pendientesimpuestos.md` §A4).
//
// 🚨 ESTE ARCHIVO SE ESCRIBIÓ TRES VECES. LAS DOS PRIMERAS, DEDUCIENDO.
//
// La versión original salió de resúmenes de terceros y de inferir nombres a partir de la
// descripción del complemento. Parecía razonable y estaba mal en ocho sitios a la vez: el
// espacio de nombres no existía, faltaba un nivel entero de la jerarquía, cinco atributos
// tenían la capitalización cambiada y dos nodos llevaban atributos inventados. Nada de eso se
// veía hasta timbrar, y cada intento costaba un viaje al PAC.
//
// La versión buena está transcrita de `ServiciosPlataformasTecnologicas10.xsd` descargado del
// SAT, con los catálogos leídos de `CatPlataformasTecnologicas.xsd` y `catRetenciones.xsd`.
// **Si hace falta tocar algo aquí, se descarga el XSD y se lee.** No hay atajo.
//
// ⚠️ LA CLAVE Y EL COMPLEMENTO SON INSEPARABLES
//
// La regla del SAT es explícita: el atributo `CveRetenc` debe ser `26`; si es distinto, este
// complemento no debe existir. No se puede poner la clave sin el complemento ni al revés.
//
// ⚠️ NO ES UN DOCUMENTO DE TOTALES: LLEVA UN NODO POR OPERACIÓN
//
// Además de los totales del periodo, exige un `DetallesDelServicio` por **cada venta**, con su
// fecha, su precio sin IVA, sus impuestos trasladados y la comisión que cobró la plataforma.
// Un creador con quinientas ventas al mes produce quinientos nodos.
//
// 🚨 De ahí sale algo que importa para §A5: el complemento está diseñado suponiendo que la
//    plataforma retiene conforme presta cada servicio, no cuando le paga al creador.
//    `FechaServ` es la fecha del SERVICIO.

/** Clave de retención obligatoria cuando va este complemento. */
export const CVE_RETENC_PLATAFORMAS = "26";

/**
 * `c_TipoDeServ` — qué vende el creador. Vibra va en la **06**, «Otro tipo de servicios»,
 * confirmado contra la tabla del SAT. Los otros valores son transporte, alimentos, entrega de
 * bienes, hospedaje, comercio y juegos con apuestas; ninguno describe los once servicios.
 */
export const TIPO_SERVICIO_OTROS = "06";

/**
 * `c_Periodicidad` — `02` es mensual.
 *
 * ⚠️ El XSD enumera CINCO valores, no dos. Los tres últimos (`03` diario, `04` quincenal y `05`
 * otro) se añadieron en la actualización de catálogos de mayo de 2020; los originales son `01`
 * semanal y `02` mensual. Verlo con cinco valores sueltos invita a pensar que sigue el patrón
 * de la factura global, donde `04` es mensual, y no es el mismo catálogo.
 */
export const PERIODICIDAD_MENSUAL = "02";

/**
 * `c_FormaPagoServ` — catálogo PROPIO del complemento, de nueve valores, distinto del
 * `c_FormaPago` del CFDI normal.
 *
 * 🔁 FISCALISTA: se manda `08`. Describe cómo recibió su dinero el creador, a través de un
 * intermediario, y no cómo pagó el comprador.
 */
export const FORMA_PAGO_INTERMEDIARIO = "08";

/**
 * `c_TipoImpuesto` del catálogo de RETENCIONES. `02` es IVA.
 *
 * 🚨 No confundir con el `c_Impuesto` del CFDI normal, donde el IVA es `002` con tres dígitos.
 * Son catálogos distintos con claves distintas para el mismo impuesto.
 */
const IMPUESTO_IVA = "02";

/** `TipoFactor` tiene valor prefijado en el XSD. No admite «Exento» ni «Cuota». */
const TIPO_FACTOR = "Tasa";

/**
 * `c_TasaCuota` es una enumeración cerrada, no un decimal libre. Estas son las tasas que el SAT
 * admite para un traslado; cualquier otra tumba el timbrado.
 */
const TASAS_ADMITIDAS = [0.16, 0.08, 0.5] as const;

/**
 * Identidad del complemento, del registro de espacios de nombres del SAT.
 *
 * 🚨 NO SE DEDUCE, SE CONSULTA. El primer intento usó
 * `.../retencionpago/1/servicios/plataformastecnologicas`, que suena razonable y no existe.
 * El bueno lleva el nombre pegado y versionado.
 */
export const NS_PLATAFORMAS = {
  prefix: "plataformasTecnologicas",
  uri: "http://www.sat.gob.mx/esquemas/retencionpago/1/PlataformasTecnologicas10",
  schema_location:
    "http://www.sat.gob.mx/esquemas/retencionpago/1/PlataformasTecnologicas10" +
    "/ServiciosPlataformasTecnologicas10.xsd",
} as const;

const P = NS_PLATAFORMAS.prefix;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Una operación del periodo, con los pesos ya resueltos. */
export type ServicioDelComplemento = {
  /** `YYYY-MM-DD` de la operación. */
  fecha: string;
  /** Precio del creador sin impuesto, en pesos. */
  precioSinIva: number;
  /** IVA que el creador trasladó al comprador, en pesos. Cero en una exportación. */
  ivaTrasladado: number;
  /** Comisión que Vibra cobró por esa operación, en pesos. */
  comision: number;
  /**
   * IVA de esa comisión, en pesos.
   *
   * ⚠️ NO VIAJA EN EL COMPLEMENTO. `ComisionDelServicio` solo tiene `Base`, `Porcentaje` e
   * `Importe`; el SAT no pide aquí el impuesto de la comisión, porque ese ya va en el CFDI de
   * comisión que Vibra le emite al creador. Se conserva en el modelo porque lo usa ese otro
   * documento.
   */
  ivaComision: number;
};

/**
 * El nodo del complemento, con los nombres EXACTOS del XSD.
 *
 * ⚠️ La mayúscula importa. El SAT escribe `MonTotServSIVA`, no `MontToServSIva`, y así con todos
 * los que llevan las siglas de un impuesto. Un atributo mal capitalizado es un atributo que no
 * existe para el validador.
 */
export type ComplementoPlataformas = {
  Version: string;
  Periodicidad: string;
  NumServ: number;
  MonTotServSIVA: number;
  TotalIVATrasladado: number;
  TotalIVARetenido: number;
  TotalISRRetenido: number;
  DifIVAEntregadoPrestServ: number;
  MonTotalporUsoPlataforma: number;
  /**
   * 🚨 `Servicios` es UN envoltorio, no la lista.
   *
   * La estructura real tiene tres niveles, raíz, `Servicios`, y dentro `DetallesDelServicio`
   * repetido una vez por operación. El primer intento puso un `Servicios` por venta, saltándose
   * el nivel intermedio.
   */
  Servicios: DetalleDelServicio[];
};

export type DetalleDelServicio = {
  FormaPagoServ: string;
  TipoDeServ: string;
  FechaServ: string;
  PrecioServSinIVA: number;
  /** Condicional. No va cuando la operación no trasladó IVA, como en una exportación. */
  ImpuestosTrasladadosdelServicio?: {
    Base: number;
    Impuesto: string;
    TipoFactor: string;
    TasaCuota: number;
    Importe: number;
  };
  /** Condicional. No va cuando Vibra no cobró comisión por esa operación. */
  ComisionDelServicio?: { Base: number; Porcentaje?: number; Importe: number };
};

/**
 * Qué tasa de IVA se aplicó, despejada de la propia operación y validada contra el catálogo.
 *
 * Se despeja en vez de asumir 16%, porque el creador puede vender en zona fronteriza al 8%. Si
 * el cociente no coincide con ninguna tasa admitida se LANZA, en lugar de redondear a la más
 * cercana: un importe que no cuadra con su tasa es un dato roto, y timbrarlo lo vuelve
 * permanente.
 */
function tasaDeLaOperacion(base: number, iva: number): number {
  const tasa = iva / base;
  const admitida = TASAS_ADMITIDAS.find((t) => Math.abs(tasa - t) < 0.0005);
  if (admitida === undefined) {
    throw new Error(
      `Tasa de IVA fuera del catálogo del SAT: ${iva} sobre ${base} da ${tasa.toFixed(6)}`
    );
  }
  return admitida;
}

/**
 * Arma el complemento a partir de los servicios del periodo y lo retenido.
 *
 * Función PURA: los totales del nodo se **suman del detalle**, no se reciben, para que no puedan
 * discrepar. Un complemento cuyos totales no cuadran con sus nodos es un CFDI rechazado, y
 * descubrirlo al timbrar es tarde.
 */
export function armarComplemento(
  servicios: ServicioDelComplemento[],
  retenido: { iva: number; isr: number }
): ComplementoPlataformas {
  let montoSinIva = 0;
  let ivaTrasladado = 0;
  let comisiones = 0;

  const detalles: DetalleDelServicio[] = servicios.map((s) => {
    montoSinIva = round2(montoSinIva + s.precioSinIva);
    ivaTrasladado = round2(ivaTrasladado + s.ivaTrasladado);
    comisiones = round2(comisiones + s.comision);

    const detalle: DetalleDelServicio = {
      FormaPagoServ: FORMA_PAGO_INTERMEDIARIO,
      TipoDeServ: TIPO_SERVICIO_OTROS,
      FechaServ: s.fecha,
      PrecioServSinIVA: s.precioSinIva,
    };

    if (s.ivaTrasladado > 0) {
      detalle.ImpuestosTrasladadosdelServicio = {
        Base: s.precioSinIva,
        Impuesto: IMPUESTO_IVA,
        TipoFactor: TIPO_FACTOR,
        TasaCuota: tasaDeLaOperacion(s.precioSinIva, s.ivaTrasladado),
        Importe: s.ivaTrasladado,
      };
    }

    if (s.comision > 0) {
      /*
       * `Porcentaje` es opcional y su rango es 0.001 a 1.0 con tres decimales. Se manda solo si
       * cae dentro; fuera de rango se omite en vez de recortarlo, porque el importe ya lleva el
       * dato exacto y un porcentaje inventado no aporta nada.
       */
      const pct = Math.round((s.comision / s.precioSinIva) * 1000) / 1000;
      detalle.ComisionDelServicio = {
        Base: s.precioSinIva,
        ...(pct >= 0.001 && pct <= 1 ? { Porcentaje: pct } : {}),
        Importe: s.comision,
      };
    }

    return detalle;
  });

  return {
    Version: "1.0",
    Periodicidad: PERIODICIDAD_MENSUAL,
    NumServ: detalles.length,
    MonTotServSIVA: montoSinIva,
    TotalIVATrasladado: ivaTrasladado,
    TotalIVARetenido: round2(retenido.iva),
    TotalISRRetenido: round2(retenido.isr),
    /*
     * El IVA que SÍ se le entregó al creador, lo que trasladó a sus compradores menos lo que
     * Vibra le retuvo. Con la retención del 50% al creador mexicano es la otra mitad, el dinero
     * que llegó a su wallet por encima del precio.
     */
    DifIVAEntregadoPrestServ: round2(ivaTrasladado - retenido.iva),
    MonTotalporUsoPlataforma: comisiones,
    Servicios: detalles,
  };
}

const imp = (v: number) => v.toFixed(2);

function atributos(pares: Array<[string, string | number | undefined]>): string {
  return pares
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
}

/**
 * El complemento como XML, que es como Facturapi lo admite.
 *
 * 🚨 FACTURAPI NO TIENE UN TIPO CON NOMBRE PARA ESTE COMPLEMENTO. Su lista cubre siete
 * (dividendos, intereses, premios, fideicomisos, arrendamiento en fideicomiso, planes de retiro
 * y enajenación de acciones) y plataformas tecnológicas no es ninguno. Su especificación OpenAPI
 * define `complements` como un array de **strings** con el XML, un nodo raíz por elemento.
 *
 * ⚠️ EL `xsi:schemaLocation` NO VA AQUÍ. Va en el nodo raíz `retenciones:Retenciones`, que lo
 * construye Facturapi, y por eso se le pasa aparte en el campo `namespaces`. Ponerlo en este
 * fragmento no sirve de nada, el PAC no lo mira, y fue la causa del error
 * `cvc-complex-type.2.4.c: no declaration can be found`. El `xmlns` sí se queda, para que el
 * fragmento sea XML bien formado por sí solo; declarar dos veces el mismo URI es legal e inocuo.
 */
export function complementoComoXml(c: ComplementoPlataformas): string {
  const detalles = c.Servicios.map((d) => {
    const t = d.ImpuestosTrasladadosdelServicio;
    const k = d.ComisionDelServicio;
    const hijos =
      (t
        ? `<${P}:ImpuestosTrasladadosdelServicio` +
          atributos([
            ["Base", imp(t.Base)],
            ["Impuesto", t.Impuesto],
            ["TipoFactor", t.TipoFactor],
            ["TasaCuota", t.TasaCuota.toFixed(6)],
            ["Importe", imp(t.Importe)],
          ]) +
          "/>"
        : "") +
      (k
        ? `<${P}:ComisionDelServicio` +
          atributos([
            ["Base", imp(k.Base)],
            ["Porcentaje", k.Porcentaje === undefined ? undefined : k.Porcentaje.toFixed(3)],
            ["Importe", imp(k.Importe)],
          ]) +
          "/>"
        : "");

    return (
      `<${P}:DetallesDelServicio` +
      atributos([
        ["FormaPagoServ", d.FormaPagoServ],
        ["TipoDeServ", d.TipoDeServ],
        ["FechaServ", d.FechaServ],
        ["PrecioServSinIVA", imp(d.PrecioServSinIVA)],
      ]) +
      (hijos ? `>${hijos}</${P}:DetallesDelServicio>` : "/>")
    );
  }).join("");

  return (
    `<${P}:ServiciosPlataformasTecnologicas xmlns:${P}="${NS_PLATAFORMAS.uri}"` +
    atributos([
      ["Version", c.Version],
      ["Periodicidad", c.Periodicidad],
      ["NumServ", c.NumServ],
      ["MonTotServSIVA", imp(c.MonTotServSIVA)],
      ["TotalIVATrasladado", imp(c.TotalIVATrasladado)],
      ["TotalIVARetenido", imp(c.TotalIVARetenido)],
      ["TotalISRRetenido", imp(c.TotalISRRetenido)],
      ["DifIVAEntregadoPrestServ", imp(c.DifIVAEntregadoPrestServ)],
      ["MonTotalporUsoPlataforma", imp(c.MonTotalporUsoPlataforma)],
    ]) +
    `><${P}:Servicios>${detalles}</${P}:Servicios>` +
    `</${P}:ServiciosPlataformasTecnologicas>`
  );
}
