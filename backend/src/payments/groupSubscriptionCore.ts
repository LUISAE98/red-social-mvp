// Núcleo COMPARTIDO de suscripción a comunidad — agnóstico al procesador de pago.
// Lo usa el motor de Stripe (groupSubscriptionStripe.ts + los handlers de suscripción del
// webhook). Convive temporalmente con el motor legacy de MP (groupSubscription.ts) hasta
// su teardown; cuando se borre MP, este núcleo permanece.
//
// Regla de dinero (unificada 2026-08-05): el suscriptor paga (base + $3) × IVA cada mes;
// el creador recibe 75% de la base. `base` = precio mensual que fija el creador.

import { HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { applyConsumptionTax } from "../tax/config";
import { FIXED_SERVICE_FEE_USD } from "../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

/** 5 días de gracia con acceso tras una renovación fallida. */
export const GRACE_MS = 5 * 24 * 60 * 60 * 1000;

export function numOr0(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function strOr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
 * (el dinero lo registra el reconciliador por cada cobro). Fija `subscriptionExpiresAt`
 * = fecha hasta la que hay acceso (el frontend muestra "Suscrito hasta …").
 */
export async function activateSubscribedMembership(
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

    // No reactivar (ni dar acceso a) un miembro BANEADO aunque entre un cobro de
    // suscripción. El flujo de ban cancela la suscripción; esto es defensa por si
    // un cobro se cuela antes de la cancelación. Se preserva el status "banned".
    if (memberSnap.exists && memberSnap.data()?.status === "banned") {
      logger.warn("activateSubscribedMembership: omitido, miembro baneado", { groupId, uid });
      return;
    }

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
export async function patchMembershipExpiry(groupId: string, uid: string, until: Date): Promise<void> {
  const expiresAt = Timestamp.fromDate(until);
  await Promise.all([
    db.doc(`groups/${groupId}/members/${uid}`).set({ subscriptionExpiresAt: expiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    db.doc(`users/${uid}/groupMemberships/${groupId}`).set({ subscriptionExpiresAt: expiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
  ]);
}

/** Da de baja el acceso: borra la membresía (dispara onGroupSubscriptionChurn). */
export async function deactivateSubscribedMembership(groupId: string, uid: string): Promise<void> {
  await Promise.all([
    db.doc(`groups/${groupId}/members/${uid}`).delete(),
    db.doc(`users/${uid}/groupMemberships/${groupId}`).delete(),
  ]);
}

/**
 * Programado (cron diario): expira las suscripciones cuyo acceso ya venció. Da de baja
 * la membresía cuando `accessUntil <= now` y sigue activa (cancelada que llegó a fin de
 * periodo, o gracia vencida). Agnóstico al procesador (opera sobre `accessUntil`).
 */
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

/** Config de suscripción del grupo (modelo nuevo con fallback legacy). */
export function readGroupSub(group: Record<string, unknown>): { enabled: boolean; price: number; currency: string } {
  const m = (group.monetization ?? {}) as Record<string, unknown>;
  const enabled = m.subscriptionsEnabled === true || m.isPaid === true;
  const price = numOr0(m.subscriptionPriceMonthly) || numOr0(m.priceMonthly);
  const currency =
    (typeof m.subscriptionCurrency === "string" && m.subscriptionCurrency) ||
    (typeof m.currency === "string" && m.currency) ||
    "MXN";
  return { enabled, price, currency };
}

/**
 * Valida que un `inviteToken` sea válido para el grupo (comunidad oculta = invite-only).
 * Devuelve la ref del invite (para marcar su uso al activar la membresía), o lanza.
 */
export async function validateInviteForGroup(
  groupId: string,
  inviteToken: string
): Promise<admin.firestore.DocumentReference> {
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
    (invData?.maxUses == null || numOr0(invData?.usedCount) < numOr0(invData?.maxUses));
  if (!valid || !invDoc) {
    throw new HttpsError("permission-denied", "La invitación no es válida o expiró.");
  }
  return invDoc.ref;
}

/**
 * RESERVA el cupo de una invitación antes de cobrar nada.
 *
 * ── Por qué reservar y no comprobar ──────────────────────────────────────────
 * Antes se validaba el tope con una lectura simple al empezar el checkout, y el
 * webhook lo re-comprobaba al llegar la factura: si ya estaba agotado, dejaba de
 * incrementar el contador **pero activaba la membresía igual**. Dos personas
 * usando el último cupo a la vez pagaban las dos y entraban las dos a una
 * comunidad oculta, con el contador aparentando estar bien.
 *
 * Reservando aquí, quien llega cuando ya no hay cupo se queda fuera **sin haber
 * pagado**. Desaparece el problema de qué hacer con alguien a quien ya le
 * cobraste, que no tiene buena respuesta.
 *
 * ⚠️ La reserva es por persona e idempotente: reintentar el checkout no consume
 * otro cupo. Se guarda en `inviteReservations/{token}_{uid}`.
 *
 * ⚠️ **Residuo conocido:** quien reserva y abandona el pago retiene el cupo. Se
 * prefiere así —un cupo retenido se arregla con una invitación nueva; un intruso
 * en una comunidad oculta, no—. Si molesta, se libera con un cron como el de las
 * reservas de saldo.
 */
export async function reserveInviteSlot(
  groupId: string,
  inviteToken: string,
  uid: string
): Promise<void> {
  const reservaRef = db.collection("inviteReservations").doc(`${inviteToken}_${uid}`);

  // ⚠️ La reserva propia se mira ANTES de validar la invitación, y el orden no es
  // cosmético. `validateInviteForGroup` exige que quede cupo y que el enlace siga
  // activo, y al reservar el último cupo el enlace se desactiva: quien acababa de
  // reservar chocaba contra su propia reserva al reintentar el pago.
  if ((await reservaRef.get()).exists) return;

  const ref = await validateInviteForGroup(groupId, inviteToken);

  await db.runTransaction(async (tx) => {
    const [invSnap, reservaSnap] = await Promise.all([tx.get(ref), tx.get(reservaRef)]);

    if (reservaSnap.exists) return; // ya tenía cupo: reintento del mismo comprador

    const d = (invSnap.data() ?? {}) as { usedCount?: number; maxUses?: number | null };
    const usados = typeof d.usedCount === "number" ? d.usedCount : 0;
    const max = typeof d.maxUses === "number" ? d.maxUses : null;

    if (max !== null && usados >= max) {
      throw new HttpsError("permission-denied", "Esta invitación ya no tiene cupos disponibles.");
    }

    const siguiente = usados + 1;
    tx.update(ref, {
      usedCount: siguiente,
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUsedBy: uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(max !== null && siguiente >= max ? { isActive: false } : {}),
    });

    tx.set(reservaRef, {
      token: inviteToken,
      groupId,
      uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

export type MonthlyCharge = {
  base: number; // base mensual del creador (ganancia = 75% de esto)
  fixedFee: number; // $3 fijo que absorbe el comprador
  published: number; // base + $3
  taxCountry: string | null;
  taxRate: number;
  taxMonthly: number; // IVA sobre (base + $3)
  chargedMonthly: number; // total que paga el comprador cada mes
};

/** Cobro mensual = (base + $3) × IVA. Igual que los otros servicios. */
export function computeMonthlyCharge(base: number, country: string): MonthlyCharge {
  const published = round2(base + FIXED_SERVICE_FEE_USD);
  const tax = applyConsumptionTax(published, country);
  return {
    base: round2(base),
    fixedFee: FIXED_SERVICE_FEE_USD,
    published,
    taxCountry: tax.taxCountry,
    taxRate: tax.taxRate,
    taxMonthly: tax.taxAmount,
    chargedMonthly: round2(published + tax.taxAmount),
  };
}
