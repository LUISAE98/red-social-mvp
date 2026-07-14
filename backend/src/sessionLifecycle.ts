// Cloud Functions: joinSession / endSession
// Gestionan el ciclo de vida LiveKit de sesiones exclusivas y meet & greet.
//
// joinSession: Registra cuándo cada participante se conecta a la sala LiveKit.
//   - Actualiza creatorJoinedAt o buyerJoinedAt.
//   - Cuando ambos están conectados: fija startedAt, roomStatus "in_progress"
//     e inicia la grabación Egress si el almacenamiento S3 está configurado.
//
// endSession: Finaliza la sesión desde el botón "Finalizar sesión".
//   - status → "completed", roomStatus → "ended", endedAt = ahora.
//   - Detiene el Egress activo → recordingStatus "processing".

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import {
  EncodedFileOutput,
  S3Upload,
  EncodingOptionsPreset,
  type EgressInfo,
  type EgressClient,
} from "livekit-server-sdk";
import {
  livekitApiKey,
  livekitApiSecret,
  egressS3AccessKey,
  egressS3SecretKey,
  createEgressClient,
} from "./livekit";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

// Secrets que necesitan joinSession y endSession
const ALL_SECRETS = [livekitApiKey, livekitApiSecret, egressS3AccessKey, egressS3SecretKey];

type SessionType = "exclusive_session" | "meet_greet";

const COLLECTION_BY_TYPE: Record<SessionType, string> = {
  exclusive_session: "exclusiveSessionRequests",
  meet_greet: "meetGreetRequests",
};

const JOINABLE_STATUSES = new Set(["scheduled", "ready_to_prepare", "in_preparation"]);
const ENDABLE_STATUSES = new Set(["scheduled", "ready_to_prepare", "in_preparation", "auto_rejected_no_show"]);
const FORCE_COMPLETE_STATUSES = new Set(["session_incomplete"]);
const SESSION_COMPLETE_THRESHOLD_PCT = 0.8;
const FALLBACK_DURATION_MINUTES = 30;

// Plantilla web pública que compone la grabación (creador grande + comprador
// PiP). El grabador headless de LiveKit la abre con ?url=&token=&layout=.
// Debe estar desplegada (Vercel); no funciona contra localhost.
const EGRESS_TEMPLATE_BASE_URL =
  process.env.EGRESS_TEMPLATE_BASE_URL ?? "https://vibraon.com/en/egress/session";

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

// ── Egress helpers ────────────────────────────────────────────────────────────

// Inicia una grabación RoomComposite en S3.
// Devuelve el egressId si arrancó correctamente, null si el S3 no está configurado.
async function startRecording(
  egressClient: EgressClient,
  roomName: string,
  sessionId: string
): Promise<string | null> {
  const bucket = process.env.LIVEKIT_EGRESS_S3_BUCKET;
  const region = process.env.LIVEKIT_EGRESS_S3_REGION;
  const endpoint = process.env.LIVEKIT_EGRESS_S3_ENDPOINT; // opcional (R2, MinIO, etc.)
  const accessKey = egressS3AccessKey.value();
  const secretKey = egressS3SecretKey.value();

  if (!bucket || !region || !accessKey || !secretKey) {
    logger.warn("livekit_egress_skip_missing_s3_config", {
      sessionId,
      hasBucket: !!bucket,
      hasRegion: !!region,
      hasKey: !!accessKey,
    });
    return null;
  }

  const s3 = new S3Upload({
    accessKey,
    secret: secretKey,
    bucket,
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });

  const fileOutput = new EncodedFileOutput({
    filepath: `recordings/session_${sessionId}/{time}.mp4`,
    output: { case: "s3", value: s3 },
  });

  let egressInfo: EgressInfo;
  try {
    egressInfo = await egressClient.startRoomCompositeEgress(roomName, fileOutput, {
      // Plantilla propia con layout FIJO: creador grande + comprador PiP en la
      // esquina, horizontal — como lo ve el comprador. (Los layouts nativos
      // "grid"/"speaker" no permiten fijar quién va en grande.)
      customBaseUrl: EGRESS_TEMPLATE_BASE_URL,
      layout: "creator-focus",
      encodingOptions: EncodingOptionsPreset.H264_1080P_30,
    });
  } catch (err: unknown) {
    logger.error("livekit_egress_start_failed", { sessionId, roomName, err });
    return null;
  }

  logger.info("livekit_egress_started", {
    sessionId,
    roomName,
    egressId: egressInfo.egressId,
  });

  return egressInfo.egressId;
}

// Detiene un egress activo. No lanza si no hay egressId o si falla.
async function stopRecording(
  egressClient: EgressClient,
  egressId: string | null | undefined,
  sessionId: string
): Promise<void> {
  if (!egressId) return;

  try {
    await egressClient.stopEgress(egressId);
    logger.info("livekit_egress_stopped", { sessionId, egressId });
  } catch (err: unknown) {
    logger.error("livekit_egress_stop_failed", { sessionId, egressId, err });
  }
}

// ── joinSession ───────────────────────────────────────────────────────────────
// Llamado por el frontend cuando ConnectionState pasa a Connected.

export const joinSession = onCall(
  { region: REGION, secrets: ALL_SECRETS },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const { sessionId, sessionType } = request.data ?? {};

    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId es requerido.");
    }

    const collection = resolveCollection(sessionType);
    const cleanId = sessionId.trim();
    const docRef = db.collection(collection).doc(cleanId);
    const snap = await docRef.get();

    if (!snap.exists) throw new HttpsError("not-found", "La sesión no existe.");

    const session = snap.data()!;
    const { creatorId, buyerId, status, creatorJoinedAt, buyerJoinedAt, startedAt, roomName } =
      session;

    const isCreator = uid === creatorId;
    const isBuyer = uid === buyerId;
    if (!isCreator && !isBuyer) {
      throw new HttpsError("permission-denied", "No tienes acceso a esta sesión.");
    }

    if (!JOINABLE_STATUSES.has(status)) {
      logger.warn("session_join_skipped_invalid_status", { cleanId, status });
      return { success: true, skipped: true, bothJoined: false };
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: admin.firestore.Timestamp.now() };

    // Registrar join del participante (idempotente)
    if (isCreator && !creatorJoinedAt) updates.creatorJoinedAt = now;
    if (isBuyer && !buyerJoinedAt) updates.buyerJoinedAt = now;

    const creatorIsJoined = !!creatorJoinedAt || isCreator;
    const buyerIsJoined = !!buyerJoinedAt || isBuyer;
    const bothJoined = creatorIsJoined && buyerIsJoined;

    if (bothJoined && !startedAt) {
      // Primera vez que ambos están en la sala
      updates.startedAt = now;
      updates.roomStatus = "in_progress";

      // Iniciar grabación si S3 está configurado y tenemos el roomName
      if (roomName) {
        const egressClient = createEgressClient();
        const egressId = await startRecording(egressClient, roomName as string, cleanId);
        if (egressId) {
          updates.livekitEgressId = egressId;
          updates.recordingStatus = "recording";
        }
      }
    } else if (!startedAt) {
      // Solo uno conectado: sala lista, esperando al otro
      updates.roomStatus = "ready";
    }

    await docRef.update(updates);

    logger.info("session_joined", {
      sessionId: cleanId,
      sessionType,
      uid,
      role: isCreator ? "creator" : "buyer",
      bothJoined,
    });

    return { success: true, skipped: false, bothJoined };
  }
);

// ── endSession ────────────────────────────────────────────────────────────────
// Llamado cuando un participante pulsa "Finalizar sesión".

export const endSession = onCall(
  { region: REGION, secrets: ALL_SECRETS },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const { sessionId, sessionType } = request.data ?? {};

    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId es requerido.");
    }

    const collection = resolveCollection(sessionType);
    const cleanId = sessionId.trim();
    const docRef = db.collection(collection).doc(cleanId);
    const snap = await docRef.get();

    if (!snap.exists) throw new HttpsError("not-found", "La sesión no existe.");

    const session = snap.data()!;
    const { creatorId, buyerId, status, livekitEgressId, recordingStatus, startedAt, creatorJoinedAt, buyerJoinedAt } = session;

    const isCreator = uid === creatorId;
    const isBuyer = uid === buyerId;
    if (!isCreator && !isBuyer) {
      throw new HttpsError("permission-denied", "No tienes acceso a esta sesión.");
    }

    if (!ENDABLE_STATUSES.has(status)) {
      throw new HttpsError(
        "failed-precondition",
        `La sesión no puede finalizarse desde el estado actual: ${status}.`
      );
    }

    // Si ninguno se unió realmente, marcar como rechazado (no-show) en vez de completado
    const sessionStarted = !!startedAt || (!!creatorJoinedAt && !!buyerJoinedAt);

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    let finalStatus: string;
    const updates: Record<string, unknown> = {
      roomStatus: "ended",
      endedAt: nowIso,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (!sessionStarted) {
      finalStatus = "rejected";
      updates.autoRejectedAt = admin.firestore.Timestamp.now();
      updates.autoRejectReason = "La sesión finalizó sin que ambos participantes se conectaran.";
    } else {
      // Calcular duración real vs umbral del 80%
      const startedAtMs = startedAt
        ? new Date(startedAt as string).getTime()
        : nowMs;
      const actualDurationSec = Math.max(0, (nowMs - startedAtMs) / 1000);
      const durationMinutes =
        typeof session.durationMinutes === "number" && session.durationMinutes > 0
          ? session.durationMinutes
          : FALLBACK_DURATION_MINUTES;
      const requiredDurationSec = durationMinutes * 60 * SESSION_COMPLETE_THRESHOLD_PCT;

      if (actualDurationSec >= requiredDurationSec) {
        finalStatus = "completed";
      } else {
        finalStatus = "session_incomplete";
        updates.actualDurationSeconds = Math.floor(actualDurationSec);
        updates.requiredDurationSeconds = Math.floor(requiredDurationSec);
      }
    }

    updates.status = finalStatus;

    // Detener grabación activa → el webhook de LiveKit (Bloque 9) actualizará a "ready"
    if (livekitEgressId && recordingStatus === "recording") {
      const egressClient = createEgressClient();
      await stopRecording(egressClient, livekitEgressId as string, cleanId);
      updates.recordingStatus = "processing";
    }

    await docRef.update(updates);

    logger.info("session_ended", {
      sessionId: cleanId,
      sessionType,
      uid,
      role: isCreator ? "creator" : "buyer",
      previousStatus: status,
      hadRecording: !!livekitEgressId,
    });

    return { success: true, finalStatus };
  }
);

// ── forceCompleteSession ──────────────────────────────────────────────────────
// Llamado por el comprador o creador cuando confirman que la sesión "Concluyó con éxito"
// a pesar de no haber alcanzado el umbral del 80%.

export const forceCompleteSession = onCall(
  { region: REGION, secrets: ALL_SECRETS },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const { sessionId, sessionType } = request.data ?? {};

    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId es requerido.");
    }

    const collection = resolveCollection(sessionType);
    const cleanId = sessionId.trim();
    const docRef = db.collection(collection).doc(cleanId);
    const snap = await docRef.get();

    if (!snap.exists) throw new HttpsError("not-found", "La sesión no existe.");

    const session = snap.data()!;
    const { creatorId, buyerId, status } = session;

    const isCreator = uid === creatorId;
    const isBuyer = uid === buyerId;
    if (!isCreator && !isBuyer) {
      throw new HttpsError("permission-denied", "No tienes acceso a esta sesión.");
    }

    if (!FORCE_COMPLETE_STATUSES.has(status)) {
      throw new HttpsError(
        "failed-precondition",
        `La sesión no puede marcarse como completada desde el estado: ${status}.`
      );
    }

    await docRef.update({
      status: "completed",
      forceCompletedAt: new Date().toISOString(),
      forceCompletedBy: uid,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    logger.info("session_force_completed", {
      sessionId: cleanId,
      sessionType,
      uid,
      role: isCreator ? "creator" : "buyer",
    });

    return { success: true };
  }
);
