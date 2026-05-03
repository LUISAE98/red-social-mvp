
import type { Timestamp } from "firebase/firestore";

export const MAX_POST_IMAGES = 10;
export const POST_IMAGE_MEDIA_TYPE = "image";

export type PostMediaType = "image" | "video";

export type PostMedia = {
  type: PostMediaType;
  url: string;
  path?: string;
  width?: number;
  height?: number;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
};

export type PostCounts = {
  comments?: number;
  likes?: number;
};

export type PostReactionType = "flame";

export type PostReaction = {
  id: string;
  postId: string;
  userId: string;
  type: PostReactionType;
  createdAt?: Timestamp | null;
};

export type GroupVisibility = "public" | "private" | "hidden";

export type PostType = "text" | "image" | "video" | "live" | "scheduled_event";

export type PostAccessModel = "free" | "one_time_purchase";

export type PostAccessScope = "group" | "profile";

export type PostPurchaseType = "post" | "video" | "live" | "event" | null;

export type LiveStatus =
  | "draft"
  | "scheduled"
  | "upcoming"
  | "live"
  | "ended"
  | "cancelled"
  | "error";

export type VideoStatus =
  | "none"
  | "uploading"
  | "processing"
  | "ready"
  | "error";

export type ScheduledStatus =
  | "draft"
  | "scheduled"
  | "cancelled"
  | "completed";

export type PlaybackProvider = "mux" | "hls" | "firebase_storage" | null;

export type ProcessingStatus =
  | "none"
  | "pending"
  | "uploading"
  | "processing"
  | "ready"
  | "error";

export type PostLiveData = {
  status?: LiveStatus;
  title?: string | null;
  description?: string | null;
  scheduledStartAt?: Timestamp | null;
  startedAt?: Timestamp | null;
  endedAt?: Timestamp | null;
  streamProvider?: "mux" | "custom_hls" | null;
  liveStreamId?: string | null;
  playbackId?: string | null;
  streamKey?: string | null;
  ingestUrl?: string | null;
};

export type PostVideoData = {
  status?: VideoStatus;
  assetId?: string | null;
  uploadId?: string | null;
  playbackId?: string | null;
  duration?: number | null;
  thumbnailUrl?: string | null;
  sourceUrl?: string | null;
  sourcePath?: string | null;
};

export type PostScheduledData = {
  status?: ScheduledStatus;
  startsAt?: Timestamp | null;
  endsAt?: Timestamp | null;
  timezone?: string | null;
  title?: string | null;
  description?: string | null;
};

export type PostPlayback = {
  url?: string | null;
  hlsUrl?: string | null;
  thumbnailUrl?: string | null;
  provider?: PlaybackProvider;
  playbackId?: string | null;
  duration?: number | null;
  isReady?: boolean;
};

export type PostProcessing = {
  status?: ProcessingStatus;
  provider?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  updatedAt?: Timestamp | null;
};

export type Post = {
  id: string;
  text: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  deletedAt?: Timestamp | null;

  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  authorUsername?: string | null;

  groupId: string;
  groupName?: string | null;
  groupAvatarUrl?: string | null;
  groupVisibility?: GroupVisibility | null;

  isDeleted: boolean;
  isLocked?: boolean;

  /**
   * Permite que una publicación pueda abrirse desde una ruta pública compartible.
   * Solo debe usarse para posts públicos/free y de grupos públicos.
   */
  isShareable?: boolean;

  /**
   * Slug público opcional para compartir.
   * Si no existe, la URL pública puede usar el postId.
   */
  publicSlug?: string | null;

  /**
   * Texto corto opcional para previews externos.
   * Si no existe, se puede usar una versión recortada de text.
   */
  shareTitle?: string | null;

  /**
   * Descripción corta opcional para metadata/Open Graph.
   * Si no existe, se puede derivar desde text.
   */
  shareDescription?: string | null;

  /**
   * Imagen principal para preview al compartir.
   * Puede venir de media[0], video thumbnail o una imagen generada por metadata.
   */
  shareImageUrl?: string | null;

  access?: "free" | "paid";
  media?: PostMedia[];
  counts?: PostCounts;

  /**
   * Estado calculado para la UI del usuario actual.
   * No es obligatorio que exista en Firestore.
   */
  viewerHasFlamed?: boolean;

  postType?: PostType;

  accessModel?: PostAccessModel;
  accessScope?: PostAccessScope;
  requiresPayment?: boolean;
  requiresSubscription?: boolean;
  oneTimePrice?: number | null;
  currency?: string | null;
  purchaseType?: PostPurchaseType;

  liveData?: PostLiveData | null;
  videoData?: PostVideoData | null;
  scheduledData?: PostScheduledData | null;
  playback?: PostPlayback | null;
  processing?: PostProcessing | null;
};

export type CommentCounts = {
  replies?: number;
  likes?: number;
};

export type CommentReactionType = "flame";

export type CommentReaction = {
  id: string;
  postId: string;
  commentId: string;
  userId: string;
  type: CommentReactionType;
  createdAt?: Timestamp | null;
};

export type Comment = {
  id: string;
  text: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;

  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  authorUsername?: string | null;

  counts?: CommentCounts;

  /**
   * Estado calculado para la UI del usuario actual.
   * No es obligatorio que exista en Firestore.
   */
  viewerHasFlamed?: boolean;
};

export type CommentReply = {
  id: string;
  text: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;

  postId: string;
  commentId: string;

  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  authorUsername?: string | null;
};