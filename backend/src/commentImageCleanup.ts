/**
 * Borra de Storage la imagen de un comentario cuando el comentario se borra.
 *
 * El borrado de comentarios es LÓGICO (`isDeleted: true`): el documento se
 * queda para no romper contadores ni hilos de respuestas. Pero el archivo vivía
 * para siempre en Storage — y `commentImages` es de lectura pública, así que la
 * foto seguía siendo accesible por su URL para quien la tuviera. El usuario
 * cree que borró y no borró.
 *
 * Va en el backend y no en el cliente por dos razones:
 *  - Un moderador puede borrar el comentario de OTRO, y las Storage Rules solo
 *    dejan al autor tocar sus archivos. Desde el cliente ese caso no se podría.
 *  - Si el borrado se hace desde un dispositivo que se queda sin red a medias,
 *    el archivo se quedaría huérfano igualmente. Aquí lo garantiza el trigger.
 *
 * Se limpia también el campo `image` del documento, para que nada intente
 * pintar una ruta que ya no existe.
 */

import { getStorage } from "firebase-admin/storage";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

const REGION = "us-central1";

type StoredImage = {
  path?: unknown;
  thumbnailPath?: unknown;
};

/** Rutas de Storage de una imagen de comentario. Ignora lo que no sea texto. */
function storagePathsOf(image: unknown): string[] {
  if (!image || typeof image !== "object") return [];

  const { path, thumbnailPath } = image as StoredImage;
  return [path, thumbnailPath].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

/**
 * Borra los archivos y devuelve si había algo que borrar.
 *
 * `ignoreNotFound` porque reintentar el trigger es normal: la segunda vuelta se
 * encuentra los archivos ya borrados y eso NO es un error.
 */
async function deleteImageFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const bucket = getStorage().bucket();

  await Promise.all(
    paths.map(async (path) => {
      try {
        await bucket.file(path).delete({ ignoreNotFound: true });
      } catch (error) {
        // Un archivo que no se deja borrar no debe tumbar el resto ni dejar el
        // trigger reintentando en bucle: se registra y se sigue.
        logger.error("commentImageCleanup: no se pudo borrar", { path, error });
      }
    })
  );
}

/** ¿Este cambio es el paso de "vivo" a "borrado"? */
function becameDeleted(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined
): boolean {
  return before?.isDeleted !== true && after?.isDeleted === true;
}

export const onCommentDeletedCleanupImage = onDocumentUpdated(
  { document: "posts/{postId}/comments/{commentId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!becameDeleted(before, after)) return;

    const paths = storagePathsOf(after?.image);
    if (paths.length === 0) return;

    await deleteImageFiles(paths);
    await event.data?.after.ref.update({ image: null });
  }
);

export const onCommentReplyDeletedCleanupImage = onDocumentUpdated(
  {
    document: "posts/{postId}/comments/{commentId}/replies/{replyId}",
    region: REGION,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!becameDeleted(before, after)) return;

    const paths = storagePathsOf(after?.image);
    if (paths.length === 0) return;

    await deleteImageFiles(paths);
    await event.data?.after.ref.update({ image: null });
  }
);
