// Galerías de media (fotos/videos/lives) del servicio de posts.
// Extraído de post-service.queries.ts para mantenerlo bajo 1000 líneas.
// post-service.ts re-exporta este módulo (barrel).

import {
  collection, query, where, orderBy, limit, startAfter,
  getDocs, getDoc, doc, documentId,
  type QueryDocumentSnapshot, type DocumentData,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { pickString, chunkArray, assertValidId } from "./post-service.helpers";
import { fetchUsersByIds, fetchGroupsByIds, getPostGroupIds, isPostLocked } from "./post-service.internal";
import { hydratePost, attachViewerPostState } from "./post-service.hydration";
import { fetchOwnedGroupIds, fetchMemberGroupIds, fetchHiddenMemberGroupIds, fetchAccessibleGroupIds } from "./post-service.access";
import type { Post } from "./types";
import type { GroupPostsPageCursor, GroupPostsPageResult } from "./post-service";

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

