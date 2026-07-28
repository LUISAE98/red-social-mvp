//post-service

import {
  addDoc,
  collection,
  setDoc,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db, functions } from "@/lib/firebase";
import { getMyHiddenJoinedGroups } from "@/lib/groups/sidebarGroups";
import {
  MAX_POST_IMAGES,
  MAX_POST_VIDEOS,
} from "./types";

import type {
  Comment,
  CommentEditEntry,
  CommentImage,
  CommentMention,
  CommentReply,
  GroupMemberBlockRelationship,
  GroupVisibility,
  LiveVisibilityMode,
  Post,
  PostContextType,
  PostLiveData,
  PostMedia,
  PostPremium,
} from "./types";
import { httpsCallable } from "firebase/functions";
import { buildPostSearchIndex } from "./postSearchIndex";
import {
  normalizeGroupCategory,
  normalizeGroupTags,
  type CanonicalGroupCategory,
} from "@/types/group";
import { buildPremiumAccessFields } from "./premium";
import {
  type PostingMode,
  pickString,
  assertValidId,
  normalizeGroupVisibility,
  normalizePostingMode,
  normalizeCommentsEnabled,
  readGroupName,
  readGroupAvatarUrl,
  getTimestampDate,
  readTimestampMillis,
  readProfileDisplayName,
  readProfileAvatarUrl,
  truncateForShare,
  chunkArray,
  isProfileRestricted,
} from "./post-service.helpers";
import {
  userHasBlockedUser,
  assertNoGroupMemberBlockBetween,
  attachViewerGroupMemberBlockState,
  filterPostsForViewerGroupMemberBlocks,
  attachViewerGroupMemberBlockStateToComments,
  filterCommentsForViewerGroupMemberBlocks,
  attachViewerGroupMemberBlockStateToReplies,
  filterRepliesForViewerGroupMemberBlocks,
  getCurrentAuthorSnapshot,
  fetchUsersByIds,
  fetchGroupsByIds,
  getPostGroupIds,
  fetchProfileById,
  hydratePost,
  hydrateComment,
  hydrateCommentReply,
  buildShareMetadata,
  attachViewerFlameState,
  attachViewerPostState,
  attachViewerCommentFlameState,
  resolveEffectiveMembershipStatus,
  fetchOwnedGroupIds,
  fetchMemberGroupIds,
  fetchHiddenMemberGroupIds,
  fetchAccessibleGroupIds,
  assertMembershipCanInteract,
  ensureUserCanCommentOnPost,
  type AuthorSnapshot,
  type UserProfileLookup,
  type GroupLookup,
  type ProfileLookup,
} from "./post-service.internal";

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


type TogglePostFlameResponse = {
  liked: boolean;
  likes: number;
};

type TogglePostSaveResponse = {
  saved: boolean;
  delta: number;
  postId: string;
};

type ToggleCommentFlameResponse = {
  liked: boolean;
  likes: number;
};
type ToggleGroupPostPinResponse = {
  ok: boolean;
  postId: string;
  isPinnedInGroup: boolean;
};

type ToggleProfilePostPinResponse = {
  ok: boolean;
  postId: string;
  isPinnedOnProfile: boolean;
};

export type HomePostsPageCursor = {
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
};

export type HomePostsPageResult = {
  posts: Post[];
  cursor: HomePostsPageCursor | null;
  hasMore: boolean;
};

export type UserProfilePostsPageCursor = {
  lastCreatedAt: Timestamp | null;
  lastPostId: string | null;
};

export type UserProfilePostsPageResult = {
  posts: Post[];
  cursor: UserProfilePostsPageCursor | null;
  hasMore: boolean;
};

export type GroupPostsPageCursor = {
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
};

export type GroupPostsPageResult = {
  posts: Post[];
  cursor: GroupPostsPageCursor | null;
  hasMore: boolean;
};

export type SavedPostsPageCursor = {
  lastSavedDoc: QueryDocumentSnapshot<DocumentData> | null;
};

export type SavedPostsPageResult = {
  posts: Post[];
  cursor: SavedPostsPageCursor | null;
  hasMore: boolean;
};

export type PostFlameUser = {
  userId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
};

const POST_COMMENTS_CACHE = new Map<string, Comment[]>();
const COMMENT_REPLIES_CACHE = new Map<string, CommentReply[]>();

function getCommentRepliesCacheKey(postId: string, commentId: string): string {
  return `${postId}__${commentId}`;
}

function clearPostCommentsCache(postId: string) {
  Array.from(POST_COMMENTS_CACHE.keys()).forEach((key) => {
    if (key.startsWith(`${postId}__`)) {
      POST_COMMENTS_CACHE.delete(key);
    }
  });
}

function clearCommentRepliesCache(postId: string, commentId: string) {
  COMMENT_REPLIES_CACHE.delete(getCommentRepliesCacheKey(postId, commentId));
}

function getPostCommentsCacheKey(postId: string, viewerUid?: string | null): string {
  return `${postId}__${viewerUid || "anon"}`;
}



// Caché de sesión — el perfil del autor rara vez cambia durante una sesión

/**
 * Lee UNA publicación por id, hidratada con el mismo pipeline que los feeds
 * (autor, grupo, `isLocked`, y estado por-viewer: `viewerHasFlamed`,
 * `viewerHasSaved`, bloqueos de miembro). Devuelve `null` si no existe, está
 * borrada, o el viewer no puede leerla (reglas / bloqueo). Usada por la página
 * de post individual y el deep-link de notificaciones.
 */
export async function fetchPostByIdForViewer(
  postId: string,
  viewerUid?: string | null
): Promise<Post | null> {
  if (!postId) return null;

  // Espera a que el SDK adjunte el token de auth ANTES del getDoc: al abrir un
  // deep-link de notificación en frío, `request.auth` puede llegar null al
  // servidor (aunque haya sesión) y las reglas niegan la lectura → falso
  // "publicación no disponible" incluso en el propio post del autor.
  try {
    await auth.authStateReady();
  } catch {
    /* si falla, seguimos: el SDK reintentará adjuntar el token */
  }

  let snap;
  try {
    snap = await getDoc(doc(db, "posts", postId));
  } catch (e) {
    // DIAGNÓSTICO TEMPORAL: por qué el post no está disponible.
    // currentUid = uid REAL del SDK de Firebase (el que ven las reglas).
    // Si difiere de viewerUid, la sesión no es la que cree el cliente.
    console.warn("[fetchPostByIdForViewer] getDoc FALLÓ", {
      postId,
      viewerUid,
      currentUid: auth.currentUser?.uid ?? null,
      error: e,
    });
    return null; // permiso denegado / post inaccesible
  }
  if (!snap.exists()) {
    console.warn("[fetchPostByIdForViewer] el post NO EXISTE", { postId });
    return null;
  }

  const raw: Post = { id: snap.id, ...(snap.data() as Omit<Post, "id">) };
  if (raw.isDeleted === true) {
    console.warn("[fetchPostByIdForViewer] el post está BORRADO (isDeleted)", { postId });
    return null;
  }

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds([raw.authorId]),
    fetchGroupsByIds(getPostGroupIds([raw])),
  ]);

  const hydrated = hydratePost(raw, userMap, groupMap);
  const withLock = { ...hydrated, isLocked: isPostLocked(hydrated) };

  try {
    const [withViewerState] = await attachViewerPostState([withLock], viewerUid ?? undefined);
    // attachViewerPostState filtra posts de autores que bloquearon al viewer:
    // si desaparece, no está disponible para este viewer.
    if (!withViewerState) {
      console.warn("[fetchPostByIdForViewer] filtrado por attachViewerPostState", { postId });
    }
    return withViewerState ?? null;
  } catch {
    return withLock;
  }
}



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
export async function fetchGroupPostsPage(params: {
  groupId: string;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.groupId, "groupId");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;
  const isFirstPage = !previousLastDoc;

  const [postsSnap, pinnedSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, "posts"),
        where("groupId", "==", params.groupId),
        where("isDeleted", "==", false),
        orderBy("createdAt", "desc"),
        ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
        limit(isFirstPage ? safePageSize + 1 : safePageSize)
      )
    ),
    isFirstPage
      ? getDocs(
          query(
            collection(db, "posts"),
            where("groupId", "==", params.groupId),
            where("isDeleted", "==", false),
            where("isPinnedInGroup", "==", true),
            orderBy("groupPinnedAt", "desc"),
            limit(1)
          )
        )
      : Promise.resolve(null),
  ]);

  const normalPosts: Post[] = postsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

  const pinnedPosts: Post[] =
    pinnedSnap?.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Post, "id">),
    })) ?? [];

  const rawPosts = Array.from(
    new Map([...pinnedPosts, ...normalPosts].map((post) => [post.id, post]))
      .values()
  );

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    params.viewerUid
  );

  const sortedPosts = sortPostsWithPinnedPriority(postsWithViewerState);

  const lastDoc = postsSnap.docs[postsSnap.docs.length - 1] ?? null;
  const hasMore = postsSnap.docs.length === safePageSize;

  return {
    posts: sortedPosts,
    cursor:
      hasMore && lastDoc
        ? {
            lastDoc,
          }
        : null,
    hasMore,
  };
}

// ─── Galerías de media (Fotos / Videos / En vivo) ────────────────────────────

export type MediaGalleryKind = "photos" | "videos" | "lives";

/**
 * Un live entra en la galería "En vivo" si está transmitiendo ahora, o si ya se
 * transmitió (tiene VOD). NO se exige `vodStatus === "ready"`: muchos VOD
 * (legacy, de pago o de Cloudflare) nunca lo setean. Los de pago SÍ se listan;
 * el gate de ticket se aplica al reproducir, no aquí. Solo se ocultan los VOD
 * que el creador marcó como ocultos, y lo que aún no se transmitió o se canceló.
 */
function isLivePostGalleryEligible(post: Post): boolean {
  const live = post.liveData;
  if (!live) return false;
  if (live.vodHidden === true) return false;

  // En vivo ahora mismo.
  if (live.status === "live") return true;

  const media = Array.isArray(post.media) ? post.media : [];

  // La transmisión ya ocurrió o hay una grabación disponible.
  return (
    live.status === "ended" ||
    live.status === "error" ||
    live.startedAt != null ||
    live.endedAt != null ||
    live.vodStatus === "ready" ||
    live.vodStatus === "processing" ||
    !!live.playbackId ||
    !!live.hlsUrl ||
    post.playback != null ||
    post.videoData != null ||
    media.some((m) => m.type === "video")
  );
}

/**
 * ¿Este post debe aparecer en la galería `kind`? Se decide por el CONTENIDO real
 * (media[].type / liveData), no por `postType`: así no se pierden posts legacy o
 * con `postType` inexacto, y no dependemos de un índice por `postType`.
 * Los VOD de transmisiones solo cuentan como "lives" (nunca como "videos").
 */
function postMatchesMediaKind(post: Post, kind: MediaGalleryKind): boolean {
  if (kind === "lives") return isLivePostGalleryEligible(post);

  const isLive = post.liveData != null || post.postType === "live";
  const media = Array.isArray(post.media) ? post.media : [];

  if (kind === "photos") return media.some((m) => m.type === "image");
  // videos: tiene algún item de video y NO es una transmisión.
  return !isLive && media.some((m) => m.type === "video");
}

// Hidrata posts crudos, filtra por tipo de media (foto/video/live), ordena los
// lives (en curso arriba) y adjunta el estado del viewer. Compartido por todas
// las galerías: comunidad, perfil y guardados.
async function processMediaPosts(
  rawPosts: Post[],
  kind: MediaGalleryKind,
  viewerUid?: string | null
): Promise<Post[]> {
  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  let hydratedPosts = rawPosts
    .map((post) => {
      const hydrated = hydratePost(post, userMap, groupMap);
      return { ...hydrated, isLocked: isPostLocked(hydrated) };
    })
    // Filtro por contenido real (media / liveData), no por postType.
    .filter((post) => postMatchesMediaKind(post, kind));

  if (kind === "lives") {
    // Los en curso arriba; el resto conserva el orden por fecha.
    hydratedPosts = hydratedPosts.sort((a, b) => {
      const aLive = a.liveData?.status === "live" ? 1 : 0;
      const bLive = b.liveData?.status === "live" ? 1 : 0;
      return bLive - aLive;
    });
  }

  return attachViewerPostState(hydratedPosts, viewerUid);
}

async function buildMediaPageResult(params: {
  docs: QueryDocumentSnapshot<DocumentData>[];
  kind: MediaGalleryKind;
  viewerUid?: string | null;
  safePageSize: number;
}): Promise<GroupPostsPageResult> {
  const { docs, kind, viewerUid, safePageSize } = params;

  const pageDocs = docs.slice(0, safePageSize);
  const rawPosts: Post[] = pageDocs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

  const postsWithViewerState = await processMediaPosts(rawPosts, kind, viewerUid);

  const hasMore = docs.length > safePageSize;
  const lastDoc = pageDocs[pageDocs.length - 1] ?? null;

  return {
    posts: postsWithViewerState,
    cursor: hasMore && lastDoc ? { lastDoc } : null,
    hasMore,
  };
}

/**
 * Registra una vista ÚNICA del viewer para un video/VOD. Idempotente: escribe
 * `posts/{postId}/views/{uid}`; la Cloud Function `onPostViewed` incrementa
 * `viewsCount` solo en la primera vez (onCreate). Fire-and-forget.
 */
export async function registerPostView(postId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || !postId) return;
  try {
    await setDoc(
      doc(db, "posts", postId, "views", uid),
      { viewedAt: serverTimestamp() },
      { merge: true }
    );
  } catch {
    // No es crítico: si falla, simplemente no se cuenta esta vista.
  }
}

/**
 * Galería de una COMUNIDAD: todas las fotos/videos/lives de la comunidad, de
 * cualquier autor (query por `groupId`, no por autor).
 */
export async function fetchGroupMediaPage(params: {
  groupId: string;
  kind: MediaGalleryKind;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.groupId, "groupId");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 24, 40));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  // Se consulta por groupId (mismo índice que el feed, ya construido) y se filtra
  // el tipo de media en cliente — más robusto que depender de `postType`.
  const postsSnap = await getDocs(
    query(
      collection(db, "posts"),
      where("groupId", "==", params.groupId),
      where("isDeleted", "==", false),
      orderBy("createdAt", "desc"),
      ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
      limit(safePageSize + 1)
    )
  );

  return buildMediaPageResult({
    docs: postsSnap.docs,
    kind: params.kind,
    viewerUid: params.viewerUid,
    safePageSize,
  });
}

/**
 * Galería de un PERFIL: fotos/videos/lives publicados en ese perfil (siempre
 * del dueño; en perfil `profileId === authorId`).
 */
export async function fetchProfileMediaPage(params: {
  profileUid: string;
  kind: MediaGalleryKind;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.profileUid, "profileUid");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 24, 40));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  // Misma forma que el feed de perfil (reglas + índice ya probados): filtra por
  // contextType+profileId+authorId+isDeleted; el tipo de media se filtra en cliente.
  const postsSnap = await getDocs(
    query(
      collection(db, "posts"),
      where("contextType", "==", "profile"),
      where("profileId", "==", params.profileUid),
      where("authorId", "==", params.profileUid),
      where("isDeleted", "==", false),
      orderBy("createdAt", "desc"),
      ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
      limit(safePageSize + 1)
    )
  );

  return buildMediaPageResult({
    docs: postsSnap.docs,
    kind: params.kind,
    viewerUid: params.viewerUid,
    safePageSize,
  });
}

/**
 * Galería de GUARDADOS: fotos/videos/lives de los posts que el usuario guardó.
 * Pagina la subcolección `savedPosts` (por savedAt), hace batch-fetch de los posts
 * por id y filtra el tipo de media en cliente — mismo pipeline que perfil/comunidad.
 * El cursor de guardados es el doc de `savedPosts`; se reutiliza el campo `lastDoc`.
 */
export async function fetchSavedMediaPage(params: {
  userUid: string;
  kind: MediaGalleryKind;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.userUid, "userUid");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 24, 40));
  const previousLastSavedDoc = params.cursor?.lastDoc ?? null;

  const savedSnap = await getDocs(
    query(
      collection(db, "users", params.userUid, "savedPosts"),
      orderBy("savedAt", "desc"),
      ...(previousLastSavedDoc ? [startAfter(previousLastSavedDoc)] : []),
      limit(safePageSize)
    )
  );

  if (savedSnap.empty) {
    return { posts: [], cursor: null, hasMore: false };
  }

  const savedPostIds = savedSnap.docs
    .map((savedDoc) => {
      const data = savedDoc.data() as Record<string, unknown>;
      const postIdFromData =
        typeof data.postId === "string" && data.postId.trim().length > 0
          ? data.postId.trim()
          : null;
      return postIdFromData || savedDoc.id;
    })
    .filter((postId) => postId.trim().length > 0);

  const postsByIdMap = new Map<string, Post>();
  await Promise.all(
    chunkArray(savedPostIds, 30).map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(collection(db, "posts"), where(documentId(), "in", chunk))
        );
        snap.docs.forEach((postDoc) => {
          const post = {
            id: postDoc.id,
            ...(postDoc.data() as Omit<Post, "id">),
          } as Post;
          if (post.isDeleted !== true) postsByIdMap.set(postDoc.id, post);
        });
      } catch {
        // Si un chunk falla, se omite silenciosamente.
      }
    })
  );

  // Preservar el orden por savedAt del cursor.
  const orderedPosts = savedPostIds
    .map((postId) => postsByIdMap.get(postId) ?? null)
    .filter((post): post is Post => Boolean(post));

  const postsWithViewerState = await processMediaPosts(
    orderedPosts,
    params.kind,
    params.viewerUid
  );

  const lastSavedDoc = savedSnap.docs[savedSnap.docs.length - 1] ?? null;
  // hasMore se basa en si hay más `savedPosts` (no en cuántos tiles quedaron tras
  // filtrar): la MediaGallery auto-rellena si una página deja pocos tiles.
  const hasMore = savedSnap.docs.length === safePageSize;

  return {
    posts: postsWithViewerState,
    cursor: hasMore && lastSavedDoc ? { lastDoc: lastSavedDoc } : null,
    hasMore,
  };
}

export async function fetchGroupPublicPremiumPostsPage(params: {
  groupId: string;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.groupId, "groupId");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  const postsSnap = await getDocs(
    query(
      collection(db, "posts"),
      where("groupId", "==", params.groupId),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      where("premium.enabled", "==", true),
      where("premium.accessMode", "==", "public"),
      orderBy("createdAt", "desc"),
      ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
      limit(safePageSize + 1)
    )
  );

  const rawPosts: Post[] = postsSnap.docs.slice(0, safePageSize).map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);
    return { ...hydrated, isLocked: isPostLocked(hydrated) };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    params.viewerUid
  );

  const hasMore = postsSnap.docs.length > safePageSize;
  const lastDoc = postsSnap.docs[safePageSize - 1] ?? null;

  return {
    posts: postsWithViewerState,
    cursor: hasMore && lastDoc ? { lastDoc } : null,
    hasMore,
  };
}

export async function fetchGroupPublicPostsPage(params: {
  groupId: string;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.groupId, "groupId");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  const postsSnap = await getDocs(
    query(
      collection(db, "posts"),
      where("groupId", "==", params.groupId),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      orderBy("createdAt", "desc"),
      ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
      limit(safePageSize + 1)
    )
  );

  const rawPosts: Post[] = postsSnap.docs.slice(0, safePageSize).map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);
    return { ...hydrated, isLocked: isPostLocked(hydrated) };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    params.viewerUid
  );

  const hasMore = postsSnap.docs.length > safePageSize;
  const lastDoc = postsSnap.docs[safePageSize - 1] ?? null;

  return {
    posts: postsWithViewerState,
    cursor: hasMore && lastDoc ? { lastDoc } : null,
    hasMore,
  };
}

export async function fetchGroupPosts(
  groupId: string,
  viewerUid?: string | null
): Promise<Post[]> {
  const page = await fetchGroupPostsPage({
    groupId,
    viewerUid,
    pageSize: 10,
    cursor: null,
  });

  return page.posts;
}

/**
 * Descubrimiento (Fase 2): posts públicos y compartibles de comunidades
 * PÚBLICAS filtrados por categoría denormalizada (`groupCategory`) en una sola
 * query. Excluye grupos de los que el viewer ya es miembro. Devuelve posts
 * hidratados y con el estado de reacción/guardado del viewer.
 */
export async function fetchPublicPostsByCategories(params: {
  categories: CanonicalGroupCategory[];
  viewerUid?: string | null;
  excludeGroupIds?: Set<string>;
  pageSize?: number;
}): Promise<Post[]> {
  const categories = Array.from(new Set(params.categories)).slice(0, 10);
  if (categories.length === 0) return [];

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 24, 40));

  const postsSnap = await getDocs(
    query(
      collection(db, "posts"),
      where("groupCategory", "in", categories),
      where("groupVisibility", "==", "public"),
      where("isShareable", "==", true),
      where("isDeleted", "==", false),
      orderBy("createdAt", "desc"),
      limit(safePageSize)
    )
  );

  const rawPosts: Post[] = postsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Post, "id">),
  }));

  const excludeGroupIds = params.excludeGroupIds;
  const filtered = excludeGroupIds
    ? rawPosts.filter(
        (post) => !(post.groupId && excludeGroupIds.has(post.groupId))
      )
    : rawPosts;

  if (filtered.length === 0) return [];

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(filtered.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(filtered)),
  ]);

  const hydratedPosts = filtered.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);
    return { ...hydrated, isLocked: isPostLocked(hydrated) };
  });

  return attachViewerPostState(hydratedPosts, params.viewerUid);
}

function normalizeHomeFeedPostSnapshot(params: {
  feedDocId: string;
  feedData: Record<string, unknown>;
}): Post | null {
  const { feedDocId, feedData } = params;

  if (feedData.isVisible !== true) {
    return null;
  }

  const snapshot =
    feedData.postSnapshot && typeof feedData.postSnapshot === "object"
      ? (feedData.postSnapshot as Record<string, unknown>)
      : null;

  if (!snapshot) {
    return null;
  }

  const postId =
    pickString(feedData.postId) ||
    pickString((snapshot as Record<string, unknown>).id) ||
    feedDocId;

  if (!postId) {
    return null;
  }

  if (
    snapshot.isDeleted === true ||
    feedData.isDeleted === true ||
    Boolean(snapshot.deletedAt)
  ) {
    return null;
  }

  const authorId = pickString(snapshot.authorId) || pickString(feedData.authorId);

  if (!authorId) {
    return null;
  }

  const contextType: PostContextType =
    snapshot.contextType === "profile" ||
    feedData.sourceType === "profile" ||
    pickString(snapshot.profileId) ||
    pickString(feedData.profileId)
      ? "profile"
      : "group";

  const groupId =
    contextType === "group"
      ? pickString(snapshot.groupId) || pickString(feedData.groupId)
      : null;

  const profileId =
    contextType === "profile"
      ? pickString(snapshot.profileId) || pickString(feedData.profileId) || authorId
      : null;

  if (contextType === "group" && !groupId) {
    return null;
  }

  if (contextType === "profile" && !profileId) {
    return null;
  }

  return {
    id: postId,
    ...(snapshot as Omit<Post, "id">),
    contextType,
    groupId,
    profileId,
    authorId,
    canModerateGroupAuthor: feedData.canModerateGroupAuthor ?? false,
    authorMemberStatus: feedData.authorMemberStatus ?? null,
    authorMutedUntil: feedData.authorMutedUntil ?? null,
  } as Post;
}

export async function fetchHomePostsPage(params: {
  userUid: string;
  pageSize?: number;
  cursor?: HomePostsPageCursor | null;
}): Promise<HomePostsPageResult> {
  assertValidId(params.userUid, "userUid");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  const homeFeedSnap = await getDocs(
    query(
      collection(db, "users", params.userUid, "homeFeed"),
      where("isVisible", "==", true),
      orderBy("createdAt", "desc"),
      ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
      limit(safePageSize)
    )
  );

  const rawPosts = homeFeedSnap.docs
    .map((feedDoc) =>
      normalizeHomeFeedPostSnapshot({
        feedDocId: feedDoc.id,
        feedData: feedDoc.data() as Record<string, unknown>,
      })
    )
    .filter((post): post is Post => post !== null);

  const lastDoc = homeFeedSnap.docs[homeFeedSnap.docs.length - 1] ?? null;
  const hasMore =
    !homeFeedSnap.empty && homeFeedSnap.docs.length === safePageSize;

  if (rawPosts.length === 0) {
    return {
      posts: [],
      cursor:
        hasMore && lastDoc
          ? {
              lastDoc,
            }
          : null,
      hasMore,
    };
  }

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    params.userUid
  );

  return {
    posts: postsWithViewerState,
    cursor:
      hasMore && lastDoc
        ? {
            lastDoc,
          }
        : null,
    hasMore,
  };
}

export async function fetchHomePosts(userUid: string): Promise<Post[]> {
  const page = await fetchHomePostsPage({
    userUid,
    pageSize: 10,
    cursor: null,
  });

  return page.posts;
}


function normalizeProfileFeedPost(
  snap: QueryDocumentSnapshot<DocumentData>
): Post {
  const data = snap.data() as Omit<Post, "id">;

  return {
    id: snap.id,
    ...data,
  } as Post;
}

async function fetchProfileFeedDocs(params: {
  profileUid: string;
  pageSize: number;
  cursor?: UserProfilePostsPageCursor | null;
  mode: "owner" | "public" | "groupIds" | "shareable_group_posts";
  groupIds?: string[];
}): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const postsRef = collection(db, "posts");

  const cursorParts =
    params.cursor?.lastCreatedAt && params.cursor?.lastPostId
      ? [startAfter(params.cursor.lastCreatedAt, params.cursor.lastPostId)]
      : [];

  if (params.mode === "owner") {
    const snap = await getDocs(
      query(
        postsRef,
        where("contextType", "==", "profile"),
        where("profileId", "==", params.profileUid),
        where("authorId", "==", params.profileUid),
        where("isDeleted", "==", false),
        orderBy("createdAt", "desc"),
        orderBy(documentId(), "desc"),
        ...cursorParts,
        limit(params.pageSize)
      )
    );

    return snap.docs;
  }

  if (params.mode === "public") {
    const snap = await getDocs(
      query(
        postsRef,
        where("contextType", "==", "profile"),
        where("profileId", "==", params.profileUid),
        where("authorId", "==", params.profileUid),
        where("isDeleted", "==", false),
        orderBy("createdAt", "desc"),
        orderBy(documentId(), "desc"),
        ...cursorParts,
        limit(params.pageSize)
      )
    );

    return snap.docs;
  }

  if (params.mode === "shareable_group_posts") {
    const snap = await getDocs(
      query(
        postsRef,
        where("authorId", "==", params.profileUid),
        where("contextType", "==", "group"),
        where("isDeleted", "==", false),
        where("isShareable", "==", true),
        orderBy("createdAt", "desc"),
        orderBy(documentId(), "desc"),
        ...cursorParts,
        limit(params.pageSize)
      )
    );
    return snap.docs;
  }

  const groupIds = Array.from(
    new Set(
      (params.groupIds || [])
        .map((groupId) => groupId.trim())
        .filter(Boolean)
    )
  );

  if (groupIds.length === 0) {
    return [];
  }

  const chunks = chunkArray(groupIds, 30);

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(
        query(
          postsRef,
          where("authorId", "==", params.profileUid),
          where("contextType", "==", "group"),
          where("isDeleted", "==", false),
          where("groupId", "in", chunk),
          orderBy("createdAt", "desc"),
          orderBy(documentId(), "desc"),
          ...cursorParts,
          limit(params.pageSize)
        )
      )
    )
  );

  return snaps.flatMap((snap) => snap.docs);
}

export async function fetchUserProfilePostsPage(params: {
  profileUid: string;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: UserProfilePostsPageCursor | null;
}): Promise<UserProfilePostsPageResult> {
  assertValidId(params.profileUid, "profileUid");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const viewerUid = params.viewerUid ?? auth.currentUser?.uid ?? null;
  const isOwner = viewerUid === params.profileUid;

  const profileSnap = await getDoc(doc(db, "users", params.profileUid));

  if (!profileSnap.exists()) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  const profileData = profileSnap.data() as Record<string, unknown>;
  const showPosts = profileData.showPosts !== false;
  const restricted = isProfileRestricted(profileData);

  if (!isOwner && (!showPosts || restricted)) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  let feedDocs: QueryDocumentSnapshot<DocumentData>[] = [];

  if (isOwner) {
    const profileDocsPromise = fetchProfileFeedDocs({
      profileUid: params.profileUid,
      pageSize: safePageSize + 1,
      cursor: params.cursor,
      mode: "owner",
    });

    const groupDocsPromise = fetchAccessibleGroupIds(params.profileUid)
      .then((groupIds) =>
        fetchProfileFeedDocs({
          profileUid: params.profileUid,
          pageSize: safePageSize + 1,
          cursor: params.cursor,
          mode: "groupIds",
          groupIds,
        })
      )
      .catch((error) => {
        console.warn("[ProfileFeed] owner group lane failed", error);
        return [];
      });

    const [profileDocs, groupDocs] = await Promise.all([
      profileDocsPromise,
      groupDocsPromise,
    ]);

    feedDocs = [...profileDocs, ...groupDocs];
  } else {
    const publicDocsPromise = fetchProfileFeedDocs({
      profileUid: params.profileUid,
      pageSize: safePageSize + 1,
      cursor: params.cursor,
      mode: "public",
    });

const privateDocsPromise = viewerUid
  ? Promise.allSettled([
  fetchOwnedGroupIds(viewerUid),
  fetchMemberGroupIds(viewerUid),
  fetchHiddenMemberGroupIds(viewerUid),
]).then((results) => {
  const ownedGroupIds =
    results[0].status === "fulfilled" ? results[0].value : [];

  const memberGroupIds =
    results[1].status === "fulfilled" ? results[1].value : [];

  const hiddenMemberGroupIds =
    results[2].status === "fulfilled" ? results[2].value : [];

  console.log("[ProfileFeed] accessible groupIds debug", {
    viewerUid,
    profileUid: params.profileUid,
    ownedGroupIds,
    memberGroupIds,
    hiddenMemberGroupIds,
    results,
  });

  const groupIds = Array.from(
    new Set([
      ...ownedGroupIds,
      ...memberGroupIds,
      ...hiddenMemberGroupIds,
    ])
  );

  return fetchProfileFeedDocs({
    profileUid: params.profileUid,
    pageSize: safePageSize + 1,
    cursor: params.cursor,
    mode: "groupIds",
    groupIds,
  });
})
.catch((error) => {
  console.warn("[ProfileFeed] private group lane failed", error);
  return [];
})
  : Promise.resolve([]);

    const shareableGroupDocsPromise = fetchProfileFeedDocs({
      profileUid: params.profileUid,
      pageSize: safePageSize + 1,
      cursor: params.cursor,
      mode: "shareable_group_posts",
    }).catch((error) => {
      console.warn("[ProfileFeed] shareable group lane failed", error);
      return [];
    });

    const [publicDocs, privateDocs, shareableGroupDocs] = await Promise.all([
      publicDocsPromise,
      privateDocsPromise,
      shareableGroupDocsPromise,
    ]);

    feedDocs = [...publicDocs, ...privateDocs, ...shareableGroupDocs];
  }

  const uniqueDocs = Array.from(
    new Map(feedDocs.map((feedDoc) => [feedDoc.id, feedDoc])).values()
  );

  uniqueDocs.sort((a, b) => {
    const aData = a.data() as Record<string, unknown>;
    const bData = b.data() as Record<string, unknown>;

    const aPinned = aData.isPinnedOnProfile === true;
    const bPinned = bData.isPinnedOnProfile === true;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    if (aPinned && bPinned) {
      const aPinnedMs =
        (aData.profilePinnedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      const bPinnedMs =
        (bData.profilePinnedAt as Timestamp | undefined)?.toMillis?.() ?? 0;

      if (aPinnedMs !== bPinnedMs) {
        return bPinnedMs - aPinnedMs;
      }
    }

    const aCreatedMs =
      (aData.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    const bCreatedMs =
      (bData.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;

    if (aCreatedMs !== bCreatedMs) {
      return bCreatedMs - aCreatedMs;
    }

    return b.id.localeCompare(a.id);
  });

  const pageDocs = uniqueDocs.slice(0, safePageSize);
  const hasMore = uniqueDocs.length > safePageSize;

  const rawPosts = pageDocs.map(normalizeProfileFeedPost);

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(rawPosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(rawPosts)),
  ]);

  const hydratedPosts = rawPosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithViewerState = await attachViewerPostState(
    hydratedPosts,
    viewerUid
  );

  const lastDoc = pageDocs[pageDocs.length - 1] ?? null;
  const lastData = lastDoc?.data() as Record<string, unknown> | undefined;
  const lastCreatedAt =
    lastData?.createdAt instanceof Timestamp ? lastData.createdAt : null;

  return {
    posts: postsWithViewerState,
    cursor:
      hasMore && lastDoc && lastCreatedAt
        ? {
            lastCreatedAt,
            lastPostId: lastDoc.id,
          }
        : null,
    hasMore,
  };
}

export async function fetchUserProfilePosts(
  profileUid: string,
  viewerUid?: string | null
): Promise<Post[]> {
  const page = await fetchUserProfilePostsPage({
    profileUid,
    viewerUid,
    pageSize: 10,
    cursor: null,
  });

  return page.posts;
}

// Rate limit ejecutado directamente en Firestore desde el cliente.
// Elimina el cold start de Cloud Functions (1-4s) sin sacrificar la lógica de límite.
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

async function enforceCommentRateLimit(): Promise<void> {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error("Debes iniciar sesión.");
  const INTERVAL_MS = 3_000;
  const MAX_PER_HOUR = 60;
  const docRef = doc(db, "rateLimits", `${user.uid}_comment`);
  const nowMs = Date.now();
  const oneHourAgoMs = nowMs - 60 * 60 * 1000;
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
      throw new Error(`Espera ${waitSec}s antes de comentar de nuevo.`);
    }
    if (hourTimestamps.length >= MAX_PER_HOUR) {
      throw new Error(`Alcanzaste el límite de ${MAX_PER_HOUR} comentarios por hora.`);
    }
    const nowTs = Timestamp.fromMillis(nowMs);
    tx.set(docRef, { lastAt: nowTs, hourTimestamps: [...hourTimestamps, nowTs] });
  });
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
export async function softDeletePost(postId: string): Promise<void> {
  assertValidId(postId, "postId");

  const user = auth.currentUser;

  if (!user?.uid) {
    throw new Error("Debes iniciar sesión para eliminar una publicación.");
  }

  const postRef = doc(db, "posts", postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error("La publicación no existe.");
  }

  const postData = postSnap.data() as Record<string, unknown>;

  if (postData.isDeleted === true) {
    return;
  }

  const updatedAt = serverTimestamp();

  await updateDoc(postRef, {
    isDeleted: true,
    deletedAt: updatedAt,
    deletedBy: user.uid,
    updatedAt,
    isPinnedInGroup: false,
    groupPinnedAt: null,
    groupPinnedBy: null,
    isPinnedOnProfile: false,
    profilePinnedAt: null,
    profilePinnedBy: null,
    "search.isDeleted": true,
    "search.updatedAt": updatedAt,
  });
}

export async function fetchPostComments(postId: string): Promise<Comment[]> {
  assertValidId(postId, "postId");

  const viewerUid = auth.currentUser?.uid ?? null;
  const cacheKey = getPostCommentsCacheKey(postId, viewerUid);

  const cached = POST_COMMENTS_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const postSnap = await getDoc(doc(db, "posts", postId));

  if (!postSnap.exists()) {
    return [];
  }

  const postData = postSnap.data() as Record<string, unknown>;
  const groupId =
    postData.contextType === "profile" ? null : pickString(postData.groupId);

  const q = query(
    collection(db, "posts", postId, "comments"),
    orderBy("createdAt", "asc"),
    limit(30)
  );

  const snap = await getDocs(q);

  const rawComments: Comment[] = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, "id">) }))
    .filter((c) => !c.isDeleted);

  const userMap = await fetchUsersByIds(
    rawComments.map((comment) => comment.authorId)
  );

  const hydratedComments = rawComments.map((comment) =>
    hydrateComment(comment, userMap)
  );

  const commentsWithGroupBlockState =
    await attachViewerGroupMemberBlockStateToComments({
      groupId,
      viewerUid,
      comments: hydratedComments,
    });

  const visibleComments = filterCommentsForViewerGroupMemberBlocks(
    commentsWithGroupBlockState
  );

  const commentsWithViewerState = await attachViewerCommentFlameState(
    postId,
    visibleComments,
    viewerUid
  );

  POST_COMMENTS_CACHE.set(cacheKey, commentsWithViewerState);

  return commentsWithViewerState;
}

const MAX_COMMENT_MENTIONS = 20;

/**
 * Normaliza y valida las menciones que llegan del cliente antes de persistirlas.
 * - Descarta entradas mal formadas.
 * - Solo conserva menciones cuyo `token` realmente aparece en el texto final
 *   (evita persistir menciones de tokens que el autor borró al editar).
 * - Deduplica por (type,id) y limita la cantidad.
 * Devuelve `null` cuando no queda ninguna mención válida, para no escribir el
 * campo en Firestore innecesariamente.
 */
function sanitizeCommentMentions(
  input: unknown,
  text: string
): CommentMention[] | null {
  if (!Array.isArray(input)) return null;

  const seen = new Set<string>();
  const result: CommentMention[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;

    const candidate = raw as Record<string, unknown>;
    const type = candidate.type;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const label =
      typeof candidate.label === "string" ? candidate.label.trim() : "";
    const token =
      typeof candidate.token === "string" ? candidate.token.trim() : "";

    if (type !== "profile" && type !== "group") continue;
    if (!id || !label || !token) continue;
    if (!text.includes(token)) continue;

    const dedupeKey = `${type}:${id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const mention: CommentMention = { type, id, label, token };

    if (type === "profile") {
      const handle =
        typeof candidate.handle === "string" ? candidate.handle.trim() : "";
      mention.handle = handle || null;
    }

    result.push(mention);

    if (result.length >= MAX_COMMENT_MENTIONS) break;
  }

  return result.length > 0 ? result : null;
}

/**
 * Valida el shape de la imagen adjunta que envía el cliente antes de
 * persistirla. Devuelve `null` si falta la URL/miniatura (para no escribir el
 * campo en Firestore). No confía en el cliente: las reglas de Storage ya
 * limitaron tamaño/tipo al subir, y aquí solo copiamos strings/números.
 */
function sanitizeCommentImage(input: unknown): CommentImage | null {
  if (!input || typeof input !== "object") return null;

  const candidate = input as Record<string, unknown>;
  const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
  const thumbnailUrl =
    typeof candidate.thumbnailUrl === "string"
      ? candidate.thumbnailUrl.trim()
      : "";
  const path = typeof candidate.path === "string" ? candidate.path.trim() : "";
  const thumbnailPath =
    typeof candidate.thumbnailPath === "string"
      ? candidate.thumbnailPath.trim()
      : "";

  if (!url || !thumbnailUrl) return null;

  const image: CommentImage = { url, thumbnailUrl, path, thumbnailPath };

  if (typeof candidate.width === "number" && Number.isFinite(candidate.width)) {
    image.width = candidate.width;
  }
  if (
    typeof candidate.height === "number" &&
    Number.isFinite(candidate.height)
  ) {
    image.height = candidate.height;
  }

  return image;
}

export async function createPostComment(params: {
  postId: string;
  text: string;
  mentions?: CommentMention[];
  image?: CommentImage | null;
}): Promise<void> {
  assertValidId(params.postId, "postId");

  const cleanText = params.text.trim();
  const cleanImage = sanitizeCommentImage(params.image);
  if (!cleanText && !cleanImage) {
    throw new Error("Escribe un comentario o adjunta una imagen antes de enviar.");
  }

  const author = await getCurrentAuthorSnapshot();
  await enforceCommentRateLimit();
  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error("La publicación no existe.");
  }

  const postData = postSnap.data() as Record<string, unknown>;

  if (postData.isDeleted === true) {
    throw new Error("La publicación ya no está disponible.");
  }

  await ensureUserCanCommentOnPost(postData, author.uid);

  const postGroupId =
    postData.contextType !== "profile" ? pickString(postData.groupId) : null;
  const premiumData =
    postData.premium && typeof postData.premium === "object"
      ? (postData.premium as Record<string, unknown>)
      : null;

  let authorIsGroupMember: boolean | undefined;
  if (postGroupId && premiumData?.enabled === true) {
    if (author.uid === pickString(postData.authorId)) {
      authorIsGroupMember = true;
    } else {
      const memberSnap = await getDoc(
        doc(db, "groups", postGroupId, "members", author.uid)
      );
      const memberStatus = memberSnap.exists()
        ? pickString(memberSnap.data()?.status)
        : null;
      authorIsGroupMember =
        memberStatus === "active" || memberStatus === "subscribed";
    }
  }

const cleanMentions = sanitizeCommentMentions(params.mentions, cleanText);

await addDoc(collection(db, "posts", params.postId, "comments"), {
  authorId: author.uid,
  authorName: author.authorName,
  authorAvatarUrl: author.authorAvatarUrl,
  authorUsername: author.authorUsername,
  text: cleanText,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  counts: {
    replies: 0,
    likes: 0,
  },
  ...(cleanMentions ? { mentions: cleanMentions } : {}),
  ...(cleanImage ? { image: cleanImage } : {}),
  ...(authorIsGroupMember !== undefined ? { authorIsGroupMember } : {}),
});

await updateDoc(postRef, {
  "counts.comments": increment(1),
  updatedAt: serverTimestamp(),
});

clearPostCommentsCache(params.postId);
}

export async function deletePostComment(params: {
  postId: string;
  commentId: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);
  const commentSnap = await getDoc(commentRef);

  if (!commentSnap.exists()) {
    return;
  }

const postRef = doc(db, "posts", params.postId);
const postSnap = await getDoc(postRef);

if (!postSnap.exists()) {
  return;
}

const postData = postSnap.data() as Record<string, unknown>;
const currentCounts =
  postData.counts && typeof postData.counts === "object"
    ? (postData.counts as Record<string, unknown>)
    : {};

const currentComments =
  typeof currentCounts.comments === "number" ? currentCounts.comments : 0;

const currentLikes =
  typeof currentCounts.likes === "number" ? currentCounts.likes : 0;

const currentSaves =
  typeof currentCounts.saves === "number" ? currentCounts.saves : 0;

await updateDoc(commentRef, {
  isDeleted: true,
  deletedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

await updateDoc(postRef, {
  counts: {
    comments: Math.max(0, currentComments - 1),
    likes: currentLikes,
    saves: currentSaves,
  },
  updatedAt: serverTimestamp(),
});

clearPostCommentsCache(params.postId);
clearCommentRepliesCache(params.postId, params.commentId);
}

export async function fetchCommentReplies(params: {
  postId: string;
  commentId: string;
}): Promise<CommentReply[]> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const viewerUid = auth.currentUser?.uid ?? null;
  const cacheKey = getCommentRepliesCacheKey(params.postId, params.commentId);
  const cached = COMMENT_REPLIES_CACHE.get(cacheKey);

  if (cached) {
    return cached;
  }

  const postSnap = await getDoc(doc(db, "posts", params.postId));

  if (!postSnap.exists()) {
    return [];
  }

  const postData = postSnap.data() as Record<string, unknown>;
  const groupId =
    postData.contextType === "profile" ? null : pickString(postData.groupId);

  const q = query(
    collection(
      db,
      "posts",
      params.postId,
      "comments",
      params.commentId,
      "replies"
    ),
    orderBy("createdAt", "asc"),
    limit(30)
  );

  const snap = await getDocs(q);

  const rawReplies: CommentReply[] = snap.docs
    .map((d) => ({
      id: d.id,
      postId: params.postId,
      commentId: params.commentId,
      ...(d.data() as Omit<CommentReply, "id" | "postId" | "commentId">),
    }))
    .filter((r) => !r.isDeleted);

  const userMap = await fetchUsersByIds(
    rawReplies.map((reply) => reply.authorId)
  );

  const hydratedReplies = rawReplies.map((reply) =>
    hydrateCommentReply(reply, userMap)
  );

  const repliesWithGroupBlockState =
    await attachViewerGroupMemberBlockStateToReplies({
      groupId,
      viewerUid,
      replies: hydratedReplies,
    });

  const visibleReplies = filterRepliesForViewerGroupMemberBlocks(
    repliesWithGroupBlockState
  );

  COMMENT_REPLIES_CACHE.set(cacheKey, visibleReplies);

  return visibleReplies;
}


export async function createPostCommentReply(params: {
  postId: string;
  commentId: string;
  text: string;
  mentions?: CommentMention[];
  image?: CommentImage | null;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const cleanText = params.text.trim();
  const cleanImage = sanitizeCommentImage(params.image);
  if (!cleanText && !cleanImage) {
    throw new Error("Escribe una respuesta o adjunta una imagen antes de enviar.");
  }

  const cleanMentions = sanitizeCommentMentions(params.mentions, cleanText);

  const author = await getCurrentAuthorSnapshot();

  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error("La publicación no existe.");
  }

  const postData = postSnap.data() as Record<string, unknown>;

  if (postData.isDeleted === true) {
    throw new Error("La publicación ya no está disponible.");
  }

  await ensureUserCanCommentOnPost(postData, author.uid);

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);
  const commentSnap = await getDoc(commentRef);

  if (!commentSnap.exists()) {
    throw new Error("El comentario ya no existe.");
  }

  const commentData = commentSnap.data() as Record<string, unknown>;

  const groupId =
    postData.contextType === "profile" ? null : pickString(postData.groupId);

  const commentAuthorId = pickString(commentData.authorId);

  if (groupId && commentAuthorId && commentAuthorId !== author.uid) {
    await assertNoGroupMemberBlockBetween({
      groupId,
      viewerUid: author.uid,
      targetUid: commentAuthorId,
      message: "No puedes responder este comentario.",
    });
  }

  const replyPremiumData =
    postData.premium && typeof postData.premium === "object"
      ? (postData.premium as Record<string, unknown>)
      : null;

  let replyAuthorIsGroupMember: boolean | undefined;
  if (groupId && replyPremiumData?.enabled === true) {
    if (author.uid === pickString(postData.authorId)) {
      replyAuthorIsGroupMember = true;
    } else {
      const memberSnap = await getDoc(
        doc(db, "groups", groupId, "members", author.uid)
      );
      const memberStatus = memberSnap.exists()
        ? pickString(memberSnap.data()?.status)
        : null;
      replyAuthorIsGroupMember =
        memberStatus === "active" || memberStatus === "subscribed";
    }
  }

  const replyRef = doc(
    collection(db, "posts", params.postId, "comments", params.commentId, "replies")
  );

  await runTransaction(db, async (transaction) => {
    const freshPostSnap = await transaction.get(postRef);
    const freshCommentSnap = await transaction.get(commentRef);

    if (!freshPostSnap.exists()) {
      throw new Error("La publicación ya no existe.");
    }

    if (!freshCommentSnap.exists()) {
      throw new Error("El comentario ya no existe.");
    }

    const freshPostData = freshPostSnap.data() as Record<string, unknown>;
    const freshPostCounts =
      freshPostData.counts && typeof freshPostData.counts === "object"
        ? (freshPostData.counts as Record<string, unknown>)
        : {};

    const freshPostComments =
      typeof freshPostCounts.comments === "number" ? freshPostCounts.comments : 0;

    const freshPostLikes =
      typeof freshPostCounts.likes === "number" ? freshPostCounts.likes : 0;

    const freshPostSaves =
      typeof freshPostCounts.saves === "number" ? freshPostCounts.saves : 0;

    const freshCommentData = freshCommentSnap.data() as Record<string, unknown>;
    const freshCommentCounts =
      freshCommentData.counts && typeof freshCommentData.counts === "object"
        ? (freshCommentData.counts as Record<string, unknown>)
        : {};

    const freshReplies =
      typeof freshCommentCounts.replies === "number" ? freshCommentCounts.replies : 0;

    const freshCommentLikes =
      typeof freshCommentCounts.likes === "number" ? freshCommentCounts.likes : 0;

    transaction.set(replyRef, {
      postId: params.postId,
      commentId: params.commentId,
      authorId: author.uid,
      authorName: author.authorName,
      authorAvatarUrl: author.authorAvatarUrl,
      authorUsername: author.authorUsername,
      text: cleanText,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(cleanMentions ? { mentions: cleanMentions } : {}),
      ...(cleanImage ? { image: cleanImage } : {}),
      ...(replyAuthorIsGroupMember !== undefined
        ? { authorIsGroupMember: replyAuthorIsGroupMember }
        : {}),
    });

    transaction.update(commentRef, {
      counts: {
        replies: freshReplies + 1,
        likes: freshCommentLikes,
      },
      updatedAt: serverTimestamp(),
    });

    transaction.update(postRef, {
      counts: {
        comments: freshPostComments + 1,
        likes: freshPostLikes,
        saves: freshPostSaves,
      },
      updatedAt: serverTimestamp(),
    });
  });

  clearPostCommentsCache(params.postId);
  clearCommentRepliesCache(params.postId, params.commentId);
}

export async function deletePostCommentReply(params: {
  postId: string;
  commentId: string;
  replyId: string;
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");
  assertValidId(params.replyId, "replyId");

  const replyRef = doc(
    db,
    "posts",
    params.postId,
    "comments",
    params.commentId,
    "replies",
    params.replyId
  );

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);
  const postRef = doc(db, "posts", params.postId);

  await runTransaction(db, async (transaction) => {
    const freshReplySnap = await transaction.get(replyRef);
    const freshCommentSnap = await transaction.get(commentRef);
    const freshPostSnap = await transaction.get(postRef);

    if (!freshReplySnap.exists()) {
      return;
    }

    if (!freshCommentSnap.exists()) {
      throw new Error("El comentario ya no existe.");
    }

    if (!freshPostSnap.exists()) {
      throw new Error("La publicación ya no existe.");
    }

    const freshCommentData = freshCommentSnap.data() as Record<string, unknown>;
    const freshCommentCounts =
      freshCommentData.counts && typeof freshCommentData.counts === "object"
        ? (freshCommentData.counts as Record<string, unknown>)
        : {};

    const freshReplies =
      typeof freshCommentCounts.replies === "number" ? freshCommentCounts.replies : 0;

    const freshCommentLikes =
      typeof freshCommentCounts.likes === "number" ? freshCommentCounts.likes : 0;

    const freshPostData = freshPostSnap.data() as Record<string, unknown>;
    const freshPostCounts =
      freshPostData.counts && typeof freshPostData.counts === "object"
        ? (freshPostData.counts as Record<string, unknown>)
        : {};

    const freshPostComments =
      typeof freshPostCounts.comments === "number" ? freshPostCounts.comments : 0;

    const freshPostLikes =
      typeof freshPostCounts.likes === "number" ? freshPostCounts.likes : 0;

    const freshPostSaves =
      typeof freshPostCounts.saves === "number" ? freshPostCounts.saves : 0;

    transaction.update(replyRef, {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.update(commentRef, {
      counts: {
        replies: Math.max(0, freshReplies - 1),
        likes: freshCommentLikes,
      },
      updatedAt: serverTimestamp(),
    });

    transaction.update(postRef, {
      counts: {
        comments: Math.max(0, freshPostComments - 1),
        likes: freshPostLikes,
        saves: freshPostSaves,
      },
      updatedAt: serverTimestamp(),
    });
  });

  clearPostCommentsCache(params.postId);
  clearCommentRepliesCache(params.postId, params.commentId);
}

async function fetchEditHistory(path: string[]): Promise<CommentEditEntry[]> {
  try {
    const snap = await getDocs(
      query(collection(db, ...path as [string, ...string[]]), orderBy("editedAt", "asc")),
    );
    return snap.docs.map((d) => ({
      previousText: typeof d.data().previousText === "string" ? d.data().previousText : "",
      editedAt: d.data().editedAt as Timestamp,
      editedBy: typeof d.data().editedBy === "string" ? d.data().editedBy : undefined,
    }));
  } catch {
    return [];
  }
}

export async function fetchPostCommentsAdmin(postId: string): Promise<Comment[]> {
  assertValidId(postId, "postId");

  const snap = await getDocs(
    query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"), limit(100)),
  );

  const rawComments: Comment[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Comment, "id">),
  }));

  const commentsWithHistory = await Promise.all(
    rawComments.map(async (c) => {
      const h = c.editedAt
        ? await fetchEditHistory(["posts", postId, "comments", c.id, "editHistory"])
        : [];
      return h.length > 0 ? { ...c, editHistory: h } : c;
    }),
  );

  const userMap = await fetchUsersByIds(commentsWithHistory.map((c) => c.authorId));
  return commentsWithHistory.map((c) => hydrateComment(c, userMap));
}

export async function fetchCommentRepliesAdmin(params: {
  postId: string;
  commentId: string;
}): Promise<CommentReply[]> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const snap = await getDocs(
    query(
      collection(db, "posts", params.postId, "comments", params.commentId, "replies"),
      orderBy("createdAt", "asc"),
      limit(100),
    ),
  );

  const rawReplies: CommentReply[] = snap.docs.map((d) => ({
    id: d.id,
    postId: params.postId,
    commentId: params.commentId,
    ...(d.data() as Omit<CommentReply, "id" | "postId" | "commentId">),
  }));

  const repliesWithHistory = await Promise.all(
    rawReplies.map(async (r) => {
      const h = r.editedAt
        ? await fetchEditHistory([
            "posts", params.postId, "comments", params.commentId, "replies", r.id, "editHistory",
          ])
        : [];
      return h.length > 0 ? { ...r, editHistory: h } : r;
    }),
  );

  const userMap = await fetchUsersByIds(repliesWithHistory.map((r) => r.authorId));
  return repliesWithHistory.map((r) => hydrateCommentReply(r, userMap));
}

export async function fetchPostFlameUsers(
  postId: string
): Promise<PostFlameUser[]> {
  assertValidId(postId, "postId");

  const snap = await getDocs(
    query(
      collection(db, "posts", postId, "reactions"),
      orderBy("createdAt", "desc"),
      limit(100)
    )
  );

  const userIds = snap.docs
    .map((reactionDoc) => {
      const data = reactionDoc.data() as Record<string, unknown>;
      return typeof data.userId === "string" ? data.userId.trim() : "";
    })
    .filter(Boolean);

  const userMap = await fetchUsersByIds(userIds);

  return userIds.map((userId) => {
    const profile = userMap[userId];

    return {
      userId,
      displayName: profile?.displayName || userId || "Usuario",
      username: profile?.username ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    };
  });
}

export async function togglePostFlame(
  postId: string
): Promise<TogglePostFlameResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión para reaccionar.");
  }

  const callable = httpsCallable<{ postId: string }, TogglePostFlameResponse>(
    functions,
    "togglePostFlame"
  );

  const result = await callable({ postId });

  const likes = Number(result.data?.likes ?? 0);

  return {
    liked: result.data?.liked === true,
    likes: Number.isFinite(likes) ? Math.max(0, likes) : 0,
  };
}

export async function togglePostSave(postId: string): Promise<TogglePostSaveResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión para guardar publicaciones.");
  }

  const callable = httpsCallable<{ postId: string }, TogglePostSaveResponse>(
    functions,
    "togglePostSave"
  );

  const result = await callable({ postId });

  return {
    saved: Boolean(result.data.saved),
    delta: Number(result.data.delta ?? 0),
    postId: String(result.data.postId || postId),
  };
}

export async function toggleGroupPostPin(
  postId: string
): Promise<ToggleGroupPostPinResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión.");
  }

  const callable = httpsCallable<
    { postId: string },
    ToggleGroupPostPinResponse
  >(functions, "toggleGroupPostPin");

  const result = await callable({ postId });

  return {
    ok: Boolean(result.data.ok),
    postId: String(result.data.postId || postId),
    isPinnedInGroup: Boolean(result.data.isPinnedInGroup),
  };
}

export async function toggleProfilePostPin(
  postId: string
): Promise<ToggleProfilePostPinResponse> {
  assertValidId(postId, "postId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión.");
  }

  const callable = httpsCallable<
    { postId: string },
    ToggleProfilePostPinResponse
  >(functions, "toggleProfilePostPin");

  const result = await callable({ postId });

  return {
    ok: Boolean(result.data.ok),
    postId: String(result.data.postId || postId),
    isPinnedOnProfile: Boolean(result.data.isPinnedOnProfile),
  };
}

export async function fetchSavedPostsPage(params: {
  userUid: string;
  pageSize?: number;
  cursor?: SavedPostsPageCursor | null;
}): Promise<SavedPostsPageResult> {
  assertValidId(params.userUid, "userUid");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastSavedDoc = params.cursor?.lastSavedDoc ?? null;

  const savedSnap = await getDocs(
    query(
      collection(db, "users", params.userUid, "savedPosts"),
      orderBy("savedAt", "desc"),
      ...(previousLastSavedDoc ? [startAfter(previousLastSavedDoc)] : []),
      limit(safePageSize)
    )
  );

  if (savedSnap.empty) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  const savedPostIds = savedSnap.docs
    .map((savedDoc) => {
      const data = savedDoc.data() as Record<string, unknown>;

      const postIdFromData =
        typeof data.postId === "string" && data.postId.trim().length > 0
          ? data.postId.trim()
          : null;

      return postIdFromData || savedDoc.id;
    })
    .filter((postId) => postId.trim().length > 0);

  const postsByIdMap = new Map<string, Post>();

  const savedChunks = chunkArray(savedPostIds, 30);
  await Promise.all(
    savedChunks.map(async (chunk) => {
      try {
        const snap = await getDocs(
          query(collection(db, "posts"), where(documentId(), "in", chunk))
        );
        snap.docs.forEach((postDoc) => {
          const post = {
            id: postDoc.id,
            ...(postDoc.data() as Omit<Post, "id">),
          } as Post;
          if (post.isDeleted !== true) {
            postsByIdMap.set(postDoc.id, post);
          }
        });
      } catch {
        // Si un chunk falla, se omite silenciosamente
      }
    })
  );

  // Preservar el orden de savedAt del cursor
  const visiblePosts = savedPostIds
    .map((postId) => postsByIdMap.get(postId) ?? null)
    .filter((post): post is Post => Boolean(post));

  const [userMap, groupMap] = await Promise.all([
    fetchUsersByIds(visiblePosts.map((post) => post.authorId)),
    fetchGroupsByIds(getPostGroupIds(visiblePosts)),
  ]);

  const hydratedPosts = visiblePosts.map((post) => {
    const hydrated = hydratePost(post, userMap, groupMap);

    return {
      ...hydrated,
      viewerHasSaved: true,
      isLocked: isPostLocked(hydrated),
    };
  });

  const postsWithGroupMemberBlockState = await attachViewerGroupMemberBlockState(
    hydratedPosts,
    params.userUid
  );

  const visibleSavedPosts = filterPostsForViewerGroupMemberBlocks(
    postsWithGroupMemberBlockState
  );

  const postsWithFlameState = await attachViewerFlameState(
    visibleSavedPosts,
    params.userUid
  );

  const lastSavedDoc = savedSnap.docs[savedSnap.docs.length - 1] ?? null;
  const hasMore = savedSnap.docs.length === safePageSize;

  return {
    posts: postsWithFlameState,
    cursor:
      hasMore && lastSavedDoc
        ? {
            lastSavedDoc,
          }
        : null,
    hasMore,
  };
}

export async function fetchSavedPosts(userUid: string): Promise<Post[]> {
  assertValidId(userUid, "userUid");

  const allPosts: Post[] = [];
  let cursor: SavedPostsPageCursor | null = null;
  let hasMore = true;

  while (hasMore && allPosts.length < 100) {
    const page = await fetchSavedPostsPage({
      userUid,
      pageSize: 20,
      cursor,
    });

    allPosts.push(...page.posts);
    cursor = page.cursor;
    hasMore = page.hasMore;
  }

  return allPosts.slice(0, 100);
}

export async function toggleCommentFlame(params: {
  postId: string;
  commentId: string;
}): Promise<ToggleCommentFlameResponse> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  if (!auth.currentUser?.uid) {
    throw new Error("Debes iniciar sesión para reaccionar.");
  }

  const callable = httpsCallable<
    { postId: string; commentId: string },
    ToggleCommentFlameResponse
  >(functions, "toggleCommentFlame");

  const result = await callable({
    postId: params.postId,
    commentId: params.commentId,
  });

  clearPostCommentsCache(params.postId);

  return {
    liked: Boolean(result.data.liked),
    likes: Number(result.data.likes ?? 0),
  };
}

function sortPostsWithPinnedPriority(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const aPinned = a.isPinnedInGroup === true || a.isPinnedOnProfile === true;
    const bPinned = b.isPinnedInGroup === true || b.isPinnedOnProfile === true;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    const aPinnedAt =
      a.groupPinnedAt?.toMillis?.() ??
      a.profilePinnedAt?.toMillis?.() ??
      0;

    const bPinnedAt =
      b.groupPinnedAt?.toMillis?.() ??
      b.profilePinnedAt?.toMillis?.() ??
      0;

    if (aPinned && bPinned && aPinnedAt !== bPinnedAt) {
      return bPinnedAt - aPinnedAt;
    }

    const aCreatedAt = a.createdAt?.toMillis?.() ?? 0;
    const bCreatedAt = b.createdAt?.toMillis?.() ?? 0;

    return bCreatedAt - aCreatedAt;
  });
}

function isPostLocked(post: Post): boolean {
  if (!post.accessModel) return false;

  if (post.accessModel === "free") {
    return false;
  }

  if (post.accessModel === "one_time_purchase") {
    return true;
  }

  return false;
}

// ─── Edición de posts ──────────────────────────────────────────────────────────

export async function updatePost(params: {
  postId: string;
  text: string;
  media: PostMedia[];
  premium?: PostPremium | null;
}): Promise<void> {
  const author = auth.currentUser;
  if (!author) throw new Error("Debes iniciar sesión para editar publicaciones.");

  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) throw new Error("La publicación no existe.");

  const postData = postSnap.data() as Post;

  if (postData.authorId !== author.uid) {
    throw new Error("Solo el autor puede editar esta publicación.");
  }

  if (postData.isDeleted) {
    throw new Error("No se puede editar una publicación eliminada.");
  }

  // Guardar historial antes de modificar
  const historyRef = doc(collection(db, "posts", params.postId, "editHistory"));
  await setDoc(historyRef, {
    editedAt: serverTimestamp(),
    editedBy: author.uid,
    previousText: postData.text ?? "",
    previousMedia: Array.isArray(postData.media) ? postData.media : [],
  });

  const cleanText = typeof params.text === "string" ? params.text.trim() : "";
  const cleanMedia = Array.isArray(params.media)
    ? params.media.filter(
        (item) => typeof item.url === "string" && item.url.trim().length > 0,
      )
    : [];

  const updatePayload: Record<string, unknown> = {
    text: cleanText,
    media: cleanMedia,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (params.premium !== undefined) {
    updatePayload.premium = params.premium ?? null;
  }

  await updateDoc(postRef, updatePayload);
}

export async function updateLivePost(params: {
  postId: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  scheduledStartAt?: Date | null;
  scheduleHasTime?: boolean | null;
  visibilityMode?: LiveVisibilityMode | null;
  accessType?: "free" | "paid" | null;
  ticketPrice?: number | null;
  currency?: "MXN" | "USD" | null;
  paidAccessMode?: "everyone_pays" | "members_free_non_members_pay" | null;
  broadcastGroupIds?: string[] | null;
}): Promise<void> {
  const author = auth.currentUser;
  if (!author) throw new Error("Debes iniciar sesión para editar el live.");

  const postRef = doc(db, "posts", params.postId);
  const postSnap = await getDoc(postRef);
  if (!postSnap.exists()) throw new Error("El live no existe.");
  const postData = postSnap.data() as Post;

  if (postData.authorId !== author.uid) throw new Error("Solo el autor puede editar este live.");
  if (postData.isDeleted) throw new Error("No se puede editar un live eliminado.");

  const cleanTitle = params.title.trim();
  if (!cleanTitle) throw new Error("El título del live es obligatorio.");

  const effectiveMode: LiveVisibilityMode = params.visibilityMode ?? "everyone";
  const effectiveAccessType = params.accessType ?? "free";
  const isPaidLive = effectiveAccessType === "paid";
  // Seguridad: un live en comunidad OCULTA nunca es compartible ni visible para
  // deslogueados (no debe filtrarse fuera de la comunidad).
  const isHiddenGroupLive = postData.groupVisibility === "hidden";
  const scheduledStartAt = params.scheduledStartAt
    ? Timestamp.fromDate(params.scheduledStartAt)
    : null;

  await updateDoc(postRef, {
    text: cleanTitle,
    shareTitle: cleanTitle,
    shareDescription: params.description?.trim() || null,
    shareImageUrl: params.coverUrl ?? null,
    isShareable: effectiveMode !== "members_only" && !isHiddenGroupLive,
    requiresPayment: isPaidLive,
    accessModel: isPaidLive ? "paid" : "free",
    oneTimePrice: isPaidLive ? (params.ticketPrice ?? null) : null,
    currency: isPaidLive ? (params.currency ?? "MXN") : null,
    purchaseType: isPaidLive ? "one_time" : null,
    "liveData.title": cleanTitle,
    "liveData.description": params.description?.trim() || null,
    "liveData.coverUrl": params.coverUrl ?? null,
    "liveData.scheduledStartAt": scheduledStartAt,
    "liveData.scheduleHasTime": scheduledStartAt ? (params.scheduleHasTime ?? true) : null,
    "liveData.visibilityMode": effectiveMode,
    "liveData.allowLoggedOutViewers": effectiveMode === "everyone" && !isHiddenGroupLive,
    "liveData.accessType": effectiveAccessType,
    "liveData.ticketPrice": isPaidLive ? (params.ticketPrice ?? null) : null,
    "liveData.currency": isPaidLive ? (params.currency ?? "MXN") : null,
    "liveData.paidAccessMode": isPaidLive ? (params.paidAccessMode ?? "everyone_pays") : null,
    "liveData.broadcastGroupIds": params.broadcastGroupIds?.length
      ? params.broadcastGroupIds.filter((id) => typeof id === "string" && id.trim().length > 0)
      : null,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ─── Edición de comentarios y respuestas ───────────────────────────────────────

export async function updatePostComment(params: {
  postId: string;
  commentId: string;
  text: string;
  mentions?: CommentMention[];
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const cleanText = params.text.trim();
  if (!cleanText) throw new Error("El comentario no puede estar vacío.");
  if (cleanText.length > 2000) throw new Error("El comentario es demasiado largo.");

  const cleanMentions = sanitizeCommentMentions(params.mentions, cleanText);

  const author = auth.currentUser;
  if (!author) throw new Error("Debes iniciar sesión para editar comentarios.");

  const commentRef = doc(db, "posts", params.postId, "comments", params.commentId);
  const commentSnap = await getDoc(commentRef);

  if (!commentSnap.exists()) throw new Error("El comentario no existe.");

  const commentData = commentSnap.data() as Record<string, unknown>;
  if (commentData.authorId !== author.uid) {
    throw new Error("Solo el autor puede editar este comentario.");
  }

  const historyRef = doc(
    collection(db, "posts", params.postId, "comments", params.commentId, "editHistory")
  );
  await setDoc(historyRef, {
    editedAt: serverTimestamp(),
    editedBy: author.uid,
    previousText: commentData.text ?? "",
  });

  await updateDoc(commentRef, {
    text: cleanText,
    mentions: cleanMentions ?? [],
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  clearPostCommentsCache(params.postId);
}

export async function updatePostCommentReply(params: {
  postId: string;
  commentId: string;
  replyId: string;
  text: string;
  mentions?: CommentMention[];
}): Promise<void> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");
  assertValidId(params.replyId, "replyId");

  const cleanText = params.text.trim();
  if (!cleanText) throw new Error("La respuesta no puede estar vacía.");
  if (cleanText.length > 2000) throw new Error("La respuesta es demasiado larga.");

  const cleanMentions = sanitizeCommentMentions(params.mentions, cleanText);

  const author = auth.currentUser;
  if (!author) throw new Error("Debes iniciar sesión para editar respuestas.");

  const replyRef = doc(
    db,
    "posts", params.postId,
    "comments", params.commentId,
    "replies", params.replyId
  );
  const replySnap = await getDoc(replyRef);

  if (!replySnap.exists()) throw new Error("La respuesta no existe.");

  const replyData = replySnap.data() as Record<string, unknown>;
  if (replyData.authorId !== author.uid) {
    throw new Error("Solo el autor puede editar esta respuesta.");
  }

  const historyRef = doc(
    collection(
      db,
      "posts", params.postId,
      "comments", params.commentId,
      "replies", params.replyId,
      "editHistory"
    )
  );
  await setDoc(historyRef, {
    editedAt: serverTimestamp(),
    editedBy: author.uid,
    previousText: replyData.text ?? "",
  });

  await updateDoc(replyRef, {
    text: cleanText,
    mentions: cleanMentions ?? [],
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  clearCommentRepliesCache(params.postId, params.commentId);
}

// ─── Live streaming / VOD ─────────────────────────────────────────────────────
// Extraído a su propio módulo para reducir el tamaño de este archivo; se
// re-exporta para no cambiar los imports de los ~17 consumidores.
export * from "./post-service.live";
