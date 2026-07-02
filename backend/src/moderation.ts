import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

// ─── Constantes ─────────────────────────────────────────────────────────────

const VALID_TARGET_TYPES = [
  "post",
  "comment",
  "comment_reply",
  "live",
  "live_chat_message",
  "greeting",
  "user",
  "community",
  "meet_greet",
  "exclusive_session",
] as const;

const VALID_REASONS = [
  "spam",
  "hate_speech",
  "violence",
  "illegal_content",
  "harassment",
  "misinformation",
  "other",
] as const;

const VALID_ACTIONS = [
  "dismiss",
  "warn_user",
  "remove_content",
  "block_user",
  "report_to_authorities",
] as const;

type ReportTargetType = (typeof VALID_TARGET_TYPES)[number];
type ReportReason = (typeof VALID_REASONS)[number];
type ModeratorAction = (typeof VALID_ACTIONS)[number];

// ─── Helpers ────────────────────────────────────────────────────────────────

function requireAuth(request: { auth?: { uid?: string } }): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  return uid;
}

function requireModerator(request: {
  auth?: { uid?: string; token?: Record<string, unknown> };
}): string {
  const uid = requireAuth(request);
  if (request.auth?.token?.["role"] !== "moderator") {
    throw new HttpsError("permission-denied", "Acceso solo para moderadores.");
  }
  return uid;
}

async function writeAuditLog(entry: {
  actorUid: string;
  action: ModeratorAction | "claim_report";
  reportId: string | null;
  targetType: string | null;
  targetId: string | null;
  targetOwnerId: string | null;
  notes: string | null;
}) {
  await db.collection("adminAuditLog").add({
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─── submitReport ────────────────────────────────────────────────────────────
// Cualquier usuario autenticado puede enviar un reporte.
// Previene reportes duplicados del mismo usuario sobre el mismo contenido.

type SubmitReportRequest = {
  targetType?: string;
  targetId?: string;
  parentId?: string; // postId para comentarios
  targetOwnerId?: string;
  reason?: string;
  description?: string;
};

export const submitReport = onCall<SubmitReportRequest>(
  { region: "us-central1" },
  async (request) => {
    const uid = requireAuth(request);

    const targetType = (request.data?.targetType ?? "").trim();
    const targetId = (request.data?.targetId ?? "").trim();
    const parentId = (request.data?.parentId ?? "").trim() || null;
    const targetOwnerId = (request.data?.targetOwnerId ?? "").trim();
    const reason = (request.data?.reason ?? "").trim();
    const description = (request.data?.description ?? "").trim() || null;

    if (!VALID_TARGET_TYPES.includes(targetType as ReportTargetType)) {
      throw new HttpsError("invalid-argument", "Tipo de contenido no válido.");
    }
    if (!targetId) {
      throw new HttpsError("invalid-argument", "Falta targetId.");
    }
    if (!targetOwnerId) {
      throw new HttpsError("invalid-argument", "Falta targetOwnerId.");
    }
    if (!VALID_REASONS.includes(reason as ReportReason)) {
      throw new HttpsError("invalid-argument", "Motivo de reporte no válido.");
    }
    if (targetOwnerId === uid) {
      throw new HttpsError(
        "invalid-argument",
        "No puedes reportar tu propio contenido."
      );
    }
    if (description && description.length > 500) {
      throw new HttpsError(
        "invalid-argument",
        "La descripción no puede superar los 500 caracteres."
      );
    }

    // Para comentarios: verificar que el comentario existe en posts/{parentId}/comments/{targetId}
    if (targetType === "comment" || targetType === "comment_reply") {
      if (!parentId) {
        throw new HttpsError(
          "invalid-argument",
          "Falta parentId para reportar un comentario."
        );
      }
      const commentSnap = await db
        .collection("posts")
        .doc(parentId)
        .collection("comments")
        .doc(targetId)
        .get();
      if (!commentSnap.exists) {
        throw new HttpsError(
          "not-found",
          "El comentario no existe en la publicación indicada."
        );
      }
    }

    // Verificar duplicado: mismo reportero + mismo targetId
    const existingSnap = await db
      .collection("reports")
      .where("reporterUid", "==", uid)
      .where("targetId", "==", targetId)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return { ok: true, duplicate: true };
    }

    // Rate limit: máx 15 reportes por hora por usuario
    const oneHourAgo = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
    const recentSnap = await db
      .collection("reports")
      .where("reporterUid", "==", uid)
      .where("createdAt", ">", oneHourAgo)
      .get();

    if (recentSnap.size >= 15) {
      throw new HttpsError(
        "resource-exhausted",
        "Alcanzaste el límite de reportes por hora. Intenta más tarde."
      );
    }

    await db.collection("reports").add({
      reporterUid: uid,
      targetType,
      targetId,
      parentId,
      targetOwnerId,
      reason,
      description,
      status: "pending",
      claimedBy: null,
      claimedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
      resolution: null,
      resolutionNotes: null,
      resolvedBy: null,
    });

    logger.info("submitReport", { uid, targetType, targetId, reason });
    return { ok: true, duplicate: false };
  }
);

// ─── claimReport ─────────────────────────────────────────────────────────────
// El moderador toma un reporte de la cola para indicar que lo está revisando.

type ClaimReportRequest = {
  reportId?: string;
};

export const claimReport = onCall<ClaimReportRequest>(
  { region: "us-central1" },
  async (request) => {
    const modUid = requireModerator(request);
    const reportId = (request.data?.reportId ?? "").trim();

    if (!reportId) {
      throw new HttpsError("invalid-argument", "Falta reportId.");
    }

    const reportRef = db.collection("reports").doc(reportId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(reportRef);
      if (!snap.exists) {
        throw new HttpsError("not-found", "El reporte no existe.");
      }

      const data = snap.data()!;
      if (data.status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          "Solo se pueden tomar reportes en estado pendiente."
        );
      }

      tx.update(reportRef, {
        status: "reviewing",
        claimedBy: modUid,
        claimedAt: FieldValue.serverTimestamp(),
      });
    });

    await writeAuditLog({
      actorUid: modUid,
      action: "claim_report",
      reportId,
      targetType: null,
      targetId: null,
      targetOwnerId: null,
      notes: null,
    });

    return { ok: true };
  }
);

// ─── resolveReport ────────────────────────────────────────────────────────────
// El moderador resuelve el reporte con una acción concreta.

type ResolveReportRequest = {
  reportId?: string;
  action?: string;
  notes?: string;
};

export const resolveReport = onCall<ResolveReportRequest>(
  { region: "us-central1" },
  async (request) => {
    const modUid = requireModerator(request);
    const reportId = (request.data?.reportId ?? "").trim();
    const action = (request.data?.action ?? "").trim();
    const notes = (request.data?.notes ?? "").trim() || null;

    if (!reportId) {
      throw new HttpsError("invalid-argument", "Falta reportId.");
    }
    if (!VALID_ACTIONS.includes(action as ModeratorAction)) {
      throw new HttpsError("invalid-argument", "Acción no válida.");
    }

    const reportRef = db.collection("reports").doc(reportId);
    const reportSnap = await reportRef.get();

    if (!reportSnap.exists) {
      throw new HttpsError("not-found", "El reporte no existe.");
    }

    const reportData = reportSnap.data()!;

    if (reportData.status === "resolved" || reportData.status === "dismissed") {
      throw new HttpsError(
        "failed-precondition",
        "Este reporte ya fue resuelto."
      );
    }

    const finalStatus =
      action === "dismiss" ? "dismissed" : "resolved";

    // Ejecutar la acción sobre el contenido
    await executeAction(
      action as ModeratorAction,
      reportData.targetType,
      reportData.targetId,
      reportData.parentId ?? null,
      reportData.targetOwnerId
    );

    // Marcar el reporte como resuelto
    await reportRef.update({
      status: finalStatus,
      resolution: action,
      resolutionNotes: notes,
      resolvedBy: modUid,
      resolvedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      actorUid: modUid,
      action: action as ModeratorAction,
      reportId,
      targetType: reportData.targetType,
      targetId: reportData.targetId,
      targetOwnerId: reportData.targetOwnerId,
      notes,
    });

    logger.info("resolveReport", {
      modUid,
      reportId,
      action,
      targetType: reportData.targetType,
    });

    return { ok: true };
  }
);

// ─── executeAction ────────────────────────────────────────────────────────────
// Aplica la acción sobre el contenido o usuario según el tipo.

async function executeAction(
  action: ModeratorAction,
  targetType: string,
  targetId: string,
  parentId: string | null,
  targetOwnerId: string
): Promise<void> {
  switch (action) {
    case "remove_content":
      await removeContent(targetType, targetId, parentId);
      break;

    case "block_user":
      await blockUser(targetOwnerId);
      break;

    case "warn_user":
      await warnUser(targetOwnerId, targetType, targetId);
      break;

    // dismiss y report_to_authorities no requieren acción adicional en Firestore
    case "dismiss":
    case "report_to_authorities":
      break;
  }
}

async function removeContent(
  targetType: string,
  targetId: string,
  parentId: string | null
): Promise<void> {
  const deletedAt = FieldValue.serverTimestamp();

  switch (targetType) {
    case "post":
    case "live": {
      const postRef = db.collection("posts").doc(targetId);
      const snap = await postRef.get();
      if (snap.exists) {
        await postRef.update({ isDeleted: true, deletedAt });
      }
      break;
    }

    case "comment":
    case "comment_reply": {
      if (!parentId) {
        logger.warn("removeContent: parentId faltante para comentario", {
          targetId,
          targetType,
        });
        return;
      }
      const commentRef = db
        .collection("posts")
        .doc(parentId)
        .collection("comments")
        .doc(targetId);
      const snap = await commentRef.get();
      if (snap.exists) {
        await commentRef.update({ isDeleted: true, deletedAt });
      }
      break;
    }

    case "greeting": {
      const greetingRef = db.collection("greetingRequests").doc(targetId);
      const snap = await greetingRef.get();
      if (snap.exists) {
        await greetingRef.update({
          moderationStatus: "removed",
          moderationRemovedAt: deletedAt,
        });
      }
      break;
    }

    default:
      logger.warn("removeContent: tipo de contenido sin handler", {
        targetType,
        targetId,
      });
  }
}

async function blockUser(targetOwnerId: string): Promise<void> {
  // Deshabilita la cuenta en Firebase Auth — el usuario no podrá iniciar sesión
  await getAuth().updateUser(targetOwnerId, { disabled: true });

  // Marca al usuario en Firestore para mostrarlo como bloqueado en la UI
  const userRef = db.collection("users").doc(targetOwnerId);
  const snap = await userRef.get();
  if (snap.exists) {
    await userRef.update({
      platformBanned: true,
      platformBannedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function warnUser(
  targetOwnerId: string,
  targetType: string,
  targetId: string
): Promise<void> {
  await db
    .collection("users")
    .doc(targetOwnerId)
    .collection("notifications")
    .add({
      type: "moderation_warning",
      targetType,
      targetId,
      message:
        "Tu contenido fue revisado por nuestro equipo y recibiste una advertencia por violar las normas de la comunidad.",
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
}
