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
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
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
  createRoomServiceClient,
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
// Host donde vive la plantilla del egress de sesión. La ruta incluye el locale
// (/{locale}/egress/session) para que los textos horneados salgan en el idioma
// de la plataforma en el momento de la grabación.
const EGRESS_SESSION_HOST =
  process.env.EGRESS_SESSION_HOST ?? "https://vibraon.com";
const EGRESS_LOCALES = new Set(["es", "en", "pt-BR"]);

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
  sessionId: string,
  locale?: string
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
      customBaseUrl: `${EGRESS_SESSION_HOST}/${EGRESS_LOCALES.has(locale ?? "") ? locale : "en"}/egress/session`,
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

    // El registro de presencia y el ARRANQUE DEL CONTADOR se hacen dentro de una
    // TRANSACCIÓN para ser inmunes a la carrera cuando ambos entran casi a la vez
    // (p. ej. con el auto-abrir del 3-2-1). Antes eran lectura+escritura sueltas:
    // dos joins concurrentes leían el doc antes de que el otro escribiera su
    // joinedAt → ninguno detectaba bothJoined → nunca se fijaba startedAt +
    // timerRemainingMs → el contador NUNCA arrancaba, para ambos. Con la
    // transacción, el segundo commit ve el join del primero y arranca el timer.
    const now = new Date().toISOString();
    let bothJoined = false;
    let isCreator = false;
    let skipped = false;
    let startedNow = false;
    let roomNameForEgress: string | null = null;

    await db.runTransaction(async (tx) => {
      // Reiniciar en cada intento (la transacción puede reintentarse por conflicto).
      bothJoined = false;
      skipped = false;
      startedNow = false;
      roomNameForEgress = null;

      const snap = await tx.get(docRef);
      if (!snap.exists) throw new HttpsError("not-found", "La sesión no existe.");

      const session = snap.data()!;
      const { creatorId, buyerId, status, creatorJoinedAt, buyerJoinedAt, startedAt, roomName, durationMinutes } =
        session;

      isCreator = uid === creatorId;
      const isBuyer = uid === buyerId;
      if (!isCreator && !isBuyer) {
        throw new HttpsError("permission-denied", "No tienes acceso a esta sesión.");
      }

      if (!JOINABLE_STATUSES.has(status)) {
        logger.warn("session_join_skipped_invalid_status", { cleanId, status });
        skipped = true;
        return;
      }

      const updates: Record<string, unknown> = { updatedAt: admin.firestore.Timestamp.now() };

      // Registrar join del participante (idempotente)
      if (isCreator && !creatorJoinedAt) updates.creatorJoinedAt = now;
      if (isBuyer && !buyerJoinedAt) updates.buyerJoinedAt = now;
      // Presencia en vivo (respaldo del webhook participant_joined/left).
      if (isCreator) updates.creatorConnected = true;
      if (isBuyer) updates.buyerConnected = true;

      const creatorIsJoined = !!creatorJoinedAt || isCreator;
      const buyerIsJoined = !!buyerJoinedAt || isBuyer;
      bothJoined = creatorIsJoined && buyerIsJoined;

      if (bothJoined && !startedAt) {
        // ⚠️ ARRANQUE DEL CONTADOR DE LA SESIÓN — NO ELIMINAR NUNCA ⚠️
        // startedAt + timerRemainingMs alimentan el contador de la videollamada
        // (feature crítica). Si esto no corre, el contador nunca aparece.
        // Primera vez que ambos están en la sala
        updates.startedAt = now;
        updates.roomStatus = "in_progress";
        // Contador pausable: arranca corriendo con la duración completa. El webhook
        // de participantes lo pausa/reanuda; nunca se reinicia.
        updates.timerRemainingMs =
          (typeof durationMinutes === "number" && durationMinutes > 0
            ? durationMinutes
            : FALLBACK_DURATION_MINUTES) * 60000;
        updates.timerRunningSince = now;
        startedNow = true;
        roomNameForEgress = typeof roomName === "string" ? roomName : null;
      } else if (!startedAt) {
        // Solo uno conectado: sala lista, esperando al otro
        updates.roomStatus = "ready";
      }

      tx.update(docRef, updates);
    });

    if (skipped) {
      return { success: true, skipped: true, bothJoined: false };
    }

    // La grabación se arranca FUERA de la transacción (I/O externo, no permitido
    // dentro). Solo el participante que fijó startedAt entra aquí, así que no hay
    // doble egress: el otro ya ve startedAt puesto y no re-arranca.
    if (startedNow && roomNameForEgress) {
      const egressClient = createEgressClient();
      // Locale del cliente que completó la unión → textos horneados en ese idioma.
      const joinLocale = (request.data as { locale?: string } | undefined)?.locale;
      const egressId = await startRecording(egressClient, roomNameForEgress, cleanId, joinLocale);
      if (egressId) {
        await docRef.update({
          livekitEgressId: egressId,
          recordingStatus: "recording",
          updatedAt: admin.firestore.Timestamp.now(),
        });
      }
    }

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
    const { creatorId, buyerId, status, livekitEgressId, recordingStatus, startedAt, creatorJoinedAt, buyerJoinedAt, roomName } = session;

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

    // No cortamos la grabación de inmediato: señalamos el cierre por metadata de
    // la sala. La plantilla de grabación reproduce ~6s de negro con el bloque
    // "Vibra/vibraon.com" (aparece en el segundo 1) y recién ahí detiene el
    // egress. Si la señal falla, cortamos el egress directo como respaldo.
    if (livekitEgressId && recordingStatus === "recording") {
      let signaled = false;
      if (roomName) {
        try {
          await createRoomServiceClient().updateRoomMetadata(
            roomName as string,
            JSON.stringify({ ended: true })
          );
          signaled = true;
        } catch (err: unknown) {
          logger.warn("session_end_outro_signal_failed", { sessionId: cleanId, err: String(err) });
        }
      }
      if (!signaled) {
        const egressClient = createEgressClient();
        await stopRecording(egressClient, livekitEgressId as string, cleanId);
        updates.recordingStatus = "processing";
      }
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

// ── signalSessionClosing ──────────────────────────────────────────────────────
// Señala fases del cierre a la PLANTILLA DE GRABACIÓN vía metadata de la sala.
// NO cambia el estado de la sesión: la videollamada de los participantes sigue
// con su gracia intacta (ver ⚠️ del contador en LiveKitVideoRoom).
//   · phase "overlay_out" (t=-5): la plantilla desvanece el overlay de la esquina.
//   · phase "closing"     (t=0):  la plantilla arranca su outro de 10s.
// La metadata es acumulativa: "closing" conserva overlayOut para que la plantilla
// no revierta el desvanecido si vuelve a leer la metadata.
export const signalSessionClosing = onCall(
  { region: REGION, secrets: ALL_SECRETS },
  async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const { sessionId, sessionType, phase } = request.data ?? {};

    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId es requerido.");
    }

    const collection = resolveCollection(sessionType);
    const cleanId = sessionId.trim();
    const snap = await db.collection(collection).doc(cleanId).get();
    if (!snap.exists) return { success: true, skipped: true };

    const session = snap.data()!;
    const { creatorId, buyerId, livekitEgressId, recordingStatus, roomName } = session;
    if (uid !== creatorId && uid !== buyerId) {
      throw new HttpsError("permission-denied", "No tienes acceso a esta sesión.");
    }

    const overlayOutOnly = phase === "overlay_out";
    const metadata = overlayOutOnly
      ? { overlayOut: true }
      : { overlayOut: true, closing: true };

    if (livekitEgressId && recordingStatus === "recording" && roomName) {
      try {
        await createRoomServiceClient().updateRoomMetadata(
          roomName as string,
          JSON.stringify(metadata)
        );
      } catch (err: unknown) {
        logger.warn("signal_session_closing_failed", {
          sessionId: cleanId,
          phase: overlayOutOnly ? "overlay_out" : "closing",
          err: String(err),
        });
      }
    }

    return { success: true };
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

// ── Respaldo: finalizar la grabación ──────────────────────────────────────────
// La plantilla de grabación reproduce el outro y detiene el egress sola. Por si
// no lo hace (p.ej. plantilla no desplegada o error), este trigger lo detiene
// ~12s después de que la sesión pasa a un estado terminal, para garantizar que
// la grabación quede finalizada y sea DESCARGABLE.
const TERMINAL_STATUSES = ["completed", "session_incomplete", "rejected"];

async function finalizeRecordingBackstop(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined,
  ref: FirebaseFirestore.DocumentReference
): Promise<void> {
  if (!after) return;
  const beforeStatus = before ? String(before.status ?? "") : "";
  const afterStatus = String(after.status ?? "");

  // Solo cuando ACABA de pasar a terminal, con grabación activa.
  if (!TERMINAL_STATUSES.includes(afterStatus) || TERMINAL_STATUSES.includes(beforeStatus)) return;
  if (after.recordingStatus !== "recording" || !after.livekitEgressId) return;

  // Dar tiempo a que la plantilla reproduzca su outro y cierre el egress sola.
  await new Promise((r) => setTimeout(r, 12000));

  // Re-leer: si la plantilla ya lo cerró, no hacer nada.
  const fresh = await ref.get();
  const data = fresh.data();
  if (!data || data.recordingStatus !== "recording" || !data.livekitEgressId) return;

  try {
    await stopRecording(createEgressClient(), data.livekitEgressId as string, ref.id);
    await ref.update({
      recordingStatus: "processing",
      updatedAt: admin.firestore.Timestamp.now(),
    });
    logger.info("session_recording_backstop_stopped", { sessionId: ref.id });
  } catch (err: unknown) {
    logger.warn("session_recording_backstop_failed", { sessionId: ref.id, err: String(err) });
  }
}

export const finalizeMeetGreetRecording = onDocumentUpdated(
  { document: "meetGreetRequests/{id}", region: REGION, secrets: ALL_SECRETS },
  async (event) => {
    if (!event.data) return;
    await finalizeRecordingBackstop(
      event.data.before.data(),
      event.data.after.data(),
      event.data.after.ref
    );
  }
);

export const finalizeExclusiveSessionRecording = onDocumentUpdated(
  { document: "exclusiveSessionRequests/{id}", region: REGION, secrets: ALL_SECRETS },
  async (event) => {
    if (!event.data) return;
    await finalizeRecordingBackstop(
      event.data.before.data(),
      event.data.after.data(),
      event.data.after.ref
    );
  }
);
