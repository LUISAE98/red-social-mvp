// Queries / feeds del servicio de posts — lectura y paginación de publicaciones.
//
// El bloque más grande de post-service.ts. Depende del núcleo ya extraído
// (internal/hydration/access) y de los helpers; no comparte estado de módulo con
// el resto. post-service.ts re-exporta este módulo (barrel).

import {
  collection, query, where, orderBy, limit, startAfter,
  getDocs, getDoc, doc, documentId, setDoc, serverTimestamp, Timestamp,
  type QueryConstraint, type QueryDocumentSnapshot, type DocumentData,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { pickString, chunkArray, assertValidId, isProfileRestricted } from "./post-service.helpers";
import { fetchUsersByIds, fetchGroupsByIds, getPostGroupIds, isPostLocked } from "./post-service.internal";
import { hydratePost, attachViewerPostState } from "./post-service.hydration";
import { fetchOwnedGroupIds, fetchMemberGroupIds, fetchHiddenMemberGroupIds, fetchAccessibleGroupIds } from "./post-service.access";
import type { GroupVisibility, Post, PostContextType } from "./types";
import type { CanonicalGroupCategory } from "@/types/group";
import type {
  HomePostsPageCursor, HomePostsPageResult,
  UserProfilePostsPageCursor, UserProfilePostsPageResult,
  GroupPostsPageCursor, GroupPostsPageResult,
} from "./post-service";

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
 * Lo que ve de una comunidad quien la mira DESDE FUERA (no-miembro, con o sin
 * sesión): el video premium de alcance público, el contenido de pago compartible
 * (boleto de live y su VOD) y el live EN CURSO con alcance "todos" — todo lo que
 * puede ver bloqueado para comprarlo o para entrar.
 *
 * ⚠️ `groupVisibility` NO es un filtro cosmético: en una consulta (`list`), las
 * reglas solo ven los campos que la query fija con `==`. La regla que autoriza
 * esto (`canListPublicPremiumGroupPost`) mira `groupVisibility != "hidden"`, así
 * que si la query no lo fija, la regla se evalúa contra un campo inexistente,
 * revienta y Firestore DENIEGA LA CONSULTA COMPLETA. En una comunidad pública el
 * fallo quedaba tapado porque `canReadGroupContent` ya devolvía true; en privada
 * y de suscripción no, y por eso el feed público salía vacío.
 */
export async function fetchGroupPublicPremiumPostsPage(params: {
  groupId: string;
  groupVisibility: Exclude<GroupVisibility, "hidden">;
  viewerUid?: string | null;
  pageSize?: number;
  cursor?: GroupPostsPageCursor | null;
}): Promise<GroupPostsPageResult> {
  assertValidId(params.groupId, "groupId");

  const safePageSize = Math.max(1, Math.min(params.pageSize ?? 10, 20));
  const previousLastDoc = params.cursor?.lastDoc ?? null;

  const postsRef = collection(db, "posts");
  const base = [
    where("groupId", "==", params.groupId),
    where("isDeleted", "==", false),
    where("isShareable", "==", true),
    where("groupVisibility", "==", params.groupVisibility),
  ];
  const tail = [
    orderBy("createdAt", "desc"),
    ...(previousLastDoc ? [startAfter(previousLastDoc)] : []),
    limit(safePageSize + 1),
  ];

  // Un carril por REGLA que autoriza a los de fuera, con TODOS sus campos fijados
  // con `==` (si no, la regla se evalúa contra campos ausentes y la consulta
  // entera se deniega). Si un carril falla, se avisa y se sigue con los demás:
  // vale más un feed incompleto que uno vacío.
  const runLane = (label: string, ...constraints: QueryConstraint[]) =>
    getDocs(query(postsRef, ...base, ...constraints, ...tail)).catch((err) => {
      console.warn(`[groupOutsideFeed] carril "${label}" falló`, err);
      return null;
    });

  const [premiumSnap, paidSnap, liveSnap] = await Promise.all([
    // canListPublicPremiumGroupPost — video premium de alcance público.
    runLane(
      "premium",
      where("premium.enabled", "==", true),
      where("premium.accessMode", "==", "public"),
    ),
    // canReadPaidShareableGroupPost — contenido de pago compartible SIN mapa
    // `premium`: el live con boleto (próximo o terminado) y su VOD de pago, que
    // los de fuera deben poder ver BLOQUEADO para poder comprarlo.
    runLane("pago", where("requiresPayment", "==", true)),
    // canListBroadcastPublicLivePost — live EN CURSO con alcance "todos".
    runLane(
      "live",
      where("liveData.status", "==", "live"),
      where("liveData.allowLoggedOutViewers", "==", true),
    ),
  ]);

  const laneDocs = [premiumSnap, paidSnap, liveSnap].flatMap((snap) => snap?.docs ?? []);

  // Mezcla de carriles: deduplica y reordena por fecha (cada carril venía ya
  // ordenado, pero entre carriles hay que rehacerlo).
  const mergedDocs = Array.from(new Map(laneDocs.map((d) => [d.id, d])).values()).sort(
    (a, b) => {
      const aMs = (a.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      const bMs = (b.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      return bMs - aMs;
    },
  );

  // Feed PÚBLICO (invitado o no-miembro): oculta lives RESTRINGIDOS
  // (`liveData.allowLoggedOutViewers === false`) a los invitados (sin sesión o anónimos),
  // aunque la query los devuelva. Una cuenta real ve los logged_in_only; las reglas + el
  // proxy siguen siendo la barrera del contenido. (No-op para posts sin liveData.)
  const isRealAccount = !!auth.currentUser && !auth.currentUser.isAnonymous;
  const rawPosts: Post[] = mergedDocs
    .slice(0, safePageSize)
    .map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Post, "id">),
    }))
    .filter((post) => isRealAccount || post.liveData?.allowLoggedOutViewers !== false);

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

  const hasMore = mergedDocs.length > safePageSize;
  const lastDoc = mergedDocs[safePageSize - 1] ?? null;

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

  // Feed PÚBLICO (invitado o no-miembro): oculta lives RESTRINGIDOS
  // (`liveData.allowLoggedOutViewers === false`) a los invitados (sin sesión o anónimos),
  // aunque la query los devuelva. Una cuenta real ve los logged_in_only; las reglas + el
  // proxy siguen siendo la barrera del contenido. (No-op para posts sin liveData.)
  const isRealAccount = !!auth.currentUser && !auth.currentUser.isAnonymous;
  const rawPosts: Post[] = postsSnap.docs
    .slice(0, safePageSize)
    .map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Post, "id">),
    }))
    .filter((post) => isRealAccount || post.liveData?.allowLoggedOutViewers !== false);

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
    // DOS carriles a propósito. En un `list`, las reglas solo ven los campos que
    // la query fija con `==`: si no se fija `groupVisibility`, la regla que
    // autoriza estos posts lo lee de un campo ausente, revienta y Firestore
    // deniega la consulta ENTERA. Como el carril iba dentro de un `.catch`, el
    // fallo era MUDO: los posts de comunidad del creador (incluido el premium
    // público de una comunidad privada) desaparecían de su perfil para todo
    // visitante que no fuera él mismo.
    const base = [
      where("authorId", "==", params.profileUid),
      where("contextType", "==", "group"),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
    ];
    const tail = [
      orderBy("createdAt", "desc"),
      orderBy(documentId(), "desc"),
      ...cursorParts,
      limit(params.pageSize),
    ];

    const [publicSnap, privatePremiumSnap] = await Promise.all([
      // Comunidad PÚBLICA: todo lo compartible (gratis, lives abiertos, premium).
      getDocs(query(postsRef, ...base, where("groupVisibility", "==", "public"), ...tail)),
      // Comunidad PRIVADA (incl. de suscripción): solo el premium de alcance
      // público, que es lo único que se puede ver —bloqueado— desde fuera.
      getDocs(
        query(
          postsRef,
          ...base,
          where("groupVisibility", "==", "private"),
          where("premium.enabled", "==", true),
          where("premium.accessMode", "==", "public"),
          ...tail
        )
      ),
    ]);

    return [...publicSnap.docs, ...privatePremiumSnap.docs];
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

  const dedupedDocs = Array.from(
    new Map(feedDocs.map((feedDoc) => [feedDoc.id, feedDoc])).values()
  );

  // Un INVITADO (sin sesión o sesión anónima) NO debe ver en el feed un LIVE restringido
  // (`liveData.allowLoggedOutViewers === false`, = logged_in_only / members_only), aunque
  // la query lo devuelva (p. ej. desde la caché offline de Firestore tras cerrar sesión en
  // el mismo navegador). Las reglas ya impiden REPRODUCIRLO; esto además lo quita de la
  // lista para que no aparezca la tarjeta "conectando…". Una cuenta REAL ve todo lo permitido.
  const isRealAccount = !!auth.currentUser && !auth.currentUser.isAnonymous;
  const uniqueDocs = isRealAccount
    ? dedupedDocs
    : dedupedDocs.filter((feedDoc) => {
        const ld = (feedDoc.data() as Record<string, unknown>).liveData as
          | Record<string, unknown>
          | null
          | undefined;
        return !(ld && ld.allowLoggedOutViewers === false);
      });

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

