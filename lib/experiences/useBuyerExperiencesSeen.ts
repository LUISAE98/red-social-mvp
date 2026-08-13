"use client";

// "Visto" del COMPRADOR por categoría (Pendientes / Rechazados / Entregados).
// Guarda un timestamp por categoría: se compara contra la última actividad de esa
// categoría para decidir si hay algo NUEVO.
//
// Se persiste en Firestore (`users/{uid}/meta/buyerExperiences`) como fuente de
// verdad, igual que el `seenAt` de notificaciones: viviendo solo en localStorage,
// el punto rojo de la estrella reaparecía en cada navegador o dispositivo nuevo
// aunque ya lo hubieras visto. localStorage queda como caché instantánea y como
// pub/sub —junto al evento `storage`— para que el badge de la estrella (layout) y
// los del subnav (página) se sincronicen al instante.

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ExpCategory = "requested" | "rejected" | "delivered";
export type SeenMap = Record<ExpCategory, number>;

const PREFIX = "vibra:buyerExpSeen:";
const listeners = new Set<() => void>();
const EMPTY: SeenMap = { requested: 0, rejected: 0, delivered: 0 };
const CATEGORIES: ExpCategory[] = ["requested", "rejected", "delivered"];

function keyFor(uid: string): string {
  return PREFIX + uid;
}

function toMap(raw: Partial<Record<ExpCategory, unknown>> | null | undefined): SeenMap {
  return {
    requested: Number(raw?.requested) || 0,
    rejected: Number(raw?.rejected) || 0,
    delivered: Number(raw?.delivered) || 0,
  };
}

/** Fusiona dos "vistos" quedándose con el mayor de cada categoría (nunca retrocede). */
function mergeMax(a: SeenMap, b: SeenMap): SeenMap {
  return {
    requested: Math.max(a.requested, b.requested),
    rejected: Math.max(a.rejected, b.rejected),
    delivered: Math.max(a.delivered, b.delivered),
  };
}

function sameMap(a: SeenMap, b: SeenMap): boolean {
  return CATEGORIES.every((c) => a[c] === b[c]);
}

function readSeen(uid: string | null | undefined): SeenMap {
  if (!uid || typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return EMPTY;
    return toMap(JSON.parse(raw) as Partial<Record<ExpCategory, unknown>>);
  } catch {
    return EMPTY;
  }
}

function writeSeen(uid: string, map: SeenMap): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(keyFor(uid), JSON.stringify(map));
  listeners.forEach((l) => l());
}

export function useBuyerExperiencesSeen(uid: string | null | undefined) {
  const [seen, setSeen] = useState<SeenMap>(EMPTY);

  useEffect(() => {
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(EMPTY);
      return;
    }
    setSeen(readSeen(uid));

    // Fuente de verdad remota: se queda el mayor de cada categoría.
    let alive = true;
    getDoc(doc(db, "users", uid, "meta", "buyerExperiences"))
      .then((snap) => {
        if (!alive || !snap.exists()) return;
        const remote = toMap(snap.data() as Partial<Record<ExpCategory, unknown>>);
        const merged = mergeMax(readSeen(uid), remote);
        setSeen((cur) => mergeMax(cur, remote));
        if (!sameMap(merged, readSeen(uid))) writeSeen(uid, merged);
      })
      .catch(() => {});

    const l = () => setSeen((cur) => mergeMax(cur, readSeen(uid)));
    listeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      alive = false;
      listeners.delete(l);
      window.removeEventListener("storage", l);
    };
  }, [uid]);

  // `latestMs` = timestamp de la ÚLTIMA actividad ya vista de esa categoría
  // (derivado del servidor: updatedAt/deliveredAt/createdAt). Se guarda ESE valor
  // —no `Date.now()` del cliente— porque el badge compara "visto" contra
  // timestamps de servidor: usar el reloj del cliente reencendía el punto por
  // desfase de reloj (o por un write async del webhook que bumpea `updatedAt`
  // justo después). Nunca retrocede (max con lo guardado).
  const persist = useCallback(
    (next: SeenMap) => {
      if (!uid) return;
      const merged = mergeMax(readSeen(uid), next);
      writeSeen(uid, merged);
      setDoc(doc(db, "users", uid, "meta", "buyerExperiences"), merged, { merge: true }).catch(
        () => {}
      );
    },
    [uid]
  );

  const markSeen = useCallback(
    (category: ExpCategory, latestMs?: number) => {
      if (!uid) return;
      persist({ ...EMPTY, [category]: latestMs ?? Date.now() });
    },
    [uid, persist]
  );

  /** Marca TODAS las categorías: abrir la pantalla es haber visto lo que había. */
  const markAllSeen = useCallback(
    (latest: Partial<SeenMap>) => {
      if (!uid) return;
      persist(toMap(latest));
    },
    [uid, persist]
  );

  return { seen, markSeen, markAllSeen };
}
