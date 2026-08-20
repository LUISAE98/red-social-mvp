"use client";

// Las muestras que un creador ya grabó, en vivo.
//
// ⚠️ La consulta fija creatorId, type y scopeKey con `==`. La regla de
// `greetingSamples` exige ser el dueño, y en un `list` de Firestore la regla se
// evalúa documento a documento: si la consulta pudiera devolver algo ajeno, se
// deniega ENTERA, no solo ese documento. Fijar el dueño en la consulta es lo que
// hace que la suscripción no muera.

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Tope por servicio. Debe coincidir con MAX_SAMPLES_PER_SERVICE del backend. */
export const MAX_GREETING_SAMPLES = 3;

export type GreetingSample = {
  id: string;
  type: "saludo" | "consejo";
  context: string | null;
  toName: string | null;
  muxPlaybackId: string | null;
  status: string;
  createdAt: number | null;
};

/** Fotograma de portada que sirve Mux. Sin playbackId todavía no hay video. */
export function sampleThumbnail(sample: GreetingSample): string | null {
  if (!sample.muxPlaybackId) return null;
  return `https://image.mux.com/${sample.muxPlaybackId}/thumbnail.jpg?time=0&width=200`;
}

export function useGreetingSamples({
  creatorId,
  type,
  groupId = null,
  enabled = true,
}: {
  creatorId: string | null | undefined;
  type: "saludo" | "consejo";
  /** null para el perfil; el id de la comunidad cuando la muestra es de ahí. */
  groupId?: string | null;
  enabled?: boolean;
}): { samples: GreetingSample[]; loading: boolean } {
  const [samples, setSamples] = useState<GreetingSample[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || !creatorId) {
      return;
    }

    const scopeKey = groupId ?? creatorId;
    const q = query(
      collection(db, "greetingSamples"),
      where("creatorId", "==", creatorId),
      where("type", "==", type),
      where("scopeKey", "==", scopeKey),
      where("isDeleted", "==", false),
    );

    return onSnapshot(
      q,
      (snap) => {
        const out: GreetingSample[] = snap.docs.map((d) => {
          const g = d.data();
          const created = g.createdAt as { toMillis?: () => number } | undefined;
          return {
            id: d.id,
            type: g.type === "consejo" ? "consejo" : "saludo",
            context: typeof g.context === "string" ? g.context : null,
            toName: typeof g.toName === "string" ? g.toName : null,
            muxPlaybackId: typeof g.muxPlaybackId === "string" ? g.muxPlaybackId : null,
            status: typeof g.status === "string" ? g.status : "uploading",
            createdAt: typeof created?.toMillis === "function" ? created.toMillis() : null,
          };
        });
        // Las más nuevas primero: es el orden en que el creador las reconoce.
        out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        setSamples(out);
        setLoading(false);
      },
      (err) => {
        console.error("[useGreetingSamples]", err);
        setLoading(false);
      },
    );
  }, [creatorId, type, groupId, enabled]);

  return { samples, loading };
}
