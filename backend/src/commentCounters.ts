// Contadores de comentarios y respuestas, mantenidos por el SERVIDOR.
//
// ⚠️ Antes los subía el cliente: creaba el comentario y, en una escritura
// APARTE, hacía `increment(1)` sobre `counts.comments` del post. Como no iban en
// el mismo lote, las reglas no podían atar una cosa a la otra, y el resultado
// era que cualquiera con sesión —incluida una anónima— podía sumar o restar el
// contador de cualquier post conocido sin escribir un solo comentario.
//
// Un contador solo puede derivarse de un hecho comprobable. Aquí el hecho es la
// existencia del documento, y quien cuenta es quien lo ve nacer y morir.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

async function bumpCount(
  ref: admin.firestore.DocumentReference,
  field: string,
  delta: number
): Promise<void> {
  try {
    await ref.update({
      [field]: admin.firestore.FieldValue.increment(delta),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // El padre pudo borrarse antes que su hijo; no es un error que deba reintentarse.
    logger.warn("bumpCount: no se pudo actualizar", {
      path: ref.path,
      field,
      delta,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export const onCommentCountCreated = onDocumentCreated(
  { document: "posts/{postId}/comments/{commentId}", region: REGION },
  async (event) => {
    await bumpCount(db.collection("posts").doc(event.params.postId), "counts.comments", 1);
  }
);

export const onCommentCountDeleted = onDocumentDeleted(
  { document: "posts/{postId}/comments/{commentId}", region: REGION },
  async (event) => {
    await bumpCount(db.collection("posts").doc(event.params.postId), "counts.comments", -1);
  }
);

export const onReplyCountCreated = onDocumentCreated(
  {
    document: "posts/{postId}/comments/{commentId}/replies/{replyId}",
    region: REGION,
  },
  async (event) => {
    const { postId, commentId } = event.params;
    await bumpCount(
      db.collection("posts").doc(postId).collection("comments").doc(commentId),
      "counts.replies",
      1
    );
  }
);

export const onReplyCountDeleted = onDocumentDeleted(
  {
    document: "posts/{postId}/comments/{commentId}/replies/{replyId}",
    region: REGION,
  },
  async (event) => {
    const { postId, commentId } = event.params;
    await bumpCount(
      db.collection("posts").doc(postId).collection("comments").doc(commentId),
      "counts.replies",
      -1
    );
  }
);
