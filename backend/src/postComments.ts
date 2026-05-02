import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const db = getFirestore();

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError("invalid-argument", `Falta ${label}.`);
  }

  return value.trim();
}

export const toggleCommentFlame = onCall(async (request) => {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const postId = assertString(request.data?.postId, "postId");
  const commentId = assertString(request.data?.commentId, "commentId");

  const postRef = db.collection("posts").doc(postId);
  const commentRef = postRef.collection("comments").doc(commentId);
  const reactionRef = commentRef.collection("reactions").doc(uid);
  const userFlameRef = db
    .collection("users")
    .doc(uid)
    .collection("commentFlames")
    .doc(`${postId}_${commentId}`);

  return await db.runTransaction(async (tx) => {
    const [postSnap, commentSnap, reactionSnap] = await Promise.all([
      tx.get(postRef),
      tx.get(commentRef),
      tx.get(reactionRef),
    ]);

    if (!postSnap.exists) {
      throw new HttpsError("not-found", "La publicación no existe.");
    }

    if (!commentSnap.exists) {
      throw new HttpsError("not-found", "El comentario no existe.");
    }

    const postData = postSnap.data() || {};
    const commentData = commentSnap.data() || {};

    if (postData.isDeleted === true) {
      throw new HttpsError("failed-precondition", "La publicación fue eliminada.");
    }

    const currentLikes =
      typeof commentData.counts?.likes === "number"
        ? commentData.counts.likes
        : 0;

    if (reactionSnap.exists) {
      const nextLikes = Math.max(0, currentLikes - 1);

      tx.delete(reactionRef);
      tx.delete(userFlameRef);

      tx.update(commentRef, {
        "counts.likes": nextLikes,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        liked: false,
        likes: nextLikes,
      };
    }

    const nextLikes = currentLikes + 1;

    tx.set(reactionRef, {
      postId,
      commentId,
      userId: uid,
      type: "flame",
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(userFlameRef, {
      postId,
      commentId,
      userId: uid,
      type: "flame",
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.update(commentRef, {
      "counts.likes": nextLikes,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      liked: true,
      likes: nextLikes,
    };
  });
});