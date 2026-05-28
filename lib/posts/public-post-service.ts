import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { GroupVisibility, Post, PostContextType } from "./types";

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

function getPostContextType(post: Post): PostContextType {
  const contextType = (post as any).contextType;
  const accessScope = (post as any).accessScope;

  if (
    contextType === "profile" ||
    accessScope === "profile" ||
    pickString(post.profileId) ||
    (!pickString(post.groupId) && pickString(post.authorId))
  ) {
    return "profile";
  }

  return "group";
}

function isFreePost(post: Post): boolean {
  const accessModel = post.accessModel ?? "free";
  const searchData = (post as any).search;

  return (
    post.isDeleted !== true &&
    searchData?.isDeleted !== true &&
    accessModel === "free" &&
    post.requiresPayment !== true &&
    post.requiresSubscription !== true
  );
}

function isFreePublicGroupPost(post: Post): boolean {
  return (
    isFreePost(post) &&
    getPostContextType(post) === "group" &&
    post.groupVisibility === "public" &&
    post.isShareable !== false
  );
}

function isFreePublicProfilePost(post: Post): boolean {
  return (
    isFreePost(post) &&
    getPostContextType(post) === "profile" &&
    post.profileRestricted !== true
  );
}

function normalizePublicPost(rawPost: Post): Post {
  const media = Array.isArray(rawPost.media) ? rawPost.media : [];
  const firstMedia = media[0] ?? null;
  const contextType = getPostContextType(rawPost);

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
    contextType,

    groupId: rawPost.groupId ?? null,
    groupName: rawPost.groupName ?? null,
    groupAvatarUrl: rawPost.groupAvatarUrl ?? null,
    groupVisibility: rawPost.groupVisibility ?? null,

    profileId: rawPost.profileId ?? null,
    profileName: rawPost.profileName ?? null,
    profileAvatarUrl: rawPost.profileAvatarUrl ?? null,
    profileUsername: rawPost.profileUsername ?? null,
    profileRestricted: rawPost.profileRestricted ?? null,

    access: rawPost.access ?? "free",
    accessModel: rawPost.accessModel ?? "free",
    accessScope: rawPost.accessScope ?? contextType,
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
      (cleanText ? cleanText.slice(0, 80) : "Publicación en Vibra"),
    shareDescription:
      rawPost.shareDescription ||
      (cleanText ? cleanText.slice(0, 180) : null),
    shareImageUrl,
  };
}

async function attachGroupPublicContext(rawPost: Post): Promise<Post | null> {
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

  return {
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
}

async function attachProfilePublicContext(rawPost: Post): Promise<Post | null> {
  const profileId = pickString(rawPost.profileId) || pickString(rawPost.authorId);

  if (!profileId) {
    return null;
  }

  const profileSnap = await getDoc(doc(db, "users", profileId));

  if (!profileSnap.exists()) {
    return null;
  }

  const profileData = profileSnap.data() as Record<string, unknown>;
  const showPosts = profileData.showPosts !== false;
  const profileRestricted = profileData.profileRestricted === true;

  if (!showPosts || profileRestricted) {
    return null;
  }

  const displayName =
    pickString(profileData.displayName) ||
    pickString(profileData.name) ||
    [pickString(profileData.firstName), pickString(profileData.lastName)]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    rawPost.profileName ||
    rawPost.authorName ||
    null;

  const avatarUrl =
    pickString(profileData.avatarUrl) ||
    pickString(profileData.photoURL) ||
    rawPost.profileAvatarUrl ||
    rawPost.authorAvatarUrl ||
    null;

  const username =
    pickString(profileData.username) ||
    pickString(profileData.handle) ||
    rawPost.profileUsername ||
    rawPost.authorUsername ||
    null;

  return {
    ...rawPost,
    contextType: "profile",
    profileId,
    profileName: displayName,
    profileAvatarUrl: avatarUrl,
    profileUsername: username,
    profileRestricted,
    groupId: null,
    groupName: null,
    groupAvatarUrl: null,
    groupVisibility: null,
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

  const contextType = getPostContextType(rawPost);

  const postWithContext =
    contextType === "profile"
      ? await attachProfilePublicContext(rawPost)
      : await attachGroupPublicContext(rawPost);

  if (!postWithContext) {
    return null;
  }

  const normalizedPost = normalizePublicPost(postWithContext);

  if (contextType === "profile") {
    return isFreePublicProfilePost(normalizedPost) ? normalizedPost : null;
  }

  return isFreePublicGroupPost(normalizedPost) ? normalizedPost : null;
}
//prueba