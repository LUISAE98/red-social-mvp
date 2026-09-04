"use client";

/**
 * Nombre, avatar y handle de los interlocutores del chat, cacheados una vez para
 * los dos hooks que los piden.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 Por qué esta caché usa localStorage y no IndexedDB como las demás
 *
 * Aquí el problema no es la lentitud, es el PARPADEO. Sin `photoURL` el avatar
 * pinta las iniciales, y al llegar el perfil las cambia por la foto: ese cambio
 * es lo que se ve como un parpadeo en cada recarga.
 *
 * Para que no ocurra, el dato tiene que estar disponible en el PRIMER render, y
 * ahí IndexedDB no sirve por definición: es asíncrono, así que el primer render
 * siempre saldría sin foto. `localStorage` es síncrono, y eso —que en general es
 * su defecto— aquí es justo lo que hace falta: se lee dentro del inicializador
 * del estado y el avatar sale ya puesto.
 *
 * La regla que separa un caso del otro es el TAMAÑO. Una página de feed son
 * cientos de KB y leerla de forma síncrona bloquearía el hilo justo mientras se
 * pinta; eso va a IndexedDB. Un perfil mini son ~150 bytes, y doscientos caben
 * en ~30 KB. Leer eso de forma síncrona no se nota, y evita el parpadeo.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Dos plazos, no uno
 *
 * `TTL_SERVIBLE` (60 días) es cuánto se puede SEGUIR ENSEÑANDO una entrada.
 * `FRESCURA_MS` (10 min) es a partir de cuándo, además de enseñarla, se vuelve a
 * pedir por detrás.
 *
 * Con un solo plazo largo habría que elegir entre parpadeo y datos viejos: a 60
 * días sin revalidar, quien se cambie el avatar seguiría saliendo con el
 * anterior durante dos meses. Separándolos no hay que elegir — se pinta siempre
 * al instante desde la caché, y lo que se enseñó se refresca en segundo plano
 * sin que la pantalla espere a nada.
 *
 * Un mensaje nuevo NO pasa por aquí: eso va por `onSnapshot` y llega al
 * instante. Esto es solo el nombre y la foto de con quién hablas, que es
 * justo lo que casi nunca cambia.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { CACHE_TTL } from "@/lib/cache/ttl";
import type { ProfileMini } from "@/components/chat/ConversationList";

type Entrada = { mini: ProfileMini; guardadoEn: number };

export const CLAVE_PERFILES_CHAT = "vibra:chat:perfiles";

/**
 * Tope de perfiles guardados. Con ~150 bytes cada uno son unos 30 KB, holgado
 * dentro de localStorage. Al pasarse se tiran los más viejos.
 */
const MAX_GUARDADOS = 200;

/** Cuánto se puede seguir ENSEÑANDO una entrada guardada. */
const TTL_SERVIBLE = 60 * 24 * 60 * 60 * 1000;

/** A partir de aquí se sigue enseñando, pero además se vuelve a pedir. */
const FRESCURA_MS = CACHE_TTL.CATALOGO;

const memoria = new Map<string, Entrada>();

let volcado = false;

/** ¿Se puede enseñar? Plazo largo: lo que manda es que exista y no sea antigua. */
function esServible(entrada: Entrada | undefined): entrada is Entrada {
  return !!entrada && Date.now() - entrada.guardadoEn <= TTL_SERVIBLE;
}

/** ¿Hace falta volver a pedirla? Plazo corto, y NO impide enseñarla mientras. */
function necesitaRefresco(entrada: Entrada | undefined): boolean {
  return !entrada || Date.now() - entrada.guardadoEn > FRESCURA_MS;
}

/**
 * Sube el disco a memoria. Síncrono y una sola vez por carga de página; lo
 * llaman todas las lecturas, así que la primera que ocurra deja lista la caché
 * para el render en curso.
 */
function volcarDeDisco(): void {
  if (volcado || typeof window === "undefined") return;
  volcado = true;

  try {
    const crudo = window.localStorage.getItem(CLAVE_PERFILES_CHAT);
    if (!crudo) return;

    const guardado = JSON.parse(crudo) as Record<string, Entrada>;

    for (const [uid, entrada] of Object.entries(guardado)) {
      if (esServible(entrada)) memoria.set(uid, entrada);
    }
  } catch {
    // JSON corrupto, modo privado o sin cuota: se sigue sin caché.
  }
}

let guardadoPendiente = 0;

/**
 * Vuelca memoria a disco. Se agrupa en un fotograma porque una bandeja carga
 * veinte perfiles casi a la vez, y serializar veinte veces seguidas el mismo
 * objeto no aporta nada.
 */
function programarGuardado(): void {
  if (typeof window === "undefined" || guardadoPendiente) return;

  guardadoPendiente = requestAnimationFrame(() => {
    guardadoPendiente = 0;

    try {
      const entradas = [...memoria.entries()]
        .filter(([, entrada]) => esServible(entrada))
        // Los más recientes primero, para que el recorte tire los viejos.
        .sort((a, b) => b[1].guardadoEn - a[1].guardadoEn)
        .slice(0, MAX_GUARDADOS);

      window.localStorage.setItem(
        CLAVE_PERFILES_CHAT,
        JSON.stringify(Object.fromEntries(entradas))
      );
    } catch {
      // Cuota llena: se abandona sin ruido. Perder la caché es aceptable.
    }
  });
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

/**
 * Lo que hay cacheado y sigue fresco. SÍNCRONO a propósito: se llama desde el
 * inicializador del estado para que el avatar salga puesto en el primer render.
 */
export function leerMinisCacheados(uids: string[]): Record<string, ProfileMini> {
  volcarDeDisco();

  const salida: Record<string, ProfileMini> = {};

  for (const uid of uids) {
    const entrada = memoria.get(uid);
    if (esServible(entrada)) salida[uid] = entrada.mini;
  }

  return salida;
}

/**
 * De los uids dados, cuáles conviene volver a pedir: los que no están y los que
 * llevan más de `FRESCURA_MS` guardados. Los segundos YA se están enseñando, así
 * que pedirlos no bloquea nada — solo mantiene la caché al día.
 */
export function uidsPorRefrescar(uids: string[]): string[] {
  volcarDeDisco();
  return uids.filter((uid) => necesitaRefresco(memoria.get(uid)));
}

/** Pide a Firestore los que falten y los guarda. */
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
        salida[uid] = mini;
      } catch {
        // Un perfil que no se pudo leer no se cachea: así el siguiente montaje
        // lo vuelve a intentar en vez de recordar el hueco.
        salida[uid] = { uid, displayName: "", handle: null, photoURL: null };
      }
    })
  );

  programarGuardado();

  return salida;
}

/** Se llama al cerrar sesión: estos perfiles son de con quién hablaba esa persona. */
export function olvidarMinis(): void {
  memoria.clear();
  volcado = false;

  try {
    window.localStorage.removeItem(CLAVE_PERFILES_CHAT);
  } catch {
    // ignorar
  }
}
