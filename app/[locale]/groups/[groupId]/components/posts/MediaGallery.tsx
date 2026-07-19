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
import type { Post } from "@/lib/posts/types";
import {
  fetchGroupMediaPage,
  fetchProfileMediaPage,
  type GroupPostsPageCursor,
  type MediaGalleryKind,
} from "@/lib/posts/post-service";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

/**
 * ¿El tile es contenido de pago que este viewer aún no puede ver? (aproximación:
 * el autor y, en comunidad, los miembros con acceso gratis, sí lo ven). El
 * estado real de compra se resuelve al abrir el flujo de desbloqueo.
 */
function isPaidLockedPost(
  post: Post,
  viewerUid: string | null,
  hasMembership: boolean
): boolean {
  if (viewerUid && post.authorId === viewerUid) return false; // autor

  // Post premium.
  if (post.premium?.enabled === true) {
    if (post.premium.freeFor === "members_and_subscribers" && hasMembership) return false;
    return true;
  }

  // Post / VOD de pago por ticket.
  const paid =
    post.accessModel === "one_time_purchase" ||
    post.requiresPayment === true ||
    post.liveData?.accessType === "paid";
  if (!paid) return false;

  if (post.liveData?.paidAccessMode === "members_free_non_members_pay" && hasMembership) {
    return false;
  }
  return true;
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
};

type MediaGallerySource =
  | { type: "group"; groupId: string }
  | { type: "profile"; profileUid: string };

type MediaGalleryProps = {
  source: MediaGallerySource;
  kind: Exclude<MediaGalleryKind, never>; // "photos" | "videos" | "lives"
  viewerUid?: string | null;
  /** El viewer tiene acceso por membresía (comunidad) — para no bloquear contenido members-free. */
  viewerHasMembership?: boolean;
  onOpenTile: (tile: GalleryTile) => void;
};

const PAGE_SIZE = 24;

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
  hasMembership: boolean
): GalleryTile[] {
  const tiles: GalleryTile[] = [];

  for (const post of posts) {
    const media = Array.isArray(post.media) ? post.media : [];
    // Carrusel = el post trae más de un medio (fotos, videos o mixto).
    const isCarousel =
      media.filter((m) => m.type === "image" || m.type === "video").length > 1;
    const isLocked = isPaidLockedPost(post, viewerUid, hasMembership);

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
      });
    }
  }

  return tiles;
}

export default function MediaGallery({
  source,
  kind,
  viewerUid = null,
  viewerHasMembership = false,
  onOpenTile,
}: MediaGalleryProps) {
  const tPosts = useTranslations("posts");

  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<GroupPostsPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const sourceKey =
    source.type === "group" ? `group:${source.groupId}` : `profile:${source.profileUid}`;

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

  const tiles = useMemo(
    () => tilesFromPosts(posts, kind, viewerUid, viewerHasMembership),
    [posts, kind, viewerUid, viewerHasMembership]
  );

  // Con filtrado en cliente una página puede traer 0 tiles; auto-rellena hasta un
  // mínimo o agotar resultados (el IntersectionObserver no re-dispara si el
  // sentinel sigue intersectando sin cambio de estado).
  useEffect(() => {
    if (initialLoaded && !loading && hasMore && tiles.length < 12) {
      void loadMore();
    }
  }, [initialLoaded, loading, hasMore, tiles.length, loadMore]);

  if (initialLoaded && tiles.length === 0 && !loading) {
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

  return (
    <div>
      <style>{MEDIA_GRID_CSS}</style>
      <div className="vibra-media-grid">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => onOpenTile(tile)}
            style={tileStyle}
            aria-label={tile.isLiveNow ? tPosts("mediaLiveBadge") : undefined}
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
              <span style={lockedCrownStyle} aria-hidden="true">
                <VibraNavigationIcon type="premiumCrown" size={44} />
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

            {tile.isLiveNow && <span style={liveBadgeStyle}>{tPosts("mediaLiveBadge")}</span>}

            {tile.isVideo && !tile.isLiveNow && (
              <span
                style={{
                  ...viewsChipStyle,
                  ...(tile.isLocked ? viewsChipLockedStyle : null),
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {formatViews(tile.post.viewsCount ?? 0)}
              </span>
            )}

            {tile.isLocked && (
              <span className="vibra-media-unlock">{tPosts("mediaUnlock")}</span>
            )}
          </button>
        ))}
      </div>

      {error && tiles.length > 0 && <div style={emptyStyle}>{error}</div>}

      <div ref={sentinelRef} style={{ height: 1 }} />

      {loading && (
        <div style={{ ...emptyStyle, opacity: 0.6 }}>···</div>
      )}
    </div>
  );
}

// Grid responsivo: en celular ~3 columnas (tamaño actual), en laptop columnas
// más anchas (cuadros más grandes). Gap mínimo = poco margen alrededor.
const MEDIA_GRID_CSS = `
.vibra-media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 2px;
}
@media (min-width: 768px) {
  .vibra-media-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
}
.vibra-media-unlock {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #4f46ff, #a855ff, #ff2fb3);
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

// Corona grande centrada en el card bloqueado.
const lockedCrownStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
  filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.55))",
};

const liveBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  left: 6,
  padding: "2px 6px",
  borderRadius: 5,
  background: "#e11d48",
  color: "#fff",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.06em",
  pointerEvents: "none",
};

// Contador de vistas (videos/VODs): esquina inferior izquierda, sin contenedor
// (transparente), con sombra para leerse sobre cualquier fondo.
const viewsChipStyle: CSSProperties = {
  position: "absolute",
  bottom: 6,
  left: 6,
  display: "flex",
  alignItems: "center",
  gap: 4,
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  pointerEvents: "none",
  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
};

// En posts bloqueados el contador sube por encima del botón de desbloquear.
const viewsChipLockedStyle: CSSProperties = {
  bottom: 44,
  left: 10,
};

// Icono blanco de carrusel (arriba-izquierda). Drop-shadow para verse en
// cualquier fondo.
const carouselIconStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  left: 6,
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
