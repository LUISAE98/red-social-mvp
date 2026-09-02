// Limpieza de referencias a videos que ya no existen en Mux.
//
// Borrar un asset en Mux no avisa a Firestore. El documento se queda con un
// `playbackId` que parece sano, y lo que da 404 es el video al reproducirlo. En
// un rail eso era una miniatura gris; en el feed de reels es un slide negro a
// pantalla completa.
//
// Se preguntan los ids a Mux (`playbackIds.retrieve`, que resuelve por playback
// id sin necesitar el asset id, que es lo único que guardan las historias) y se
// limpia lo que ya no está.
//
// ⚠️ Las dos colecciones NO se tratan igual, a propósito:
//   - Una HISTORIA sin video no es nada, así que se borra el documento.
//   - Un POST puede tener texto, imágenes y varios videos. Ahí se limpia solo la
//     referencia rota y el post sobrevive. Borrar posts por un video caído sería
//     destruir contenido que su autor no ha pedido borrar.

import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { createMuxClient, muxTokenId, muxTokenSecret } from "./mux";
import { requirePlatformOwner } from "./authz";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";
const PAGE = 200;

type Counters = {
  dryRun: boolean;
  playbackIdsRevisados: number;
  playbackIdsMuertos: number;
  historiasRevisadas: number;
  historiasBorradas: number;
  postsRevisados: number;
  postsLimpiados: number;
  erroresConsultandoMux: number;
};

/**
 * ¿Sigue vivo este playback id en Mux?
 *
 * Se cachea por id porque el mismo video puede estar referenciado en varios
 * documentos (la historia del creador y la del comprador, por ejemplo), y no
 * tiene sentido preguntarlo dos veces.
 */
async function makeAliveChecker(counters: Counters) {
  const mux = await createMuxClient();
  const cache = new Map<string, boolean>();

  return async function isAlive(playbackId: string): Promise<boolean> {
    const cached = cache.get(playbackId);
    if (cached !== undefined) return cached;

    counters.playbackIdsRevisados += 1;
    let alive = true;
    try {
      await mux.video.playbackIds.retrieve(playbackId);
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 404) {
        alive = false;
        counters.playbackIdsMuertos += 1;
      } else {
        // Un fallo que NO es 404 (red, cuota, permisos) no prueba que el video
        // esté borrado. Se cuenta como vivo para no borrar nada por error.
        counters.erroresConsultandoMux += 1;
        logger.warn("muxOrphanCleanup: consulta fallida, se asume vivo", {
          playbackId,
          status,
        });
      }
    }
    cache.set(playbackId, alive);
    return alive;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickPlaybackId(value: unknown): string | null {
  const rec = asRecord(value);
  const raw = rec?.playbackId;
  return typeof raw === "string" && raw ? raw : null;
}

/** Solo los videos de Mux. Cloudflare y los HLS externos no se tocan. */
function isMuxProvider(value: unknown): boolean {
  const provider = asRecord(value)?.provider;
  return provider === undefined || provider === null || provider === "mux";
}

export const cleanupDeletedMuxVideos = onCall(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [muxTokenId, muxTokenSecret],
  },
  async (request) => {
    requirePlatformOwner(request);

    // Por defecto NO escribe. La primera pasada solo cuenta.
    const dryRun = request.data?.dryRun !== false;

    const counters: Counters = {
      dryRun,
      playbackIdsRevisados: 0,
      playbackIdsMuertos: 0,
      historiasRevisadas: 0,
      historiasBorradas: 0,
      postsRevisados: 0,
      postsLimpiados: 0,
      erroresConsultandoMux: 0,
    };

    const isAlive = await makeAliveChecker(counters);

    // ── Historias ────────────────────────────────────────────────────────────
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let q = db.collection("stories").orderBy("__name__").limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;

      for (const storyDoc of snap.docs) {
        counters.historiasRevisadas += 1;
        const playbackId = storyDoc.get("muxPlaybackId");
        if (typeof playbackId !== "string" || !playbackId) continue;
        if (await isAlive(playbackId)) continue;

        counters.historiasBorradas += 1;
        if (!dryRun) await storyDoc.ref.delete();
      }

      cursor = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.size < PAGE) break;
    }

    // ── Posts ────────────────────────────────────────────────────────────────
    cursor = null;
    for (;;) {
      let q = db.collection("posts").orderBy("__name__").limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;

      for (const postDoc of snap.docs) {
        counters.postsRevisados += 1;
        const data = postDoc.data() as Record<string, unknown>;
        const patch: Record<string, unknown> = {};

        // 1. Video raíz del post.
        const videoData = asRecord(data.videoData);
        const videoPid = pickPlaybackId(videoData);
        if (videoPid && isMuxProvider(videoData) && !(await isAlive(videoPid))) {
          patch.videoData = {
            ...videoData,
            playbackId: null,
            status: "deleted_at_source",
          };
        }

        // 2. Información de reproducción, que a veces duplica el playback id.
        const playback = asRecord(data.playback);
        const playbackPid = pickPlaybackId(playback);
        if (playbackPid && isMuxProvider(playback) && !(await isAlive(playbackPid))) {
          patch.playback = {
            ...playback,
            playbackId: null,
            hlsUrl: null,
            url: null,
            isReady: false,
          };
        }

        // 3. La grabación de un en vivo (VOD).
        const liveData = asRecord(data.liveData);
        const livePid = pickPlaybackId(liveData);
        if (livePid && liveData?.streamProvider === "mux" && !(await isAlive(livePid))) {
          patch.liveData = { ...liveData, playbackId: null, hlsUrl: null, vodStatus: null };
        }

        // 4. Cada video dentro de `media[]`.
        if (Array.isArray(data.media)) {
          let mediaTouched = false;
          const nextMedia = [];
          for (const raw of data.media) {
            const item = asRecord(raw);
            const pid = pickPlaybackId(item);
            if (item && pid && isMuxProvider(item) && !(await isAlive(pid))) {
              mediaTouched = true;
              nextMedia.push({ ...item, playbackId: null, status: "deleted_at_source" });
            } else {
              nextMedia.push(raw);
            }
          }
          if (mediaTouched) patch.media = nextMedia;
        }

        if (Object.keys(patch).length === 0) continue;
        counters.postsLimpiados += 1;
        if (!dryRun) {
          patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          await postDoc.ref.set(patch, { merge: true });
        }
      }

      cursor = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.size < PAGE) break;
    }

    logger.info("cleanupDeletedMuxVideos", counters);
    return counters;
  }
);
