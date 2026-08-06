import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { usersHaveBlockBetweenTx } from "./social/blocks";

type TogglePostFlameRequest = {
  postId?: string;
};

export const togglePostFlame = onCall<TogglePostFlameRequest>(
  {
    region: "us-central1",
  },
  async (request) => {
    const uid = request.auth?.uid;
    const postId = request.data?.postId?.trim();

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para reaccionar."
      );
    }

    if (!postId) {
      throw new HttpsError("invalid-argument", "Falta postId.");
    }

    const db = getFirestore();

    const postRef = db.collection("posts").doc(postId);
    const reactionRef = postRef.collection("reactions").doc(uid);
    const userPostFlameRef = db
      .collection("users")
      .doc(uid)
      .collection("postFlames")
      .doc(postId);

    return await db.runTransaction(async (transaction) => {
      const [postSnap, reactionSnap, userPostFlameSnap] = await Promise.all([
        transaction.get(postRef),
        transaction.get(reactionRef),
        transaction.get(userPostFlameRef),
      ]);

      if (!postSnap.exists) {
        throw new HttpsError("not-found", "La publicación no existe.");
      }

      const postData = postSnap.data() || {};
      const searchData =
        postData.search && typeof postData.search === "object"
          ? postData.search
          : {};

      if (postData.isDeleted === true || searchData.isDeleted === true) {
        throw new HttpsError(
          "failed-precondition",
          "No puedes reaccionar a una publicación eliminada."
        );
      }

      const currentLikes =
        typeof postData.counts?.likes === "number" &&
        Number.isFinite(postData.counts.likes)
          ? Math.max(0, postData.counts.likes)
          : 0;

      const now = FieldValue.serverTimestamp();
      const alreadyLiked = reactionSnap.exists || userPostFlameSnap.exists;

      if (alreadyLiked) {
        const nextLikes = Math.max(0, currentLikes - 1);

        transaction.delete(reactionRef);
        transaction.delete(userPostFlameRef);
        transaction.update(postRef, {
          "counts.likes": nextLikes,
          updatedAt: now,
        });

        return {
          liked: false,
          likes: nextLikes,
        };
      }

      const nextLikes = currentLikes + 1;

      // Denormalizamos la categoría/contexto del post en el doc del flame para
      // alimentar el feed de descubrimiento (señal "like") sin tener que leer
      // la colección posts al recomendar (evita el límite de cuota de las reglas
      // `allow list`). Guardamos la categoría cruda; el cliente la normaliza.
      const contextType =
        postData.contextType === "profile" ? "profile" : "group";
      const groupId =
        typeof postData.groupId === "string" ? postData.groupId : null;

      // Bloqueo de perfil: no se puede reaccionar a un post de un perfil con el que
      // hay bloqueo (en cualquier sentido). Lectura transaccional antes de escribir.
      if (contextType === "profile") {
        const profileId =
          typeof postData.profileId === "string" ? postData.profileId : null;
        if (
          profileId &&
          profileId !== uid &&
          (await usersHaveBlockBetweenTx(transaction, uid, profileId))
        ) {
          throw new HttpsError(
            "permission-denied",
            "No puedes reaccionar a este contenido."
          );
        }
      }

      let groupCategory: string | null = null;
      if (contextType === "group" && groupId) {
        const groupSnap = await transaction.get(
          db.collection("groups").doc(groupId)
        );
        const rawCategory = groupSnap.exists
          ? groupSnap.data()?.category
          : null;
        groupCategory =
          typeof rawCategory === "string" && rawCategory ? rawCategory : null;
      }

      transaction.set(
        reactionRef,
        {
          type: "flame",
          userId: uid,
          postId,
          createdAt: now,
        },
        { merge: true }
      );

      transaction.set(
        userPostFlameRef,
        {
          type: "flame",
          userId: uid,
          postId,
          createdAt: now,
          contextType,
          ...(groupCategory ? { groupCategory } : {}),
        },
        { merge: true }
      );

      transaction.update(postRef, {
        "counts.likes": nextLikes,
        updatedAt: now,
      });

      return {
        liked: true,
        likes: nextLikes,
      };
    });
  }
);