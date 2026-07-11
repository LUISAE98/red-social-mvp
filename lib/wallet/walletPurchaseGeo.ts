"use client";

import { useEffect, useState } from "react";
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
export function useWalletPurchaseGeo(uid: string | null | undefined) {
  const [points, setPoints] = useState<PurchaseGeoPoint[]>([]);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "users", uid, "purchaseGeo"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPoints(
          snap.docs.map((d) => {
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
          })
        );
      },
      () => {}
    );
    return () => unsub();
  }, [uid]);

  if (!uid) return { points: [] as PurchaseGeoPoint[] };
  return { points };
}
