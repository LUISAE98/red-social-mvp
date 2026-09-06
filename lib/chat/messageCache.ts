"use client";

/**
 * Los mensajes del DM, guardados en el dispositivo SIN caducidad.
 *
 * Antes no se guardaba ninguno. Cada vez que abrías un hilo se esperaba a
 * Firestore para pintar el primer mensaje, y el buscador de la bandeja solo
 * podía mirar el `lastMessage` que viene denormalizado en la conversación: si
 * lo último era una foto, el hilo entero se volvía invisible para la búsqueda
 * aunque tuviera cien mensajes de texto dentro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Por qué SIN caducidad, cuando el resto de la caché sí caduca
 *
 * `CACHE_TTL` elige la duración por QUIÉN PUEDE CAMBIAR EL DATO, y un mensaje
 * ya enviado no cambia: el texto de hace un año es el mismo hoy. Lo que sí
 * cambia —que lo borren, que lo editen dentro de sus 10 minutos— llega por la
 * suscripción en vivo y se reescribe aquí encima. Así que aquí caducar no
 * protege de nada y solo obliga a volver a bajar lo mismo.
 *
 * Se apoya en `persistentCache` (IndexedDB) y no en una base propia por una
 * razón concreta que importa: al cerrar sesión, `clearClientSession` vacía esa
 * base entera. Conversaciones privadas guardadas para siempre en un aparato
 * TIENEN que irse con la sesión, y colgarse de ahí lo garantiza sin añadir un
 * segundo sitio del que acordarse.
 *
 * ⚠️ Esto guarda lo que ESTE aparato ha llegado a ver. Abrir un hilo trae su
 * última página; lo anterior solo baja si subes por el historial. Así que la
 * búsqueda local encuentra lo leído, no el archivo completo del servidor.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { MessageWithId } from "./chatService";
import {
  borrarDeCache,
  guardarEnCache,
  leerDeCache,
} from "@/lib/cache/persistentCache";
import { comparable } from "./textoBusqueda";

/** Sin caducidad. `leerDeCache` compara contra este número y nunca lo supera. */
const SIN_CADUCIDAD = Number.MAX_SAFE_INTEGER;

const PREFIJO = "chat:msgs:";
/** Lista de hilos guardados, para poder recorrerlos al buscar. */
const CLAVE_INDICE = "chat:msgs:__indice";
/**
 * Hilos cuyo historial ENTERO ya se bajó una vez.
 *
 * Sin esta marca, cada visita a la bandeja volvería a paginar hilos que ya
 * están completos en el disco: la búsqueda histórica saldría gratis la primera
 * vez y se pagaría para siempre.
 */
const CLAVE_COMPLETOS = "chat:msgs:__completos";

/**
 * Tope por hilo. No es una caducidad: es un freno de cuota.
 *
 * Un hilo muy hablado puede tener decenas de miles de mensajes, y la cuota de
 * IndexedDB la decide el navegador —si se pasa, la escritura falla y se pierde
 * TODO lo del hilo, no solo lo que sobra—. Se quedan los más recientes, que es
 * lo que se lee y lo que se busca.
 */
const TOPE_POR_HILO = 3000;

function clave(conversationId: string): string {
  return PREFIJO + conversationId;
}

async function leerIndice(): Promise<string[]> {
  return (await leerDeCache<string[]>(CLAVE_INDICE, SIN_CADUCIDAD)) ?? [];
}

async function apuntarEnIndice(conversationId: string): Promise<void> {
  const indice = await leerIndice();
  if (indice.includes(conversationId)) return;
  await guardarEnCache(CLAVE_INDICE, [...indice, conversationId]);
}

/** Lo guardado de un hilo, en orden de lectura. Vacío si no hay nada. */
export async function leerMensajesGuardados(
  conversationId: string
): Promise<MessageWithId[]> {
  if (!conversationId) return [];
  return (
    (await leerDeCache<MessageWithId[]>(clave(conversationId), SIN_CADUCIDAD)) ?? []
  );
}

/**
 * Funde lo que llega con lo ya guardado, por id.
 *
 * Lo NUEVO pisa a lo viejo a propósito: un mensaje editado o marcado como
 * borrado llega otra vez por la suscripción, y tiene que sustituir a la copia
 * guardada en vez de dejar a la vista un texto que ya no existe.
 */
export async function guardarMensajes(
  conversationId: string,
  mensajes: MessageWithId[]
): Promise<void> {
  if (!conversationId || mensajes.length === 0) return;

  const guardados = await leerMensajesGuardados(conversationId);

  const porId = new Map<string, MessageWithId>();
  for (const m of guardados) porId.set(m.id, m);
  for (const m of mensajes) porId.set(m.id, m);

  const fundidos = [...porId.values()].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() ?? 0;
    const tb = b.createdAt?.toMillis?.() ?? 0;
    return ta - tb;
  });

  const recortados =
    fundidos.length > TOPE_POR_HILO ? fundidos.slice(-TOPE_POR_HILO) : fundidos;

  await guardarEnCache(clave(conversationId), recortados);
  await apuntarEnIndice(conversationId);
}

/** Un mensaje que casa con lo buscado, listo para pintar una fila. */
export type MensajeEncontrado = {
  conversationId: string;
  messageId: string;
  /** El texto ORIGINAL, con sus tildes y mayúsculas, para poder resaltarlo. */
  texto: string;
  /** Milisegundos, ya resueltos: ordenar por Timestamp fuera de aquí es un lío. */
  cuando: number;
  senderId: string;
};

/** Tope de resultados. Más que esto no se lee, y sí cuesta pintarlo. */
const TOPE_RESULTADOS = 150;

/**
 * Busca dentro de los mensajes guardados de TODOS los hilos y devuelve LOS
 * MENSAJES, del más reciente al más antiguo.
 *
 * Devuelve mensajes y no un resumen por conversación a propósito: la fila de
 * resultados tiene que enseñar el mensaje que encontraste, no el último del
 * hilo. Un hilo puede aparecer varias veces, una por cada coincidencia, que es
 * como se comporta cualquier buscador de mensajería.
 */
export async function buscarEnMensajes(
  aguja: string
): Promise<MensajeEncontrado[]> {
  const buscada = comparable(aguja.trim());
  if (!buscada) return [];

  const indice = await leerIndice();
  const salida: MensajeEncontrado[] = [];

  for (const conversationId of indice) {
    const mensajes = await leerMensajesGuardados(conversationId);

    for (const m of mensajes) {
      const texto = m.text ?? "";
      if (!texto || m.isDeleted) continue;
      if (!comparable(texto).includes(buscada)) continue;

      salida.push({
        conversationId,
        messageId: m.id,
        texto,
        cuando: m.createdAt?.toMillis?.() ?? 0,
        senderId: m.senderId,
      });
    }
  }

  salida.sort((a, b) => b.cuando - a.cuando);
  return salida.slice(0, TOPE_RESULTADOS);
}

/** ¿Ya está sembrado el historial completo de este hilo? */
export async function historialSembrado(conversationId: string): Promise<boolean> {
  const marcas =
    (await leerDeCache<string[]>(CLAVE_COMPLETOS, SIN_CADUCIDAD)) ?? [];
  return marcas.includes(conversationId);
}

/** Deja constancia de que ya se bajó el hilo entero, para no repetirlo. */
export async function marcarHistorialSembrado(
  conversationId: string
): Promise<void> {
  const marcas =
    (await leerDeCache<string[]>(CLAVE_COMPLETOS, SIN_CADUCIDAD)) ?? [];
  if (marcas.includes(conversationId)) return;
  await guardarEnCache(CLAVE_COMPLETOS, [...marcas, conversationId]);
}

/** Olvida un hilo. Se usa al quitar una conversación de la bandeja. */
export async function olvidarMensajes(conversationId: string): Promise<void> {
  await borrarDeCache(clave(conversationId));
  const indice = await leerIndice();
  const sinEl = indice.filter((id) => id !== conversationId);
  if (sinEl.length !== indice.length) await guardarEnCache(CLAVE_INDICE, sinEl);
}
