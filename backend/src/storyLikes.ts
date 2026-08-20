// Me gusta de una historia.
//
// Es GLOBAL y uno por persona: dar me gusta desde el feed de reels o desde el
// perfil del creador es exactamente lo mismo, suma uno y se ve igual en los dos
// sitios. No hay un contador por superficie.
//
// Mismo esquema que las flamitas de las publicaciones (`postReactions`): la
// marca vive bajo el contenido, un espejo vive bajo el usuario y el contador se
// escribe en el propio documento. El espejo no es duplicar por duplicar: es lo
// que permite saber "¿le di me gusta?" leyendo un documento del PROPIO usuario,
// sin listar la subcoleccion del contenido ni pelearse con sus reglas.
//
// Va en el servidor porque las reglas prohiben actualizar historias desde el
// cliente, y porque un contador que el cliente puede escribir no es un contador.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

type ToggleStoryLikeRequest = { storyId?: string };

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export const toggleStoryLike = onCall<ToggleStoryLikeRequest>(
  { region: "us-central1" },
  async (request) => {
    const uid = request.auth?.uid;
    const storyId = request.data?.storyId?.trim();

    if (!uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión para dar me gusta.");
    }
    // Una cuenta anónima puede MIRAR, pero no reaccionar: darse de alta como
    // anónimo cuesta un clic, y un me gusta que se puede repetir sin límite no
    // mide nada.
    if (request.auth?.token?.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("permission-denied", "Debes iniciar sesión para dar me gusta.");
    }
    if (!storyId) {
      throw new HttpsError("invalid-argument", "Falta storyId.");
    }

    const db = getFirestore();
    const storyRef = db.collection("stories").doc(storyId);
    // El feed tambien enseña MUESTRAS del escaparate, que viven en otra
    // colección. Para quien mira son historias, así que también se pueden votar.
    const sampleRef = db.collection("greetingSamples").doc(storyId);
    const mirrorRef = db.collection("users").doc(uid).collection("storyLikes").doc(storyId);

    return await db.runTransaction(async (tx) => {
      const [storySnap, sampleSnap, mirrorSnap] = await Promise.all([
        tx.get(storyRef),
        tx.get(sampleRef),
        tx.get(mirrorRef),
      ]);

      const targetRef = storySnap.exists ? storyRef : sampleSnap.exists ? sampleRef : null;
      const targetSnap = storySnap.exists ? storySnap : sampleSnap;
      if (!targetRef || !targetSnap.exists) {
        throw new HttpsError("not-found", "La historia no existe.");
      }

      const current = safeCount(targetSnap.data()?.likesCount);
      const now = FieldValue.serverTimestamp();
      const likeRef = targetRef.collection("likes").doc(uid);

      // El espejo del usuario es la verdad sobre si ya voto: es el que se lee
      // para pintar el boton, asi que es el que manda al decidir.
      if (mirrorSnap.exists) {
        const next = Math.max(0, current - 1);
        tx.delete(likeRef);
        tx.delete(mirrorRef);
        tx.update(targetRef, { likesCount: next });
        return { liked: false, likes: next };
      }

      const next = current + 1;
      tx.set(likeRef, { userId: uid, createdAt: now });
      tx.set(mirrorRef, { storyId, createdAt: now });
      tx.update(targetRef, { likesCount: next });
      return { liked: true, likes: next };
    });
  }
);
