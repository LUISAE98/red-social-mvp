// Creación de posts con media (imagen/media/video) — parte del dominio create.
// Separado de post-service.create.ts para mantenerlo bajo 1000 líneas; usa los
// helpers de contexto compartidos, importados desde post-service.create.

import { serverTimestamp, Timestamp } from "firebase/firestore";
import { assertValidId } from "./post-service.helpers";
import { getCurrentAuthorSnapshot } from "./post-service.internal";
import { buildShareMetadata } from "./post-service.hydration";
import { buildPremiumAccessFields } from "./premium";
import { createPostOnServer } from "./createPostServer";
import { MAX_POST_IMAGES, MAX_POST_VIDEOS } from "./types";
import type { Post, PostContextType, PostMedia, PostPremium } from "./types";
import {
  resolvePostCreationContext,
  buildPostContextPayload,
  buildPostSearchIndexForContext,
  type PostCreationContext,
} from "./post-service.create";

/**
 * ¿Esta imagen es utilizable en una publicación?
 *
 * ⚠️ No basta con exigir `url`. En una comunidad privada u oculta el uploader
 * NO pide la URL de descarga a propósito —esa lleva un token permanente que abre
 * el archivo sin sesión y para siempre— y devuelve `url: ""` con la `path`
 * puesta; la URL la firma después `getRestrictedMediaUrls`. Filtrar por `url`
 * descartaba justo esas imágenes, así que la publicación salía sin fotos y sin
 * ningún error a la vista.
 */
function isUsableImageMedia(item: PostMedia): boolean {
  if (item.type !== "image") return false;

  const url = typeof item.url === "string" ? item.url.trim() : "";
  const path = typeof item.path === "string" ? item.path.trim() : "";

  return url.length > 0 || path.length > 0;
}

export async function createImagePost(params: {
  groupId: string;
  text?: string;
  media: PostMedia[];
}): Promise<void>;
export async function createImagePost(params: {
  contextType: "profile";
  profileId: string;
  text?: string;
  media: PostMedia[];
}): Promise<void>;
export async function createImagePost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  text?: string;
  media: PostMedia[];
}): Promise<void> {
  const cleanText = params.text?.trim() ?? "";
  const cleanMedia = Array.isArray(params.media)
    ? params.media.filter(isUsableImageMedia)
    : [];

  if (cleanMedia.length > MAX_POST_IMAGES) {
    throw new Error(`Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`);
  }

  if (!cleanText && cleanMedia.length === 0) {
    throw new Error("Agrega texto o una imagen antes de publicar.");
  }

  const author = await getCurrentAuthorSnapshot();
  const context = await resolvePostCreationContext({
    contextType: params.contextType,
    groupId: params.groupId,
    profileId: params.profileId,
    author,
  });

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media: cleanMedia,
    authorName: author.authorName,
    contextType: context.contextType,
    groupVisibility: context.groupVisibility,
    profileRestricted: context.profileRestricted,
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    videoData: null,
    playback: null,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  await createPostOnServer({
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,
    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,

    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,
    isShareable: shareMetadata.isShareable,
    publicSlug: shareMetadata.publicSlug,
    shareTitle: shareMetadata.shareTitle,
    shareDescription: shareMetadata.shareDescription,
    shareImageUrl: shareMetadata.shareImageUrl,
    access: "free",
    premium: null,
    media: cleanMedia,
    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },

    postType: cleanMedia.length > 0 ? "image" : "text",

    accessModel: "free",
    accessScope: context.contextType,
    requiresPayment: false,
    requiresSubscription: false,
    oneTimePrice: null,
    currency: null,
    purchaseType: null,

    liveData: null,
    videoData: null,
    scheduledData: null,
    playback: null,

    processing: {
      status: "ready",
      provider: "firebase_storage",
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
    search: buildPostSearchIndexForContext({
      text: cleanText,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
    }),
  });
}

export async function createMediaPost(params: {
  groupId: string;
  postId?: string;
  text?: string;
  imageMedia?: PostMedia[];
  videoUploads?: Array<{
    uploadId: string;
    mediaId: string;
    mediaIndex: number;
    thumbnailUrl?: string | null;
    thumbnailPath?: string | null;
  }>;
  premium?: PostPremium | null;
}): Promise<void>;
export async function createMediaPost(params: {
  contextType: "profile";
  profileId: string;
  postId?: string;
  text?: string;
  imageMedia?: PostMedia[];
  videoUploads?: Array<{
    uploadId: string;
    mediaId: string;
    mediaIndex: number;
    thumbnailUrl?: string | null;
    thumbnailPath?: string | null;
  }>;
  premium?: PostPremium | null;
}): Promise<void>;
export async function createMediaPost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  postId?: string;
  text?: string;
  imageMedia?: PostMedia[];
  videoUploads?: Array<{
    uploadId: string;
    mediaId: string;
    mediaIndex: number;
    thumbnailUrl?: string | null;
    thumbnailPath?: string | null;
  }>;
  premium?: PostPremium | null;
}): Promise<void> {
  if (params.postId) {
    assertValidId(params.postId, "postId");
  }

  const cleanText = params.text?.trim() ?? "";

  const cleanImageMedia = Array.isArray(params.imageMedia)
    ? params.imageMedia.filter(isUsableImageMedia)
    : [];

  const cleanVideoUploads = Array.isArray(params.videoUploads)
    ? params.videoUploads.filter(
        (item) =>
          typeof item.uploadId === "string" &&
          item.uploadId.trim().length > 0 &&
          typeof item.mediaId === "string" &&
          item.mediaId.trim().length > 0 &&
          Number.isInteger(item.mediaIndex) &&
          item.mediaIndex >= 0
      )
    : [];

  if (cleanImageMedia.length > MAX_POST_IMAGES) {
    throw new Error(`Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`);
  }

  if (cleanVideoUploads.length > MAX_POST_VIDEOS) {
    throw new Error("Puedes agregar máximo 3 videos por publicación.");
  }

  if (!cleanText && cleanImageMedia.length === 0 && cleanVideoUploads.length === 0) {
    throw new Error("Agrega texto, imagen o video antes de publicar.");
  }

  const author = await getCurrentAuthorSnapshot();
  const context = await resolvePostCreationContext({
    contextType: params.contextType,
    groupId: params.groupId,
    profileId: params.profileId,
    author,
  });

  const videoMedia: PostMedia[] = cleanVideoUploads.map((item) => ({
    type: "video",
    id: item.mediaId,
    index: item.mediaIndex,
    url: `mux://uploads/${item.uploadId}`,
    thumbnailUrl:
      typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim().length > 0
        ? item.thumbnailUrl.trim()
        : null,
    thumbnailPath:
      typeof item.thumbnailPath === "string" && item.thumbnailPath.trim().length > 0
        ? item.thumbnailPath.trim()
        : null,
    altText: null,
    provider: "mux",
    status: "uploading",
    uploadId: item.uploadId,
    assetId: null,
    playbackId: null,
    hlsUrl: null,
    duration: null,
  }));

  const media = [...cleanImageMedia, ...videoMedia].sort((a, b) => {
    const aIndex = typeof a.index === "number" ? a.index : Number.MAX_SAFE_INTEGER;
    const bIndex = typeof b.index === "number" ? b.index : Number.MAX_SAFE_INTEGER;

    return aIndex - bIndex;
  });

  const hasVideos = videoMedia.length > 0;
  const hasImages = cleanImageMedia.length > 0;

  const premiumAccessFields = buildPremiumAccessFields({
    premium: params.premium,
    hasVideos,
    context,
  });

  const firstVideo = videoMedia[0] ?? null;

  const videoData: Post["videoData"] = firstVideo
    ? {
        provider: "mux",
        status: "uploading",
        assetId: null,
        uploadId: firstVideo.uploadId ?? null,
        playbackId: null,
        duration: null,
        thumbnailUrl: firstVideo.thumbnailUrl ?? null,
        sourceUrl: null,
        sourcePath:
          typeof cleanVideoUploads[0]?.thumbnailPath === "string" &&
          cleanVideoUploads[0].thumbnailPath.trim().length > 0
            ? cleanVideoUploads[0].thumbnailPath.trim()
            : null,
      }
    : null;

  const playback: Post["playback"] = firstVideo
    ? {
        url: null,
        hlsUrl: null,
        thumbnailUrl: firstVideo.thumbnailUrl ?? null,
        provider: "mux",
        playbackId: null,
        duration: null,
        isReady: false,
      }
    : null;

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media,
    authorName: author.authorName,
    contextType: context.contextType,
    groupVisibility: context.groupVisibility,
    profileRestricted: context.profileRestricted,
    accessModel: premiumAccessFields.accessModel,
    requiresPayment: premiumAccessFields.requiresPayment,
    requiresSubscription: premiumAccessFields.requiresSubscription,
    premium: params.premium,
    videoData,
    playback,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  const postPayload = {
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,

    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,

    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,

    isShareable: shareMetadata.isShareable,
    publicSlug: shareMetadata.publicSlug,
    shareTitle: shareMetadata.shareTitle,
    shareDescription: shareMetadata.shareDescription,
    shareImageUrl: shareMetadata.shareImageUrl,

    ...premiumAccessFields,
    media,

    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },

    postType: hasVideos ? "video" : hasImages ? "image" : "text",

    accessScope: context.contextType,

    liveData: null,
    videoData,
    scheduledData: null,
    playback,

    processing: {
      status: hasVideos ? "uploading" : "ready",
      provider: hasVideos ? "mux" : hasImages ? "firebase_storage" : null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },

    search: buildPostSearchIndexForContext({
      text: cleanText,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
      premium: premiumAccessFields.premium,
    }),
  };

  // El flujo de video reserva el id antes de subir a Mux, así que se pasa fijo.
  await createPostOnServer(postPayload, params.postId ?? null);
}
export async function createVideoPost(params: {
  groupId: string;
  postId: string;
  uploadId: string;
  text?: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  premium?: PostPremium | null;
}): Promise<void>;
export async function createVideoPost(params: {
  contextType: "profile";
  profileId: string;
  postId: string;
  uploadId: string;
  text?: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  premium?: PostPremium | null;
}): Promise<void>;
export async function createVideoPost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  postId: string;
  uploadId: string;
  text?: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  premium?: PostPremium | null;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.uploadId, "uploadId");

  const cleanText = params.text?.trim() ?? "";
  const cleanThumbnailUrl =
    typeof params.thumbnailUrl === "string" && params.thumbnailUrl.trim().length > 0
      ? params.thumbnailUrl.trim()
      : null;
  const cleanThumbnailPath =
    typeof params.thumbnailPath === "string" && params.thumbnailPath.trim().length > 0
      ? params.thumbnailPath.trim()
      : null;

  const author = await getCurrentAuthorSnapshot();
  const context = await resolvePostCreationContext({
    contextType: params.contextType,
    groupId: params.groupId,
    profileId: params.profileId,
    author,
  });

  const premiumAccessFields = buildPremiumAccessFields({
    premium: params.premium,
    hasVideos: true,
    context,
  });

  const videoData: Post["videoData"] = {
    provider: "mux",
    status: "uploading",
    assetId: null,
    uploadId: params.uploadId,
    playbackId: null,
    duration: null,
    thumbnailUrl: cleanThumbnailUrl,
    sourceUrl: null,
    sourcePath: cleanThumbnailPath,
  };

  const playback: Post["playback"] = {
    url: null,
    hlsUrl: null,
    thumbnailUrl: cleanThumbnailUrl,
    provider: "mux",
    playbackId: null,
    duration: null,
    isReady: false,
  };

  const media: PostMedia[] = [
    {
      type: "video",
      id: params.postId,
      index: 0,
      url: `mux://uploads/${params.uploadId}`,
      thumbnailUrl: cleanThumbnailUrl,
      thumbnailPath: cleanThumbnailPath,
      altText: null,
      provider: "mux",
      status: "uploading",
      uploadId: params.uploadId,
      assetId: null,
      playbackId: null,
      hlsUrl: null,
      duration: null,
    },
  ];

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media,
    authorName: author.authorName,
    contextType: context.contextType,
    groupVisibility: context.groupVisibility,
    profileRestricted: context.profileRestricted,
    accessModel: premiumAccessFields.accessModel,
    requiresPayment: premiumAccessFields.requiresPayment,
    requiresSubscription: premiumAccessFields.requiresSubscription,
    premium: params.premium,
    videoData,
    playback,
  });

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  await createPostOnServer({
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanText,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,

    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,

    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,

    isShareable: shareMetadata.isShareable,
    publicSlug: shareMetadata.publicSlug,
    shareTitle: shareMetadata.shareTitle,
    shareDescription: shareMetadata.shareDescription,
    shareImageUrl: shareMetadata.shareImageUrl,

    ...premiumAccessFields,
    media,

    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },

    postType: "video",

    accessScope: context.contextType,

    liveData: null,
    videoData,
    scheduledData: null,
    playback,

    processing: {
      status: "uploading",
      provider: "mux",
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },

    search: buildPostSearchIndexForContext({
      text: cleanText,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
      premium: premiumAccessFields.premium,
    }),
  }, params.postId);
}
