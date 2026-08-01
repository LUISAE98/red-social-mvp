import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();

const db = getFirestore();
const REGION = "us-central1";
const BATCH_LIMIT = 450;
// Mismo tope que `liveViewerSampler` (~4h a 1 muestra/min).
const MAX_HISTORY_POINTS = 240;

export const cleanupLiveViewersOnEnd = onDocumentUpdated(
  { document: "posts/{postId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const statusBefore = (before?.liveData as Record<string, unknown> | undefined)?.status;
    const statusAfter = (after?.liveData as Record<string, unknown> | undefined)?.status;

    if (statusAfter !== "ended" || statusBefore === "ended") return;

    const { postId } = event.params;
    logger.info(`[liveViewersCleanup] Live ended for post ${postId}, cleaning up liveViewers`);

    const viewersRef = db.collection("posts").doc(postId).collection("liveViewers");

    // Punto FINAL de la gráfica de espectadores: cuenta los presentes JUSTO al
    // terminar (antes de borrarlos) y lo agrega a la línea del tiempo, para cerrar
    // la curva exactamente en el fin del live (con el timestamp de endedAt).
    try {
      const countSnap = await viewersRef.count().get();
      const v = countSnap.data().count;
      const endedAt = (after?.liveData as Record<string, unknown> | undefined)?.endedAt as
        | { toMillis?: () => number }
        | undefined;
      const tMs =
        endedAt && typeof endedAt.toMillis === "function" ? endedAt.toMillis() : Date.now();

      const histRef = db.collection("posts").doc(postId).collection("liveStats").doc("viewerHistory");
      const histSnap = await histRef.get();
      const prev: { t: number; v: number }[] =
        histSnap.exists && Array.isArray(histSnap.data()?.points)
          ? (histSnap.data()!.points as { t: number; v: number }[])
          : [];
      const next = [...prev, { t: tMs, v }].slice(-MAX_HISTORY_POINTS);
      await histRef.set({ points: next, updatedAt: FieldValue.serverTimestamp() });
      logger.info(`[liveViewersCleanup] Punto final de espectadores guardado post=${postId} v=${v}`);
    } catch (err) {
      logger.warn(`[liveViewersCleanup] no se pudo guardar el punto final de espectadores post=${postId}`, err);
    }

    let deleted = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snap = await viewersRef.limit(BATCH_LIMIT).get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;

      if (snap.size < BATCH_LIMIT) break;
    }

    logger.info(`[liveViewersCleanup] Deleted ${deleted} viewer docs for post ${postId}`);
  }
);
