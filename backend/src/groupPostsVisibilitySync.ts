// Resincroniza los POSTS cuando la comunidad cambia de visibilidad.
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

export const onGroupVisibilityPostsSync = onDocumentUpdated(
  { document: "groups/{groupId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    if (before.visibility === after.visibility) return;

    const groupId = event.params.groupId;
    const groupVisibility =
      typeof after.visibility === "string" ? after.visibility : null;

    try {
      const result = await syncPostsVisibility(groupId, groupVisibility);
      logger.info("groupPostsVisibilitySync: posts resincronizados", {
        groupId,
        from: before.visibility,
        to: groupVisibility,
        ...result,
      });
    } catch (error) {
      logger.error("groupPostsVisibilitySync: fallo al resincronizar", {
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
