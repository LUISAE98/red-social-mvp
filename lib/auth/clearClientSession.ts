"use client";

import { terminate, clearIndexedDbPersistence } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { clearStoredSessionId } from "@/lib/sessions/sessions-service";
import { vaciarCache } from "@/lib/cache/persistentCache";

// Claves de localStorage que son SOLO de la sesión y no deben sobrevivir para el
// siguiente usuario de este navegador.
const SESSION_ONLY_STORAGE_KEYS = ["vibra_search_history"];

/**
 * Borra todo el rastro local de la sesión antes de salir.
 *
 * Firestore se inicializa con caché persistente en IndexedDB (`lib/firebase.ts`),
 * así que cada documento que la persona miró —mensajes directos, notificaciones,
 * wallet— quedaba guardado en el navegador después de cerrar sesión. En un
 * equipo compartido, el siguiente usuario podía servirse de esa caché. Antes
 * solo se limpiaba el historial de búsquedas.
 *
 * IMPORTANTE: tras esto la instancia de Firestore queda inutilizable a
 * propósito, así que quien llame debe navegar con recarga dura acto seguido.
 * Es lo que ya hacen los dos botones de salida.
 */
export async function clearClientSession(): Promise<void> {
  try {
    for (const key of SESSION_ONLY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error("Error limpiando caché local de sesión:", error);
  }

  // El id de sesión local: sin esto el siguiente login en este navegador
  // reutilizaba el MISMO documento de sesión, incluido su historial.
  try {
    clearStoredSessionId();
  } catch {
    // ignorar
  }

  // Las listas que guardamos nosotros en IndexedDB (el feed, sobre todo). Van
  // ANTES de terminar Firestore: son una base distinta, no dependen de él, y si
  // el borrado de la de Firestore falla —pasa cuando hay otra pestaña abierta—
  // esto ya se hizo. En un equipo compartido, el feed de quien acaba de salir no
  // puede quedarse en disco.
  try {
    await vaciarCache();
  } catch {
    // ignorar: el borrado es best-effort y no puede bloquear la salida
  }

  // La caché de Firestore. `clearIndexedDbPersistence` exige que la instancia
  // esté terminada; si hay otra pestaña abierta con la misma caché, falla y se
  // ignora — el borrado es best-effort, no puede bloquear la salida.
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (error) {
    console.warn("No se pudo limpiar la caché de Firestore:", error);
  }
}
