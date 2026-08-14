import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { notifyGroupModeration } from "./notifications";
import { cancelGroupSubscriptionImmediately } from "./payments/stripe/groupSubscriptionStripe";
import { stripeSecretKey } from "./payments/stripe/stripeClient";

/** Notifica al miembro afectado sin tumbar la acción si el aviso falla. */
async function safeNotifyModeration(
  groupId: string,
  targetUserId: string,
  action: "muted" | "kicked" | "banned"
) {
  try {
    await notifyGroupModeration(groupId, targetUserId, action);
  } catch (err: unknown) {
    logger.error("group moderation notify failed", {
      groupId,
      targetUserId,
      action,
      message: err instanceof Error ? err.message : "Error desconocido",
    });
  }
}

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

type CanonicalGroupRole = "owner" | "mod" | "member";
type CanonicalMemberStatus = "active" | "muted" | "banned" | "removed";

function requireAuth(request: { auth?: { uid?: string } }) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  return uid as string;
}

function normalizeString(value: unknown, fieldName: string) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) {
    throw new HttpsError("invalid-argument", `${fieldName} es requerido.`);
  }
  return v;
}

function normalizeDurationDays(value: unknown) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new HttpsError(
      "invalid-argument",
      "durationDays debe ser un entero entre 1 y 365."
    );
  }
  return days;
}

function normalizeRole(raw: unknown): CanonicalGroupRole {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (value === "owner") return "owner";
  if (value === "mod" || value === "moderator") return "mod";
  return "member";
}

function normalizeStatus(raw: unknown): CanonicalMemberStatus {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (value === "muted") return "muted";
  if (value === "banned") return "banned";
  if (value === "removed" || value === "kicked" || value === "expelled") {
    return "removed";
  }
  return "active";
}

async function getGroupOrThrow(groupId: string) {
  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "La comunidad no existe.");
  }

  const data = groupSnap.data() as Record<string, unknown>;

  return {
    groupRef,
    data,
    ownerId: typeof data?.ownerId === "string" ? data.ownerId : "",
  };
}

/**
 * Rastro inmutable de una acción de moderación de comunidad.
 *
 * Las acciones dejaban su huella EN el propio documento de miembro
 * (`moderatedBy`, `bannedAt`, `removedAt`), y la siguiente acción la
 * sobrescribía. Así no se podía investigar el abuso de un moderador: cada
 * castigo borraba el anterior. Esto va a una colección aparte que solo escribe
 * el backend, y donde cada acción es una línea nueva.
 *
 * Importa especialmente porque banear CANCELA la suscripción de Stripe de esa
 * persona, así que un moderador de contenido puede cortar una relación de pago
 * del dueño. Es una decisión de producto válida, pero tiene que quedar anotada.
 */
async function logGroupModeration(entry: {
  groupId: string;
  action: string;
  actorUid: string;
  targetUserId: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.collection("groupModerationLog").add({
      ...entry,
      details: entry.details ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // El rastro no puede tumbar la acción de moderación en sí.
    logger.warn("logGroupModeration falló", {
      ...entry,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** ¿Esta comunidad cobra suscripción para entrar? */
async function groupIsSubscriptionBased(groupId: string): Promise<boolean> {
  const snap = await db.collection("groups").doc(groupId).get();
  const monetization = snap.get("monetization");
  if (!monetization || typeof monetization !== "object") return false;
  const m = monetization as Record<string, unknown>;
  return m.subscriptionsEnabled === true || m.isPaid === true;
}

/**
 * ¿La suscripción de esta persona a esta comunidad sigue vigente?
 *
 * Los documentos de `groupSubscriptions` NO se borran al terminar: quedan con
 * `active: false` y `status` en `ended`/`cancelled`/`past_due`. Comprobar solo
 * que existan haría pasar por suscriptor a quien dejó de pagar hace un año.
 */
async function hasCurrentSubscription(groupId: string, uid: string): Promise<boolean> {
  const snap = await db.collection("groupSubscriptions").doc(`${groupId}_${uid}`).get();
  if (!snap.exists) return false;
  if (snap.get("active") !== true) return false;

  const accessUntil = snap.get("accessUntil");
  if (!accessUntil || typeof accessUntil.toMillis !== "function") return false;
  return accessUntil.toMillis() > Date.now();
}

async function getMemberRefOrThrow(groupId: string, targetUserId: string) {
  const memberRef = db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .doc(targetUserId);

  const memberSnap = await memberRef.get();

  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "La membresía no existe.");
  }

  const memberData = memberSnap.data() as Record<string, unknown>;
  const role = normalizeRole(memberData?.roleInGroup ?? memberData?.role);

  if (role === "owner") {
    throw new HttpsError(
      "failed-precondition",
      "No se puede moderar al owner de la comunidad."
    );
  }

  return {
    memberRef,
    memberSnap,
    memberData,
    role,
    status: normalizeStatus(memberData?.status),
  };
}

async function getActorContextOrThrow(groupId: string, actorUid: string) {
  const { ownerId } = await getGroupOrThrow(groupId);

  if (ownerId === actorUid) {
    return {
      actorUid,
      actorRole: "owner" as CanonicalGroupRole,
      ownerId,
    };
  }

  const actorMemberRef = db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .doc(actorUid);

  const actorMemberSnap = await actorMemberRef.get();

  if (!actorMemberSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "No perteneces a esta comunidad."
    );
  }

  const actorData = actorMemberSnap.data() as Record<string, unknown>;
  const actorRole = normalizeRole(actorData?.roleInGroup ?? actorData?.role);
  const actorStatus = normalizeStatus(actorData?.status);

  // `muted` también queda fuera. Las Firestore Rules solo aceptan a un moderador
  // en `active` o `subscribed`, pero aquí se colaba: un moderador silenciado era
  // rechazado por las reglas y aceptado por estas callables, que usan Admin SDK y
  // se saltan las reglas. Normalmente silenciar a un moderador también lo degrada,
  // pero un dato antiguo o a medio migrar podía dejar `mod` + `muted`.
  if (
    actorStatus === "banned" ||
    actorStatus === "removed" ||
    actorStatus === "muted"
  ) {
    throw new HttpsError(
      "permission-denied",
      "No tienes permisos para realizar esta acción."
    );
  }

  if (actorRole !== "mod") {
    throw new HttpsError(
      "permission-denied",
      "Solo el owner o un moderador pueden realizar esta acción."
    );
  }

  return {
    actorUid,
    actorRole,
    ownerId,
  };
}

function ensureActorCanModerateTarget(
  actorRole: CanonicalGroupRole,
  actorUid: string,
  targetUserId: string,
  targetRole: CanonicalGroupRole
) {
  if (actorUid === targetUserId) {
    throw new HttpsError(
      "failed-precondition",
      "No puedes aplicarte esta acción a ti mismo."
    );
  }

  if (targetRole === "owner") {
    throw new HttpsError(
      "failed-precondition",
      "No se puede moderar al owner de la comunidad."
    );
  }

  if (actorRole === "mod" && targetRole === "mod") {
    throw new HttpsError(
      "permission-denied",
      "Un moderador no puede administrar a otro moderador."
    );
  }
}

function ensureOwnerOnly(actorRole: CanonicalGroupRole) {
  if (actorRole !== "owner") {
    throw new HttpsError(
      "permission-denied",
      "Solo el owner de la comunidad puede realizar esta acción."
    );
  }
}

function getJoinRequestRef(groupId: string, targetUserId: string) {
  return db
    .collection("groups")
    .doc(groupId)
    .collection("joinRequests")
    .doc(targetUserId);
}

function buildRoleDowngradePatch(actorUid: string) {
  return {
    roleInGroup: "member",
    role: "member",
    roleUpdatedAt: FieldValue.serverTimestamp(),
    roleUpdatedBy: actorUid,
  };
}

function getUserMembershipRef(groupId: string, targetUserId: string) {
  return db
    .collection("users")
    .doc(targetUserId)
    .collection("groupMemberships")
    .doc(groupId);
}

function getUserJoinRequestSentRef(groupId: string, targetUserId: string) {
  return db
    .collection("users")
    .doc(targetUserId)
    .collection("joinRequestsSent")
    .doc(groupId);
}

export const promoteGroupMemberToAdmin = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  ensureOwnerOnly(actorRole);

  const { memberRef, role, status } = await getMemberRefOrThrow(groupId, targetUserId);

  if (role === "mod") {
    return { ok: true, roleInGroup: "mod" };
  }

  if (status !== "active") {
    throw new HttpsError(
      "failed-precondition",
      "Solo puedes promover miembros activos."
    );
  }

  const userMembershipRef = getUserMembershipRef(groupId, targetUserId);
  const batch = db.batch();

  const patch = {
    roleInGroup: "mod",
    role: "mod",
    updatedAt: FieldValue.serverTimestamp(),
    roleUpdatedAt: FieldValue.serverTimestamp(),
    roleUpdatedBy: actorUid,
  };

  batch.set(memberRef, patch, { merge: true });
  batch.set(userMembershipRef, patch, { merge: true });

  await batch.commit();

  await logGroupModeration({
    groupId,
    action: "promote",
    actorUid,
    targetUserId,
  });

  return { ok: true, roleInGroup: "mod" };
});

export const demoteGroupAdminToMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  ensureOwnerOnly(actorRole);

  const { memberRef, role } = await getMemberRefOrThrow(groupId, targetUserId);

  if (role !== "mod") {
    return { ok: true, roleInGroup: "member" };
  }

  const userMembershipRef = getUserMembershipRef(groupId, targetUserId);
  const batch = db.batch();

  const patch = {
    roleInGroup: "member",
    role: "member",
    updatedAt: FieldValue.serverTimestamp(),
    roleUpdatedAt: FieldValue.serverTimestamp(),
    roleUpdatedBy: actorUid,
  };

  batch.set(memberRef, patch, { merge: true });
  batch.set(userMembershipRef, patch, { merge: true });

  await batch.commit();

  await logGroupModeration({
    groupId,
    action: "demote",
    actorUid,
    targetUserId,
  });

  return { ok: true, roleInGroup: "member" };
});

export const muteGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");
  const durationDays = normalizeDurationDays(request.data?.durationDays);

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const mutedUntilDate = new Date(
    Date.now() + durationDays * 24 * 60 * 60 * 1000
  );

  const userMembershipRef = getUserMembershipRef(groupId, targetUserId);
  const batch = db.batch();

  const patch = {
    status: "muted",
    mutedUntil: Timestamp.fromDate(mutedUntilDate),
    updatedAt: FieldValue.serverTimestamp(),
    moderatedBy: actorUid,
    ...buildRoleDowngradePatch(actorUid),
  };

  batch.set(memberRef, patch, { merge: true });
  batch.set(userMembershipRef, patch, { merge: true });

  await batch.commit();

  await safeNotifyModeration(groupId, targetUserId, "muted");

  await logGroupModeration({
    groupId,
    action: "mute",
    actorUid,
    targetUserId,
  });

  return {
    ok: true,
    mutedUntil: mutedUntilDate.toISOString(),
  };
});

export const unmuteGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const userMembershipRef = getUserMembershipRef(groupId, targetUserId);
  const batch = db.batch();

  const patch = {
    status: "active",
    mutedUntil: null,
    updatedAt: FieldValue.serverTimestamp(),
    moderatedBy: actorUid,
  };

  batch.set(memberRef, patch, { merge: true });
  batch.set(userMembershipRef, patch, { merge: true });

  await batch.commit();

  await logGroupModeration({
    groupId,
    action: "unmute",
    actorUid,
    targetUserId,
  });

  return { ok: true };
});

export const banGroupMember = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);
    const userMembershipRef = getUserMembershipRef(groupId, targetUserId);
  const userJoinRequestSentRef = getUserJoinRequestSentRef(
    groupId,
    targetUserId
  );
  const batch = db.batch();

  batch.set(
    memberRef,
    {
      status: "banned",
      mutedUntil: null,
      bannedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: actorUid,
      ...buildRoleDowngradePatch(actorUid),
    },
    { merge: true }
  );
    batch.set(
    userMembershipRef,
    {
      status: "banned",
      mutedUntil: null,
      bannedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: actorUid,
      ...buildRoleDowngradePatch(actorUid),
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);
  batch.delete(userJoinRequestSentRef);

  await batch.commit();

  // Cancela INMEDIATAMENTE la suscripción de pago del baneado (deja de cobrarle) y
  // revoca el acceso ligado a ella. Best-effort: no bloquea el ban si Stripe falla.
  await cancelGroupSubscriptionImmediately(groupId, targetUserId);

  await safeNotifyModeration(groupId, targetUserId, "banned");

  await logGroupModeration({
    groupId,
    action: "ban",
    actorUid,
    targetUserId,
  });

  return { ok: true };
});

export const unbanGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);
  const userMembershipRef = getUserMembershipRef(groupId, targetUserId);
  const userJoinRequestSentRef = getUserJoinRequestSentRef(
    groupId,
    targetUserId
  );
  // Desbanear NO puede regalar una suscripción. Al banear a alguien se le cancela
  // el cobro en Stripe, así que ponerlo de vuelta en `active` le devolvía TODO el
  // contenido de pago sin volver a pagar — y bastaba con hacerse banear y
  // desbanear para no pagar nunca. Si la comunidad es de pago y su suscripción ya
  // no está vigente, se le levanta el castigo pero se le quita la membresía:
  // vuelve a ser alguien de fuera que puede suscribirse otra vez.
  const paidAccessStillValid = await hasCurrentSubscription(groupId, targetUserId);
  const groupRequiresPayment = await groupIsSubscriptionBased(groupId);
  const restoreAsMember = !groupRequiresPayment || paidAccessStillValid;

  const batch = db.batch();

  if (restoreAsMember) {
    const restoredStatus = paidAccessStillValid && groupRequiresPayment ? "subscribed" : "active";

    batch.set(
      memberRef,
      {
        status: restoredStatus,
        mutedUntil: null,
        updatedAt: FieldValue.serverTimestamp(),
        unbannedAt: FieldValue.serverTimestamp(),
        moderatedBy: actorUid,
      },
      { merge: true }
    );

    batch.set(
      userMembershipRef,
      {
        status: restoredStatus,
        mutedUntil: null,
        updatedAt: FieldValue.serverTimestamp(),
        unbannedAt: FieldValue.serverTimestamp(),
        moderatedBy: actorUid,
      },
      { merge: true }
    );
  } else {
    // Comunidad de pago y sin suscripción viva: se va la membresía entera.
    batch.delete(memberRef);
    batch.delete(userMembershipRef);
  }

  batch.delete(joinRequestRef);
  batch.delete(userJoinRequestSentRef);

  await batch.commit();

  logger.info("unbanGroupMember", {
    groupId,
    targetUserId,
    actorUid,
    restoreAsMember,
    groupRequiresPayment,
    paidAccessStillValid,
  });

  await logGroupModeration({
    groupId,
    action: "unban",
    actorUid,
    targetUserId,
  });

  return { ok: true, restoredAsMember: restoreAsMember };
});

export const removeGroupMember = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const groupId = normalizeString(request.data?.groupId, "groupId");
  const targetUserId = normalizeString(request.data?.targetUserId, "targetUserId");

  const { actorRole } = await getActorContextOrThrow(groupId, actorUid);
  const { memberRef, role: targetRole } = await getMemberRefOrThrow(groupId, targetUserId);

  ensureActorCanModerateTarget(actorRole, actorUid, targetUserId, targetRole);

  const joinRequestRef = getJoinRequestRef(groupId, targetUserId);
    const userMembershipRef = getUserMembershipRef(groupId, targetUserId);
  const userJoinRequestSentRef = getUserJoinRequestSentRef(
    groupId,
    targetUserId
  );
  const batch = db.batch();

  batch.set(
    memberRef,
    {
      status: "removed",
      mutedUntil: null,
      removedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      moderatedBy: actorUid,
      ...buildRoleDowngradePatch(actorUid),
    },
    { merge: true }
  );

  batch.delete(joinRequestRef);
  batch.delete(userMembershipRef);
  batch.delete(userJoinRequestSentRef);
  await batch.commit();

  await safeNotifyModeration(groupId, targetUserId, "kicked");

  await logGroupModeration({
    groupId,
    action: "remove",
    actorUid,
    targetUserId,
  });

  return { ok: true };
});

export const cleanupExpiredGroupMutes = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
  },
  async () => {
    const now = Timestamp.now();
    let totalUpdated = 0;

    while (true) {
      const snap = await db
        .collectionGroup("members")
        .where("status", "==", "muted")
        .where("mutedUntil", "<=", now)
        .orderBy("mutedUntil")
        .limit(200)
        .get();

      if (snap.empty) {
        break;
      }

      const batch = db.batch();

      snap.docs.forEach((docSnap) => {
        const targetUserId = docSnap.id;
        const groupRef = docSnap.ref.parent.parent;
        const groupId = groupRef?.id ?? null;

        const patch = {
          status: "active",
          mutedUntil: null,
          updatedAt: FieldValue.serverTimestamp(),
          muteExpiredAt: FieldValue.serverTimestamp(),
        };

        batch.set(docSnap.ref, patch, { merge: true });

        if (groupId) {
          const userMembershipRef = getUserMembershipRef(groupId, targetUserId);
          batch.set(userMembershipRef, patch, { merge: true });
        }
      });

      await batch.commit();
      totalUpdated += snap.size;

      if (snap.size < 200) {
        break;
      }
    }

    logger.info("cleanupExpiredGroupMutes completed", {
      totalUpdated,
    });
  }
);