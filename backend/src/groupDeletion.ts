import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { cancelGroupSubscriptions } from "./payments/stripe/cancelGroupSubscriptions";
import { stripeSecretKey } from "./payments/stripe/stripeClient";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

const REGION = "us-central1";
const WRITE_BATCH_LIMIT = 450;

function requireAuth(request: { auth?: { uid?: string } }): string {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  return uid;
}

function normalizeString(value: unknown, fieldName: string): string {
  const cleanValue = typeof value === "string" ? value.trim() : "";

  if (!cleanValue) {
    throw new HttpsError("invalid-argument", `${fieldName} es requerido.`);
  }

  return cleanValue;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleanValue = value.trim();

  return cleanValue.length > 0 ? cleanValue : null;
}

function isGroupAlreadyDeleted(groupData: Record<string, unknown>): boolean {
  return groupData.isDeleted === true || Boolean(groupData.deletedAt);
}

function buildGroupDeletedPatch(actorUid: string, reason: string | null) {
  return {
    isActive: false,
    isDeleted: true,
    deletedAt: FieldValue.serverTimestamp(),
    deletedBy: actorUid,
    deletionReason: reason || "owner_deleted",

    visibility: "hidden",
    discoverable: false,

    search: {
      isActive: false,
      isDeleted: true,
      discoverable: false,
      visibility: "hidden",
      deletedAt: FieldValue.serverTimestamp(),
    },

    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildPostDeletedPatch(params: {
  actorUid: string;
  groupId: string;
  reason: string | null;
}) {
  return {
    isDeleted: true,
    deletedAt: FieldValue.serverTimestamp(),
    deletedBy: params.actorUid,
    deletedReason: params.reason || "group_deleted",
    groupDeletedAt: FieldValue.serverTimestamp(),
    groupDeletionReason: params.reason || "group_deleted",

    search: {
      isDeleted: true,
      isVisible: false,
      deletedAt: FieldValue.serverTimestamp(),
    },

    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildMemberRemovedPatch(params: {
  actorUid: string;
  groupId: string;
  reason: string | null;
}) {
  return {
    status: "removed",
    removedAt: FieldValue.serverTimestamp(),
    removedBy: params.actorUid,
    removedReason: params.reason || "group_deleted",

    groupIsActive: false,
    groupIsDeleted: true,
    groupDeletedAt: FieldValue.serverTimestamp(),

    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildJoinRequestClosedPatch(params: {
  actorUid: string;
  groupId: string;
  reason: string | null;
}) {
  return {
    status: "closed",
    closedAt: FieldValue.serverTimestamp(),
    closedBy: params.actorUid,
    closedReason: params.reason || "group_deleted",

    groupIsActive: false,
    groupIsDeleted: true,
    groupDeletedAt: FieldValue.serverTimestamp(),

    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildInviteLinkRevokedPatch(params: {
  actorUid: string;
  groupId: string;
  reason: string | null;
}) {
  return {
    isActive: false,
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy: params.actorUid,
    revokedReason: params.reason || "group_deleted",

    groupIsActive: false,
    groupIsDeleted: true,
    groupDeletedAt: FieldValue.serverTimestamp(),

    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function commitBatches(
  refs: FirebaseFirestore.DocumentReference[],
  operation: "delete"
): Promise<number> {
  let affected = 0;

  for (let i = 0; i < refs.length; i += WRITE_BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = refs.slice(i, i + WRITE_BATCH_LIMIT);

    chunk.forEach((ref) => {
      if (operation === "delete") {
        batch.delete(ref);
      }
    });

    await batch.commit();
    affected += chunk.length;
  }

  return affected;
}

async function patchDocuments(
  refs: FirebaseFirestore.DocumentReference[],
  patch: Record<string, unknown>
): Promise<number> {
  let affected = 0;

  for (let i = 0; i < refs.length; i += WRITE_BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = refs.slice(i, i + WRITE_BATCH_LIMIT);

    chunk.forEach((ref) => {
      batch.set(ref, patch, { merge: true });
    });

    await batch.commit();
    affected += chunk.length;
  }

  return affected;
}

async function softDeleteGroupInternal(params: {
  groupId: string;
  actorUid: string;
  reason: string | null;
}) {
  const { groupId, actorUid, reason } = params;

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "La comunidad no existe.");
  }

  const groupData = groupSnap.data() as Record<string, unknown>;
  const ownerId =
    typeof groupData.ownerId === "string" ? groupData.ownerId.trim() : "";

  if (!ownerId) {
    throw new HttpsError(
      "failed-precondition",
      "La comunidad no tiene ownerId válido."
    );
  }

  if (ownerId !== actorUid) {
    throw new HttpsError(
      "permission-denied",
      "Solo el creador puede eliminar esta comunidad."
    );
  }

  // ⚠️ Estar marcada como borrada NO significa que el borrado terminara.
  //
  // Antes se salía aquí mismo. Y el orden es: marcar primero, limpiar después —
  // así que si la limpieza fallaba a media (posts, miembros, invitaciones,
  // suscripciones), el reintento veía la marca, decía "ya estaba borrada" y se
  // iba. La comunidad quedaba a medio borrar **para siempre**, con suscripciones
  // cobrando y sin ninguna forma de reanudar.
  //
  // Ahora la marca solo evita volver a marcar. Todo lo demás se reejecuta: son
  // escrituras idempotentes (parches con `merge` y borrados), así que repetirlas
  // no hace daño y sí termina lo que quedó a medias.
  const yaMarcada = isGroupAlreadyDeleted(groupData);

  // ⚠️ EL DINERO PRIMERO. La cancelación de las suscripciones iba al final, después
  // de barrer posts, miembros, solicitudes e invitaciones — así que cualquier
  // fallo previo dejaba a los compradores pagando cada mes una comunidad que ya
  // no existe. De todo lo que hace esta función, esto es lo único que le cuesta
  // dinero a alguien si no ocurre; el resto solo deja documentos sin limpiar.
  const subscriptionsCancelled = await cancelGroupSubscriptions(groupId);

  const [postsSnap, membersSnap, joinRequestsSnap, inviteLinksSnap] =
    await Promise.all([
      db.collection("posts").where("groupId", "==", groupId).get(),
      groupRef.collection("members").get(),
      groupRef.collection("joinRequests").get(),
      groupRef.collection("inviteLinks").get(),
    ]);

  const postRefs = postsSnap.docs.map((docSnap) => docSnap.ref);
  const memberRefs = membersSnap.docs.map((docSnap) => docSnap.ref);
  const joinRequestRefs = joinRequestsSnap.docs.map((docSnap) => docSnap.ref);
  const inviteLinkRefs = inviteLinksSnap.docs.map((docSnap) => docSnap.ref);

  const memberUserIds = membersSnap.docs
    .map((docSnap) => docSnap.id)
    .filter((uid) => typeof uid === "string" && uid.trim().length > 0);

  const requesterUserIds = joinRequestsSnap.docs
    .map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const raw = data.userId ?? data.uid ?? data.requesterId ?? data.createdBy ?? docSnap.id;
      return typeof raw === "string" ? raw : undefined;
    })
    .filter((uid): uid is string => typeof uid === "string" && uid.trim().length > 0);

  const affectedUserIds = Array.from(
    new Set([...memberUserIds, ...requesterUserIds])
  );

  const postIds = postsSnap.docs.map((docSnap) => docSnap.id);

  const userMembershipRefs = affectedUserIds.map((uid) =>
    db.collection("users").doc(uid).collection("groupMemberships").doc(groupId)
  );

  const userJoinRequestRefs = requesterUserIds.map((uid) =>
    db.collection("users").doc(uid).collection("joinRequestsSent").doc(groupId)
  );

  const homeFeedRefs = affectedUserIds.flatMap((uid) =>
    postIds.map((postId) =>
      db.collection("users").doc(uid).collection("homeFeed").doc(postId)
    )
  );

  await db.runTransaction(async (transaction) => {
    const freshGroupSnap = await transaction.get(groupRef);

    if (!freshGroupSnap.exists) {
      throw new HttpsError("not-found", "La comunidad no existe.");
    }

    const freshGroupData = freshGroupSnap.data() as Record<string, unknown>;

    if (isGroupAlreadyDeleted(freshGroupData)) {
      return;
    }

    const freshOwnerId =
      typeof freshGroupData.ownerId === "string"
        ? freshGroupData.ownerId.trim()
        : "";

    if (freshOwnerId !== actorUid) {
      throw new HttpsError(
        "permission-denied",
        "Solo el creador puede eliminar esta comunidad."
      );
    }

    transaction.set(
      groupRef,
      buildGroupDeletedPatch(actorUid, reason),
      { merge: true }
    );

    transaction.set(
      db.collection("auditLogs").doc(),
      {
        action: "group.soft_delete",
        actorUid,
        targetType: "group",
        targetId: groupId,
        groupId,
        ownerId: freshOwnerId,
        reason: reason || "owner_deleted",
        createdAt: FieldValue.serverTimestamp(),
        metadata: {
          previousVisibility: freshGroupData.visibility ?? null,
          previousIsActive: freshGroupData.isActive ?? null,
          previousDiscoverable: freshGroupData.discoverable ?? null,
        },
      },
      { merge: true }
    );
  });

  const [
    postsUpdated,
    membersUpdated,
    userMembershipsUpdated,
    joinRequestsUpdated,
    inviteLinksUpdated,
    userJoinRequestsDeleted,
    homeFeedDeleted,
  ] = await Promise.all([
    patchDocuments(
      postRefs,
      buildPostDeletedPatch({
        actorUid,
        groupId,
        reason,
      })
    ),
    patchDocuments(
      memberRefs,
      buildMemberRemovedPatch({
        actorUid,
        groupId,
        reason,
      })
    ),
    patchDocuments(
      userMembershipRefs,
      buildMemberRemovedPatch({
        actorUid,
        groupId,
        reason,
      })
    ),
    patchDocuments(
      joinRequestRefs,
      buildJoinRequestClosedPatch({
        actorUid,
        groupId,
        reason,
      })
    ),
    patchDocuments(
      inviteLinkRefs,
      buildInviteLinkRevokedPatch({
        actorUid,
        groupId,
        reason,
      })
    ),
    commitBatches(userJoinRequestRefs, "delete"),
    commitBatches(homeFeedRefs, "delete"),
  ]);

  logger.info("softDeleteGroup completed", {
    groupId,
    actorUid,
    subscriptionsCancelled,
    postsUpdated,
    membersUpdated,
    userMembershipsUpdated,
    homeFeedDeleted,
    joinRequestsUpdated,
    userJoinRequestsDeleted,
    inviteLinksUpdated,
  });

  return {
    ok: true,
    groupId,
    // `true` = ya estaba marcada y esta pasada fue una REANUDACIÓN: se volvió a
    // barrer lo que hubiera quedado a medias, no un borrado nuevo.
    alreadyDeleted: yaMarcada,
    postsUpdated,
    membersUpdated,
    userMembershipsUpdated,
    homeFeedDeleted,
    joinRequestsUpdated,
    userJoinRequestsDeleted,
    inviteLinksUpdated,
  };
}

export const softDeleteGroup = onCall(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    // ⚠️ SIN esto, cancelar las suscripciones en Stripe falla SIEMPRE y en
    // silencio: `stripeSecretKey.value()` devuelve vacío, `stripeFetch` responde
    // "falta el secreto" y el helper —que es tolerante a fallos— lo registra y
    // sigue. O sea que la comunidad se borraba y los compradores seguían pagando,
    // que es justo lo que ese arreglo venía a impedir. Declarar el secreto es
    // parte del arreglo, no un detalle de configuración.
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const actorUid = requireAuth(request);
    const groupId = normalizeString(request.data?.groupId, "groupId");
    const reason = normalizeOptionalString(request.data?.reason);

    return softDeleteGroupInternal({
      groupId,
      actorUid,
      reason,
    });
  }
);