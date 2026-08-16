// Comentarios y respuestas del servicio de posts (+ sus caches de sesión).
// Extraído de post-service.ts; post-service.ts lo re-exporta (barrel).
// Las caches POST_COMMENTS_CACHE/COMMENT_REPLIES_CACHE son singletons de módulo
// usados solo por este dominio (viajan aquí íntegros).

import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc,
  setDoc, serverTimestamp, increment, query, orderBy, limit, startAfter,
  runTransaction, Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/lib/firebase";
import { pickString, assertValidId } from "./post-service.helpers";
import { callCheckRateLimit } from "./rateLimitClient";
import {
  getCurrentAuthorSnapshot,
  fetchUsersByIds,
  assertNoGroupMemberBlockBetween,
  attachViewerGroupMemberBlockStateToComments,
  attachViewerGroupMemberBlockStateToReplies,
  filterCommentsForViewerGroupMemberBlocks,
  filterRepliesForViewerGroupMemberBlocks,
} from "./post-service.internal";
import { hydrateComment, hydrateCommentReply, attachViewerCommentFlameState } from "./post-service.hydration";
import { ensureUserCanCommentOnPost } from "./post-service.access";
import { attachRestrictedCommentImageUrls } from "./restricted-media";
import type { Comment, CommentReply, CommentImage, CommentMention, CommentEditEntry } from "./types";

type ToggleCommentFlameResponse = {
  liked: boolean;
  likes: number;
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
// El conteo lo lleva el servidor (`checkRateLimitComment` en backend/rateLimiter.ts).
// Antes esta misma lógica corría en el cliente escribiendo `rateLimits` directo,
// y como el dueño podía escribir su propio documento, bastaba con reiniciar
// `lastAt` para saltarse el límite. Ahora esa colección es de solo lectura para
// el cliente y el único que la escribe es el callable.
async function enforceCommentRateLimit(): Promise<void> {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error("Debes iniciar sesión.");
  await callCheckRateLimit("checkRateLimitComment");
}

/** Comentarios por tanda. El panel pide la siguiente al llegar arriba del todo. */
export const COMMENTS_PAGE_SIZE = 30;

/**
 * Trae UNA tanda de comentarios y la deja lista para pintar.
 *
 * Se pide en orden DESCENDENTE (lo más nuevo primero) y se le da la vuelta al
 * final. Es la diferencia entre ver los comentarios recientes o no verlos: con
 * el orden ascendente que había antes, una publicación con más de 30
 * comentarios enseñaba los 30 MÁS VIEJOS y los nuevos no existían para nadie.
 *
 * `before` es la marca de tiempo del comentario más antiguo que ya tienes; con
 * ella se piden los anteriores a ese.
 */
async function fetchCommentsPage(params: {
  postId: string;
  before?: Timestamp | null;
  pageSize: number;
}): Promise<{ comments: Comment[]; hasMore: boolean }> {
  const postSnap = await getDoc(doc(db, "posts", params.postId));
  if (!postSnap.exists()) return { comments: [], hasMore: false };

  const postData = postSnap.data() as Record<string, unknown>;
  const groupId =
    postData.contextType === "profile" ? null : pickString(postData.groupId);
  const viewerUid = auth.currentUser?.uid ?? null;

  const snap = await getDocs(
    query(
      collection(db, "posts", params.postId, "comments"),
      orderBy("createdAt", "desc"),
      ...(params.before ? [startAfter(params.before)] : []),
      limit(params.pageSize)
    )
  );

  // Se mide ANTES de filtrar los borrados: si no, una tanda entera de
  // comentarios borrados se leería como "ya no hay más" y cortaría el historial.
  const hasMore = snap.docs.length === params.pageSize;

  const rawComments: Comment[] = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, "id">) }))
    .filter((c) => !c.isDeleted)
    // De vuelta a ascendente: el panel pinta del más viejo al más nuevo.
    .reverse();

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

  const comments = await attachViewerCommentFlameState(
    params.postId,
    visibleComments,
    viewerUid
  );

  // Firma las imágenes de comunidades privadas/ocultas, que se guardan sin URL.
  return {
    comments: await attachRestrictedCommentImageUrls(params.postId, comments),
    hasMore,
  };
}

export async function fetchPostComments(postId: string): Promise<Comment[]> {
  assertValidId(postId, "postId");

  const viewerUid = auth.currentUser?.uid ?? null;
  const cacheKey = getPostCommentsCacheKey(postId, viewerUid);

  const cached = POST_COMMENTS_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { comments } = await fetchCommentsPage({
    postId,
    pageSize: COMMENTS_PAGE_SIZE,
  });

  POST_COMMENTS_CACHE.set(cacheKey, comments);

  return comments;
}

/**
 * Comentarios ANTERIORES a los que ya tienes cargados.
 *
 * No pasa por la caché a propósito: esa guarda la primera tanda, que es la que
 * se reutiliza al reabrir el panel. Las tandas de historial son bajo demanda y
 * viven en el estado de quien las pide.
 */
export async function fetchOlderPostComments(params: {
  postId: string;
  /** `createdAt` del comentario más antiguo que ya está en pantalla. */
  before: Timestamp;
  pageSize?: number;
}): Promise<{ comments: Comment[]; hasMore: boolean }> {
  assertValidId(params.postId, "postId");

  return fetchCommentsPage({
    postId: params.postId,
    before: params.before,
    pageSize: params.pageSize ?? COMMENTS_PAGE_SIZE,
  });
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
/** Máximo de menciones @ por comentario. Ver `backend/src/notifications.ts`. */
const MAX_MENCIONES_POR_COMENTARIO = 5;

function sanitizeCommentMentions(
  input: unknown,
  text: string
): CommentMention[] | null {
  if (!Array.isArray(input)) return null;

  const seen = new Set<string>();
  const result: CommentMention[] = [];

  for (const raw of input) {
    // ⚠️ B8-H04. Cada mención de perfil dispara una notificación, y este bucle
    // no tenía tope: un comentario podía lanzar miles. Tope de producto de Luis
    // (2026-08-16). El mismo número vive en `backend/src/notifications.ts` y en
    // las Firestore Rules; si cambia, cambia en los tres.
    if (result.length >= MAX_MENCIONES_POR_COMENTARIO) break;

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

// El contador lo lleva el trigger `onPostCommentCreated` en el backend. Antes se
// subía desde aquí, y como iba en una escritura APARTE de la creación del
// comentario, las reglas no podían atar una cosa a la otra: cualquiera con
// sesión podía sumar o restar el contador de cualquier post sin comentar nada.

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

/**
 * Trae UNA tanda de respuestas de un comentario, lista para pintar.
 *
 * Mismo criterio que los comentarios: se piden en orden DESCENDENTE y se les da
 * la vuelta. Con el ascendente que había antes, un comentario con más de 30
 * respuestas enseñaba las 30 MÁS VIEJAS y las recientes no se veían nunca.
 */
async function fetchRepliesPage(params: {
  postId: string;
  commentId: string;
  before?: Timestamp | null;
  pageSize: number;
}): Promise<{ replies: CommentReply[]; hasMore: boolean }> {
  const postSnap = await getDoc(doc(db, "posts", params.postId));
  if (!postSnap.exists()) return { replies: [], hasMore: false };

  const postData = postSnap.data() as Record<string, unknown>;
  const groupId =
    postData.contextType === "profile" ? null : pickString(postData.groupId);
  const viewerUid = auth.currentUser?.uid ?? null;

  const snap = await getDocs(
    query(
      collection(
        db,
        "posts",
        params.postId,
        "comments",
        params.commentId,
        "replies"
      ),
      orderBy("createdAt", "desc"),
      ...(params.before ? [startAfter(params.before)] : []),
      limit(params.pageSize)
    )
  );

  // Antes de filtrar los borrados: una tanda entera de borradas no debe
  // leerse como "ya no hay más".
  const hasMore = snap.docs.length === params.pageSize;

  const rawReplies: CommentReply[] = snap.docs
    .map((d) => ({
      id: d.id,
      postId: params.postId,
      commentId: params.commentId,
      ...(d.data() as Omit<CommentReply, "id" | "postId" | "commentId">),
    }))
    .filter((r) => !r.isDeleted)
    .reverse();

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

  const replies = filterRepliesForViewerGroupMemberBlocks(
    repliesWithGroupBlockState
  );

  return {
    replies: await attachRestrictedCommentImageUrls(params.postId, replies),
    hasMore,
  };
}

export async function fetchCommentReplies(params: {
  postId: string;
  commentId: string;
}): Promise<CommentReply[]> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  const cacheKey = getCommentRepliesCacheKey(params.postId, params.commentId);
  const cached = COMMENT_REPLIES_CACHE.get(cacheKey);

  if (cached) {
    return cached;
  }

  const { replies } = await fetchRepliesPage({
    postId: params.postId,
    commentId: params.commentId,
    pageSize: COMMENTS_PAGE_SIZE,
  });

  COMMENT_REPLIES_CACHE.set(cacheKey, replies);

  return replies;
}

/**
 * Respuestas ANTERIORES a las que ya están en pantalla.
 *
 * Fuera de la caché a propósito, igual que en los comentarios: esa guarda la
 * primera tanda, que es la que se reutiliza al reabrir el hilo.
 */
export async function fetchOlderCommentReplies(params: {
  postId: string;
  commentId: string;
  /** `createdAt` de la respuesta más antigua ya cargada. */
  before: Timestamp;
  pageSize?: number;
}): Promise<{ replies: CommentReply[]; hasMore: boolean }> {
  assertValidId(params.postId, "postId");
  assertValidId(params.commentId, "commentId");

  return fetchRepliesPage({
    postId: params.postId,
    commentId: params.commentId,
    before: params.before,
    pageSize: params.pageSize ?? COMMENTS_PAGE_SIZE,
  });
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


// ─── Edición de posts ──────────────────────────────────────────────────────────

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
