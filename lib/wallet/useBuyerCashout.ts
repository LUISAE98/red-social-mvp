// Estado de la DEVOLUCIÓN EN EFECTIVO del comprador (B7): expone su solicitud MÁS RECIENTE
// (cualquier estado) para mostrar la leyenda correcta en /experiencias — en revisión,
// aprobada (con los días de procesamiento) o rechazada (con el motivo del superadmin).

"use client";

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type LatestCashout = {
  id: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  rejectionNote: string;
  refundedAmount: number;
  dismissed: boolean;
} | null;

export function useBuyerCashout(uid: string | undefined): {
  latest: LatestCashout;
  loading: boolean;
} {
  const [latest, setLatest] = useState<LatestCashout>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLatest(null);
      setLoading(false);
      return;
    }
    // Todas las del comprador; se ordena en cliente (son pocas) para no requerir índice.
    const q = query(collection(db, "cashoutRequests"), where("buyerId", "==", uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs
          .map((d) => {
            const data = d.data();
            const ms =
              (data.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            return { id: d.id, data, ms };
          })
          .sort((a, b) => b.ms - a.ms);
        const top = docs[0];
        setLatest(
          top
            ? {
                id: top.id,
                amount: (top.data.amount as number) ?? 0,
                status: ((top.data.status as "pending" | "approved" | "rejected") ?? "pending"),
                rejectionNote: (top.data.rejectionNote as string) ?? "",
                refundedAmount: (top.data.refundedAmount as number) ?? 0,
                dismissed: Boolean(top.data.buyerDismissedAt),
              }
            : null
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid]);

  return { latest, loading };
}
