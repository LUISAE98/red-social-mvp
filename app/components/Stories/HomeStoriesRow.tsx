"use client";

// Rail de historias del home. SOLO ESCRITORIO.
//
// En celular este rail ya no existe: su contenido vive en la pestaña Historias
// del nav, a pantalla completa. Aquí queda la versión de escritorio.
//
// ⚠️ El modelo de datos es el MISMO que el del reel de celular: una lista PLANA,
// una tarjeta por historia, sin ventana temporal. Antes agrupaba por creador y
// descartaba lo visto hace más de 24h, y con eso las historias de pocos creadores
// colapsaban en una sola burbuja mientras el celular mostraba cinco. Las dos
// superficies tienen que enseñar lo mismo, así que comparten `lib/reels`.
//
// Las burbujas de EN VIVO sí siguen siendo cosa de este rail (los lives entran al
// feed en su propia fase) y conservan su aro redondo.

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  collection,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { recordStoryView } from "@/lib/stories/storyService";
import { useReelFeed } from "@/lib/reels/useReelFeed";
import type { StoryDoc } from "@/lib/stories/types";
import HomeStoryCarouselDesktop, { type CarouselGroup } from "./HomeStoryCarouselDesktop";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import { RAIL_CARD_W, RAIL_GAP } from "@/app/components/GroupRecommendations/GroupRecommendationsRail.parts";
import { useDragScroll } from "@/lib/hooks/useDragScroll";

// Las medidas se IMPORTAN del rail de recomendaciones en vez de copiarse. Los
// dos rails viven pegados en el home y tienen que leerse como el mismo sistema;
// con números duplicados, tocar uno los separa sin que nadie se entere.
/** Cuántas tarjetas deben caber como mínimo, en cualquier laptop. */
const MIN_VISIBLE = 4;
/** Tope de ancho: el del rail de recomendaciones. */
const CARD_MAX_W = RAIL_CARD_W;
/** Proporción de la tarjeta, tomada de las medidas de aquel rail (200×224). */
const CARD_RATIO = "200 / 224";

/**
 * Ancho responsivo. Reparte el espacio visible entre MIN_VISIBLE tarjetas y sus
 * separaciones, sin pasar del tope. En una pantalla ancha caben más de cuatro
 * porque el tope corta el crecimiento; en una estrecha, encogen para que sigan
 * cabiendo cuatro.
 */
const CARD_WIDTH = `min(${CARD_MAX_W}px, calc((100% - ${RAIL_GAP * (MIN_VISIBLE - 1)}px) / ${MIN_VISIBLE}))`;
/** Avatar del creador junto a su nombre, bajo la tarjeta. */
const AVATAR_SIZE = 16;

// ─── Caché a nivel de módulo, sobrevive a la navegación en la misma pestaña ───
type IdsEntry = { creatorIds: string[]; groupIds: string[]; cachedAt: number };
const idsCache = new Map<string, IdsEntry>();
const IDS_TTL_MS = 5 * 60 * 1000;

function peekIds(uid: string): IdsEntry | null {
  const e = idsCache.get(uid);
  if (!e || Date.now() - e.cachedAt > IDS_TTL_MS) return null;
  return e;
}

/**
 * Olvida a quién sigue el usuario. El feed en sí lo refresca `refreshReelFeed`,
 * que es lo que de verdad vuelve a pedir las historias.
 */
export function invalidateFollowedIdsCache(uid: string) {
  idsCache.delete(uid);
}

type DisplayInfo = {
  displayName: string | null;
  photoURL: string | null;
};

type LiveEntity = { entityId: string; entityType: "profile" | "group" };

type Props = {
  currentUserId: string;
};

const fontStack = "inherit";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Quien GRABÓ el video, que es la cara que siempre se muestra. */
function storyAuthorId(story: StoryDoc): string | null {
  return story.greetingCreatorId ?? story.creatorId ?? null;
}

function resolveThumb(story: StoryDoc): string | null {
  if (story.muxPlaybackId) return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  return story.thumbnailUrl ?? null;
}

export default function HomeStoriesRow({ currentUserId }: Props) {
  const tCommon = useTranslations("common");

  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  // Misma fuente, mismo orden y misma cuota que el reel de celular.
  const { stories, ready, loadMore } = useReelFeed(currentUserId);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dragScroll = useDragScroll(scrollerRef);

  // Pide más al acercarse al final del rail. En celular lo dispara el scroll
  // vertical del reel; aquí es el horizontal, pero la fuente es la misma.
  const handleRailScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
    if (remaining < CARD_MAX_W * 3) loadMore();
  }, [loadMore]);
  const [creatorIds, setCreatorIds] = useState<string[]>(
    () => peekIds(currentUserId)?.creatorIds ?? [],
  );
  const [groupIds, setGroupIds] = useState<string[]>(
    () => peekIds(currentUserId)?.groupIds ?? [],
  );
  const [profileLives, setProfileLives] = useState<Map<string, string>>(new Map());
  const [groupLives, setGroupLives] = useState<Map<string, string>>(new Map());
  const [displayInfoMap, setDisplayInfoMap] = useState<Map<string, DisplayInfo>>(new Map());
  const [openAt, setOpenAt] = useState<number | null>(null);

  const fetchedInfoKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // El servidor no sabe si el puntero es fino, así que la decisión se toma tras
  // montar y el render se gatea con `mounted` para no romper la hidratación.
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  // ── Ids de seguidos y comunidades, solo para los aros de en vivo ──────────
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const followingSnap = await getDocs(
          query(collection(db, "users", currentUserId, "following"), limit(200)),
        );
        const ids: string[] = followingSnap.docs.map(
          (d) => (d.data().targetUserId as string) ?? d.id,
        );
        if (!ids.includes(currentUserId)) ids.unshift(currentUserId);

        const membershipsSnap = await getDocs(
          collection(db, "users", currentUserId, "groupMemberships"),
        );
        const gids: string[] = membershipsSnap.docs
          .filter((d) => {
            const s = d.data().status as string;
            return s === "active" || s === "subscribed";
          })
          .map((d) => d.id)
          .slice(0, 30);

        if (cancelled) return;
        setCreatorIds(ids);
        setGroupIds(gids);
        idsCache.set(currentUserId, { creatorIds: ids, groupIds: gids, cachedAt: Date.now() });
      } catch (err) {
        console.error("[HomeStoriesRow] load ids", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  // ── En vivo: perfiles seguidos ────────────────────────────────────────────
  useEffect(() => {
    const others = creatorIds.filter((id) => id !== currentUserId);
    if (others.length === 0) return;
    const localMap = new Map<string, string>();
    const unsubs = chunk(others, 30).map((batch) =>
      onSnapshot(query(collection(db, "users"), where(documentId(), "in", batch)), (snap) => {
        for (const d of snap.docs) {
          const lid = d.data().activeLivePostId as string | undefined;
          if (lid) localMap.set(d.id, lid);
          else localMap.delete(d.id);
        }
        setProfileLives(new Map(localMap));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [creatorIds, currentUserId]);

  // ── En vivo: comunidades donde soy miembro ────────────────────────────────
  useEffect(() => {
    if (groupIds.length === 0) return;
    const localMap = new Map<string, string>();
    const unsubs = chunk(groupIds, 30).map((batch) =>
      onSnapshot(query(collection(db, "groups"), where(documentId(), "in", batch)), (snap) => {
        for (const d of snap.docs) {
          const lid = d.data().activeLivePostId as string | undefined;
          if (lid) localMap.set(d.id, lid);
          else localMap.delete(d.id);
        }
        setGroupLives(new Map(localMap));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [groupIds]);

  // ── Nombre y foto de quien hace falta (creadores de historias + en vivo) ──
  useEffect(() => {
    const wantedUsers = [
      ...new Set([
        ...stories.map(storyAuthorId).filter((id): id is string => !!id),
        ...profileLives.keys(),
      ]),
    ].filter((id) => id && !fetchedInfoKeys.current.has(id));
    const wantedGroups = [...groupLives.keys()].filter(
      (id) => !fetchedInfoKeys.current.has(id),
    );
    if (wantedUsers.length === 0 && wantedGroups.length === 0) return;

    let cancelled = false;
    (async () => {
      const updates = new Map<string, DisplayInfo>();
      for (const batch of chunk(wantedUsers, 30)) {
        try {
          const snap = await getDocs(
            query(collection(db, "users"), where(documentId(), "in", batch)),
          );
          for (const d of snap.docs) {
            const data = d.data();
            updates.set(d.id, {
              displayName:
                (data.displayName as string | null) ?? (data.username as string | null) ?? null,
              photoURL: (data.photoURL as string | null) ?? null,
            });
            fetchedInfoKeys.current.add(d.id);
          }
        } catch (err) {
          console.error("[HomeStoriesRow] fetchUsers", err);
        }
      }
      for (const batch of chunk(wantedGroups, 30)) {
        try {
          const snap = await getDocs(
            query(collection(db, "groups"), where(documentId(), "in", batch)),
          );
          for (const d of snap.docs) {
            const data = d.data();
            updates.set(d.id, {
              displayName: (data.name as string | null) ?? null,
              photoURL:
                (data.avatarUrl as string | null) ?? (data.imageUrl as string | null) ?? null,
            });
            fetchedInfoKeys.current.add(d.id);
          }
        } catch (err) {
          console.error("[HomeStoriesRow] fetchGroups", err);
        }
      }
      if (!cancelled && updates.size > 0) {
        setDisplayInfoMap((prev) => {
          const next = new Map(prev);
          for (const [k, v] of updates) next.set(k, v);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stories, profileLives, groupLives]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      void recordStoryView(currentUserId, storyId).catch(() => {});
    },
    [currentUserId],
  );

  // Cada historia es su propio panel del carrusel. El carrusel ya sabe moverse
  // entre paneles, así que una lista plana encaja sin tocarlo.
  const carouselGroups: CarouselGroup[] = stories.map((story) => {
    const info = displayInfoMap.get(story.creatorId);
    return {
      key: story.id,
      stories: [story],
      startIndex: 0,
      thumbnailUrl: resolveThumb(story),
      info: {
        displayName: info?.displayName ?? story.creatorName ?? null,
        photoURL: info?.photoURL ?? null,
      },
    };
  });

  // Se filtra contra los ids vigentes en vez de vaciar el estado desde el efecto.
  // Así una entrada de alguien a quien dejaste de seguir desaparece sola, sin un
  // `setState` de limpieza que además provocaría un render en cascada.
  const followedSet = new Set(creatorIds);
  const memberSet = new Set(groupIds);
  const liveEntities: LiveEntity[] = [
    ...[...profileLives.keys()]
      .filter((id) => followedSet.has(id))
      .map((id) => ({ entityId: id, entityType: "profile" as const })),
    ...[...groupLives.keys()]
      .filter((id) => memberSet.has(id))
      .map((id) => ({ entityId: id, entityType: "group" as const })),
  ];

  if (!mounted || !isDesktop) return null;

  // Mientras carga NO se pinta nada, para no meter un salto de maquetación en el
  // home. Vacío de verdad sí se dice, en vez de desaparecer sin más.
  if (!ready && liveEntities.length === 0) return null;

  if (ready && stories.length === 0 && liveEntities.length === 0) {
    return (
      <div
        style={{
          padding: "14px 16px 10px",
          marginBottom: 14,
          // Arrastrando no debe seleccionarse el nombre de debajo de las tarjetas.
          userSelect: "none",
          WebkitUserSelect: "none",
          color: "rgba(255,255,255,0.45)",
          fontSize: 12.5,
          lineHeight: 1.5,
          fontFamily: fontStack,
        }}
      >
        {tCommon("noStoriesYet")}
      </div>
    );
  }

  return (
    <>
      <style>{`
        .storiesRail::-webkit-scrollbar { display: none; }
        .storiesRail img { -webkit-user-drag: none; user-drag: none; }
        @media (hover: hover) and (pointer: fine) {
          .storiesRail { cursor: grab; }
          .storiesRail:active { cursor: grabbing; }
        }
      `}</style>

      <div
        ref={scrollerRef}
        onScroll={handleRailScroll}
        className="storiesRail"
        {...dragScroll}
        style={{
          display: "flex",
          // Mismas medidas que el rail de recomendaciones, importadas de él.
          gap: RAIL_GAP,
          padding: "0 14px 6px",
          overflowX: "auto",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          marginBottom: 14,
          alignItems: "flex-start",
        }}
      >
        {liveEntities.map(({ entityId, entityType }) => {
          const info = displayInfoMap.get(entityId);
          const name =
            info?.displayName ??
            (entityType === "group" ? tCommon("communityLabel") : tCommon("userLabel"));
          return (
            <div
              key={`live-${entityId}`}
              // Con la tira pegada, los aros necesitan su propio aire: son
              // redondos y no deben leerse como parte del bloque de tarjetas.
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flexShrink: 0, width: CARD_WIDTH, marginInlineEnd: 6 }}
            >
              <LiveRingAvatar
                entityId={entityId}
                entityType={entityType}
                size={80}
                photoURL={info?.photoURL ?? null}
                displayName={name}
                currentUserId={currentUserId}
              />
              <span
                style={{
                  color: "rgba(255,255,255,0.72)",
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1.4,
                  letterSpacing: "-0.01em",
                  fontFamily: fontStack,
                  maxWidth: 88,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </span>
            </div>
          );
        })}

        {stories.map((story, index) => {
          // La cara y el nombre son SIEMPRE los de quien GRABÓ, no los de quien
          // publicó la copia. Misma regla que el slide del reel.
          const authorId = storyAuthorId(story);
          const info = authorId ? displayInfoMap.get(authorId) : undefined;
          const name = info?.displayName ?? story.creatorName ?? tCommon("userLabel");
          const thumb = resolveThumb(story);
          return (
            <button
              key={story.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenAt(index);
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 5,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                flexShrink: 0,
                width: CARD_WIDTH,
              }}
            >
              <div
                style={{
                  width: "100%",
                  aspectRatio: CARD_RATIO,
                  // Esquinas rectas, como las tarjetas de recomendaciones.
                  borderRadius: 0,
                  overflow: "hidden",
                  background: "#141420",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  boxSizing: "border-box",
                }}
              >
                {thumb ? (
                  <Image src={thumb} alt={name} fill style={{ objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: 26, lineHeight: 1 }}>👤</span>
                )}
              </div>

              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  width: "100%",
                  minWidth: 0,
                  paddingInlineStart: 4,
                  boxSizing: "border-box",
                }}
              >
                <span
                  style={{
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: "50%",
                    overflow: "hidden",
                    flexShrink: 0,
                    background: "rgba(255,255,255,0.12)",
                    position: "relative",
                    display: "block",
                  }}
                >
                  {info?.photoURL ? (
                    <Image src={info.photoURL} alt="" fill style={{ objectFit: "cover" }} />
                  ) : null}
                </span>
                <span
                  style={{
                    color: "rgba(255,255,255,0.78)",
                    fontSize: 10.5,
                    fontWeight: 500,
                    lineHeight: 1.3,
                    letterSpacing: "-0.01em",
                    fontFamily: fontStack,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "start",
                  }}
                >
                  {name}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {openAt !== null && carouselGroups.length > 0 && (
        <HomeStoryCarouselDesktop
          groups={carouselGroups}
          initialGroupIndex={openAt}
          onClose={() => setOpenAt(null)}
          onStoryViewed={handleStoryViewed}
        />
      )}
    </>
  );
}
