// Cloud Function: getRecordingDownloadUrl
// Genera una URL pre-firmada (1 hora) para descargar una grabación de sesión desde R2.
// Solo el comprador o el creador de la sesión pueden obtener la URL.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { egressS3AccessKey, egressS3SecretKey } from "./livekit";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

type SessionType = "exclusive_session" | "meet_greet";

const COLLECTION_BY_TYPE: Record<SessionType, string> = {
  exclusive_session: "exclusiveSessionRequests",
  meet_greet: "meetGreetRequests",
};

// Extrae la clave del objeto R2 desde la location que devuelve LiveKit Egress.
// LiveKit puede devolver distintos formatos dependiendo del endpoint configurado:
//   "s3://bucket/key"             → egress estándar AWS
//   "https://endpoint/bucket/key" → egress con endpoint personalizado (R2, MinIO)
//   "bucket/key"                  → algunas versiones del SDK
//   "key"                         → clave directa
export function extractS3Key(location: string, bucket: string): string {
  // Formato s3://: "s3://bucket-name/path/to/file" → "path/to/file"
  if (location.startsWith("s3://")) {
    const withoutProtocol = location.slice(5);
    const firstSlash = withoutProtocol.indexOf("/");
    return firstSlash >= 0 ? withoutProtocol.slice(firstSlash + 1) : withoutProtocol;
  }

  // Formato URL HTTPS completa (endpoint personalizado como R2):
  // "https://xxx.r2.cloudflarestorage.com/bucket/path/to/file" → "path/to/file"
  if (location.startsWith("https://") || location.startsWith("http://")) {
    try {
      const url = new URL(location);
      let pathname = url.pathname;
      // Quitar slash inicial
      if (pathname.startsWith("/")) pathname = pathname.slice(1);
      // Quitar nombre del bucket si está como prefijo del path
      if (pathname.startsWith(`${bucket}/`)) {
        return pathname.slice(bucket.length + 1);
      }
      return pathname;
    } catch {
      // Si URL inválida, caer al fallback
    }
  }

  // Formato "bucket/key": "vibra-session-recordings/path/to/file" → "path/to/file"
  if (location.startsWith(`${bucket}/`)) {
    return location.slice(bucket.length + 1);
  }

  // Asumir que ya es la clave directa
  return location;
}

export const getRecordingDownloadUrl = onCall(
  {
    region: REGION,
    secrets: [egressS3AccessKey, egressS3SecretKey],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const { sessionId, sessionType } = request.data ?? {};

    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId es requerido.");
    }
    if (sessionType !== "exclusive_session" && sessionType !== "meet_greet") {
      throw new HttpsError("invalid-argument", "sessionType inválido.");
    }

    const collection = COLLECTION_BY_TYPE[sessionType as SessionType];
    const snap = await db.collection(collection).doc(sessionId.trim()).get();

    if (!snap.exists) throw new HttpsError("not-found", "La sesión no existe.");

    const session = snap.data()!;
    const { creatorId, buyerId, recordingStatus, recordingS3Key, recordingUrl } = session;

    if (uid !== creatorId && uid !== buyerId) {
      throw new HttpsError("permission-denied", "No tienes acceso a esta grabación.");
    }

    if (recordingStatus !== "ready") {
      throw new HttpsError("failed-precondition", "La grabación no está disponible aún.");
    }

    // Usar recordingS3Key si está disponible; si no, extraer de recordingUrl (legacy)
    const bucket = process.env.LIVEKIT_EGRESS_S3_BUCKET ?? "";
    const endpoint = process.env.LIVEKIT_EGRESS_S3_ENDPOINT ?? "";
    const region = process.env.LIVEKIT_EGRESS_S3_REGION ?? "auto";

    if (!bucket || !endpoint) {
      logger.error("getRecordingDownloadUrl_missing_s3_config", { sessionId });
      throw new HttpsError("internal", "Configuración de almacenamiento no disponible.");
    }

    const rawLocation: string =
      typeof recordingS3Key === "string" && recordingS3Key
        ? recordingS3Key
        : typeof recordingUrl === "string" && recordingUrl
        ? recordingUrl
        : "";

    logger.info("recording_download_raw_location", {
      sessionId,
      recordingS3Key: recordingS3Key ?? null,
      recordingUrl: recordingUrl ?? null,
      rawLocation,
      bucket,
      endpoint,
    });

    if (!rawLocation) {
      throw new HttpsError("not-found", "La grabación no tiene URL disponible.");
    }

    const key = extractS3Key(rawLocation, bucket);

    logger.info("recording_download_computed_key", { sessionId, rawLocation, key, bucket });

    const accessKey = egressS3AccessKey.value();
    const secretKey = egressS3SecretKey.value();

    if (!accessKey || !secretKey) {
      logger.error("getRecordingDownloadUrl_missing_credentials", { sessionId });
      throw new HttpsError("internal", "Credenciales de almacenamiento no configuradas.");
    }

    const [{ GetObjectCommand, S3Client }, { getSignedUrl }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
    const client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });

    const filename = `sesion_${sessionId}.mp4`;
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    const signedUrl = await getSignedUrl(client, command, { expiresIn: 3600 }); // 1 hora

    logger.info("recording_download_url_generated", {
      sessionId,
      sessionType,
      uid,
      key,
    });

    return { url: signedUrl };
  }
);
