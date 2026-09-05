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
import { fixParaOperacion } from "./tipoCambioDof";
import {
  armarComplemento,
  complementoComoXml,
  NS_PLATAFORMAS,
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
  /**
   * 🧾 Cargo fijo + 2% de conversión del mes, que Vibra refactura al creador.
   *
   * Van como conceptos APARTE en el CFDI de comisión, no sumados al 25%: son servicios
   * distintos —conversión de divisa y gestión de cobro— y el creador tiene derecho a ver qué
   * le cobraron por cada cosa.
   */
  cargos: number;
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
    /** Cargo fijo + 2% de conversión refacturados. Ausente en asientos anteriores al 2026-09-04. */
    cargos?: number;
    /** Lo que el creador facturó por la venta: su precio más los cargos. */
    ingresoFacturable?: number;
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

/**
 * Último día de un periodo `YYYY-MM`, en `YYYY-MM-DD`.
 *
 * Es la fecha de la operación para un comprobante que cubre un mes: la obligación nace al
 * cerrarlo. De ahí sale el tipo de cambio que le toca.
 */
export function finDelPeriodo(periodo: string): string {
  const { hasta } = rangoDelPeriodo(periodo);
  const ultimo = new Date(hasta.getTime() - 24 * 3_600_000);
  return diaDe(ultimo);
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
    cargos: 0,
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
    acc.cargos = round2(acc.cargos + (r.cargos ?? 0));
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
 * Un nodo por operación, con su fecha y sus importes EN PESOS. La constancia documenta una
 * obligación en pesos —la retención se entera al SAT en pesos— así que aquí todo se convierte.
 *
 * ⚠️ QUÉ TIPO DE CAMBIO SE USA, Y POR QUÉ NO SIEMPRE EL MISMO
 *
 * - Venta a comprador MEXICANO: los pesos que de verdad se cobraron (`fiscalMxn`). Ahí no hay
 *   nada que convertir, la operación ocurrió en pesos.
 * - Venta de EXPORTACIÓN: el comprador pagó en su moneda y no existe operación en pesos, así
 *   que se convierte con el **FIX de Banxico** del día hábil anterior a la venta, que es lo
 *   que manda el artículo 20 del CFF.
 *
 * Las dos son defendibles y cada una lo es por su motivo. Lo que no sería defendible es usar
 * una tasa de una API cualquiera, ni saltarse las de exportación —que fue lo que bloqueó este
 * documento hasta el 2026-09-03—: **el ISR se retiene sobre TODAS las ventas**, también las
 * exportadas, y omitirlas dejaría la base corta.
 *
 * 🔁 FISCALISTA: que la misma venta pueda valer pesos distintos en la factura global (tasa del
 * cobro) y en la constancia (FIX) es correcto por separado, pero conviene que lo confirme.
 */
export async function serviciosDelPeriodo(
  asientos: AsientoConRetenciones[],
  /**
   * De dónde sale el tipo de cambio de las ventas de exportación.
   *
   * Se inyecta para poder probar esta función sin salir a la red: una prueba que depende de
   * que Banxico esté en pie no prueba lo que dice probar, y falla los días que no debería.
   */
  tipoDeCambio: (dia: string) => Promise<number> = async (dia) =>
    (await fixParaOperacion(dia)).tasa
): Promise<ServicioDelComplemento[]> {
  const out: ServicioDelComplemento[] = [];
  for (const a of asientos) {
    if (a.status !== "earned") continue;
    const r = a.retenciones;
    if (!r) continue;

    const cuando = a.occurredAt ?? a.createdAt;
    const fecha = cuando?.toDate?.();
    if (!fecha) continue; // sin fecha no hay `FechaServ`, que es obligatorio
    const dia = diaDe(fecha);

    const pesos = leerImporteFiscal(a.fiscalMxn);
    // Con pesos congelados, ésa es la tasa de esa venta. Sin ellos —exportación— el FIX.
    const tasa = pesos ? pesos.tipoCambio : await tipoDeCambio(dia);
    /**
     * 🧾 Lo que el creador FACTURÓ, que incluye el cargo fijo y el 2% de conversión.
     *
     * `fiscalMxn` ya viene congelado con ese total desde el 2026-09-04. Para las ventas de
     * exportación, que no tienen pesos congelados, se reconstruye con `ingresoFacturable`; un
     * asiento anterior no lo trae y cae a `grossAmount`, que era el comportamiento de entonces.
     */
    const facturable = r.ingresoFacturable ?? a.grossAmount ?? 0;
    const base = pesos ? pesos.base : round2(facturable * tasa);
    const iva = pesos ? pesos.iva : 0; // exportación a 0%: no hubo IVA que trasladar

    out.push({
      fecha: dia,
      precioSinIva: base,
      ivaTrasladado: iva,
      /**
       * `ComisionDelServicio` documenta lo que la PLATAFORMA cobró por esa operación. No es
       * solo el 25%: también la conversión de divisa y la gestión de cobro, que Vibra le
       * refactura al creador en el mismo comprobante.
       */
      comision: round2(((r.comision ?? 0) + (r.cargos ?? 0)) * tasa),
      ivaComision: round2((r.ivaComision ?? 0) * tasa),
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
   * 💵 VA EN DÓLARES, con el tipo de cambio oficial.
   *
   * La comisión está denominada en dólares —el ledger lo está— y se cobra sobre TODAS las
   * ventas, también las de exportación. Ésas nunca tocaron un peso, así que no hay tipo de
   * cambio real que despejar de su cobro y convertirlas una por una es imposible.
   *
   * Emitir en USD con `TipoCambio` resuelve el problema de raíz: no se convierte nada, se
   * declara la moneda de la operación y la tasa oficial del artículo 20 del CFF.
   *
   * ⚠️ Esto revierte lo que §A0 decidió. Allí se eligió emitirla en pesos «porque cada venta
   * trae su tasa real», sin ver que las de exportación no la traen. El error se descubrió al
   * timbrar de verdad, el 2026-09-03.
   */
  const { tasa, fechaTasa } = await fixParaOperacion(finDelPeriodo(acc.periodo));

  /** El mismo tratamiento para los tres conceptos: los presta Vibra al mismo creador. */
  const impuestoDelConcepto = llevaImpuesto
    ? [{ type: "IVA", rate: 0.16, factor: "Tasa" }]
    : // Creador extranjero: exportación de mediación a tasa 0%.
      [{ type: "IVA", rate: 0, factor: "Tasa" }];
  const res = await facturapiFetch<FacturapiDoc>("/invoices", {
    method: "POST",
    body: {
      customer: customerId,
      /**
       * 🧾 TRES conceptos, no uno.
       *
       * El creador factura su venta en un solo concepto —para él todo es su precio— y aquí se
       * le desglosa qué le cobró Vibra por cada cosa: la intermediación, la conversión de
       * divisa y la gestión de cobro. Los dos últimos son el cargo fijo y el 2% que paga el
       * comprador y que desde el 2026-09-04 viajan dentro de lo que el creador factura.
       *
       * Se desglosan porque **son servicios distintos**. Sumarlos al 25% haría parecer que la
       * comisión es mayor de lo pactado y rompería la lectura del 75/25.
       */
      items: [
        {
          quantity: 1,
          product: {
            description: `Comisión por servicios de intermediación · ${acc.periodo}`,
            /*
             * ✅ Confirmada contra la guía de claves sugeridas del SAT para servicios de
             * comisión, que además dice que sirve «indistintamente del origen de la comisión
             * que percibas». La unidad `E48` es la que esa misma guía indica.
             */
            product_key: "80141600",
            unit_key: "E48",
            price: acc.comision, // 💵 en dólares; la moneda del comprobante es USD
            tax_included: false,
            taxes: impuestoDelConcepto,
          },
        },
        /*
         * Solo si hubo. Un asiento anterior al 2026-09-04 no trae cargos, y un concepto de
         * cero no aporta nada al comprobante.
         */
        ...(acc.cargos > 0
          ? [
              {
                quantity: 1,
                product: {
                  description:
                    `Conversión de divisa y gestión de cobro · ${acc.periodo}`,
                  /*
                   * 🔁 FISCALISTA: `84121500`, servicios bancarios y de procesamiento de pagos.
                   * Describe lo que se cobra —convertir la moneda del comprador y gestionar el
                   * cobro— mejor que la clave de comisión, que es de promoción de ventas.
                   */
                  product_key: "84121500",
                  unit_key: "E48",
                  price: acc.cargos,
                  tax_included: false,
                  taxes: impuestoDelConcepto,
                },
              },
            ]
          : []),
      ],
      use: "G03",
      payment_form: "17", // Compensación: se descuenta del saldo, no se cobra aparte.
      payment_method: "PUE",
      currency: "USD",
      /**
       * 🔁 FACTURAPI: el nombre del campo del tipo de cambio está por confirmar en el primer
       * timbrado. Su vocabulario no es el del SAT —lo aprendimos con `global.periodicity`— así
       * que `exchange` es lo que dice su documentación, no una traducción del Anexo 20.
       */
      exchange: tasa,
    },
    auth: "secret", // 👈 organización de VIBRA: el emisor es ella.
  });
  if (!res.ok) throw new Error(`CFDI de comisión falló: ${String(res.error).slice(0, 200)}`);
  logger.info("cfdi_comision", { creatorId: acc.creatorId, periodo: acc.periodo, tasa, fechaTasa });
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
  const { desde } = rangoDelPeriodo(acc.periodo);

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
  /**
   * 💱 Las retenciones vienen en DÓLARES del motor fiscal y este documento va en pesos.
   *
   * Se convierten con el FIX del cierre del periodo, la misma tasa oficial que usa el CFDI de
   * comisión. Es una obligación en pesos —lo retenido se entera al SAT en pesos— así que aquí
   * no cabe emitir en dólares como en la comisión.
   */
  const { tasa: tasaRet } = await fixParaOperacion(finDelPeriodo(acc.periodo));

  const complemento = armarComplemento(servicios, {
    iva: round2(acc.ivaRetenido * tasaRet),
    isr: round2(acc.isrRetenido * tasaRet),
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
      cve_retenc: CVE_RETENC_PLATAFORMAS,
      /**
       * 🚨 EL OBJETO DE RETENCIONES DE FACTURAPI VA EN ESPAÑOL, y las facturas en inglés.
       *
       * Aquí se mandaba `key`, `period` y `totals` —como en `/invoices`— y devolvía 400: «El
       * campo cve_retenc es requerido». No es un capricho de nombres: la forma también cambia,
       * con `imp_retenidos` en vez de una lista de impuestos.
       *
       * Es la tercera vez que el vocabulario de Facturapi muerde en esta integración. Ver la
       * nota de `global.periodicity` en `globalInvoice.ts`.
       */
      periodo: {
        mes_ini: desde.getUTCMonth() + 1,
        mes_fin: desde.getUTCMonth() + 1,
        ejerc: desde.getUTCFullYear(),
      },
      totales: {
        /*
         * 💱 En PESOS, y tomado TAL CUAL del complemento.
         *
         * 🚨 Es el total SIN IVA, no la suma de base más impuesto. La regla de validación del
         *    SAT es literal, «el valor de este atributo debe ser igual al valor registrado en
         *    el atributo MonTotServSIVA». Antes se mandaba base + IVA, que es lo que dicta la
         *    intuición y lo que el SAT rechaza.
         */
        monto_tot_operacion: complemento.MonTotServSIVA,
        /**
         * Cero, y no es lo mismo que las exportaciones.
         *
         * Una venta a comprador extranjero va a **tasa 0%**, que no es «exenta»: el IVA existe
         * y vale cero. Meterlas aquí las declararía como operaciones sin impuesto, que es otra
         * figura y otro tratamiento.
         */
        monto_tot_exent: 0,
        imp_retenidos: [
          ...(acc.isrRetenido > 0
            ? [{
                monto_ret: round2(acc.isrRetenido * tasaRet),
                /*
                 * 🚨 LAS DOS BASES SON DISTINTAS, Y NINGUNA ES «la base de la venta».
                 *
                 * El SAT las valida con dos reglas separadas. La del ISR es «BaseRet debe ser
                 * igual a montoTotOperacion», o sea el total sin IVA. La del IVA es «BaseRet
                 * debe ser igual a la suma de los Importe del nodo
                 * ImpuestosTrasladadosdelServicio», o sea el IVA trasladado, no la venta.
                 *
                 * Se mandaba la base de la venta en las dos. Coincidía con la del ISR por
                 * casualidad y era falsa en la del IVA.
                 */
                base_ret: complemento.MonTotServSIVA,
                /*
                 * 🚨 `04`, no `02`. El catálogo `c_TipoPagoRet` es 01 IVA definitivo, 02 IEPS
                 * definitivo, 03 ISR plataformas DEFINITIVO y 04 ISR PROVISIONAL. Mandábamos
                 * `02`, que declara un pago de IEPS, un impuesto que Vibra no retiene.
                 *
                 * 🔁 FISCALISTA: se manda `04` porque la retención del 113-A es provisional
                 * salvo que el creador opte por el pago definitivo del 113-B. Vibra no sabe
                 * quién optó; si hubiera que distinguirlo, el valor sería `03` para esos.
                 */
                tipo_pago_ret: "04",
                impuesto: "ISR",
              }]
            : []),
          ...(acc.ivaRetenido > 0
            ? [{
                monto_ret: round2(acc.ivaRetenido * tasaRet),
                /* La base del IVA retenido es el IVA TRASLADADO, no la venta. Ver arriba. */
                base_ret: complemento.TotalIVATrasladado,
                // 🔁 FISCALISTA: la retención de IVA es pago DEFINITIVO. `01` en el catálogo.
                tipo_pago_ret: "01",
                impuesto: "IVA",
              }]
            : []),
        ],
      },
      /**
       * 🚨 EL COMPLEMENTO VA COMO XML, NO COMO OBJETO.
       *
       * Facturapi tiene tipos con nombre para siete complementos de retenciones —dividendos,
       * intereses, premios, fideicomisos, arrendamiento en fideicomiso, planes de retiro y
       * enajenación de acciones— y **plataformas tecnológicas no es ninguno de ellos**. Mandarle
       * `{ type, data }` devolvía «El campo complements.0 tiene un tipo inválido».
       *
       * Su documentación describe la salida para cualquier complemento sin tipo propio: meter
       * el XML en este nodo, que se inserta tal cual al timbrar. Se arma en
       * `complementoPlataformas.ts`, donde los nombres sí son los del Anexo 20.
       */
      complements: [complementoComoXml(complemento)],
      /**
       * 🚨 SIN ESTO EL COMPLEMENTO NO TIMBRA, POR BIEN FORMADO QUE ESTÉ.
       *
       * El PAC valida el complemento con `processContents="strict"`, o sea que necesita el
       * esquema de su espacio de nombres. Y lo busca en el `xsi:schemaLocation` del nodo RAÍZ
       * `retenciones:Retenciones`, no dentro del complemento. Esa raíz la construye Facturapi,
       * así que declararlo en nuestro XML no servía de nada: el PAC devolvía
       * `cvc-complex-type.2.4.c: no declaration can be found for element`.
       *
       * Este campo existe precisamente para eso, «namespaces to insert in the root node», y
       * está en su especificación OpenAPI aunque su guía de complementos no lo mencione.
       */
      namespaces: [NS_PLATAFORMAS],
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
