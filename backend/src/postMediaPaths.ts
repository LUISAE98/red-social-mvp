/**
 * Qué rutas de Storage puede reclamar una publicación como suyas.
 *
 * B8-C01. Editar una publicación deja reescribir su campo `media` desde el
 * cliente, y ese campo NO se validaba: solo se comprobaba que cada elemento
 * fuera un objeto. Las Firestore Rules no saben recorrer una lista, así que no
 * hay forma de cerrarlo allí. El resultado es que el autor podía escribir en
 * `media` cualquier ruta del bucket, y dos funciones con privilegios de
 * administrador la obedecían:
 *
 *  - `getRestrictedMediaUrls` FIRMA todas las rutas que estén en `post.media`.
 *    Endureció bien lo suyo en un bloque anterior —antes aceptaba cualquier ruta
 *    bajo `posts/{groupId}/`— pero al atarlas a `post.media` se apoyó en un
 *    campo que escribe la misma persona a la que hay que frenar.
 *  - `postMediaCleanup` BORRA esas rutas al borrar la publicación.
 *
 * Juntas dan lectura y borrado de archivos arbitrarios: pones en tu post la ruta
 * de la foto de otra comunidad, pides el enlace firmado, te la descargas y luego
 * borras tu post para borrarle el archivo.
 *
 * La invariante es la que ya construye el cliente en `lib/posts/image-upload.ts`
 * y la que fija `storage.rules`:
 *
 *     posts/{contexto}/{uid}/{images|thumbnails}/{archivo}
 *
 * donde `contexto` es el id de la comunidad, o `profile-{uid}` si la publicación
 * es de perfil, y `uid` es quien subió el archivo. Comprobar el prefijo completo
 * ata cada ruta a la publicación Y a su autor: no basta con acertar el contexto.
 *
 * ⚠️ Esto es la red de seguridad del CONSUMIDOR, a propósito. Vale aunque el
 * documento ya tenga rutas envenenadas escritas antes de este cambio, y aunque
 * mañana se abra otro camino de escritura. La otra mitad —que no se puedan
 * escribir— vive en el callable `updatePost`.
 */

/** El contexto de una publicación tal y como aparece en sus rutas de Storage. */
export function contextoDeStorage(post: Record<string, unknown> | undefined): string | null {
  if (!post) return null;

  const autorId = typeof post.authorId === "string" ? post.authorId.trim() : "";
  if (!autorId) return null;

  const groupId = typeof post.groupId === "string" ? post.groupId.trim() : "";

  return groupId ? groupId : `profile-${autorId}`;
}

/**
 * El prefijo que TODA ruta de esta publicación tiene que llevar.
 *
 * Devuelve null cuando la publicación no tiene autor: sin autor no hay prefijo
 * que comprobar y lo correcto es no dejar pasar nada.
 */
export function prefijoDeMedios(post: Record<string, unknown> | undefined): string | null {
  const contexto = contextoDeStorage(post);
  if (!contexto) return null;

  const autorId = (post?.authorId as string).trim();

  return `posts/${contexto}/${autorId}/`;
}

/**
 * ¿Esta ruta pertenece de verdad a esta publicación?
 *
 * `..` se rechaza aparte del prefijo: `posts/g1/u1/../../otro` empieza por el
 * prefijo bueno y aun así sale de él.
 */
export function rutaPerteneceAlPost(
  ruta: unknown,
  post: Record<string, unknown> | undefined
): boolean {
  if (typeof ruta !== "string" || ruta.length === 0) return false;
  if (ruta.includes("..")) return false;

  const prefijo = prefijoDeMedios(post);
  if (!prefijo) return false;

  return ruta.startsWith(prefijo);
}

/**
 * Separa las rutas de una publicación en las suyas y las ajenas.
 *
 * Se devuelven las ajenas en vez de tirarlas en silencio para poder registrarlas:
 * una ruta ajena en un `media` no es un error del sistema, es alguien probando.
 */
export function separarRutas(
  rutas: string[],
  post: Record<string, unknown> | undefined
): { propias: string[]; ajenas: string[] } {
  const propias: string[] = [];
  const ajenas: string[] = [];

  for (const ruta of rutas) {
    if (rutaPerteneceAlPost(ruta, post)) propias.push(ruta);
    else ajenas.push(ruta);
  }

  return { propias, ajenas };
}
