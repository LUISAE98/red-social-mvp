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
import { cancelGroupSubscriptionImmediately } from "./payments/stripe/groupSubscriptionStripe";
import { stripeSecretKey } from "./payments/stripe/stripeClient";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();
const REGION = "us-central1";

// Caducidad de una invitación a moderador. Sin tope, una invitación pendiente
// vivía para siempre y podía aceptarse cuando la comunidad ya era otra cosa.
/**
 * Estados que impiden aceptar una invitación de moderador.
 *
 * `muted` también entra: si un silenciado pudiera aceptar, este mismo flujo lo
 * reescribiría como `active` con rol de moderador y se auto-levantaría la sanción.
 */
const ESTADOS_SANCIONADOS = new Set(["banned", "removed", "kicked", "expelled", "muted"]);

const INVITE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
    throw new HttpsError("failed-precondition", "Ya eres el creador de la comunidad.");
  }

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) throw new HttpsError("not-found", "La comunidad no existe.");

  const groupData = (groupSnap.data() ?? {}) as AnyRecord;

  // Solo el dueño reparte moderadores.
  if (str(groupData.ownerId) !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "Solo el creador puede invitar moderadores."
    );
  }

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "La persona no existe.");

  const memberSnap = await groupRef.collection("members").doc(userId).get();

  /**
   * En una comunidad oculta solo se invita HACIA DENTRO.
   *
   * Lo que hay que proteger es su existencia: mandarle una invitación a alguien
   * de fuera le revela el nombre de una comunidad que no debería saber que
   * existe. A quien ya es integrante no se le revela nada — ya está dentro y ya
   * la ve—, así que ascenderlo a moderador es seguro.
   */
  if (str(groupData.visibility) === "hidden" && !memberSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Una comunidad oculta no puede invitar moderadores desde fuera."
    );
  }

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
  { region: REGION, secrets: [stripeSecretKey] },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as AnyRecord;
    const groupId = str(data.groupId);
    const accept = data.accept === true;

    if (!groupId) throw new HttpsError("invalid-argument", "groupId es requerido.");

    // La comunidad NO se lee aquí: se lee dentro de la transacción, junto con la
    // invitación y la membresía. Leerla antes solo servía para validar contra un
    // retrato viejo, que es justo lo que hacía inútil la transacción.
    const groupRef = db.collection("groups").doc(groupId);
    const inviteRef = groupRef.collection("moderatorInvites").doc(callerUid);
    const memberRef = groupRef.collection("members").doc(callerUid);
    const membershipRef = db
      .collection("users")
      .doc(callerUid)
      .collection("groupMemberships")
      .doc(groupId);

    let invitedBy: string | null = null;

    await db.runTransaction(async (tx) => {
      // ⚠️ Los TRES documentos se leen DENTRO de la transacción.
      //
      // El estado de la comunidad se leía antes de abrirla (`groupSnap`, arriba) y
      // se validaba aquí con esa copia. Entre una cosa y otra la comunidad puede
      // volverse oculta, pausarse o borrarse, y la transacción no protegía nada:
      // aceptaba contra un retrato viejo. Leyéndola aquí, si cambia mientras
      // tanto Firestore aborta y reintenta con el estado nuevo.
      //
      // Las tres lecturas van juntas y ANTES de cualquier escritura, que es lo
      // que exige una transacción de Firestore.
      const [inviteSnap, grupoSnap, memberSnap] = await Promise.all([
        tx.get(inviteRef),
        tx.get(groupRef),
        tx.get(memberRef),
      ]);

      if (!inviteSnap.exists) {
        throw new HttpsError("not-found", "La invitación ya no existe.");
      }
      if (!grupoSnap.exists) {
        throw new HttpsError("not-found", "La comunidad ya no existe.");
      }
      const grupo = (grupoSnap.data() ?? {}) as AnyRecord;

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

      // ⚠️ Las condiciones se comprobaban SOLO al invitar, nunca al aceptar, y
      // una invitación pendiente no caducaba jamás. Así que bastaba con invitar
      // a alguien mientras la comunidad era pública, volverla oculta después, y
      // que aceptara meses más tarde para entrar de moderador a una comunidad
      // oculta — justo lo que la comprobación de `inviteGroupModerator` prohíbe.
      // Todo lo que se valida al invitar hay que revalidarlo al aceptar: entre
      // los dos momentos puede pasar cualquier cosa.

      const createdAtMs = invite.createdAt?.toMillis?.() ?? 0;
      if (createdAtMs && Date.now() - createdAtMs > INVITE_MAX_AGE_MS) {
        tx.set(
          inviteRef,
          { status: "expired", respondedAt: now, updatedAt: now },
          { merge: true }
        );
        throw new HttpsError(
          "failed-precondition",
          "Esta invitación caducó. Pídele al creador que te invite de nuevo."
        );
      }

      // Igual que al invitar: en una oculta solo entra quien ya estaba dentro.
      // Si la comunidad se volvió oculta con la invitación en el aire y la
      // persona no es integrante, aceptar la metería desde fuera.
      if (str(grupo.visibility) === "hidden" && !memberSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Esta comunidad pasó a ser oculta. El creador debe invitarte desde dentro."
        );
      }

      if (("isActive" in grupo && grupo.isActive !== true) || grupo.isDeleted === true) {
        throw new HttpsError(
          "failed-precondition",
          "Esta comunidad ya no está activa."
        );
      }

      // ⚠️ NINGÚN estado sancionado puede colarse aceptando una invitación vieja.
      //
      // Antes solo se miraba `banned`. Pero expulsar a alguien tampoco borra su
      // invitación pendiente, y `removed`/`kicked`/`expelled` pasaban el filtro:
      // el expulsado aceptaba y este mismo código lo reescribía como
      // `status: "active"` con rol de moderador. O sea que echar a alguien no
      // servía de nada si le quedaba una invitación viva.
      const estado = (str(memberSnap.data()?.status) ?? "").toLowerCase();
      if (ESTADOS_SANCIONADOS.has(estado)) {
        // La invitación se marca consumida: dejarla pendiente es dejar la puerta
        // abierta para el siguiente intento.
        tx.set(
          inviteRef,
          { status: "revoked", respondedAt: now, revokedReason: `member_${estado}`, updatedAt: now },
          { merge: true }
        );
        throw new HttpsError(
          "failed-precondition",
          "No puedes aceptar esta invitación con tu estado actual en la comunidad."
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
            // La copia FRESCA leída en la transacción, no la de antes de abrirla:
            // si no, la membresía nace con el nombre, el avatar o la visibilidad
            // que tenía la comunidad hace un rato.
            groupData: grupo,
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

    /**
     * Moderar no se paga.
     *
     * Quien ya estaba suscrito pasa a acceder por su rol (accessType
     * "moderator_grant", que no exige suscripción), así que seguir cobrándole
     * sería cobrar por algo que ya tiene gratis. Se corta al aceptar.
     *
     * Va DESPUÉS de la transacción y sin await bloqueante del resultado: habla
     * con Stripe por red y una transacción de Firestore no puede depender de
     * eso. El helper es best-effort y ya registra sus propios fallos; si Stripe
     * no responde, el ascenso sigue siendo válido y el cobro se revisa a mano.
     *
     * No se devuelve el dinero de los días ya pagados: la persona no pierde
     * acceso —lo conserva como moderadora—, así que no hay servicio sin prestar.
     */
    if (accept) {
      await cancelGroupSubscriptionImmediately(groupId, callerUid, "moderator_grant");
    }

    // Avisar a quien invitó, en ambos casos.
    if (invitedBy) {
      await notifyModeratorInviteResponse(groupId, invitedBy, callerUid, accept);
    }

    return { success: true, accepted: accept };
  }
);
