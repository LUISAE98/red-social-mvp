// Los dos comprobantes que Vibra emite AL CREADOR cada mes.
//
// Bajo intermediación, de cada venta salen tres documentos. El primero —la factura de venta al
// comprador— lo emite el creador y ya está resuelto (`generateBuyerInvoice`). Los otros dos los
// emite Vibra, y son estos:
//
//   2. CFDI de COMISIÓN     — Vibra le factura su 25% más el impuesto de esa comisión.
//   3. CFDI de RETENCIONES  — constancia de lo que Vibra retuvo y enteró por él.
//
// ⚠️ POR QUÉ MENSUALES Y NO POR VENTA
//
// Un creador con quinientas ventas al mes generaría mil comprobantes. Ninguna de las dos cosas
// se documenta operación por operación: la comisión es un servicio continuado y la constancia
// de retenciones es, por naturaleza, periódica. Se agrega por mes natural y por creador.
//
// ⚠️ EL EMISOR ES VIBRA, NO EL CREADOR
//
// Al revés que la factura de venta. Por eso estos dos se timbran en la organización de Vibra,
// con su llave, y el creador figura como RECEPTOR. No hace falta su sello digital.
//
// Detalle del modelo: `docs/legal/fiscal-iva-isr-plataforma.md` §0.3.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { facturapiFetch } from "./facturapiClient";
import { requiereCfdiRetenciones } from "../tax/fiscalEngine";
import { leerImporteFiscal } from "./importeFiscal";
import {
  armarComplemento,
  CVE_RETENC_PLATAFORMAS,
  type ServicioDelComplemento,
} from "./complementoPlataformas";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Lo que se acumuló de un creador en un mes. */
export type AcumuladoMensual = {
  creatorId: string;
  /** Mes natural en formato `YYYY-MM`. */
  periodo: string;
  /** Número de ventas ganadas en el mes. */
  ventas: number;
  /** Suma de las bases (sin impuesto). */
  base: number;
  /** Comisión de Vibra del mes. */
  comision: number;
  /** Impuesto de esa comisión. Cero si el creador es extranjero y aplica exportación. */
  ivaComision: number;
  isrRetenido: number;
  ivaRetenido: number;
  /**
   * 🧾 IVA mexicano que el creador cobró a sus compradores en el mes.
   *
   * 🚨 ENTRA AL NETO DEL COMPROBANTE. Ese dinero llegó con el cobro, por encima del precio,
   *    y de él sale `ivaRetenido`. Restar la retención sin sumar el IVA daría un neto menor
   *    que el depositado — el mismo descuadre que tenía el retiro hasta el 2026-08-30.
   */
  mxVatVenta: number;
  /** Residencia con la que se calcularon. Decide qué documentos tocan. */
  residency: "MX" | "FOREIGN";
  /**
   * 💱 Los mismos importes, en PESOS.
   *
   * Cada venta trae su propio tipo de cambio congelado del día en que ocurrió, así que aquí
   * no se convierte nada: se suman pesos ya convertidos. Es lo que permite que un CFDI que
   * cubre un mes entero no dependa de una sola tasa — que sería falsa para casi todos los días
   * que abarca.
   */
  baseMxn: number;
  comisionMxn: number;
  ivaComisionMxn: number;
  /** Ventas del mes que aún no tienen pesos congelados. Las recoge el backfill. */
  ventasSinPesos: number;
};

type AsientoConRetenciones = {
  status?: string;
  grossAmount?: number;
  /** Los pesos de la venta, congelados el día que ocurrió. Ver facturacion/importeFiscal.ts. */
  fiscalMxn?: unknown;
  occurredAt?: admin.firestore.Timestamp | null;
  createdAt?: admin.firestore.Timestamp | null;
  retenciones?: {
    comision?: number;
    ivaComision?: number;
    isrRetenido?: number;
    ivaRetenido?: number;
    mxVatVenta?: number;
    residency?: "MX" | "FOREIGN";
  };
};

/**
 * 🇲🇽 Huso horario del centro de México, en horas detrás de UTC.
 *
 * ⚠️ **Es un desfase FIJO a propósito.** México eliminó el horario de verano en 2022 (Ley de
 * los Husos Horarios), así que el centro del país es UTC-6 todo el año. Sin el ajuste, los
 * periodos se cortaban en medianoche UTC — las 18:00 de aquí — y una venta de la tarde acababa
 * documentada en el día siguiente (AUD-2).
 *
 * 🔁 Si México reinstaurara el horario de verano, esto deja de valer y hay que usar una
 * biblioteca de husos.
 */
const HORAS_TRAS_UTC_MX = 6;

/** Las partes de una fecha civil mexicana. */
function partesEnMexico(fecha: Date): { a: number; m: number; d: number } {
  const local = new Date(fecha.getTime() - HORAS_TRAS_UTC_MX * 3_600_000);
  return { a: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}

/** El instante en que empieza un día civil mexicano. */
function inicioDeDiaMx(a: number, m: number, d: number): Date {
  return new Date(Date.UTC(a, m - 1, d, HORAS_TRAS_UTC_MX, 0, 0));
}

/** `YYYY-MM` de una fecha, en hora de México. */
export function periodoDe(fecha: Date): string {
  const { a, m } = partesEnMexico(fecha);
  return `${a}-${String(m).padStart(2, "0")}`;
}

/**
 * Primer y último instante de un periodo.
 *
 * Entiende dos formas, y la longitud decide cuál:
 *
 * - `YYYY-MM` — un mes natural. Es lo de la comisión y la constancia de retenciones, que son
 *   periódicas por naturaleza y se agregan por mes.
 * - `YYYY-MM-DD` — un día. Es lo de la **factura global**, que desde §A1 se emite a diario
 *   para caber en el plazo de 24 horas de la RMF 2026 (regla 2.7.1.21).
 *
 * 🇲🇽 Los cortes son en **hora de México**, no UTC. Un periodo fiscal mexicano se mide con el
 * calendario mexicano; cortar en medianoche UTC metía las ventas de la tarde en el día
 * siguiente (AUD-2).
 */
export function rangoDelPeriodo(periodo: string): { desde: Date; hasta: Date } {
  const [a, m, d] = periodo.split("-").map(Number);
  if (!a || !m) throw new Error(`Periodo inválido: ${periodo}`);
  if (d) {
    return { desde: inicioDeDiaMx(a, m, d), hasta: inicioDeDiaMx(a, m, d + 1) };
  }
  return { desde: inicioDeDiaMx(a, m, 1), hasta: inicioDeDiaMx(a, m + 1, 1) };
}

/** `YYYY-MM-DD` de una fecha, en hora de México. El periodo de una factura global. */
export function diaDe(fecha: Date): string {
  const { a, m, d } = partesEnMexico(fecha);
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Suma las retenciones y la comisión de un creador en un mes.
 *
 * Solo cuenta asientos **ganados**: lo pendiente todavía puede rechazarse, y una constancia de
 * retenciones sobre dinero que después se devuelve obliga a cancelarla y reemitirla.
 *
 * Función PURA sobre los documentos que recibe, para poder probarla sin Firestore.
 */
export function acumularMes(
  creatorId: string,
  periodo: string,
  asientos: AsientoConRetenciones[]
): AcumuladoMensual {
  const acc: AcumuladoMensual = {
    creatorId,
    periodo,
    ventas: 0,
    base: 0,
    comision: 0,
    ivaComision: 0,
    isrRetenido: 0,
    ivaRetenido: 0,
    mxVatVenta: 0,
    residency: "MX",
    baseMxn: 0,
    comisionMxn: 0,
    ivaComisionMxn: 0,
    ventasSinPesos: 0,
  };

  for (const a of asientos) {
    if (a.status !== "earned") continue;
    const r = a.retenciones;
    if (!r) continue;
    acc.ventas += 1;
    acc.base = round2(acc.base + (a.grossAmount ?? 0));
    acc.comision = round2(acc.comision + (r.comision ?? 0));
    acc.ivaComision = round2(acc.ivaComision + (r.ivaComision ?? 0));
    acc.isrRetenido = round2(acc.isrRetenido + (r.isrRetenido ?? 0));
    acc.ivaRetenido = round2(acc.ivaRetenido + (r.ivaRetenido ?? 0));
    acc.mxVatVenta = round2(acc.mxVatVenta + (r.mxVatVenta ?? 0));

    /**
     * 💱 Los pesos de esta venta. El tipo de cambio es el suyo, congelado el día que ocurrió.
     *
     * 🚨 Una venta sin congelar NO se convierte aquí con una tasa de hoy: se cuenta aparte.
     *    Meterle la tasa de otro día a una venta vieja es exactamente el error que este
     *    bloque vino a arreglar.
     */
    const pesos = leerImporteFiscal(a.fiscalMxn);
    if (pesos) {
      acc.baseMxn = round2(acc.baseMxn + pesos.base);
      acc.comisionMxn = round2(acc.comisionMxn + (r.comision ?? 0) * pesos.tipoCambio);
      acc.ivaComisionMxn = round2(acc.ivaComisionMxn + (r.ivaComision ?? 0) * pesos.tipoCambio);
    } else {
      acc.ventasSinPesos += 1;
    }
    // La residencia viene congelada en el asiento. Si un creador cambió de residencia a mitad
    // de mes, manda la de la última venta: el mes se documenta con una sola.
    if (r.residency) acc.residency = r.residency;
  }

  return acc;
}

/**
 * Convierte los asientos de un periodo en el detalle que exige el complemento.
 *
 * Un nodo por operación, con su fecha y sus pesos congelados. Se saltan las ventas que no
 * tengan importe congelado: sin él no hay pesos que declarar, y aproximar en un CFDI es lo que
 * §A0 vino a prohibir. Que falte una es visible en `ventasSinPesos` del acumulado.
 *
 * Función PURA sobre los asientos, para poder probarla sin Firestore.
 */
export function serviciosDelPeriodo(asientos: AsientoConRetenciones[]): ServicioDelComplemento[] {
  const out: ServicioDelComplemento[] = [];
  for (const a of asientos) {
    if (a.status !== "earned") continue;
    const r = a.retenciones;
    if (!r) continue;
    const pesos = leerImporteFiscal(a.fiscalMxn);
    if (!pesos) continue;

    const cuando = a.occurredAt ?? a.createdAt;
    const fecha = cuando?.toDate?.();
    if (!fecha) continue; // sin fecha no hay `FechaServ`, que es obligatorio

    out.push({
      fecha: diaDe(fecha),
      precioSinIva: pesos.base,
      ivaTrasladado: pesos.iva,
      // La comisión de ESA venta, en pesos, con el tipo de cambio congelado de ESA venta.
      comision: round2((r.comision ?? 0) * pesos.tipoCambio),
      ivaComision: round2((r.ivaComision ?? 0) * pesos.tipoCambio),
    });
  }
  return out;
}

/** Qué documentos toca emitir para un acumulado. */
export function documentosDelMes(acc: AcumuladoMensual): {
  comision: boolean;
  retenciones: boolean;
  liquidacion: boolean;
} {
  const hayComision = acc.comision > 0;
  // La constancia existe siempre que haya retención mexicana, **incluso al creador
  // extranjero**: el SAT contempla receptor extranjero con su identificación fiscal.
  const hayRetencion = requiereCfdiRetenciones({
    isrRetenido: acc.isrRetenido,
    ivaRetenido: acc.ivaRetenido,
  } as Parameters<typeof requiereCfdiRetenciones>[0]);

  return {
    comision: hayComision,
    retenciones: hayRetencion,
    // Sin ninguna retención mexicana el tercer documento no es un CFDI, es un
    // comprobante de liquidación. Es el caso extranjero-extranjero.
    liquidacion: hayComision && !hayRetencion,
  };
}

/** Lee los asientos ganados de un creador en un periodo. */
export async function asientosDelMes(
  creatorId: string,
  periodo: string
): Promise<AsientoConRetenciones[]> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const snap = await db
    .collection("users")
    .doc(creatorId)
    .collection("walletLedger")
    .where("occurredAt", ">=", admin.firestore.Timestamp.fromDate(desde))
    .where("occurredAt", "<", admin.firestore.Timestamp.fromDate(hasta))
    .get();
  return snap.docs.map((d) => d.data() as AsientoConRetenciones);
}

type FacturapiDoc = { id: string; uuid?: string; total?: number };
type FacturapiCustomer = { id?: string };

/**
 * Da de alta al CREADOR como cliente en la organización de VIBRA.
 *
 * ⚠️ EL EMISOR DE ESTOS DOS DOCUMENTOS ES VIBRA, así que el creador es el RECEPTOR y tiene que
 * existir como cliente en la organización de ella. Los clientes de Facturapi son POR
 * ORGANIZACIÓN: que el creador tenga la suya propia —donde él emite sus ventas— no lo hace
 * existir en la de Vibra.
 *
 * 🚨 ESTO NO EXISTÍA. `facturapiCustomerIdVibra` se LEÍA en el proceso mensual y no lo escribía
 *    nadie, así que la comisión y la constancia **nunca podrían haberse emitido**: el proceso
 *    contaba un error por cada documento y seguía. Salió a la luz el 2026-09-03, al timbrar de
 *    verdad por primera vez.
 *
 * Se guarda el id para no repetir el alta cada mes.
 */
export async function asegurarCreadorEnOrgDeVibra(
  creatorId: string,
  perfil: admin.firestore.DocumentData
): Promise<string> {
  const previo = String(perfil.facturapiCustomerIdVibra ?? "").trim();
  if (previo) return previo;

  const taxId = String(perfil.taxId ?? "").trim().toUpperCase();
  const legalName = String(perfil.legalName ?? "").trim();
  const taxSystem = String(perfil.taxSystem ?? "").trim();
  const zip = String(perfil.zip ?? "").trim();
  if (!taxId || !legalName || !taxSystem || !zip) {
    // Sin datos fiscales no hay receptor posible. Se dice qué falta, no «error genérico».
    const faltan = [
      !taxId && "RFC",
      !legalName && "razón social",
      !taxSystem && "régimen fiscal",
      !zip && "código postal",
    ].filter(Boolean);
    throw new Error(`al creador le faltan datos fiscales: ${faltan.join(", ")}`);
  }

  const email = String(perfil.email ?? "").trim();
  const res = await facturapiFetch<FacturapiCustomer>("/customers", {
    method: "POST",
    body: {
      legal_name: legalName,
      tax_id: taxId,
      tax_system: taxSystem,
      address: { zip },
      ...(email ? { email } : {}),
    },
    auth: "secret", // 👈 la organización de VIBRA: el emisor es ella.
  });
  if (!res.ok || !res.data?.id) {
    throw new Error(`alta del creador en la org de Vibra falló: ${String(res.ok ? "" : res.error).slice(0, 200)}`);
  }

  await db.doc(`creatorTaxProfiles/${creatorId}`).set(
    { facturapiCustomerIdVibra: res.data.id },
    { merge: true }
  );
  logger.info("creador_alta_en_org_vibra", { creatorId, customerId: res.data.id });
  return res.data.id;
}

/**
 * Resumen mínimo que acompaña a un documento registrado.
 *
 * Se declara aquí, y no se importa `ResumenGlobal` de `globalInvoice.ts`, porque ese módulo ya
 * importa de este: traerlo de vuelta crearía un ciclo.
 */
export type ResumenDeDocumento = {
  creatorId: string;
  periodo: string;
  ventas: number;
  base: number;
};


/**
 * Emite el CFDI de la COMISIÓN del mes. Emisor Vibra, receptor el creador.
 *
 * El impuesto va **por encima** de la comisión, nunca dentro: `tax_included: false`. Si fuera
 * dentro, la comisión efectiva de Vibra caería del 25% al 21.55% y absorbería un impuesto que
 * no puede acreditar.
 *
 * 💱 **Va en PESOS** (`comisionMxn`), no en los dólares del ledger. Antes mandaba `acc.comision`
 * —dólares— con `currency: "MXN"`, y una comisión de 100 USD se habría timbrado como $100 MXN.
 *
 * Y no lleva `TipoCambio` en dólares porque **no tenemos fuente del FIX de Banxico**:
 * `config/exchangeRates` sale de una API pública gratuita, no del DOF. Cada venta ya trajo su
 * tipo de cambio real del cobro, así que aquí solo se suman pesos. Ver `pendientesimpuestos.md`
 * §A0.
 */
export async function emitirCfdiComision(
  acc: AcumuladoMensual,
  customerId: string
): Promise<FacturapiDoc> {
  const llevaImpuesto = acc.ivaComision > 0;
  /**
   * 🚨 Sin pesos no se timbra. Si alguna venta del mes no tiene su importe congelado, la
   *    comisión en pesos está incompleta y el CFDI saldría corto. Corto es tan falso como
   *    largo, y el backfill existe justo para que esto no pase.
   */
  if (acc.ventasSinPesos > 0) {
    throw new Error(
      `comisión sin pesos congelados: ${acc.ventasSinPesos} de ${acc.ventas} ventas de ${acc.periodo}`
    );
  }
  const res = await facturapiFetch<FacturapiDoc>("/invoices", {
    method: "POST",
    body: {
      customer: customerId,
      items: [
        {
          quantity: 1,
          product: {
            description: `Comisión por servicios de intermediación · ${acc.periodo}`,
            // 🔁 FISCALISTA: clave de producto/servicio de la comisión de intermediación.
            product_key: "80141600",
            unit_key: "E48",
            price: acc.comisionMxn,
            tax_included: false,
            taxes: llevaImpuesto
              ? [{ type: "IVA", rate: 0.16, factor: "Tasa" }]
              : // Creador extranjero: exportación de mediación a tasa 0%.
                [{ type: "IVA", rate: 0, factor: "Tasa" }],
          },
        },
      ],
      use: "G03",
      payment_form: "17", // Compensación: se descuenta del saldo, no se cobra aparte.
      payment_method: "PUE",
      currency: "MXN",
    },
    auth: "secret", // 👈 organización de VIBRA: el emisor es ella.
  });
  if (!res.ok) throw new Error(`CFDI de comisión falló: ${String(res.error).slice(0, 200)}`);
  return res.data;
}

/**
 * Emite el CFDI de RETENCIONES del mes. Emisor Vibra, receptor el creador.
 *
 * Va por un recurso distinto del de facturas (`/retentions`): el comprobante de retenciones e
 * información de pagos es otro tipo de CFDI, no una factura con impuestos negativos.
 *
 * ⚠️ El receptor puede ser EXTRANJERO. Es el caso del creador de fuera que vende a comprador
 * mexicano: se le retiene el 100% del IVA y hay que entregarle su constancia.
 *
 * ✅ **DESBLOQUEADA (§A5, 2026-09-03).** Estuvo cerrada mientras la retención se aplicaba en el
 * RETIRO y esta constancia se armaba desde las VENTAS: documentaba algo que quizá no había
 * ocurrido. Al mover la retención a la venta, las dos cosas pasan en el mismo momento y el
 * documento vuelve a decir la verdad.
 *
 * El único gate que queda es `TIMBRAR`, como para todos los demás comprobantes.
 */
export async function emitirCfdiRetenciones(
  acc: AcumuladoMensual,
  customerId: string,
  /** El detalle operación por operación, que el complemento exige. */
  servicios: ServicioDelComplemento[]
): Promise<FacturapiDoc> {
  const { desde, hasta } = rangoDelPeriodo(acc.periodo);
  const totalRetenido = round2(acc.isrRetenido + acc.ivaRetenido);

  /**
   * 🚨 El complemento exige un nodo POR SERVICIO, no solo totales.
   *
   * Si el periodo no trae detalle no se timbra: un complemento sin sus nodos `Servicios` no
   * es válido, y mandarlo vacío sería gastar un folio en algo que el SAT va a rechazar.
   */
  if (servicios.length === 0) {
    throw new Error(
      `constancia sin detalle de servicios (creador ${acc.creatorId}, ${acc.periodo})`
    );
  }
  const complemento = armarComplemento(servicios, {
    iva: acc.ivaRetenido,
    isr: acc.isrRetenido,
  });

  const res = await facturapiFetch<FacturapiDoc>("/retentions", {
    method: "POST",
    body: {
      customer: customerId,
      /**
       * ✅ CLAVE `26` — «Servicios de Plataformas Tecnológicas» (§A4, 2026-09-02).
       *
       * Era `14`, «dividendos o utilidades distribuidas», que no describe nada de lo que pasa
       * aquí: Vibra no reparte dividendos, le retiene ISR e IVA al creador por vender a través
       * de la plataforma.
       *
       * 🚨 La clave y el complemento son INSEPARABLES. La regla de validación del SAT dice que
       *    si `CveRetenc` es distinto de 26 el complemento no debe existir — y a la inversa,
       *    con la 26 el complemento es obligatorio. Por eso los dos cambios van juntos y no se
       *    puede tocar solo el número.
       */
      key: CVE_RETENC_PLATAFORMAS,
      period: {
        month_from: desde.getUTCMonth() + 1,
        month_to: hasta.getUTCMonth() || 12,
        year: desde.getUTCFullYear(),
      },
      totals: {
        // 💱 En PESOS, no en los dólares del ledger. Ver §A0.
        total_base: acc.baseMxn,
        total_retained: totalRetenido,
        taxes: [
          ...(acc.isrRetenido > 0
            ? [{ base: acc.baseMxn, type: "ISR", amount: acc.isrRetenido }]
            : []),
          ...(acc.ivaRetenido > 0
            ? [{ base: acc.baseMxn, type: "IVA", amount: acc.ivaRetenido }]
            : []),
        ],
      },
      /**
       * 🔁 FACTURAPI: el nombre del tipo de complemento está por confirmar contra su API. Si
       * fuera otro, el primer intento en sandbox falla ruidosamente y es una línea.
       */
      complements: [{ type: "plataformas_tecnologicas", data: complemento }],
    },
    auth: "secret",
  });
  if (!res.ok) throw new Error(`CFDI de retenciones falló: ${String(res.error).slice(0, 200)}`);
  return res.data;
}

/**
 * Deja constancia de lo emitido, para no emitir dos veces el mismo mes.
 *
 * La idempotencia es por `{creatorId}_{periodo}_{tipo}`: si el proceso mensual se reintenta,
 * un mes ya documentado se salta en vez de duplicar comprobantes fiscales.
 */
export async function registrarDocumento(params: {
  creatorId: string;
  periodo: string;
  tipo: "comision" | "retenciones" | "liquidacion" | "global";
  facturapiId: string | null;
  uuid: string | null;
  /**
   * Lo que resume el documento. No es lo mismo en los cuatro:
   *
   * - Comisión, retenciones y liquidación llevan el `AcumuladoMensual` del creador.
   * - La factura GLOBAL lleva su propio resumen del día (§A1), que agrupa ventas de
   *   compradores distintos y no tiene comisión ni retenciones que contar.
   *
   * Se guarda tal cual para poder explicar un comprobante viejo sin recalcular nada.
   */
  acumulado: AcumuladoMensual | ResumenDeDocumento;
}): Promise<void> {
  const id = `${params.creatorId}_${params.periodo}_${params.tipo}`;
  await db
    .collection("creatorMonthlyDocs")
    .doc(id)
    .set(
      {
        creatorId: params.creatorId,
        periodo: params.periodo,
        tipo: params.tipo,
        facturapiId: params.facturapiId,
        uuid: params.uuid,
        /**
         * 🚧 ¿Se timbró de verdad, o solo se calculó con `TIMBRAR` apagado?
         *
         * Sin esta distinción el registro miente: decía «emitido» de un mes en el que no se
         * mandó nada al SAT. Un CFDI existe cuando tiene folio.
         */
        timbrado: params.facturapiId !== null,
        acumulado: params.acumulado,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  logger.info("creator_monthly_doc", { id, uuid: params.uuid });
}

/**
 * ¿Ya se emitió este documento para ese creador y mes?
 *
 * 🚨 «Emitido» significa **timbrado**, no «registrado».
 *
 * Antes bastaba con que el registro existiera, y el proceso lo escribe también con `TIMBRAR`
 * apagado. Cada pasada en falso daba el mes por hecho, así que **el día que se encendiera el
 * interruptor, todos los meses ya «procesados» se habrían saltado para siempre** — meses enteros
 * de ventas sin documentar y sin forma de notarlo.
 *
 * El comprobante de liquidación es la excepción: no es un CFDI, no se timbra, y para él existir
 * sí es haberse emitido.
 */
export async function yaEmitido(
  creatorId: string,
  periodo: string,
  tipo: "comision" | "retenciones" | "liquidacion" | "global"
): Promise<boolean> {
  const snap = await db
    .collection("creatorMonthlyDocs")
    .doc(`${creatorId}_${periodo}_${tipo}`)
    .get();
  if (!snap.exists) return false;
  if (tipo === "liquidacion") return true;
  return snap.get("timbrado") === true;
}
