// Comprobante de liquidación — lo que recibe el creador que NO lleva CFDI.
//
// Es el tercer documento del mes cuando no hay ninguna retención mexicana que constar, o sea el
// caso creador extranjero con comprador extranjero. También es lo que acompaña a cualquier pago
// a un creador de fuera, que no puede recibir un comprobante fiscal mexicano.
//
// ⚠️ NO ES UN CFDI y no debe parecerlo. No se timbra, no tiene folio fiscal y no sirve para
// deducir en México. Es la constancia de que Vibra le pagó una cantidad, con el desglose de
// cómo se llegó a ella — que es lo que su contador de su país va a pedirle.
//
// Se guarda en Firestore, no se genera un PDF: el creador lo consulta y lo descarga desde su
// wallet cuando exista la pantalla. Guardar el dato es lo que permite reconstruir el PDF con
// cualquier formato después; generar un PDF sin guardar el dato no se puede deshacer.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import type { AcumuladoMensual } from "./creatorMonthlyDocs";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ComprobanteLiquidacion = {
  creatorId: string;
  periodo: string;
  /** Moneda en que se liquida. Siempre la de liquidación de la plataforma. */
  currency: string;
  ventas: number;
  /** Precio de venta acumulado, sin impuestos. */
  base: number;
  /** Participación del creador antes de cualquier descuento. */
  participacion: number;
  comision: number;
  ivaComision: number;
  isrRetenido: number;
  ivaRetenido: number;
  /**
   * 🧾 IVA mexicano cobrado a sus compradores. SUMA al neto, no resta.
   *
   * Es dinero que entró por encima del precio y del que sale `ivaRetenido`. Sin esta línea
   * el comprobante diría un neto menor que el depósito y su contador no podría cuadrarlo.
   */
  mxVatVenta: number;
  /** Lo que le corresponde recibir. */
  neto: number;
  /** Texto listo para mostrar, en el idioma del creador lo traduce la interfaz. */
  emitidoEn: string;
};

/**
 * Arma el comprobante a partir del acumulado del mes.
 *
 * Función PURA: el desglose no depende de nada externo, así que se puede probar y también
 * reconstruir para un mes viejo sin volver a leer nada.
 */
export function armarComprobante(
  acc: AcumuladoMensual,
  currency: string,
  emitidoEn: string
): ComprobanteLiquidacion {
  const participacion = round2(acc.base - acc.comision);
  /**
   * 🚨 EL IVA COBRADO SUMA. Es la misma fórmula que `resolveSettlement` y `calcularRetiro`,
   *    y tiene que serlo: si el comprobante dijera otra cosa que el depósito, el creador
   *    tendría dos cifras distintas del mismo dinero y ninguna le serviría para declarar.
   */
  const neto = round2(
    Math.max(
      0,
      participacion + acc.mxVatVenta - acc.ivaComision - acc.isrRetenido - acc.ivaRetenido
    )
  );
  return {
    creatorId: acc.creatorId,
    periodo: acc.periodo,
    currency,
    ventas: acc.ventas,
    base: acc.base,
    participacion,
    comision: acc.comision,
    ivaComision: acc.ivaComision,
    isrRetenido: acc.isrRetenido,
    ivaRetenido: acc.ivaRetenido,
    mxVatVenta: acc.mxVatVenta,
    neto,
    emitidoEn,
  };
}

/**
 * Guarda el comprobante del mes.
 *
 * Vive bajo el creador, no en una colección suelta: es SU documento y debe poder leerlo él sin
 * que se le abra la puerta a los de nadie más.
 */
export async function guardarComprobante(c: ComprobanteLiquidacion): Promise<void> {
  await db
    .collection("users")
    .doc(c.creatorId)
    .collection("payoutStatements")
    .doc(c.periodo)
    .set({ ...c, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  logger.info("payout_statement_saved", {
    creatorId: c.creatorId,
    periodo: c.periodo,
    neto: c.neto,
  });
}
