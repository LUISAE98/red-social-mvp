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

// ── Freno del feed mientras alguien compra ───────────────────────────────────
//
// ⚠️ Rearmar el feed debajo de quien esta pagando le tira la compra.
//
// El caso que lo destapo: en Vibra Express se compra sin cuenta, y al terminar
// se entra con el correo. Si ese correo YA existia, el uid cambia, y con el
// cambia el feed entero: el panel se desmonta, y con el la pasarela y su
// pantalla verde. El cobro se hacia, pero quien pagaba no llegaba a verlo.
//
// El feed puede esperar. Una compra abierta, no.

let frenos = 0;
const frenoListeners = new Set<Listener>();

/** Congela el rearmado del feed. Devuelve como soltarlo. */
export function frenarReelFeed(): () => void {
  frenos += 1;
  for (const listener of frenoListeners) listener();
  let soltado = false;
  return () => {
    if (soltado) return;
    soltado = true;
    frenos -= 1;
    for (const listener of frenoListeners) listener();
  };
}

export function subscribeToReelFeedHold(listener: Listener): () => void {
  frenoListeners.add(listener);
  return () => {
    frenoListeners.delete(listener);
  };
}

export function isReelFeedHeld(): boolean {
  return frenos > 0;
}

/** En el servidor nadie esta comprando. */
export function isReelFeedHeldServer(): boolean {
  return false;
}
