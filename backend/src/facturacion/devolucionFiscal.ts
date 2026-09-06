// Lo que hay que corregir en la capa fiscal cuando se devuelve una compra.
//
// 🔴 EL HUECO QUE CIERRA (auditoría del 2026-09-06)
//
// Una devolución revertía el asiento del creador, daba su crédito al comprador y marcaba la
// compra — y **no tocaba nada fiscal**. Tres consecuencias, las tres malas:
//
//   1. La venta seguía contando como LIBRE, porque el marcado era `refundDestination` y
//      `compraLibre` mira `devuelta`. La global del mes siguiente **la volvía a facturar**.
//   2. Si ya estaba en una global timbrada, esa factura seguía declarando un ingreso que ya no
//      existe. El creador **paga impuesto sobre dinero que devolvió**.
//   3. Si el comprador tenía su factura nominativa, seguía viva y podía **deducir una compra
//      reembolsada**.
//
// ⚠️ NUNCA TUMBA LA DEVOLUCIÓN. El dinero ya se movió cuando esto corre. Si algo falla aquí se
//    registra y se sigue: dejar la parte fiscal a medias es malo, pero deshacer un reembolso ya
//    entregado al comprador es peor y encima no es posible.
//
// ⚠️ LA FACTURA DEL COMPRADOR NO SE CANCELA SOLA. Cancelar una nominativa de más de 1 000 pesos
//    **exige que el comprador acepte**, así que no es algo que un proceso pueda dar por hecho. Se
//    deja avisado para que administración decida entre cancelarla o emitir una nota de crédito.

import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { liberarDeGlobal } from "./cancelacionGlobal";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

export type ResultadoDevolucionFiscal = {
  /** Si quedó marcada para no volver a facturarse. Es lo mínimo que tiene que salir bien. */
  marcada: boolean;
  /** Si estaba en una global timbrada y se sacó. */
  sacadaDeGlobal: boolean;
  /** Si tenía factura propia y hace falta que alguien decida qué hacer con ella. */
  requiereRevision: boolean;
  /** Por qué no se pudo sacar de la global, si es el caso. */
  aviso: string | null;
};

/**
 * Corrige la capa fiscal de una compra devuelta.
 *
 * El orden importa: **primero se marca**, porque es lo que impide que la global del mes siguiente
 * la vuelva a facturar, y eso tiene que quedar hecho aunque lo demás falle.
 */
export async function corregirFiscalPorDevolucion(params: {
  buyerId: string;
  /** Id de la compra en el espejo del comprador, que es `${sourceType}__${sourceId}`. */
  purchaseId: string;
  /** Quién o qué lo originó, para el rastro. */
  origen: string;
}): Promise<ResultadoDevolucionFiscal> {
  const { buyerId, purchaseId, origen } = params;
  const salida: ResultadoDevolucionFiscal = {
    marcada: false,
    sacadaDeGlobal: false,
    requiereRevision: false,
    aviso: null,
  };

  const ref = db.doc(`users/${buyerId}/purchases/${purchaseId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn("devolucion_fiscal_sin_compra", { buyerId, purchaseId });
    return salida;
  }
  const compra = snap.data() ?? {};

  /**
   * 🚨 PASO 1, Y EL MÁS IMPORTANTE. Sin esta marca la venta cuenta como libre y la global del
   *    mes siguiente la factura otra vez — una venta que ya no existe.
   */
  await ref.set(
    {
      devuelta: {
        origen,
        enfechada: admin.firestore.FieldValue.serverTimestamp(),
        /** Si estaba en una global, se guarda cuál. Sirve para explicar el cambio de folio. */
        sacadaDe: (compra.globalInvoice as { facturapiId?: string } | undefined)?.facturapiId ?? null,
      },
    },
    { merge: true }
  );
  salida.marcada = true;

  // Paso 2 · Si ya estaba en una global TIMBRADA, hay que sacarla y reexpedir sin ella.
  const global = compra.globalInvoice as { estado?: string; facturapiId?: string } | undefined;
  if (global?.facturapiId && global.estado === "emitida") {
    try {
      await liberarDeGlobal({ buyerId, purchaseId, pedidoPor: origen, causa: "devolucion" });
      salida.sacadaDeGlobal = true;
    } catch (err) {
      /**
       * Falla sobre todo por dos motivos, y los dos merecen revisión humana: que la global esté
       * fuera de plazo —ahí la vía es una nota de crédito— o que el creador ya no tenga sello
       * vigente, sin el cual no se puede reexpedir.
       */
      salida.aviso = err instanceof Error ? err.message : String(err);
      salida.requiereRevision = true;
      logger.error("devolucion_fiscal_global_no_liberada", {
        buyerId,
        purchaseId,
        err: salida.aviso,
      });
    }
  }

  // Paso 3 · Si tenía factura propia, alguien tiene que decidir. No se cancela sola.
  if (compra.invoiced === true) {
    salida.requiereRevision = true;
    await db.collection("devolucionesPorRevisar").doc(purchaseId).set(
      {
        buyerId,
        purchaseId,
        creatorId: compra.creatorId ?? null,
        invoiceId: compra.invoiceId ?? null,
        invoiceUuid: compra.invoiceUuid ?? null,
        motivo:
          "La compra se devolvió y tenía factura a nombre del comprador. Hay que cancelarla —con su aceptación si supera los 1 000 pesos— o emitir una nota de crédito.",
        origen,
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
        resuelto: false,
      },
      { merge: true }
    );
  }

  logger.info("devolucion_fiscal", { buyerId, purchaseId, ...salida });
  return salida;
}

/**
 * La misma corrección, pero sin poder tumbar a quien la llama.
 *
 * Es la que usan los caminos de devolución: el dinero ya se movió, y un fallo al documentarlo no
 * puede deshacerlo.
 */
export async function corregirFiscalPorDevolucionSinRomper(params: {
  buyerId: string;
  purchaseId: string;
  origen: string;
}): Promise<void> {
  try {
    await corregirFiscalPorDevolucion(params);
  } catch (err) {
    logger.error("devolucion_fiscal_falló", {
      ...params,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
