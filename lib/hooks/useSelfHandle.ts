"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Devuelve el handle (username) del usuario actual, leído de `users/{uid}`.
 * Se usa para construir enlaces al perfil PROPIO (p. ej. la notificación
 * colectiva de nuevos seguidores → `/u/{miHandle}?followers=1`), ya que el
 * contexto de auth no expone el handle.
 */
export function useSelfHandle(uid: string | null | undefined): string | null {
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHandle(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!alive) return;
        const data = snap.exists()
          ? (snap.data() as { handle?: string; username?: string })
          : {};
        setHandle(data.handle ?? data.username ?? null);
      } catch {
        if (alive) setHandle(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  return handle;
}
