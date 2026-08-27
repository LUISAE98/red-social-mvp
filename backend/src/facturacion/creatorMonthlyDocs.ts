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
  /** Residencia con la que se calcularon. Decide qué documentos tocan. */
  residency: "MX" | "FOREIGN";
};

type AsientoConRetenciones = {
  status?: string;
  grossAmount?: number;
  occurredAt?: admin.firestore.Timestamp | null;
  createdAt?: admin.firestore.Timestamp | null;
  retenciones?: {
    comision?: number;
    ivaComision?: number;
    isrRetenido?: number;
    ivaRetenido?: number;
    residency?: "MX" | "FOREIGN";
  };
};

/** `YYYY-MM` de una fecha, en UTC. */
export function periodoDe(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Primer y último instante de un periodo `YYYY-MM`. */
export function rangoDelPeriodo(periodo: string): { desde: Date; hasta: Date } {
  const [a, m] = periodo.split("-").map(Number);
  if (!a || !m) throw new Error(`Periodo inválido: ${periodo}`);
  return {
    desde: new Date(Date.UTC(a, m - 1, 1, 0, 0, 0)),
    hasta: new Date(Date.UTC(a, m, 1, 0, 0, 0)),
  };
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
    residency: "MX",
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
    // La residencia viene congelada en el asiento. Si un creador cambió de residencia a mitad
    // de mes, manda la de la última venta: el mes se documenta con una sola.
    if (r.residency) acc.residency = r.residency;
  }

  return acc;
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

/**
 * Emite el CFDI de la COMISIÓN del mes. Emisor Vibra, receptor el creador.
 *
 * El impuesto va **por encima** de la comisión, nunca dentro: `tax_included: false`. Si fuera
 * dentro, la comisión efectiva de Vibra caería del 25% al 21.55% y absorbería un impuesto que
 * no puede acreditar.
 */
export async function emitirCfdiComision(
  acc: AcumuladoMensual,
  customerId: string
): Promise<FacturapiDoc> {
  const llevaImpuesto = acc.ivaComision > 0;
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
            price: acc.comision,
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
 */
export async function emitirCfdiRetenciones(
  acc: AcumuladoMensual,
  customerId: string
): Promise<FacturapiDoc> {
  const { desde, hasta } = rangoDelPeriodo(acc.periodo);
  const totalRetenido = round2(acc.isrRetenido + acc.ivaRetenido);

  const res = await facturapiFetch<FacturapiDoc>("/retentions", {
    method: "POST",
    body: {
      customer: customerId,
      // 🔁 FISCALISTA: clave de retención del régimen de plataformas tecnológicas.
      key: "14",
      period: {
        month_from: desde.getUTCMonth() + 1,
        month_to: hasta.getUTCMonth() || 12,
        year: desde.getUTCFullYear(),
      },
      totals: {
        total_base: acc.base,
        total_retained: totalRetenido,
        taxes: [
          ...(acc.isrRetenido > 0
            ? [{ base: acc.base, type: "ISR", amount: acc.isrRetenido }]
            : []),
          ...(acc.ivaRetenido > 0
            ? [{ base: acc.base, type: "IVA", amount: acc.ivaRetenido }]
            : []),
        ],
      },
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
  acumulado: AcumuladoMensual;
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
        acumulado: params.acumulado,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  logger.info("creator_monthly_doc", { id, uuid: params.uuid });
}

/** ¿Ya se emitió este documento para ese creador y mes? */
export async function yaEmitido(
  creatorId: string,
  periodo: string,
  tipo: "comision" | "retenciones" | "liquidacion" | "global"
): Promise<boolean> {
  const snap = await db
    .collection("creatorMonthlyDocs")
    .doc(`${creatorId}_${periodo}_${tipo}`)
    .get();
  return snap.exists;
}
