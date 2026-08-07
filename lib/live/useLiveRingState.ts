"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type LiveRingState = {
  isLive: boolean;
  livePostId: string | null;
};

const INITIAL: LiveRingState = { isLive: false, livePostId: null };

export function useLiveRingState(
  entityId: string | null | undefined,
  entityType: "profile" | "group"
): LiveRingState {
  const [state, setState] = useState<LiveRingState>(INITIAL);

  useEffect(() => {
    if (!entityId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(INITIAL);
      return;
    }
    const collectionName = entityType === "profile" ? "users" : "groups";
    let cancelled = false;
    const unsub = onSnapshot(doc(db, collectionName, entityId), async (snap) => {
      if (!snap.exists()) { setState(INITIAL); return; }
      const raw = snap.data().activeLivePostId;
      const livePostId = typeof raw === "string" && raw ? raw : null;
      if (!livePostId) { setState(INITIAL); return; }
      // El aro SOLO se muestra si el viewer puede LEER el post del live. Las Firestore
      // Rules bloquean los lives restringidos (logged_in_only / members_only) a los
      // invitados, así que un `getDoc` que falla = live no visible para este viewer =
      // sin aro. Así el indicador respeta el mismo permiso que el contenido.
      try {
        const postSnap = await getDoc(doc(db, "posts", livePostId));
        if (cancelled) return;
        setState(postSnap.exists() ? { isLive: true, livePostId } : INITIAL);
      } catch {
        if (!cancelled) setState(INITIAL);
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [entityId, entityType]);

  return state;
}
