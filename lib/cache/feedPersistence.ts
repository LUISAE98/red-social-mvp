"use client";

/**
 * Guardar y restaurar la primera página de un feed desde disco.
 *
 * Los cinco feeds de la app —inicio, guardados, perfil, comunidad y búsqueda—
 * tienen la misma forma de caché: publicaciones, cursor, `hasMore` y una marca
 * de tiempo, en un `Map` a nivel de módulo. Ese `Map` aguanta la navegación
 * dentro de la pestaña y muere en cuanto se recarga. Esto es el piso de abajo, y
 * es UNO para todos en vez de la misma lógica copiada cinco veces.
 *
 * ⚠️ Se guardan las PUBLICACIONES, nunca el cursor. El cursor de Firestore es
 * una instantánea viva de un documento, no un dato: no se serializa ni se
 * reconstruye desde disco. Por eso el patrón de uso es siempre el mismo:
 *
 *   1. pintar al instante lo que haya guardado,
 *   2. lanzar igualmente la primera página, que es la que trae el cursor
 *      de verdad y con él devuelve el desplazamiento infinito.
 *
 * Quien mira ve su lista de inmediato en vez de una pantalla vacía; el refresco
 * llega detrás y reemplaza lo pintado.
 */

import { borrarDeCache, guardarEnCache, leerDeCache } from "./persistentCache";

/**
 * Cuántas publicaciones se guardan. Solo la primera página: conservar cien tras
 * un rato de desplazamiento encarece la escritura y ralentiza la lectura justo
 * en el momento en que se quiere pintar rápido.
 */
const MAX_GUARDADAS = 12;

export function claveDeFeed(nombre: string, id: string): string {
  return `feed:${nombre}:${id}`;
}

export function persistirFeed<T>(clave: string, posts: readonly T[]): void {
  const recorte = posts.slice(0, MAX_GUARDADAS);

  if (recorte.length === 0) {
    void borrarDeCache(clave);
    return;
  }

  void guardarEnCache(clave, recorte);
}

export async function leerFeedPersistido<T>(
  clave: string,
  maxEdadMs: number,
  opciones?: {
    /**
     * Si alguna publicación cumple esto, se descarta la caché entera. Se usa
     * para los videos a medio procesar: su estado cambia SOLO en el servidor,
     * así que restaurarlos desde disco enseñaría un "procesando" que quizá ya
     * terminó. En ese caso se prefiere esperar a la consulta.
     */
    descartarSi?: (post: T) => boolean;
  }
): Promise<T[] | null> {
  const posts = await leerDeCache<T[]>(clave, maxEdadMs);

  if (!posts || posts.length === 0) return null;

  const descartarSi = opciones?.descartarSi;
  if (descartarSi && posts.some(descartarSi)) return null;

  // Lo borrado se filtra siempre: pudo borrarse desde otra pestaña o desde otro
  // aparato mientras esta copia dormía en disco.
  return posts.filter(
    (post) => (post as { isDeleted?: boolean }).isDeleted !== true
  );
}

export function olvidarFeed(clave: string): void {
  void borrarDeCache(clave);
}
