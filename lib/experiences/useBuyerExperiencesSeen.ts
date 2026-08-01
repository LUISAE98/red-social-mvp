"use client";

// "Visto" del COMPRADOR por categoría (Pendientes / Rechazados / Entregados),
// por dispositivo vía localStorage. Guarda un timestamp por categoría: se compara
// contra la última actividad de esa categoría para decidir si hay algo NUEVO.
//
// Comparte un set de listeners + el evento `storage` para que el badge de la
// estrella (layout) y los badges del subnav (página) se sincronicen al instante.

import { useCallback, useEffect, useState } from "react";

export type ExpCategory = "requested" | "rejected" | "delivered";
export type SeenMap = Record<ExpCategory, number>;

const PREFIX = "vibra:buyerExpSeen:";
const listeners = new Set<() => void>();
const EMPTY: SeenMap = { requested: 0, rejected: 0, delivered: 0 };

function keyFor(uid: string): string {
  return PREFIX + uid;
}

function readSeen(uid: string | null | undefined): SeenMap {
  if (!uid || typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<Record<ExpCategory, unknown>>;
    return {
      requested: Number(p.requested) || 0,
      rejected: Number(p.rejected) || 0,
      delivered: Number(p.delivered) || 0,
    };
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
    const l = () => setSeen(readSeen(uid));
    listeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      listeners.delete(l);
      window.removeEventListener("storage", l);
    };
  }, [uid]);

  // Marca una categoría como vista. `latestMs` = timestamp de la ÚLTIMA actividad
  // ya vista de esa categoría (derivado del servidor: updatedAt/deliveredAt/
  // createdAt). Se guarda ESE valor —no `Date.now()` del cliente— porque el badge
  // compara "visto" contra timestamps de servidor: usar el reloj del cliente
  // reencendía el punto por desfase de reloj (o por un write async del webhook
  // que bumpea `updatedAt` justo después). Nunca retrocede (max con lo guardado).
  const markSeen = useCallback(
    (category: ExpCategory, latestMs?: number) => {
      if (!uid) return;
      const cur = readSeen(uid);
      const value = Math.max(cur[category] ?? 0, latestMs ?? Date.now());
      writeSeen(uid, { ...cur, [category]: value });
    },
    [uid]
  );

  return { seen, markSeen };
}
