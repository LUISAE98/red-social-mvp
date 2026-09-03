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

    logger.debug("buyer_purchase_mirrored", {
      buyerId,
      entryId: event.params.entryId,
      status: d.status,
    });
  }
);
