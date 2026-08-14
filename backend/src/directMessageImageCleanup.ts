/**
 * Borra de Storage la imagen de un mensaje directo cuando se retira.
 *
 * Retirar un mensaje es un borrado LÓGICO (`isDeleted: true`): el documento se
 * queda para no dejar huecos en el hilo. Pero el archivo seguía en Storage
 * ocupando y costando, aunque ya nadie pudiera verlo.
 *
 * OJO con la diferencia entre las dos formas de borrar del DM:
 *  - `isDeleted`   → retirado para los DOS. El archivo ya no le sirve a nadie.
 *  - `deletedFor`  → ocultado solo para quien lo pidió; el otro lo sigue viendo.
 *    Ese NO debe borrar nada, o le quitaríamos la foto a alguien que no la ha
 *    borrado.
 *
 * Va en el backend porque las Storage Rules de `dmImages` tienen la lectura
 * cerrada y la escritura limitada al autor: desde el cliente esto no se puede
 * garantizar de forma fiable.
 */

import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();
const REGION = "us-central1";

type StoredImage = {
  path?: unknown;
  thumbnailPath?: unknown;
};

function storagePathsOf(image: unknown): string[] {
  if (!image || typeof image !== "object") return [];

  const { path, thumbnailPath } = image as StoredImage;
  return [path, thumbnailPath].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

export const onDirectMessageDeletedCleanupImage = onDocumentUpdated(
  { document: "conversations/{convId}/messages/{messageId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    // Solo la transición a retirado-para-los-dos. Comprobar el CAMBIO y no el
    // estado es lo que evita que la segunda escritura (la que limpia `image`)
    // vuelva a disparar esto.
    if (before?.isDeleted === true || after?.isDeleted !== true) return;

    const paths = storagePathsOf(after?.image);
    if (paths.length === 0) return;

    const bucket = getStorage().bucket();

    await Promise.all(
      paths.map(async (path) => {
        try {
          // `ignoreNotFound` porque reintentar un trigger es normal: la segunda
          // vuelta encuentra el archivo ya borrado y eso no es un error.
          await bucket.file(path).delete({ ignoreNotFound: true });
        } catch (error) {
          logger.error("directMessageImageCleanup: no se pudo borrar", {
            path,
            error,
          });
        }
      })
    );

    // Se rearma la referencia desde los parámetros en vez de usar la del
    // snapshot: aquella la construye el entorno que dispara el evento, y basta
    // con que apunte a otro proyecto para que la escritura falle sin motivo
    // aparente. Con la ruta explícita, esto escribe siempre donde debe.
    await db
      .doc(
        `conversations/${event.params.convId}/messages/${event.params.messageId}`
      )
      .update({ image: null });
  }
);
