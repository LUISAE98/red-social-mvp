"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { collection, doc, getCountFromServer, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Post } from "@/lib/posts/types";

// Caché en memoria de los documentos de `posts/{id}` (y del conteo de
// espectadores únicos de lives) que enriquecen las pestañas de finanzas.
// Sigue el mismo patrón que `walletLedger`: store module-level + listener de
// suscripción vía `useSyncExternalStore`, de modo que la información se comparte
// entre pestañas y NO se recarga al navegar (se limpia solo al refrescar la
// página). Los posts son documentos globales por id, así que el caché es único.

type PostVal = Post | null;

type PostCacheStore = {
  posts: Map<string, PostVal>;
  views: Map<string, number>;
  inflight: Set<string>;
  subs: Set<() => void>;
};

const store: PostCacheStore = {
  posts: new Map(),
  views: new Map(),
  inflight: new Set(),
  subs: new Set(),
};

const EMPTY_POSTS: Map<string, PostVal> = new Map();
const EMPTY_VIEWS: Map<string, number> = new Map();

function notify() {
  store.subs.forEach((fn) => fn());
}

/** Trae (una sola vez) los ids que aún no están en caché ni en vuelo. */
function ensurePosts(ids: string[], withViews: boolean) {
  const missing = ids.filter((id) => {
    if (store.inflight.has(id)) return false;
    if (!store.posts.has(id)) return true;
    // El post ya está, pero se pidió con vistas y aún no las tenemos.
    if (withViews && !store.views.has(id)) return true;
    return false;
  });
  if (missing.length === 0) return;

  missing.forEach((id) => store.inflight.add(id));

  Promise.all(
    missing.map(async (id) => {
      try {
        if (withViews) {
          const [postSnap, countSnap] = await Promise.all([
            getDoc(doc(db, "posts", id)),
            getCountFromServer(collection(db, "posts", id, "liveUniqueViewers")),
          ]);
          const post = postSnap.exists() ? ({ id: postSnap.id, ...postSnap.data() } as Post) : null;
          return [id, post, countSnap.data().count] as const;
        }
        const snap = await getDoc(doc(db, "posts", id));
        const post = snap.exists() ? ({ id: snap.id, ...snap.data() } as Post) : null;
        return [id, post, 0] as const;
      } catch {
        return [id, null, 0] as const;
      }
    })
  ).then((triples) => {
    // Referencias nuevas para que los `useMemo` dependientes recomputen.
    const nextPosts = new Map(store.posts);
    const nextViews = withViews ? new Map(store.views) : store.views;
    for (const [id, post, v] of triples) {
      nextPosts.set(id, post);
      if (withViews) (nextViews as Map<string, number>).set(id, v);
      store.inflight.delete(id);
    }
    store.posts = nextPosts;
    store.views = nextViews;
    notify();
  });
}

/**
 * Enriquecimiento cacheado de posts para las pestañas de finanzas. Devuelve los
 * mapas `posts` (y `views` si `withViews`) desde el caché persistente; solo
 * consulta a Firestore los ids nuevos. Sobrevive a desmontajes/navegación.
 */
export function useWalletPosts(ids: string[], opts?: { withViews?: boolean }) {
  const withViews = opts?.withViews ?? false;

  useEffect(() => {
    ensurePosts(ids, withViews);
  }, [ids, withViews]);

  const subscribe = useCallback((cb: () => void) => {
    store.subs.add(cb);
    return () => {
      store.subs.delete(cb);
    };
  }, []);

  const posts = useSyncExternalStore(
    subscribe,
    () => store.posts,
    () => EMPTY_POSTS
  );
  const views = withViews ? store.views : EMPTY_VIEWS;

  return { posts, views };
}
