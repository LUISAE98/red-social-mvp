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
  isPostLocked,
  type AuthorSnapshot,
  type UserProfileLookup,
  type GroupLookup,
  type ProfileLookup,
} from "./post-service.internal";
import {
  hydratePost,
  hydrateComment,
  hydrateCommentReply,
  buildShareMetadata,
  attachViewerFlameState,
  attachViewerPostState,
  attachViewerCommentFlameState,
} from "./post-service.hydration";
import {
  resolveEffectiveMembershipStatus,
  fetchOwnedGroupIds,
  fetchMemberGroupIds,
  fetchHiddenMemberGroupIds,
  fetchAccessibleGroupIds,
  assertMembershipCanInteract,
  ensureUserCanCommentOnPost,
} from "./post-service.access";

// Queries / feeds y galerías de media extraídos a sus propios módulos; se
// re-exportan (barrel) para no cambiar los imports de los consumidores.
export * from "./post-service.queries";
export * from "./post-service.media";
export * from "./post-service.create";
export * from "./post-service.create-media";
export * from "./post-service.comments";



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
  /**
   * Cursor de la SEGUNDA fuente cuando el feed fusiona dos consultas.
   *
   * Lo usa la vista DESDE FUERA de una comunidad pública: los posts gratis y los premium
   * de alcance público vienen de queries distintas (las reglas exigen fijar campos
   * distintos), y cada una avanza a su ritmo. Sin este segundo cursor, "cargar más"
   * repetiría o se saltaría posts de una de las dos.
   */
  lastPremiumDoc?: QueryDocumentSnapshot<DocumentData> | null;
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

  // La configuración de monetización NO se toca al editar, a propósito.
  //
  // `premium` es lo único monetizable que las reglas dejan cambiar aquí
  // (`canEditPost` → text/media/premium/editedAt/updatedAt), pero el precio que
  // se COBRA vive en `oneTimePrice` y el acceso en `requiresPayment`/
  // `accessModel`/`isShareable`, campos que ese mismo `hasOnly` prohíbe cambiar.
  // Escribir `premium` aquí desincronizaba el post: la tarjeta mostraba el
  // precio nuevo (`premium.price ?? oneTimePrice`) y Stripe cobraba el viejo, y
  // un cambio de `accessMode` dejaba `isShareable` mintiendo sobre quién puede
  // verlo. El panel del composer ya enseña esta configuración como de solo
  // lectura; esto lo garantiza también a nivel de servicio.
  //
  // Cambiar precio/alcance de un post ya publicado es otra operación (habría que
  // actualizar los campos monetarios en el mismo write y abrir sus reglas).
  void params.premium;

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

export * from "./post-service.live";
