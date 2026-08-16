"use client";

// Fuente del feed de reels: saludos y consejos, uno detrás de otro.
//
// PROVISIONAL. Aquí todavía no vive la mezcla 70/15/15 ni el ranking por afinidad
// y vistas; eso es B3. De momento el orden es simple, primero lo de quien sigues y
// después descubrimiento por fecha. Lo que sí es definitivo es la FORMA de las
// consultas, porque de eso depende que las reglas no las tumben.
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

/** Historias de PERFIL de quienes sigue el usuario. Sin ventana temporal. */
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
            where("source", "==", "profile"),
          ),
        ).catch(() => null),
      ),
    );

    const merged = new Map<string, StoryDoc>();
    for (const snap of batches) {
      if (!snap) continue;
      for (const d of snap.docs) {
        const story = toStory(d);
        // El reel muestra la copia del CREADOR, no la que republica el comprador,
        // para no repetir el mismo video con dos caras. Y respeta el retiro.
        if (story.byCreator === false) continue;
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
        where("byCreator", "==", true),
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
