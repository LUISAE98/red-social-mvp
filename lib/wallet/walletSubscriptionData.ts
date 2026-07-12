"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  collection,
  documentId,
  getCountFromServer,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

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
  } catch {
    s.data = EMPTY_COMMS;
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

// ───────────────────────── Suscriptores activos (con perfil) ─────────────────
export type ActiveSubscriber = {
  uid: string;
  subscribedAt: Date | null;
  displayName: string | null;
  avatarUrl: string | null;
};
const EMPTY_SUBS: ActiveSubscriber[] = [];
const subsStores = new Map<string, Store<ActiveSubscriber[]>>();
function getSubsStore(uid: string) {
  let s = subsStores.get(uid);
  if (!s) {
    s = makeStore<ActiveSubscriber[]>(EMPTY_SUBS);
    subsStores.set(uid, s);
  }
  return s;
}
async function loadActiveSubscribers(uid: string) {
  const s = getSubsStore(uid);
  if (s.loaded || s.loading) return;
  s.loading = true;
  try {
    // Dedupe por uid: si está en varias comunidades, la suscripción más antigua.
    const byUid = new Map<string, Date | null>();
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
          const prev = byUid.get(memberUid);
          if (prev === undefined || (since && (!prev || since < prev))) {
            byUid.set(memberUid, since);
          }
        });
      } catch {
        // sin permiso a esa comunidad
      }
    }

    // Perfiles por lote.
    const ids = [...byUid.keys()];
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

    s.data = [...byUid.entries()]
      .map(([u, since]) => ({
        uid: u,
        subscribedAt: since,
        displayName: profiles.get(u)?.displayName ?? null,
        avatarUrl: profiles.get(u)?.avatarUrl ?? null,
      }))
      .sort((a, b) => {
        const ta = a.subscribedAt?.getTime() ?? Infinity;
        const tb = b.subscribedAt?.getTime() ?? Infinity;
        return ta - tb; // más antiguos primero
      });
  } catch {
    s.data = EMPTY_SUBS;
  }
  s.loaded = true;
  s.loading = false;
  notify(s);
}

export function useActiveSubscribers(uid: string | null | undefined) {
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
  const subscribers = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SUBS);
  const loaded = uid ? Boolean(subsStores.get(uid)?.loaded) : false;
  return { subscribers, loaded };
}

// ───────────────────────── Eventos de baja (churn) ───────────────────────────
const EMPTY_CANCELS: Array<Date | null> = [];
const cancelStores = new Map<string, Store<Array<Date | null>> & { unsub: (() => void) | null }>();
function getCancelStore(uid: string) {
  let s = cancelStores.get(uid);
  if (!s) {
    s = { ...makeStore<Array<Date | null>>(EMPTY_CANCELS), unsub: null };
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
      s.data = snap.docs.map((d) => toDate(d.data().occurredAt));
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
