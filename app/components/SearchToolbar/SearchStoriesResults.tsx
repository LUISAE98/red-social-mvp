"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { searchStories } from "@/lib/stories/searchStories";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { recordStoryView } from "@/lib/stories/storyService";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import StoryViewer from "@/app/components/Stories/StoryViewer";
import HomeStoryCarouselDesktop, {
  type CarouselGroup,
} from "@/app/components/Stories/HomeStoryCarouselDesktop";

const MIN_STORY_SEARCH_LENGTH = 2;
const STORY_SEARCH_PAGE_SIZE = 40;

// Cuántos skeletons (rectángulos verticales) mientras carga la búsqueda.
const STORY_SKELETON_COUNT = 12;

// Aro morado de Vibra (mismo gradiente que StoryRingAvatar / preview de historias).
const VIBRA_STORY_RING =
  "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

// Cache module-level: sobrevive a desmontajes (cambios de pestaña) para no
// recargar los resultados ni los avatares. Se limpia solo al recargar la página.
const storiesResultCache = new Map<string, StoryDoc[]>();
const storyAvatarCache = new Map<string, string | null>();

export type StorySearchFilter = "all" | StoryType;

type SearchStoriesResultsProps = {
  search: string;
  filter: StorySearchFilter;
  indicatorTop?: string;
};

function storyThumbnail(story: StoryDoc): string | null {
  if (story.thumbnailUrl) return story.thumbnailUrl;
  if (story.muxPlaybackId) {
    return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  }
  return null;
}

// Creador mostrado = quien grabó el saludo/consejo (A), igual que creatorName.
function showcaseCreatorId(story: StoryDoc): string {
  return story.greetingCreatorId ?? story.creatorId;
}

function creatorInitials(name?: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Miniatura de la historia. Las grabadas horizontales se muestran con letterbox
// (contain); las verticales llenan (cover). En las horizontales, en vez de barras
// NEGRAS arriba/abajo, ponemos de fondo la MISMA portada escalada, muy desenfocada
// y aclarada → los márgenes toman el color predominante de la portada, difuminado.
// (Solo en la miniatura de búsqueda; dentro del visor de la historia sigue negro.)
function StoryThumb({ src }: { src: string }) {
  const [contain, setContain] = useState(false);
  return (
    <>
      {contain ? (
        <Image
          src={src}
          alt=""
          fill
          sizes="(max-width: 768px) 33vw, 160px"
          aria-hidden="true"
          style={{
            objectFit: "cover",
            transform: "scale(1.2)", // cubre los bordes que el blur deja translúcidos
            filter: "blur(24px) brightness(1.18) saturate(1.15)",
            zIndex: 0,
          }}
        />
      ) : null}
      <Image
        src={src}
        alt=""
        fill
        sizes="(max-width: 768px) 33vw, 160px"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalWidth > img.naturalHeight) {
            setContain(true);
          }
        }}
        style={{ objectFit: contain ? "contain" : "cover", zIndex: 1 }}
      />
    </>
  );
}

const HOVER_PREVIEW_DELAY_MS = 350;

type StoryCardProps = {
  story: StoryDoc;
  avatar: string | null | undefined;
  typeLabel: string;
  /** Solo laptop (pointer:fine) habilita el preview en hover. */
  enableHoverPreview: boolean;
  onOpen: (story: StoryDoc, rect: DOMRect | null) => void;
};

function StoryCard({
  story,
  avatar,
  typeLabel,
  enableHoverPreview,
  onOpen,
}: StoryCardProps) {
  const thumb = storyThumbnail(story);
  // Preview en hover (laptop): reproduce la historia en muted, con delay, sin
  // contar vista, en rendition baja de Mux. Una a la vez (solo la que tiene hover).
  const [showVideo, setShowVideo] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoContain, setVideoContain] = useState(false);
  const hoverTimer = useRef<number | null>(null);

  const canPreview = enableHoverPreview && !!story.muxPlaybackId;

  function handleEnter() {
    if (!canPreview) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setShowVideo(true), HOVER_PREVIEW_DELAY_MS);
  }

  function handleLeave() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setShowVideo(false);
    setVideoReady(false);
    setVideoContain(false);
  }

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  return (
    <>
    <style jsx>{`
      /* Aparición suave de la tarjeta al cargar los resultados. */
      .story-card {
        animation: storyCardIn 360ms ease both;
      }
      @keyframes storyCardIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .story-card { animation: none; }
      }
      /* Overlay (avatar + nombre + tipo). Laptop: oculto hasta hover.
         Celular: oculto (se ve al abrir la historia). */
      .story-overlay {
        position: absolute;
        top: 6px;
        left: 6px;
        right: 6px;
        opacity: 0;
        transition: opacity 0.16s ease;
        pointer-events: none;
      }
      .story-card:hover .story-overlay {
        opacity: 1;
      }
      @media (max-width: 768px) {
        .story-overlay {
          display: none;
        }
      }
    `}</style>
    <button
      type="button"
      className="story-card"
      onClick={(e) => onOpen(story, e.currentTarget.getBoundingClientRect())}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        position: "relative",
        aspectRatio: "9 / 16",
        borderRadius: 0,
        border: "none",
        overflow: "hidden",
        cursor: "pointer",
        padding: 0,
        background: thumb ? "#000" : "linear-gradient(160deg, #2a1a4a, #10101a)",
        fontFamily: "inherit",
      }}
    >
      {thumb ? <StoryThumb src={thumb} /> : null}

      {showVideo && story.muxPlaybackId ? (
        <video
          src={`https://stream.mux.com/${story.muxPlaybackId}/low.mp4`}
          muted
          autoPlay
          loop
          playsInline
          preload="none"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoWidth > v.videoHeight) setVideoContain(true);
          }}
          onPlaying={() => setVideoReady(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: videoContain ? "contain" : "cover",
            // El letterbox del preview deja ver el fondo difuminado de la portada
            // (transparente), igual que la miniatura. El video se revela solo cuando
            // ya reproduce (opacity) → sin parpadeo negro sobre la miniatura.
            background: "transparent",
            opacity: videoReady ? 1 : 0,
            transition: "opacity 0.2s ease",
            zIndex: 1,
          }}
        />
      ) : null}

      {/* Encabezado: avatar + (nombre arriba, tipo debajo).
          Laptop: oculto hasta hover. Celular: oculto (se ve al abrir). */}
      <div className="story-overlay" style={{ zIndex: 2 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            minWidth: 0,
          }}
        >
          {/* Avatar del creador con aro de Vibra (sin sombra, sin negro) */}
          <span
            style={{
              flexShrink: 0,
              width: 35,
              height: 35,
              borderRadius: "50%",
              background: VIBRA_STORY_RING,
              padding: 2.2,
              boxSizing: "border-box",
              display: "flex",
            }}
            aria-hidden="true"
          >
            <span
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                overflow: "hidden",
                background: "#2a1a4a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
              }}
            >
              {avatar ? (
                <Image
                  src={avatar}
                  alt={story.creatorName ?? ""}
                  fill
                  sizes="35px"
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, lineHeight: 1 }}>
                  {creatorInitials(story.creatorName)}
                </span>
              )}
            </span>
          </span>

          {/* Nombre arriba + tipo (saludo/consejo) debajo, más tenue */}
          <span
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              textAlign: "left",
              lineHeight: 1.15,
            }}
          >
            <span
              style={{
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {story.creatorName || ""}
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: "0.02em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {typeLabel}
            </span>
          </span>
        </div>
      </div>
    </button>
    </>
  );
}

export default function SearchStoriesResults({ search, filter, indicatorTop }: SearchStoriesResultsProps) {
  const tCommon = useTranslations("common");
  const { user } = useAuth();

  const [stories, setStories] = useState<StoryDoc[]>(
    () => storiesResultCache.get(search.trim()) ?? []
  );
  const [loading, setLoading] = useState(() => {
    const key = search.trim();
    return key.length >= MIN_STORY_SEARCH_LENGTH && !storiesResultCache.has(key);
  });
  // Avatar del creador por uid (no viene denormalizado en la historia).
  const [avatars, setAvatars] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(storyAvatarCache)
  );
  // Los skeletons se mantienen montados hasta que su fade-out termina.
  const [skeletonsMounted, setSkeletonsMounted] = useState(true);

  // Pull-to-refresh (móvil).
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [mobileRefreshEnabled, setMobileRefreshEnabled] = useState(false);
  const handleStoriesPullRefresh = useCallback(async () => {
    setRefreshNonce((prev) => prev + 1);
  }, []);

  // Visor: agrupamos por creador (como en home). Guardamos un snapshot de grupos
  // + el índice de grupo abierto. Escritorio = carrusel; celular = viewer que
  // cambia de contenedor con onGroupFinished/onPrevGroup.
  const [openGroups, setOpenGroups] = useState<CarouselGroup[] | null>(null);
  const [openGroupIdx, setOpenGroupIdx] = useState(0);
  const [sourceRect, setSourceRect] = useState<DOMRect | null>(null);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches
  );

  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => setMobileRefreshEnabled(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const normalizedSearch = useMemo(() => search.trim(), [search]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (normalizedSearch.length < MIN_STORY_SEARCH_LENGTH) {
        setStories([]);
        setLoading(false);
        return;
      }
      // Refresh manual (pull-to-refresh): invalida el cache de esta búsqueda.
      if (refreshNonce > 0) storiesResultCache.delete(normalizedSearch);
      const cached = storiesResultCache.get(normalizedSearch);
      if (cached) {
        setStories(cached);
        setLoading(false);
        return;
      }
      setLoading(true);
      const result = await searchStories({
        search: normalizedSearch,
        pageSize: STORY_SEARCH_PAGE_SIZE,
      });
      if (!active) return;
      storiesResultCache.set(normalizedSearch, result);
      setStories(result);
      setLoading(false);
    }

    run();
    return () => {
      active = false;
    };
  }, [normalizedSearch, refreshNonce]);

  // Carga los avatares de los creadores que aún no tenemos en caché.
  useEffect(() => {
    const missing = Array.from(
      new Set(stories.map(showcaseCreatorId))
    ).filter((uid) => uid && !(uid in avatars));
    if (missing.length === 0) return;

    let active = true;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            const photo = snap.data()?.photoURL;
            return [uid, typeof photo === "string" ? photo : null] as const;
          } catch {
            return [uid, null] as const;
          }
        })
      );
      if (!active) return;
      for (const [uid, photo] of entries) storyAvatarCache.set(uid, photo);
      setAvatars((prev) => {
        const next = { ...prev };
        for (const [uid, photo] of entries) next[uid] = photo;
        return next;
      });
    })();

    return () => {
      active = false;
    };
  }, [stories, avatars]);

  const filtered = useMemo(
    () => (filter === "all" ? stories : stories.filter((s) => s.type === filter)),
    [stories, filter]
  );

  // Al terminar la carga, los skeletons hacen fade-out y se desmontan.
  useEffect(() => {
    if (loading) {
      setSkeletonsMounted(true);
      return;
    }
    const t = window.setTimeout(() => setSkeletonsMounted(false), 480);
    return () => window.clearTimeout(t);
  }, [loading]);

  // Mientras carga: 12 skeletons. Ya cargado: los "sobrantes" (12 − resultados)
  // hacen fade-out y se desmontan.
  const trailingSkeletons = skeletonsMounted
    ? loading
      ? STORY_SKELETON_COUNT
      : Math.max(0, STORY_SKELETON_COUNT - filtered.length)
    : 0;

  // Agrupa los resultados por creador (mismo criterio que el card). El orden de
  // grupos sigue la grilla (primera aparición); dentro del grupo, por fecha asc.
  const groups: CarouselGroup[] = useMemo(() => {
    const byKey = new Map<string, StoryDoc[]>();
    const order: string[] = [];
    for (const s of filtered) {
      const key = showcaseCreatorId(s);
      if (!byKey.has(key)) {
        byKey.set(key, []);
        order.push(key);
      }
      byKey.get(key)!.push(s);
    }
    return order.map((key) => {
      const list = [...byKey.get(key)!].sort(
        (a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0)
      );
      const first = list[0];
      return {
        key,
        stories: list,
        startIndex: 0,
        thumbnailUrl: first ? storyThumbnail(first) : null,
        info: {
          displayName: first?.creatorName ?? null,
          photoURL: avatars[key] ?? null,
        },
      };
    });
  }, [filtered, avatars]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      if (user?.uid) recordStoryView(user.uid, storyId).catch(() => {});
    },
    [user]
  );

  const closeViewer = useCallback(() => {
    setOpenGroups(null);
    setSourceRect(null);
  }, []);

  // Abre el visor en el grupo del creador. La historia tocada queda PRIMERA y
  // las demás detrás en su orden original (sin repetir la que movimos al frente).
  const openStory = useCallback(
    (story: StoryDoc, rect: DOMRect | null) => {
      const key = showcaseCreatorId(story);
      const groupIdx = groups.findIndex((g) => g.key === key);
      if (groupIdx < 0) return;
      const snapshot = groups.map((g, i) => {
        if (i !== groupIdx) return g;
        const rest = g.stories.filter((s) => s.id !== story.id);
        return { ...g, stories: [story, ...rest], startIndex: 0 };
      });
      setOpenGroups(snapshot);
      setOpenGroupIdx(groupIdx);
      setSourceRect(isDesktop ? null : rect);
    },
    [groups, isDesktop]
  );

  // Celular: avanzar/retroceder de contenedor (creador a creador).
  const handleMobileNext = useCallback(() => {
    setOpenGroupIdx((i) => {
      if (openGroups && i < openGroups.length - 1) return i + 1;
      closeViewer();
      return i;
    });
  }, [openGroups, closeViewer]);

  const handleMobilePrev = useCallback(() => {
    setOpenGroupIdx((i) => (i > 0 ? i - 1 : i));
  }, []);

  const shellStyle: CSSProperties = {
    width: "100%",
    maxWidth: 720,
    minWidth: 0,
    margin: "6px auto 18px",
    display: "grid",
    gap: 14,
  };

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "15px 16px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.45,
  };

  // Sin resultados: solo texto, centrado en la pantalla, sin contenedor.
  const noResultsStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    minHeight: "45vh",
    padding: "0 24px",
    color: "rgba(255,255,255,0.55)",
    fontSize: 15,
    lineHeight: 1.5,
  };


  if (normalizedSearch.length < MIN_STORY_SEARCH_LENGTH) {
    return (
      <section style={shellStyle}>
        <div style={emptyStyle}>{tCommon("writeToSearch")}</div>
      </section>
    );
  }

  const showResults = !loading && filtered.length > 0;
  const isEmpty = !loading && filtered.length === 0;

  return (
    <>
    <RefreshableArea
      onRefresh={handleStoriesPullRefresh}
      enabled={mobileRefreshEnabled}
      indicatorTop={indicatorTop ?? "calc(env(safe-area-inset-top) + 116px)"}
    >
    <section style={shellStyle}>
      <div>
          {isEmpty && !skeletonsMounted ? (
            <div style={noResultsStyle}>{tCommon("noExactMatches")}</div>
          ) : (
            <div className="stories-search-grid">
              {showResults &&
                filtered.map((story) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    avatar={avatars[showcaseCreatorId(story)]}
                    enableHoverPreview={isDesktop}
                    typeLabel={
                      story.type === "consejo"
                        ? tCommon("storyTypeConsejo")
                        : tCommon("storyTypeSaludo")
                    }
                    onOpen={openStory}
                  />
                ))}

              {/* Skeletons verticales: 12 mientras carga; los sobrantes se
                  desvanecen al terminar. */}
              {Array.from({ length: trailingSkeletons }).map((_, i) => (
                <div
                  key={`story-skel-${i}`}
                  className="vb-skel story-skel"
                  style={{ opacity: loading ? 1 : 0 }}
                  aria-hidden="true"
                />
              ))}
            </div>
          )}
      </div>

      <style jsx>{`
        /* Estilo "mantel": historias juntas, solo un micromargen transparente
           y esquinas cuadradas. */
        .stories-search-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
          gap: 1.6px;
          max-width: 100%;
        }
        /* En celular: exactamente 3 historias por fila. minmax(0,1fr) evita
           que las columnas se desborden a la derecha (blowout de grid en iOS). */
        @media (max-width: 768px) {
          .stories-search-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        /* Skeleton = rectángulo vertical (mismo ratio que las historias). */
        .story-skel {
          aspect-ratio: 9 / 16;
          width: 100%;
          transition: opacity 420ms ease;
        }
        .vb-skel {
          background: linear-gradient(
            100deg,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(255, 255, 255, 0.11) 50%,
            rgba(255, 255, 255, 0.05) 70%
          );
          background-size: 300% 100%;
          animation: vbSkelWave 1.6s ease-in-out infinite;
        }
        @keyframes vbSkelWave {
          0% { background-position: 180% 0; }
          100% { background-position: -80% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-skel { animation: none; background: rgba(255, 255, 255, 0.07); }
        }
      `}</style>
    </section>
    </RefreshableArea>

      {openGroups && openGroups[openGroupIdx] ? (
        isDesktop ? (
          <HomeStoryCarouselDesktop
            groups={openGroups}
            initialGroupIndex={openGroupIdx}
            onClose={closeViewer}
            onStoryViewed={handleStoryViewed}
          />
        ) : (
          <StoryViewer
            key={openGroups[openGroupIdx].key}
            stories={openGroups[openGroupIdx].stories}
            initialIndex={openGroups[openGroupIdx].startIndex}
            onClose={closeViewer}
            onGroupFinished={handleMobileNext}
            onPrevGroup={handleMobilePrev}
            onStoryViewed={handleStoryViewed}
            sourceRect={sourceRect}
          />
        )
      ) : null}
    </>
  );
}
