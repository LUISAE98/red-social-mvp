import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";

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
      "Solo el owner puede generar links."
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
  };

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
          message: "Eres el owner de esta comunidad.",
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
        tx.update(inviteRef, {
          usedCount: FieldValue.increment(1),
          lastUsedAt: FieldValue.serverTimestamp(),
          lastUsedBy: callerUid,
          updatedAt: FieldValue.serverTimestamp(),
          ...(maxUses !== null && usedCount + 1 >= maxUses
            ? { isActive: false }
            : {}),
        });

        return {
          success: true,
          groupId,
          groupName: groupData?.name ?? "",
          visibility: groupData?.visibility ?? null,
          outcome: "already_joined",
          message: "Ya formas parte de esta comunidad.",
        };
      }

      if (groupData?.visibility === "hidden") {
        tx.set(
          memberRef,
          {
            userId: callerUid,
            roleInGroup: "member",
            status: "active",
            joinedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (joinRequestSnap.exists) {
          tx.delete(joinRequestRef);
        }
      } else {
        if (!joinRequestSnap.exists) {
          tx.set(
            joinRequestRef,
            {
              userId: callerUid,
              status: "pending",
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              source: "invite_link",
            },
            { merge: true }
          );
        }
      }

      tx.update(inviteRef, {
        usedCount: FieldValue.increment(1),
        lastUsedAt: FieldValue.serverTimestamp(),
        lastUsedBy: callerUid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(maxUses !== null && usedCount + 1 >= maxUses
          ? { isActive: false }
          : {}),
      });

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

    return result;
  } catch (err: any) {
    logger.error("consumeInviteLink unexpected error", {
      callerUid,
      tokenPrefix: token.slice(0, 10),
      code: err?.code ?? null,
      message: err?.message ?? "Error desconocido",
      stack: err?.stack ?? null,
    });

    if (isHttpsErrorLike(err)) {
      throw err;
    }

    throw new HttpsError(
      "internal",
      err?.message ?? "Ocurrió un error interno al consumir el link."
    );
  }
});