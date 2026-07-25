"use client";

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * IDs de publicaciones premium / VOD que el viewer YA desbloqueó (compra
 * confirmada). Suscribe a `postAccess` (buyerId == viewer, status "active"),
 * que es la fuente de verdad server-side: así el desbloqueo persiste en
 * CUALQUIER dispositivo y deja de depender de localStorage.
 *
 * Reglas: postAccess permite `list` cuando buyerId == request.auth.uid.
 */
export function useUnlockedPostIds(
  viewerUid: string | null | undefined
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY);

  useEffect(() => {
    if (!viewerUid) return;
    const q = query(
      collection(db, "postAccess"),
      where("buyerId", "==", viewerUid),
      where("status", "==", "active")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = new Set<string>();
        snap.forEach((d) => {
          const pid = d.data()?.postId;
          if (typeof pid === "string") next.add(pid);
        });
        setIds(next);
      },
      () => setIds(EMPTY)
    );
    return () => unsub();
  }, [viewerUid]);

  // Sin viewer → siempre vacío (no dependemos de estado residual de otro usuario).
  return viewerUid ? ids : EMPTY;
}
