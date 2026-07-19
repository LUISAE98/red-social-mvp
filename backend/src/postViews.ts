// Contador de vistas únicas por usuario para videos y VODs.
// El cliente crea `posts/{postId}/views/{userId}` una sola vez por usuario;
// este trigger incrementa `viewsCount` en el post (server-side, ya que las
// reglas no permiten al cliente tocar ese campo).
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export const onPostViewed = onDocumentCreated(
  { document: "posts/{postId}/views/{userId}", region: REGION },
  async (event) => {
    const postId = event.params.postId;
    if (!postId) return;
    try {
      await db
        .collection("posts")
        .doc(postId)
        .update({ viewsCount: admin.firestore.FieldValue.increment(1) });
    } catch {
      // El post pudo haber sido borrado; ignorar.
    }
  }
);
