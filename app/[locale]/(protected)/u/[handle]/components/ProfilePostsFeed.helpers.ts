import type { ReactNode } from "react";
// Tipos, helpers puros, constantes y caches de ProfilePostsFeed (capa hoja).

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnlockedPostIds } from "@/lib/posts/useUnlockedPostIds";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { doc, getDoc, Timestamp } from "firebase/firestore";

import type { Comment, CommentImage, CommentMention, CommentReply, Post } from "@/lib/posts/types";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchPostComments,
  fetchUserProfilePostsPage,
  softDeletePost,
  togglePostFlame,
  togglePostSave,
  toggleProfilePostPin,
  type UserProfilePostsPageCursor,
} from "@/lib/posts/post-service";

import { db } from "@/lib/firebase";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import PostsMediaSubnav, { MEDIA_TAB_ORDER, type MediaTabKey } from "@/app/groups/[groupId]/components/posts/PostsMediaSubnav";
import MediaGallery, { type GalleryTile } from "@/app/groups/[groupId]/components/posts/MediaGallery";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import {
  buildRandomRecommendationSlots,
  getFeedRailSeed,
} from "@/app/components/GroupRecommendations/recommendation-engine";
import DonationFeedBanner from "@/app/components/DonationFeedBanner/DonationFeedBanner";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { CACHE_TTL } from "@/lib/cache/ttl";

export type DonationData = {
  mode?: string;
  enabled?: boolean;
  visible?: boolean;
  message?: string | null;
  playbackId?: string | null;
  suggestedAmounts?: number[] | null;
  currency?: string | null;
} | null | undefined;

export type ProfilePostsFeedProps = {
  profileUid: string;
  viewerUid: string | null;
  isOwner: boolean;
  showPosts?: boolean;
  profileRestricted?: boolean;
  commentsEnabled?: boolean;
  /**
   * Se pinta justo DEBAJO del subnav de medios y encima de las publicaciones.
   * Lo usa el perfil ajeno para el texto "Ver sus comunidades", que necesita ese
   * sitio exacto y no puede vivir fuera del feed porque el subnav va dentro.
   */
  belowMediaTabs?: ReactNode;
  /** Búsqueda dentro del perfil: filtra los posts por texto. */
  searchQuery?: string;
  donation?: DonationData;
  donationCreatorName?: string | null;
  donationProfilePhoto?: string | null;
  donationProfileHandle?: string | null;
  donationViewerOpen?: boolean;
  onDonate?: () => void;
  onDonationClose?: () => void;
  onDonationPay?: () => void;
};

export type MemberStatus = "active" | "muted" | "banned" | "removed" | null;
export type GroupRole = "owner" | "mod" | "member" | null;

export type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: unknown;
};

export function normalizeRole(raw: unknown): GroupRole {
  if (raw === "owner") return "owner";
  if (raw === "mod") return "mod";
  if (raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

export function normalizeStatus(raw: unknown): MemberStatus {
  if (raw === "banned") return "banned";
  if (raw === "muted") return "muted";
  if (raw === "removed" || raw === "kicked" || raw === "expelled") {
    return "removed";
  }
  if (raw === "active") return "active";
  return "active";
}

export async function getMembershipMetaForGroup(
  groupId: string,
  userId: string
): Promise<{
  status: MemberStatus;
  mutedUntil: unknown;
  role: GroupRole;
}> {
  const cacheKey = `${groupId}:${userId}`;
  const cached = membershipMetaMemoryCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      const emptyMeta = { status: null, mutedUntil: null, role: null };
      membershipMetaMemoryCache.set(cacheKey, emptyMeta);
      return emptyMeta;
    }

    const data = memberSnap.data() as { status?: string; mutedUntil?: unknown; roleInGroup?: string; role?: string };

    const meta = {
      status: normalizeStatus(data?.status),
      mutedUntil: data?.mutedUntil ?? null,
      role: normalizeRole(data?.roleInGroup ?? data?.role),
    };

    membershipMetaMemoryCache.set(cacheKey, meta);

    return meta;
  } catch {
    return { status: null, mutedUntil: null, role: null };
  }
}

export async function getViewerCanModerateGroup(
  groupId: string,
  viewerUid: string
): Promise<boolean> {
  const cacheKey = `${groupId}:${viewerUid}`;
  const cached = viewerModerationMemoryCache.get(cacheKey);

  if (typeof cached === "boolean") {
    return cached;
  }

  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    if (!groupSnap.exists()) {
      viewerModerationMemoryCache.set(cacheKey, false);
      return false;
    }

    const groupData = groupSnap.data() as { ownerId?: string; ownersIds?: string[] };

    if (groupData?.ownerId === viewerUid) {
      viewerModerationMemoryCache.set(cacheKey, true);
      return true;
    }

    const viewerMeta = await getMembershipMetaForGroup(groupId, viewerUid);

    const canModerate =
      viewerMeta.role === "mod" &&
      viewerMeta.status !== "banned" &&
      viewerMeta.status !== "removed";

    viewerModerationMemoryCache.set(cacheKey, canModerate);

    return canModerate;
  } catch {
    return false;
  }
}

export async function filterBannedGroupPosts(
  inputPosts: Post[],
  currentViewerUid: string | null
): Promise<Post[]> {
  if (!currentViewerUid || inputPosts.length === 0) {
    return inputPosts;
  }

  const uniqueGroupIds = Array.from(
    new Set(
      inputPosts
        .map((post) => post.groupId)
        .filter(
          (groupId): groupId is string =>
            typeof groupId === "string" && groupId.trim().length > 0
        )
    )
  );

  if (uniqueGroupIds.length === 0) {
    return inputPosts;
  }

  const membershipChecks = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const meta = await getMembershipMetaForGroup(groupId, currentViewerUid);
      return [groupId, meta.status === "banned"] as const;
    })
  );

  const bannedByGroupId = new Map<string, boolean>(membershipChecks);

  return inputPosts.filter((post) => {
    const groupId =
      typeof post.groupId === "string" && post.groupId.trim().length > 0
        ? post.groupId
        : null;

    if (!groupId) return true;
    return bannedByGroupId.get(groupId) !== true;
  });
}

export async function attachModerationFlags(
  posts: Post[],
  currentViewerUid: string | null
): Promise<PostWithFlags[]> {
  if (!currentViewerUid || posts.length === 0) {
    return posts as PostWithFlags[];
  }

  const uniqueGroupIds = Array.from(
    new Set(
      posts
        .map((post) => post.groupId)
        .filter(
          (groupId): groupId is string =>
            typeof groupId === "string" && groupId.trim().length > 0
        )
    )
  );

  if (uniqueGroupIds.length === 0) {
    return posts as PostWithFlags[];
  }

  const moderationEntries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const canModerate = await getViewerCanModerateGroup(groupId, currentViewerUid);
      return [groupId, canModerate] as const;
    })
  );

  const moderationMap = new Map<string, boolean>(moderationEntries);

  const authorPairs = Array.from(
    new Set(
      posts
        .filter(
          (post) =>
            typeof post.groupId === "string" &&
            post.groupId.trim().length > 0 &&
            typeof post.authorId === "string" &&
            post.authorId.trim().length > 0
        )
        .map((post) => `${post.groupId}__${post.authorId}`)
    )
  );

  const authorEntries = await Promise.all(
    authorPairs.map(async (pairKey) => {
      const separatorIndex = pairKey.indexOf("__");
      const groupId = pairKey.slice(0, separatorIndex);
      const authorId = pairKey.slice(separatorIndex + 2);
      const meta = await getMembershipMetaForGroup(groupId, authorId);
      return [pairKey, meta] as const;
    })
  );

  const authorMap = new Map<
    string,
    { status: MemberStatus; mutedUntil: unknown; role: GroupRole }
  >(authorEntries);

  return posts.map((post) => {
    const groupId =
      typeof post.groupId === "string" && post.groupId.trim().length > 0
        ? post.groupId
        : null;

    const authorId =
      typeof post.authorId === "string" && post.authorId.trim().length > 0
        ? post.authorId
        : null;

    const authorMeta =
      groupId && authorId ? authorMap.get(`${groupId}__${authorId}`) : null;

    return {
      ...post,
      canModerateGroupAuthor: !!groupId && moderationMap.get(groupId) === true,
      authorMemberStatus: authorMeta?.status ?? null,
      authorMutedUntil: authorMeta?.mutedUntil ?? null,
    };
  });
}

export function normalizeProfileFeedPost(post: PostWithFlags): PostWithFlags {
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

// Búsqueda dentro del perfil: normaliza y matchea por texto del post.
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function postMatchesQuery(post: Post, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = normalizeForSearch(typeof post.text === "string" ? post.text : "");
  return tokens.every((token) => hay.includes(token));
}

// Tope de páginas que auto-cargamos al buscar (para no traer un feed enorme).
export const SEARCH_MAX_AUTO_PAGES = 12;

export const PROFILE_FEED_PAGE_SIZE = 10;
// Publicaciones de un perfil: mismo trato que el inicio. Estaba en 5 min y
// era la razón de que volver a un perfil recargara la lista entera.
export const PROFILE_FEED_CACHE_TTL_MS = CACHE_TTL.CONTENIDO_PROPIO;
export const VIDEO_PROCESSING_POLL_MS = 15_000;
export const VIDEO_PROCESSING_MAX_POLLS = 20;

export type ProfileFeedCacheEntry = {
  posts: PostWithFlags[];
  cursor: UserProfilePostsPageCursor | null;
  hasMore: boolean;
  updatedAt: number;
};

export const profileFeedMemoryCache = new Map<string, ProfileFeedCacheEntry>();
export const membershipMetaMemoryCache = new Map<
  string,
  {
    status: MemberStatus;
    mutedUntil: unknown;
    role: GroupRole;
  }
>();

export const viewerModerationMemoryCache = new Map<string, boolean>();

export function getProfileFeedCacheKey(params: {
  profileUid: string;
  viewerUid: string | null;
  isOwner: boolean;
  showPosts: boolean;
  profileRestricted: boolean;
}): string {
  return [
    "profile-feed",
    params.profileUid,
    params.viewerUid ?? "guest",
    params.isOwner ? "owner" : "viewer",
    params.showPosts ? "show" : "hidden",
    params.profileRestricted ? "restricted" : "open",
  ].join(":");
}


export function sortProfileFeedPosts(posts: PostWithFlags[]): PostWithFlags[] {
  return [...posts].sort((a, b) => {
    const aPinned = a.isPinnedOnProfile === true;
    const bPinned = b.isPinnedOnProfile === true;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    const aPinnedAt = a.profilePinnedAt?.toMillis?.() ?? 0;
    const bPinnedAt = b.profilePinnedAt?.toMillis?.() ?? 0;

    if (aPinned && bPinned && aPinnedAt !== bPinnedAt) {
      return bPinnedAt - aPinnedAt;
    }

    const aCreatedAt = a.createdAt?.toMillis?.() ?? 0;
    const bCreatedAt = b.createdAt?.toMillis?.() ?? 0;

    return bCreatedAt - aCreatedAt;
  });
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

  return sortProfileFeedPosts(Array.from(map.values()));
}

