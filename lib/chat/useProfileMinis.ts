"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { ProfileMini } from "@/components/chat/ConversationList";

/**
 * Perfiles (nombre, avatar, handle) de varios interlocutores, por uid.
 *
 * Solo pide los que aún no tiene y acumula el resultado, así que recorrer el
 * inbox no vuelve a leer a nadie ya cargado. Lectura de una sola vez: estos
 * datos no cambian mientras miras la lista.
 */
export function useProfileMinis(uids: string[]): Record<string, ProfileMini> {
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const loadedRef = useRef<Set<string>>(new Set());

  // Clave estable: sin esto, un array nuevo en cada render relanzaría la carga.
  const key = uids.slice().sort().join(",");

  useEffect(() => {
    const missing = key
      .split(",")
      .filter((uid) => uid && !loadedRef.current.has(uid));
    if (missing.length === 0) return;

    let cancelled = false;
    missing.forEach((uid) => loadedRef.current.add(uid));

    Promise.all(
      missing.map(async (uid): Promise<[string, ProfileMini]> => {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          const data = snap.data() ?? {};
          return [
            uid,
            {
              uid,
              displayName:
                (typeof data.displayName === "string" && data.displayName) ||
                (typeof data.handle === "string" && data.handle) ||
                "",
              handle: typeof data.handle === "string" ? data.handle : null,
              photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
            },
          ];
        } catch {
          return [uid, { uid, displayName: "", handle: null, photoURL: null }];
        }
      })
    ).then((pairs) => {
      if (cancelled) return;
      setProfiles((prev) => {
        const next = { ...prev };
        for (const [uid, mini] of pairs) next[uid] = mini;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return profiles;
}
