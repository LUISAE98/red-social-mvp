"use client";

/**
 * Baja el historial COMPLETO de un hilo al dispositivo, una sola vez.
 *
 * Es lo que hace que la búsqueda de la bandeja sea histórica de verdad. Sin
 * esto solo se guardaba lo que hubieras abierto y scrolleado a mano, así que
 * buscar una palabra de hace tres meses no encontraba nada y el buscador
 * parecía roto —que es exactamente como se veía—.
 *
 * Vive aparte de `messageCache` a propósito: aquel módulo solo sabe de
 * almacenamiento, este es el único que además habla con la red. Mezclarlos
 * obligaba a la caché a arrastrar Firestore para nada.
 *
 * El coste se paga UNA vez por hilo y por aparato, porque lo guardado no
 * caduca y queda una marca de "este ya está completo".
 */

import { CONVERSATION_PAGE_SIZE } from "./types";
import {
  fetchLatestMessages,
  fetchOlderMessages,
  type MessageWithId,
} from "./chatService";
import {
  guardarMensajes,
  historialSembrado,
  marcarHistorialSembrado,
} from "./messageCache";

/**
 * Techo de páginas por hilo.
 *
 * Coincide con el tope que guarda `messageCache` (3000 mensajes): seguir
 * paginando por debajo de eso sería pagar lecturas por mensajes que la caché va
 * a tirar igualmente al escribir.
 */
const MAX_PAGINAS = Math.ceil(3000 / CONVERSATION_PAGE_SIZE);

/**
 * Deja el hilo entero en el disco. No hace nada si ya estaba completo.
 *
 * Devuelve `true` si bajó algo, para que quien llame sepa si merece la pena
 * repetir una búsqueda que acaba de salir vacía.
 */
export async function sembrarHistorial(conversationId: string): Promise<boolean> {
  if (!conversationId) return false;
  if (await historialSembrado(conversationId)) return false;

  let pagina = await fetchLatestMessages(conversationId);
  if (pagina.length === 0) {
    // Un hilo sin mensajes también está completo: marcarlo evita volver a
    // preguntar por él en cada visita a la bandeja.
    await marcarHistorialSembrado(conversationId);
    return false;
  }

  /**
   * Se acumula y se escribe UNA vez al final.
   *
   * `guardarMensajes` lee el hilo entero, funde y lo reescribe. Llamarlo por
   * página convertía la siembra en cuadrática: la página 40 releía y reescribía
   * los 1200 mensajes anteriores.
   */
  const todos: MessageWithId[] = [...pagina];

  for (let i = 0; i < MAX_PAGINAS && pagina.length === CONVERSATION_PAGE_SIZE; i++) {
    const masViejo = pagina[0];
    if (!masViejo?.createdAt) break;

    pagina = await fetchOlderMessages(
      conversationId,
      masViejo.createdAt,
      undefined,
      masViejo.id
    );
    if (pagina.length === 0) break;
    todos.unshift(...pagina);
  }

  await guardarMensajes(conversationId, todos);
  await marcarHistorialSembrado(conversationId);
  return true;
}
