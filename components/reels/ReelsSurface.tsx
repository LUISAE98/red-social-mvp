"use client";

// El feed de historias, en la forma que toque según el dispositivo.
//
// En CELULAR es el reel a pantalla completa, con scroll vertical anclado.
// En ESCRITORIO es el carrusel centrado de siempre, el mismo que abre el rail
// del home. Un enlace compartido tiene que abrirse en la forma que corresponda a
// donde se abre, no en la del móvil siempre.
//
// Las dos rutas del feed (`/reels` y `/reels/[storyId]`) montan esto, así que la
// decisión vive en un solo sitio y no puede quedarse a medias en una de ellas.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc } from "@/lib/stories/types";
import { recordStoryView } from "@/lib/stories/storyService";
import { useReelFeed } from "@/lib/reels/useReelFeed";
import HomeStoryCarouselDesktop, {
  type CarouselGroup,
} from "@/app/components/Stories/HomeStoryCarouselDesktop";
import ReelFeed from "./ReelFeed";

/** Alto del nav inferior, para que el reel acabe justo encima. */
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

function resolveThumb(story: StoryDoc): string | null {
  if (story.muxPlaybackId) return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  return story.thumbnailUrl ?? null;
}

/** Quien GRABÓ el video, que es la cara que siempre se muestra. */
function authorOf(story: StoryDoc): string | null {
  return story.greetingCreatorId ?? story.creatorId ?? null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type Props = {
  uid: string;
  isAnonymous: boolean;
  /** Historias ya ordenadas. Si viene una destacada, va primera. */
  stories: StoryDoc[];
  ready: boolean;
  loadMore: () => void;
  recordEngagement: ReturnType<typeof useReelFeed>["recordEngagement"];
  /** A dónde volver al cerrar el carrusel de escritorio. */
  closeHref?: string;
};

export default function ReelsSurface({
  uid,
  isAnonymous,
  stories,
  ready,
  loadMore,
  recordEngagement,
  closeHref = "/",
}: Props) {
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // El servidor no sabe si el puntero es fino, así que la decisión se toma tras
  // montar. Mismo criterio que usa el rail del home para elegir carrusel o reel.
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  // Fotos de los creadores, solo para las vistas previas laterales del carrusel.
  // En celular no se usan, así que ni se piden.
  const [photos, setPhotos] = useState<Map<string, string | null>>(new Map());
  const authorIds = useMemo(
    () => [...new Set(stories.map(authorOf).filter((id): id is string => !!id))],
    [stories],
  );

  useEffect(() => {
    if (!isDesktop || authorIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const found = new Map<string, string | null>();
      for (const batch of chunk(authorIds, 30)) {
        try {
          const snap = await getDocs(
            query(collection(db, "users"), where(documentId(), "in", batch)),
          );
          for (const d of snap.docs) {
            const url = d.data().photoURL;
            found.set(d.id, typeof url === "string" ? url : null);
          }
        } catch {
          // Sin foto se ve el marcador gris, que es peor pero no rompe nada.
        }
      }
      if (!cancelled && found.size > 0) setPhotos(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesktop, authorIds]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      // Las reglas de `userStoryViews` exigen cuenta real.
      if (!uid || isAnonymous) return;
      void recordStoryView(uid, storyId).catch(() => {});
    },
    [uid, isAnonymous],
  );

  // Cada historia es su propio panel del carrusel, igual que en el rail. Así el
  // carrusel se mueve historia a historia y no creador a creador.
  const carouselGroups: CarouselGroup[] = useMemo(
    () =>
      stories.map((story) => ({
        key: story.id,
        stories: [story],
        startIndex: 0,
        thumbnailUrl: resolveThumb(story),
        info: {
          // `creatorName` se denormaliza al publicar con el nombre de quien
          // GRABÓ, así que ya es la cara correcta sin pedir nada.
          displayName: story.creatorName ?? null,
          photoURL: photos.get(authorOf(story) ?? "") ?? null,
        },
      })),
    [stories, photos],
  );

  if (!mounted || !ready) {
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

  if (stories.length === 0) {
    return (
      <div style={fullScreenCenter}>
        <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, textAlign: "center" }}>
          {tCommon("noStoriesYet")}
        </span>
      </div>
    );
  }

  if (isDesktop) {
    return (
      <HomeStoryCarouselDesktop
        groups={carouselGroups}
        // La destacada ya viene primera en la lista.
        initialGroupIndex={0}
        onClose={() => router.push(closeHref)}
        onStoryViewed={handleStoryViewed}
      />
    );
  }

  return (
    <ReelFeed
      stories={stories}
      onLoadMore={loadMore}
      onStoryViewed={handleStoryViewed}
      onEngagement={recordEngagement}
      safeBottom={NAV_CLEARANCE}
    />
  );
}
