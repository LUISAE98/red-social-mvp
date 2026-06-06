import type { Timestamp } from "firebase/firestore";

export const MAX_POST_IMAGES = 10;
export const MAX_POST_VIDEOS = 3;

export const POST_IMAGE_MEDIA_TYPE = "image";
export const POST_VIDEO_MEDIA_TYPE = "video";

export type PostMediaType = "image" | "video";

export type PostMedia = {
  type: PostMediaType;

  /**
   * Para imágenes: URL final en Firebase Storage.
   * Para videos Mux en proceso: puede iniciar vacío y llenarse cuando el webhook marque ready.
   */
  url: string;

  /**
   * Identificador estable del item dentro de media[].
   * Útil para actualizar videos individuales desde webhooks sin depender solo del índice.
   */
  id?: string;

  /**
   * Índice dentro de media[] al momento de crear el post.
   */
  index?: number;

  path?: string;
  width?: number;
  height?: number;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  altText?: string | null;

  /**
   * Campos para videos.
   * Mantienen compatibilidad con videoData/playback raíz,
   * pero permiten varios videos como items separados dentro de media[].
   */
  provider?: VideoProvider;
  status?: VideoStatus;
  uploadId?: string | null;
  assetId?: string | null;
  playbackId?: string | null;
  hlsUrl?: string | null;
  duration?: number | null;
};

export type PostCounts = {
  comments?: number;
  likes?: number;
  saves?: number;
};

export type PostReactionType = "flame";

export type PostReaction = {
  id: string;
  postId: string;
  userId: string;
  type: PostReactionType;
  createdAt?: Timestamp | null;
};

export type PostSave = {
  id: string;
  postId: string;
  userId: string;
  createdAt?: Timestamp | null;
};

export type GroupVisibility = "public" | "private" | "hidden";

export type GroupMemberBlock = {
  id: string;
  groupId: string;
  blockerId: string;
  blockedUserId: string;
  createdAt?: Timestamp | null;
};

export type GroupMemberBlockRelationship = {
  hasBlocked: boolean;
  isBlockedBy: boolean;
};

export type PostType = "text" | "image" | "video" | "live" | "scheduled_event";

export type PostAccessModel = "free" | "one_time_purchase";

export type PostContextType = "group" | "profile";

export type PostAccessScope = "group" | "profile";

export type PostPremiumKind = "video";

export type PostPremiumAccessMode = "members_only" | "public";

export type PostPremiumFreeFor =
  | "none"
  | "members_and_subscribers";

export type PostPremiumPurchaseType = "one_time";

export type PostPremiumCurrency = "MXN";

export type PostPremium = {
  enabled: boolean;
  kind: PostPremiumKind;
  accessMode: PostPremiumAccessMode;
  freeFor: PostPremiumFreeFor;
  price?: number | null;
  currency?: PostPremiumCurrency;
  purchaseType: PostPremiumPurchaseType;
};

export type PostSearchIndex = {
  textNormalized: string;
  tokens: string[];
  prefixes: string[];

  contextType?: PostContextType | null;

  groupId?: string | null;
  profileId?: string | null;

  authorId: string;
  visibility?: GroupVisibility | null;
  accessScope?: PostAccessScope | null;

  /**
   * Campos derivados para búsquedas, feeds y estados locked/premium.
   * No sustituyen a post.premium; solo duplican datos mínimos indexables.
   */
  premiumEnabled?: boolean;
  premiumAccessMode?: PostPremiumAccessMode | null;
  premiumFreeFor?: PostPremiumFreeFor | null;

  isDeleted: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  version: 2;
};

export type PostPurchaseType = "post" | "video" | "live" | "event" | null;

export type PostAccessStatus =
  | "pending_payment"
  | "active"
  | "revoked"
  | "refunded"
  | "failed";

export type PostAccessSource = "mercado_pago" | null;

export type PostAccess = {
  id: string;
  postId: string;
  buyerId: string;
  creatorId: string;

  groupId?: string | null;
  profileId?: string | null;
  contextType: PostContextType;

  status: PostAccessStatus;
  source?: PostAccessSource;

  paymentId?: string | null;
  orderId?: string | null;

  purchaseType: PostPremiumPurchaseType;
  price: number;
  currency: PostPremiumCurrency;

  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  paidAt?: Timestamp | null;
  revokedAt?: Timestamp | null;

  /**
   * Compra única: no expira.
   */
  expiresAt?: null;
};

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

export type VideoProvider = "mux" | "firebase_storage" | null;

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
  provider?: VideoProvider;
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

  contextType?: PostContextType;

  groupId?: string | null;
  groupName?: string | null;
  groupAvatarUrl?: string | null;
  groupVisibility?: GroupVisibility | null;

  profileId?: string | null;
  profileName?: string | null;
  profileAvatarUrl?: string | null;
  profileUsername?: string | null;
  profileRestricted?: boolean | null;

  isDeleted: boolean;
  isLocked?: boolean;

  /**
   * Permite fijar una publicación arriba del feed del grupo.
   * Solo debe poder cambiarse desde backend seguro validando owner del grupo.
   */
  isPinnedInGroup?: boolean;
  groupPinnedAt?: Timestamp | null;
  groupPinnedBy?: string | null;

  /**
   * Permite fijar una publicación arriba del feed del perfil del autor.
   * Solo debe poder cambiarse desde backend seguro validando dueño del perfil.
   */
  isPinnedOnProfile?: boolean;
  profilePinnedAt?: Timestamp | null;
  profilePinnedBy?: string | null;

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

  /**
   * Configuración premium opcional.
   * Si no existe, el post se considera gratuito/legacy.
   * En esta fase solo debe usarse para posts con video.
   */
  premium?: PostPremium | null;

  media?: PostMedia[];
  counts?: PostCounts;

  /**
   * Estado calculado para la UI del usuario actual.
   * No es obligatorio que exista en Firestore.
   */
  viewerHasFlamed?: boolean;

  /**
   * Estado calculado para la UI del usuario actual.
   * No es obligatorio que exista en Firestore.
   */
  viewerHasSaved?: boolean;
  viewerHasBlockedAuthorInGroup?: boolean;
  viewerIsBlockedByAuthorInGroup?: boolean;

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
  search?: PostSearchIndex | null;
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

  viewerHasBlockedAuthorInGroup?: boolean;
  viewerIsBlockedByAuthorInGroup?: boolean;

  /** Solo presente en posts premium de grupo. false = accedió por compra (no es miembro/suscriptor). */
  authorIsGroupMember?: boolean;
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

  viewerHasBlockedAuthorInGroup?: boolean;
  viewerIsBlockedByAuthorInGroup?: boolean;

  /** Solo presente en posts premium de grupo. false = accedió por compra (no es miembro/suscriptor). */
  authorIsGroupMember?: boolean;
};