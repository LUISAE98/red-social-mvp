"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type PurchaseGeoPoint = {
  id: string;
  lat: number;
  lng: number;
  country: string | null;
  city: string | null;
  purchases: number;
  grossSum: number;
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Suscribe al agregado de compras por celda geográfica (~10 km) del creador.
 * Cada documento = un punto del mapa (se llena en vivo conforme entran compras).
 */
const EMPTY_POINTS: PurchaseGeoPoint[] = [];

// Caché en memoria con listener persistente (compartido entre pestañas).
type GeoStore = {
  points: PurchaseGeoPoint[];
  loaded: boolean;
  unsub: (() => void) | null;
  subs: Set<() => void>;
};
const geoStores = new Map<string, GeoStore>();

function getGeoStore(uid: string): GeoStore {
  let s = geoStores.get(uid);
  if (!s) {
    s = { points: EMPTY_POINTS, loaded: false, unsub: null, subs: new Set() };
    geoStores.set(uid, s);
  }
  return s;
}

function ensureGeoSub(uid: string) {
  const s = getGeoStore(uid);
  if (s.unsub) return;
  const q = query(collection(db, "users", uid, "purchaseGeo"));
  const notify = () => s.subs.forEach((fn) => fn());
  s.unsub = onSnapshot(
    q,
    (snap) => {
      s.points = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          lat: num(x.lat),
          lng: num(x.lng),
          country: str(x.country),
          city: str(x.city),
          purchases: num(x.purchases),
          grossSum: num(x.grossSum),
        };
      });
      s.loaded = true;
      notify();
    },
    () => {
      s.loaded = true;
      notify();
    }
  );
}

export function useWalletPurchaseGeo(uid: string | null | undefined) {
  useEffect(() => {
    if (uid) ensureGeoSub(uid);
  }, [uid]);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!uid) return () => {};
      const s = getGeoStore(uid);
      s.subs.add(cb);
      return () => {
        s.subs.delete(cb);
      };
    },
    [uid]
  );
  const getSnapshot = useCallback(
    () => (uid ? geoStores.get(uid)?.points ?? EMPTY_POINTS : EMPTY_POINTS),
    [uid]
  );
  const points = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_POINTS);
  return { points };
}
