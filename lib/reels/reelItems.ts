// Lo que puede aparecer en el feed de reels: una historia o un live.
//
// Un live NO es una historia. Vive en `posts` con `postType: "live"` y sus datos
// en `liveData`, mientras que una historia vive en `stories`. Se pareció durante
// un rato a la idea de fabricar una historia falsa a partir del live y ahorrarse
// este tipo, pero eso le mentiría a todo lo que ya trata a una historia como tal:
// la deduplicación por video, el contador de vistas, `hiddenFromReel` y el vector
// de intereses no significan nada para un live, y acabarían recibiendo valores
// inventados.
//
// Así que el feed transporta una UNIÓN y cada cosa sigue siendo lo que es. Quien
// pinta decide con `kind`; quien ordena usa los ayudantes de `reelRanking`.
//
// Este archivo es lógica PURA: sin Firestore, para poder probarlo sin emulador.
// Las consultas están en `reelLives` y `reelStories`.

import type { Post, PostLiveData } from "@/lib/posts/types";
import type { StoryDoc } from "@/lib/stories/types";

/** Un post de live con la certeza de que trae `liveData`. */
export type ReelLivePost = Post & { liveData: PostLiveData };

export type ReelItem =
  | { kind: "story"; key: string; story: StoryDoc }
  | { kind: "live"; key: string; post: ReelLivePost };

/**
 * Clave estable para React y para deduplicar.
 *
 * Un live y una historia podrían llegar con el mismo id —son colecciones
 * distintas y sus ids no se coordinan—, así que la de un live va prefijada.
 */
export function storyItem(story: StoryDoc): ReelItem {
  return { kind: "story", key: story.id, story };
}

export function liveItem(post: ReelLivePost): ReelItem {
  return { kind: "live", key: `live:${post.id}`, post };
}

export function isStoryItem(item: ReelItem): item is Extract<ReelItem, { kind: "story" }> {
  return item.kind === "story";
}

export function isLiveItem(item: ReelItem): item is Extract<ReelItem, { kind: "live" }> {
  return item.kind === "live";
}

/** Las historias de una lista mezclada, en orden. */
export function storiesOf(items: ReelItem[]): StoryDoc[] {
  return items.filter(isStoryItem).map((i) => i.story);
}

/**
 * Un live directo desde el navegador escribe una señal de vida cada 20 s. Si
 * lleva más de esto callado se le da por caído, aunque su estado siga diciendo
 * que transmite: el cierre automático tarda en pasar y mientras tanto el feed
 * enseñaría una transmisión muerta.
 */
const DIRECT_HEARTBEAT_MAX_MS = 120_000;

/** Lee una marca de tiempo de Firestore venga como venga. */
function toMillis(value: unknown): number {
  if (!value) return 0;
  const v = value as { toMillis?: () => number; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1_000;
  return 0;
}

/**
 * ¿Este live está de verdad transmitiendo AHORA?
 *
 * No basta con que su estado diga "live": ese campo se queda pegado cuando una
 * transmisión se corta mal. El criterio es el mismo que ya usa el rail de
 * comunidades, que es el que está probado en producción.
 *
 * `now` se inyecta para poder probarlo.
 */
export function isLiveOngoing(post: ReelLivePost, now: number = Date.now()): boolean {
  const ld = post.liveData;
  if (!ld) return false;
  // Abierto a cualquiera. Es además lo que las reglas exigen para poder
  // listarlo, así que un live que no lo cumpla no debería ni haber llegado.
  if (ld.visibilityMode !== "everyone") return false;
  // Empezado y sin terminar. Deja fuera los programados y los ya cerrados.
  if (!ld.startedAt || ld.endedAt) return false;
  if (ld.broadcastMode === "direct") {
    const beat = toMillis(ld.heartbeatAt);
    if (!beat || now - beat > DIRECT_HEARTBEAT_MAX_MS) return false;
  }
  return true;
}

/** Cuándo arrancó la transmisión, en milisegundos. 0 si no consta. */
export function liveStartedAtMs(post: ReelLivePost): number {
  return toMillis(post.liveData?.startedAt);
}

/** Quita repetidos conservando el primero de cada clave. */
export function dedupeItems(items: ReelItem[]): ReelItem[] {
  const seen = new Set<string>();
  const out: ReelItem[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}
