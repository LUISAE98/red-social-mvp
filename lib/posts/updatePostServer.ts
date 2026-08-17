// Puente hacia el callable `updatePost` del backend.
//
// B8-C01. Editar dejó de ser una escritura directa a Firestore. El motivo es que
// `media` lo reescribía el cliente y las Firestore Rules **no saben recorrer una
// lista**: se puede exigir que sea una lista y acotar su tamaño, pero no mirar
// dentro de cada elemento. Y cada elemento lleva rutas de Storage.
//
// Con una ruta ajena metida ahí, `getRestrictedMediaUrls` la firmaba y
// `postMediaCleanup` la borraba, las dos con privilegios de administrador: se
// podía leer y borrar cualquier archivo del bucket.
//
// El servidor comprueba que cada ruta cuelgue de esta publicación y de su autor,
// acota texto y número de archivos, ancla los hosts de las URLs y escribe el
// historial de edición en la misma transacción que el cambio.
//
// A diferencia de `createPostServer`, aquí no hace falta sanear centinelas ni
// fechas: solo viajan `postId`, `text` y `media`, que son datos planos.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { PostMedia } from "./types";

type UpdatePostRequest = {
  postId: string;
  text: string;
  media: PostMedia[];
};

export async function updatePostServer(params: UpdatePostRequest): Promise<void> {
  const llamar = httpsCallable<UpdatePostRequest, { ok: boolean }>(functions, "updatePost");

  // Se descartan los medios sin URL igual que hacía el camino viejo: un vídeo a
  // medio subir no tiene por qué llegar al documento.
  const media = Array.isArray(params.media)
    ? params.media.filter(
        (item) => typeof item.url === "string" && item.url.trim().length > 0
      )
    : [];

  await llamar({
    postId: params.postId,
    text: typeof params.text === "string" ? params.text.trim() : "",
    media,
  });
}
