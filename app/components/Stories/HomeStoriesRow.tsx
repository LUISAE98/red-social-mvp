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

import FillImage from "@/components/ui/FillImage";
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
import { useReelRails, useReelRailSlice } from "@/lib/reels/reelRails";
import type { StoryDoc } from "@/lib/stories/types";
import HomeStoryCarouselDesktop, { type CarouselGroup } from "./HomeStoryCarouselDesktop";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import { useDragScroll } from "@/lib/hooks/useDragScroll";
import { CACHE_TTL } from "@/lib/cache/ttl";

// Las medidas eran las del rail de recomendaciones, importadas de él para que
// los dos rails del home se leyeran como el mismo sistema. Ya no: este rail
// tiene ahora su propio ritmo —tarjetas más chicas, más separadas y con las
// esquinas redondeadas— y seguir importando números que ya no se comparten solo
// escondería la diferencia. Si algún día se quiere volver a igualarlos, hay que
// mover TAMBIÉN el de recomendaciones, no reconectar este.
/** Cuántas tarjetas deben caber como mínimo, en cualquier laptop. */
const MIN_VISIBLE = 5;
/** Tope de ancho de la tarjeta. */
const CARD_MAX_W = 168;
/** Separación entre historias. */
const RAIL_GAP = 12;
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
 * Radio de las tarjetas.
 *
 * Estuvo en 0 —esquinas cuadradas, estilo "mantel", como el listado de
 * búsqueda— porque pegadas de dos en dos las esquinas redondeadas dejaban un
 * rombo de fondo entre cada par. Con la separación de ahora las tarjetas ya no
 * se tocan, así que el redondeo se lee como tal y no como un hueco.
 */
const CARD_RADIUS = 14;
/**
 * Avatar del creador, dentro de la tarjeta.
 *
 * Con 16px no cabía un aro que se distinguiera: el anillo mide unos 3px y a ese
 * tamaño se leía como un borde sucio en vez de como la marca de que hay algo que
 * ver.
 */
const AVATAR_SIZE = 34;

// ─── Caché a nivel de módulo, sobrevive a la navegación en la misma pestaña ───
type IdsEntry = { creatorIds: string[]; groupIds: string[]; cachedAt: number };
const idsCache = new Map<string, IdsEntry>();
// A quién sigues cambia cuando TÚ sigues a alguien, y eso ya invalida esta
// caché a mano (invalidateFollowedIdsCache). El TTL es solo la red de abajo.
const IDS_TTL_MS = CACHE_TTL.CATALOGO;

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
  /**
   * `home` es la aparición de arriba del todo: la que además lleva los aros de
   * quien está transmitiendo en vivo y la que se anuncia vacía si no hay nada.
   *
   * `intercalado` son las apariciones de en medio del feed —home, perfiles y
   * comunidades—. Esas van SIN lives: los aros son la portada de la pantalla, no
   * algo que deba repetirse cada pocas publicaciones, y cada tira de aros abre
   * dos escuchas permanentes a Firestore. Si el trozo que le toca viene vacío,
   * no se pinta nada en vez de anunciar el hueco.
   */
  variant?: "home" | "intercalado";
  /**
   * Qué trozo del feed compartido enseña este rail. Dos apariciones con índices
   * distintos nunca enseñan lo mismo. Ver `useReelRailSlice`.
   */
  railIndex?: number;
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

/**
 * Título de la sección, encima de la tira.
 *
 * Va tanto en el esqueleto como en el rail ya cargado: si solo estuviera en uno,
 * al llegar las historias aparecería de golpe y empujaría la tira hacia abajo.
 *
 * El aire lateral es el mismo `14` del rail para que arranque a plomo con la
 * primera tarjeta.
 */
function TituloRail() {
  const tFeed = useTranslations("feed");

  return (
    <h2
      style={{
        margin: "0 0 10px",
        padding: "0 14px",
        fontSize: 15,
        /**
         * 🚨 EL BLANCO MANDA SOBRE EL GROSOR. No bajar de 600.
         *
         * Estuvo en 700 y se pidió más ligero, así que pasó a 500. Pero a 500 y
         * 15px sobre negro puro los trazos no llegan a cubrir el pixel entero, y
         * el suavizado del navegador rellena esos bordes con grises: el título
         * SE VEÍA apagado aunque el color fuera #fff. Se probó a compensarlo sin
         * tocar el peso —suavizado forzado y una sombra de medio pixel del mismo
         * blanco— y no bastó.
         *
         * 600 es el punto donde el texto se lee blanco sólido de verdad, y sigue
         * siendo bastante más ligero que el 700 del que venía.
         */
        fontWeight: 600,
        lineHeight: 1.2,
        color: "#ffffff",
        // Quitan el tintado que WebKit y Gecko aplican al texto claro sobre
        // fondo oscuro. No cambian el grosor, solo cómo se pinta el borde.
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
      }}
    >
      {tFeed("discoverExperiences")}
    </h2>
  );
}

/**
 * Envoltorio de TODAS las salidas del rail.
 *
 * 🚨 El corte escritorio/celular va en CSS y NO en JS. Es la razón de que este
 * componente exista.
 *
 * Antes el rail devolvía `null` hasta que un efecto confirmaba que el puntero
 * era fino. O sea: primer pintado con cero de alto, y al hidratar aparecía de
 * golpe con sus ~340px. Cualquier rail que quedara POR ENCIMA del viewport
 * empujaba hacia abajo todo lo que el usuario estaba leyendo, y el scroll daba
 * un salto. Con varios rails intercalados por feed, eso pasaba varias veces.
 *
 * Con el corte en CSS el hueco es el correcto desde el primer fotograma: en
 * laptop el rail ocupa su sitio antes incluso de hidratar, y en celular no
 * ocupa nada nunca. El navegador ya no tiene nada que recolocar.
 */
function EnvoltorioRail({ children }: { children: React.ReactNode }) {
  // La clase la define globals.css, con el porqué. No devolver null desde aquí.
  return <div className="vbReelRail">{children}</div>;
}

export default function HomeStoriesRow({
  currentUserId,
  variant = "home",
  railIndex = 0,
}: Props) {
  const tCommon = useTranslations("common");
  const esPortada = variant === "home";

  // Misma fuente, mismo orden y misma cuota que el reel de celular, pero pedida
  // UNA vez por pantalla: el feed vive en `ReelRailsProvider` y aquí solo se
  // recoge el trozo que le toca a esta aparición. Así da igual cuántos rails se
  // intercalen, que consultas se hace una sola.
  const { loadMore } = useReelRails();
  const { stories, ready } = useReelRailSlice(railIndex);
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

  // ── Ids de seguidos y comunidades, solo para los aros de en vivo ──────────
  useEffect(() => {
    // Solo la portada lleva lives. Un rail intercalado que abriera estas
    // escuchas multiplicaria el trabajo por cada aparicion.
    if (!esPortada) return;
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
  }, [currentUserId, esPortada]);

  // ── En vivo: perfiles seguidos ────────────────────────────────────────────
  useEffect(() => {
    // Solo la portada lleva lives. Un rail intercalado que abriera estas
    // escuchas multiplicaria el trabajo por cada aparicion.
    if (!esPortada) return;
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
  }, [creatorIds, currentUserId, esPortada]);

  // ── En vivo: comunidades donde soy miembro ────────────────────────────────
  useEffect(() => {
    // Solo la portada lleva lives. Un rail intercalado que abriera estas
    // escuchas multiplicaria el trabajo por cada aparicion.
    if (!esPortada) return;
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
  }, [groupIds, esPortada]);

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

  // Mientras carga se pinta el esqueleto, no un hueco: así el rail ocupa desde
  // el primer instante y el home no da un salto cuando llegan las historias.
  // Base canónica `.vb-skel` + `vbSkelWave` de vibra_style.md, sin repetir la
  // animación con valores propios.
  if (!ready && liveEntities.length === 0) {
    return (
      <EnvoltorioRail>
        <style jsx>{`
          .skelRail {
            display: flex;
            gap: ${RAIL_GAP}px;
            padding: 0 14px 6px;
            margin-bottom: 14px;
            overflow: hidden;
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
             al llegar el contenido no se mueva nada de sitio. Mismo rincón y
             mismo padding de 8 que allí; ni banda ni degradado, porque la
             tarjeta real tampoco los lleva ya. */
          .skelFoot {
            position: absolute;
            inset-inline-start: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            padding: 8px;
            box-sizing: border-box;
          }
          /* Rellena la tarjeta entera. El tamaño ya lo pone .skelCard, que es
             quien lo comparte con la tarjeta real. */
          .skelMedia {
            position: absolute;
            inset: 0;
            display: block;
          }
          /* Sobre el bloque de la miniatura hace falta más contraste que el
             relleno base, o el avatar no se distingue de él. */
          .skelAvatar {
            width: ${AVATAR_SIZE}px;
            height: ${AVATAR_SIZE}px;
            border-radius: 50%;
            flex-shrink: 0;
            background: rgba(255, 255, 255, 0.22);
          }
        `}</style>
        <TituloRail />
        <div className="skelRail" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skelCard">
              <div className="vb-skel skelMedia" />
              <div className="skelFoot">
                <div className="skelAvatar" />
              </div>
            </div>
          ))}
        </div>
      </EnvoltorioRail>
    );
  }

  if (ready && stories.length === 0 && liveEntities.length === 0) {
    // Intercalado en medio del feed, un rail sin material no se anuncia: se va
    // sin dejar hueco. Anunciar el vacío es cosa de la portada, que es la única
    // aparición que el usuario fue a buscar.
    if (!esPortada) return null;

    return (
      <EnvoltorioRail>
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
      </EnvoltorioRail>
    );
  }

  return (
    <EnvoltorioRail>
      <style>{`
        .storiesRail::-webkit-scrollbar { display: none; }
        .storiesRail img { -webkit-user-drag: none; user-drag: none; }
        @media (hover: hover) and (pointer: fine) {
          .storiesRail { cursor: grab; }
          .storiesRail:active { cursor: grabbing; }
        }
      `}</style>

      <TituloRail />

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
                <FillImage src={thumb} alt={name} />
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

              {/* Autor DENTRO de la tarjeta, y solo el avatar.
                  Antes iba el nombre al lado, y por eso debajo había un
                  degradado a negro de lado a lado: un nombre claro sobre una
                  miniatura clara no se lee. Sin nombre esa banda sobraba —ancho
                  entero para un círculo pequeño—, así que el contraste lo da
                  ahora una sombra pegada al propio avatar. */}
              <span
                style={{
                  position: "absolute",
                  insetInlineStart: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  padding: 8,
                  filter: "drop-shadow(0 1px 4px rgba(0, 0, 0, 0.65))",
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
    </EnvoltorioRail>
  );
}
