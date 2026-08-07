// Cloud Function: greetingAnimatedDownload
//
// Descarga ANIMADA de un saludo / consejo. A diferencia de la descarga
// estática (videoOverlayDownload, que compone un PNG con FFmpeg), esta "hornea"
// el video con la portada de 6s, la esquina animada y el cierre — grabando la
// plantilla web `app/[locale]/egress/greeting` con LiveKit Web Egress.
//
// Flujo (síncrono para el cliente, ~intro+video+outro segundos):
//   1. Arranca un Web Egress apuntando a la plantilla pública con los datos.
//   2. La plantilla llama a EgressHelper.startRecording() cuando el video carga
//      (awaitStartSignal), reproduce intro → video → outro y luego endRecording().
//   3. Aquí se hace polling del egress hasta que completa y sube a R2.
//   4. Se devuelve una URL pre-firmada (1h) para descargar el MP4 final.
//
// La descarga estática se mantiene como fallback en el cliente (no se toca).

import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import {
  EncodedFileOutput,
  S3Upload,
  EncodingOptions,
  EgressStatus,
  type EgressInfo,
} from "livekit-server-sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  livekitApiKey,
  livekitApiSecret,
  egressS3AccessKey,
  egressS3SecretKey,
  createEgressClient,
} from "./livekit";
import { extractS3Key } from "./recordingDownload";

if (admin.apps.length === 0) admin.initializeApp();

const REGION = "us-central1";

// Host público donde vive la plantilla de grabación (el grabador headless la abre).
const GREETING_EGRESS_HOST =
  process.env.GREETING_EGRESS_HOST ?? "https://vibraon.com";

const LOCALES = new Set(["es", "en", "pt-BR"]);
const TYPES = new Set(["saludo", "consejo"]);

const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 500_000; // < timeoutSeconds; guarda contra egress colgado.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const greetingAnimatedDownload = onRequest(
  {
    cors: true,
    region: REGION,
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: [livekitApiKey, livekitApiSecret, egressS3AccessKey, egressS3SecretKey],
  },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
    let uid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: "Invalid token" }); return;
    }

    const body = req.body as {
      playbackId?: string;
      name?: string;
      avatar?: string;
      type?: string;
      orientation?: string;
      locale?: string;
    };
    const playbackId = (body.playbackId ?? "").trim();
    if (!playbackId) { res.status(400).json({ error: "Missing playbackId" }); return; }

    const name = (body.name ?? "").slice(0, 80);
    const avatar = (body.avatar ?? "").slice(0, 600);
    const type = TYPES.has(body.type ?? "") ? body.type! : "saludo";
    const orientation = body.orientation === "vertical" ? "vertical" : "horizontal";
    const locale = LOCALES.has(body.locale ?? "") ? body.locale! : "en";

    // Config S3/R2 (mismas credenciales que la grabación de sesiones).
    const bucket = process.env.LIVEKIT_EGRESS_S3_BUCKET ?? "";
    const region = process.env.LIVEKIT_EGRESS_S3_REGION ?? "auto";
    const endpoint = process.env.LIVEKIT_EGRESS_S3_ENDPOINT ?? "";
    const accessKey = egressS3AccessKey.value();
    const secretKey = egressS3SecretKey.value();

    if (!bucket || !endpoint || !accessKey || !secretKey) {
      logger.error("greetingAnimatedDownload_missing_s3_config", { hasBucket: !!bucket, hasEndpoint: !!endpoint });
      res.status(500).json({ error: "Storage not configured" });
      return;
    }

    // URL pública de la plantilla con los datos del saludo en query params.
    const q = new URLSearchParams({ playbackId, name, avatar, type, orientation });
    const egressUrl = `${GREETING_EGRESS_HOST}/${locale}/egress/greeting?${q.toString()}`;

    const s3 = new S3Upload({
      accessKey,
      secret: secretKey,
      bucket,
      region,
      endpoint,
      forcePathStyle: true,
    });

    const fileOutput = new EncodedFileOutput({
      filepath: `greetings/render_${uid}_${Date.now()}/{time}.mp4`,
      output: { case: "s3", value: s3 },
    });

    // Calidad alta: 1080p a 6 Mbps (bien por encima del preset ~3-4.5 Mbps) para
    // conservar al máximo el video de Mux, que ya viene comprimido. keyFrame cada 2s.
    const encoding = new EncodingOptions({
      width: orientation === "vertical" ? 1080 : 1920,
      height: orientation === "vertical" ? 1920 : 1080,
      framerate: 30,
      videoBitrate: 6000,
      audioBitrate: 128,
      keyFrameInterval: 2,
    });

    const egressClient = createEgressClient();

    let egressId: string | undefined;
    try {
      const info = await egressClient.startWebEgress(egressUrl, fileOutput, {
        // Espera a que la plantilla llame EgressHelper.startRecording() cuando el
        // video de Mux esté cargado — así no se graba un frame en blanco al inicio.
        awaitStartSignal: true,
        encodingOptions: encoding,
      });
      egressId = info.egressId;
      logger.info("greetingAnimatedDownload_started", { uid, playbackId, orientation, egressId });
    } catch (err) {
      logger.error("greetingAnimatedDownload_start_failed", { uid, playbackId, err });
      res.status(502).json({ error: "Could not start render" });
      return;
    }

    // Polling hasta que el egress complete (la plantilla llama endRecording() al
    // final del outro). Guarda de tiempo por si el grabador se cuelga.
    const deadline = Date.now() + MAX_WAIT_MS;
    let finalInfo: EgressInfo | undefined;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      let list: EgressInfo[];
      try {
        list = await egressClient.listEgress({ egressId });
      } catch (err) {
        logger.warn("greetingAnimatedDownload_poll_failed", { egressId, err });
        continue;
      }
      const cur = list[0];
      if (!cur) continue;
      if (cur.status === EgressStatus.EGRESS_COMPLETE) { finalInfo = cur; break; }
      if (cur.status === EgressStatus.EGRESS_FAILED || cur.status === EgressStatus.EGRESS_ABORTED) {
        logger.error("greetingAnimatedDownload_egress_failed", { egressId, status: cur.status, error: cur.error });
        res.status(500).json({ error: "Render failed" });
        return;
      }
    }

    if (!finalInfo) {
      // Timeout: detener el egress colgado para no dejarlo corriendo/facturando.
      try { await egressClient.stopEgress(egressId); } catch { /* ya terminó */ }
      logger.error("greetingAnimatedDownload_timeout", { egressId });
      res.status(504).json({ error: "Render timed out" });
      return;
    }

    // La ubicación viene en fileResults[] (moderno) o en el oneof `result`
    // DEPRECADO (case "file"). En el objeto protobuf crudo el oneof se accede como
    // info.result.value.location — NO como info.file.location. Serializar a JSON
    // aplana el oneof a `file`, así que leemos de ahí y no dependemos de la forma
    // interna del protobuf (esto era el bug que mandaba todo al canvas viejo).
    const readLocation = (info: EgressInfo): string => {
      const plain = JSON.parse(
        JSON.stringify(info, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
      ) as { fileResults?: Array<{ location?: string }>; file?: { location?: string } };
      return plain.fileResults?.[0]?.location || plain.file?.location || "";
    };

    let location = readLocation(finalInfo);
    for (let i = 0; i < 5 && !location; i++) {
      await sleep(1500);
      try {
        const l = await egressClient.listEgress({ egressId });
        if (l[0]) { finalInfo = l[0]; location = readLocation(l[0]); }
      } catch { /* reintentar */ }
    }

    if (!location) {
      logger.error("greetingAnimatedDownload_no_output", {
        egressId,
        status: finalInfo.status,
        fileResultsLen: finalInfo.fileResults?.length ?? 0,
        info: JSON.stringify(finalInfo, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 1800),
      });
      res.status(500).json({ error: "No output produced" });
      return;
    }

    const key = extractS3Key(location, bucket);
    const filename = `vibra-${type}-${(name || "video").replace(/\s+/g, "-")}.mp4`;

    const client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true,
    });
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    const url = await getSignedUrl(client, command, { expiresIn: 3600 });

    logger.info("greetingAnimatedDownload_done", { uid, playbackId, egressId, key });
    res.status(200).json({ url, filename });
  }
);
