/**
 * Borra de Storage los medios de una publicación cuando la publicación se borra.
 *
 * M06 del Bloque 4. Hasta ahora borrar un post dejaba sus imágenes, miniaturas y
 * portadas de video vivas en Storage para siempre: ocupando, facturando y —lo
 * que importa— accesibles por su URL de token para quien la tuviera guardada. El
 * usuario cree que borró y no borró.
 *
 * ⚠️ El borrado de un post es LÓGICO (`isDeleted: true`), no una eliminación del
 * documento: se conserva para no romper contadores, hilos de comentarios ni el
 * historial de moderación. Por eso el disparador principal es la ACTUALIZACIÓN
 * que marca el post, no `onDocumentDeleted`. Engancharse solo al borrado del
 * documento no habría limpiado nunca nada.
 *
 * Se cubren las dos vías igualmente, porque el Admin SDK sí puede eliminar el
 * documento de verdad (limpiezas administrativas) y ahí también hay que barrer.
 *
 * Lo que NO se toca:
 *  - Los videos de Mux. Viven en Mux, no en Storage, y tienen su propio ciclo de
 *    vida y su propia facturación. Retirarlos es otro trabajo.
 *  - El campo `media` del documento. Se conserva a propósito: es el registro de
 *    qué tenía el post, que la moderación puede necesitar. `getRestrictedMediaUrls`
 *    ya tolera que una ruta no exista sin tumbar el resto del feed.
 */

import { getStorage } from "firebase-admin/storage";
import { onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { separarRutas } from "./postMediaPaths";

const REGION = "us-central1";

type StoredMedia = {
  path?: unknown;
  thumbnailPath?: unknown;
};

function texto(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Todas las rutas de Storage que cuelgan de un post.
 *
 * Exportada para poder probarla sin emulador: es la única parte con decisiones
 * (qué se recoge y qué se ignora), el resto es borrar.
 */
export function rutasDelPost(post: Record<string, unknown> | undefined): string[] {
  return separarRutasDelPost(post).propias;
}

/**
 * Las rutas declaradas, separadas en las que de verdad son de este post y las
 * que no.
 *
 * ⚠️ B8-C01. Antes esto devolvía TODO lo que hubiera en `media`, y `media` lo
 * reescribe el autor al editar. O sea: escribías en tu post la ruta de un
 * archivo de otra comunidad, borrabas tu post, y esta función se lo borraba a su
 * dueño con privilegios de administrador. Borrado arbitrario de cualquier
 * archivo del bucket, disparado por el borrado más normal del mundo.
 *
 * Ahora solo se borra lo que cae bajo el prefijo de este post y de su autor. Las
 * ajenas se devuelven aparte para dejarlas registradas.
 */
export function separarRutasDelPost(post: Record<string, unknown> | undefined): {
  propias: string[];
  ajenas: string[];
} {
  if (!post) return { propias: [], ajenas: [] };

  const rutas = new Set<string>();

  const media = Array.isArray(post.media) ? post.media : [];
  for (const item of media) {
    if (!item || typeof item !== "object") continue;
    const { path, thumbnailPath } = item as StoredMedia;
    for (const p of [texto(path), texto(thumbnailPath)]) {
      if (p) rutas.add(p);
    }
  }

  // La portada de un video vive fuera de `media` cuando el post es de video.
  const videoData = post.videoData;
  if (videoData && typeof videoData === "object") {
    const sourcePath = texto((videoData as Record<string, unknown>).sourcePath);
    if (sourcePath) rutas.add(sourcePath);
  }

  return separarRutas([...rutas], post);
}

/**
 * Borra los archivos, uno a uno y sin rendirse al primer fallo.
 *
 * `ignoreNotFound` porque reintentar el trigger es normal: la segunda vuelta se
 * encuentra los archivos ya borrados y eso NO es un error.
 */
async function borrarArchivos(rutas: string[], postId: string): Promise<number> {
  if (rutas.length === 0) return 0;

  const bucket = getStorage().bucket();
  let borrados = 0;

  await Promise.all(
    rutas.map(async (ruta) => {
      try {
        await bucket.file(ruta).delete({ ignoreNotFound: true });
        borrados++;
      } catch (error) {
        // Un archivo que no se deja borrar no debe tumbar el resto ni dejar el
        // trigger reintentando en bucle: se registra y se sigue.
        logger.error("postMediaCleanup: no se pudo borrar", { postId, ruta, error });
      }
    })
  );

  return borrados;
}

/** Las imágenes de los comentarios del post cuelgan todas del mismo prefijo. */
async function borrarImagenesDeComentarios(postId: string): Promise<void> {
  try {
    await getStorage().bucket().deleteFiles({ prefix: `commentImages/${postId}/` });
  } catch (error) {
    logger.error("postMediaCleanup: no se pudieron borrar las imágenes de comentarios", {
      postId,
      error,
    });
  }
}

async function limpiar(postId: string, post: Record<string, unknown> | undefined) {
  const { propias, ajenas } = separarRutasDelPost(post);

  if (ajenas.length > 0) {
    // Nunca debería pasar por la vía normal: el callable `updatePost` no deja
    // escribirlas. Si aparece aquí es un documento envenenado antes de este
    // cambio, o un camino de escritura nuevo que se dejó abierto.
    logger.error("postMediaCleanup: rutas AJENAS declaradas, no se borran", {
      postId,
      autorId: post?.authorId,
      ajenas,
    });
  }

  const borrados = await borrarArchivos(propias, postId);
  await borrarImagenesDeComentarios(postId);

  logger.info("postMediaCleanup", {
    postId,
    encontrados: propias.length,
    ignoradas: ajenas.length,
    borrados,
  });
}

/**
 * Camino normal: el post se marca como borrado.
 *
 * Solo en la transición false → true. Sin esa comprobación, cualquier
 * actualización de un post ya borrado volvería a lanzar el barrido.
 */
export const onPostSoftDeletedCleanupMedia = onDocumentUpdated(
  { document: "posts/{postId}", region: REGION },
  async (event) => {
    const antes = event.data?.before.data();
    const despues = event.data?.after.data();

    if (antes?.isDeleted === true || despues?.isDeleted !== true) return;

    await limpiar(event.params.postId, despues);
  }
);

/** Camino administrativo: el documento se elimina de verdad con el Admin SDK. */
export const onPostDeletedCleanupMedia = onDocumentDeleted(
  { document: "posts/{postId}", region: REGION },
  async (event) => {
    await limpiar(event.params.postId, event.data?.data());
  }
);
