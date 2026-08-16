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

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { collection, getDocs, limit, orderBy, query, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getUserTasteVector } from "@/app/components/GroupRecommendations/recommendation-engine";
import type { CanonicalGroupCategory } from "@/types/group";
import type { StoryDoc } from "@/lib/stories/types";
import {
  dedupeStories,
  fetchDiscoveryReelPage,
  fetchFollowedReelStories,
  storyVideoKey,
} from "./reelStories";
import { mixByQuota, rankStories, spreadByCreator, splitLanes } from "./reelRanking";
import {
  getReelFeedGeneration,
  getReelFeedGenerationServer,
  subscribeToReelFeedRefresh,
} from "./reelFeedRefresh";
import {
  applyEngagement,
  loadTermVector,
  saveTermVector,
  termAffinity,
  type ReelEngagement,
  type TermVector,
} from "./reelInterest";

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

  // Cambia cuando alguien pide refrescar (tirar hacia abajo, publicar, quitar).
  // Entra en las dependencias del efecto de carga, así que rearma el feed entero
  // sin que este hook tenga que saber quién lo pidió.
  const generation = useSyncExternalStore(
    subscribeToReelFeedRefresh,
    getReelFeedGeneration,
    getReelFeedGenerationServer,
  );

  const tasteRef = useRef<Map<CanonicalGroupCategory, number>>(new Map());
  const viewedRef = useRef<Map<string, number>>(new Map());
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const exhaustedRef = useRef(false);
  const loadingRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Se recuerda el VIDEO, no el documento: el mismo saludo puede estar publicado
  // dos veces (por quien lo grabó y por quien lo compró) y en el reel circula una
  // sola copia.
  const seenVideosRef = useRef<Set<string>>(new Set());
  const interestRef = useRef<TermVector>(new Map());
  // De quién es el vector que hay en memoria.
  const interestUidRef = useRef<string | null>(null);
  // Solo se escribe si de verdad cambió algo durante la sesión.
  const interestDirtyRef = useRef(false);

  /** Rankea y reparte una tanda cruda de descubrimiento. */
  const arrange = useCallback((pool: StoryDoc[]): StoryDoc[] => {
    const fresh = pool.filter(
      (s) => !seenIdsRef.current.has(s.id) && !seenVideosRef.current.has(storyVideoKey(s)),
    );
    if (fresh.length === 0) return [];
    const ranked = rankStories(fresh, tasteRef.current, viewedRef.current, Date.now(), (s) =>
      termAffinity(s, interestRef.current),
    );
    // Primero la cuota entre consejos y saludos, y DESPUÉS se separan los del
    // mismo creador. Al revés, la cuota volvería a juntarlos.
    const mixed = spreadByCreator(mixByQuota(splitLanes(ranked)));
    for (const s of mixed) {
      seenIdsRef.current.add(s.id);
      seenVideosRef.current.add(storyVideoKey(s));
    }
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
    seenVideosRef.current = new Set();

    // El vector de intereses se ata al USUARIO, no a la recarga. Un refresco no
    // puede tirar lo aprendido en esta sesión, que aún no está guardado: se
    // escribe una sola vez al salir del feed.
    const sameUser = interestUidRef.current === uid;
    if (!sameUser) {
      interestRef.current = new Map();
      interestDirtyRef.current = false;
      interestUidRef.current = uid;
    }

    (async () => {
      const [taste, viewed, interest, followed, pool] = await Promise.all([
        getUserTasteVector(uid).catch(() => new Map<CanonicalGroupCategory, number>()),
        fetchViewedMap(uid),
        sameUser ? Promise.resolve(interestRef.current) : loadTermVector(uid),
        fetchFollowedReelStories(uid),
        fetchDiscoveryReelPage(null, POOL_SIZE),
      ]);
      if (cancelled) return;

      tasteRef.current = taste;
      viewedRef.current = viewed;
      interestRef.current = interest;
      cursorRef.current = pool.cursor;
      exhaustedRef.current = pool.exhausted;

      // Los seguidos van a la cabeza y sin cuota, pero sí con lo no visto
      // delante: si sigues a alguien, lo nuevo suyo es lo primero que quieres.
      //
      // También aquí se deduplica por video: si sigues al creador Y al comprador
      // del mismo saludo, te llegan las dos copias y solo debe circular una.
      const head: StoryDoc[] = [];
      for (const s of rankStories(followed, taste, viewed, Date.now())) {
        const videoKey = storyVideoKey(s);
        if (seenVideosRef.current.has(videoKey)) continue;
        seenVideosRef.current.add(videoKey);
        seenIdsRef.current.add(s.id);
        head.push(s);
      }

      const tail = arrange(pool.stories);

      setState({ uid, stories: dedupeStories([...head, ...tail]), ready: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, arrange, generation]);

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

  /**
   * Registra cuánto se quedó mirando una historia.
   *
   * Se acumula en memoria, no se escribe en cada scroll. Un feed son decenas de
   * cambios por minuto y eso sería una escritura por cada uno.
   */
  const recordEngagement = useCallback((engagement: ReelEngagement) => {
    applyEngagement(interestRef.current, engagement);
    interestDirtyRef.current = true;
  }, []);

  // Una sola escritura al salir del feed. `pagehide` cubre cerrar la pestaña y
  // el cambio de app en móvil, donde `beforeunload` no llega en iOS.
  useEffect(() => {
    if (!uid) return;
    const flush = () => {
      if (!interestDirtyRef.current) return;
      interestDirtyRef.current = false;
      void saveTermVector(uid, interestRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [uid]);

  // Si el estado es de otra sesión, se ignora hasta que llegue el de esta.
  const current = state.uid === uid ? state : EMPTY;
  return { stories: current.stories, ready: current.ready, loadMore, recordEngagement };
}
