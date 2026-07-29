// Tipos, helpers puros, constantes y cache de SavedPostsFeed (capa hoja).

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnlockedPostIds } from "@/lib/posts/useUnlockedPostIds";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Comment, CommentImage, CommentMention, CommentReply, Post } from "@/lib/posts/types";
import {
  createPostComment,
  createPostCommentReply,
  deletePostComment,
  deletePostCommentReply,
  fetchCommentReplies,
  fetchPostComments,
  fetchSavedPostsPage,
  softDeletePost,
  togglePostFlame,
  togglePostSave,
  type SavedPostsPageCursor,
} from "@/lib/posts/post-service";

import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { loadFeedWithRetry } from "@/lib/posts/feed-load-helpers";
import {
  patchPostInAllFeedCaches,
  registerPostFeedCacheListener,
  removePostFromAllFeedCaches,
} from "@/lib/posts/post-feed-cache";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import { motion } from "framer-motion";
import PostsMediaSubnav, { MEDIA_TAB_ORDER, type MediaTabKey } from "@/app/groups/[groupId]/components/posts/PostsMediaSubnav";
import MediaGallery, { clearMediaGalleryCache, type GalleryTile } from "@/app/groups/[groupId]/components/posts/MediaGallery";

export const SAVED_POSTS_PAGE_SIZE = 10;
export const SAVED_POSTS_CACHE_TTL_MS = 5 * 60 * 1000;
export const VIDEO_PROCESSING_POLL_MS = 15_000;
export const VIDEO_PROCESSING_MAX_POLLS = 20;

export type MemberStatus = "active" | "muted" | "banned" | "removed" | null;

export type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: unknown;
};

export type SavedPostsCacheEntry = {
  posts: PostWithFlags[];
  cursor: SavedPostsPageCursor | null;
  hasMore: boolean;
  timestamp: number;
};

export const savedPostsMemoryCache = new Map<string, SavedPostsCacheEntry>();

export function mergeUniquePosts(currentPosts: PostWithFlags[], nextPosts: PostWithFlags[]) {
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

export function normalizeSavedFeedPost(post: PostWithFlags): PostWithFlags {
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
    viewerHasSaved: post.viewerHasSaved ?? true,
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

