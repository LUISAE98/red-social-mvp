"use client";

// El perfil del creador, leído UNA sola vez y compartido.
//
// ⚠️ Este archivo existe por un problema medido, no por gusto de arquitectura.
//
// El mismo documento `users/{creador}` se leía por CUATRO caminos distintos y
// sin enterarse unos de otros: el slide de la historia (nombre, foto), el flujo
// de compra (precio, disponibilidad), la superficie del carrusel (fotos de las
// vistas previas) y el slide del live. Con varios paneles en pantalla eso son
// decenas de lecturas del mismo puñado de documentos, cada una por su cuenta y
// cada una llegando cuando le toca.
//
// De ahí venía lo que se veía como inestabilidad: no era azar, era que cada
// pieza esperaba su propia lectura. La foto llegaba, el nombre no; el nombre
// llegaba, el precio no; y el botón de comprar, que depende del precio, se
// quedaba fuera en perfiles que sí tenían el servicio a la venta.
//
// Aquí hay UNA suscripción viva por creador, con cuenta de interesados. Quien
// llega después encuentra el dato ya puesto y lo lee SIN esperar: por eso al
// volver sobre un creador que ya salió, aparece de golpe.
//
// Es una suscripción y no una lectura suelta a propósito: si el creador cambia
// el precio o apaga el servicio con el feed abierto, lo que se enseña cambia
// con él. Un precio leído una vez es un precio viejo esperando a equivocarse.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { CreatorService } from "@/types/group";

export type CreatorProfile = {
  uid: string;
  /** false cuando el documento no existe: distinto de "todavía no llegó". */
  exists: boolean;
  name: string | null;
  photo: string | null;
  handle: string | null;
  offerings: CreatorService[] | null;
};

type Entry = {
  /** `undefined` mientras no ha llegado la primera respuesta. */
  profile: CreatorProfile | undefined;
  listeners: Set<() => void>;
  unsub: (() => void) | null;
  cierre: ReturnType<typeof setTimeout> | null;
};

/**
 * Cuánto se mantiene viva una suscripción sin nadie mirando.
 *
 * Sin esta gracia, pasar de un panel al siguiente y volver cerraría y reabriría
 * la suscripción a cada paso —y en desarrollo, donde React monta dos veces, la
 * cerraría siempre justo antes de usarla.
 */
const GRACIA_MS = 45_000;

/** Tope de creadores recordados. Un feed real no roza esta cifra. */
const TOPE = 300;

const cache = new Map<string, Entry>();

/**
 * Cuenta de cambios. Sirve de foto del estado para quien mira a VARIOS creadores
 * a la vez y necesita un valor comparable, no un objeto nuevo en cada pintado.
 */
let version = 0;

function leerPerfil(uid: string, data: Record<string, unknown> | undefined, existe: boolean): CreatorProfile {
  const photo = typeof data?.photoURL === "string" && data.photoURL ? data.photoURL : null;
  return {
    uid,
    exists: existe,
    name: typeof data?.displayName === "string" ? data.displayName : null,
    photo,
    handle: typeof data?.handle === "string" ? data.handle : null,
    offerings: Array.isArray(data?.offerings) ? (data.offerings as CreatorService[]) : null,
  };
}

function podar() {
  if (cache.size <= TOPE) return;
  // Solo se tira lo que nadie está mirando. Un creador en pantalla nunca se va.
  for (const [uid, entry] of cache) {
    if (cache.size <= TOPE) break;
    if (entry.listeners.size === 0 && !entry.unsub) cache.delete(uid);
  }
}

function obtenerEntrada(uid: string): Entry {
  let entry = cache.get(uid);
  if (!entry) {
    entry = { profile: undefined, listeners: new Set(), unsub: null, cierre: null };
    cache.set(uid, entry);
    podar();
  }
  return entry;
}

function abrir(uid: string, entry: Entry) {
  if (entry.cierre) {
    clearTimeout(entry.cierre);
    entry.cierre = null;
  }
  if (entry.unsub) return;
  entry.unsub = onSnapshot(
    doc(db, "users", uid),
    (snap) => {
      entry.profile = leerPerfil(uid, snap.data(), snap.exists());
      version++;
      for (const cb of entry.listeners) cb();
    },
    (err) => {
      // Un fallo NO puede verse igual que "todavía no llega": sin esto, el
      // panel se queda en su esqueleto para siempre y nadie sabe por qué.
      console.error("[creatorProfiles] no se pudo leer al creador:", uid, err);
      entry.profile = leerPerfil(uid, undefined, false);
      version++;
      for (const cb of entry.listeners) cb();
    },
  );
}

function programarCierre(uid: string, entry: Entry) {
  if (entry.listeners.size > 0 || entry.cierre) return;
  entry.cierre = setTimeout(() => {
    entry.cierre = null;
    if (entry.listeners.size > 0) return;
    entry.unsub?.();
    entry.unsub = null;
    // El dato se QUEDA en memoria aunque la suscripción se cierre: volver sobre
    // ese creador debe ser instantáneo, no otra espera.
  }, GRACIA_MS);
}

/** Lo que ya se sabe del creador, sin esperar. `undefined` = aún no llega. */
export function creadorEnCache(uid: string | null | undefined): CreatorProfile | undefined {
  if (!uid) return undefined;
  return cache.get(uid)?.profile;
}

/** Se apunta a los cambios del creador. Devuelve cómo darse de baja. */
export function suscribirCreador(uid: string, onChange: () => void): () => void {
  const entry = obtenerEntrada(uid);
  entry.listeners.add(onChange);
  abrir(uid, entry);
  return () => {
    entry.listeners.delete(onChange);
    programarCierre(uid, entry);
  };
}

/**
 * Adelanta la lectura de varios creadores a la vez.
 *
 * Se llama en cuanto se sabe QUIÉNES van a salir, mucho antes de que sus
 * paneles se monten. Para cuando el panel aparece, el dato ya está: esa es la
 * diferencia entre "tarda una eternidad" y "sale puesto".
 *
 * De uno en uno y no con `documentId() in`: esa consulta ya dejó sin foto a las
 * vistas previas en este mismo repositorio, y el documento suelto es el camino
 * que funciona. No es caro, son unos pocos autores aunque haya decenas de
 * historias.
 */
export function adelantarCreadores(uids: Array<string | null | undefined>): () => void {
  const bajas: Array<() => void> = [];
  for (const uid of new Set(uids.filter((u): u is string => !!u))) {
    // Un interesado vacío: mantiene la lectura viva sin que nadie repinte.
    bajas.push(suscribirCreador(uid, () => {}));
  }
  return () => {
    for (const baja of bajas) baja();
  };
}

/**
 * El perfil del creador dentro de un componente.
 *
 * `useSyncExternalStore` y no estado propio: devuelve lo que ya hay en el mismo
 * primer pintado, así que un creador ya conocido no pasa por el esqueleto.
 */
export function useCreatorProfile(uid: string | null | undefined): CreatorProfile | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!uid) return () => {};
      return suscribirCreador(uid, onChange);
    },
    [uid],
  );
  const getSnapshot = useCallback(() => creadorEnCache(uid), [uid]);
  // En el servidor no hay nada leído todavía, y decirlo evita un desajuste de
  // hidratación entre lo que pinta el servidor y lo que ya tiene el navegador.
  const getServerSnapshot = useCallback(() => undefined, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Varios creadores a la vez, para quien pinta una lista de ellos.
 *
 * Suscribirse a todos hace dos cosas de una: mantiene el dato al día y, sobre
 * todo, ADELANTA la lectura. La superficie sabe quiénes van a salir mucho antes
 * de que sus paneles se monten, así que cuando el panel aparece el creador ya
 * está leído. Ahí está la diferencia entre esperar y salir puesto.
 *
 * Se pasa la lista ya unida en una cadena: un arreglo nuevo en cada pintado
 * volvería a suscribir sin parar aunque los creadores fueran los mismos.
 */
export function useCreatorProfiles(uidsKey: string): Map<string, CreatorProfile | undefined> {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const bajas = uidsKey ? uidsKey.split("|").map((u) => suscribirCreador(u, onChange)) : [];
      return () => {
        for (const baja of bajas) baja();
      };
    },
    [uidsKey],
  );
  const getSnapshot = useCallback(() => version, []);
  const getServerSnapshot = useCallback(() => 0, []);
  const v = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => {
    const mapa = new Map<string, CreatorProfile | undefined>();
    if (uidsKey) for (const uid of uidsKey.split("|")) mapa.set(uid, creadorEnCache(uid));
    return mapa;
    // `v` entra a propósito: el almacén vive fuera de React, así que la lista de
    // dependencias no puede verlo cambiar. Este número ES la señal de que algo
    // cambió; sin él el mapa se quedaría congelado en el primer pintado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uidsKey, v]);
}

/** Une una lista de creadores en la clave estable que pide `useCreatorProfiles`. */
export function claveDeCreadores(uids: Array<string | null | undefined>): string {
  return [...new Set(uids.filter((u): u is string => !!u))].join("|");
}
