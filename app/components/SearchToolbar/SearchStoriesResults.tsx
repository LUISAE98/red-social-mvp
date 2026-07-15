"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { searchStories } from "@/lib/stories/searchStories";
import { recordStoryView } from "@/lib/stories/storyService";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import StoryViewer from "@/app/components/Stories/StoryViewer";
import HomeStoryCarouselDesktop, {
  type CarouselGroup,
} from "@/app/components/Stories/HomeStoryCarouselDesktop";

const MIN_STORY_SEARCH_LENGTH = 2;
const STORY_SEARCH_PAGE_SIZE = 40;

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

export default function SearchStoriesResults({ search, filter }: SearchStoriesResultsProps) {
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

  const normalizedSearch = useMemo(() => search.trim(), [search]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (normalizedSearch.length < MIN_STORY_SEARCH_LENGTH) {
        setStories([]);
        setLoading(false);
        return;
      }
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
  }, [normalizedSearch]);

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
    [user?.uid]
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

  if (loading) {
    return (
      <section style={shellStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "30vh",
          }}
        >
          <div className="vibraPullRefreshSpinner refreshing" style={{ width: 32, height: 32 }} />
        </div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      <div>
          {filtered.length === 0 ? (
            <div style={noResultsStyle}>{tCommon("noExactMatches")}</div>
          ) : (
            <div className="stories-search-grid">
              {filtered.map((story) => {
                const thumb = storyThumbnail(story);
                const avatar = avatars[showcaseCreatorId(story)];
                return (
                  <button
                    key={story.id}
                    type="button"
                    onClick={(e) => openStory(story, e.currentTarget.getBoundingClientRect())}
                    style={{
                      position: "relative",
                      aspectRatio: "9 / 16",
                      borderRadius: 14,
                      border: "none",
                      overflow: "hidden",
                      cursor: "pointer",
                      padding: 0,
                      background: thumb
                        ? `center / cover no-repeat url(${thumb})`
                        : "linear-gradient(160deg, #2a1a4a, #10101a)",
                      fontFamily: "inherit",
                    }}
                  >
                    {/* Avatar del creador con aro de Vibra (sin sombra, sin negro) */}
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: VIBRA_STORY_RING,
                        padding: 2,
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
                            sizes="32px"
                            style={{ objectFit: "cover" }}
                          />
                        ) : (
                          <span
                            style={{
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 600,
                              lineHeight: 1,
                            }}
                          >
                            {creatorInitials(story.creatorName)}
                          </span>
                        )}
                      </span>
                    </span>

                    {/* Tipo (saludo/consejo) a un costado, solo texto blanco */}
                    <span
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.02em",
                        lineHeight: 1.3,
                      }}
                    >
                      {story.type === "consejo"
                        ? tCommon("storyTypeConsejo")
                        : tCommon("storyTypeSaludo")}
                    </span>

                    {/* Nombre del creador (abajo), solo texto */}
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        padding: "0 8px 7px",
                        color: "#fff",
                        fontSize: 11.5,
                        fontWeight: 600,
                        textAlign: "left",
                        lineHeight: 1.2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {story.creatorName || ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
      </div>

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

      <style jsx>{`
        .stories-search-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
          gap: 10px;
          max-width: 100%;
        }
        /* En celular: exactamente 3 historias por fila. minmax(0,1fr) evita
           que las columnas se desborden a la derecha (blowout de grid en iOS). */
        @media (max-width: 768px) {
          .stories-search-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
      `}</style>
    </section>
  );
}
