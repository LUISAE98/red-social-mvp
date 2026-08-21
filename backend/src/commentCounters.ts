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
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

/**
 * Una respuesta cuenta en DOS sitios: en su comentario y en el total del post.
 * Lo hacia asi el cliente y se conserva, porque el numero del post es visible y
 * cambiarle el significado no es una decision de contadores.
 */
async function bumpReply(postId: string, commentId: string, delta: number): Promise<void> {
  await bumpCount(
    db.collection("posts").doc(postId).collection("comments").doc(commentId),
    "counts.replies",
    delta
  );
  await bumpCount(db.collection("posts").doc(postId), "counts.comments", delta);
}

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
    // Si ya estaba marcado, el borrado SUAVE ya resto. Restar otra vez al
    // destruir el documento dejaria el contador por debajo de la realidad.
    if (event.data?.data()?.isDeleted === true) return;
    await bumpCount(db.collection("posts").doc(event.params.postId), "counts.comments", -1);
  }
);

/** El paso de vivo a borrado, que es como borra el producto. */
function pasoABorrado(
  antes: FirebaseFirestore.DocumentData | undefined,
  despues: FirebaseFirestore.DocumentData | undefined
): boolean {
  return antes?.isDeleted !== true && despues?.isDeleted === true;
}

/**
 * ⚠️ El borrado del producto es SUAVE: marca `isDeleted` y el documento sigue
 * ahi. `onDocumentDeleted` NO se dispara con eso, asi que el contador se
 * quedaba arriba para siempre — lo bajaba el cliente por su cuenta, y esa
 * escritura dejo de estar permitida cuando el contador paso a ser del servidor.
 *
 * Sin este disparador, borrar un comentario no descuenta nada.
 */
export const onCommentSoftDeleted = onDocumentUpdated(
  { document: "posts/{postId}/comments/{commentId}", region: REGION },
  async (event) => {
    if (!pasoABorrado(event.data?.before.data(), event.data?.after.data())) return;
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
    await bumpReply(postId, commentId, 1);
  }
);

export const onReplyCountDeleted = onDocumentDeleted(
  {
    document: "posts/{postId}/comments/{commentId}/replies/{replyId}",
    region: REGION,
  },
  async (event) => {
    if (event.data?.data()?.isDeleted === true) return;
    const { postId, commentId } = event.params;
    await bumpReply(postId, commentId, -1);
  }
);

/** El gemelo de `onCommentSoftDeleted` para las respuestas. */
export const onReplySoftDeleted = onDocumentUpdated(
  {
    document: "posts/{postId}/comments/{commentId}/replies/{replyId}",
    region: REGION,
  },
  async (event) => {
    if (!pasoABorrado(event.data?.before.data(), event.data?.after.data())) return;
    const { postId, commentId } = event.params;
    await bumpReply(postId, commentId, -1);
  }
);
