// Creación de posts del servicio de posts (texto/live/imagen/media/video).
// Extraído de post-service.ts; post-service.ts lo re-exporta (barrel).

import {
  collection, doc, addDoc, getDoc, getDocs, query, where, limit,
  setDoc, serverTimestamp, writeBatch, runTransaction, Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  pickString,
  assertValidId,
  normalizePostingMode,
  normalizeGroupVisibility,
  readGroupAvatarUrl,
  readGroupName,
} from "./post-service.helpers";
import { getCurrentAuthorSnapshot, fetchProfileById, type AuthorSnapshot } from "./post-service.internal";
import { buildShareMetadata } from "./post-service.hydration";
import { assertMembershipCanInteract, resolveEffectiveMembershipStatus } from "./post-service.access";
import { buildPremiumAccessFields } from "./premium";
import { buildPostSearchIndex } from "./postSearchIndex";
import { MAX_POST_IMAGES, MAX_POST_VIDEOS } from "./types";
import type {
  Post, PostContextType, PostLiveData, PostMedia, PostPremium, LiveVisibilityMode,
} from "./types";
import { normalizeGroupCategory, normalizeGroupTags } from "@/types/group";
import type { GroupVisibility, CanonicalGroupCategory } from "@/types/group";

type PostCreationContext = {
  contextType: PostContextType;
  groupId: string | null;
  groupVisibility: GroupVisibility | null;
  groupCategory: CanonicalGroupCategory | null;
  groupTags: string[];
  groupName: string | null;
  groupAvatarUrl: string | null;
  profileId: string | null;
  profileName: string | null;
  profileAvatarUrl: string | null;
  profileUsername: string | null;
  profileRestricted: boolean | null;
};
async function resolvePostCreationContext(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  author: AuthorSnapshot;
}): Promise<PostCreationContext> {
  const contextType: PostContextType = params.contextType === "profile" ? "profile" : "group";

  if (contextType === "profile") {
    const profileId = pickString(params.profileId) || params.author.uid;

    if (profileId !== params.author.uid) {
      throw new Error("Solo puedes publicar en tu propio perfil.");
    }

    const profile = await fetchProfileById(profileId);

    return {
      contextType: "profile",
      groupId: null,
      groupVisibility: null,
      groupCategory: null,
      groupTags: [],
      groupName: null,
      groupAvatarUrl: null,
      profileId,
      profileName: profile.displayName || params.author.authorName,
      profileAvatarUrl: profile.avatarUrl ?? params.author.authorAvatarUrl,
      profileUsername: profile.username ?? params.author.authorUsername,
      profileRestricted: profile.profileRestricted,
    };
  }

  const groupId = pickString(params.groupId);
  if (!groupId) {
    throw new Error("Falta groupId.");
  }

  // Una sola lectura paralela — antes eran 3 lecturas seriales (grupo → miembro → grupo de nuevo)
  const [groupSnap, memberSnap] = await Promise.all([
    getDoc(doc(db, "groups", groupId)),
    getDoc(doc(db, "groups", groupId, "members", params.author.uid)),
  ]);

  if (!groupSnap.exists()) {
    throw new Error("La comunidad no existe.");
  }

  const groupData = groupSnap.data() as Record<string, unknown>;
  const ownerId = pickString(groupData.ownerId);
  const isActive = groupData.isActive !== false;
  const permissions =
    groupData.permissions && typeof groupData.permissions === "object"
      ? (groupData.permissions as Record<string, unknown>)
      : null;
  const postingMode = normalizePostingMode(
    permissions?.postingMode ?? groupData.postingMode,
  );
  const groupVisibility = normalizeGroupVisibility(groupData.visibility);

  if (!isActive) {
    throw new Error("Esta comunidad está inactiva.");
  }

  if (ownerId !== params.author.uid) {
    if (!memberSnap.exists()) {
      throw new Error("Debes pertenecer a la comunidad para realizar esta acción.");
    }
    const memberData = memberSnap.data() as Record<string, unknown>;
    const membershipStatus = resolveEffectiveMembershipStatus(
      memberData.status,
      memberData.mutedUntil,
    );
    assertMembershipCanInteract(membershipStatus);

    if (postingMode === "owner_only") {
      throw new Error("Solo el owner puede publicar en esta comunidad.");
    }
  }

  if (!groupVisibility) {
    throw new Error("No se pudo resolver la visibilidad del grupo.");
  }

  return {
    contextType: "group",
    groupId,
    groupVisibility,
    groupCategory: normalizeGroupCategory(groupData.category),
    groupTags: normalizeGroupTags(groupData.tags),
    groupName: readGroupName(groupData),
    groupAvatarUrl: readGroupAvatarUrl(groupData),
    profileId: null,
    profileName: null,
    profileAvatarUrl: null,
    profileUsername: null,
    profileRestricted: null,
  };
}

function buildPostContextPayload(context: PostCreationContext) {
  return {
    contextType: context.contextType,
    groupId: context.groupId,
    groupName: context.groupName,
    groupAvatarUrl: context.groupAvatarUrl,
    groupVisibility: context.groupVisibility,
    groupCategory: context.groupCategory ?? null,
    groupTags: context.groupTags ?? [],
    profileId: context.profileId,
    profileName: context.profileName,
    profileAvatarUrl: context.profileAvatarUrl,
    profileUsername: context.profileUsername,
    profileRestricted: context.profileRestricted,
  };
}

function buildPostSearchIndexForContext(params: {
  text: string;
  authorId: string;
  context: PostCreationContext;
  isDeleted: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  premium?: PostPremium | null;
}) {
  const premium = params.premium?.enabled === true ? params.premium : null;

  if (params.context.contextType === "group") {
    if (!params.context.groupId || !params.context.groupVisibility) {
      return null;
    }

    const groupSearch = buildPostSearchIndex({
      text: params.text,
      groupId: params.context.groupId,
      groupVisibility: params.context.groupVisibility,
      authorId: params.authorId,
      accessScope: "group",
      isDeleted: params.isDeleted,
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
    });

    return {
      ...groupSearch,
      contextType: "group" as const,
      premiumEnabled: premium?.enabled === true,
      premiumAccessMode: premium?.accessMode ?? null,
      premiumFreeFor: premium?.freeFor ?? null,
    };
  }

  const profileSearch = buildPostSearchIndex({
    text: params.text,
    groupId: "__profile__",
    groupVisibility: "public",
    authorId: params.authorId,
    accessScope: "profile",
    isDeleted: params.isDeleted,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  });

  return {
    ...profileSearch,
    contextType: "profile" as const,
    groupId: null,
    profileId: params.context.profileId,
    visibility: "public",
    accessScope: "profile" as const,
    premiumEnabled: premium?.enabled === true,
    premiumAccessMode: premium?.accessMode ?? null,
    premiumFreeFor: premium?.freeFor ?? null,
  };
}
async function enforcePostRateLimit(): Promise<void> {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error("Debes iniciar sesión.");
  const INTERVAL_MS = 10_000;
  const MAX_PER_HOUR = 20;
  const docRef = doc(db, "rateLimits", `${user.uid}_post`);
  const nowMs = Date.now();
  const oneHourAgoMs = nowMs - 60 * 60 * 1000;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      let lastAtMs = 0;
      let hourTimestamps: Timestamp[] = [];
      if (snap.exists()) {
        const data = snap.data()!;
        const lastAt = data.lastAt as Timestamp | undefined;
        lastAtMs = lastAt ? lastAt.toMillis() : 0;
        hourTimestamps = ((data.hourTimestamps as Timestamp[]) ?? []).filter(
          (ts: Timestamp) => ts.toMillis() > oneHourAgoMs
        );
      }
      if (nowMs - lastAtMs < INTERVAL_MS) {
        const waitSec = Math.ceil((INTERVAL_MS - (nowMs - lastAtMs)) / 1000);
        throw new Error(`Espera ${waitSec}s antes de publicar de nuevo.`);
      }
      if (hourTimestamps.length >= MAX_PER_HOUR) {
        throw new Error(`Alcanzaste el límite de ${MAX_PER_HOUR} publicaciones por hora.`);
      }
      const nowTs = Timestamp.fromMillis(nowMs);
      tx.set(docRef, { lastAt: nowTs, hourTimestamps: [...hourTimestamps, nowTs] });
    });
  } catch (err: unknown) {
    const isFirestorePermissionError =
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "permission-denied";
    if (isFirestorePermissionError) {
      console.error("[enforcePostRateLimit] Firestore permission denied on rateLimits write:", err);
      // Regla de rate limit bloqueada — no interrumpir la publicación por esto
      return;
    }
    throw err;
  }
}

export async function createTextPost(params: {
  groupId: string;
  text: string;
}): Promise<string>;
export async function createTextPost(params: {
  contextType: "profile";
  profileId: string;
  text: string;
}): Promise<string>;
export async function createTextPost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  text: string;
}): Promise<string> {
  const cleanText = params.text.trim();
  if (!cleanText) {
    throw new Error("Escribe un texto antes de publicar.");
  }

  // Arrancar el rate limit inmediatamente — no necesita datos del autor
  const rateLimitPromise = enforcePostRateLimit();
  const author = await getCurrentAuthorSnapshot();
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    rateLimitPromise,
  ]);

  const shareMetadata = buildShareMetadata({
    text: cleanText,
    media: [],
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

  const ref = await addDoc(collection(db, "posts"), {
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
    media: [],
    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },
    search: buildPostSearchIndexForContext({
      text: cleanText,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
    }),
    postType: "text",

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
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
  });
  return ref.id;
}

export async function createLivePost(params: {
  groupId: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  scheduledStartAt?: Date | null;
  scheduleHasTime?: boolean | null;
  visibilityMode?: LiveVisibilityMode | null;
  allowLoggedOutViewers?: boolean | null;
  accessType?: "free" | "paid" | null;
  ticketPrice?: number | null;
  currency?: "MXN" | "USD" | null;
  paidAccessMode?: "everyone_pays" | "members_free_non_members_pay" | null;
  broadcastGroupIds?: string[] | null;
}): Promise<string>;
export async function createLivePost(params: {
  contextType: "profile";
  profileId: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  scheduledStartAt?: Date | null;
  scheduleHasTime?: boolean | null;
  visibilityMode?: LiveVisibilityMode | null;
  allowLoggedOutViewers?: boolean | null;
  accessType?: "free" | "paid" | null;
  ticketPrice?: number | null;
  currency?: "MXN" | "USD" | null;
  paidAccessMode?: "everyone_pays" | "members_free_non_members_pay" | null;
  broadcastGroupIds?: string[] | null;
}): Promise<string>;
export async function createLivePost(params: {
  contextType?: PostContextType;
  groupId?: string | null;
  profileId?: string | null;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  scheduledStartAt?: Date | null;
  scheduleHasTime?: boolean | null;
  visibilityMode?: LiveVisibilityMode | null;
  allowLoggedOutViewers?: boolean | null;
  accessType?: "free" | "paid" | null;
  ticketPrice?: number | null;
  currency?: "MXN" | "USD" | null;
  paidAccessMode?: "everyone_pays" | "members_free_non_members_pay" | null;
  broadcastGroupIds?: string[] | null;
}): Promise<string> {
  const cleanTitle = params.title.trim();
  if (!cleanTitle) {
    throw new Error("El título del live es obligatorio.");
  }

  const rateLimitPromise = enforcePostRateLimit();
  const author = await getCurrentAuthorSnapshot();
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    rateLimitPromise,
  ]);

  const createdFrom: "profile" | "group" =
    context.contextType === "profile" ? "profile" : "group";

  const scheduledStartAt = params.scheduledStartAt
    ? Timestamp.fromDate(params.scheduledStartAt)
    : null;

  const effectiveMode: LiveVisibilityMode = params.visibilityMode ?? "everyone";
  const effectiveAccessType = params.accessType ?? "free";
  const isPaidLive = effectiveAccessType === "paid";
  // Seguridad: un live en comunidad OCULTA nunca es compartible ni visible para
  // deslogueados (no debe filtrarse fuera de la comunidad).
  const isHiddenGroupLive = context.groupVisibility === "hidden";

  const cleanBroadcastIds = (params.broadcastGroupIds ?? []).filter(
    (id) => typeof id === "string" && id.trim().length > 0 && id !== (params.groupId ?? ""),
  );

  const liveData: PostLiveData = {
    status: "upcoming",
    title: cleanTitle,
    description: params.description?.trim() || null,
    coverUrl: params.coverUrl ?? null,
    scheduledStartAt,
    scheduleHasTime: scheduledStartAt ? (params.scheduleHasTime ?? true) : null,
    startedAt: null,
    endedAt: null,
    streamProvider: null,
    liveStreamId: null,
    playbackId: null,
    streamKey: null,
    ingestUrl: null,
    createdFrom,
    visibilityMode: effectiveMode,
    allowLoggedOutViewers: effectiveMode === "everyone" && !isHiddenGroupLive,
    accessType: effectiveAccessType,
    ticketPrice: isPaidLive ? (params.ticketPrice ?? null) : null,
    currency: isPaidLive ? (params.currency ?? "MXN") : null,
    paidAccessMode: isPaidLive ? (params.paidAccessMode ?? "everyone_pays") : null,
    broadcastGroupIds: cleanBroadcastIds.length > 0 ? cleanBroadcastIds : null,
  };

  const isGroupLive = context.contextType !== "profile";
  const isProfileLive = context.contextType === "profile";
  const pinnedAt = serverTimestamp();

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  const ref = await addDoc(collection(db, "posts"), {
    ...buildPostContextPayload(context),
    authorId: author.uid,
    authorName: author.authorName,
    authorAvatarUrl: author.authorAvatarUrl,
    authorUsername: author.authorUsername,
    text: cleanTitle,
    createdAt,
    updatedAt,
    deletedAt: null,
    isDeleted: false,
    isPinnedInGroup: isGroupLive,
    groupPinnedAt: isGroupLive ? pinnedAt : null,
    groupPinnedBy: isGroupLive ? author.uid : null,
    isPinnedOnProfile: isProfileLive,
    profilePinnedAt: isProfileLive ? pinnedAt : null,
    profilePinnedBy: isProfileLive ? author.uid : null,
    isShareable: effectiveMode !== "members_only" && !isHiddenGroupLive,
    publicSlug: null,
    shareTitle: cleanTitle,
    shareDescription: params.description?.trim() || null,
    shareImageUrl: params.coverUrl ?? null,
    access: "free",
    premium: null,
    media: [],
    counts: {
      comments: 0,
      likes: 0,
      saves: 0,
    },
    search: buildPostSearchIndexForContext({
      text: cleanTitle,
      authorId: author.uid,
      context,
      isDeleted: false,
      createdAt: searchTimestamp,
      updatedAt: searchTimestamp,
    }),
    postType: "live",
    accessModel: isPaidLive ? "paid" : "free",
    accessScope: context.contextType,
    requiresPayment: isPaidLive,
    requiresSubscription: false,
    oneTimePrice: isPaidLive ? (params.ticketPrice ?? null) : null,
    currency: isPaidLive ? (params.currency ?? "MXN") : null,
    purchaseType: isPaidLive ? "one_time" : null,
    liveData,
    videoData: null,
    scheduledData: null,
    playback: null,
    processing: {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
  });

  const postId = ref.id;

  // Auto-pin: desfijar cualquier post previamente fijado en el mismo contexto
  if (isGroupLive && params.groupId) {
    const prevPinnedSnap = await getDocs(
      query(
        collection(db, "posts"),
        where("groupId", "==", params.groupId),
        where("isDeleted", "==", false),
        where("isPinnedInGroup", "==", true),
        limit(5),
      ),
    );
    const toUnpin = prevPinnedSnap.docs.filter((d) => d.id !== postId);
    if (toUnpin.length > 0) {
      const batch = writeBatch(db);
      for (const d of toUnpin) {
        batch.update(d.ref, {
          isPinnedInGroup: false,
          groupPinnedAt: null,
          groupPinnedBy: null,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } else if (isProfileLive) {
    const profileId = params.profileId ?? author.uid;
    try {
      await setDoc(
        doc(db, "users", profileId, "profileFeed", postId),
        {
          postId,
          authorId: author.uid,
          isPinnedOnProfile: true,
          profilePinnedAt: Timestamp.now(),
          profilePinnedBy: author.uid,
          updatedAt: Timestamp.now(),
          syncedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } catch {
      // profileFeed is managed by Cloud Functions; client write may be denied
    }
  }

  return postId;
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
    ? params.media.filter(
        (item) =>
          item.type === "image" &&
          typeof item.url === "string" &&
          item.url.trim().length > 0
      )
    : [];

  if (cleanMedia.length > MAX_POST_IMAGES) {
    throw new Error(`Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`);
  }

  if (!cleanText && cleanMedia.length === 0) {
    throw new Error("Agrega texto o una imagen antes de publicar.");
  }

  const author = await getCurrentAuthorSnapshot();
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    enforcePostRateLimit(),
  ]);

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

  await addDoc(collection(db, "posts"), {
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
    ? params.imageMedia.filter(
        (item) =>
          item.type === "image" &&
          typeof item.url === "string" &&
          item.url.trim().length > 0
      )
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
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    enforcePostRateLimit(),
  ]);

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

  if (params.postId) {
    await setDoc(doc(db, "posts", params.postId), postPayload);
    return;
  }

  await addDoc(collection(db, "posts"), postPayload);
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
  const [context] = await Promise.all([
    resolvePostCreationContext({
      contextType: params.contextType,
      groupId: params.groupId,
      profileId: params.profileId,
      author,
    }),
    enforcePostRateLimit(),
  ]);

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

  await setDoc(doc(db, "posts", params.postId), {
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
  }, { merge: true });
}
