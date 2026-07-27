"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Visto" de la pestaña Experiencias (análogo al `seenAt` de notificaciones,
 * pero por dispositivo vía localStorage). Sirve para saber si hay experiencias
 * NUEVAS desde la última vez que el creador vio la pestaña —decide la pestaña por
 * defecto al abrir notificaciones (prioridad a Experiencias)—.
 */
const PREFIX = "vibra:expSeenAt:";
const listeners = new Set<() => void>();

function keyFor(uid: string): string {
  return PREFIX + uid;
}

function readSeenAt(uid: string | null | undefined): number {
  if (!uid || typeof window === "undefined") return 0;
  return Number(window.localStorage.getItem(keyFor(uid))) || 0;
}

function writeSeenAt(uid: string, ms: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(keyFor(uid), String(ms));
  listeners.forEach((l) => l());
}

export function useExperiencesSeen(uid: string | null | undefined) {
  const [seenAt, setSeenAt] = useState(0);

  useEffect(() => {
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeenAt(0);
      return;
    }
    setSeenAt(readSeenAt(uid));
    const l = () => setSeenAt(readSeenAt(uid));
    listeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      listeners.delete(l);
      window.removeEventListener("storage", l);
    };
  }, [uid]);

  const markSeen = useCallback(() => {
    if (!uid) return;
    writeSeenAt(uid, Date.now());
  }, [uid]);

  return { seenAt, markSeen };
}
