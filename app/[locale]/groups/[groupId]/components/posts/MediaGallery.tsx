"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { FIXED_SERVICE_FEE_USD, SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import type { Post } from "@/lib/posts/types";
import {
  fetchGroupMediaPage,
  fetchProfileMediaPage,
  fetchSavedMediaPage,
  type GroupPostsPageCursor,
  type MediaGalleryKind,
} from "@/lib/posts/post-service";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import { useLiveTicketPostIds } from "@/lib/liveAccess/useLiveTicketPostIds";

/** ¿El post es contenido de pago (premium o ticket), independiente del viewer? */
function isPaidContentPost(post: Post): boolean {
  return (
    post.premium?.enabled === true ||
    post.accessModel === "one_time_purchase" ||
    post.requiresPayment === true ||
    post.liveData?.accessType === "paid"
  );
}

/**
 * ¿El viewer YA puede ver este contenido de pago? El autor, los miembros con
 * acceso gratis, y los posts que el viewer ya desbloqueó (`unlocked` = postAccess
 * real del viewer ∪ desbloqueos de esta sesión; ver useUnlockedPostIds).
 */
function hasPaidAccess(
  post: Post,
  viewerUid: string | null,
  hasMembership: boolean,
  unlocked: ReadonlySet<string>
): boolean {
  if (viewerUid && post.authorId === viewerUid) return true; // autor
  if (unlocked.has(post.id)) return true; // ya desbloqueado (real o de sesión)

  if (post.premium?.enabled === true) {
    return post.premium.freeFor === "members_and_subscribers" && hasMembership;
  }
  return (
    post.liveData?.paidAccessMode === "members_free_non_members_pay" && hasMembership
  );
}

export type GalleryTile = {
  key: string;
  post: Post;
  /** URL del medio para abrir en el visor (initialMediaUrl); null si aún no hay. */
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  isVideo: boolean;
  isLiveNow: boolean;
  /** Es un tile de la galería "En vivo" (transmisión o VOD): abre con el player de live/VOD. */
  isLive: boolean;
  /** El post tiene más de un medio (carrusel de fotos/videos o mixto). */
  isCarousel: boolean;
  /** Contenido de pago que el viewer aún no puede ver: se muestra borroso + Desbloquear. */
  isLocked: boolean;
  /** Contenido de pago al que el viewer SÍ tiene acceso: corona chica abajo-derecha. */
  isPremiumUnlocked: boolean;
};

type MediaGallerySource =
  | { type: "group"; groupId: string }
  | { type: "profile"; profileUid: string }
  | { type: "saved"; userUid: string };

type MediaGalleryProps = {
  source: MediaGallerySource;
  kind: Exclude<MediaGalleryKind, never>; // "photos" | "videos" | "lives"
  viewerUid?: string | null;
  /** El viewer tiene acceso por membresía (comunidad) — para no bloquear contenido members-free. */
  viewerHasMembership?: boolean;
  /** Posts desbloqueados (comprados) en esta sesión — dejan de mostrarse bloqueados. */
  unlockedPostIds?: ReadonlySet<string>;
  onOpenTile: (tile: GalleryTile) => void;
};

const PAGE_SIZE = 24;

// Cuántos skeletons se pintan mientras carga la primera página de la galería.
const SKELETON_COUNT = 9;

const EMPTY_UNLOCKED: ReadonlySet<string> = new Set();

type MediaGalleryCacheEntry = {
  posts: Post[];
  cursor: GroupPostsPageCursor | null;
  hasMore: boolean;
};

// Caché en memoria por (fuente, tipo). Persiste durante la sesión para no
// recargar la galería al cambiar de pestaña (el slide remonta la MediaGallery).
// Se limpia con clearMediaGalleryCache() en un refresh manual, o al recargar la
// página (el módulo se reinicia).
const mediaGalleryCache = new Map<string, MediaGalleryCacheEntry>();

/** Limpia el caché de galerías (llamar en pull-to-refresh / refresh manual). */
export function clearMediaGalleryCache() {
  mediaGalleryCache.clear();
}

function pickThumb(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/** Formato compacto de vistas: 999, 1.2K, 3.4M. */
function formatViews(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function tilesFromPosts(
  posts: Post[],
  kind: MediaGalleryKind,
  viewerUid: string | null,
  hasMembership: boolean,
  unlocked: ReadonlySet<string>
): GalleryTile[] {
  const tiles: GalleryTile[] = [];

  for (const post of posts) {
    const media = Array.isArray(post.media) ? post.media : [];
    // Carrusel = el post trae más de un medio (fotos, videos o mixto).
    const isCarousel =
      media.filter((m) => m.type === "image" || m.type === "video").length > 1;
    const isPaid = isPaidContentPost(post);
    const hasAccess = isPaid && hasPaidAccess(post, viewerUid, hasMembership, unlocked);
    const isLocked = isPaid && !hasAccess;
    const isPremiumUnlocked = isPaid && hasAccess;

    if (kind === "photos") {
      // Un solo tile por post: la PRIMERA foto (aunque sea carrusel o mixto).
      const first = media.find((m) => m.type === "image");
      if (!first) continue;
      const thumb = pickThumb(first.thumbnailUrl, first.url);
      if (!thumb) continue;
      tiles.push({
        key: post.id,
        post,
        mediaUrl: first.url || thumb,
        thumbnailUrl: thumb,
        isVideo: false,
        isLiveNow: false,
        isLive: false,
        isCarousel,
        isLocked,
        isPremiumUnlocked,
      });
    } else if (kind === "videos") {
      // Un solo tile por post: el PRIMER video (aunque sea carrusel o mixto).
      const first = media.find((m) => m.type === "video");
      if (!first) continue;
      const thumb = pickThumb(
        first.thumbnailUrl,
        post.playback?.thumbnailUrl,
        post.videoData?.thumbnailUrl,
        first.url
      );
      if (!thumb && !first.url) continue;
      tiles.push({
        key: post.id,
        post,
        mediaUrl: first.url || null,
        thumbnailUrl: thumb,
        isVideo: true,
        isLiveNow: false,
        isLive: false,
        isCarousel,
        isLocked,
        isPremiumUnlocked,
      });
    } else {
      // lives (un tile por post ya)
      const live = post.liveData;
      const isLiveNow = live?.status === "live";
      const vodMedia = media.find((m) => m.type === "video");
      const thumb = pickThumb(
        live?.coverUrl,
        vodMedia?.thumbnailUrl,
        post.playback?.thumbnailUrl,
        media[0]?.thumbnailUrl,
        media[0]?.url
      );
      tiles.push({
        key: post.id,
        post,
        // Fallback de URL del VOD (HLS) por si el card no la resuelve.
        mediaUrl: pickThumb(
          post.playback?.hlsUrl,
          live?.hlsUrl,
          vodMedia?.url
        ),
        thumbnailUrl: thumb,
        isVideo: true,
        isLiveNow: !!isLiveNow,
        isLive: true,
        isCarousel: false,
        isLocked,
        isPremiumUnlocked,
      });
    }
  }

  return tiles;
}

// Un tile de la galería. Aparece SUAVE: arranca en opacity 0 y se revela cuando su
// miniatura ya cargó (precarga con `new Image()`; si no hay miniatura, de inmediato).
function MediaTile({
  tile,
  onOpen,
  liveBadgeLabel,
  formatLockedPrice,
}: {
  tile: GalleryTile;
  onOpen: (tile: GalleryTile) => void;
  liveBadgeLabel: string;
  formatLockedPrice: (post: Post) => string;
}) {
  const [ready, setReady] = useState(!tile.thumbnailUrl);

  useEffect(() => {
    if (!tile.thumbnailUrl) {
      setReady(true);
      return;
    }
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    const img = new Image();
    img.onload = finish;
    img.onerror = finish;
    img.src = tile.thumbnailUrl;
    if (img.complete) finish();
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [tile.thumbnailUrl]);

  return (
    <button
      type="button"
      onClick={() => onOpen(tile)}
      style={{
        ...tileStyle,
        opacity: ready ? 1 : 0,
        transition: "opacity 400ms ease",
      }}
      aria-label={tile.isLiveNow ? liveBadgeLabel : undefined}
    >
      {tile.thumbnailUrl ? (
        <span
          style={{
            ...tileImageStyle,
            backgroundImage: `url("${tile.thumbnailUrl}")`,
            ...(tile.isLocked ? lockedImageStyle : null),
          }}
        />
      ) : (
        <span style={{ ...tileImageStyle, background: "rgba(255,255,255,0.06)" }} />
      )}

      {tile.isLocked && <span style={lockedScrimStyle} aria-hidden="true" />}

      {tile.isLocked && (
        <span className="vibra-media-crown" aria-hidden="true">
          <VibraNavigationIcon type="premiumCrown" size={44} />
        </span>
      )}

      {tile.isPremiumUnlocked && (
        <span className="vibra-media-crown-sm" aria-hidden="true">
          <VibraNavigationIcon type="premiumCrown" size={23} />
        </span>
      )}

      {tile.isCarousel && (
        <span style={carouselIconStyle} aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M4 16V6a2 2 0 0 1 2-2h10" />
          </svg>
        </span>
      )}

      {tile.isLiveNow && <span style={liveBadgeStyle}>{liveBadgeLabel}</span>}

      {tile.isVideo && !tile.isLiveNow && (
        <span className={tile.isLocked ? "vibra-media-views locked" : "vibra-media-views"}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {formatViews(tile.post.viewsCount ?? 0)}
        </span>
      )}

      {tile.isLocked && (
        <span className="vibra-media-unlock">{formatLockedPrice(tile.post)}</span>
      )}
    </button>
  );
}

export default function MediaGallery({
  source,
  kind,
  viewerUid = null,
  viewerHasMembership = false,
  unlockedPostIds = EMPTY_UNLOCKED,
  onOpenTile,
}: MediaGalleryProps) {
  const tPosts = useTranslations("posts");
  const { formatWithTax } = usePriceFormat();

  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<GroupPostsPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  // Los skeletons de carga se mantienen montados hasta que su fade-out termina.
  const [skeletonsMounted, setSkeletonsMounted] = useState(true);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const sourceKey =
    source.type === "group"
      ? `group:${source.groupId}`
      : source.type === "profile"
        ? `profile:${source.profileUid}`
        : `saved:${source.userUid}`;

  const fetchPage = useCallback(
    (pageCursor: GroupPostsPageCursor | null) => {
      if (source.type === "group") {
        return fetchGroupMediaPage({
          groupId: source.groupId,
          kind,
          viewerUid,
          cursor: pageCursor,
          pageSize: PAGE_SIZE,
        });
      }
      if (source.type === "saved") {
        return fetchSavedMediaPage({
          userUid: source.userUid,
          kind,
          viewerUid,
          cursor: pageCursor,
          pageSize: PAGE_SIZE,
        });
      }
      return fetchProfileMediaPage({
        profileUid: source.profileUid,
        kind,
        viewerUid,
        cursor: pageCursor,
        pageSize: PAGE_SIZE,
      });
    },
    [source, kind, viewerUid]
  );

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPage(cursor);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        for (const p of result.posts) {
          if (!seen.has(p.id)) merged.push(p);
        }
        return merged;
      });
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch {
      setError(tPosts("mediaLoadError"));
      setHasMore(false);
    } finally {
      setInitialLoaded(true);
      setLoading(false);
      loadingRef.current = false;
    }
  }, [cursor, hasMore, fetchPage, tPosts]);

  // Reset y primera carga cuando cambia la fuente o el tipo de galería.
  useEffect(() => {
    const cacheKey = `${sourceKey}:${kind}`;
    const cached = mediaGalleryCache.get(cacheKey);

    // Restaura desde caché: no recargar al volver a la pestaña.
    if (cached) {
      setPosts(cached.posts);
      setCursor(cached.cursor);
      setHasMore(cached.hasMore);
      setError(null);
      setInitialLoaded(true);
      setLoading(false);
      loadingRef.current = false;
      return;
    }

    setPosts([]);
    setCursor(null);
    setHasMore(true);
    setError(null);
    setInitialLoaded(false);
    loadingRef.current = true;
    setLoading(true);

    let cancelled = false;
    (async () => {
      try {
        const result = await fetchPage(null);
        if (cancelled) return;
        setPosts(result.posts);
        setCursor(result.cursor);
        setHasMore(result.hasMore);
      } catch {
        if (cancelled) return;
        setError(tPosts("mediaLoadError"));
        setHasMore(false);
      } finally {
        if (!cancelled) {
          setInitialLoaded(true);
          setLoading(false);
        }
        loadingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, kind]);

  // Persiste el estado en caché (salvo error) para restaurar al volver.
  useEffect(() => {
    if (!initialLoaded || error) return;
    mediaGalleryCache.set(`${sourceKey}:${kind}`, { posts, cursor, hasMore });
  }, [sourceKey, kind, posts, cursor, hasMore, initialLoaded, error]);

  // Scroll infinito.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  // Transmisiones de pago en pantalla: para ellas el ticket del live también
  // desbloquea la grabación (es el mismo post), así que hay que consultarlo.
  const paidLivePostIds = useMemo(
    () => posts.filter((p) => p.liveData != null && isPaidContentPost(p)).map((p) => p.id),
    [posts]
  );
  const liveTicketPostIds = useLiveTicketPostIds(paidLivePostIds, viewerUid);

  const unlockedWithTickets = useMemo(() => {
    if (liveTicketPostIds.size === 0) return unlockedPostIds;
    return new Set([...unlockedPostIds, ...liveTicketPostIds]);
  }, [unlockedPostIds, liveTicketPostIds]);

  const tiles = useMemo(
    () => tilesFromPosts(posts, kind, viewerUid, viewerHasMembership, unlockedWithTickets),
    [posts, kind, viewerUid, viewerHasMembership, unlockedWithTickets]
  );

  // Con filtrado en cliente una página puede traer 0 tiles; auto-rellena hasta un
  // mínimo o agotar resultados (el IntersectionObserver no re-dispara si el
  // sentinel sigue intersectando sin cambio de estado).
  useEffect(() => {
    if (initialLoaded && !loading && hasMore && tiles.length < 12) {
      void loadMore();
    }
  }, [initialLoaded, loading, hasMore, tiles.length, loadMore]);

  // Al terminar la carga inicial, los skeletons hacen fade-out (opacity → 0) y se
  // desmontan cuando el fade termina. Si vuelve a cargar (cambia fuente/tipo), se
  // remontan.
  useEffect(() => {
    if (!initialLoaded) {
      setSkeletonsMounted(true);
      return;
    }
    const t = window.setTimeout(() => setSkeletonsMounted(false), 460);
    return () => window.clearTimeout(t);
  }, [initialLoaded]);

  const trailingSkeletons = skeletonsMounted
    ? Math.max(0, SKELETON_COUNT - tiles.length)
    : 0;

  // "Vacío" solo cuando ya no hay skeletons en fade (para no cortar su salida).
  if (initialLoaded && tiles.length === 0 && !loading && !skeletonsMounted) {
    const emptyKey =
      kind === "photos"
        ? "mediaEmptyPhotos"
        : kind === "videos"
          ? "mediaEmptyVideos"
          : "mediaEmptyLives";
    return (
      <div style={emptyStyle}>
        {error ? error : tPosts(emptyKey)}
      </div>
    );
  }

  const liveBadgeLabel = tPosts("mediaLiveBadge");
  // Precio del candado ya con todo incluido: (base + cargo fijo) + impuesto del país (la pasarela desglosa el IVA).
  const formatLockedPrice = (post: Post) =>
    formatWithTax((post.oneTimePrice ?? 0) + FIXED_SERVICE_FEE_USD, {
      baseCurrency: post.currency ?? SETTLEMENT_CURRENCY,
    }).total;

  return (
    <div>
      <style>{MEDIA_GRID_CSS}</style>
      <div className="vibra-media-grid">
        {tiles.map((tile) => (
          <MediaTile
            key={tile.key}
            tile={tile}
            onOpen={onOpenTile}
            liveBadgeLabel={liveBadgeLabel}
            formatLockedPrice={formatLockedPrice}
          />
        ))}

        {/* Skeletons de carga: rellenan hasta 9 mientras carga; los sobrantes hacen
            fade-out cuando llega el contenido y se desmontan al terminar. */}
        {Array.from({ length: trailingSkeletons }).map((_, i) => (
          <div
            key={`skel-${i}`}
            className="vibra-media-skel vb-skel"
            style={{ opacity: initialLoaded ? 0 : 1 }}
            aria-hidden="true"
          />
        ))}
      </div>

      {error && tiles.length > 0 && <div style={emptyStyle}>{error}</div>}

      <div ref={sentinelRef} style={{ height: 1 }} />

      {/* Indicador de paginación (no en la carga inicial: ahí van los skeletons). */}
      {loading && initialLoaded && (
        <div style={{ ...emptyStyle, opacity: 0.6 }}>···</div>
      )}
    </div>
  );
}

// Grid fijo: siempre 3 columnas por fila en cualquier dispositivo. Gap mínimo =
// poco margen alrededor.
const MEDIA_GRID_CSS = `
.vibra-media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
}
/* Skeleton de tile (mismo estilo/animación base de vibra_style.md). */
.vibra-media-skel {
  aspect-ratio: 1 / 1;
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
  .vb-skel {
    animation: none;
    background: rgba(255, 255, 255, 0.07);
  }
}
.vibra-media-unlock {
  position: absolute;
  inset-inline-start: 8px;
  inset-inline-end: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #4f46ff, #a855f7, #ff2fb3);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
  pointer-events: none;
}
@media (max-width: 767px) {
  .vibra-media-unlock {
    height: 27px;
    font-size: 11px;
    border-radius: 9px;
  }
}
.vibra-media-crown {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.55));
}
@media (max-width: 767px) {
  .vibra-media-crown {
    transform: translateY(-9px) scale(0.8);
  }
}
.vibra-media-crown-sm {
  position: absolute;
  bottom: 6px;
  inset-inline-end: 6px;
  display: flex;
  pointer-events: none;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6));
}
.vibra-media-views {
  position: absolute;
  bottom: 6px;
  inset-inline-start: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.7));
}
.vibra-media-views.locked {
  bottom: 44px;
  inset-inline-start: 10px;
}
@media (min-width: 768px) {
  .vibra-media-views.locked {
    bottom: 54px;
  }
}
`;

const tileStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  width: "100%",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  overflow: "hidden",
  borderRadius: 0,
  background: "rgba(255,255,255,0.04)",
  WebkitTapHighlightColor: "transparent",
};

const tileImageStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
};

// Contenido de pago bloqueado: imagen borrosa + scrim + botón Desbloquear.
const lockedImageStyle: CSSProperties = {
  filter: "blur(16px)",
  transform: "scale(1.15)",
};

const lockedScrimStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(0,0,0,0.28)",
  pointerEvents: "none",
};

const liveBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  insetInlineStart: 6,
  padding: "2px 6px",
  borderRadius: 5,
  background: "#e11d48",
  color: "#fff",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.06em",
  pointerEvents: "none",
};

// Icono blanco de carrusel (arriba-izquierda). Drop-shadow para verse en
// cualquier fondo.
const carouselIconStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  insetInlineStart: 6,
  display: "flex",
  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.55))",
  pointerEvents: "none",
};

const emptyStyle: CSSProperties = {
  padding: "36px 16px",
  textAlign: "center",
  color: "rgba(255,255,255,0.5)",
  fontSize: 13,
};
