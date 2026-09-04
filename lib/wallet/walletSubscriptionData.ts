"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CACHE_TTL } from "@/lib/cache/ttl";
import { guardarEnCache, leerDeCache } from "@/lib/cache/persistentCache";

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function numOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function toDate(v: unknown): Date | null {
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

// Store genérico (una carga por usuario, persiste entre pestañas hasta refrescar).
type Store<T> = { data: T; loaded: boolean; loading: boolean; subs: Set<() => void> };
function makeStore<T>(empty: T): Store<T> {
  return { data: empty, loaded: false, loading: false, subs: new Set() };
}
/**
 * Pinta desde disco mientras la consulta real va en camino.
 *
 * ⚠️ Esto se aplica SOLO a estas dos listas —comunidades de suscripción y
 * canales del creador— y no al saldo ni al ledger. La diferencia importa: el
 * saldo llega por `onSnapshot`, y la caché persistente de Firestore ya lo
 * entrega al instante en una recarga. Ponerle encima una segunda caché nuestra
 * no lo haría más rápido, solo abriría la puerta a enseñar un saldo MÁS VIEJO
 * del que Firestore ya tiene. Con dinero eso no se hace.
 *
 * Estas dos, en cambio, se cargan con `getDocs` —que sí espera al servidor— y
 * una de ellas suma un `getCountFromServer` POR COMUNIDAD, que por definición no
 * se puede servir desde ninguna caché. Ahí es donde la wallet se quedaba en
 * blanco, y es lo único que se arregla aquí. Lo que se guarda son cifras para
 * mostrar (precio publicado, cuántos suscriptores hay), no dinero sobre el que
 * se pueda actuar.
 *
 * Se marca `loaded` a propósito, para que la pantalla deje de esperar y pinte.
 * La consulta de verdad sigue corriendo y sobrescribe lo pintado al llegar.
 */
async function hidratarDesdeDisco<T>(s: Store<T>, clave: string): Promise<void> {
  const guardado = await leerDeCache<T>(clave, CACHE_TTL.CATALOGO);

  // Si la red llegó primero, lo suyo manda: no se pisa con algo más viejo.
  if (!guardado || s.loaded) return;

  s.data = guardado;
  s.loaded = true;
  notify(s);
}

function notify<T>(s: Store<T>) {
  s.subs.forEach((fn) => fn());
}

// ───────────────────────── Comunidades de suscripción propias ────────────────
export type SubCommunity = { id: string; price: number; activeSubs: number };
const EMPTY_COMMS: SubCommunity[] = [];
const commStores = new Map<string, Store<SubCommunity[]>>();
function getCommStore(uid: string) {
  let s = commStores.get(uid);
  if (!s) {
    s = makeStore<SubCommunity[]>(EMPTY_COMMS);
    commStores.set(uid, s);
  }
  return s;
}
async function loadCommunities(uid: string) {
  const s = getCommStore(uid);
  if (s.loaded || s.loading) return;
  s.loading = true;

  // Va DESPUÉS del corte de arriba, no antes: si se hidratara primero, marcar
  // `loaded` haría que la propia comprobación abortara la consulta real y la
  // lista se quedaría congelada en lo que había en disco.
  await hidratarDesdeDisco(s, `wallet:comunidades:${uid}`);

  try {
    const gSnap = await getDocs(
      query(collection(db, "groups"), where("ownerId", "==", uid))
    );
    const result = (
      await Promise.all(
        gSnap.docs.map(async (g) => {
          const gd = g.data() as Record<string, unknown>;
          const mon = gd.monetization as
            | { subscriptionsEnabled?: unknown; isPaid?: unknown; subscriptionPriceMonthly?: unknown }
            | undefined;
          if (!(mon?.subscriptionsEnabled === true || mon?.isPaid === true)) return null;
          let activeSubs = 0;
          try {
            const c = await getCountFromServer(
              query(
                collection(db, "groups", g.id, "members"),
                where("subscriptionActive", "==", true)
              )
            );
            activeSubs = c.data().count;
          } catch {
            activeSubs = 0;
          }
          return { id: g.id, price: numOr0(mon?.subscriptionPriceMonthly), activeSubs };
        })
      )
    ).filter((x): x is SubCommunity => x !== null);
    s.data = result;
    void guardarEnCache(`wallet:comunidades:${uid}`, result);
  } catch {
    // Si la consulta falla pero ya había algo de disco pintado, se conserva:
    // vaciarlo cambiaría una lista un poco vieja por una vacía, que es peor.
    if (!s.loaded) s.data = EMPTY_COMMS;
  }
  s.loaded = true;
  s.loading = false;
  notify(s);
}

export function useOwnedSubCommunities(uid: string | null | undefined) {
  useEffect(() => {
    if (uid) loadCommunities(uid);
  }, [uid]);
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!uid) return () => {};
      const s = getCommStore(uid);
      s.subs.add(cb);
      return () => {
        s.subs.delete(cb);
      };
    },
    [uid]
  );
  const getSnapshot = useCallback(
    () => (uid ? commStores.get(uid)?.data ?? EMPTY_COMMS : EMPTY_COMMS),
    [uid]
  );
  const communities = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_COMMS);
  const loaded = uid ? Boolean(commStores.get(uid)?.loaded) : false;
  return { communities, loaded };
}

// ───────────────────────── Canales del creador (perfil + comunidades) ─────────
// Para el filtro por canal en Movimientos. Incluye TODAS las comunidades propias
// (con o sin suscripción), no solo las de suscripción.
export type WalletChannel = {
  /** "profile" | "g:<groupId>" — misma clave que agrega el ledger. */
  key: string;
  type: "profile" | "group";
  /** groupId si es comunidad; null para el perfil. */
  id: string | null;
  name: string | null;
  avatar: string | null;
  isSubscription: boolean;
};
const EMPTY_CHANNELS: WalletChannel[] = [];
const channelStores = new Map<string, Store<WalletChannel[]>>();
function getChannelStore(uid: string) {
  let s = channelStores.get(uid);
  if (!s) {
    s = makeStore<WalletChannel[]>(EMPTY_CHANNELS);
    channelStores.set(uid, s);
  }
  return s;
}
async function loadChannels(uid: string) {
  const s = getChannelStore(uid);
  if (s.loaded || s.loading) return;
  s.loading = true;

  // Mismo orden que en loadCommunities, y por el mismo motivo.
  await hidratarDesdeDisco(s, `wallet:canales:${uid}`);

  try {
    const [uSnap, gSnap] = await Promise.all([
      getDoc(doc(db, "users", uid)),
      getDocs(query(collection(db, "groups"), where("ownerId", "==", uid))),
    ]);
    const ud = uSnap.data() as Record<string, unknown> | undefined;
    const profile: WalletChannel = {
      key: "profile",
      type: "profile",
      id: null,
      name:
        pickString(ud?.displayName) ??
        pickString(ud?.name) ??
        pickString(ud?.username) ??
        pickString(ud?.handle),
      avatar: pickString(ud?.avatarUrl) ?? pickString(ud?.photoURL),
      isSubscription: false,
    };
    const groups: WalletChannel[] = gSnap.docs.map((g) => {
      const gd = g.data() as Record<string, unknown>;
      const mon = gd.monetization as
        | { subscriptionsEnabled?: unknown; isPaid?: unknown }
        | undefined;
      return {
        key: `g:${g.id}`,
        type: "group" as const,
        id: g.id,
        name:
          pickString(gd.name) ??
          pickString(gd.title) ??
          pickString(gd.displayName),
        avatar:
          pickString(gd.avatarUrl) ??
          pickString(gd.imageUrl) ??
          pickString(gd.coverUrl),
        isSubscription: mon?.subscriptionsEnabled === true || mon?.isPaid === true,
      };
    });
    s.data = [profile, ...groups];
    void guardarEnCache(`wallet:canales:${uid}`, s.data);
  } catch {
    // Se conserva lo que ya hubiera de disco: una lista algo vieja es mejor
    // que una vacía.
    if (!s.loaded) s.data = EMPTY_CHANNELS;
  }
  s.loaded = true;
  s.loading = false;
  notify(s);
}

export function useOwnedChannels(uid: string | null | undefined) {
  useEffect(() => {
    if (uid) loadChannels(uid);
  }, [uid]);
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!uid) return () => {};
      const s = getChannelStore(uid);
      s.subs.add(cb);
      return () => {
        s.subs.delete(cb);
      };
    },
    [uid]
  );
  const getSnapshot = useCallback(
    () => (uid ? channelStores.get(uid)?.data ?? EMPTY_CHANNELS : EMPTY_CHANNELS),
    [uid]
  );
  const channels = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CHANNELS);
  const loaded = uid ? Boolean(channelStores.get(uid)?.loaded) : false;
  return { channels, loaded };
}

// ───────────────────────── Suscriptores activos (con perfil) ─────────────────
export type ActiveSubscriber = {
  uid: string;
  subscribedAt: Date | null;
  displayName: string | null;
  avatarUrl: string | null;
};
// Registro crudo por membresía (una fila por comunidad); el hook deduplica y
// filtra por comunidad para poder acotar la lista al canal seleccionado.
type ActiveSubRecord = ActiveSubscriber & { communityId: string };
const EMPTY_SUBS: ActiveSubRecord[] = [];
const subsStores = new Map<string, Store<ActiveSubRecord[]>>();
function getSubsStore(uid: string) {
  let s = subsStores.get(uid);
  if (!s) {
    s = makeStore<ActiveSubRecord[]>(EMPTY_SUBS);
    subsStores.set(uid, s);
  }
  return s;
}
async function loadActiveSubscribers(uid: string) {
  const s = getSubsStore(uid);
  if (s.loaded || s.loading) return;
  s.loading = true;
  try {
    // Un registro por membresía (conservamos communityId para poder filtrar).
    const records: ActiveSubRecord[] = [];
    const gSnap = await getDocs(
      query(collection(db, "groups"), where("ownerId", "==", uid))
    );
    for (const g of gSnap.docs) {
      const gd = g.data() as Record<string, unknown>;
      const mon = gd.monetization as
        | { subscriptionsEnabled?: unknown; isPaid?: unknown }
        | undefined;
      if (!(mon?.subscriptionsEnabled === true || mon?.isPaid === true)) continue;
      try {
        const mSnap = await getDocs(
          query(
            collection(db, "groups", g.id, "members"),
            where("subscriptionActive", "==", true)
          )
        );
        mSnap.docs.forEach((m) => {
          const d = m.data();
          const memberUid = pickString(d.userId) ?? m.id;
          if (!memberUid || memberUid === uid) return;
          const since = toDate(d.subscribedAt) ?? toDate(d.joinedAt);
          records.push({
            communityId: g.id,
            uid: memberUid,
            subscribedAt: since,
            displayName: null,
            avatarUrl: null,
          });
        });
      } catch {
        // sin permiso a esa comunidad
      }
    }

    // Perfiles por lote (uids únicos).
    const ids = [...new Set(records.map((r) => r.uid))];
    const profiles = new Map<string, { displayName: string | null; avatarUrl: string | null }>();
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      try {
        const pSnap = await getDocs(
          query(collection(db, "users"), where(documentId(), "in", chunk))
        );
        pSnap.docs.forEach((d) => {
          const x = d.data();
          profiles.set(d.id, {
            displayName:
              pickString(x.displayName) ??
              pickString(x.name) ??
              pickString(x.username) ??
              pickString(x.handle),
            avatarUrl: pickString(x.avatarUrl) ?? pickString(x.photoURL),
          });
        });
      } catch {
        // lote fallido
      }
    }

    s.data = records.map((r) => ({
      ...r,
      displayName: profiles.get(r.uid)?.displayName ?? null,
      avatarUrl: profiles.get(r.uid)?.avatarUrl ?? null,
    }));
  } catch {
    s.data = EMPTY_SUBS;
  }
  s.loaded = true;
  s.loading = false;
  notify(s);
}

/**
 * Suscriptores activos. Si se pasan `communityIds`, se limita a esas comunidades;
 * si no, agrega todas. Deduplica por uid (conserva la suscripción más antigua).
 */
export function useActiveSubscribers(
  uid: string | null | undefined,
  communityIds?: string[] | null
) {
  useEffect(() => {
    if (uid) loadActiveSubscribers(uid);
  }, [uid]);
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!uid) return () => {};
      const s = getSubsStore(uid);
      s.subs.add(cb);
      return () => {
        s.subs.delete(cb);
      };
    },
    [uid]
  );
  const getSnapshot = useCallback(
    () => (uid ? subsStores.get(uid)?.data ?? EMPTY_SUBS : EMPTY_SUBS),
    [uid]
  );
  const records = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SUBS);
  const loaded = uid ? Boolean(subsStores.get(uid)?.loaded) : false;

  const filterKey = communityIds && communityIds.length ? [...communityIds].sort().join(",") : null;
  const subscribers = useMemo(() => {
    const allow = filterKey ? new Set(filterKey.split(",")) : null;
    const byUid = new Map<string, ActiveSubscriber>();
    for (const r of records) {
      if (allow && !allow.has(r.communityId)) continue;
      const prev = byUid.get(r.uid);
      if (
        !prev ||
        (r.subscribedAt && (!prev.subscribedAt || r.subscribedAt < prev.subscribedAt))
      ) {
        byUid.set(r.uid, {
          uid: r.uid,
          subscribedAt: r.subscribedAt,
          displayName: r.displayName,
          avatarUrl: r.avatarUrl,
        });
      }
    }
    return [...byUid.values()].sort((a, b) => {
      const ta = a.subscribedAt?.getTime() ?? Infinity;
      const tb = b.subscribedAt?.getTime() ?? Infinity;
      return ta - tb; // más antiguos primero
    });
  }, [records, filterKey]);

  return { subscribers, loaded };
}

// ───────────────────────── Eventos de baja (churn) ───────────────────────────
export type SubscriptionCancel = { occurredAt: Date | null; groupId: string | null };
const EMPTY_CANCELS: SubscriptionCancel[] = [];
const cancelStores = new Map<string, Store<SubscriptionCancel[]> & { unsub: (() => void) | null }>();
function getCancelStore(uid: string) {
  let s = cancelStores.get(uid);
  if (!s) {
    s = { ...makeStore<SubscriptionCancel[]>(EMPTY_CANCELS), unsub: null };
    cancelStores.set(uid, s);
  }
  return s;
}
function ensureCancelSub(uid: string) {
  const s = getCancelStore(uid);
  if (s.unsub) return;
  s.unsub = onSnapshot(
    query(collection(db, "users", uid, "subscriptionEvents")),
    (snap) => {
      s.data = snap.docs.map((d) => ({
        occurredAt: toDate(d.data().occurredAt),
        groupId: pickString(d.data().groupId),
      }));
      s.loaded = true;
      notify(s);
    },
    () => {
      s.loaded = true;
      notify(s);
    }
  );
}

export function useSubscriptionCancels(uid: string | null | undefined) {
  useEffect(() => {
    if (uid) ensureCancelSub(uid);
  }, [uid]);
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!uid) return () => {};
      const s = getCancelStore(uid);
      s.subs.add(cb);
      return () => {
        s.subs.delete(cb);
      };
    },
    [uid]
  );
  const getSnapshot = useCallback(
    () => (uid ? cancelStores.get(uid)?.data ?? EMPTY_CANCELS : EMPTY_CANCELS),
    [uid]
  );
  const cancels = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CANCELS);
  return { cancels };
}
