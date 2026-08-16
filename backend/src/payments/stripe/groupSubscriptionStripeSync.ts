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
  deactivateSubscribedMembership,
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
type SubDetails = { subscription?: string; metadata?: Record<string, string> };
type StripeInvoiceObj = {
  id?: string;
  subscription?: string; // API vieja (< dahlia)
  billing_reason?: string;
  // API reciente (2026-06-24.dahlia): la referencia a la sub + su metadata viven aquí.
  parent?: { subscription_details?: SubDetails } | null;
  lines?: { data?: Array<{ period?: { end?: number } }> };
};

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

/** Construye/valida la metadata de suscripción de comunidad desde un mapa; null si no es nuestra. */
function metaFromMap(m: Record<string, string> | undefined | null): SubMeta | null {
  if (!m || m.sourceType !== "groupSubscription") return null;
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

function subMeta(sub: StripeSub | null): SubMeta | null {
  return metaFromMap(sub?.metadata);
}

/**
 * subId + metadata de una factura de suscripción. En dahlia vienen en
 * `invoice.parent.subscription_details` (la metadata ya viaja en el evento, sin fetch);
 * en la API vieja está `invoice.subscription` y hay que buscar la sub para la metadata.
 */
async function invoiceSub(inv: StripeInvoiceObj): Promise<{ subId: string; meta: SubMeta | null }> {
  const sd = inv.parent?.subscription_details;
  const subId = strOr(sd?.subscription) || strOr(inv.subscription);
  let meta = metaFromMap(sd?.metadata);
  if (!meta && subId) meta = subMeta(await fetchSub(subId));
  return { subId, meta };
}

/**
 * Deja constancia de que una reserva acabó en alta pagada. **NO cuenta usos.**
 *
 * ⚠️ El cupo lo consume `reserveInviteSlot` al empezar el checkout, antes de
 * cobrar. Esta función incrementaba también, así que cada alta gastaba DOS usos y
 * un enlace de diez se agotaba con cinco personas. Solo sella metadatos.
 *
 * Best-effort a propósito: que no se pueda sellar el enlace no debe tumbar la
 * activación de una membresía ya pagada.
 */
async function stampInviteUsed(groupId: string, inviteToken: string, uid: string): Promise<void> {
  const inv = await db.collectionGroup("inviteLinks").where("token", "==", inviteToken).limit(1).get();
  const ref = inv.empty ? null : inv.docs[0].ref;
  if (!ref) return;
  await ref
    .set(
      {
        lastUsedAt: FieldValue.serverTimestamp(),
        lastUsedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    .catch(() => undefined);
}

export async function reconcileStripeSubscriptionEvent(type: string, object: Record<string, unknown>): Promise<void> {
  // ── Cobro aprobado (primera factura o renovación mensual) ──────────────────
  if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
    const inv = object as StripeInvoiceObj;
    const { subId, meta } = await invoiceSub(inv);
    if (!subId || !meta) return; // factura no ligada a una suscripción nuestra → ignorar
    const { groupId, uid, ownerId } = meta;

    // Fin del periodo pagado (accessUntil): del renglón de la factura; si no, +1 mes.
    const lineEnd = inv.lines?.data?.[0]?.period?.end;
    const periodEnd = lineEnd ? new Date(lineEnd * 1000) : addMonths(new Date(), 1);
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
        lastPaymentAt: FieldValue.serverTimestamp(),
        lastInvoiceId: strOr(inv.id),
        updatedAt: FieldValue.serverTimestamp(),
        // cancelAtPeriodEnd lo sincroniza customer.subscription.updated; al crear, false.
        ...(existed ? {} : { createdAt: FieldValue.serverTimestamp(), cancelAtPeriodEnd: false }),
      },
      { merge: true }
    );

    // Membresía suscrita (acceso). No al dueño.
    //
    // ⚠️ Que el documento EXISTA no basta. El borrado de una comunidad es lógico:
    // el documento se queda con `isDeleted: true`. Sin esta comprobación, la
    // renovación de una suscripción que sobreviviera a la cancelación volvía a
    // crear la membresía de una comunidad borrada, mes tras mes.
    const groupSnap = await db.collection("groups").doc(groupId).get();
    const grupoVivo =
      groupSnap.exists &&
      groupSnap.get("isDeleted") !== true &&
      groupSnap.get("isActive") !== false;

    if (!grupoVivo) {
      logger.warn("subSync: renovación de una comunidad que ya no está, no se activa", {
        groupId,
        uid,
      });
    }

    if (grupoVivo && ownerId && ownerId !== uid) {
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

    // ⚠️ EL CUPO YA SE CONSUMIÓ AL EMPEZAR EL CHECKOUT, no aquí.
    //
    // `reserveInviteSlot` (en `createGroupSubscription`) incrementa `usedCount`
    // ANTES de cobrar, para que dos personas con el último cupo no entren las dos.
    // Este sitio incrementaba también, así que cada alta gastaba DOS usos: un
    // enlace de diez se agotaba con cinco personas.
    //
    // Aquí ya no se cuenta nada; solo se deja constancia de que esa reserva acabó
    // en un alta pagada, que es lo que se ve en el panel de invitaciones.
    if (type === "invoice.paid" && inv.billing_reason === "subscription_create" && meta.inviteToken) {
      await stampInviteUsed(groupId, meta.inviteToken, uid);
    }
    logger.info("stripe subscription invoice.paid", { groupId, uid, invoiceId: inv.id });
    return;
  }

  // ── Cobro fallido → 5 días de gracia con acceso ────────────────────────────
  if (type === "invoice.payment_failed") {
    const inv = object as StripeInvoiceObj;
    const { subId, meta } = await invoiceSub(inv);
    if (!subId || !meta) return;
    const ref = db.collection("groupSubscriptions").doc(`${meta.groupId}_${meta.uid}`);
    const graceMs = Date.now() + GRACE_MS;
    const grace = new Date(graceMs);
    // El acceso durante la gracia NUNCA debe acortar un periodo ya pagado que siga vigente:
    // usa el mayor entre el `accessUntil` actual y la gracia (normalmente el fallo ocurre en
    // la renovación, con el periodo ya vencido, y gana la gracia).
    const curUntil = (await ref.get()).data()?.accessUntil;
    const curUntilMs = curUntil && typeof curUntil.toMillis === "function" ? curUntil.toMillis() : 0;
    const until = new Date(Math.max(graceMs, curUntilMs));
    await ref.set(
      {
        status: "past_due",
        gracePeriodEnd: Timestamp.fromDate(grace),
        accessUntil: Timestamp.fromDate(until),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await patchMembershipExpiry(meta.groupId, meta.uid, until);
    logger.info("stripe subscription payment_failed", { groupId: meta.groupId, uid: meta.uid });
    return;
  }

  // ── Suscripción terminada → baja INMEDIATA del acceso ──────────────────────
  // Stripe solo emite `deleted` cuando la suscripción ya terminó de verdad: cancelación
  // inmediata (el creador eligió "cancelar ahora"), o fin del periodo tras un
  // cancel_at_period_end. En ambos casos el acceso se corta YA — no se espera al cron.
  if (type === "customer.subscription.deleted") {
    const meta = subMeta(object as StripeSub);
    if (!meta) return;
    await deactivateSubscribedMembership(meta.groupId, meta.uid);
    await db.collection("groupSubscriptions").doc(`${meta.groupId}_${meta.uid}`).set(
      {
        status: "ended",
        active: false,
        cancelAtPeriodEnd: true,
        accessUntil: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logger.info("stripe subscription deleted → acceso revocado", { groupId: meta.groupId, uid: meta.uid });
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
