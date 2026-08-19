import { onCall, HttpsError } from "firebase-functions/v2/https";
import { SETTLEMENT_CURRENCY } from "./wallet/ledger";
import { logger } from "firebase-functions";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import { notifyGroupNewMemberFromInvite } from "./notifications";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

type GroupVisibility = "public" | "private" | "hidden" | string;
type MemberStatus =
  | "active"
  | "muted"
  | "banned"
  | "removed"
  | "kicked"
  | "expelled"
  | string
  | null;

function normalizeToken(raw: unknown) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
}

function generateInviteToken() {
  return randomBytes(24).toString("hex");
}

function isRestrictedMemberStatus(status: MemberStatus) {
  return (
    status === "banned" ||
    status === "removed" ||
    status === "kicked" ||
    status === "expelled"
  );
}

function isReadableMemberStatus(status: MemberStatus) {
  return status === "active" || status === "muted";
}

type GroupSubscriptionConfig = {
  requiresSubscription: boolean;
  price: number | null;
  currency: string | null;
};

/** Lee la config de suscripción desde `group.monetization` (server-side). */
function readGroupSubscription(groupData: unknown): GroupSubscriptionConfig {
  const monetization =
    groupData && typeof groupData === "object"
      ? ((groupData as { monetization?: unknown }).monetization as
          | {
              subscriptionsEnabled?: unknown;
              subscriptionPriceMonthly?: unknown;
              priceMonthly?: unknown;
              subscriptionCurrency?: unknown;
              currency?: unknown;
            }
          | undefined)
      : undefined;

  if (monetization?.subscriptionsEnabled !== true) {
    return { requiresSubscription: false, price: null, currency: null };
  }

  const priceRaw =
    monetization?.subscriptionPriceMonthly ?? monetization?.priceMonthly ?? null;
  const price =
    typeof priceRaw === "number" && Number.isFinite(priceRaw) ? priceRaw : null;

  const currency =
    (typeof monetization?.subscriptionCurrency === "string" &&
      monetization.subscriptionCurrency) ||
    (typeof monetization?.currency === "string" && monetization.currency) ||
    SETTLEMENT_CURRENCY;

  return { requiresSubscription: true, price, currency };
}

function buildInviteDocData(args: {
  groupId: string;
  createdBy: string;
  expiresAt: Timestamp;
  maxUses: number | null;
  token: string;
}) {
  return {
    token: args.token,
    groupId: args.groupId,
    createdBy: args.createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: args.expiresAt,
    revokedAt: null,
    isActive: true,
    usedCount: 0,
    maxUses: args.maxUses,
    lastUsedAt: null,
    lastUsedBy: null,
  };
}

function serializeTimestamp(value?: Timestamp | null) {
  if (!value) return null;
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
}

function isHttpsErrorLike(err: unknown): err is HttpsError {
  return !!err && typeof err === "object" && "code" in err && "message" in err;
}

/**
 * CREATE INVITE LINK
 * - Solo owner
 * - Solo comunidades private / hidden
 * - Expiración obligatoria
 * - maxUses opcional
 */
export const createInviteLink = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const groupId = String(request.data?.groupId ?? "").trim();
  const expiresInHoursRaw = Number(request.data?.expiresInHours ?? 168);
  const maxUsesRaw =
    request.data?.maxUses == null || request.data?.maxUses === ""
      ? null
      : Number(request.data?.maxUses);

  logger.info("createInviteLink start", {
    callerUid,
    groupId,
    expiresInHoursRaw,
    maxUsesRaw,
  });

  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId es requerido.");
  }

    if (
    Number.isNaN(expiresInHoursRaw) ||
    !Number.isFinite(expiresInHoursRaw) ||
    expiresInHoursRaw < 1 / 60 ||
    expiresInHoursRaw > 24 * 30
  ) {
    throw new HttpsError(
      "invalid-argument",
      "expiresInHours debe estar entre 1 minuto y 720 horas."
    );
  }

  if (
    maxUsesRaw !== null &&
    (Number.isNaN(maxUsesRaw) ||
      !Number.isFinite(maxUsesRaw) ||
      maxUsesRaw < 1 ||
      maxUsesRaw > 1000)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "maxUses debe estar entre 1 y 1000."
    );
  }

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Comunidad no existe.");
  }

  const groupData = groupSnap.data() as {
    ownerId?: string;
    visibility?: GroupVisibility;
    isActive?: boolean;
    name?: string;
  };

  if (groupData?.ownerId !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "Solo el creador puede generar links."
    );
  }

  if (groupData?.isActive !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Solo se pueden generar links para comunidades activas."
    );
  }

  if (
    groupData?.visibility !== "private" &&
    groupData?.visibility !== "hidden"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Solo las comunidades privadas u ocultas pueden usar links de invitación."
    );
  }

  // Tope de 2 links vigentes por comunidad. Se cuentan solo los que siguen
  // válidos (isActive y no expirados); los revocados/agotados/expirados no cuentan.
  const nowForLimit = Date.now();
  const activeLinksSnap = await groupRef
    .collection("inviteLinks")
    .where("isActive", "==", true)
    .get();
  const activeLinksCount = activeLinksSnap.docs.filter((d) => {
    const exp = d.get("expiresAt") as Timestamp | undefined;
    return !!exp && exp.toMillis() > nowForLimit;
  }).length;
  if (activeLinksCount >= 2) {
    throw new HttpsError(
      "failed-precondition",
      "Ya tienes 2 links activos. Mata uno antes de crear otro."
    );
  }

  const token = generateInviteToken();
  const nowMs = Date.now();
  const expiresAt = Timestamp.fromMillis(
    nowMs + expiresInHoursRaw * 60 * 60 * 1000
  );

  const inviteRef = groupRef.collection("inviteLinks").doc();

  await inviteRef.set(
    buildInviteDocData({
      groupId,
      createdBy: callerUid,
      expiresAt,
      maxUses: maxUsesRaw,
      token,
    })
  );

  logger.info("createInviteLink success", {
    callerUid,
    groupId,
    inviteLinkId: inviteRef.id,
    visibility: groupData?.visibility ?? null,
    expiresAt: serializeTimestamp(expiresAt),
    maxUses: maxUsesRaw,
  });

  return {
    success: true,
    inviteLinkId: inviteRef.id,
    token,
    path: `/invite/${token}`,
    groupId,
    groupName: groupData?.name ?? "",
    visibility: groupData?.visibility ?? null,
    expiresAt: expiresAt.toDate().toISOString(),
    maxUses: maxUsesRaw,
  };
});

/**
 * GET INVITE LINK PREVIEW
 * - Devuelve metadata segura para renderizar /invite/[token]
 * - No expone el documento ni da acceso directo a Firestore
 */
export const getInviteLinkPreview = onCall(async (request) => {
  const token = normalizeToken(request.data?.token);

  logger.info("getInviteLinkPreview start", {
    tokenPrefix: token.slice(0, 10),
  });

  if (!token) {
    throw new HttpsError("invalid-argument", "token es requerido.");
  }

  const inviteSnap = await db
    .collectionGroup("inviteLinks")
    .where("token", "==", token)
    .limit(1)
    .get();

  if (inviteSnap.empty) {
    throw new HttpsError("not-found", "Link de invitación no encontrado.");
  }

  const inviteDoc = inviteSnap.docs[0];
  const inviteData = inviteDoc.data() as {
    groupId?: string;
    expiresAt?: Timestamp;
    revokedAt?: Timestamp | null;
    isActive?: boolean;
    maxUses?: number | null;
    usedCount?: number;
  };

  const groupId = String(inviteData?.groupId ?? "").trim();
  if (!groupId) {
    throw new HttpsError("failed-precondition", "Invite link inválido.");
  }

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Comunidad no encontrada.");
  }

  const groupData = groupSnap.data() as {
    name?: string;
    description?: string;
    visibility?: GroupVisibility;
    isActive?: boolean;
    avatarUrl?: string | null;
    coverUrl?: string | null;
    monetization?: unknown;
  };

  // Toda comunidad de suscripción (oculta o privada) pide "Suscribirme" + pago Stripe por
  // invitación. El acceso lo concede el webhook tras el cobro, nunca `consumeInviteLink`.
  const subscription = readGroupSubscription(groupData);
  const requiresSubscription = subscription.requiresSubscription;

  const expiresAt = inviteData?.expiresAt ?? null;
  const isExpired = !expiresAt || expiresAt.toMillis() <= Date.now();

  const maxUses = inviteData?.maxUses ?? null;
  const usedCount = Number(inviteData?.usedCount ?? 0);
  const exhausted = maxUses !== null && usedCount >= maxUses;
  const revoked = !!inviteData?.revokedAt;
  const active = inviteData?.isActive === true;
  const groupActive = groupData?.isActive === true;

  logger.info("getInviteLinkPreview success", {
    groupId,
    visibility: groupData?.visibility ?? null,
    isExpired,
    exhausted,
    revoked,
    active,
    groupActive,
    usedCount,
    maxUses,
  });

  return {
    success: true,
    token,
    group: {
      id: groupId,
      name: groupData?.name ?? "",
      description: groupData?.description ?? "",
      visibility: groupData?.visibility ?? null,
      avatarUrl: groupData?.avatarUrl ?? null,
      coverUrl: groupData?.coverUrl ?? null,
      isActive: groupActive,
      requiresSubscription,
      subscriptionPrice: requiresSubscription ? subscription.price : null,
      subscriptionCurrency: requiresSubscription ? subscription.currency : null,
    },
    invite: {
      isActive: active,
      isExpired,
      exhausted,
      revoked,
      usedCount,
      maxUses,
      expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null,
    },
  };
});

/**
 * CONSUME INVITE LINK
 * - Requiere auth
 * - private -> crea joinRequest pending
 * - hidden -> crea membership directa
 * - respeta banned / removed / kicked / expelled
 * - incrementa usedCount
 */
export const consumeInviteLink = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const token = normalizeToken(request.data?.token);
  if (!token) {
    throw new HttpsError("invalid-argument", "token es requerido.");
  }

  logger.info("consumeInviteLink start", {
    callerUid,
    tokenPrefix: token.slice(0, 10),
  });

  try {
    const inviteQuerySnap = await db
      .collectionGroup("inviteLinks")
      .where("token", "==", token)
      .limit(1)
      .get();

    if (inviteQuerySnap.empty) {
      throw new HttpsError("not-found", "Link de invitación no encontrado.");
    }

    const inviteRef = inviteQuerySnap.docs[0].ref;

    logger.info("consumeInviteLink invite found", {
      callerUid,
      invitePath: inviteRef.path,
    });

    // Capturado dentro de la transacción para diferenciar el aviso al owner
    // (nuevo suscriptor vs miembro gratuito) al notificar tras el commit.
    let joinedAsSubscriber = false;

    const result = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) {
        throw new HttpsError("not-found", "Link de invitación no encontrado.");
      }

      const inviteData = inviteSnap.data() as {
        groupId?: string;
        isActive?: boolean;
        revokedAt?: Timestamp | null;
        expiresAt?: Timestamp;
        usedCount?: number;
        maxUses?: number | null;
      };

      const groupId = String(inviteData?.groupId ?? "").trim();
      if (!groupId) {
        throw new HttpsError("failed-precondition", "Invite link inválido.");
      }

      const groupRef = db.collection("groups").doc(groupId);
      const memberRef = groupRef.collection("members").doc(callerUid);
      const joinRequestRef = groupRef.collection("joinRequests").doc(callerUid);

      const userMembershipRef = db
        .collection("users")
        .doc(callerUid)
        .collection("groupMemberships")
        .doc(groupId);

      const userJoinRequestSentRef = db
        .collection("users")
        .doc(callerUid)
        .collection("joinRequestsSent")
        .doc(groupId);

      const groupSnap = await tx.get(groupRef);
      const memberSnap = await tx.get(memberRef);
      const joinRequestSnap = await tx.get(joinRequestRef);

      if (!groupSnap.exists) {
        throw new HttpsError("not-found", "Comunidad no existe.");
      }

      const groupData = groupSnap.data() as {
        ownerId?: string;
        visibility?: GroupVisibility;
        isActive?: boolean;
        name?: string;
        description?: string | null;
        imageUrl?: string | null;
        avatarUrl?: string | null;
        coverUrl?: string | null;
        discoverable?: boolean | null;
        category?: string | null;
      };

      logger.info("consumeInviteLink transaction state", {
        callerUid,
        groupId,
        groupVisibility: groupData?.visibility ?? null,
        groupActive: groupData?.isActive ?? null,
        inviteActive: inviteData?.isActive ?? null,
        inviteExpiresAt: serializeTimestamp(inviteData?.expiresAt ?? null),
        inviteRevoked: !!inviteData?.revokedAt,
        usedCount: Number(inviteData?.usedCount ?? 0),
        maxUses: inviteData?.maxUses ?? null,
        memberExists: memberSnap.exists,
        joinRequestExists: joinRequestSnap.exists,
      });

      if (groupData?.isActive !== true) {
        throw new HttpsError(
          "failed-precondition",
          "La comunidad ya no está activa."
        );
      }

      if (
        groupData?.visibility !== "private" &&
        groupData?.visibility !== "hidden"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Este link ya no corresponde a una comunidad elegible."
        );
      }

      if (groupData?.ownerId === callerUid) {
        return {
          success: true,
          groupId,
          groupName: groupData?.name ?? "",
          visibility: groupData?.visibility ?? null,
          outcome: "owner",
          message: "Eres el creador de esta comunidad.",
        };
      }

      if (inviteData?.isActive !== true) {
        throw new HttpsError(
          "failed-precondition",
          "Este link ya no está activo."
        );
      }

      if (inviteData?.revokedAt) {
        throw new HttpsError(
          "failed-precondition",
          "Este link fue revocado."
        );
      }

      if (
        !inviteData?.expiresAt ||
        inviteData.expiresAt.toMillis() <= Date.now()
      ) {
        throw new HttpsError("deadline-exceeded", "Este link ya expiró.");
      }

      const usedCount = Number(inviteData?.usedCount ?? 0);
      const maxUses = inviteData?.maxUses ?? null;

      if (maxUses !== null && usedCount >= maxUses) {
        throw new HttpsError(
          "resource-exhausted",
          "Este link ya alcanzó su límite de usos."
        );
      }

      const memberStatus = memberSnap.exists
        ? ((memberSnap.data()?.status ?? "active") as MemberStatus)
        : null;

      if (isRestrictedMemberStatus(memberStatus)) {
        throw new HttpsError(
          "permission-denied",
          "No puedes usar este link para entrar a esta comunidad."
        );
      }

      if (isReadableMemberStatus(memberStatus)) {
        // Miembro existente que reabre el link: NO consume un uso. El uso solo
        // cuenta cuando alguien se vuelve miembro/suscriptor por primera vez.
        tx.delete(userJoinRequestSentRef);

        return {
          success: true,
          groupId,
          groupName: groupData?.name ?? "",
          visibility: groupData?.visibility ?? null,
          outcome: "already_joined",
          message: "Ya formas parte de esta comunidad.",
        };
      }

      // Comunidades de SUSCRIPCIÓN: el acceso NUNCA se concede gratis por invitación. Debe
      // pagarse por Stripe (createGroupSubscription → webhook invoice.paid, patrón
      // pagar-luego-conceder). Este `onCall` es público: sin este guard, un usuario con un
      // token válido podría llamarlo directo (fuera de la UI) y obtener membresía suscrita
      // gratis en una oculta de pago; y en una privada de pago crear una solicitud que al
      // aprobarse daría acceso sin cobro. Ambos huecos quedan cerrados aquí.
      if (readGroupSubscription(groupData).requiresSubscription) {
        throw new HttpsError(
          "failed-precondition",
          "Esta comunidad requiere suscripción. Completa el pago para unirte."
        );
      }

      if (groupData?.visibility === "hidden") {
        const groupName =
          typeof groupData?.name === "string" ? groupData.name : null;
        const groupDescription =
          typeof groupData?.description === "string"
            ? groupData.description
            : null;
        const groupImageUrl =
          typeof groupData?.imageUrl === "string" ? groupData.imageUrl : null;
        const groupAvatarUrl =
          typeof groupData?.avatarUrl === "string"
            ? groupData.avatarUrl
            : null;
        const groupCoverUrl =
          typeof groupData?.coverUrl === "string" ? groupData.coverUrl : null;
        const groupOwnerId =
          typeof groupData?.ownerId === "string" ? groupData.ownerId : null;
        const groupVisibility =
          typeof groupData?.visibility === "string"
            ? groupData.visibility
            : null;
        const groupDiscoverable =
          typeof groupData?.discoverable === "boolean"
            ? groupData.discoverable
            : null;
        const groupIsActive =
          typeof groupData?.isActive === "boolean" ? groupData.isActive : null;
        const groupCategory =
          typeof groupData?.category === "string" ? groupData.category : null;

        // Comunidad oculta de suscripción → membresía suscrita (equivalente al
        // pago simulado); gratuita → membresía estándar directa.
        const subscription = readGroupSubscription(groupData);
        joinedAsSubscriber = subscription.requiresSubscription;
        const membershipCore = subscription.requiresSubscription
          ? {
              status: "subscribed",
              accessType: "subscription",
              requiresSubscription: true,
              subscriptionActive: true,
              subscriptionPriceMonthly: subscription.price,
              subscriptionCurrency: subscription.currency ?? SETTLEMENT_CURRENCY,
              subscribedAt: FieldValue.serverTimestamp(),
            }
          : {
              status: "active",
              accessType: "standard",
              requiresSubscription: false,
              subscriptionActive: false,
            };

        const memberPatch = {
          userId: callerUid,
          roleInGroup: "member",
          role: "member",
          ...membershipCore,
          // Marca para que onGroupMemberCreated omita esta unión: la notificación
          // al owner se emite server-side tras el commit (el merge-set puede ser
          // update y no dispararía el trigger de creación).
          joinSource: "invite_link",
          joinedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        tx.set(memberRef, memberPatch, { merge: true });

        tx.set(
          userMembershipRef,
          {
            groupId,
            userId: callerUid,

            roleInGroup: "member",
            role: "member",
            ...membershipCore,

            groupName,
            groupDescription,
            groupImageUrl,
            groupAvatarUrl,
            groupCoverUrl,
            groupOwnerId,
            groupVisibility,
            groupDiscoverable,
            groupIsActive,
            groupCategory,

            name: groupName,
            description: groupDescription,
            imageUrl: groupImageUrl,
            avatarUrl: groupAvatarUrl,
            coverUrl: groupCoverUrl,
            ownerId: groupOwnerId,
            visibility: groupVisibility,
            discoverable: groupDiscoverable,
            isActive: groupIsActive,
            category: groupCategory,

            joinedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (joinRequestSnap.exists) {
          tx.delete(joinRequestRef);
        }

        tx.delete(userJoinRequestSentRef);
      } else {
        if (!joinRequestSnap.exists) {
          const joinRequestPatch = {
            userId: callerUid,
            groupId,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            source: "invite_link",
            // ⚠️ Se guarda QUÉ invitación trajo a esta persona.
            //
            // En una comunidad privada el uso no se cuenta aquí (todavía no es
            // miembro, solo hay una solicitud), y al aprobarla no había forma de
            // saber de qué enlace venía: el uso no se contaba NUNCA. `maxUses`
            // era decorativo en privadas — un enlace de 10 admitía a los que
            // hiciera falta.
            inviteToken: token,
          };

          tx.set(joinRequestRef, joinRequestPatch, { merge: true });

          tx.set(
            userJoinRequestSentRef,
            joinRequestPatch,
            { merge: true }
          );
        }
      }

      // El uso se cuenta SOLO cuando alguien se vuelve miembro/suscriptor:
      // comunidad oculta → membresía directa (o suscripción). En privada se crea
      // una solicitud pendiente (aún no es miembro), así que NO consume uso.
      if (groupData?.visibility === "hidden") {
        tx.update(inviteRef, {
          usedCount: FieldValue.increment(1),
          lastUsedAt: FieldValue.serverTimestamp(),
          lastUsedBy: callerUid,
          updatedAt: FieldValue.serverTimestamp(),
          ...(maxUses !== null && usedCount + 1 >= maxUses
            ? { isActive: false }
            : {}),
        });
      }

      return {
        success: true,
        groupId,
        groupName: groupData?.name ?? "",
        visibility: groupData?.visibility ?? null,
        outcome: groupData?.visibility === "hidden" ? "joined" : "requested",
        message:
          groupData?.visibility === "hidden"
            ? "Te uniste correctamente a la comunidad."
            : "Tu solicitud de acceso fue enviada.",
      };
    });

    logger.info("consumeInviteLink success", {
      callerUid,
      groupId: result.groupId,
      outcome: result.outcome,
      visibility: result.visibility ?? null,
    });

    // Unión oculta efectiva → notificar al owner (server-side, ver memberPatch.joinSource).
    if (result.outcome === "joined" && result.visibility === "hidden") {
      try {
        await notifyGroupNewMemberFromInvite(
          result.groupId,
          callerUid,
          joinedAsSubscriber
        );
      } catch (notifyErr: unknown) {
        logger.error("consumeInviteLink notify owner failed", {
          callerUid,
          groupId: result.groupId,
          message:
            notifyErr instanceof Error ? notifyErr.message : "Error desconocido",
        });
      }
    }

    return result;
  } catch (err: unknown) {
    const errObj = err as { code?: unknown; message?: unknown; stack?: unknown } | null;
    logger.error("consumeInviteLink unexpected error", {
      callerUid,
      tokenPrefix: token.slice(0, 10),
      code: errObj?.code ?? null,
      message: errObj?.message ?? "Error desconocido",
      stack: errObj?.stack ?? null,
    });

    if (isHttpsErrorLike(err)) {
      throw err;
    }

    throw new HttpsError(
      "internal",
      (err instanceof Error ? err.message : null) ?? "Ocurrió un error interno al consumir el link."
    );
  }
});

/**
 * REVOKE INVITE LINK ("Matar link")
 * - Solo el owner del grupo.
 * - Marca el link como inactivo/revocado de inmediato (corta su vigencia ya).
 */
export const revokeInviteLink = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const groupId = String(request.data?.groupId ?? "").trim();
  const inviteLinkId = String(request.data?.inviteLinkId ?? "").trim();

  if (!groupId || !inviteLinkId) {
    throw new HttpsError(
      "invalid-argument",
      "groupId e inviteLinkId son requeridos."
    );
  }

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Comunidad no existe.");
  }
  if ((groupSnap.data() as { ownerId?: string })?.ownerId !== callerUid) {
    throw new HttpsError("permission-denied", "Solo el creador puede matar links.");
  }

  const inviteRef = groupRef.collection("inviteLinks").doc(inviteLinkId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "El link no existe.");
  }

  await inviteRef.update({
    isActive: false,
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy: callerUid,
    revokedReason: "manual",
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info("revokeInviteLink success", { callerUid, groupId, inviteLinkId });

  return { success: true, groupId, inviteLinkId };
});

/**
 * LIST INVITE LINKS
 * - Solo el owner.
 * - Devuelve los links VIGENTES (activos y no expirados) del grupo con su token,
 *   usos, límite y expiración, para pintarlos en la UI del dueño.
 */
export const listInviteLinks = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const groupId = String(request.data?.groupId ?? "").trim();
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId es requerido.");
  }

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Comunidad no existe.");
  }
  if ((groupSnap.data() as { ownerId?: string })?.ownerId !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "Solo el creador puede ver los links."
    );
  }

  const nowMs = Date.now();
  const snap = await groupRef
    .collection("inviteLinks")
    .where("isActive", "==", true)
    .get();

  const links = snap.docs
    .map((d) => {
      const data = d.data();
      const expiresAt = data.expiresAt as Timestamp | undefined;
      const createdAt = data.createdAt as Timestamp | undefined;
      const token = String(data.token ?? "");
      return {
        id: d.id,
        token,
        path: `/invite/${token}`,
        usedCount: Number(data.usedCount ?? 0),
        maxUses: (data.maxUses ?? null) as number | null,
        expiresAt: serializeTimestamp(expiresAt),
        expiresAtMs: expiresAt ? expiresAt.toMillis() : null,
        createdAtMs: createdAt ? createdAt.toMillis() : null,
      };
    })
    // Solo vigentes (no expirados aún, aunque el cron no los haya apagado).
    .filter((l) => l.expiresAtMs !== null && l.expiresAtMs > nowMs)
    // Más recientes primero.
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

  return { success: true, groupId, links };
});