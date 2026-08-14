// Cloud Function: livekitWebhook
// Recibe eventos de LiveKit via HTTP y actualiza Firestore con el estado
// de salas y grabaciones de sesiones exclusivas y meet & greet.
//
// Eventos manejados:
//   room_finished   → marca sesión completed si endSession no fue llamado
//   egress_started  → confirma recordingStatus "recording"
//   egress_updated  → detecta fallo prematuro
//   egress_ended    → guarda URL, duración y marca "ready" o "failed"

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import {
  WebhookReceiver,
  EgressStatus,
  type WebhookEvent,
} from "livekit-server-sdk";
import { livekitApiKey, livekitApiSecret } from "./livekit";
import { notifySessionEvent } from "./notifications";
import { claimWebhookEvent } from "./webhookEvents";

/** Deriva el tipo de sesión (para las notificaciones) desde la colección del doc. */
function sessionTypeOfRef(ref: admin.firestore.DocumentReference): string {
  return ref.parent.id === "meetGreetRequests" ? "meet_greet" : "exclusive_session";
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";
const COLLECTIONS = ["exclusiveSessionRequests", "meetGreetRequests"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Busca el documento de sesión en ambas colecciones por roomName.
async function findSessionByRoomName(roomName: string): Promise<{
  ref: admin.firestore.DocumentReference;
  data: admin.firestore.DocumentData;
} | null> {
  const [exclusiveSnap, meetGreetSnap] = await Promise.all(
    COLLECTIONS.map((col) =>
      db.collection(col).where("roomName", "==", roomName).limit(1).get()
    )
  );

  const snaps = [exclusiveSnap, meetGreetSnap];
  for (const snap of snaps) {
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { ref: doc.ref, data: doc.data() };
    }
  }

  return null;
}

// Extrae el roomName del evento (room o egress).
function getRoomName(event: WebhookEvent): string | null {
  if (event.egressInfo?.roomName) return event.egressInfo.roomName;
  if (event.room?.name) return event.room.name;
  return null;
}

// ── Manejadores de eventos ────────────────────────────────────────────────────

async function handleRoomFinished(event: WebhookEvent): Promise<void> {
  const roomName = getRoomName(event);
  if (!roomName) return;

  const session = await findSessionByRoomName(roomName);
  if (!session) {
    logger.warn("livekit_webhook_room_finished_no_session", { roomName });
    return;
  }

  const { status, startedAt, creatorJoinedAt, buyerJoinedAt } = session.data;

  // Solo actuar si la sesión no fue completada ya por endSession
  const activeStatuses = new Set(["scheduled", "ready_to_prepare", "in_preparation"]);
  if (!activeStatuses.has(status as string)) return;

  // Si ninguno de los participantes se unió, es un no-show → rechazar en lugar de completar
  const sessionStarted = !!startedAt || (!!creatorJoinedAt && !!buyerJoinedAt);
  const now = admin.firestore.Timestamp.now();

  if (sessionStarted) {
    // Calcular duración real vs umbral del 80%
    const SESSION_COMPLETE_THRESHOLD_PCT = 0.8;
    const FALLBACK_DURATION_MINUTES = 30;
    const nowMs = Date.now();
    const startedAtMs = startedAt
      ? new Date(startedAt as string).getTime()
      : nowMs;
    const actualDurationSec = Math.max(0, (nowMs - startedAtMs) / 1000);
    const durationMinutes =
      typeof session.data.durationMinutes === "number" && session.data.durationMinutes > 0
        ? session.data.durationMinutes
        : FALLBACK_DURATION_MINUTES;
    const requiredDurationSec = durationMinutes * 60 * SESSION_COMPLETE_THRESHOLD_PCT;
    const finalStatus = actualDurationSec >= requiredDurationSec ? "completed" : "session_incomplete";

    const updates: Record<string, unknown> = {
      status: finalStatus,
      roomStatus: "ended",
      endedAt: new Date().toISOString(),
      updatedAt: now,
    };
    if (finalStatus === "session_incomplete") {
      updates.actualDurationSeconds = Math.floor(actualDurationSec);
      updates.requiredDurationSeconds = Math.floor(requiredDurationSec);
    }

    await session.ref.update(updates);
    logger.info("livekit_webhook_room_finished_session_closed", {
      roomName,
      sessionId: session.ref.id,
      finalStatus,
      actualDurationSec,
      requiredDurationSec,
    });
  } else {
    await session.ref.update({
      status: "rejected",
      roomStatus: "ended",
      endedAt: new Date().toISOString(),
      autoRejectedAt: now,
      autoRejectReason: "La sesión finalizó sin que ambos participantes se conectaran.",
      updatedAt: now,
    });
    logger.info("livekit_webhook_room_finished_no_show_rejected", {
      roomName,
      sessionId: session.ref.id,
      previousStatus: status,
    });
  }
}

async function handleEgressStarted(event: WebhookEvent): Promise<void> {
  const egressInfo = event.egressInfo;
  if (!egressInfo) return;

  const roomName = egressInfo.roomName;
  const session = await findSessionByRoomName(roomName);
  if (!session) {
    logger.warn("livekit_webhook_egress_started_no_session", { roomName });
    return;
  }

  // Confirmar que el egressId y recordingStatus están guardados
  const updates: Record<string, unknown> = {
    updatedAt: admin.firestore.Timestamp.now(),
  };
  if (!session.data.livekitEgressId) {
    updates.livekitEgressId = egressInfo.egressId;
  }
  if (session.data.recordingStatus !== "recording") {
    updates.recordingStatus = "recording";
  }

  await session.ref.update(updates);

  logger.info("livekit_webhook_egress_started", {
    roomName,
    egressId: egressInfo.egressId,
    sessionId: session.ref.id,
  });
}

async function handleEgressUpdated(event: WebhookEvent): Promise<void> {
  const egressInfo = event.egressInfo;
  if (!egressInfo) return;

  // Solo interesa si el egress falló prematuramente
  if (egressInfo.status !== EgressStatus.EGRESS_FAILED) return;

  const roomName = egressInfo.roomName;
  const session = await findSessionByRoomName(roomName);
  if (!session) return;

  if (session.data.recordingStatus === "recording") {
    await session.ref.update({
      recordingStatus: "failed",
      updatedAt: admin.firestore.Timestamp.now(),
    });

    logger.warn("livekit_webhook_egress_failed_early", {
      roomName,
      egressId: egressInfo.egressId,
      sessionId: session.ref.id,
    });

    // Grabación falló → avisar al creador.
    await notifyRecording(session, "recording_failed", true);
  }
}

/** Notifica el resultado de la grabación (ready → ambos; failed → creador). */
async function notifyRecording(
  session: { ref: admin.firestore.DocumentReference; data: admin.firestore.DocumentData },
  action: "recording_ready" | "recording_failed",
  onlyCreator: boolean
): Promise<void> {
  try {
    const creatorId = typeof session.data.creatorId === "string" ? session.data.creatorId : null;
    const buyerId = typeof session.data.buyerId === "string" ? session.data.buyerId : null;
    await notifySessionEvent({
      action,
      sessionId: session.ref.id,
      sessionType: sessionTypeOfRef(session.ref),
      recipientIds: onlyCreator ? [creatorId] : [creatorId, buyerId],
    });
  } catch (e) {
    logger.error("session recording notify failed", {
      sessionId: session.ref.id,
      action,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

async function handleEgressEnded(event: WebhookEvent): Promise<void> {
  const egressInfo = event.egressInfo;
  if (!egressInfo) return;

  const roomName = egressInfo.roomName;
  const session = await findSessionByRoomName(roomName);
  if (!session) {
    logger.warn("livekit_webhook_egress_ended_no_session", {
      roomName,
      egressId: egressInfo.egressId,
    });
    return;
  }

  const failed = egressInfo.status === EgressStatus.EGRESS_FAILED;

  if (failed) {
    const wasFailed = session.data.recordingStatus === "failed";
    await session.ref.update({
      recordingStatus: "failed",
      updatedAt: admin.firestore.Timestamp.now(),
    });

    logger.warn("livekit_webhook_egress_ended_failed", {
      roomName,
      egressId: egressInfo.egressId,
      sessionId: session.ref.id,
      error: egressInfo.error,
    });

    // Grabación falló → avisar al creador (solo en la transición).
    if (!wasFailed) await notifyRecording(session, "recording_failed", true);
    return;
  }

  // Egress completado exitosamente — extraer clave S3 y duración del primer resultado
  const fileResult = egressInfo.fileResults?.[0];
  // location puede ser: "s3://bucket/key", "bucket/key" o solo la clave
  const rawLocation = fileResult?.location || null;
  // duration en FileInfo es bigint (segundos)
  const recordingDurationSeconds = fileResult?.duration
    ? Number(fileResult.duration)
    : null;

  // La grabación estará disponible 30 días desde ahora
  const RECORDING_TTL_DAYS = 30;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + RECORDING_TTL_DAYS);

  const wasReady = session.data.recordingStatus === "ready";
  await session.ref.update({
    recordingStatus: "ready",
    recordingS3Key: rawLocation,
    recordingUrl: rawLocation,
    recordingDurationSeconds,
    recordingExpiresAt: expiresAt.toISOString(),
    updatedAt: admin.firestore.Timestamp.now(),
  });

  // Grabación lista → avisar a ambos (solo en la transición).
  if (!wasReady) await notifyRecording(session, "recording_ready", false);

  logger.info("livekit_webhook_egress_ended_ready", {
    roomName,
    egressId: egressInfo.egressId,
    sessionId: session.ref.id,
    recordingS3Key: rawLocation,
    recordingDurationSeconds,
  });
}

// Presencia de participantes → pausa/reanuda el contador de la sesión.
// El contador solo corre mientras AMBOS (creador y comprador) están conectados;
// nunca se reinicia. Se identifica el rol por el prefijo de identidad.
async function handleParticipantPresence(
  event: WebhookEvent,
  connected: boolean
): Promise<void> {
  const roomName = getRoomName(event);
  const identity = event.participant?.identity;
  if (!roomName || !identity) return;

  const role: "creator" | "buyer" | null = identity.startsWith("creator_")
    ? "creator"
    : identity.startsWith("buyer_")
    ? "buyer"
    : null;
  if (!role) return; // el grabador u otros participantes no cuentan

  const session = await findSessionByRoomName(roomName);
  if (!session) return;

  const data = session.data;
  const now = admin.firestore.Timestamp.now();
  const nowMs = Date.now();

  const creatorConnected = role === "creator" ? connected : !!data.creatorConnected;
  const buyerConnected = role === "buyer" ? connected : !!data.buyerConnected;
  const bothNow = creatorConnected && buyerConnected;

  const updates: Record<string, unknown> = {
    [`${role}Connected`]: connected,
    updatedAt: now,
  };

  // Solo gestionar el contador mientras la sesión está activa (arrancó y no terminó).
  const started = !!data.startedAt;
  const ended =
    !!data.endedAt ||
    ["completed", "session_incomplete", "rejected", "cancelled"].includes(
      String(data.status)
    );

  if (started && !ended) {
    const running = !!data.timerRunningSince;
    if (bothNow && !running) {
      // Reanudar: ambos presentes de nuevo.
      updates.timerRunningSince = new Date().toISOString();
    } else if (!bothNow && running) {
      // Pausar: alguien se fue. Congelar el restante.
      const runningSinceMs = new Date(String(data.timerRunningSince)).getTime();
      const rem = typeof data.timerRemainingMs === "number" ? data.timerRemainingMs : 0;
      updates.timerRemainingMs = Math.max(0, rem - (nowMs - runningSinceMs));
      updates.timerRunningSince = null;
    }
  }

  await session.ref.update(updates);

  logger.info("livekit_webhook_participant_presence", {
    roomName,
    sessionId: session.ref.id,
    role,
    connected,
    bothNow,
  });
}

// ── Función principal ─────────────────────────────────────────────────────────

export const livekitWebhook = onRequest(
  {
    region: REGION,
    secrets: [livekitApiKey, livekitApiSecret],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // ── Verificar firma HMAC ──────────────────────────────────────────────────
    const receiver = new WebhookReceiver(
      livekitApiKey.value(),
      livekitApiSecret.value()
    );

    let event: WebhookEvent;
    try {
      // req.rawBody es un Buffer con el cuerpo sin parsear — necesario para HMAC
      const rawBody =
        (req.rawBody as Buffer | undefined)?.toString("utf8") ??
        JSON.stringify(req.body);
      const authHeader = (req.headers["authorization"] as string) ?? "";
      event = await receiver.receive(rawBody, authHeader);
    } catch (err: unknown) {
      logger.warn("livekit_webhook_auth_failed", { err });
      res.status(401).send("Unauthorized");
      return;
    }

    logger.info("livekit_webhook_received", {
      event: event.event,
      id: event.id,
    });

    // ── Idempotencia ──────────────────────────────────────────────────────────
    // LiveKit reintenta las entregas y no había dedup: `handleParticipantPresence`
    // y los `egress_*` escriben estado de sesión, así que reprocesar el mismo
    // evento podía descuadrar la presencia o duplicar el ciclo de grabación.
    // Sin `id` no hay forma de deduplicar, así que se procesa (comportamiento
    // anterior) en vez de descartar un evento posiblemente único.
    const claim = event.id
      ? await claimWebhookEvent("livekitWebhookEvents", event.id, { event: event.event })
      : null;
    if (claim && !claim.claimed) {
      logger.info("livekit_webhook_duplicate", { event: event.event, id: event.id });
      res.status(200).send("duplicate");
      return;
    }

    // ── Despachar evento ──────────────────────────────────────────────────────
    try {
      switch (event.event) {
        case "room_finished":
          await handleRoomFinished(event);
          break;
        case "egress_started":
          await handleEgressStarted(event);
          break;
        case "egress_updated":
          await handleEgressUpdated(event);
          break;
        case "egress_ended":
          await handleEgressEnded(event);
          break;
        case "participant_joined":
          await handleParticipantPresence(event, true);
          break;
        case "participant_left":
          await handleParticipantPresence(event, false);
          break;
        default:
          // room_started, track_* — no requieren acción
          break;
      }
      await claim?.confirm();
    } catch (err: unknown) {
      logger.error("livekit_webhook_handler_error", {
        event: event.event,
        err,
      });
      // Liberar para no dejar el evento inservible ante un fallo transitorio.
      await claim?.release();
    }

    res.status(200).send("ok");
  }
);
