// Creación de posts del servicio de posts (texto/live/imagen/media/video).
// Extraído de post-service.ts; post-service.ts lo re-exporta (barrel).

import {
  collection, doc, getDoc, getDocs, query, where, limit,
  setDoc, serverTimestamp, writeBatch, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
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
import { createPostOnServer } from "./createPostServer";
import type {
  Post, PostContextType, PostLiveData, PostMedia, PostPremium, LiveVisibilityMode,
} from "./types";
import { normalizeGroupCategory, normalizeGroupTags } from "@/types/group";
import type { GroupVisibility, CanonicalGroupCategory } from "@/types/group";

export type PostCreationContext = {
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
export async function resolvePostCreationContext(params: {
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
      throw new Error("Solo el creador puede publicar en esta comunidad.");
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

export function buildPostContextPayload(context: PostCreationContext) {
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

export function buildPostSearchIndexForContext(params: {
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
// El control de ritmo ya no se llama por separado desde el cliente: vive DENTRO
// de la transacción del callable `createPost` (`backend/src/createPost.ts`).
// Llamarlo aquí además consumiría dos cupos por publicación y el intervalo de
// 10 s bloquearía la escritura que viene justo detrás.

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

  const author = await getCurrentAuthorSnapshot();
  const context = await resolvePostCreationContext({
    contextType: params.contextType,
    groupId: params.groupId,
    profileId: params.profileId,
    author,
  });

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

  return createPostOnServer({
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

  const author = await getCurrentAuthorSnapshot();
  const context = await resolvePostCreationContext({
    contextType: params.contextType,
    groupId: params.groupId,
    profileId: params.profileId,
    author,
  });

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
    currency: isPaidLive ? (params.currency ?? SETTLEMENT_CURRENCY) : null,
    paidAccessMode: isPaidLive ? (params.paidAccessMode ?? "everyone_pays") : null,
    broadcastGroupIds: cleanBroadcastIds.length > 0 ? cleanBroadcastIds : null,
  };

  const isGroupLive = context.contextType !== "profile";
  const isProfileLive = context.contextType === "profile";
  const pinnedAt = serverTimestamp();

  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();
  const searchTimestamp = Timestamp.now();

  const postId = await createPostOnServer({
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
    currency: isPaidLive ? (params.currency ?? SETTLEMENT_CURRENCY) : null,
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

  // Auto-pin: desfijar cualquier post previamente fijado en el mismo contexto
  // (el nuevo directo ya nace fijado desde el servidor)
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

