// Tipos, helpers puros, constantes y cache de GroupPostsFeed (capa hoja, sin
// React/JSX). Extraído para reducir el componente; este importa lo que usa.

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { collection, doc, getDoc, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { auth, db, functions } from "@/lib/firebase";
import type {
  Comment,
  CommentImage,
  CommentMention,
  CommentReply,
  Post,
  PostPremium,
} from "@/lib/posts/types";
import {
  createMediaPost,
  createPostComment,
  createPostCommentReply,
  createTextPost,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchCommentRepliesAdmin,
  fetchGroupPostsPage,
  fetchGroupPublicPostsPage,
  fetchPostComments,
  fetchPostCommentsAdmin,
  softDeletePost,
  toggleGroupPostPin,
  togglePostFlame,
  togglePostSave,
  toggleProfilePostPin,
  type GroupPostsPageCursor,
} from "@/lib/posts/post-service";
import GroupPostCard from "./GroupPostCard";
import GroupPostComposer from "./GroupPostComposer";
import PostsMediaSubnav, { MEDIA_TAB_ORDER, type MediaTabKey } from "./PostsMediaSubnav";
import MediaGallery, { clearMediaGalleryCache, type GalleryTile } from "./MediaGallery";
import LiveComposerModal from "@/app/components/LiveComposer/LiveComposerModal";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import { uploadPostImages } from "@/lib/posts/image-upload";
import { httpsCallable } from "firebase/functions";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";
import { useUnlockedPostIds } from "@/lib/posts/useUnlockedPostIds";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

export type InteractionBlockedReason = "login" | "join" | "restricted" | null;

export type CreateMuxDirectUploadResponse = {
  provider: "mux";
  uploadId: string;
  uploadUrl: string;
  postId: string;
  mediaId: string;
  status: string;
};

export type GroupPostsFeedProps = {
  groupId: string;
  groupVisibility?: "public" | "private" | "hidden" | null;
  isOwner?: boolean;
  isModerator?: boolean;
  viewerIsMember?: boolean;
  canCreatePosts?: boolean;
  canCommentOnPosts?: boolean;
  postBlockedReason?: InteractionBlockedReason;
  commentBlockedReason?: InteractionBlockedReason;
  publicPremiumOnly?: boolean;
  broadcastLiveOnly?: boolean;
  readOnly?: boolean;
  /** Búsqueda dentro de la comunidad: filtra los posts por texto. */
  searchQuery?: string;
  /** Reporta la sub-pestaña de media activa (para que el padre oculte el rail
   *  de recomendaciones en Fotos/Videos/En vivo). */
  onMediaTabChange?: (tab: MediaTabKey) => void;
  /** Contenido que va al inicio del panel "Publicaciones", debajo del sub-subnav
   *  y dentro del slide (ej. banner de donaciones y de sesiones). Se oculta en
   *  las pestañas de galería. */
  feedLeadingContent?: ReactNode;
  /**
   * Se pinta justo DEBAJO del subnav de medios y encima de las publicaciones.
   * Lo usa la comunidad ajena para el texto "Ver sus integrantes", que necesita
   * ese sitio exacto y no puede ir fuera porque el subnav vive aqui dentro.
   */
  belowMediaTabs?: ReactNode;
};

// Búsqueda dentro de la comunidad: normaliza y matchea por texto del post.
export function normalizeGroupSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
export function groupPostMatchesQuery(post: Post, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = normalizeGroupSearch(typeof post.text === "string" ? post.text : "");
  return tokens.every((token) => hay.includes(token));
}
export const GROUP_SEARCH_MAX_AUTO_PAGES = 12;

export type MemberStatus = "active" | "muted" | "banned" | "removed" | null;

export type PostWithAuthorState = Post & {
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: unknown;
  forcedGroupId?: string | null;
};

export async function getGroupMemberMeta(
  groupId: string,
  userId: string,
): Promise<{ status: MemberStatus; mutedUntil: unknown }> {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      return { status: null, mutedUntil: null };
    }

    const data = memberSnap.data() as { status?: string; mutedUntil?: unknown };
    const rawStatus = data?.status;

    let status: MemberStatus = "active";

    if (rawStatus === "banned") {
      status = "banned";
    } else if (rawStatus === "muted") {
      status = "muted";
    } else if (
      rawStatus === "removed" ||
      rawStatus === "kicked" ||
      rawStatus === "expelled"
    ) {
      status = "removed";
    }

    return {
      status,
      mutedUntil: data?.mutedUntil ?? null,
    };
  } catch {
    return { status: null, mutedUntil: null };
  }
}

export async function attachAuthorMemberState(
  groupId: string,
  posts: Post[],
): Promise<PostWithAuthorState[]> {
  if (!posts.length) return posts as PostWithAuthorState[];

  const uniqueAuthorIds = Array.from(
    new Set(
      posts
        .map((post) => post.authorId)
        .filter(
          (authorId): authorId is string =>
            typeof authorId === "string" && authorId.trim().length > 0,
        ),
    ),
  );

  const authorStatusEntries = await Promise.all(
    uniqueAuthorIds.map(async (authorId) => {
      const meta = await getGroupMemberMeta(groupId, authorId);
      return [authorId, meta] as const;
    }),
  );

  const authorStatusMap = new Map<
    string,
    { status: MemberStatus; mutedUntil: unknown }
  >(authorStatusEntries);

  return posts.map((post) => {
    const authorMeta = authorStatusMap.get(post.authorId) ?? {
      status: null,
      mutedUntil: null,
    };

    return {
      ...post,
      forcedGroupId: groupId,
      authorMemberStatus: authorMeta.status,
      authorMutedUntil: authorMeta.mutedUntil,
    };
  });
}

export function normalizeFeedPost(post: PostWithAuthorState): PostWithAuthorState {
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

    isPinnedInGroup: post.isPinnedInGroup ?? false,
    groupPinnedAt: post.groupPinnedAt ?? null,
    groupPinnedBy: post.groupPinnedBy ?? null,

    isPinnedOnProfile: post.isPinnedOnProfile ?? false,
    profilePinnedAt: post.profilePinnedAt ?? null,
    profilePinnedBy: post.profilePinnedBy ?? null,
  };
}

export function buildOptimisticTextPost(params: {
  postId: string;
  groupId: string;
  text: string;
}): PostWithAuthorState {
  const currentUser = auth.currentUser;
  return normalizeFeedPost({
    id: params.postId,
    text: params.text,
    authorId: currentUser?.uid ?? "",
    authorName: currentUser?.displayName ?? undefined,
    authorAvatarUrl: currentUser?.photoURL ?? null,
    authorUsername: null,
    groupId: params.groupId,
    contextType: "group",
    isDeleted: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    deletedAt: null,
    postType: "text",
    access: "free",
    accessModel: "free",
    accessScope: "group",
    requiresPayment: false,
    requiresSubscription: false,
    oneTimePrice: null,
    currency: null,
    media: [],
    counts: { comments: 0, likes: 0, saves: 0 },
    viewerHasFlamed: false,
    viewerHasSaved: false,
    isPinnedInGroup: false,
    authorMemberStatus: "active",
    authorMutedUntil: null,
    forcedGroupId: params.groupId,
  });
}

export function isVideoPostStillProcessing(post: PostWithAuthorState): boolean {
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

export function buildPostBlockedMessage(reason: InteractionBlockedReason): string {
  if (reason === "login") {
    return "Inicia sesión para publicar en esta comunidad.";
  }

  if (reason === "join") {
    return "Debes unirte a esta comunidad para publicar.";
  }

  if (reason === "restricted") {
    return "No puedes publicar en esta comunidad por la configuración actual o por tu estado dentro de la comunidad.";
  }

  return "No puedes publicar en esta comunidad en este momento.";
}

export function buildCommentBlockedMessage(reason: InteractionBlockedReason): string {
  if (reason === "login") {
    return "Inicia sesión para comentar";
  }

  if (reason === "join") {
    return "Únete para comentar";
  }

  // restricted / default → leyenda corta.
  return "No puedes comentar en esta comunidad";
}
export const GROUP_FEED_PAGE_SIZE = 10;
export const GROUP_FEED_CACHE_TTL_MS = 1000 * 60 * 5;
export const VIDEO_PROCESSING_POLL_MS = 1000 * 15;
export const VIDEO_PROCESSING_MAX_POLLS = 20;
export const VIDEO_MAX_DURATION_SECONDS = 60 * 30;

export type GroupFeedCacheEntry = {
  posts: PostWithAuthorState[];
  cursor: GroupPostsPageCursor | null;
  hasMore: boolean;
  updatedAt: number;
};

export const groupFeedMemoryCache = new Map<string, GroupFeedCacheEntry>();

export function getGroupFeedCacheKey(params: {
  groupId: string;
  currentUid: string | null;
}): string {
  return ["group-feed", params.groupId, params.currentUid ?? "guest"].join(":");
}

export function sortGroupFeedPosts(
  posts: PostWithAuthorState[],
): PostWithAuthorState[] {
  return [...posts].sort((a, b) => {
    const aPinned = a.isPinnedInGroup === true;
    const bPinned = b.isPinnedInGroup === true;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    const aPinnedAt = a.groupPinnedAt?.toMillis?.() ?? 0;
    const bPinnedAt = b.groupPinnedAt?.toMillis?.() ?? 0;

    if (aPinned && bPinned && aPinnedAt !== bPinnedAt) {
      return bPinnedAt - aPinnedAt;
    }

    const aCreatedAt = a.createdAt?.toMillis?.() ?? 0;
    const bCreatedAt = b.createdAt?.toMillis?.() ?? 0;

    return bCreatedAt - aCreatedAt;
  });
}

export function mergeUniquePosts(
  currentPosts: PostWithAuthorState[],
  nextPosts: PostWithAuthorState[],
): PostWithAuthorState[] {
  const map = new Map<string, PostWithAuthorState>();

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

  return sortGroupFeedPosts(Array.from(map.values()));
}

export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(video.duration);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la duración del video."));
    };

    video.src = objectUrl;
  });
}

export function uploadVideoFileToMux(params: {
  uploadUrl: string;
  file: File;
  onProgress: (progress: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      params.onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`Mux upload falló con status ${xhr.status}.`));
    };

    xhr.onerror = () => {
      reject(new Error("Error de red al subir el video a Mux."));
    };

    xhr.open("PUT", params.uploadUrl);
    xhr.setRequestHeader("Content-Type", params.file.type || "video/mp4");
    xhr.send(params.file);
  });
}

