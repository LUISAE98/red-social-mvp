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

  await session.ref.update({
    recordingStatus: "ready",
    recordingS3Key: rawLocation,
    recordingUrl: rawLocation,
    recordingDurationSeconds,
    recordingExpiresAt: expiresAt.toISOString(),
    updatedAt: admin.firestore.Timestamp.now(),
  });

  logger.info("livekit_webhook_egress_ended_ready", {
    roomName,
    egressId: egressInfo.egressId,
    sessionId: session.ref.id,
    recordingS3Key: rawLocation,
    recordingDurationSeconds,
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
        default:
          // room_started, participant_*, track_* — no requieren acción
          break;
      }
    } catch (err: unknown) {
      logger.error("livekit_webhook_handler_error", {
        event: event.event,
        err,
      });
    }

    res.status(200).send("ok");
  }
);
