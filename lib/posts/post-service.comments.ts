// Comentarios y respuestas del servicio de posts (+ sus caches de sesión).
// Extraído de post-service.ts; post-service.ts lo re-exporta (barrel).
// Las caches POST_COMMENTS_CACHE/COMMENT_REPLIES_CACHE son singletons de módulo
// usados solo por este dominio (viajan aquí íntegros).

import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc,
  setDoc, serverTimestamp, increment, query, orderBy, limit, startAfter,
  runTransaction, writeBatch, Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/lib/firebase";
import { pickString, assertValidId } from "./post-service.helpers";
import { callCheckRateLimit } from "./rateLimitClient";
import { prepararFreno, aplicarFreno } from "@/lib/rateLimit/frenoEnLote";
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
// ⚠️ B8-H03. El freno ya NO se pide en una llamada aparte.
//
// Hasta ahora se llamaba a `checkRateLimitComment` y DESPUÉS se escribía el
// comentario: dos pasos independientes, así que bastaba con no dar el primero.
// Escribiendo contra Firestore sin pasar por esta función se comentaba sin
// freno ninguno, y con ello venían el spam, el acoso y el disparo masivo de
// notificaciones.
//
// Ahora el contador viaja en el MISMO lote atómico que el comentario, y la
// regla `canCreateComment` lo exige con `getAfter`. Los dos pasos son uno.
//
// Esto devuelve lo que hay que escribir; escribirlo es cosa de quien arma el
// lote. Ver `lib/posts/commentRateLimit.ts`.
async function enforceCommentRateLimit() {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error("Debes iniciar sesión.");
  return prepararFreno(user.uid, "comment");
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

// ⚠️ B8-H04. Era 20. Cada mención de perfil dispara una notificación y el
// disparador las recorría todas con un `await` dentro del bucle, así que un
// solo comentario podía lanzar miles. Tope de producto de Luis (2026-08-16).
//
// El mismo número vive en `backend/src/notifications.ts` y en las Firestore
// Rules (`commentMentionsWithinLimit`); si cambia, cambia en los tres.
const MAX_COMMENT_MENTIONS = 5;

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
  const freno = await enforceCommentRateLimit();
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

// ⚠️ B8-H03. El comentario y su contador de freno van en el MISMO lote
// atómico. La regla `canCreateComment` lo exige con `getAfter`: sin el
// contador no hay comentario, y el contador pasa por las reglas de
// `/rateLimits`, que son las que comprueban los 3 s y el tope por hora.
const lote = writeBatch(db);
const comentarioRef = doc(collection(db, "posts", params.postId, "comments"));

lote.set(comentarioRef, {
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
aplicarFreno(lote, freno);

await lote.commit();

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

// El contador del post NO se toca desde aqui: lo lleva el disparador
// `onCommentSoftDeleted`. Esta escritura seguia estando y ya no la permiten las
// reglas, asi que reventaba DESPUES de haber marcado el comentario: quedaba
// borrado en la base, la interfaz se quedaba en el catch mostrandolo, y a partir
// de ahi tampoco se podia editar —editar exige que no este borrado—. Un solo
// fallo que se veia como dos.
await updateDoc(commentRef, {
  isDeleted: true,
  deletedAt: serverTimestamp(),
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

  // ⚠️ B8-H03. Las respuestas NO tenían freno ninguno: `createPostComment` sí
  // llamaba al límite y esta función nunca lo hizo. O sea que el spam ni
  // siquiera necesitaba saltarse nada, le bastaba con mudarse a las respuestas.
  //
  // Ahora gastan el MISMO contador que los comentarios, y la regla
  // `canCreateReply` lo exige en el mismo lote atómico.
  const freno = await enforceCommentRateLimit();

  await runTransaction(db, async (transaction) => {
    const freshPostSnap = await transaction.get(postRef);
    const freshCommentSnap = await transaction.get(commentRef);

    if (!freshPostSnap.exists()) {
      throw new Error("La publicación ya no existe.");
    }

    if (!freshCommentSnap.exists()) {
      throw new Error("El comentario ya no existe.");
    }

    // Los contadores —el de respuestas del comentario y el de comentarios del
    // post— NO se escriben aquí: los lleva el servidor. Estaban dentro de esta
    // misma transacción, así que su denegación no se llevaba por delante el
    // contador, sino la RESPUESTA ENTERA: no se podía responder.
    //
    // El freno sí sigue aquí, y tiene que seguir: la regla `canCreateReply`
    // exige que se gaste en el mismo lote atómico que la respuesta.
    // El contador va DESPUÉS de todas las lecturas de la transacción: Firestore
    // exige leer antes de escribir.
    aplicarFreno(transaction, freno);

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

  // Mismo caso que el borrado de comentario: los DOS contadores —el de respuestas
  // del comentario y el de comentarios del post— los lleva ahora el servidor, con
  // `onReplySoftDeleted`. Aqui iban dentro de la transaccion, asi que su denegacion
  // tumbaba la operacion entera y la respuesta ni siquiera se marcaba.
  //
  // Sin contadores que leer, ya no hay nada que hacer en transaccion: es una sola
  // escritura sobre un solo documento.
  const replySnap = await getDoc(replyRef);
  if (!replySnap.exists()) return;

  await updateDoc(replyRef, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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
