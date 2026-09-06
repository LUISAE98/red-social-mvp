/**
 * Espejo de compras del COMPRADOR (Opción A).
 *
 * Cada entrada del libro mayor del creador (`users/{creatorId}/walletLedger`)
 * lleva un `buyerId`. Este trigger la refleja en
 * `users/{buyerId}/purchases/{entryId}` para que el comprador pueda ver TODAS
 * sus compras (los 11 servicios) en una sola colección, ordenada por fecha, sin
 * exponer los internos del ledger del creador (comisión, neto).
 *
 * - Cubre altas y cambios de estado (paid / refunded / rejected) porque escucha
 *   `onDocumentWritten`.
 * - El id del doc del comprador = el mismo id determinista del ledger
 *   (`sourceType__sourceId`), así que es idempotente y no duplica.
 * - Es solo un espejo de lectura: el ledger del creador sigue siendo la fuente
 *   de verdad contable; aquí no se calcula dinero.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { guardarRecibo, leTocaRecibo } from "../facturacion/reciboComprador";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { SETTLEMENT_CURRENCY } from "./ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

// Estado del ledger (creador) → estado de la compra (comprador). El comprador ya
// pagó tanto en "pending" como en "earned"; solo distinguimos devuelto/rechazado.
export function buyerStatusFromLedger(
  status: unknown
): "paid" | "refunded" | "rejected" {
  if (status === "refunded") return "refunded";
  if (status === "rejected") return "rejected";
  return "paid";
}

/**
 * La fecha de la compra, avisando si falta.
 *
 * No se inventa una: poner la fecha del espejo metería la venta en el día equivocado de la
 * factura global, que es peor que dejarla fuera y ruidosa.
 */
function fechaDeLaCompra(d: FirebaseFirestore.DocumentData, entryId: string): unknown {
  const fecha = d.occurredAt ?? d.createdAt ?? null;
  if (!fecha) {
    logger.warn("buyer_purchase_sin_fecha", { entryId });
  }
  return fecha;
}

export const mirrorLedgerToBuyerPurchase = onDocumentWritten(
  { document: "users/{creatorId}/walletLedger/{entryId}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    // Las entradas del ledger no se borran; si llegara un delete, no hacemos nada.
    if (!after || !after.exists) return;
    const d = after.data();
    if (!d) return;

    const buyerId =
      typeof d.buyerId === "string" && d.buyerId.trim().length > 0
        ? d.buyerId
        : null;
    if (!buyerId) return; // sin comprador (p.ej. ajustes) → no se refleja

    const ref = db
      .collection("users")
      .doc(buyerId)
      .collection("purchases")
      .doc(event.params.entryId);

    await ref.set(
      {
        buyerId,
        creatorId: d.creatorId ?? event.params.creatorId,
        type: d.type ?? null,
        status: buyerStatusFromLedger(d.status),
        /**
         * 🧾 ¿El servicio está todavía por entregarse?
         *
         * 🚨 NO SE FACTURA LO QUE NO SE HA ENTREGADO (Luis, 2026-09-05). Una sesión pagada y no
         *    celebrada puede cancelarse, y entonces habría que cancelar un CFDI ya timbrado —
         *    que por encima de 1 000 pesos exige que el comprador ACEPTE la cancelación.
         *
         * ⚠️ Va como campo APARTE y no dentro de `status`. Para el comprador «pagado» es pagado
         *    en los dos casos, y cambiar `status` reescribiría lo que ve en su lista. Aquí solo
         *    se añade el matiz que hacía falta para facturar.
         *
         * 👉 No hay lista de servicios diferidos que mantener: el ledger ya los distingue solo.
         *    Los que se ganan al pagar nunca pasan por `pending`, así que este campo sale
         *    siempre en `false` para ellos.
         */
        pendienteEntrega: d.status === "pending",
        grossAmount: typeof d.grossAmount === "number" ? d.grossAmount : 0,
        currency: typeof d.currency === "string" ? d.currency : SETTLEMENT_CURRENCY,
        sourceType: d.sourceType ?? null,
        sourceId: d.sourceId ?? null,
        channelType: d.channelType ?? "profile",
        channelId: d.channelId ?? null,
        liveId: d.liveId ?? null,
        postId: d.postId ?? null,
        taxAmount: typeof d.taxAmount === "number" ? d.taxAmount : 0,
        /**
         * 🌍 País fiscal del comprador, ya resuelto por el backend.
         *
         * Viaja al espejo porque es lo que decide si le toca **recibo**: el CFDI es un documento
         * mexicano y el comprador de fuera se quedaba sin ningún papel. Ver `reciboComprador.ts`.
         */
        taxCountry: typeof d.taxCountry === "string" ? d.taxCountry : null,
        /**
         * 🧾 Los pesos congelados de la venta. Viaja al espejo porque es desde AQUÍ desde donde
         * se factura: `generateBuyerInvoice` lee las compras del comprador, y la factura global
         * lee este mismo espejo para saber qué quedó sin facturar.
         */
        fiscalMxn: d.fiscalMxn ?? null,
        /**
         * Fecha real de la compra: para ordenar «más reciente arriba» y, desde §A1, para
         * decidir en qué factura global entra.
         *
         * 🚨 Sin ella la compra es INVISIBLE para la global (AUD-7): la consulta va por rango
         *    de `occurredAt` y un `null` no cae en ningún rango, así que esa venta no se
         *    documentaría nunca y nadie lo notaría. Se canta en el registro para poder
         *    encontrarla, porque el asiento del ledger siempre debería traerla.
         */
        occurredAt: fechaDeLaCompra(d, event.params.entryId),
        createdAt: d.createdAt ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    /*
     * 🧾 El recibo del comprador EXTRANJERO.
     *
     * Va después del espejo y con el fallo tragado: el espejo es lo que sostiene su pantalla de
     * compras, y no poder documentar el recibo no puede hacer que su compra desaparezca.
     *
     * Se lee el cobro para sacar lo que VIO en su moneda, que es la única cifra que puede
     * cotejar contra su banco.
     */
    const espejo = (await ref.get()).data() ?? {};
    if (leTocaRecibo(espejo)) {
      const cobroSnap = await db
        .collection("paymentIntents")
        .doc(event.params.entryId)
        .get()
        .catch(() => null);
      await guardarRecibo({
        purchaseId: event.params.entryId,
        compra: espejo,
        cobro: cobroSnap?.exists ? cobroSnap.data() : null,
      });
    }

    logger.debug("buyer_purchase_mirrored", {
      buyerId,
      entryId: event.params.entryId,
      status: d.status,
    });
  }
);
