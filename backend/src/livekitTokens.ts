// Cloud Function: getLivekitToken
// Genera un JWT firmado de LiveKit para que creador o comprador se unan a la videollamada
// de una sesión exclusiva o meet & greet. Toda la lógica de autorización vive aquí.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { livekitApiKey, livekitApiSecret, createParticipantToken, createRoomServiceClient } from "./livekit";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

// Coincide con EXCLUSIVE_SESSION_PREPARE_WINDOW_MINUTES y MEET_GREET_PREPARE_WINDOW_MINUTES
const PREPARE_WINDOW_MINUTES = 10;
// Tolerancia extra tras el fin esperado de la sesión antes de bloquear entrada tardía
const LATE_TOLERANCE_MINUTES = 30;

type SessionType = "exclusive_session" | "meet_greet";

const COLLECTION_BY_TYPE: Record<SessionType, string> = {
  exclusive_session: "exclusiveSessionRequests",
  meet_greet: "meetGreetRequests",
};

// Estados que permiten entrar a la videollamada.
const VALID_ENTRY_STATUSES = new Set(["scheduled", "ready_to_prepare", "in_preparation", "auto_rejected_no_show"]);

// Mensajes específicos para estados terminales (antes del check genérico de estado).
const TERMINAL_STATUS_MESSAGES: Partial<Record<string, string>> = {
  cancelled: "Esta sesión fue cancelada.",
  completed: "Esta sesión ya ha finalizado.",
  rejected: "Esta solicitud fue rechazada.",
  refund_requested: "Esta sesión está en proceso de devolución.",
  refund_review: "Esta sesión está en revisión de devolución.",
};

function requireAuth(uid?: string): string {
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  return uid;
}

function resolveCollection(sessionType: unknown): string {
  if (sessionType !== "exclusive_session" && sessionType !== "meet_greet") {
    throw new HttpsError(
      "invalid-argument",
      "sessionType debe ser 'exclusive_session' o 'meet_greet'."
    );
  }
  return COLLECTION_BY_TYPE[sessionType as SessionType];
}

// Retorna el roomName existente o genera uno determinista y lo persiste en Firestore.
// El formato `session_<id>` garantiza que siempre apuntamos a la misma sala.
async function ensureRoomName(
  docRef: admin.firestore.DocumentReference,
  sessionId: string,
  existingRoomName: string | null | undefined
): Promise<string> {
  if (existingRoomName) return existingRoomName;

  const roomName = `session_${sessionId}`;
  await docRef.update({
    roomName,
    updatedAt: admin.firestore.Timestamp.now(),
  });

  return roomName;
}

// Valida que el instante actual cae dentro de la ventana permitida de entrada.
// Solo aplica cuando la sesión está en estado "scheduled" — si ya pasó a
// "ready_to_prepare" o "in_preparation" el sistema ya manejó la transición.
function validateTimeWindow(
  status: string,
  scheduledAt: string | null | undefined,
  durationMinutes: number | null | undefined
): void {
  if (status !== "scheduled" || !scheduledAt) return;

  const nowMs = Date.now();
  const scheduledMs = new Date(scheduledAt).getTime();

  if (Number.isNaN(scheduledMs)) return;

  // Demasiado temprano: la sala aún no está disponible
  const windowStartMs = scheduledMs - PREPARE_WINDOW_MINUTES * 60 * 1000;
  if (nowMs < windowStartMs) {
    const minutesLeft = Math.ceil((windowStartMs - nowMs) / 60_000);
    throw new HttpsError(
      "failed-precondition",
      `Aún no es hora. La sala abre ${minutesLeft} min antes del inicio programado.`
    );
  }

  // Demasiado tarde: ya expiró la ventana (scheduledAt + duración + tolerancia)
  if (typeof durationMinutes === "number" && durationMinutes > 0) {
    const sessionEndMs =
      scheduledMs + (durationMinutes + LATE_TOLERANCE_MINUTES) * 60_000;
    if (nowMs > sessionEndMs) {
      throw new HttpsError(
        "failed-precondition",
        "El horario de esta sesión ya expiró. Contacta al creador si necesitas reagendar."
      );
    }
  }
}

export const getLivekitToken = onCall(
  {
    region: REGION,
    secrets: [livekitApiKey, livekitApiSecret],
  },
  async (request) => {
    // ── Autenticación ──────────────────────────────────────────────────────────
    const uid = requireAuth(request.auth?.uid);

    // ── Validar input ──────────────────────────────────────────────────────────
    const { sessionId, sessionType } = request.data ?? {};

    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId es requerido.");
    }

    const collection = resolveCollection(sessionType);
    const cleanId = sessionId.trim();

    // ── Leer sesión de Firestore ───────────────────────────────────────────────
    const docRef = db.collection(collection).doc(cleanId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "La sesión no existe.");
    }

    const session = snap.data()!;
    const {
      creatorId,
      buyerId,
      status,
      scheduledAt,
      durationMinutes,
      paymentStatus,
      roomName: existingRoomName,
      creatorDisplayName,
      creatorUsername,
      buyerDisplayName,
      buyerUsername,
    } = session;

    // ── Validar que el usuario es participante ─────────────────────────────────
    const isCreator = uid === creatorId;
    const isBuyer = uid === buyerId;

    if (!isCreator && !isBuyer) {
      logger.warn("livekit_token_denied_not_participant", {
        uid,
        sessionId: cleanId,
        sessionType,
      });
      throw new HttpsError("permission-denied", "No tienes acceso a esta sesión.");
    }

    // ── Verificar estados terminales con mensajes específicos ──────────────────
    const terminalMsg = TERMINAL_STATUS_MESSAGES[status as string];
    if (terminalMsg) {
      throw new HttpsError("failed-precondition", terminalMsg);
    }

    // ── Validar pago ───────────────────────────────────────────────────────────
    if (paymentStatus !== "simulated_paid") {
      logger.warn("livekit_token_denied_payment", {
        uid,
        sessionId: cleanId,
        paymentStatus,
      });
      throw new HttpsError(
        "failed-precondition",
        "El pago de esta sesión no está confirmado."
      );
    }

    // ── Validar estado general de la sesión ───────────────────────────────────
    if (!VALID_ENTRY_STATUSES.has(status)) {
      throw new HttpsError(
        "failed-precondition",
        "La sesión no está disponible para videollamada en este momento."
      );
    }

    // ── Validar ventana de horario ─────────────────────────────────────────────
    validateTimeWindow(status, scheduledAt, durationMinutes);

    // ── Asegurar roomName persistente ──────────────────────────────────────────
    const roomName = await ensureRoomName(docRef, cleanId, existingRoomName);

    // Crear/asegurar la sala con timeouts generosos: si ambos participantes se
    // caen unos segundos, la sala (y por lo tanto la grabación) NO se cierra.
    // createRoom es idempotente: si ya existe, no la altera.
    try {
      await createRoomServiceClient().createRoom({
        name: roomName,
        emptyTimeout: 300,
        departureTimeout: 300,
      });
    } catch (err: unknown) {
      logger.info("livekit_room_ensure_noncritical", { roomName, err: String(err) });
    }

    // ── Construir identidad y nombre de display ────────────────────────────────
    // Formato de identidad: role_uid — permite identificar el rol en el dashboard de LiveKit.
    const role = isCreator ? "creator" : "buyer";
    const identity = `${role}_${uid}`;
    const displayName = isCreator
      ? (creatorDisplayName ?? creatorUsername ?? "Creador")
      : (buyerDisplayName ?? buyerUsername ?? "Fan");

    // ── Generar token ──────────────────────────────────────────────────────────
    const token = await createParticipantToken({ roomName, identity, displayName });

    // ── Validar configuración de entorno ───────────────────────────────────────
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!livekitUrl) {
      logger.error("livekit_token_missing_url", { sessionId: cleanId });
      throw new HttpsError(
        "internal",
        "Configuración de LiveKit incompleta. Falta LIVEKIT_URL."
      );
    }

    logger.info("livekit_token_generated", {
      sessionId: cleanId,
      sessionType,
      uid,
      role,
      roomName,
      status,
    });

    // ── Respuesta al frontend ──────────────────────────────────────────────────
    return { token, roomName, livekitUrl };
  }
);
