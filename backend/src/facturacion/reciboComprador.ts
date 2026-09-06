// Recibo para el comprador EXTRANJERO — el comprobante que hoy no recibe nadie.
//
// EL HUECO QUE CIERRA
//
// El CFDI es un documento mexicano y solo sirve para un comprador mexicano. El de fuera pagaba,
// recibía su servicio y **no se llevaba ningún papel**: ni de lo que pagó, ni de en qué moneda,
// ni del impuesto de su país que sí le cobramos.
//
// ⚠️ NO ES UN CFDI y no debe parecerlo. No se timbra, no tiene folio fiscal y no sirve para
// deducir en México. Es un recibo de pago, que es exactamente lo que necesita.
//
// 🚨 SOLO PARA EL COMPRADOR DE FUERA, y es una decisión deliberada.
//
//    Al mexicano no se le genera. Su venta la ampara un CFDI —la global del creador, o su propia
//    factura si la pide— y darle además un papel que se le parece pero no vale fiscalmente es
//    invitarlo a presentarlo en su declaración. Un documento que confunde es peor que ninguno.
//
// 👉 Sigue el patrón de `comprobanteLiquidacion.ts`: **se genera siempre**, esté encendido o no
//    el timbrado, porque no depende de ninguna clave del SAT ni de ningún sello.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ReciboComprador = {
  buyerId: string;
  /** Id de la compra. Es el folio del recibo. */
  purchaseId: string;
  creatorId: string;
  /** Cuál de los once servicios. */
  type: string;
  /** País fiscal del comprador, ya resuelto por el backend. Nunca uno propuesto por el cliente. */
  buyerCountry: string;
  /**
   * 💱 Lo que VIO y pagó, en SU moneda.
   *
   * 🚨 Es la cifra que de verdad le importa y la única que puede cotejar contra su banco. El
   *    importe en dólares de la liquidación no le dice nada: él no vio esa cifra en ningún
   *    momento.
   */
  pagado: number | null;
  monedaPagada: string | null;
  /** Lo mismo en la moneda de liquidación, para conciliar por dentro. */
  total: number;
  currency: string;
  /** Precio del servicio, sin cargos ni impuesto. */
  base: number;
  /**
   * Impuesto del país del comprador, cuando Vibra lo recauda y lo entera allí.
   *
   * ⚠️ NO es IVA mexicano. Una venta a comprador de fuera es exportación a tasa 0%, así que el
   * IVA mexicano de esa operación es cero por definición.
   */
  impuesto: number;
  fecha: admin.firestore.Timestamp | null;
  creadoEn: admin.firestore.FieldValue;
};

/**
 * Arma el recibo a partir del espejo de la compra y del cobro.
 *
 * Función PURA salvo el sello de tiempo, para poder probarla sin Firestore. Todo lo que necesita
 * ya está guardado: el espejo trae el servicio y los importes de liquidación, y el cobro trae lo
 * que el comprador vio en su moneda.
 */
export function armarRecibo(params: {
  purchaseId: string;
  compra: FirebaseFirestore.DocumentData;
  /** El `paymentIntent`, si existe. Sin él se pierde la moneda local, no el recibo entero. */
  cobro?: FirebaseFirestore.DocumentData | null;
}): ReciboComprador {
  const { purchaseId, compra, cobro } = params;

  const local = num(cobro?.presentmentAmount);
  const monedaLocal =
    typeof cobro?.presentmentCurrency === "string" ? cobro.presentmentCurrency : null;

  const base = round2(num(compra.grossAmount));
  const impuesto = round2(num(compra.taxAmount));

  return {
    buyerId: String(compra.buyerId ?? ""),
    purchaseId,
    creatorId: String(compra.creatorId ?? ""),
    type: String(compra.type ?? ""),
    buyerCountry: String(compra.taxCountry ?? "").toUpperCase(),
    pagado: local > 0 ? round2(local) : null,
    monedaPagada: local > 0 ? monedaLocal : null,
    /**
     * Si el cobro no guardó el total, se reconstruye con lo que sí hay. Es preferible a dejarlo
     * en cero: un recibo que dice que pagaste cero no lo firma nadie.
     */
    total: round2(num(cobro?.chargedAmount) || base + impuesto),
    currency: String(compra.currency ?? "USD"),
    base,
    impuesto,
    fecha: (compra.occurredAt as admin.firestore.Timestamp) ?? null,
    creadoEn: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * ¿Le toca recibo a esta compra?
 *
 * Solo al comprador de FUERA y solo si la compra está pagada. Sin país fiscal resuelto no se
 * genera: no sabemos si es de fuera, y suponerlo llenaría de recibos a compradores mexicanos que
 * ya tienen su CFDI.
 */
export function leTocaRecibo(compra: FirebaseFirestore.DocumentData): boolean {
  const pais = String(compra.taxCountry ?? "").trim().toUpperCase();
  if (!pais || pais === "MX") return false;
  return compra.status === "paid";
}

/**
 * Guarda el recibo bajo el comprador.
 *
 * 🚨 IDEMPOTENTE: el id del documento es el de la compra, así que un disparo repetido —el espejo
 *    se reescribe cada vez que cambia el asiento— sobreescribe en vez de duplicar.
 *
 * ⚠️ NUNCA TUMBA NADA. Si falla, se registra y se sigue: el espejo de la compra es lo que sostiene
 *    la pantalla del comprador, y no documentarlo no puede hacer que su compra desaparezca.
 */
export async function guardarRecibo(params: {
  purchaseId: string;
  compra: FirebaseFirestore.DocumentData;
  cobro?: FirebaseFirestore.DocumentData | null;
}): Promise<void> {
  try {
    const r = armarRecibo(params);
    if (!r.buyerId) {
      logger.warn("recibo_sin_comprador", { purchaseId: params.purchaseId });
      return;
    }
    await db
      .collection("users")
      .doc(r.buyerId)
      .collection("recibos")
      .doc(params.purchaseId)
      .set(r, { merge: true });
    logger.info("recibo_comprador", {
      purchaseId: params.purchaseId,
      buyerCountry: r.buyerCountry,
      total: r.total,
    });
  } catch (err) {
    logger.warn("recibo_comprador_falló", {
      purchaseId: params.purchaseId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
