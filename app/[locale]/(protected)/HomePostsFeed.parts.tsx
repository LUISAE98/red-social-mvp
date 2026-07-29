"use client";

// Sub-componentes, tipos, helpers y cache de HomePostsFeed (aislados a nivel
// de módulo). Extraído para reducir el componente principal; este los importa.

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";

import type { Comment, CommentImage, CommentMention, CommentReply, Post } from "@/lib/posts/types";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchHomePostsPage,
  fetchPostComments,
  softDeletePost,
  togglePostFlame,
  togglePostSave,
  type HomePostsPageCursor,
} from "@/lib/posts/post-service";

import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import {
  buildRandomRecommendationSlots,
  fetchDiscoveryPostsForUser,
  getFeedRailSeed,
} from "@/app/components/GroupRecommendations/recommendation-engine";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import { useUnlockedPostIds } from "@/lib/posts/useUnlockedPostIds";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import {
  recordPostImpression,
  recordPostSaveSignal,
  recordPostCommentSignal,
  recordPostLikeSignal,
  recordPostNotInterested,
  getHiddenPostIds,
} from "@/lib/discovery/viewSignal";
import { followUser } from "@/lib/social/social-service";
import { joinGroup } from "@/lib/groups/membership";


export type HomePostsFeedProps = {
  currentUserId: string | null;
  refreshRef?: React.MutableRefObject<() => Promise<void>>;
};

export type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: "active" | "muted" | "banned" | "removed" | null;
  authorMutedUntil?: unknown;
};

export function normalizeHomeFeedPost(post: PostWithFlags): PostWithFlags {
  return {
    ...post,
    isDeleted: post.isDeleted === true,
    postType: post.postType ?? "text",
    access: post.access ?? "free",
    accessModel: post.accessModel ?? "free",
    accessScope: post.accessScope ?? "group",
    requiresPayment: post.requiresPayment ?? false,
    requiresSubscription: post.requiresSubscription ?? false,
    oneTimePrice: post.oneTimePrice ?? null,
    currency: post.currency ?? null,
    purchaseType: post.purchaseType ?? null,
    media: Array.isArray(post.media) ? post.media : [],
    counts: {
      comments: post.counts?.comments ?? 0,
      likes: post.counts?.likes ?? 0,
      saves: post.counts?.saves ?? 0,
    },
    liveData: post.liveData ?? null,
    videoData: post.videoData ?? null,
    scheduledData: post.scheduledData ?? null,
    playback: post.playback ?? null,
    processing: post.processing ?? {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
  };
}

// Observa cuándo un post permanece visible el tiempo suficiente (dwell) y
// registra la impresión una sola vez. Señal de "visto" (Fase 3 descubrimiento).
export const IMPRESSION_DWELL_MS = 900;

// Separador improbable en tags/texto para pasar el arreglo como prop estable.
export const TAGS_PROP_SEP = "";

export function PostImpressionObserver({
  uid,
  postId,
  category,
  tags,
  text,
  children,
}: {
  uid: string;
  postId?: string | null;
  category?: unknown;
  tags?: string;
  text?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    const el = ref.current;
    if (!el || !uid || typeof IntersectionObserver === "undefined") return;

    let timer: number | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (
          entry.isIntersecting &&
          entry.intersectionRatio >= 0.5 &&
          !firedRef.current
        ) {
          if (timer == null) {
            timer = window.setTimeout(() => {
              firedRef.current = true;
              recordPostImpression(uid, {
                postId,
                category,
                tags: tags ? tags.split(TAGS_PROP_SEP) : [],
                text,
              });
              observer.disconnect();
            }, IMPRESSION_DWELL_MS);
          }
        } else if (timer != null) {
          window.clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.5, 1] }
    );

    observer.observe(el);

    return () => {
      if (timer != null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [uid, postId, category, tags, text]);

  return <div ref={ref}>{children}</div>;
}

// CTA de descubrimiento: "Seguir" (si es perfil) o "Unirme" (si es comunidad).
// Se muestra arriba del post sugerido; el post en sí se ve como uno normal.
//
// El post SABE si el viewer ya sigue al autor / ya es miembro de la comunidad:
// consulta el estado real (following / members) y se oculta si ya está conectado
// (la ausencia del botón = "ya lo sigues"). La comunidad se detecta por la
// PRESENCIA de `groupId`, no por `contextType` (un post de comunidad con un
// `profileId` denormalizado se reclasifica como "profile" y perdía el botón).
export function DiscoveryFollowJoinButton({
  post,
  currentUserId,
}: {
  post: PostWithFlags;
  currentUserId: string;
}) {
  const tFeed = useTranslations("feed");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  // null = aún no sabemos; true = ya sigue/es miembro; false = no conectado.
  const [connected, setConnected] = useState<boolean | null>(null);

  const isCommunity = !!post.groupId;
  const targetId = isCommunity
    ? post.groupId ?? null
    : post.profileId ?? post.authorId ?? null;

  const invalidTarget = !targetId || targetId === currentUserId;

  // Estado real de la relación: ¿ya sigue al autor / ya es miembro del grupo?
  useEffect(() => {
    if (invalidTarget || !targetId || !currentUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const ref = isCommunity
          ? doc(db, "groups", targetId, "members", currentUserId)
          : doc(db, "users", currentUserId, "following", targetId);
        const snap = await getDoc(ref);
        const isConnected = isCommunity
          ? snap.exists() &&
            ((snap.data() as { status?: string } | undefined)?.status ??
              "active") === "active"
          : snap.exists();
        if (!cancelled) setConnected(isConnected);
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invalidTarget, isCommunity, targetId, currentUserId]);

  if (invalidTarget || !targetId) return null;
  // Aún cargando el estado real → no mostramos nada (evita el flash de "Unirme"
  // en un post que en realidad ya sigues).
  if (connected === null && state === "idle") return null;

  // Ya sigue / ya es miembro al cargar → sin botón (el CTA solo tiene sentido en
  // recomendaciones que aún no sigues). El estado "done" (recién unido) se maneja
  // más abajo mostrando el texto morado.
  if (connected === true) return null;

  async function handleAction() {
    if (state !== "idle" || !targetId) return;
    setState("loading");
    try {
      if (isCommunity) {
        await joinGroup(targetId, currentUserId);
      } else {
        await followUser({ currentUserId, targetUserId: targetId });
      }
      setState("done");
    } catch {
      setState("idle");
    }
  }

  // Compacto para el header (izquierda del menú de 3 puntos): bajito y rosa.
  const baseStyle: React.CSSProperties = {
    flexShrink: 0,
    boxSizing: "border-box",
    padding: "5px 11px",
    borderRadius: 5,
    border: "none",
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // Recién unido / seguido → texto morado (Siguiendo / Unido), sin botón.
  if (state === "done") {
    return (
      <span
        style={{
          ...baseStyle,
          background: "transparent",
          color: "#a855ff",
          fontWeight: 700,
          cursor: "default",
        }}
      >
        {isCommunity ? tFeed("joinedCta") : tFeed("followingCta")}
      </span>
    );
  }

  // No conectado → CTA morado sólido (Unirme / Seguir).
  return (
    <button
      type="button"
      onClick={handleAction}
      disabled={state !== "idle"}
      style={{
        ...baseStyle,
        background: "#a855ff",
        color: "#fff",
        cursor: state === "idle" ? "pointer" : "default",
        opacity: state === "loading" ? 0.7 : 1,
      }}
    >
      {state === "loading"
        ? "…"
        : isCommunity
          ? tFeed("joinCta")
          : tFeed("followCta")}
    </button>
  );
}

export function isVideoPostStillProcessing(post: PostWithFlags): boolean {
  if (post.postType !== "video") return false;
  if (!post.id) return false;

  const processingStatus = post.processing?.status;
  const videoStatus = post.videoData?.status;
  const playbackReady = post.playback?.isReady === true;

  if (processingStatus === "ready") return false;
  if (videoStatus === "ready") return false;
  if (playbackReady) return false;
  if (processingStatus === "error") return false;
  if (videoStatus === "error") return false;

  return true;
}

export const HOME_FEED_PAGE_SIZE = 10;
export const HOME_FEED_CACHE_TTL_MS = 1000 * 60 * 30;
export const VIDEO_PROCESSING_POLL_MS = 15_000;
export const VIDEO_PROCESSING_MAX_POLLS = 20;

export type HomeFeedCacheEntry = {
  posts: PostWithFlags[];
  cursor: HomePostsPageCursor | null;
  hasMore: boolean;
  updatedAt: number;
};

export const homeFeedMemoryCache = new Map<string, HomeFeedCacheEntry>();

export function getHomeFeedCacheKey(currentUserId: string): string {
  return `home-feed:${currentUserId}`;
}

export function mergeUniquePosts(
  currentPosts: PostWithFlags[],
  nextPosts: PostWithFlags[]
): PostWithFlags[] {
  const map = new Map<string, PostWithFlags>();

  currentPosts.forEach((post) => {
    if (post.id && post.isDeleted !== true) {
      map.set(post.id, post);
    }
  });

  nextPosts.forEach((post) => {
    if (post.id && post.isDeleted !== true) {
      map.set(post.id, post);
    }
  });

  return Array.from(map.values());
}

export function peekFreshCache(uid: string | null): HomeFeedCacheEntry | null {
  if (!uid) return null;
  const cached = homeFeedMemoryCache.get(getHomeFeedCacheKey(uid));
  if (
    !cached ||
    Date.now() - cached.updatedAt > HOME_FEED_CACHE_TTL_MS ||
    cached.posts.some(isVideoPostStillProcessing) ||
    cached.posts.length === 0
  ) return null;
  return cached;
}

