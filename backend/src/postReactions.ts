import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

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
      const postSnap = await transaction.get(postRef);

      if (!postSnap.exists) {
        throw new HttpsError("not-found", "La publicación no existe.");
      }

      const postData = postSnap.data() || {};

      if (postData.isDeleted === true) {
        throw new HttpsError(
          "failed-precondition",
          "No puedes reaccionar a una publicación eliminada."
        );
      }

      const reactionSnap = await transaction.get(reactionRef);

      const currentLikes =
        typeof postData.counts?.likes === "number"
          ? postData.counts.likes
          : 0;

      if (reactionSnap.exists) {
        const nextLikes = Math.max(0, currentLikes - 1);

        transaction.delete(reactionRef);
        transaction.delete(userPostFlameRef);
        transaction.update(postRef, {
          "counts.likes": nextLikes,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return {
          liked: false,
          likes: nextLikes,
        };
      }

      const nextLikes = currentLikes + 1;
      const now = FieldValue.serverTimestamp();

      transaction.set(reactionRef, {
        type: "flame",
        userId: uid,
        postId,
        createdAt: now,
      });

      transaction.set(userPostFlameRef, {
        type: "flame",
        userId: uid,
        postId,
        createdAt: now,
      });

      transaction.update(postRef, {
        "counts.likes": nextLikes,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        liked: true,
        likes: nextLikes,
      };
    });
  }
);