"use client";

// Enlace directo a UNA historia dentro del feed.
//
// No es un visor aparte: es el mismo feed, abierto en esa historia. Así, quien
// llega desde un enlace compartido puede seguir viendo el resto en vez de
// quedarse en una pantalla muerta con un solo video. Y se abre en la forma que
// corresponda al dispositivo, reel en celular y carrusel en escritorio, de lo
// que se encarga `ReelsSurface`.
//
// Es también el prerrequisito de Vibra Express, que necesita poder abrir una
// historia concreta desde fuera de la app.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { useScreenReady } from "@/lib/useScreenReady";
import { useReelFeed } from "@/lib/reels/useReelFeed";
import { dedupeStories, storyVideoKey } from "@/lib/reels/reelStories";
import type { StoryDoc } from "@/lib/stories/types";
import ReelsSurface from "@/components/reels/ReelsSurface";

export default function ReelStoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ storyId: string }>();
  const storyId = typeof params?.storyId === "string" ? params.storyId : "";

  const { stories, ready, loadMore, recordEngagement } = useReelFeed(user?.uid);
  // `undefined` = todavía buscando; `null` = no existe o no se puede leer.
  const [target, setTarget] = useState<StoryDoc | null | undefined>(undefined);

  const resolved = !storyId || target !== undefined;
  useScreenReady(ready && resolved);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=%2Freels%2F${encodeURIComponent(storyId)}`);
  }, [loading, user, router, storyId]);

  useEffect(() => {
    if (!storyId) return;
    let cancelled = false;
    getDoc(doc(db, "stories", storyId))
      .then((snap) => {
        if (cancelled) return;
        // Las reglas ya deciden si esta persona puede leerla. Una historia de
        // comunidad privada simplemente no llega, y aquí se trata como ausente.
        setTarget(snap.exists() ? ({ id: snap.id, ...snap.data() } as StoryDoc) : null);
      })
      .catch(() => {
        if (!cancelled) setTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  // La historia va DELANTE y el resto del feed detrás, quitando la copia que ya
  // esté en la lista para que no salga dos veces.
  const feed = useMemo(
    () =>
      target
        ? dedupeStories([
            target,
            ...stories.filter((s) => storyVideoKey(s) !== storyVideoKey(target)),
          ])
        : stories,
    [target, stories],
  );

  if (!user) return null;

  return (
    <ReelsSurface
      uid={user.uid}
      isAnonymous={!!user.isAnonymous}
      stories={feed}
      ready={ready && resolved}
      loadMore={loadMore}
      recordEngagement={recordEngagement}
      closeHref="/reels"
    />
  );
}
