// Descubrimiento de historias: contador de vistas (E).
//
// El backfill (D) de `categories` y `viewsCount` se retiró el 2026-08-13: era un
// `onRequest` sin autenticación que recorría la colección `stories` completa con
// privilegios Admin. Ya se había ejecutado. Ver el comentario en `index.ts`.
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

// E — Incrementa `viewsCount` de la historia en la PRIMERA vista de cada usuario
// (el doc de vista se crea una sola vez por usuario). Como las reglas tienen
// `stories: allow update: if false`, el conteo se hace server-side.
export const onStoryViewed = onDocumentCreated(
  { document: "userStoryViews/{userId}/views/{storyId}", region: REGION },
  async (event) => {
    const storyId = event.params.storyId;
    if (!storyId) return;
    try {
      await db
        .collection("stories")
        .doc(storyId)
        .update({ viewsCount: admin.firestore.FieldValue.increment(1) });
    } catch {
      // La historia pudo haber sido borrada; ignorar.
    }
  }
);
