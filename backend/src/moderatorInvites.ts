// Invitaciones a MODERAR una comunidad.
//
// Por qué existe: hasta ahora solo se podía ascender a moderador a alguien que
// YA era integrante. En una comunidad de suscripción eso obliga al moderador a
// pagar para poder moderar, lo cual no tiene sentido. Con este flujo el dueño
// invita a cualquier persona de Vibra y, si acepta, entra a la comunidad y queda
// como moderador en un solo paso — sin pasar por la caja.
//
// Dos callables:
//   · inviteGroupModerator        → el dueño invita (crea la invitación + avisa).
//   · respondGroupModeratorInvite → el invitado acepta o rechaza (y avisa de vuelta).
//
// La comunidad OCULTA nunca entra aquí: no se le revela su existencia a alguien
// que no está dentro.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import {
  notifyModeratorInvite,
  notifyModeratorInviteResponse,
} from "./notifications";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();
const REGION = "us-central1";

type AnyRecord = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Copia denormalizada de la comunidad que vive en
 * `users/{uid}/groupMemberships/{groupId}`. Mismos campos que usa el alta por
 * solicitud, pero con rol de moderador y acceso concedido (no pagado).
 */
function buildModeratorMembershipSummary(params: {
  groupId: string;
  userId: string;
  groupData: AnyRecord;
}) {
  const g = params.groupData;

  const groupName = str(g.name);
  const groupAvatarUrl = str(g.avatarUrl);
  const groupCoverUrl = str(g.coverUrl);
  const groupVisibility = str(g.visibility);

  return {
    groupId: params.groupId,
    userId: params.userId,

    roleInGroup: "mod",
    role: "mod",
    status: "active",

    // Acceso concedido por invitación a moderar: NO requiere suscripción y no
    // debe confundirse con el acceso gratis heredado (`legacy_free`), que sí se
    // puede retirar en masa desde la configuración de la suscripción.
    accessType: "moderator_grant",
    requiresSubscription: false,
    subscriptionActive: false,

    groupName,
    groupDescription: str(g.description),
    groupImageUrl: str(g.imageUrl),
    groupAvatarUrl,
    groupCoverUrl,
    groupOwnerId: str(g.ownerId),
    groupVisibility,
    groupDiscoverable: typeof g.discoverable === "boolean" ? g.discoverable : null,
    groupIsActive: typeof g.isActive === "boolean" ? g.isActive : null,
    groupCategory: str(g.category),

    name: groupName,
    description: str(g.description),
    imageUrl: str(g.imageUrl),
    avatarUrl: groupAvatarUrl,
    coverUrl: groupCoverUrl,
    ownerId: str(g.ownerId),
    visibility: groupVisibility,
    discoverable: typeof g.discoverable === "boolean" ? g.discoverable : null,
    isActive: typeof g.isActive === "boolean" ? g.isActive : null,
    category: str(g.category),

    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** EL DUEÑO invita a alguien a moderar (sea o no integrante). */
export const inviteGroupModerator = onCall({ region: REGION }, async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

  const data = (request.data ?? {}) as AnyRecord;
  const groupId = str(data.groupId);
  const userId = str(data.userId);

  if (!groupId || !userId) {
    throw new HttpsError("invalid-argument", "groupId y userId son requeridos.");
  }
  if (userId === callerUid) {
    throw new HttpsError("failed-precondition", "Ya eres el dueño de la comunidad.");
  }

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) throw new HttpsError("not-found", "La comunidad no existe.");

  const groupData = (groupSnap.data() ?? {}) as AnyRecord;

  // Solo el dueño reparte moderadores.
  if (str(groupData.ownerId) !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "Solo el dueño puede invitar moderadores."
    );
  }

  // Nunca en comunidades ocultas.
  if (str(groupData.visibility) === "hidden") {
    throw new HttpsError(
      "failed-precondition",
      "Una comunidad oculta no puede invitar moderadores desde fuera."
    );
  }

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "La persona no existe.");

  const memberSnap = await groupRef.collection("members").doc(userId).get();
  if (memberSnap.exists) {
    const member = memberSnap.data() ?? {};
    const status = str(member.status);
    const role = str(member.roleInGroup) ?? str(member.role);

    if (status === "banned") {
      throw new HttpsError(
        "failed-precondition",
        "Esta persona está baneada de la comunidad. Quita el ban primero."
      );
    }
    if (role === "mod" || role === "moderator") {
      throw new HttpsError("failed-precondition", "Esta persona ya es moderadora.");
    }
  }

  const inviteRef = groupRef.collection("moderatorInvites").doc(userId);
  const existing = await inviteRef.get();
  if (existing.exists && existing.data()?.status === "pending") {
    throw new HttpsError("failed-precondition", "Ya tiene una invitación pendiente.");
  }

  const now = FieldValue.serverTimestamp();
  await inviteRef.set(
    {
      groupId,
      userId,
      status: "pending",
      invitedBy: callerUid,
      createdAt: now,
      updatedAt: now,
      respondedAt: null,
    },
    { merge: true }
  );

  await notifyModeratorInvite(groupId, userId, callerUid);

  return { success: true };
});

/** EL INVITADO acepta o rechaza. Aceptar = entra a la comunidad ya como moderador. */
export const respondGroupModeratorInvite = onCall(
  { region: REGION },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as AnyRecord;
    const groupId = str(data.groupId);
    const accept = data.accept === true;

    if (!groupId) throw new HttpsError("invalid-argument", "groupId es requerido.");

    const groupRef = db.collection("groups").doc(groupId);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) throw new HttpsError("not-found", "La comunidad no existe.");

    const groupData = (groupSnap.data() ?? {}) as AnyRecord;
    const inviteRef = groupRef.collection("moderatorInvites").doc(callerUid);
    const memberRef = groupRef.collection("members").doc(callerUid);
    const membershipRef = db
      .collection("users")
      .doc(callerUid)
      .collection("groupMemberships")
      .doc(groupId);

    let invitedBy: string | null = null;

    await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) {
        throw new HttpsError("not-found", "La invitación ya no existe.");
      }

      const invite = inviteSnap.data() ?? {};
      if (invite.status !== "pending") {
        throw new HttpsError("failed-precondition", "Esta invitación ya fue respondida.");
      }
      invitedBy = str(invite.invitedBy);

      const now = FieldValue.serverTimestamp();

      if (!accept) {
        tx.set(
          inviteRef,
          { status: "rejected", respondedAt: now, updatedAt: now },
          { merge: true }
        );
        return;
      }

      // Un baneado no puede colarse aceptando una invitación vieja.
      const memberSnap = await tx.get(memberRef);
      if (memberSnap.exists && memberSnap.data()?.status === "banned") {
        throw new HttpsError(
          "failed-precondition",
          "No puedes aceptar: estás baneado de esta comunidad."
        );
      }

      const alreadyMember = memberSnap.exists;

      // Alta (si hacía falta) + ascenso, en la misma operación.
      tx.set(
        memberRef,
        {
          userId: callerUid,
          roleInGroup: "mod",
          role: "mod",
          status: "active",
          mutedUntil: null,
          accessType: "moderator_grant",
          moderatorSince: now,
          updatedAt: now,
          ...(alreadyMember ? {} : { joinedAt: now }),
        },
        { merge: true }
      );

      tx.set(
        membershipRef,
        {
          ...buildModeratorMembershipSummary({
            groupId,
            userId: callerUid,
            groupData,
          }),
          ...(alreadyMember ? {} : { joinedAt: now }),
        },
        { merge: true }
      );

      tx.set(
        inviteRef,
        { status: "accepted", respondedAt: now, updatedAt: now },
        { merge: true }
      );
    });

    // Avisar a quien invitó, en ambos casos.
    if (invitedBy) {
      await notifyModeratorInviteResponse(groupId, invitedBy, callerUid, accept);
    }

    return { success: true, accepted: accept };
  }
);
