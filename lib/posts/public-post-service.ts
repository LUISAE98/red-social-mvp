import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { GroupVisibility, Post } from "./types";

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeGroupVisibility(value: unknown): GroupVisibility | null {
  if (value === "public" || value === "private" || value === "hidden") {
    return value;
  }

  return null;
}

function isFreePublicPost(post: Post): boolean {
  const accessModel = post.accessModel ?? "free";

  return (
    post.isDeleted !== true &&
    post.groupVisibility === "public" &&
    post.isShareable !== false &&
    accessModel === "free" &&
    post.requiresPayment !== true &&
    post.requiresSubscription !== true
  );
}

function normalizePublicPost(rawPost: Post): Post {
  const media = Array.isArray(rawPost.media) ? rawPost.media : [];

  const firstMedia = media[0] ?? null;

  const shareImageUrl =
    rawPost.shareImageUrl ||
    firstMedia?.thumbnailUrl ||
    firstMedia?.url ||
    rawPost.videoData?.thumbnailUrl ||
    rawPost.playback?.thumbnailUrl ||
    null;

  const cleanText = rawPost.text?.trim() ?? "";

  return {
    ...rawPost,
    text: cleanText,
    access: rawPost.access ?? "free",
    accessModel: rawPost.accessModel ?? "free",
    accessScope: rawPost.accessScope ?? "group",
    requiresPayment: rawPost.requiresPayment ?? false,
    requiresSubscription: rawPost.requiresSubscription ?? false,
    oneTimePrice: rawPost.oneTimePrice ?? null,
    currency: rawPost.currency ?? null,
    purchaseType: rawPost.purchaseType ?? null,
    media,
    counts: {
      comments: rawPost.counts?.comments ?? 0,
      likes: rawPost.counts?.likes ?? 0,
      saves: rawPost.counts?.saves ?? 0,
    },
    isLocked: false,
    viewerHasFlamed: false,
    viewerHasSaved: false,
    postType: rawPost.postType ?? (media.length > 0 ? "image" : "text"),
    liveData: rawPost.liveData ?? null,
    videoData: rawPost.videoData ?? null,
    scheduledData: rawPost.scheduledData ?? null,
    playback: rawPost.playback ?? null,
    processing: rawPost.processing ?? {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
    shareTitle:
      rawPost.shareTitle ||
      (cleanText ? cleanText.slice(0, 80) : "Publicación"),
    shareDescription:
      rawPost.shareDescription ||
      (cleanText ? cleanText.slice(0, 180) : null),
    shareImageUrl,
  };
}

export async function fetchPublicPostById(postId: string): Promise<Post | null> {
  const cleanPostId = postId.trim();

  if (!cleanPostId) {
    return null;
  }

  const postSnap = await getDoc(doc(db, "posts", cleanPostId));

  if (!postSnap.exists()) {
    return null;
  }

  const rawPost = {
    id: postSnap.id,
    ...(postSnap.data() as Omit<Post, "id">),
  } as Post;

  const groupId = pickString(rawPost.groupId);

  if (!groupId) {
    return null;
  }

  const groupSnap = await getDoc(doc(db, "groups", groupId));

  if (!groupSnap.exists()) {
    return null;
  }

  const groupData = groupSnap.data() as Record<string, unknown>;
  const groupVisibility = normalizeGroupVisibility(groupData.visibility);

  const postWithGroup: Post = {
    ...rawPost,
    groupName:
      pickString(groupData.name) ||
      pickString(groupData.title) ||
      rawPost.groupName ||
      null,
    groupAvatarUrl:
      pickString(groupData.avatarUrl) ||
      pickString(groupData.photoURL) ||
      rawPost.groupAvatarUrl ||
      null,
    groupVisibility,
  };

  const normalizedPost = normalizePublicPost(postWithGroup);

  if (!isFreePublicPost(normalizedPost)) {
    return null;
  }

  return normalizedPost;
}