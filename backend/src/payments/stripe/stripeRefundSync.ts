// Reconciliador de REEMBOLSOS y CONTRACARGOS de Stripe → revierte el ledger.
// Fuente de verdad UNIVERSAL (los 11 servicios): cubre reembolsos voluntarios/por
// callable/desde el dashboard (`charge.refunded`) y contracargos perdidos
// (`charge.dispute.closed` con `status: "lost"`). Así el wallet nunca queda inflado
// frente a lo que Stripe realmente tiene.
//
// Mapeo evento → asiento del ledger:
//   1. Del charge se sacan `sourceType`+`sourceId` (metadata del PaymentIntent, o —para
//      suscripción— metadata de la factura).
//   2. Se halla el `creatorId` dueño del asiento con un collectionGroup query sobre
//      `walletLedger` por (sourceType, sourceId).
//   3. `reverseEarning` (idempotente: si ya estaba refunded/rejected, no hace nada).
// Idempotencia extra: el webhook deduplica por `event.id` en `stripeEvents`.

import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { stripeFetch } from "./stripeClient";
import { reverseEarning } from "../../wallet/ledger";
import { revokeAccessForSource } from "./revokeAccessOnRefund";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

type StripeChargeObj = {
  id?: string;
  payment_intent?: string;
  invoice?: string;
  amount?: number;
  amount_refunded?: number;
  refunded?: boolean;
};
type StripeDisputeObj = { id?: string; charge?: string; status?: string };

/** sourceType + sourceId del asiento a revertir, a partir de un charge de Stripe. */
async function resolveSourceIds(
  charge: StripeChargeObj
): Promise<{ sourceType: string; sourceId: string } | null> {
  // Suscripción a comunidad: el cobro cuelga de una FACTURA; la metadata de la sub viaja
  // en la factura. El earning se registró con sourceId `${groupId}_${uid}_${invoiceId}`.
  if (charge.invoice) {
    const inv = await stripeFetch<{
      parent?: { subscription_details?: { metadata?: Record<string, string> } } | null;
    }>(`/invoices/${charge.invoice}`);
    const m = inv.ok ? inv.data.parent?.subscription_details?.metadata ?? {} : {};
    if (m.sourceType === "groupSubscription" && m.groupId && m.uid) {
      return { sourceType: "groupSubscription", sourceId: `${m.groupId}_${m.uid}_${charge.invoice}` };
    }
  }
  // Resto (los otros 10): la metadata está en el PaymentIntent.
  if (charge.payment_intent) {
    const pi = await stripeFetch<{ metadata?: Record<string, string> }>(
      `/payment_intents/${charge.payment_intent}`
    );
    const m = pi.ok ? pi.data.metadata ?? {} : {};
    const sourceType = typeof m.sourceType === "string" ? m.sourceType : "";
    const sourceId = typeof m.sourceId === "string" ? m.sourceId : "";
    if (sourceType && sourceId) return { sourceType, sourceId };
  }
  return null;
}

/** creatorId dueño del asiento del ledger por (sourceType, sourceId). */
async function findCreatorId(sourceType: string, sourceId: string): Promise<string | null> {
  const snap = await db
    .collectionGroup("walletLedger")
    .where("sourceType", "==", sourceType)
    .where("sourceId", "==", sourceId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const cid = snap.docs[0].data()?.creatorId;
  return typeof cid === "string" && cid ? cid : null;
}

async function reverseForCharge(charge: StripeChargeObj, reason: string): Promise<void> {
  const src = await resolveSourceIds(charge);
  if (!src) {
    logger.warn("refundSync: no se pudo resolver sourceType/sourceId", { chargeId: charge.id, reason });
    return;
  }
  // El acceso se retira SIEMPRE, haya asiento de ledger o no. Antes esta función
  // salía temprano cuando no encontraba el asiento, y con ella se iba también lo
  // único que quitaba el contenido comprado.
  await revokeAccessForSource(src.sourceType, src.sourceId, reason);

  const creatorId = await findCreatorId(src.sourceType, src.sourceId);
  if (!creatorId) {
    logger.warn("refundSync: sin asiento de ledger para revertir", { ...src, reason });
    return;
  }
  await reverseEarning(creatorId, src.sourceType, src.sourceId); // idempotente
  logger.info("refundSync: ledger revertido", { creatorId, ...src, reason });
}

export async function reconcileStripeRefundEvent(
  type: string,
  object: Record<string, unknown>
): Promise<void> {
  // ── Reembolso (voluntario / por callable / desde dashboard) ────────────────
  if (type === "charge.refunded") {
    const charge = object as StripeChargeObj;
    // Solo se revierte en reembolso TOTAL. El parcial requeriría ajuste proporcional
    // del asiento (no soportado aún) → se ignora y se registra para revisión manual.
    const full =
      charge.refunded === true ||
      (typeof charge.amount === "number" && charge.amount_refunded === charge.amount);
    if (!full) {
      logger.info("refundSync: reembolso PARCIAL ignorado (revisar manual)", { chargeId: charge.id });
      return;
    }
    await reverseForCharge(charge, "charge.refunded");
    return;
  }

  // ── Contracargo PERDIDO → el dinero se fue → revertir ──────────────────────
  if (type === "charge.dispute.closed") {
    const dispute = object as StripeDisputeObj;
    if (dispute.status !== "lost") return; // won / warning_closed → no se revierte
    if (!dispute.charge) return;
    const r = await stripeFetch<StripeChargeObj>(`/charges/${dispute.charge}`);
    if (!r.ok) {
      logger.warn("refundSync: no se pudo leer el charge del contracargo", { disputeId: dispute.id });
      return;
    }
    await reverseForCharge(r.data, "chargeback_lost");
    return;
  }
}
