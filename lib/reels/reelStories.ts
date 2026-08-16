"use client";

// Consultas del feed de reels: saludos y consejos, uno detrás de otro.
//
// Aquí solo vive el ACCESO A DATOS. El orden, la mezcla por cuota y el ranking
// están en `reelRanking` (lógica pura, con tests) y se orquestan en `useReelFeed`.
// Lo importante de este archivo es la FORMA de las consultas, porque de eso
// depende que las reglas de Firestore no las tumben.
//
// ⚠️ Las dos consultas fijan campos que hacen innecesario el `get()` de la regla
// de lectura:
//   - descubrimiento fija `searchable == true`, que ya significa "legible por
//     cualquiera" (perfil siempre; comunidad solo si es pública)
//   - seguidos pide solo historias de PERFIL, que no tienen comunidad
// Sin eso, un `list` con decenas de candidatos agota el tope de 10 `get()` de la
// consulta y se cae ENTERA, no solo los documentos de comunidad. Por eso las
// historias de comunidades privadas no entran al reel aunque seas miembro: no hay
// forma barata de comprobarlo por documento.

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc } from "@/lib/stories/types";
import { getBaseAppUrl } from "@/lib/posts/share-url";

/** Cuántas historias trae cada página de descubrimiento. */
export const REEL_PAGE_SIZE = 12;

/** Firestore acepta hasta 30 valores en un `in`. */
const IN_CHUNK = 30;

export type ReelPage = {
  stories: StoryDoc[];
  cursor: QueryDocumentSnapshot | null;
  /** No hay más páginas que pedir. */
  exhausted: boolean;
};

function toStory(d: QueryDocumentSnapshot): StoryDoc {
  return { id: d.id, ...d.data() } as StoryDoc;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function byDateDesc(a: StoryDoc, b: StoryDoc): number {
  return (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
}

/** Cuántas historias como mucho se traen por cada tanda de 30 seguidos. */
const FOLLOWED_PER_CHUNK = 40;

/**
 * Historias de PERFIL de quienes sigue el usuario. Sin ventana temporal.
 *
 * ⚠️ Va ACOTADA. Antes pedía todas las historias de hasta 200 personas de una
 * sola vez, sin tope: con el histórico completo eso crece para siempre y lo paga
 * el usuario en lecturas y en memoria cada vez que abre el feed. Ahora cada tanda
 * trae solo las más recientes.
 *
 * El filtro `source == "profile"` se aplica en memoria y no en la consulta, para
 * poder ordenar por fecha con el índice que ya existe (`creatorId` + `createdAt`)
 * en vez de necesitar uno nuevo de tres campos.
 */
export async function fetchFollowedReelStories(uid: string): Promise<StoryDoc[]> {
  if (!uid) return [];
  try {
    const followingSnap = await getDocs(
      query(collection(db, "users", uid, "following"), limit(200)),
    );
    const ids = followingSnap.docs.map((d) => (d.data().targetUserId as string) ?? d.id);
    if (ids.length === 0) return [];

    const batches = await Promise.all(
      chunk(ids, IN_CHUNK).map((batch) =>
        getDocs(
          query(
            collection(db, "stories"),
            where("creatorId", "in", batch),
            orderBy("createdAt", "desc"),
            limit(FOLLOWED_PER_CHUNK),
          ),
        ).catch(() => null),
      ),
    );

    const merged = new Map<string, StoryDoc>();
    for (const snap of batches) {
      if (!snap) continue;
      for (const d of snap.docs) {
        const story = toStory(d);
        if (story.source !== "profile") continue;
        if (story.hiddenFromReel) continue;
        if (!story.muxPlaybackId) continue;
        merged.set(story.id, story);
      }
    }
    return [...merged.values()].sort(byDateDesc);
  } catch (err) {
    console.error("[fetchFollowedReelStories]", err);
    return [];
  }
}

/** Descubrimiento público, paginado por fecha. Sin ventana temporal. */
export async function fetchDiscoveryReelPage(
  cursor: QueryDocumentSnapshot | null,
  pageSize: number = REEL_PAGE_SIZE,
): Promise<ReelPage> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "stories"),
        where("searchable", "==", true),
        where("hiddenFromReel", "==", false),
        orderBy("createdAt", "desc"),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(pageSize),
      ),
    );
    return {
      stories: snap.docs.map(toStory).filter((s) => !!s.muxPlaybackId),
      cursor: snap.docs[snap.docs.length - 1] ?? null,
      exhausted: snap.size < pageSize,
    };
  } catch (err) {
    console.error("[fetchDiscoveryReelPage]", err);
    return { stories: [], cursor: null, exhausted: true };
  }
}

/** Quita repetidos conservando el orden de llegada. */
export function dedupeStories(stories: StoryDoc[]): StoryDoc[] {
  const seen = new Set<string>();
  const out: StoryDoc[] = [];
  for (const s of stories) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/**
 * Identidad del VIDEO, no del documento.
 *
 * El mismo saludo puede estar publicado dos veces, por quien lo grabó y por quien
 * lo compró. En el reel circula UNA sola copia.
 */
export function storyVideoKey(story: StoryDoc): string {
  return story.greetingRequestId || story.id;
}

/**
 * Deja una sola copia por video, prefiriendo la del CREADOR.
 *
 * Cuál de las dos circula no da igual, aunque en pantalla se vean idénticas: las
 * vistas se cuentan por documento, y `viewsCount` alimenta la popularidad del
 * ranking. Si circulara la copia del comprador, el trabajo del creador sumaría
 * reputación al documento equivocado y su propia historia quedaría a cero.
 *
 * Para esto sirve `byCreator`, que si no sería un campo muerto desde que la
 * deduplicación se hace por video.
 */
export function preferCreatorCopy(stories: StoryDoc[]): StoryDoc[] {
  const best = new Map<string, StoryDoc>();
  for (const story of stories) {
    const key = storyVideoKey(story);
    const current = best.get(key);
    if (!current) {
      best.set(key, story);
      continue;
    }
    // Solo se sustituye si la nueva es del creador y la guardada no.
    if (current.byCreator === false && story.byCreator !== false) best.set(key, story);
  }
  return [...best.values()];
}

/** Ruta pública de una historia dentro del feed. */
export function buildStoryPath(storyId: string): string {
  const clean = storyId.trim();
  return clean ? `/reels/${encodeURIComponent(clean)}` : "/reels";
}

export function buildStoryUrl(storyId: string): string {
  return `${getBaseAppUrl()}${buildStoryPath(storyId)}`;
}
