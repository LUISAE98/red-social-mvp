import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { requirePlatformMod } from "./authz";

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
  "conversation",
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

/**
 * Resuelve en el SERVIDOR de quién es el contenido reportado.
 *
 * Antes se guardaba el `targetOwnerId` que mandaba quien reporta, y ese valor
 * es el que usa el moderador al pulsar "bloquear usuario". Convertir un dato no
 * confiable en una acción administrativa sobre una cuenta es exactamente cómo se
 * consigue que un tercero banee a quien quiera.
 *
 * Devuelve null si el contenido no existe: sin dueño no hay reporte.
 */
async function resolveTargetOwner(
  targetType: string,
  targetId: string,
  parentId: string | null,
  // B9-C03: hace falta para comprobar que quien denuncia una conversación está
  // dentro de ella.
  reporterUid: string
): Promise<string | null> {
  const readField = async (path: string, field: string): Promise<string | null> => {
    const snap = await db.doc(path).get();
    if (!snap.exists) return null;
    const value = snap.get(field);
    return typeof value === "string" && value ? value : null;
  };

  switch (targetType) {
    case "post":
    case "live":
      return readField(`posts/${targetId}`, "authorId");

    case "comment":
    case "comment_reply":
      // `parentId` ya se validó arriba: el comentario existe en ese post.
      return readField(`posts/${parentId}/comments/${targetId}`, "authorId");

    case "live_chat_message":
      // El id del live viaja en parentId; el autor del mensaje es `userId`.
      return parentId
        ? readField(`liveChats/${parentId}/messages/${targetId}`, "userId")
        : null;

    case "greeting":
      return readField(`greetingRequests/${targetId}`, "creatorId");

    case "meet_greet":
      return readField(`meetGreetRequests/${targetId}`, "creatorId");

    case "exclusive_session":
      return readField(`exclusiveSessionRequests/${targetId}`, "creatorId");

    case "community":
      return readField(`groups/${targetId}`, "ownerId");

    case "user":
      // Se reporta a la persona misma: el objetivo ES el dueño, pero se
      // comprueba que exista para no abrir reportes contra uids inventados.
      return (await db.doc(`users/${targetId}`).get()).exists ? targetId : null;

    case "conversation": {
      // Un hilo privado no tiene "dueño": el moderador decide sobre las personas
      // al revisarlo. Se deja sin dueño en vez de señalar a alguien de antemano.
      //
      // ⚠️ B9-C03. Antes bastaba con que el hilo EXISTIERA. El id de una
      // conversación es determinista (`uidA_uidB` ordenados), así que cualquiera
      // que conociera dos uids —y los uids no son secretos— podía calcular el id,
      // denunciar una conversación ajena y dejarla `underReview`, que es
      // exactamente lo que abre su lectura completa a los moderadores.
      //
      // Un moderador podía además auto-denunciar cualquier hilo para leerlo,
      // anulando por completo la intención de "solo las conversaciones
      // denunciadas".
      //
      // Ahora solo denuncia quien está dentro.
      const snap = await db.doc(`conversations/${targetId}`).get();
      if (!snap.exists) return null;

      const participantes = snap.data()?.participants;
      if (!Array.isArray(participantes) || !participantes.includes(reporterUid)) {
        throw new HttpsError(
          "permission-denied",
          "Solo puedes denunciar una conversación en la que participas."
        );
      }

      return "";
    }

    default:
      return null;
  }
}

// El criterio vive en `authz.ts`, en un solo sitio: claim de moderador MÁS
// sesión de Google. Tenerlo repetido aquí es como acabó pasando que las
// funciones de dinero se quedaran solo con el claim.
function requireModerator(request: {
  auth?: { uid?: string; token?: Record<string, unknown> };
}): string {
  return requirePlatformMod(request);
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
    // Ojo: aquí NO se comprueba si es tu propio contenido. Ese valor lo manda el
    // cliente y mentir en él es justo el ataque. La comprobación de verdad va
    // más abajo, contra el dueño que resuelve el servidor.
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

    // ⚠️ Quién es el dueño del contenido lo decide el SERVIDOR, no quien reporta.
    // Antes se guardaba el `targetOwnerId` que mandaba el cliente, y ese valor es
    // el que usa el moderador al pulsar "bloquear usuario": deshabilita la cuenta
    // y revoca sus tokens. O sea que alguien podía reportar su propia publicación
    // y poner de dueño a la persona que quisiera hundir, y bastaba con que un
    // moderador atendiera el reporte para banear a un inocente.
    // `null` = el contenido no existe. Cadena vacía = existe pero no tiene un
    // dueño único (una conversación privada es de dos personas), y eso es válido.
    const resolvedOwnerId = await resolveTargetOwner(targetType, targetId, parentId, uid);
    if (resolvedOwnerId === null) {
      throw new HttpsError(
        "not-found",
        "No se encontró el contenido reportado."
      );
    }
    if (resolvedOwnerId === uid) {
      throw new HttpsError(
        "invalid-argument",
        "No puedes reportar tu propio contenido."
      );
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
      // El resuelto por el servidor, NO el que mandó quien reporta.
      targetOwnerId: resolvedOwnerId,
      reportedOwnerIdClaim: targetOwnerId || null,
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

    // Denuncia de una conversación privada: se marca el hilo como "en revisión".
    // Ese marcador es lo ÚNICO que le abre esa conversación al supermoderador —
    // sin él no puede leer los mensajes de nadie. Antes leía los de todo el
    // mundo por una regla comodín, hubiera denuncia o no.
    if (targetType === "conversation") {
      try {
        await db.collection("conversations").doc(targetId).update({
          underReview: true,
          underReviewAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        // El hilo pudo borrarse entre el reporte y esta escritura. El reporte ya
        // quedó guardado; sin la marca el moderador verá el motivo pero no el
        // contenido, que es el modo seguro de fallar.
        logger.warn("submitReport: no se pudo marcar la conversación", {
          targetId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

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

    // Nadie resuelve un reporte que otra persona está atendiendo. Antes cualquier
    // moderador podía resolver uno ya tomado: dos personas decidían cosas
    // distintas sobre el mismo caso y la segunda pisaba a la primera, sin que el
    // registro reflejara quién lo revisó de verdad.
    //
    // Si está libre, se toma AQUÍ y en transacción. Así no hace falta pasar por
    // la lista para poder resolver, y dos moderadores que abran el mismo reporte
    // a la vez no pueden resolverlo los dos: el segundo se encuentra con que ya
    // tiene dueño.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(reportRef);
      const current = snap.data() ?? {};

      if (current.status === "resolved" || current.status === "dismissed") {
        throw new HttpsError("failed-precondition", "Este reporte ya fue resuelto.");
      }

      const claimedBy =
        typeof current.claimedBy === "string" ? current.claimedBy : null;

      if (claimedBy && claimedBy !== modUid) {
        throw new HttpsError(
          "failed-precondition",
          "Este reporte lo está atendiendo otra persona."
        );
      }

      if (!claimedBy) {
        tx.update(reportRef, {
          claimedBy: modUid,
          claimedAt: FieldValue.serverTimestamp(),
          status: "reviewing",
        });
      }
    });

    // Sin dueño resuelto no se puede sancionar a nadie. Pasa con las denuncias
    // de conversaciones privadas, que son de dos personas: el moderador puede
    // desestimarlas o revisar el hilo, pero no bloquear a ciegas.
    if (
      (action === "block_user" || action === "warn_user") &&
      !reportData.targetOwnerId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Este reporte no señala a una persona concreta. Actúa desde su perfil."
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

    // ⚠️ B9-alto. Al resolver, se retira la marca que abre el hilo.
    //
    // `underReview` se ponía al denunciar y no lo quitaba NADIE: una denuncia
    // de hace meses seguía dando a todos los moderadores acceso al historial
    // completo de una conversación privada, para siempre. Decisión de Luis
    // (2026-08-16): al resolver o desestimar, se cierra.
    if (reportData.targetType === "conversation" && reportData.targetId) {
      await db
        .doc(`conversations/${reportData.targetId}`)
        .update({ underReview: false })
        .catch((error) => {
          // Que no tumbe la resolución del reporte, pero que quede en el log:
          // un hilo que se quede abierto es una fuga de privacidad silenciosa.
          logger.error("resolveReport: no se pudo cerrar underReview", {
            conversationId: reportData.targetId,
            error,
          });
        });
    }

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

  // `disabled` solo impide INICIAR sesión; los tokens ya emitidos seguían
  // valiendo, así que un baneado conservaba acceso hasta que caducara el suyo.
  // Revocar los refresh tokens corta esa ventana: no puede acuñar más y el que
  // tenga muere en ~1h, que es el límite propio de un JWT sin estado.
  await getAuth().revokeRefreshTokens(targetOwnerId);

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
      updatedAt: FieldValue.serverTimestamp(),
    });
}
