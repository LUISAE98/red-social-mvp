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
/**
 * Proporción de la tarjeta: la misma que tienen las historias cuando se enlistan
 * en una búsqueda, 9:16.
 *
 * Antes era 200×224, casi cuadrada, heredada de las medidas del rail de
 * recomendaciones. Pero ahí dentro va un REEL, que se graba vertical: en una
 * tarjeta cuadrada se recortaba por arriba y por abajo justo donde está la cara.
 * A la misma anchura, la tarjeta ahora es más alta y el video cabe entero.
 */
const CARD_RATIO = "9 / 16";

/**
 * Ancho responsivo. Reparte el espacio visible entre MIN_VISIBLE tarjetas y sus
 * separaciones, sin pasar del tope. En una pantalla ancha caben más de cuatro
 * porque el tope corta el crecimiento; en una estrecha, encogen para que sigan
 * cabiendo cuatro.
 */
const CARD_WIDTH = `min(${CARD_MAX_W}px, calc((100% - ${RAIL_GAP * (MIN_VISIBLE - 1)}px) / ${MIN_VISIBLE}))`;
/**
 * Radio de las tarjetas: ninguno.
 *
 * Esquinas cuadradas, como en el listado de búsqueda —donde el comentario lo
 * llama estilo "mantel"—. Las esquinas redondeadas recortaban imagen en las
 * cuatro puntas de cada reel.
 */
const CARD_RADIUS = 0;
/** Cuánto se funde cada orilla del rail. */
const EDGE_FADE = 28;
/**
 * Avatar del creador junto a su nombre, dentro de la tarjeta.
 *
 * Con 16px no cabía un aro que se distinguiera: el anillo mide unos 3px y a ese
 * tamaño se leía como un borde sucio en vez de como la marca de que hay algo que
 * ver.
 */
const AVATAR_SIZE = 34;

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

  // Mientras carga se pinta el esqueleto, no un hueco: así el rail ocupa desde
  // el primer instante y el home no da un salto cuando llegan las historias.
  // Base canónica `.vb-skel` + `vbSkelWave` de vibra_style.md, sin repetir la
  // animación con valores propios.
  if (!ready && liveEntities.length === 0) {
    return (
      <>
        <style jsx>{`
          .skelRail {
            display: flex;
            gap: ${RAIL_GAP}px;
            padding: 0 14px 6px;
            margin-bottom: 14px;
            overflow: hidden;
            mask-image: linear-gradient(
              to right,
              transparent 0,
              #000 ${EDGE_FADE}px,
              #000 calc(100% - ${EDGE_FADE}px),
              transparent 100%
            );
            -webkit-mask-image: linear-gradient(
              to right,
              transparent 0,
              #000 ${EDGE_FADE}px,
              #000 calc(100% - ${EDGE_FADE}px),
              transparent 100%
            );
          }
          /* La caja la define la TARJETA, no la miniatura de dentro: mismas
             medidas, mismo radio y mismo fondo que la real. Así lo que se pinta
             mientras carga ocupa exactamente el sitio que ocupará después. */
          .skelCard {
            width: ${CARD_WIDTH};
            flex-shrink: 0;
            position: relative;
            aspect-ratio: ${CARD_RATIO};
            border-radius: ${CARD_RADIUS}px;
            overflow: hidden;
            background: #141420;
          }
          /* El autor va DENTRO de la tarjeta, igual que en las reales, para que
             al llegar el contenido no se mueva nada de sitio. */
          .skelFoot {
            position: absolute;
            inset-inline-start: 0;
            inset-inline-end: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            gap: 6px;
            /* El mismo padding y el mismo degradado que la tarjeta real. Con
               8px planos el avatar y el nombre nacían 10px más abajo y daban un
               salto al llegar el contenido, que es justo lo que un skeleton
               tiene que evitar. */
            padding: 18px 8px 8px;
            box-sizing: border-box;
            background: linear-gradient(
              to top,
              rgba(0, 0, 0, 0.78) 0%,
              rgba(0, 0, 0, 0.45) 45%,
              rgba(0, 0, 0, 0) 100%
            );
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
            0% {
              background-position: 180% 0;
            }
            100% {
              background-position: -80% 0;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .vb-skel {
              animation: none;
              background: rgba(255, 255, 255, 0.07);
            }
          }
          /* Rellena la tarjeta entera. El tamaño ya lo pone .skelCard, que es
             quien lo comparte con la tarjeta real. */
          .skelMedia {
            position: absolute;
            inset: 0;
            display: block;
          }
          /* Sobre el bloque de la miniatura hace falta más contraste que el
             relleno base, o el avatar y el nombre no se distinguen de él. */
          .skelAvatar {
            width: ${AVATAR_SIZE}px;
            height: ${AVATAR_SIZE}px;
            border-radius: 50%;
            flex-shrink: 0;
            background: rgba(255, 255, 255, 0.22);
          }
          .skelName {
            height: 9px;
            border-radius: 6px;
            width: 62%;
            background: rgba(255, 255, 255, 0.22);
          }
        `}</style>
        <div className="skelRail" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skelCard">
              <div className="vb-skel skelMedia" />
              <div className="skelFoot">
                <div className="skelAvatar" />
                <div className="skelName" />
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (ready && stories.length === 0 && liveEntities.length === 0) {
    return (
      <>
        {/* En laptop no se anuncia el vacío: ni el texto NI el hueco que ocupaba.
            Se esconde con `display: none` y no devolviendo null en JS a
            propósito — el punto de corte se queda en CSS, así que el primer
            pintado ya es el correcto y no hay parpadeo al hidratar. */}
        <style>{`
          .vbReelsEmpty {
            padding: 14px 16px 10px;
            margin-bottom: 14px;
            color: rgba(255, 255, 255, 0.45);
            font-size: 12.5px;
            line-height: 1.5;
          }
          @media (min-width: 769px) {
            .vbReelsEmpty { display: none; }
          }
        `}</style>
        <div className="vbReelsEmpty" style={{ fontFamily: fontStack }}>
          {tCommon("noReelsYet")}
        </div>
      </>
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
          // Arrastrando no debe seleccionarse el nombre de las tarjetas.
          userSelect: "none",
          WebkitUserSelect: "none",
          // Las orillas se funden en vez de cortarse en seco. Es una MÁSCARA, no
          // un degradado encima: así funciona sobre cualquier fondo y no hay que
          // repintar nada cuando el fondo del home cambie.
          maskImage: `linear-gradient(to right, transparent 0, #000 ${EDGE_FADE}px, #000 calc(100% - ${EDGE_FADE}px), transparent 100%)`,
          WebkitMaskImage: `linear-gradient(to right, transparent 0, #000 ${EDGE_FADE}px, #000 calc(100% - ${EDGE_FADE}px), transparent 100%)`,
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
            <div
              key={story.id}
              role="button"
              tabIndex={0}
              aria-label={name}
              onClick={(e) => {
                e.stopPropagation();
                setOpenAt(index);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                // Espacio hace rodar la página si no se le corta el paso.
                e.preventDefault();
                e.stopPropagation();
                setOpenAt(index);
              }}
              style={{
                display: "block",
                border: "none",
                padding: 0,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                flexShrink: 0,
                width: CARD_WIDTH,
                borderRadius: CARD_RADIUS,
                overflow: "hidden",
                background: "#141420",
                position: "relative",
                aspectRatio: CARD_RATIO,
                boxSizing: "border-box",
              }}
            >
              {thumb ? (
                <Image src={thumb} alt={name} fill style={{ objectFit: "cover" }} />
              ) : (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 26,
                    lineHeight: 1,
                  }}
                >
                  👤
                </span>
              )}

              {/* Autor DENTRO de la tarjeta. Encima va un degradado a negro: sin
                  él, un nombre claro sobre una miniatura clara no se lee. */}
              <span
                style={{
                  position: "absolute",
                  insetInlineStart: 0,
                  insetInlineEnd: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "18px 8px 8px",
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 100%)",
                  minWidth: 0,
                  boxSizing: "border-box",
                }}
              >
                {/* El aro sale de LiveRingAvatar, que ya resuelve solo cuál toca:
                    ROJO si esa persona está transmitiendo ahora, y si no delega en
                    StoryRingAvatar, que pone el de Vibra cuando tiene historias sin
                    ver. Reusarlo evita repetir aquí la consulta de estado en vivo.

                    Va con `pointer-events: none` a propósito: el aro es un botón
                    con su propia acción, y dentro de una tarjeta que ya abre el reel
                    habría dos destinos para el mismo clic. Aquí es solo señal. */}
                <span style={{ pointerEvents: "none", display: "inline-flex", flexShrink: 0 }}>
                  <LiveRingAvatar
                    entityId={authorId ?? story.creatorId}
                    entityType="profile"
                    currentUserId={currentUserId}
                    photoURL={info?.photoURL ?? null}
                    displayName={name}
                    size={AVATAR_SIZE}
                  />
                </span>
                <span
                  style={{
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
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
            </div>
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
