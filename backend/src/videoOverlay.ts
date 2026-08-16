import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { isGreetingParticipant } from "./greetingAccess";
import { consumeQuota } from "./quotas";

if (admin.apps.length === 0) admin.initializeApp();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegBin: string = (require("@ffmpeg-installer/ffmpeg") as { path: string }).path;

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-3000)}`));
    });
    proc.on("error", reject);
  });
}

// Tope del PNG de overlay. Sin él, el cuerpo de la petición era ilimitado y se
// escribía a disco antes de tocar FFmpeg.
const MAX_OVERLAY_BASE64 = 12 * 1024 * 1024; // ~9 MB ya decodificado

export const videoOverlayDownload = onRequest(
  { cors: true, region: "us-central1", memory: "2GiB", timeoutSeconds: 300, maxInstances: 10 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
    let uid: string;
    try {
      uid = (await admin.auth().verifyIdToken(authHeader.slice(7))).uid;
    } catch {
      res.status(401).json({ error: "Invalid token" }); return;
    }

    // Body is parsed as JSON automatically by Firebase Functions
    const body = req.body as { playbackId?: string; overlayBase64?: string };
    const { playbackId, overlayBase64 } = body;
    if (!playbackId || !overlayBase64) {
      res.status(400).json({ error: "Missing playbackId or overlayBase64" });
      return;
    }

    if (overlayBase64.length > MAX_OVERLAY_BASE64) {
      res.status(413).json({ error: "Overlay too large" });
      return;
    }

    // Tener sesión no basta: hay que ser parte de ESE saludo.
    if (!(await isGreetingParticipant(uid, playbackId))) {
      logger.warn("videoOverlayDownload: acceso denegado", { uid, playbackId });
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Este render levanta FFmpeg con 2 GiB durante hasta 5 minutos: es de lo más
    // caro que se puede disparar desde fuera. Va después del permiso para no
    // gastarle el día a quien ni siquiera es parte del saludo.
    //
    // Es `onRequest`, no `onCall`, así que el tope se traduce a un 429 con el
    // mismo texto que usan las demás cuotas.
    try {
      await consumeQuota(uid, "videoOverlay");
    } catch (err) {
      res.status(429).json({ error: (err as { message?: string })?.message ?? "Límite alcanzado." });
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tmpDir = os.tmpdir();
    const inputPath   = path.join(tmpDir, `input-${id}.mp4`);
    const overlayPath = path.join(tmpDir, `overlay-${id}.png`);
    const outputPath  = path.join(tmpDir, `output-${id}.mp4`);

    try {
      // Write overlay PNG decoded from base64
      fs.writeFileSync(overlayPath, Buffer.from(overlayBase64, "base64"));

      // Download original Mux video
      const muxUrl = `https://stream.mux.com/${playbackId}/high.mp4`;
      logger.info("videoOverlayDownload: downloading from Mux", { playbackId });
      const muxRes = await fetch(muxUrl);
      if (!muxRes.ok) throw new Error(`Mux fetch ${muxRes.status}`);
      fs.writeFileSync(inputPath, Buffer.from(await muxRes.arrayBuffer()));

      // Composite overlay on video — CRF 18 is visually near-lossless
      logger.info("videoOverlayDownload: running FFmpeg");
      await runFFmpeg([
        "-i", inputPath,
        "-i", overlayPath,
        "-filter_complex", "[0:v][1:v]overlay=0:0",
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "fast",
        "-c:a", "copy",
        "-movflags", "+faststart",
        "-y", outputPath,
      ]);

      const stat = fs.statSync(outputPath);
      logger.info("videoOverlayDownload: done", { bytes: stat.size });

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Disposition", `attachment; filename="vibra-video.mp4"`);

      const reader = fs.createReadStream(outputPath);
      reader.pipe(res as unknown as NodeJS.WritableStream);
      await new Promise<void>((resolve, reject) => {
        res.on("finish", resolve);
        res.on("error", reject);
        reader.on("error", reject);
      });
    } catch (err) {
      logger.error("videoOverlayDownload error", err);
      if (!res.headersSent) res.status(500).json({ error: "Processing failed" });
    } finally {
      for (const p of [inputPath, overlayPath, outputPath]) {
        try { fs.unlinkSync(p); } catch { /* already removed */ }
      }
    }
  }
);
