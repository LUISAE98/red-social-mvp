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