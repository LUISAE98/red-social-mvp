// Hydration del servicio de posts (mapeo de docs → Post/Comment + estado por-viewer).
// Extraído de post-service.internal.ts para que ese núcleo no supere las 1000 líneas.
// Importa de ./post-service.internal (blocks + lookups, que son hoja) → sin ciclo.

import {
  doc,
  getDoc,
  getDocs,
  query,
  collection,
  where,
  documentId,
  orderBy,
  limit,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  pickString,
  chunkArray,
  truncateForShare,
  readGroupName,
  readGroupAvatarUrl,
  normalizeGroupVisibility,
  readProfileDisplayName,
  readProfileAvatarUrl,
  getTimestampDate,
  readTimestampMillis,
} from "./post-service.helpers";
import type { Post, Comment, CommentReply, PostContextType, PostMedia } from "./types";
import type { GroupVisibility } from "@/types/group";
import {
  attachViewerGroupMemberBlockState,
  filterPostsForViewerGroupMemberBlocks,
  fetchUsersByIds,
  fetchGroupsByIds,
  fetchProfileById,
  type UserProfileLookup,
  type GroupLookup,
} from "./post-service.internal";

export function hydratePost(
  raw: Post,
  userMap: Record<string, UserProfileLookup>,
  groupMap: Record<string, GroupLookup>
): Post {
  const profile = userMap[raw.authorId];
  const group = raw.groupId ? groupMap[raw.groupId] : undefined;

  return normalizePostMetadata({
    ...raw,
    authorName:
      profile?.displayName || raw.authorName || raw.authorId || "Usuario",
    authorAvatarUrl: profile?.avatarUrl ?? raw.authorAvatarUrl ?? null,
    authorUsername: profile?.username ?? raw.authorUsername ?? null,
    groupName: group?.name ?? raw.groupName ?? null,
    groupAvatarUrl: group?.avatarUrl ?? raw.groupAvatarUrl ?? null,
    groupVisibility: group?.visibility ?? raw.groupVisibility ?? null,
  });
}


export function getPostPrimaryShareImageUrl(post: {
  media?: PostMedia[];
  videoData?: { thumbnailUrl?: string | null } | null;
  playback?: { thumbnailUrl?: string | null } | null;
}): string | null {
  const firstMedia = Array.isArray(post.media) ? post.media[0] : null;

  return (
    firstMedia?.thumbnailUrl ||
    firstMedia?.url ||
    post.videoData?.thumbnailUrl ||
    post.playback?.thumbnailUrl ||
    null
  );
}

export function buildShareMetadata(params: {
  text: string;
  media?: PostMedia[];
  authorName?: string | null;
  contextType?: PostContextType | null;
  groupVisibility?: GroupVisibility | null;
  profileRestricted?: boolean | null;
  accessModel?: Post["accessModel"];
  requiresPayment?: boolean;
  requiresSubscription?: boolean;
  premium?: Post["premium"];
  videoData?: Post["videoData"];
  playback?: Post["playback"];
}): Pick<
  Post,
  | "isShareable"
  | "publicSlug"
  | "shareTitle"
  | "shareDescription"
  | "shareImageUrl"
> {
  const isFree =
    (params.accessModel ?? "free") === "free" &&
    params.requiresPayment !== true &&
    params.requiresSubscription !== true;

  const isPublicGroup =
    params.contextType !== "profile" && params.groupVisibility === "public";

  const isPublicProfile =
    params.contextType === "profile" && params.profileRestricted !== true;

  // Post premium con accessMode "public": visible fuera del grupo aunque sea
  // privado. NUNCA en una comunidad oculta — ahí no se expone nada hacia fuera
  // (el composer ya fuerza `members_only`, esto lo garantiza igual si el dato
  // llegara de otra vía). Misma regla que `resolveIsShareable` en el backend.
  const isPremiumPublic =
    params.premium?.enabled === true &&
    params.premium?.accessMode === "public" &&
    params.contextType !== "profile" &&
    params.groupVisibility !== "hidden";

  const cleanText = params.text.trim();

  return {
    isShareable: (isFree && (isPublicGroup || isPublicProfile)) || isPremiumPublic,
    publicSlug: null,
    shareTitle: cleanText
      ? truncateForShare(cleanText, 80)
      : params.authorName
        ? `Publicación de ${params.authorName}`
        : "Publicación",
    shareDescription: cleanText ? truncateForShare(cleanText, 180) : null,
    shareImageUrl: getPostPrimaryShareImageUrl({
      media: params.media,
      videoData: params.videoData,
      playback: params.playback,
    }),
  };
}

export function normalizePostMetadata(post: Post): Post {
  const postType = post.postType ?? "text";

  const contextType: PostContextType =
    post.contextType === "profile" || post.profileId ? "profile" : "group";

  const shareMetadata = buildShareMetadata({
    text: post.text,
    media: post.media,
    authorName: post.authorName,
    contextType,
    groupVisibility: post.groupVisibility,
    profileRestricted: post.profileRestricted,
    accessModel: post.accessModel,
    requiresPayment: post.requiresPayment,
    requiresSubscription: post.requiresSubscription,
    premium: post.premium,
    videoData: post.videoData,
    playback: post.playback,
  });

  return {
    ...post,
    postType,
    contextType,

    groupId: post.groupId ?? null,
    groupName: post.groupName ?? null,
    groupAvatarUrl: post.groupAvatarUrl ?? null,
    groupVisibility: post.groupVisibility ?? null,

    profileId: post.profileId ?? null,
    profileName: post.profileName ?? null,
    profileAvatarUrl: post.profileAvatarUrl ?? null,
    profileUsername: post.profileUsername ?? null,
    profileRestricted: post.profileRestricted ?? null,

    isShareable:
      contextType === "profile"
        ? shareMetadata.isShareable
        : post.isShareable ?? shareMetadata.isShareable,
    publicSlug: post.publicSlug ?? shareMetadata.publicSlug,
    shareTitle: post.shareTitle ?? shareMetadata.shareTitle,
    shareDescription: post.shareDescription ?? shareMetadata.shareDescription,
    shareImageUrl: post.shareImageUrl ?? shareMetadata.shareImageUrl,

    premium: post.premium ?? null,

    access: post.access ?? "free",
    accessModel: post.accessModel ?? "free",
    accessScope: post.accessScope ?? contextType,
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

export async function attachViewerFlameState(
  posts: Post[],
  viewerUid?: string | null
): Promise<Post[]> {
  const uid = viewerUid || auth.currentUser?.uid || null;

  if (!uid || posts.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasFlamed: false,
    }));
  }

  const uniquePostIds = Array.from(
    new Set(
      posts
        .map((post) => post.id)
        .filter(
          (postId): postId is string =>
            typeof postId === "string" && postId.trim().length > 0
        )
    )
  );

  if (uniquePostIds.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasFlamed: false,
    }));
  }

  const likedPostIds = new Set<string>();
  const chunks = chunkArray(uniquePostIds, 30);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "users", uid, "postFlames"),
            where(documentId(), "in", chunk)
          )
        );

        snap.docs.forEach((flameDoc) => {
          likedPostIds.add(flameDoc.id);
        });
      } catch {
        // Si falla una lectura por bloque, no rompemos el feed.
      }
    })
  );

  return posts.map((post) => ({
    ...post,
    viewerHasFlamed: likedPostIds.has(post.id),
  }));
}


export async function attachViewerSavedState(
  posts: Post[],
  viewerUid?: string | null
): Promise<Post[]> {
  const uid = viewerUid || auth.currentUser?.uid || null;

  if (!uid || posts.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasSaved: false,
    }));
  }

  const uniquePostIds = Array.from(
    new Set(
      posts
        .map((post) => post.id)
        .filter(
          (postId): postId is string =>
            typeof postId === "string" && postId.trim().length > 0
        )
    )
  );

  if (uniquePostIds.length === 0) {
    return posts.map((post) => ({
      ...post,
      viewerHasSaved: false,
    }));
  }

  const savedPostIds = new Set<string>();
  const chunks = chunkArray(uniquePostIds, 30);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "users", uid, "savedPosts"),
            where(documentId(), "in", chunk)
          )
        );

        snap.docs.forEach((savedDoc) => {
          savedPostIds.add(savedDoc.id);
        });
      } catch {
        // Si falla una lectura por bloque, no rompemos el feed.
      }
    })
  );

  return posts.map((post) => ({
    ...post,
    viewerHasSaved: savedPostIds.has(post.id),
  }));
}

export async function attachViewerPostState(
  posts: Post[],
  viewerUid?: string | null
): Promise<Post[]> {
  const withGroupMemberBlockState = await attachViewerGroupMemberBlockState(
    posts,
    viewerUid
  );

  const visiblePosts = filterPostsForViewerGroupMemberBlocks(
    withGroupMemberBlockState
  );

  // Flame y saved son independientes — se resuelven en paralelo
  const [withFlameState, withSavedState] = await Promise.all([
    attachViewerFlameState(visiblePosts, viewerUid),
    attachViewerSavedState(visiblePosts, viewerUid),
  ]);

  return withFlameState.map((post, i) => ({
    ...post,
    viewerHasSaved: withSavedState[i]?.viewerHasSaved ?? false,
  }));
}

export function hydrateComment(
  raw: Comment,
  userMap: Record<string, UserProfileLookup>
): Comment {
  const profile = userMap[raw.authorId];

  return {
    ...raw,
    authorName:
      profile?.displayName || raw.authorName || raw.authorId || "Usuario",
    authorAvatarUrl: profile?.avatarUrl ?? raw.authorAvatarUrl ?? null,
    authorUsername: profile?.username ?? raw.authorUsername ?? null,
    counts: {
      replies: raw.counts?.replies ?? 0,
      likes: raw.counts?.likes ?? 0,
    },
    viewerHasFlamed: raw.viewerHasFlamed ?? false,
    viewerHasBlockedAuthorInGroup: raw.viewerHasBlockedAuthorInGroup ?? false,
    viewerIsBlockedByAuthorInGroup: raw.viewerIsBlockedByAuthorInGroup ?? false,
  };
}

export async function attachViewerCommentFlameState(
  postId: string,
  comments: Comment[],
  viewerUid?: string | null
): Promise<Comment[]> {
  const uid = viewerUid || auth.currentUser?.uid || null;

  if (!uid || comments.length === 0) {
    return comments.map((comment) => ({
      ...comment,
      viewerHasFlamed: false,
    }));
  }

  const commentIds = Array.from(
    new Set(
      comments
        .map((comment) => comment.id)
        .filter(
          (commentId): commentId is string =>
            typeof commentId === "string" && commentId.trim().length > 0
        )
    )
  );

  if (commentIds.length === 0) {
    return comments.map((comment) => ({
      ...comment,
      viewerHasFlamed: false,
    }));
  }

  const likedCommentIds = new Set<string>();
  const chunks = chunkArray(commentIds, 30);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "users", uid, "commentFlames"),
            where("postId", "==", postId),
            where("commentId", "in", chunk)
          )
        );

        snap.docs.forEach((flameDoc) => {
          const data = flameDoc.data() as Record<string, unknown>;
          const flameCommentId =
            typeof data.commentId === "string" ? data.commentId.trim() : "";

          if (flameCommentId) {
            likedCommentIds.add(flameCommentId);
          }
        });
      } catch {
        // Si falla una lectura por bloque, no rompemos los comentarios.
      }
    })
  );

  return comments.map((comment) => ({
    ...comment,
    viewerHasFlamed: likedCommentIds.has(comment.id),
  }));
}


export function hydrateCommentReply(
  raw: CommentReply,
  userMap: Record<string, UserProfileLookup>
): CommentReply {
  const profile = userMap[raw.authorId];

  return {
    ...raw,
    authorName:
      profile?.displayName || raw.authorName || raw.authorId || "Usuario",
    authorAvatarUrl: profile?.avatarUrl ?? raw.authorAvatarUrl ?? null,
    authorUsername: profile?.username ?? raw.authorUsername ?? null,
    viewerHasBlockedAuthorInGroup: raw.viewerHasBlockedAuthorInGroup ?? false,
    viewerIsBlockedByAuthorInGroup: raw.viewerIsBlockedByAuthorInGroup ?? false,
  };
}


