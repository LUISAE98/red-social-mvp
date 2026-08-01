import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();

const REGION = "us-central1";
// Tope de puntos guardados (~4h a 1 muestra/min). Mantiene el doc pequeño.
const MAX_POINTS = 240;

type ViewerSample = { t: number; v: number };

// Muestrea, SERVER-SIDE, el número de espectadores de cada live activo y lo agrega
// a la línea del tiempo persistida (posts/{id}/liveStats/viewerHistory). Así la
// gráfica de espectadores queda guardada aunque el creador NO tenga su panel
// abierto (antes solo se muestreaba desde el cliente mientras el panel estaba
// montado, por eso quedaba sin datos al terminar). El servidor es la única fuente
// que escribe este doc; el cliente solo lo lee para mostrar la gráfica.
export const liveViewerSampler = onSchedule(
  { schedule: "every 1 minutes", region: REGION },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    const snapshot = await db
      .collection("posts")
      .where("liveData.status", "==", "live")
      .get();

    if (snapshot.empty) {
      logger.info("[viewerSampler] No hay lives activos.");
      return;
    }

    let sampled = 0;

    await Promise.all(
      snapshot.docs.map(async (postDoc) => {
        const postId = postDoc.id;
        try {
          // Espectadores presentes ahora (un doc por espectador en liveViewers).
          const countSnap = await db
            .collection("posts")
            .doc(postId)
            .collection("liveViewers")
            .count()
            .get();
          const v = countSnap.data().count;

          const histRef = db
            .collection("posts")
            .doc(postId)
            .collection("liveStats")
            .doc("viewerHistory");
          const histSnap = await histRef.get();
          const prev: ViewerSample[] =
            histSnap.exists && Array.isArray(histSnap.data()?.points)
              ? (histSnap.data()!.points as ViewerSample[])
              : [];
          const next = [...prev, { t: nowMs, v }].slice(-MAX_POINTS);

          await histRef.set({
            points: next,
            updatedAt: FieldValue.serverTimestamp(),
          });
          sampled++;
        } catch (err) {
          logger.warn(`[viewerSampler] error muestreando post=${postId}`, err);
        }
      }),
    );

    logger.info(
      `[viewerSampler] muestreados ${sampled}/${snapshot.size} live(s) activo(s).`,
    );
  },
);
