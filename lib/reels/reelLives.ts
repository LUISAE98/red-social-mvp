"use client";

// Los lives que entran al feed de reels.
//
// Va por SUSCRIPCIÓN y no por páginas, al revés que las historias. Una historia
// grabada hace tres meses sigue estando ahí mañana; un live empieza y termina
// mientras el usuario scrollea, y un feed que solo consultase al abrir enseñaría
// transmisiones muertas. Con `onSnapshot` el live entra y sale solo.
//
// ⚠️ LA FORMA DE LA CONSULTA NO ES NEGOCIABLE. Las reglas evalúan `list` documento
// a documento y deniegan la consulta ENTERA si uno solo no pasa. Fijar
// `allowLoggedOutViewers == true` mantiene fuera del resultado los lives
// restringidos, que son justo los que la tumbarían. Es el mismo par de campos que
// usa el rail de comunidades, que es la consulta ya probada en producción.
//
// Consecuencia de producto: al reel solo entran lives ABIERTOS A TODOS. Los de
// boleto o de solo-con-cuenta necesitarían otro camino.

import { collection, getDocs, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  isLiveOngoing,
  liveItem,
  liveStartedAtMs,
  type ReelItem,
  type ReelLivePost,
} from "./reelItems";

/**
 * Tope de lives que se vigilan a la vez.
 *
 * Son pocos por naturaleza —lo raro es que haya más de un puñado transmitiendo
 * al mismo tiempo— y el mezclador solo va a intercalar el 15%, así que traer más
 * sería pagar lecturas por nada.
 */
const LIVES_LIMIT = 40;

function livesQuery() {
  return query(
    collection(db, "posts"),
    where("liveData.status", "==", "live"),
    where("liveData.allowLoggedOutViewers", "==", true),
    limit(LIVES_LIMIT),
  );
}

function toItems(docs: Array<{ id: string; data: () => unknown }>, uid?: string | null): ReelItem[] {
  return docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as ReelLivePost)
    // El estado por si solo miente: se queda pegado en "live" cuando una
    // transmision se corta mal.
    .filter((post) => isLiveOngoing(post))
    .filter((post) => !uid || post.authorId !== uid)
    // El mas reciente primero. El orden definitivo lo decide la mezcla por
    // cuota; este solo hace que la lista sea estable entre avisos.
    .sort((a, b) => liveStartedAtMs(b) - liveStartedAtMs(a))
    .map(liveItem);
}

type Options = {
  /**
   * Quién mira. Su propio live no se le muestra: ya lo está transmitiendo, y
   * verse a sí mismo en el feed se lee como un error.
   */
  uid?: string | null;
};

/**
 * Los lives que hay AHORA MISMO, de una sola lectura.
 *
 * Existe porque un live solo puede colocarse en el feed cuando se arma una
 * tanda de historias, y la primera tanda se arma nada mas abrir. Dejar eso en
 * manos de la suscripcion era una carrera: si su primer aviso llegaba tarde,
 * el live no entraba hasta que el usuario scrolleaba una pagina entera. Pedirlo
 * junto al resto de la carga inicial lo vuelve determinista.
 */
export async function fetchReelLivesOnce(options: Options): Promise<ReelItem[]> {
  try {
    const snap = await getDocs(livesQuery());
    return toItems(snap.docs, options.uid);
  } catch {
    // Sin lives el feed sigue funcionando.
    return [];
  }
}

/**
 * Vigila los lives en curso y avisa cada vez que la lista cambia.
 *
 * Devuelve la función para dejar de vigilar.
 */
export function subscribeReelLives(
  options: Options,
  onChange: (items: ReelItem[]) => void,
): () => void {
  const { uid } = options;

  return onSnapshot(
    livesQuery(),
    (snap) => {
      onChange(toItems(snap.docs, uid));
    },
    () => {
      // Sin lives el feed sigue funcionando: son un complemento, no el
      // contenido. Un fallo aquí no puede dejar al usuario sin reel.
      onChange([]);
    },
  );
}
