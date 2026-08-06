// Reconciliador de eventos de SUSCRIPCIÓN de Stripe (espejo de reconcileMpSubscription).
// Lo llama stripeWebhook.ts para los eventos de Billing:
//   · invoice.paid              → materializa/renueva membresía + earning (1 por factura).
//   · invoice.payment_failed    → past_due + 5 días de gracia.
//   · customer.subscription.deleted → baja (el cron diario expira el acceso).
//   · customer.subscription.updated → sincroniza cancelAtPeriodEnd / estado.
//
// La metadata (groupId/uid/ownerId/base/IVA…) vive en la Subscription (la puso el callable
// createGroupSubscription). Se lee obteniendo la suscripción por su id. El precio y el IVA
// son SIEMPRE los de la metadata server-authoritative, NUNCA del cliente.

import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { stripeFetch } from "./stripeClient";
import { recordEarning } from "../../wallet/ledger";
import {
  activateSubscribedMembership,
  patchMembershipExpiry,
  addMonths,
  GRACE_MS,
  numOr0,
  strOr,
} from "../groupSubscriptionCore";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

type StripeSub = {
  id?: string;
  status?: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
};
type StripeInvoiceObj = { id?: string; subscription?: string; billing_reason?: string };

type SubMeta = {
  groupId: string;
  uid: string;
  ownerId: string;
  base: number;
  taxCountry: string | null;
  taxRate: number;
  taxMonthly: number;
  chargedMonthly: number;
  currency: string;
  groupName: string;
  inviteToken: string | null;
};

async function fetchSub(subId: string): Promise<StripeSub | null> {
  const r = await stripeFetch<StripeSub>(`/subscriptions/${subId}`);
  return r.ok ? r.data : null;
}

/** Extrae y valida la metadata de suscripción de comunidad; null si no es una nuestra. */
function subMeta(sub: StripeSub | null): SubMeta | null {
  const m = sub?.metadata ?? {};
  if (m.sourceType !== "groupSubscription") return null;
  const groupId = strOr(m.groupId);
  const uid = strOr(m.uid);
  if (!groupId || !uid) return null;
  return {
    groupId,
    uid,
    ownerId: strOr(m.ownerId),
    base: numOr0(m.baseMonthly),
    taxCountry: strOr(m.taxCountry) || null,
    taxRate: numOr0(m.taxRate),
    taxMonthly: numOr0(m.taxMonthly),
    chargedMonthly: numOr0(m.chargedMonthly),
    currency: strOr(m.currency) || "MXN",
    groupName: strOr(m.groupName),
    inviteToken: strOr(m.inviteToken) || null,
  };
}

/** Marca el uso de la invitación (best-effort; solo en la 1ª factura). */
async function markInviteUsed(groupId: string, inviteToken: string, uid: string): Promise<void> {
  const inv = await db.collectionGroup("inviteLinks").where("token", "==", inviteToken).limit(1).get();
  const ref = inv.empty ? null : inv.docs[0].ref;
  if (!ref) return;
  await ref
    .update({
      usedCount: FieldValue.increment(1),
      lastUsedAt: FieldValue.serverTimestamp(),
      lastUsedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined);
}

export async function reconcileStripeSubscriptionEvent(type: string, object: Record<string, unknown>): Promise<void> {
  // ── Cobro aprobado (primera factura o renovación mensual) ──────────────────
  if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
    const inv = object as StripeInvoiceObj;
    const subId = strOr(inv.subscription);
    if (!subId) return; // factura no ligada a suscripción → ignorar
    const sub = await fetchSub(subId);
    const meta = subMeta(sub);
    if (!meta || !sub) return;
    const { groupId, uid, ownerId } = meta;

    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : addMonths(new Date(), 1);
    const subRef = db.collection("groupSubscriptions").doc(`${groupId}_${uid}`);
    const existed = (await subRef.get()).exists;

    await subRef.set(
      {
        groupId,
        uid,
        ownerId,
        groupName: meta.groupName,
        stripeSubscriptionId: subId,
        mpPreapprovalId: null,
        status: "authorized",
        active: true,
        priceMonthly: meta.base, // BASE (ganancia del creador = 75% de esto)
        taxCountry: meta.taxCountry,
        taxRate: meta.taxRate,
        taxMonthly: meta.taxMonthly,
        chargedMonthly: meta.chargedMonthly,
        currency: meta.currency,
        currentPeriodEnd: Timestamp.fromDate(periodEnd),
        accessUntil: Timestamp.fromDate(periodEnd),
        gracePeriodEnd: null,
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        lastPaymentAt: FieldValue.serverTimestamp(),
        lastInvoiceId: strOr(inv.id),
        updatedAt: FieldValue.serverTimestamp(),
        ...(existed ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

    // Membresía suscrita (acceso). No al dueño.
    const groupSnap = await db.collection("groups").doc(groupId).get();
    if (groupSnap.exists && ownerId && ownerId !== uid) {
      await activateSubscribedMembership(groupId, uid, groupSnap.data() as Record<string, unknown>, {
        ownerId,
        priceMonthly: meta.base,
        currency: meta.currency,
        accessUntil: periodEnd,
      });
    }

    // Earning por ESTA factura (idempotente por invoice id). Sobre la BASE, no lo cobrado;
    // el IVA es de Vibra hacia el SAT, no del creador.
    if (ownerId && ownerId !== uid && meta.base > 0) {
      await recordEarning(ownerId, {
        type: "subscription",
        grossAmount: meta.base,
        taxCountry: meta.taxCountry ?? "",
        taxAmount: meta.taxMonthly,
        sourceType: "groupSubscription",
        sourceId: `${groupId}_${uid}_${strOr(inv.id)}`,
        buyerId: uid,
        earnedImmediately: true,
        channelType: "group",
        channelId: groupId,
      });
    }

    // Primera factura → marca el uso de la invitación.
    if (inv.billing_reason === "subscription_create" && meta.inviteToken) {
      await markInviteUsed(groupId, meta.inviteToken, uid);
    }
    logger.info("stripe subscription invoice.paid", { groupId, uid, invoiceId: inv.id });
    return;
  }

  // ── Cobro fallido → 5 días de gracia con acceso ────────────────────────────
  if (type === "invoice.payment_failed") {
    const inv = object as StripeInvoiceObj;
    const subId = strOr(inv.subscription);
    if (!subId) return;
    const meta = subMeta(await fetchSub(subId));
    if (!meta) return;
    const grace = new Date(Date.now() + GRACE_MS);
    await db.collection("groupSubscriptions").doc(`${meta.groupId}_${meta.uid}`).set(
      {
        status: "past_due",
        gracePeriodEnd: Timestamp.fromDate(grace),
        accessUntil: Timestamp.fromDate(grace),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await patchMembershipExpiry(meta.groupId, meta.uid, grace);
    logger.info("stripe subscription payment_failed", { groupId: meta.groupId, uid: meta.uid });
    return;
  }

  // ── Suscripción terminada → baja (el cron expira el acceso cuando vence) ────
  if (type === "customer.subscription.deleted") {
    const meta = subMeta(object as StripeSub);
    if (!meta) return;
    await db.collection("groupSubscriptions").doc(`${meta.groupId}_${meta.uid}`).set(
      { status: "ended", active: false, cancelAtPeriodEnd: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return;
  }

  // ── Cambios de estado (cancelación programada, etc.) ───────────────────────
  if (type === "customer.subscription.updated") {
    const sub = object as StripeSub;
    const meta = subMeta(sub);
    if (!meta) return;
    const canceling = sub.cancel_at_period_end === true || sub.status === "canceled";
    // NO se toca accessUntil aquí (lo manejan invoice.paid / payment_failed) para no
    // pisar un periodo de gracia con la fecha de fin de periodo.
    await db.collection("groupSubscriptions").doc(`${meta.groupId}_${meta.uid}`).set(
      {
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        status: canceling ? "cancelled" : sub.status === "past_due" || sub.status === "unpaid" ? "past_due" : "authorized",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }
}
