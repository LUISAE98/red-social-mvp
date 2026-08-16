"use client";

// Fuente única del feed de historias, para el reel de celular y el rail de
// escritorio. Que las dos superficies enseñen lo mismo no es cosmético: cuando
// cada una tenía su propio modelo, una agrupaba por creador y la otra no, y el
// mismo usuario veía una historia en el móvil y cinco en la laptop.
//
// El orden final es:
//   1. Lo de quien sigues, en su propio orden (sin cuota, tal como se acordó).
//   2. Descubrimiento, rankeado y repartido por cuota entre carriles.
//
// El descubrimiento se pide por TANDAS, no de una en una. Firestore no sabe
// ordenar por una puntuación calculada en el cliente, así que se trae una tanda
// por fecha, se rankea entera y se sirve. Rankear de a una daría un orden que en
// realidad es solo cronológico.

import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getUserTasteVector } from "@/app/components/GroupRecommendations/recommendation-engine";
import type { CanonicalGroupCategory } from "@/types/group";
import type { StoryDoc } from "@/lib/stories/types";
import {
  dedupeStories,
  fetchDiscoveryReelPage,
  fetchFollowedReelStories,
} from "./reelStories";
import { mixByQuota, rankStories, splitLanes } from "./reelRanking";

/** Cuántas candidatas se traen por tanda antes de rankear. */
const POOL_SIZE = 60;

/**
 * Cuántas vistas recientes se leen. Es la memoria de "ya lo vi": más allá de
 * esto una historia vuelve a contar como nueva, que para un feed es aceptable y
 * evita arrastrar un historial que solo crece.
 */
const VIEWED_MEMORY = 500;

/** Tandas seguidas sin nada nuevo antes de rendirse hasta el siguiente scroll. */
const MAX_EMPTY_PAGES = 5;

// El estado lleva marcado A QUIÉN pertenece. Así, al cambiar de usuario, lo del
// anterior deja de valer por comparación y no hace falta vaciarlo desde el
// efecto, que provocaría un render en cascada y además enseñaría durante un
// fotograma las historias de la sesión anterior.
type State = {
  uid: string | null;
  stories: StoryDoc[];
  ready: boolean;
};

const EMPTY: State = { uid: null, stories: [], ready: false };

async function fetchViewedMap(uid: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!uid) return map;
  try {
    const snap = await getDocs(
      query(
        collection(db, "userStoryViews", uid, "views"),
        orderBy("viewedAt", "desc"),
        limit(VIEWED_MEMORY),
      ),
    );
    for (const d of snap.docs) {
      map.set(d.id, d.data().viewedAt?.toMillis?.() ?? Date.now());
    }
  } catch (err) {
    // Sin historial de vistas el feed sigue funcionando, solo pierde la
    // penalización de lo ya visto.
    console.error("[useReelFeed] viewed", err);
  }
  return map;
}

export function useReelFeed(uid: string | null | undefined) {
  const [state, setState] = useState<State>(EMPTY);

  const tasteRef = useRef<Map<CanonicalGroupCategory, number>>(new Map());
  const viewedRef = useRef<Map<string, number>>(new Map());
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const exhaustedRef = useRef(false);
  const loadingRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  /** Rankea y reparte una tanda cruda de descubrimiento. */
  const arrange = useCallback((pool: StoryDoc[]): StoryDoc[] => {
    const fresh = pool.filter((s) => !seenIdsRef.current.has(s.id));
    if (fresh.length === 0) return [];
    const ranked = rankStories(fresh, tasteRef.current, viewedRef.current, Date.now());
    const mixed = mixByQuota(splitLanes(ranked));
    for (const s of mixed) seenIdsRef.current.add(s.id);
    return mixed;
  }, []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    // Reinicio total: cambiar de usuario no puede heredar ni el gusto ni las
    // vistas ni el cursor del anterior.
    tasteRef.current = new Map();
    viewedRef.current = new Map();
    cursorRef.current = null;
    exhaustedRef.current = false;
    seenIdsRef.current = new Set();

    (async () => {
      const [taste, viewed, followed, pool] = await Promise.all([
        getUserTasteVector(uid).catch(() => new Map<CanonicalGroupCategory, number>()),
        fetchViewedMap(uid),
        fetchFollowedReelStories(uid),
        fetchDiscoveryReelPage(null, POOL_SIZE),
      ]);
      if (cancelled) return;

      tasteRef.current = taste;
      viewedRef.current = viewed;
      cursorRef.current = pool.cursor;
      exhaustedRef.current = pool.exhausted;

      // Los seguidos van a la cabeza y sin cuota, pero sí con lo no visto
      // delante: si sigues a alguien, lo nuevo suyo es lo primero que quieres.
      const head = rankStories(followed, taste, viewed, Date.now());
      for (const s of head) seenIdsRef.current.add(s.id);

      const tail = arrange(pool.stories);

      setState({ uid, stories: dedupeStories([...head, ...tail]), ready: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, arrange]);

  /**
   * Pide más hasta CONSEGUIR algo nuevo, no hasta pedir una vez.
   *
   * ⚠️ Una tanda puede llegar entera repetida: son las que ya salieron en la
   * cabeza de seguidos, o las que se colaron por el solape entre tandas. Si al
   * quedarse en cero se abandonaba, la lista no crecía, y como sin contenido
   * nuevo el usuario tampoco puede seguir scrolleando, no volvía a dispararse
   * nada. El feed se moría con páginas de sobra por delante.
   *
   * Así que se encadena hasta traer algo o hasta agotar la colección, con un tope
   * de intentos seguidos para no encadenar lecturas sin fin si el filtrado deja
   * tandas vacías una detrás de otra.
   */
  const loadMore = useCallback(() => {
    if (loadingRef.current || exhaustedRef.current) return;
    loadingRef.current = true;

    void (async () => {
      try {
        for (let attempt = 0; attempt < MAX_EMPTY_PAGES; attempt++) {
          const page = await fetchDiscoveryReelPage(cursorRef.current, POOL_SIZE);
          cursorRef.current = page.cursor ?? cursorRef.current;
          exhaustedRef.current = page.exhausted;

          const next = arrange(page.stories);
          if (next.length > 0) {
            setState((prev) => ({
              ...prev,
              stories: dedupeStories([...prev.stories, ...next]),
            }));
            return;
          }
          if (page.exhausted) return;
        }
      } finally {
        loadingRef.current = false;
      }
    })();
  }, [arrange]);

  // Si el estado es de otra sesión, se ignora hasta que llegue el de esta.
  const current = state.uid === uid ? state : EMPTY;
  return { stories: current.stories, ready: current.ready, loadMore };
}
