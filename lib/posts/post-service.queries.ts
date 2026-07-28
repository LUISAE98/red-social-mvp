// Queries / feeds del servicio de posts — lectura y paginación de publicaciones.
//
// El bloque más grande de post-service.ts. Depende del núcleo ya extraído
// (internal/hydration/access) y de los helpers; no comparte estado de módulo con
// el resto. post-service.ts re-exporta este módulo (barrel).

import {
  collection, query, where, orderBy, limit, startAfter,
  getDocs, getDoc, doc, documentId, setDoc, serverTimestamp, Timestamp,
  type QueryDocumentSnapshot, type DocumentData,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { pickString, chunkArray, assertValidId, isProfileRestricted } from "./post-service.helpers";
import { fetchUsersByIds, fetchGroupsByIds, getPostGroupIds, isPostLocked } from "./post-service.internal";
import { hydratePost, attachViewerPostState } from "./post-service.hydration";
import { fetchOwnedGroupIds, fetchMemberGroupIds, fetchHiddenMemberGroupIds, fetchAccessibleGroupIds } from "./post-service.access";
import type { Post, PostContextType } from "./types";
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
 * Galería de una COMUNIDAD: todas las fotos/videos/lives de la comunidad, de
 * cualquier autor (query por `groupId`, no por autor).
 */
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

