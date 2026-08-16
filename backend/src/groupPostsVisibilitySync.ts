// Resincroniza los POSTS y las HISTORIAS cuando la comunidad cambia de visibilidad.
//
// Cada post guarda una copia denormalizada de `groupVisibility` (y de
// `search.visibility`), y las reglas de Firestore deciden quién puede leerlo con
// ESA copia, no consultando el grupo. `setGroupVisibility` solo actualizaba el
// documento del grupo, así que la copia quedaba congelada:
//
//   comunidad PÚBLICA → PRIVADA  ⇒  sus posts viejos seguían con
//   groupVisibility: "public" + isShareable: true  ⇒  cualquiera podía leerlos
//   y aparecían en descubrimiento, aunque la comunidad ya fuera privada.
//
// Este trigger cierra esa fuga: al cambiar la visibilidad, reescribe en lote la
// copia de todos los posts de la comunidad y recalcula `isShareable` con las
// mismas reglas que se usan al publicar (ver `buildShareMetadata` en
// lib/posts/post-service.hydration.ts y `createLivePost`).

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

/** Firestore acepta 500 operaciones por lote; dejamos margen. */
const BATCH_SIZE = 400;

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

// La regla vive en un módulo puro y sin dependencias (`postShareability`) para
// que el test de paridad del frontend pueda importarla sin arrastrar el Admin
// SDK. Se re-exporta para no romper a quien la importe desde aquí.
export { resolveIsShareable } from "./postShareability";
import { resolveIsShareable } from "./postShareability";

export async function syncPostsVisibility(
  groupId: string,
  groupVisibility: string | null
): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let query = db
      .collection("posts")
      .where("groupId", "==", groupId)
      .orderBy("__name__")
      .limit(BATCH_SIZE);

    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchWrites = 0;

    for (const postDoc of snap.docs) {
      scanned += 1;
      const post = postDoc.data() as AnyRecord;

      const nextShareable = resolveIsShareable(post, groupVisibility);
      const search = asRecord(post.search);

      const visibilityStale = post.groupVisibility !== groupVisibility;
      const shareableStale = post.isShareable !== nextShareable;
      const searchStale =
        !!search &&
        (search.visibility !== groupVisibility || search.groupVisibility !== groupVisibility);

      if (!visibilityStale && !shareableStale && !searchStale) continue;

      const patch: AnyRecord = {
        groupVisibility,
        isShareable: nextShareable,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (search) {
        patch.search = {
          ...search,
          visibility: groupVisibility,
          groupVisibility,
        };
      }

      batch.set(postDoc.ref, patch, { merge: true });
      batchWrites += 1;
      updated += 1;
    }

    if (batchWrites > 0) await batch.commit();

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < BATCH_SIZE) break;
  }

  return { scanned, updated };
}

/**
 * Recalcula `searchable` en las historias de la comunidad.
 *
 * Mismo problema que arriba, pero con más filo. `searchable` significa "legible
 * por cualquiera" y las reglas de `stories` lo usan como camino rápido de lectura
 * para que el descubrimiento del reel no gaste un `get()` por documento. Si una
 * comunidad pasa de pública a privada y sus historias conservan `searchable:
 * true`, ese atajo las deja abiertas al mundo — y con ellas, quién participa en
 * una comunidad que quizá ni debería saberse que existe.
 *
 * `hiddenFromReel` no se toca: es una decisión de quien publicó, no del grupo.
 */
export async function syncStoriesSearchable(
  groupId: string,
  groupVisibility: string | null
): Promise<{ scanned: number; updated: number }> {
  const nextSearchable = groupVisibility === "public";
  let scanned = 0;
  let updated = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let query = db
      .collection("stories")
      .where("groupId", "==", groupId)
      .orderBy("__name__")
      .limit(BATCH_SIZE);

    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchWrites = 0;

    for (const storyDoc of snap.docs) {
      scanned += 1;
      if (storyDoc.get("searchable") === nextSearchable) continue;

      batch.set(storyDoc.ref, { searchable: nextSearchable }, { merge: true });
      batchWrites += 1;
      updated += 1;
    }

    if (batchWrites > 0) await batch.commit();

    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.size < BATCH_SIZE) break;
  }

  return { scanned, updated };
}

export const onGroupVisibilityPostsSync = onDocumentUpdated(
  {
    document: "groups/{groupId}",
    region: REGION,
    // ⚠️ SIN `retry: true` este trigger se ejecuta UNA vez y ya. Y como los dos
    // `catch` de abajo se tragaban el error, Firebase daba el evento por bueno:
    // un fallo pasajero de Firestore dejaba los posts con `groupVisibility:
    // "public"` PARA SIEMPRE mientras la comunidad ya era oculta. Las reglas de
    // listado deciden con esa copia —no pueden consultar el grupo documento a
    // documento sin reventar la cuota de `get()`—, así que la copia congelada ES
    // la fuga.
    //
    // Con reintentos, el evento se reintenta hasta que salga bien. La
    // resincronización es idempotente (reescribe los mismos campos), así que
    // repetirla no hace daño.
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    if (before.visibility === after.visibility) return;

    const groupId = event.params.groupId;

    // ⚠️ La visibilidad se relee del grupo AHORA, no se toma del evento.
    //
    // Un reintento puede llegar horas después. Si entretanto la comunidad cambió
    // otra vez, aplicar el valor que traía el evento la dejaría con una copia
    // vieja — y encima "correcta" a ojos del trigger, que ya no volvería a
    // dispararse. Releyendo, cada reintento converge a la verdad de hoy.
    const fresco = await db.collection("groups").doc(groupId).get();
    if (!fresco.exists) {
      logger.warn("groupPostsVisibilitySync: la comunidad ya no existe", { groupId });
      return;
    }
    const groupVisibility =
      typeof fresco.get("visibility") === "string" ? fresco.get("visibility") : null;

    // Los dos barridos se lanzan por separado y se juntan los fallos al final: si
    // el de posts falla, el de historias TIENE que correr igual —es el que sostiene
    // la lectura del reel— y luego se lanza para que el evento se reintente entero.
    const fallos: string[] = [];

    try {
      const result = await syncPostsVisibility(groupId, groupVisibility);
      logger.info("groupPostsVisibilitySync: posts resincronizados", {
        groupId,
        from: before.visibility,
        to: groupVisibility,
        ...result,
      });
    } catch (error) {
      logger.error("groupPostsVisibilitySync: fallo al resincronizar posts", {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      fallos.push(`posts: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const storiesResult = await syncStoriesSearchable(groupId, groupVisibility);
      logger.info("groupPostsVisibilitySync: historias resincronizadas", {
        groupId,
        from: before.visibility,
        to: groupVisibility,
        ...storiesResult,
      });
    } catch (error) {
      logger.error("groupPostsVisibilitySync: fallo al resincronizar historias", {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      fallos.push(`historias: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Lanzar es lo que provoca el reintento. Tragarse el error aquí era, en la
    // práctica, dejar contenido de una comunidad oculta abierto al público.
    if (fallos.length > 0) {
      throw new Error(`resincronización incompleta de ${groupId} → ${fallos.join(" | ")}`);
    }
  }
);
