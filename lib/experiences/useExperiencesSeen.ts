"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * "Visto" de la pestaña Experiencias del vendedor (análogo al `seenAt` de
 * notificaciones). Sirve para saber si hay experiencias NUEVAS desde la última vez
 * que el creador vio la pestaña —decide la pestaña por defecto al abrir
 * notificaciones (prioridad a Experiencias)—.
 *
 * Se persiste en Firestore (`users/{uid}/meta/experiences.seenAt`) como fuente de
 * verdad, igual que el `seenAt` social: si viviera solo en localStorage, el punto
 * rojo reaparecía en cada navegador o dispositivo nuevo aunque ya lo hubieras
 * visto. localStorage queda como caché instantánea y como pub/sub entre la
 * campanita y el nav móvil dentro de la misma pestaña.
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

    // Fuente de verdad remota: se queda el mayor entre caché y servidor.
    let alive = true;
    getDoc(doc(db, "users", uid, "meta", "experiences"))
      .then((snap) => {
        if (!alive) return;
        const remote = snap.exists() ? Number(snap.get("seenAt")) || 0 : 0;
        if (remote > 0) {
          setSeenAt((cur) => Math.max(cur, remote));
          if (remote > readSeenAt(uid)) writeSeenAt(uid, remote);
        }
      })
      .catch(() => {});

    const l = () => setSeenAt((cur) => Math.max(cur, readSeenAt(uid)));
    listeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      alive = false;
      listeners.delete(l);
      window.removeEventListener("storage", l);
    };
  }, [uid]);

  // `latestMs` = timestamp (de servidor) de la experiencia pendiente más reciente
  // ya vista. Se guarda ESE valor, no `Date.now()` del cliente: el badge compara
  // "visto" contra timestamps de servidor y el reloj del cliente reencendía/
  // descontaba mal por desfase. Nunca retrocede.
  const markSeen = useCallback(
    (latestMs?: number) => {
      if (!uid) return;
      const ms = Math.max(readSeenAt(uid), latestMs ?? Date.now());
      writeSeenAt(uid, ms);
      setDoc(doc(db, "users", uid, "meta", "experiences"), { seenAt: ms }, { merge: true }).catch(
        () => {}
      );
    },
    [uid]
  );

  return { seenAt, markSeen };
}
