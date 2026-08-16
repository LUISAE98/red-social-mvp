"use client";

// Aviso de "vuelve a pedir el feed".
//
// El feed se arma una vez al montar, así que sin esto tirar hacia abajo en el
// home no refrescaba el rail de historias, y una historia recién publicada o
// recién quitada seguía como estaba hasta recargar la página entera.
//
// Antes existía `invalidateStoriesCache(uid)`, que desde B3 ya solo limpiaba la
// caché de a quién sigues, no las historias. El nombre prometía algo que había
// dejado de hacer, y eso es peor que no tener nada.

type Listener = () => void;

let generation = 0;
const listeners = new Set<Listener>();

/** Pide a todas las superficies del feed que vuelvan a cargar. */
export function refreshReelFeed(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

export function subscribeToReelFeedRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getReelFeedGeneration(): number {
  return generation;
}

/** En el servidor no hay refrescos, así que la generación es estable. */
export function getReelFeedGenerationServer(): number {
  return 0;
}
