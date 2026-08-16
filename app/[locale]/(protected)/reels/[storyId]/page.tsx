"use client";

// Enlace directo a UNA historia dentro del feed.
//
// No es un visor aparte: es el mismo feed, abierto en esa historia. Así, quien
// llega desde un enlace compartido puede seguir scrolleando y cae en el reel
// normal, en vez de quedarse en una pantalla muerta con un solo video.
//
// Es también el prerrequisito de Vibra Express, que necesita poder abrir una
// historia concreta desde fuera de la app.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { useScreenReady } from "@/lib/useScreenReady";
import { recordStoryView } from "@/lib/stories/storyService";
import { useReelFeed } from "@/lib/reels/useReelFeed";
import { dedupeStories, storyVideoKey } from "@/lib/reels/reelStories";
import type { StoryDoc } from "@/lib/stories/types";
import ReelFeed from "@/components/reels/ReelFeed";

const NAV_CLEARANCE = "calc(70px + var(--vb-safe-bottom, 0px))";

const fullScreenCenter: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  bottom: NAV_CLEARANCE,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: 32,
  background: "#000",
};

export default function ReelStoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ storyId: string }>();
  const storyId = typeof params?.storyId === "string" ? params.storyId : "";
  const tCommon = useTranslations("common");

  const { stories, ready, loadMore, recordEngagement } = useReelFeed(user?.uid);
  // `undefined` = todavía buscando; `null` = no existe o no se puede leer.
  const [target, setTarget] = useState<StoryDoc | null | undefined>(undefined);

  useScreenReady(ready && target !== undefined);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=%2Freels%2F${encodeURIComponent(storyId)}`);
  }, [loading, user, router, storyId]);

  useEffect(() => {
    // Sin id no hay nada que buscar. No se toca el estado aquí: se deduce abajo,
    // para no encadenar un render de más.
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

  const handleStoryViewed = useCallback(
    (id: string) => {
      const uid = user?.uid;
      if (!uid || user?.isAnonymous) return;
      void recordStoryView(uid, id).catch(() => {});
    },
    [user?.uid, user?.isAnonymous],
  );

  if (!user) return null;

  const waiting = (!!storyId && target === undefined) || !ready;

  if (waiting) {
    return (
      <div style={fullScreenCenter}>
        <style>{`@keyframes reelSpinner { to { transform: rotate(360deg); } }`}</style>
        <div
          aria-label={tCommon("loading")}
          role="status"
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.12)",
            borderTopColor: "#a855f7",
            animation: "reelSpinner 0.8s linear infinite",
          }}
        />
      </div>
    );
  }

  // La historia va DELANTE y el resto del feed detrás, quitando la copia que ya
  // esté en la lista para que no salga dos veces.
  const feed = target
    ? dedupeStories([
        target,
        ...stories.filter((s) => storyVideoKey(s) !== storyVideoKey(target)),
      ])
    : stories;

  if (feed.length === 0) {
    return (
      <div style={fullScreenCenter}>
        <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, textAlign: "center" }}>
          {tCommon("noStoriesYet")}
        </span>
      </div>
    );
  }

  return (
    <ReelFeed
      stories={feed}
      onLoadMore={loadMore}
      onStoryViewed={handleStoryViewed}
      onEngagement={recordEngagement}
      safeBottom={NAV_CLEARANCE}
    />
  );
}
