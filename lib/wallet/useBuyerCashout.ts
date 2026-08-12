// Estado de la DEVOLUCIÓN EN EFECTIVO del comprador (B7): si tiene una solicitud pendiente
// de revisión del superadmin (para mostrar "en revisión" en lugar del botón de pedir efectivo).

"use client";

import { useEffect, useState } from "react";
import { collection, query, where, limit, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type PendingCashout = { id: string; amount: number } | null;

export function useBuyerCashout(uid: string | undefined): {
  pending: PendingCashout;
  loading: boolean;
} {
  const [pending, setPending] = useState<PendingCashout>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setPending(null);
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, "cashoutRequests"),
      where("buyerId", "==", uid),
      where("status", "==", "pending"),
      limit(1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const d = snap.docs[0];
        setPending(d ? { id: d.id, amount: (d.data().amount as number) ?? 0 } : null);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid]);

  return { pending, loading };
}
