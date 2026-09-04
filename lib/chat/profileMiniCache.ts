"use client";

/**
 * Nombre, avatar y handle de los interlocutores del chat, cacheados una vez para
 * los dos hooks que los piden.
 *
 * Antes cada hook tenía su propia caché DENTRO del componente (`useState` más un
 * `useRef`), así que moría al desmontar: abrir la bandeja, entrar a un hilo y
 * volver leía otra vez el perfil de cada conversación. Con veinte conversaciones
 * son veinte `getDoc` cada vez, y `getDoc` va al servidor —la caché persistente
 * de Firestore solo lo resuelve en local si no hay red—, así que la lista salía
 * sin nombres ni fotos hasta que volvían todos.
 *
 * Dos pisos, como en el resto de la app: un `Map` de módulo que aguanta la
 * navegación, y disco por debajo para aguantar la recarga.
 *
 * Se cachea con `CATALOGO` porque es lo que es: si alguien se cambia el avatar,
 * verlo unos minutos después no rompe nada. Un mensaje nuevo NO pasa por aquí —
 * eso va por `onSnapshot` y llega al instante.
 */

import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { CACHE_TTL } from "@/lib/cache/ttl";
import { guardarEnCache, leerDeCache } from "@/lib/cache/persistentCache";
import type { ProfileMini } from "@/components/chat/ConversationList";

type Entrada = { mini: ProfileMini; guardadoEn: number };

const memoria = new Map<string, Entrada>();

function claveDisco(uid: string): string {
  return `chat:perfil:${uid}`;
}

function estaFresca(entrada: Entrada | undefined): entrada is Entrada {
  return !!entrada && Date.now() - entrada.guardadoEn <= CACHE_TTL.CATALOGO;
}

function desdeDocumento(uid: string, data: Record<string, unknown>): ProfileMini {
  return {
    uid,
    displayName:
      (typeof data.displayName === "string" && data.displayName) ||
      (typeof data.handle === "string" && data.handle) ||
      "",
    handle: typeof data.handle === "string" ? data.handle : null,
    photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
  };
}

/** Lo que ya está en memoria y sigue fresco. Sin red y sin esperar a nada. */
export function leerMinisDeMemoria(uids: string[]): Record<string, ProfileMini> {
  const salida: Record<string, ProfileMini> = {};

  for (const uid of uids) {
    const entrada = memoria.get(uid);
    if (estaFresca(entrada)) salida[uid] = entrada.mini;
  }

  return salida;
}

/**
 * Rescata del disco los que no estaban en memoria y los sube al primer piso.
 * Devuelve solo lo que consiguió, para pintarlo antes de ir a la red.
 */
export async function rescatarMinisDeDisco(
  uids: string[]
): Promise<Record<string, ProfileMini>> {
  const salida: Record<string, ProfileMini> = {};

  await Promise.all(
    uids.map(async (uid) => {
      if (estaFresca(memoria.get(uid))) return;

      const mini = await leerDeCache<ProfileMini>(
        claveDisco(uid),
        CACHE_TTL.CATALOGO
      );
      if (!mini) return;

      memoria.set(uid, { mini, guardadoEn: Date.now() });
      salida[uid] = mini;
    })
  );

  return salida;
}

/** Pide a Firestore los que falten y los guarda en los dos pisos. */
export async function traerMinis(
  uids: string[]
): Promise<Record<string, ProfileMini>> {
  const salida: Record<string, ProfileMini> = {};

  await Promise.all(
    uids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        const mini = desdeDocumento(uid, (snap.data() ?? {}) as Record<string, unknown>);

        memoria.set(uid, { mini, guardadoEn: Date.now() });
        void guardarEnCache(claveDisco(uid), mini);

        salida[uid] = mini;
      } catch {
        // Un perfil que no se pudo leer no se cachea: así el siguiente montaje
        // lo vuelve a intentar en vez de recordar el hueco.
        salida[uid] = { uid, displayName: "", handle: null, photoURL: null };
      }
    })
  );

  return salida;
}
