// Descubrimiento de historias: contador de vistas (E) y saneamiento del feed.
//
// El backfill (D) de `categories` y `viewsCount` se retiró el 2026-08-13: era un
// `onRequest` sin autenticación que recorría la colección `stories` completa con
// privilegios Admin. Ya se había ejecutado. Ver el comentario en `index.ts`. El
// backfill de más abajo NO repite ese error: exige dueño de plataforma y por
// defecto no escribe.
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { requirePlatformOwner } from "./authz";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

// E — Contador de vistas.
//
// ⚠️ Este disparador YA NO CUENTA, y no es un olvido.
//
// `userStoryViews` marca "ya la vi" para que el feed de reels no vuelva a
// mostrarla, y eso ocurre a los DOS SEGUNDOS. Una VISTA contable es otra cosa:
// exige el 35% del video y suma cada vez que ocurre, no una vez por persona.
// Son dos umbrales, dos significados y dos recuentos distintos.
//
// Mientras esto incrementaba, cada persona sumaba ademas +1 al cruzar los dos
// segundos, asi que el numero mezclaba las dos cosas. Ahora cuenta solo
// `recordStoryPlay`.
//
// Se deja como no-op en vez de borrarse: una funcion desplegada que se quita del
// codigo sigue viva en el proyecto ejecutando la version ANTERIOR hasta que se
// borra de verdad, y ahi volveria el doble conteo. Se puede retirar del proyecto
// cuando toque limpiar.
export const onStoryViewed = onDocumentCreated(
  { document: "userStoryViews/{userId}/views/{storyId}", region: REGION },
  async () => {
    return;
  }
);

/**
 * Suma UNA vista a una historia.
 *
 * Lo llama el reproductor al pasar del 35% del video, una sola vez por apertura.
 * Cuenta cada apertura: ver la misma historia en el reel y luego otra vez desde
 * el perfil del creador son dos vistas, que es justo lo que se quiere medir.
 *
 * Vive en el servidor porque las reglas prohiben actualizar historias desde el
 * cliente, y porque un contador que el cliente puede escribir no es un contador.
 */
export const recordStoryPlay = onCall({ region: REGION }, async (request) => {
  // Basta con estar identificado; las cuentas anonimas tambien miran, y sus
  // vistas cuentan igual.
  if (!request.auth) return { counted: false };

  const storyId =
    typeof request.data?.storyId === "string" ? request.data.storyId.trim() : "";
  if (!storyId) return { counted: false };

  const inc = admin.firestore.FieldValue.increment(1);

  try {
    await db.collection("stories").doc(storyId).update({ viewsCount: inc });
    return { counted: true };
  } catch {
    // Puede ser una MUESTRA del escaparate, que vive en otra coleccion, o una
    // historia ya borrada.
    try {
      await db.collection("greetingSamples").doc(storyId).update({ viewsCount: inc });
      return { counted: true };
    } catch {
      return { counted: false };
    }
  }
});

// ─── Video de la historia (muxPlaybackId) ────────────────────────────────────
//
// La historia la crea el CLIENTE copiando el `muxPlaybackId` de la solicitud. Si
// el creador la publica mientras Mux todavía procesa, esa copia queda en null —
// y ahí se queda para siempre, porque las reglas no dejan actualizar historias.
//
// El cliente intentaba taparlo releyendo `greetingRequests`, pero esa regla solo
// deja al comprador y al creador: para cualquier otro espectador falla siempre y
// el error se traga en silencio. En un carrusel de círculos eso era una miniatura
// gris; en un reel a pantalla completa es un slide negro. Se resuelve donde sí se
// puede, en el servidor.

/** Copia el playbackId a las historias de esa solicitud que aún no lo tengan. */
export async function syncStoryPlaybackFromGreeting(params: {
  greetingRequestId: string;
  playbackId: string;
  duration?: number | null;
}): Promise<number> {
  const { greetingRequestId, playbackId, duration } = params;
  if (!greetingRequestId || !playbackId) return 0;

  const snap = await db
    .collection("stories")
    .where("greetingRequestId", "==", greetingRequestId)
    .get();
  if (snap.empty) return 0;

  const patch: Record<string, unknown> = {
    muxPlaybackId: playbackId,
    thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`,
  };
  if (typeof duration === "number") patch.videoDuration = duration;

  const batch = db.batch();
  let writes = 0;
  for (const storyDoc of snap.docs) {
    if (storyDoc.get("muxPlaybackId")) continue;
    batch.set(storyDoc.ref, patch, { merge: true });
    writes += 1;
  }
  if (writes > 0) await batch.commit();
  return writes;
}

// Carrera estrecha pero real: si el webhook de Mux llega DESPUÉS de que el
// cliente leyó la solicitud (sin playbackId) y ANTES de que escriba la historia,
// el webhook no encuentra nada que parchear y la historia nace muerta. Este
// disparador cierra ese hueco por el otro lado.
export const onStoryCreatedPlaybackBackfill = onDocumentCreated(
  { document: "stories/{storyId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    if (snap.get("muxPlaybackId")) return;

    const greetingRequestId = snap.get("greetingRequestId");
    if (typeof greetingRequestId !== "string" || !greetingRequestId) return;

    try {
      const greeting = await db
        .collection("greetingRequests")
        .doc(greetingRequestId)
        .get();
      const playbackId = greeting.get("muxPlaybackId");
      if (typeof playbackId !== "string" || !playbackId) return;

      await snap.ref.set(
        {
          muxPlaybackId: playbackId,
          thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`,
          videoDuration: greeting.get("videoDuration") ?? null,
        },
        { merge: true }
      );
    } catch (error) {
      logger.error("onStoryCreatedPlaybackBackfill: fallo", {
        storyId: event.params.storyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// ─── Backfill de los campos del reel ─────────────────────────────────────────
//
// `byCreator` y `hiddenFromReel` nacen con el reel, así que NINGUNA historia
// anterior los tiene. Y en Firestore un `where("hiddenFromReel", "==", false)` NO
// devuelve los documentos donde el campo falta: sin esta pasada, el feed nacería
// vacío pese a haber elegido "todo el histórico".
//
// De paso recalcula `searchable` contra la visibilidad REAL de cada comunidad.
// Hasta ahora nadie lo resincronizaba, así que una comunidad que pasó de pública
// a privada dejó historias con `searchable: true`. Eso hoy solo estropea la
// búsqueda, pero en cuanto la regla de lectura se apoye en ese campo pasaría a
// ser una fuga. Por eso esta pasada va ANTES de desplegar las reglas.

const BACKFILL_PAGE = 300;

export const backfillStoriesReelFields = onCall(
  { region: REGION, timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    requirePlatformOwner(request);

    // Por defecto NO escribe: la primera pasada solo cuenta.
    const dryRun = request.data?.dryRun !== false;

    const groupVisibility = new Map<string, string | null>();
    async function visibilityOf(groupId: string): Promise<string | null> {
      const cached = groupVisibility.get(groupId);
      if (cached !== undefined) return cached;
      let value: string | null = null;
      try {
        const snap = await db.collection("groups").doc(groupId).get();
        const raw = snap.get("visibility");
        value = typeof raw === "string" ? raw : null;
      } catch {
        value = null;
      }
      groupVisibility.set(groupId, value);
      return value;
    }

    let scanned = 0;
    let updated = 0;
    let searchableFixed = 0;
    let playbackFixed = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    for (;;) {
      let q = db.collection("stories").orderBy("__name__").limit(BACKFILL_PAGE);
      if (cursor) q = q.startAfter(cursor);

      const snap = await q.get();
      if (snap.empty) break;

      const batch = db.batch();
      let writes = 0;

      for (const storyDoc of snap.docs) {
        scanned += 1;
        const data = storyDoc.data() as Record<string, unknown>;
        const patch: Record<string, unknown> = {};

        const creatorId = typeof data.creatorId === "string" ? data.creatorId : null;
        const greetingCreatorId =
          typeof data.greetingCreatorId === "string" ? data.greetingCreatorId : null;
        const nextByCreator = greetingCreatorId === null || greetingCreatorId === creatorId;
        if (data.byCreator !== nextByCreator) patch.byCreator = nextByCreator;

        if (typeof data.hiddenFromReel !== "boolean") patch.hiddenFromReel = false;

        const groupId = typeof data.groupId === "string" && data.groupId ? data.groupId : null;
        const nextSearchable = groupId === null
          ? true
          : (await visibilityOf(groupId)) === "public";
        if (data.searchable !== nextSearchable) {
          patch.searchable = nextSearchable;
          searchableFixed += 1;
        }

        // Historias que quedaron sin video por la carrera de arriba.
        if (!data.muxPlaybackId && typeof data.greetingRequestId === "string") {
          try {
            const greeting = await db
              .collection("greetingRequests")
              .doc(data.greetingRequestId)
              .get();
            const playbackId = greeting.get("muxPlaybackId");
            if (typeof playbackId === "string" && playbackId) {
              patch.muxPlaybackId = playbackId;
              patch.thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`;
              playbackFixed += 1;
            }
          } catch {
            // La solicitud pudo borrarse; la historia se queda sin video.
          }
        }

        if (Object.keys(patch).length === 0) continue;
        updated += 1;
        if (!dryRun) {
          batch.set(storyDoc.ref, patch, { merge: true });
          writes += 1;
        }
      }

      if (writes > 0) await batch.commit();

      cursor = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.size < BACKFILL_PAGE) break;
    }

    const result = { dryRun, scanned, updated, searchableFixed, playbackFixed };
    logger.info("backfillStoriesReelFields", result);
    return result;
  }
);
