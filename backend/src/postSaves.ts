import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const db = getFirestore();

type TogglePostSavePayload = {
  postId?: unknown;
};

function normalizePostId(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "postId inválido.");
  }

  const postId = value.trim();

  if (!postId) {
    throw new HttpsError("invalid-argument", "postId requerido.");
  }

  return postId;
}

export const togglePostSave = onCall<TogglePostSavePayload>(async (request) => {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión para guardar publicaciones.");
  }

  const postId = normalizePostId(request.data?.postId);

  const postRef = db.collection("posts").doc(postId);
  const saveRef = postRef.collection("saves").doc(uid);
  const userSavedPostRef = db.collection("users").doc(uid).collection("savedPosts").doc(postId);

  return db.runTransaction(async (tx) => {
    const postSnap = await tx.get(postRef);

    if (!postSnap.exists) {
      throw new HttpsError("not-found", "La publicación no existe.");
    }

    const postData = postSnap.data() ?? {};

    if (postData.isDeleted === true || postData.deletedAt) {
      throw new HttpsError("failed-precondition", "No puedes guardar una publicación eliminada.");
    }

    const saveSnap = await tx.get(saveRef);
    const now = FieldValue.serverTimestamp();

    if (saveSnap.exists) {
      tx.delete(saveRef);
      tx.delete(userSavedPostRef);
      tx.update(postRef, {
        "counts.saves": FieldValue.increment(-1),
        updatedAt: now,
      });

      return {
        postId,
        saved: false,
        delta: -1,
      };
    }

    tx.set(saveRef, {
      postId,
      userId: uid,
      createdAt: now,
    });

    tx.set(userSavedPostRef, {
      postId,
      groupId: typeof postData.groupId === "string" ? postData.groupId : null,
      authorId: typeof postData.authorId === "string" ? postData.authorId : null,
      createdAt: now,
      savedAt: now,
    });

    tx.set(
      postRef,
      {
        counts: {
          saves: FieldValue.increment(1),
        },
        updatedAt: now,
      },
      { merge: true }
    );

    return {
      postId,
      saved: true,
      delta: 1,
    };
  });
});