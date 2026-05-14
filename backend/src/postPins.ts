import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

type TogglePostPinInput = {
  postId?: unknown;
};

function getPostId(data: TogglePostPinInput): string {
  if (typeof data?.postId !== "string" || data.postId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "postId es obligatorio.");
  }

  return data.postId.trim();
}

export const toggleGroupPostPin = onCall<TogglePostPinInput>(async (request) => {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const postId = getPostId(request.data);
  const postRef = db.collection("posts").doc(postId);

  return db.runTransaction(async (tx) => {
    const postSnap = await tx.get(postRef);

    if (!postSnap.exists) {
      throw new HttpsError("not-found", "La publicación no existe.");
    }

    const post = postSnap.data();

    if (!post || post.isDeleted === true || post.deletedAt) {
      throw new HttpsError("failed-precondition", "La publicación fue eliminada.");
    }

    const groupId = post.groupId;

    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      throw new HttpsError("failed-precondition", "La publicación no pertenece a un grupo válido.");
    }

    const groupRef = db.collection("groups").doc(groupId);
    const groupSnap = await tx.get(groupRef);

    if (!groupSnap.exists) {
      throw new HttpsError("not-found", "El grupo no existe.");
    }

    const group = groupSnap.data();

    if (!group || group.ownerId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Solo el dueño del grupo puede fijar o desfijar publicaciones."
      );
    }

    const nextPinnedState = post.isPinnedInGroup !== true;

    if (nextPinnedState) {
      const existingPinnedSnap = await tx.get(
        db
          .collection("posts")
          .where("groupId", "==", groupId)
          .where("isDeleted", "==", false)
          .where("isPinnedInGroup", "==", true)
      );

      existingPinnedSnap.docs.forEach((docSnap) => {
        if (docSnap.id !== postId) {
          tx.update(docSnap.ref, {
            isPinnedInGroup: false,
            groupPinnedAt: null,
            groupPinnedBy: null,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
    }

    tx.update(postRef, {
      isPinnedInGroup: nextPinnedState,
      groupPinnedAt: nextPinnedState ? FieldValue.serverTimestamp() : null,
      groupPinnedBy: nextPinnedState ? uid : null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      postId,
      isPinnedInGroup: nextPinnedState,
    };
  });
});

export const toggleProfilePostPin = onCall<TogglePostPinInput>(async (request) => {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const postId = getPostId(request.data);
  const postRef = db.collection("posts").doc(postId);
  const postSnap = await postRef.get();

  if (!postSnap.exists) {
    throw new HttpsError("not-found", "La publicación no existe.");
  }

  const post = postSnap.data();

  if (!post || post.isDeleted === true || post.deletedAt) {
    throw new HttpsError("failed-precondition", "La publicación fue eliminada.");
  }

  if (post.authorId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Solo puedes fijar o desfijar publicaciones en tu propio perfil."
    );
  }

  const nextPinnedState = post.isPinnedOnProfile !== true;

  await postRef.update({
    isPinnedOnProfile: nextPinnedState,
    profilePinnedAt: nextPinnedState ? FieldValue.serverTimestamp() : null,
    profilePinnedBy: nextPinnedState ? uid : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    postId,
    isPinnedOnProfile: nextPinnedState,
  };
});