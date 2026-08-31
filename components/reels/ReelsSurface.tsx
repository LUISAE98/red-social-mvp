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
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc } from "@/lib/stories/types";
import { recordStoryView } from "@/lib/stories/storyService";
import { markSeenLocally } from "@/lib/reels/reelSeenLocal";
import { useReelFeed } from "@/lib/reels/useReelFeed";
import HomeStoryCarouselDesktop, {
  type CarouselGroup,
} from "@/app/components/Stories/HomeStoryCarouselDesktop";
import type { ReelItem, ReelLivePost } from "@/lib/reels/reelItems";
import ReelFeed from "./ReelFeed";

// El visor completo del live, con chat y donaciones, pesa lo suyo. Se carga solo
// cuando alguien entra a un live, no por abrir el feed.
const LiveViewerModal = dynamic(
  () => import("@/app/components/LiveViewerModal/LiveViewerModal"),
  { ssr: false },
);

/** Alto del nav inferior. El reel NO se recorta con esto: solo aparta sus
 *  controles para que no queden debajo del nav. */
const NAV_CLEARANCE = "calc(70px + var(--vb-safe-bottom, 0px))";
/** Sin barra inferior no hay nada que esquivar. */
const NO_NAV_CLEARANCE = "0px";
/** Tope de autores cuyas fotos se piden. En un feed real son un punado. */
const MAX_AUTHOR_PHOTOS = 40;

const fullScreenCenter: React.CSSProperties = {
  position: "fixed",
  inset: 0,
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


type Props = {
  /** Quien mira. Vacio o nulo en Vibra Express, donde se entra sin cuenta. */
  uid: string | null;
  isAnonymous: boolean;
  /**
   * Historias y lives ya ordenados y mezclados. Si viene una destacada, va
   * primera.
   */
  items: ReelItem[];
  ready: boolean;
  loadMore: () => void;
  recordEngagement: ReturnType<typeof useReelFeed>["recordEngagement"];
  /** A dónde volver al cerrar el carrusel de escritorio. */
  closeHref?: string;
  /**
   * Hay barra inferior debajo del feed.
   *
   * En la app la hay y los controles del reel tienen que quedar por encima.
   * En Vibra Express no, asi que reservar ese hueco dejaria los botones
   * flotando a setenta pixeles del borde sin nada debajo.
   */
  hasBottomNav?: boolean;
};

export default function ReelsSurface({
  uid,
  isAnonymous,
  items,
  ready,
  loadMore,
  recordEngagement,
  closeHref = "/",
  hasBottomNav = true,
}: Props) {
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  // El live que se está viendo. El feed NO se desmonta debajo: al cerrar, el
  // usuario vuelve exactamente a donde iba, con su posición de scroll intacta.
  // Es la razón por la que el visor es un modal y no una ruta.
  const [openLive, setOpenLive] = useState<ReelLivePost | null>(null);

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
    () => [
      ...new Set(
        items
          .map((i) => (i.kind === "live" ? i.post.authorId : authorOf(i.story)))
          .filter((id): id is string => !!id),
      ),
    ],
    [items],
  );

  useEffect(() => {
    if (!isDesktop || authorIds.length === 0) return;
    let cancelled = false;
    (async () => {
      // ⚠️ De UNO EN UNO, no con `documentId() in`.
      //
      // Aquella consulta devolvia vacio y dejaba a las vistas previas sin foto,
      // con el fallo tragado en silencio. Es el mismo patron que ya ha dado
      // guerra antes en este repositorio. Leer el documento suelto es el camino
      // que el slide del centro usa y que demostradamente funciona.
      //
      // No es caro: los autores ya vienen sin repetir, y en un feed real son
      // unos pocos aunque haya decenas de historias.
      const found = new Map<string, string | null>();
      const results = await Promise.all(
        authorIds.slice(0, MAX_AUTHOR_PHOTOS).map(async (id) => {
          try {
            const snap = await getDoc(doc(db, "users", id));
            const url = snap.data()?.photoURL;
            return [id, typeof url === "string" ? url : null] as const;
          } catch (err) {
            console.error("[ReelsSurface] no se pudo leer la foto de", id, err);
            return [id, null] as const;
          }
        }),
      );
      for (const [id, url] of results) found.set(id, url);
      if (!cancelled) setPhotos(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesktop, authorIds]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      // Las reglas de `userStoryViews` exigen cuenta real. Quien no la tiene
      // lo recuerda en su navegador: no viaja entre aparatos, pero evita que
      // Vibra Express repita el mismo contenido en cada visita.
      if (!uid || isAnonymous) {
        markSeenLocally(storyId);
        return;
      }
      void recordStoryView(uid, storyId).catch(() => {});
    },
    [uid, isAnonymous],
  );

  // Cada historia es su propio panel del carrusel, igual que en el rail. Así el
  // carrusel se mueve historia a historia y no creador a creador.
  const carouselGroups: CarouselGroup[] = useMemo(
    () =>
      items.map((item) => {
        if (item.kind === "live") {
          const ld = item.post.liveData;
          return {
            key: item.key,
            // Un live no se recorre historia a historia: es uno solo.
            stories: [],
            startIndex: 0,
            thumbnailUrl: ld?.coverUrl ?? null,
            info: {
              displayName: null,
              photoURL: photos.get(item.post.authorId ?? "") ?? null,
            },
            live: item.post,
          };
        }
        const story = item.story;
        return {
          key: story.id,
          stories: [story],
          startIndex: 0,
          thumbnailUrl: resolveThumb(story),
          info: {
            // creatorName se denormaliza al publicar con el nombre de quien
            // GRABO, asi que ya es la cara correcta sin pedir nada.
            displayName: story.creatorName ?? null,
            photoURL: photos.get(authorOf(story) ?? "") ?? null,
          },
        };
      }),
    [items, photos],
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

  if (items.length === 0) {
    return (
      <div style={fullScreenCenter}>
        <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, textAlign: "center" }}>
          {tCommon("noReelsYet")}
        </span>
      </div>
    );
  }

  if (isDesktop) {
    return (
      <>
        <HomeStoryCarouselDesktop
          groups={carouselGroups}
          // La destacada ya viene primera en la lista.
          initialGroupIndex={0}
          onClose={() => router.push(closeHref)}
          onStoryViewed={handleStoryViewed}
          onOpenLive={setOpenLive}
          behind={!!openLive}
        />
        {openLive && (
          <LiveViewerModal
            open
            onClose={() => setOpenLive(null)}
            post={openLive}
            // Se sale con flecha, no con equis: el reel sigue montado debajo y
            // al salir se cae justo donde se iba.
            exitAs="back"
          />
        )}
      </>
    );
  }

  return (
    <>
      <ReelFeed
        items={items}
        onOpenLive={setOpenLive}
        onLoadMore={loadMore}
        onStoryViewed={handleStoryViewed}
        onEngagement={recordEngagement}
        navClearance={hasBottomNav ? NAV_CLEARANCE : NO_NAV_CLEARANCE}
      />
      {openLive && (
        <LiveViewerModal
            open
            onClose={() => setOpenLive(null)}
            post={openLive}
            // Se sale con flecha, no con equis: el reel sigue montado debajo y
            // al salir se cae justo donde se iba.
            exitAs="back"
          />
      )}
    </>
  );
}
