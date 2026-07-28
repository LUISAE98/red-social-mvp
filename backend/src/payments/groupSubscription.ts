// Suscripción a comunidades con Mercado Pago PREAPPROVAL (auto-renovación real).
//
// Modelo: un solo flujo server-authoritative. El cliente NUNCA activa la membresía
// ni el earning; solo pide `payGroupSubscription` con un token de tarjeta. El backend
// crea el `preapproval` mensual en MP y SOLO el webhook (o la respuesta de MP al
// crear) activa la membresía suscrita. El earning se registra por CADA cobro mensual
// (webhook `subscription_authorized_payment`), no una sola vez.
//
// Decisiones de producto:
//  · Cancelar conserva acceso hasta fin del periodo pagado (no corta al instante).
//  · Renovación fallida → 5 días de gracia con acceso antes de perderlo.
//
// Estado por (grupo, usuario) en `groupSubscriptions/{groupId}_{uid}`. La membresía
// vive en `groups/{groupId}/members/{uid}` + espejo `users/{uid}/groupMemberships/{groupId}`.

import * as crypto from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { mpAccessToken, mpFetch, MP_SANDBOX, SANDBOX_PAYER_EMAIL, MP_CURRENCY } from "./mpClient";
import { recordEarning } from "../wallet/ledger";
import { applyConsumptionTax } from "../tax/config";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const REGION = "us-central1";
const GRACE_MS = 5 * 24 * 60 * 60 * 1000; // 5 días de gracia en renovación fallida
const BACK_URL_BASE = "https://vibraon.com/groups";

type MpPreapproval = {
  id?: string;
  status?: string;
  external_reference?: string;
  next_payment_date?: string;
};
type MpAuthorizedPayment = {
  id?: string | number;
  status?: string;
  preapproval_id?: string;
  transaction_amount?: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Lee la config de suscripción del grupo (modelo nuevo con fallback legacy). */
function readGroupSub(group: Record<string, unknown>): { enabled: boolean; price: number; currency: string } {
  const m = (group.monetization ?? {}) as Record<string, unknown>;
  const enabled = m.subscriptionsEnabled === true || m.isPaid === true;
  const price = num(m.subscriptionPriceMonthly) || num(m.priceMonthly);
  const currency = str(m.subscriptionCurrency) || str(m.currency) || "MXN";
  return { enabled, price, currency };
}

/** Campos denormalizados del grupo para el doc de membresía del usuario. */
function groupDenorm(group: Record<string, unknown>): Record<string, unknown> {
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const b = (v: unknown) => (typeof v === "boolean" ? v : null);
  const name = s(group.name);
  return {
    groupName: name,
    groupDescription: s(group.description),
    groupImageUrl: s(group.imageUrl),
    groupAvatarUrl: s(group.avatarUrl),
    groupCoverUrl: s(group.coverUrl),
    groupOwnerId: s(group.ownerId),
    groupVisibility: s(group.visibility),
    groupDiscoverable: b(group.discoverable),
    groupIsActive: b(group.isActive),
    groupCategory: s(group.category),
    name,
    description: s(group.description),
    imageUrl: s(group.imageUrl),
    avatarUrl: s(group.avatarUrl),
    coverUrl: s(group.coverUrl),
    ownerId: s(group.ownerId),
    visibility: s(group.visibility),
    discoverable: b(group.discoverable),
    isActive: b(group.isActive),
    category: s(group.category),
  };
}

/**
 * Activa (o renueva) la membresía suscrita server-side. Idempotente. Marca
 * `mpManaged: true` para que `onGroupSubscriptionLedger` NO cuente un earning aquí
 * (el dinero lo registra el webhook por cada cobro). Fija `subscriptionExpiresAt`
 * = fecha hasta la que hay acceso (el frontend muestra "Suscrito hasta …").
 */
async function activateSubscribedMembership(
  groupId: string,
  uid: string,
  group: Record<string, unknown>,
  opts: { ownerId: string; priceMonthly: number; currency: string; accessUntil: Date }
): Promise<void> {
  const memberRef = db.doc(`groups/${groupId}/members/${uid}`);
  const userMembershipRef = db.doc(`users/${uid}/groupMemberships/${groupId}`);
  const expiresAt = Timestamp.fromDate(opts.accessUntil);

  const core = {
    roleInGroup: "member",
    role: "member",
    status: "subscribed",
    accessType: "subscription",
    requiresSubscription: true,
    subscriptionActive: true,
    subscriptionPriceMonthly: opts.priceMonthly,
    subscriptionCurrency: opts.currency,
    subscriptionExpiresAt: expiresAt,
    mpManaged: true,
  };

  await db.runTransaction(async (tx) => {
    const [memberSnap, userSnap] = await Promise.all([tx.get(memberRef), tx.get(userMembershipRef)]);
    const firstTime = !memberSnap.exists || memberSnap.data()?.subscribedAt == null;
    const stamp = firstTime
      ? { subscribedAt: FieldValue.serverTimestamp(), joinedAt: FieldValue.serverTimestamp(), joinSource: "subscription" }
      : {};

    tx.set(memberRef, { userId: uid, ...core, ...stamp, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(
      userMembershipRef,
      {
        groupId,
        userId: uid,
        ...core,
        ...groupDenorm(group),
        ...(userSnap.exists ? {} : { joinedAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/** Solo mueve la fecha de expiración de acceso (gracia por renovación fallida). */
async function patchMembershipExpiry(groupId: string, uid: string, until: Date): Promise<void> {
  const expiresAt = Timestamp.fromDate(until);
  await Promise.all([
    db.doc(`groups/${groupId}/members/${uid}`).set({ subscriptionExpiresAt: expiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    db.doc(`users/${uid}/groupMemberships/${groupId}`).set({ subscriptionExpiresAt: expiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
  ]);
}

/** Da de baja el acceso: borra la membresía (dispara onGroupSubscriptionChurn). */
async function deactivateSubscribedMembership(groupId: string, uid: string): Promise<void> {
  await Promise.all([
    db.doc(`groups/${groupId}/members/${uid}`).delete(),
    db.doc(`users/${uid}/groupMemberships/${groupId}`).delete(),
  ]);
}

// ── Callable: suscribirse (crea el preapproval) ──────────────────────────────
export const payGroupSubscription = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const groupId = String(data.groupId ?? "").trim();
    if (!groupId) throw new HttpsError("invalid-argument", "Falta la comunidad.");
    const token = String(data.token ?? "").trim();
    if (!token) throw new HttpsError("invalid-argument", "Faltan datos de pago.");

    const groupSnap = await db.collection("groups").doc(groupId).get();
    if (!groupSnap.exists) throw new HttpsError("not-found", "Comunidad no encontrada.");
    const group = groupSnap.data() as Record<string, unknown>;

    const sub = readGroupSub(group);
    if (!sub.enabled || sub.price <= 0) {
      throw new HttpsError("failed-precondition", "Esta comunidad no tiene suscripción activa.");
    }
    const ownerId = String(group.ownerId ?? "");
    if (!ownerId) throw new HttpsError("failed-precondition", "Comunidad sin dueño.");
    if (ownerId === uid) throw new HttpsError("failed-precondition", "No puedes suscribirte a tu propia comunidad.");

    // ¿Ya suscrito activo?
    const memberSnap = await db.doc(`users/${uid}/groupMemberships/${groupId}`).get();
    if (memberSnap.exists && memberSnap.data()?.subscriptionActive === true) {
      throw new HttpsError("failed-precondition", "Ya tienes una suscripción activa a esta comunidad.");
    }

    // Comunidad oculta = invite-only: exige un token de invitación válido para el
    // grupo. Se marca el uso al activar la membresía (más abajo).
    let inviteRefToConsume: admin.firestore.DocumentReference | null = null;
    if (String(group.visibility) === "hidden") {
      const inviteToken = String(data.inviteToken ?? "").trim();
      if (!inviteToken) {
        throw new HttpsError("permission-denied", "Necesitas una invitación válida para suscribirte a esta comunidad.");
      }
      const inv = await db.collectionGroup("inviteLinks").where("token", "==", inviteToken).limit(1).get();
      const invDoc = inv.empty ? null : inv.docs[0];
      const invData = invDoc?.data() as Record<string, unknown> | undefined;
      const expMs = (invData?.expiresAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
      const valid =
        !!invDoc &&
        String(invData?.groupId) === groupId &&
        invData?.isActive === true &&
        !invData?.revokedAt &&
        expMs > Date.now() &&
        (invData?.maxUses == null || num(invData?.usedCount) < num(invData?.maxUses));
      if (!valid || !invDoc) {
        throw new HttpsError("permission-denied", "La invitación no es válida o expiró.");
      }
      inviteRefToConsume = invDoc.ref;
    }

    const effectiveEmail = MP_SANDBOX
      ? SANDBOX_PAYER_EMAIL
      : String(data.payerEmail ?? request.auth?.token?.email ?? "").trim();
    if (!effectiveEmail) throw new HttpsError("invalid-argument", "Falta el correo del pagador.");

    const externalReference = `groupSub__${groupId}_${uid}`;
    const groupName = String(group.name ?? "la comunidad");

    // 🧾 IVA — La suscripción es recurrente: el comprador paga base + IVA cada mes.
    // `sub.price` es la BASE (la ganancia del creador se registra sobre la base más
    // abajo, NO sobre lo cobrado). El Preapproval cobra base + IVA.
    // 🔁 DLOCAL-MIGRATION: país fiscal por IP del cliente; hacerlo autoritativo al migrar.
    const subTax = applyConsumptionTax(sub.price, String(data.taxCountry ?? "") || null);

    const res = await mpFetch<MpPreapproval>("/preapproval", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      body: {
        reason: `Suscripción a ${groupName}`.slice(0, 255),
        external_reference: externalReference,
        payer_email: effectiveEmail,
        card_token_id: token,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: subTax.chargedAmount,
          currency_id: MP_CURRENCY,
        },
        back_url: `${BACK_URL_BASE}/${groupId}`,
        status: "authorized",
      },
    });

    if (!res.ok) {
      logger.error("payGroupSubscription preapproval_failed", { groupId, uid, status: res.status });
      throw new HttpsError("internal", "No se pudo crear la suscripción. Intenta de nuevo.");
    }
    const pre = res.data;
    const mpStatus = String(pre.status ?? "").toLowerCase();
    const preapprovalId = String(pre.id ?? "");
    const authorized = mpStatus === "authorized";

    const now = new Date();
    const periodEnd = addMonths(now, 1);

    await db.collection("groupSubscriptions").doc(`${groupId}_${uid}`).set(
      {
        groupId,
        uid,
        ownerId,
        groupName,
        mpPreapprovalId: preapprovalId,
        status: authorized ? "authorized" : "pending",
        priceMonthly: sub.price, // BASE mensual (ganancia del creador se calcula sobre esto)
        // 🧾 IVA — desglose del cobro mensual (base + IVA). Registro fiscal.
        taxCountry: subTax.taxCountry,
        taxRate: subTax.taxRate,
        taxMonthly: subTax.taxAmount,
        chargedMonthly: subTax.chargedAmount,
        currency: sub.currency,
        currentPeriodEnd: Timestamp.fromDate(periodEnd),
        accessUntil: Timestamp.fromDate(periodEnd),
        cancelAtPeriodEnd: false,
        gracePeriodEnd: null,
        active: authorized,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Si MP autorizó de inmediato, activa la membresía (acceso ya). El earning lo
    // registra el webhook subscription_authorized_payment (fuente de verdad del dinero).
    if (authorized) {
      await activateSubscribedMembership(groupId, uid, group, {
        ownerId,
        priceMonthly: sub.price,
        currency: sub.currency,
        accessUntil: periodEnd,
      });
      // Marca el uso de la invitación (best-effort; no tumba la suscripción).
      if (inviteRefToConsume) {
        await inviteRefToConsume
          .update({
            usedCount: FieldValue.increment(1),
            lastUsedAt: FieldValue.serverTimestamp(),
            lastUsedBy: uid,
            updatedAt: FieldValue.serverTimestamp(),
          })
          .catch(() => undefined);
      }
    }

    return {
      status: authorized ? "authorized" : mpStatus === "pending" ? "pending" : "rejected",
      subscriptionId: `${groupId}_${uid}`,
    };
  }
);

// ── Callable: cancelar (conserva acceso hasta fin del periodo) ────────────────
export const cancelGroupSubscription = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const groupId = String(data.groupId ?? "").trim();
    if (!groupId) throw new HttpsError("invalid-argument", "Falta la comunidad.");

    const subRef = db.collection("groupSubscriptions").doc(`${groupId}_${uid}`);
    const subSnap = await subRef.get();
    if (!subSnap.exists) throw new HttpsError("not-found", "No tienes una suscripción a esta comunidad.");
    const sub = subSnap.data() as Record<string, unknown>;
    if (String(sub.uid) !== uid) throw new HttpsError("permission-denied", "Esta suscripción no es tuya.");

    const preId = String(sub.mpPreapprovalId ?? "");
    if (preId) {
      // Detiene futuros cobros en MP (best-effort; si falla, igual marcamos local).
      const res = await mpFetch(`/preapproval/${preId}`, { method: "PUT", body: { status: "cancelled" } });
      if (!res.ok) logger.warn("cancelGroupSubscription mp_cancel_failed", { groupId, uid, status: res.status });
    }

    // Acceso hasta fin del periodo ya pagado: NO tocamos accessUntil ni la membresía.
    await subRef.set(
      { status: "cancelled", cancelAtPeriodEnd: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { status: "cancelled", accessUntil: sub.accessUntil ?? null };
  }
);

// ── Webhook: reconcilia notificaciones de suscripción de MP ───────────────────
// Llamado desde mpWebhook para topics `subscription_authorized_payment` y
// `subscription_preapproval`. Idempotente.
export async function reconcileMpSubscription(type: string, dataId: string): Promise<void> {
  if (type === "subscription_authorized_payment") {
    const res = await mpFetch<MpAuthorizedPayment>(`/authorized_payments/${dataId}`);
    if (!res.ok) return;
    const ap = res.data;
    const preapprovalId = String(ap.preapproval_id ?? "");
    if (!preapprovalId) return;

    const q = await db.collection("groupSubscriptions").where("mpPreapprovalId", "==", preapprovalId).limit(1).get();
    if (q.empty) return;
    const subDoc = q.docs[0];
    const sub = subDoc.data();
    const groupId = String(sub.groupId);
    const uid = String(sub.uid);
    const ownerId = String(sub.ownerId);
    const status = String(ap.status ?? "").toLowerCase();

    if (["approved", "accredited", "processed"].includes(status)) {
      // Cobro aprobado → extiende un mes desde el fin de periodo vigente (o ahora).
      const prevEnd = (sub.currentPeriodEnd as admin.firestore.Timestamp | undefined)?.toDate?.() ?? new Date();
      const from = prevEnd > new Date() ? prevEnd : new Date();
      const newEnd = addMonths(from, 1);

      await subDoc.ref.set(
        {
          status: "authorized",
          active: true,
          currentPeriodEnd: Timestamp.fromDate(newEnd),
          accessUntil: Timestamp.fromDate(newEnd),
          gracePeriodEnd: null,
          lastPaymentAt: FieldValue.serverTimestamp(),
          lastPaymentId: String(ap.id ?? dataId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const groupSnap = await db.collection("groups").doc(groupId).get();
      if (groupSnap.exists && ownerId !== uid) {
        await activateSubscribedMembership(groupId, uid, groupSnap.data() as Record<string, unknown>, {
          ownerId,
          priceMonthly: num(sub.priceMonthly),
          currency: str(sub.currency) || "MXN",
          accessUntil: newEnd,
        });
      }

      // Earning por ESTE cobro (idempotente por el id del pago autorizado).
      // 🧾 IVA — Se registra sobre la BASE (sub.priceMonthly), NO sobre lo cobrado
      // (ap.transaction_amount = base + IVA). El IVA es de Vibra hacia el SAT, no del
      // creador. El fallback a transaction_amount es solo para suscripciones legacy
      // sin priceMonthly (creadas antes de guardar la base).
      const gross = num(sub.priceMonthly) || num(ap.transaction_amount);
      if (ownerId && ownerId !== uid && gross > 0) {
        await recordEarning(ownerId, {
          type: "subscription",
          grossAmount: gross,
          // 🧾 IVA — impuesto de ESTE cobro mensual (informativo; va al SAT, no al creador).
          taxCountry: str(sub.taxCountry),
          taxAmount: num(sub.taxMonthly),
          sourceType: "groupSubscription",
          sourceId: `${groupId}_${uid}_${String(ap.id ?? dataId)}`,
          buyerId: uid,
          earnedImmediately: true,
          channelType: "group",
          channelId: groupId,
        });
      }
    } else if (["rejected", "cancelled"].includes(status)) {
      // Cobro fallido → 5 días de gracia con acceso.
      const grace = new Date(Date.now() + GRACE_MS);
      await subDoc.ref.set(
        {
          status: "past_due",
          gracePeriodEnd: Timestamp.fromDate(grace),
          accessUntil: Timestamp.fromDate(grace),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await patchMembershipExpiry(groupId, uid, grace);
    }
    return;
  }

  if (type === "subscription_preapproval") {
    const res = await mpFetch<MpPreapproval>(`/preapproval/${dataId}`);
    if (!res.ok) return;
    const pre = res.data;
    const status = String(pre.status ?? "").toLowerCase();

    const q = await db.collection("groupSubscriptions").where("mpPreapprovalId", "==", dataId).limit(1).get();
    if (q.empty) return;
    const subDoc = q.docs[0];
    const sub = subDoc.data();
    const groupId = String(sub.groupId);
    const uid = String(sub.uid);
    const ownerId = String(sub.ownerId);

    if (status === "authorized") {
      // Red de seguridad: asegura membresía activa (por si la respuesta síncrona se perdió).
      const groupSnap = await db.collection("groups").doc(groupId).get();
      if (groupSnap.exists && ownerId !== uid) {
        const end = (sub.currentPeriodEnd as admin.firestore.Timestamp | undefined)?.toDate?.() ?? addMonths(new Date(), 1);
        await subDoc.ref.set({ status: "authorized", active: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await activateSubscribedMembership(groupId, uid, groupSnap.data() as Record<string, unknown>, {
          ownerId,
          priceMonthly: num(sub.priceMonthly),
          currency: str(sub.currency) || "MXN",
          accessUntil: end,
        });
      }
    } else if (status === "cancelled") {
      // Cancelado en MP → conserva acceso hasta fin del periodo (no toca accessUntil).
      await subDoc.ref.set(
        { status: "cancelled", cancelAtPeriodEnd: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    } else if (status === "paused") {
      // Pausado → gracia de 5 días como una renovación fallida.
      const grace = new Date(Date.now() + GRACE_MS);
      await subDoc.ref.set(
        { status: "past_due", gracePeriodEnd: Timestamp.fromDate(grace), accessUntil: Timestamp.fromDate(grace), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      await patchMembershipExpiry(groupId, uid, grace);
    }
    return;
  }
}

// ── Programado: expira suscripciones cuyo acceso ya venció ────────────────────
// Corre a diario. Da de baja la membresía cuando `accessUntil <= now` y la
// suscripción sigue activa (cancelada que llegó a fin de periodo, o gracia vencida).
export async function expireGroupSubscriptionsHandler(): Promise<void> {
  const now = Timestamp.now();
  const snap = await db
    .collection("groupSubscriptions")
    .where("active", "==", true)
    .where("accessUntil", "<=", now)
    .limit(300)
    .get();

  for (const doc of snap.docs) {
    const s = doc.data();
    const groupId = String(s.groupId);
    const uid = String(s.uid);
    try {
      await deactivateSubscribedMembership(groupId, uid);
      await doc.ref.set(
        {
          active: false,
          status: s.status === "past_due" ? "expired" : s.cancelAtPeriodEnd ? "ended" : "expired",
          endedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      logger.error("expireGroupSubscriptions failed", { groupId, uid, err: err instanceof Error ? err.message : String(err) });
    }
  }
}
