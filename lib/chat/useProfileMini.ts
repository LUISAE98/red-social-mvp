"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { ProfileMini } from "@/components/chat/ConversationList";

/**
 * Nombre, avatar y handle de un perfil, para la cabecera de un hilo abierto
 * fuera del sidebar (donde no existe el `userMiniMap` ya cargado).
 *
 * Lectura de una sola vez: estos datos no cambian mientras miras un chat, así
 * que suscribirse sería pagar por nada.
 */
export function useProfileMini(uid: string | null) {
  const [state, setState] = useState<{
    profile: ProfileMini | undefined;
    loading: boolean;
  }>({ profile: undefined, loading: true });

  useEffect(() => {
    if (!uid) return;

    let cancelled = false;

    getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.data() ?? {};
        setState({
          loading: false,
          profile: {
            uid,
            displayName:
              (typeof data.displayName === "string" && data.displayName) ||
              (typeof data.handle === "string" && data.handle) ||
              "",
            handle: typeof data.handle === "string" ? data.handle : null,
            photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
          },
        });
      })
      .catch(() => {
        if (!cancelled) setState({ profile: undefined, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Derivado en vez de reseteado dentro del efecto: sin uid no hay perfil, y así
  // no queda visible el sobrante de un uid anterior.
  return {
    profile: uid ? state.profile : undefined,
    loading: uid ? state.loading : false,
  };
}
